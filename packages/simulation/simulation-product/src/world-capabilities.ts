/**
 * Preflight capability dimensions for a compiled World: checkpoint backup coverage and stop clocks declared by the
 * installed operations, each selected model's context capacity against the per-request allowance, and explicitly
 * unknown initial-context and long-run usage. Reading these runs no provider code and allocates no identity.
 */
import type { Context } from '@clocky/cordis'
import type { ResolvedWorldScenario, ResolvedWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import type { SimulationProductWorldCapabilities } from './world-types.ts'

/** Bound on reported model routes and operations; definitions are already bounded by the compiler. */
const MAX_ENTRIES = 64

/**
 * Derive capability dimensions for one successfully compiled World definition.
 * @param ctx - Host context with the Simulation provider registry and the model service.
 * @param resolved - Exact compiled definition.
 * @param provider - Deployment Simulation provider whose installed World domains execute the run.
 * @param signal - Read cancellation.
 * @returns declared backup/clock coverage, model capacity with violations, and explicit unknowns.
 */
export async function worldPreflightCapabilities(ctx: Context, resolved: ResolvedWorldScenario | ResolvedWorldScenarioV1,
  provider: string, signal?: AbortSignal): Promise<SimulationProductWorldCapabilities> {
  const coverage: ('native' | 'external-state-required' | 'unknown')[] = []
  const clocks: { domain: string; name: string }[] = []
  let registry: ReturnType<Context['simulations']['domains']> | undefined
  try { registry = ctx.simulations.domains(provider) } catch {
    // A provider without an installed domain catalog cannot prove coverage; every operation stays unknown below.
  }
  for (const pin of resolved.world.operations.slice(0, MAX_ENTRIES)) {
    if (registry === undefined) { coverage.push('unknown'); continue }
    let lease: ReturnType<typeof registry.acquire> | undefined
    try { lease = registry.acquire(pin) } catch {
      // A retired or closed generation declares nothing current; it reports as unknown rather than complete.
    }
    if (lease === undefined) { coverage.push('unknown'); continue }
    try {
      coverage.push(lease.implementation.checkpointCoverage ?? 'unknown')
      const clock = lease.implementation.stopClock?.name
      if (clock !== undefined && !clocks.some(value => value.domain === pin.domain && value.name === clock)) {
        clocks.push({ domain: pin.domain, name: clock })
      }
    } finally { lease.release() }
  }
  const backup = coverage.includes('external-state-required') ? 'external-state-required' as const
    : coverage.length > 0 && coverage.every(value => value === 'native') ? 'complete' as const : 'unknown' as const
  const routes = new Map<string, { provider: string; name: string }>()
  for (const runtime of [...resolved.actors.map(actor => actor.runtime), resolved.generatedActorRuntime]) {
    routes.set(JSON.stringify([runtime.model.provider, runtime.model.name]), { provider: runtime.model.provider, name: runtime.model.name })
  }
  const tokensPerRequest = resolved.limits.native.tokensPerModelRequest
  const models = await Promise.all([...routes.values()].slice(0, MAX_ENTRIES).map(async (route) => {
    try {
      const info = await ctx.llm.resolveModelInfo(route.provider, route.name, signal)
      return { ...route, contextWindow: info.context?.contextWindow ?? null, maxOutputTokens: info.defaultMaxTokens ?? null }
    } catch {
      // An adapter that cannot describe the route leaves its capacity unknown; creation still rechecks the route.
      return { ...route, contextWindow: null, maxOutputTokens: null }
    }
  }))
  return {
    backup, clocks: { native: { unit: resolved.native.tickUnit, maxTime: resolved.native.maxTime }, domains: clocks },
    models, tokensPerRequest, initialContext: 'unknown', longRunUsage: 'unknown',
    violations: models.flatMap(model => model.contextWindow !== null && model.contextWindow < tokensPerRequest
      ? [{ dimension: 'context-window' as const, model: `${model.provider}/${model.name}`, actual: model.contextWindow, required: tokensPerRequest }]
      : []),
  }
}
