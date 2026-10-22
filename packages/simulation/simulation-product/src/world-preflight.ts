/** Deployment-backed World preflight without command acceptance, storage writes or identity allocation. */
import type { Context } from '@clocky/cordis'
import { isDeepStrictEqual } from 'node:util'
import type {} from '@clocky/clocky-agent-presets'
import type {} from '@clocky/clocky-agent-runtime'
import { isInProcessAgentRuntimeProvider } from '@clocky/clocky-agent-runtime-in-process'
import type {} from '@clocky/clocky-team'
import { verifyTemplateDependencies, compileWorldScenario, parseWorldScenario, scenarioCatalogSchema, decodeScenarioInput,
  compileWorldScenarioV1, parseWorldScenarioV1, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import type { ScenarioTemplateManifest, ScenarioCompilation, ScenarioCatalog, ScenarioV1Compilation, ScenarioV1Catalog } from '@clocky/clocky-simulation-scenario'
import { initialWorldContext } from '@clocky/clocky-simulation-world/required-context'
import { resolveWorldModel } from './world-model.ts'
import type { WorldModelSelection } from './world-model.ts'

/**
 * Resolve catalog availability and actual Team ceilings, then compile an inert new-run definition.
 * @param ctx - Actual Team, provider, runtime and preset owners; no run or Session owner is acquired.
 * @param definition - Untrusted portable definition or JSON text; malformed input rejects before metadata lookup.
 * @param installed - Trusted deployment allowlist and versioned original model/template/policy metadata.
 * @param signal - Caller read lifetime; cancellation never becomes a successful preview.
 * @param provider - Explicit Native provider for v1 domain availability; legacy callers may omit it.
 * @param templateManifest - Optional inert package metadata whose exact implementation pins must still be installed.
 * @param modelSelection - Optional deployment selector resolved into concrete original model routes.
 * @returns complete frozen compilation or field diagnostics. Adapter metadata reads perform no inference;
 * v1 retains the complete declared catalog and observed Team ceiling; its hash also covers metadata above effective
 * limits and unused defaults. Call again before durable creation acceptance.
 */
export async function preflightSimulationWorld(ctx: Context, definition: unknown, installed: ScenarioCatalog | ScenarioV1Catalog,
  signal: AbortSignal, provider?: string, templateManifest?: ScenarioTemplateManifest, modelSelection?: WorldModelSelection):
Promise<ScenarioCompilation | ScenarioV1Compilation> {
  signal.throwIfAborted()
  const decoded = decodeScenarioInput(definition, 'json')
  if (!decoded.ok) return decoded
  const v1 = decoded.value !== null && typeof decoded.value === 'object'
    && Reflect.get(decoded.value, 'apiVersion') === 'clocky.world/v1'
  const parsed = v1 ? parseWorldScenarioV1(definition) : parseWorldScenario(definition)
  if (!parsed.ok) return parsed
  if (v1 && !('domains' in installed)) return { ok: false, diagnostics: [{ source: 'catalog', path: ['domains'],
    code: 'domain-unavailable', message: 'Complete World domain metadata is not installed' }] }
  const model = resolveWorldModel(ctx, installed, modelSelection)
  if ('error' in model) return { ok: false, diagnostics: [{ source: 'catalog', path: ['runtimeProfiles'],
    code: 'model-unavailable', message: model.error }] }
  const v1Catalog = 'domains' in model.catalog ? scenarioV1CatalogSchema.parse(model.catalog) : undefined
  const catalog = v1Catalog ?? scenarioCatalogSchema.parse(model.catalog)
  const domains = () => {
    if (!v1 || v1Catalog === undefined) return
    let registry: import('@clocky/clocky-simulation').SimulationWorldDomainRegistry<import('@clocky/clocky-simulation').NativeWorldDomain> | undefined
    if (provider !== undefined) {
      try { registry = ctx.get('simulations')?.domains(provider) }
      catch { /* Missing provider capability cannot claim an installed domain; private route errors remain withheld. */ }
    }
    for (const entry of v1Catalog.domains) {
      let current: typeof entry.pin | undefined
      try { current = registry?.pin({ domain: entry.pin.domain, operation: entry.pin.operation, version: entry.pin.version }) }
      catch { /* Closed or missing operation admission marks only its metadata unavailable. */ }
      entry.available = entry.available && current !== undefined && isDeepStrictEqual(current, entry.pin)
      if (entry.directorEvents !== undefined) {
        let supported = false
        try { supported = registry?.definition({ domain: entry.pin.domain,
          operation: entry.pin.operation, version: entry.pin.version }).directorEvents === true }
        catch { /* Missing or retired metadata never grants scenario-originating director authority. */ }
        entry.directorEvents = entry.directorEvents && supported
      }
    }
  }
  domains()
  const dependencyIssues = () => {
    if (templateManifest === undefined) return []
    if (parsed.definition.apiVersion !== 'clocky.world/v1' || v1Catalog === undefined) return [{
      source: 'scenario' as const, code: 'invalid-shape' as const, path: ['templateManifest'],
      message: 'Template packages require a complete World v1 definition and catalog' }]
    return verifyTemplateDependencies(parsed.definition, templateManifest, v1Catalog)
  }
  const compile = () => v1 && v1Catalog !== undefined ? compileWorldScenarioV1(parsed.definition, v1Catalog, 'json', actual)
    : compileWorldScenario(parsed.definition, { generation: catalog.generation, policyVersion: catalog.policyVersion,
      native: catalog.native, runtimeProfiles: catalog.runtimeProfiles, templates: catalog.templates, limits: catalog.limits })
  const team = ctx.get('teams')
  if (team === undefined) return { ok: false, diagnostics: [{ source: 'catalog', path: ['limits', 'team'],
    code: 'capacity', message: 'The Team creation owner is unavailable' }] }
  const actual = team.getCreationLimits()
  if (!v1) for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
    catalog.limits.ceilings.team[key] = Math.min(catalog.limits.ceilings.team[key], actual[key])
  }
  const dependencies = dependencyIssues()
  if (dependencies.length > 0) return { ok: false, diagnostics: dependencies }
  const preliminary = await compile()
  if (!preliminary.ok) return preliminary
  const requiredContexts = initialWorldContext(preliminary.resolved)
  const selected = [...preliminary.resolved.actors.map(actor => actor.runtime), preliminary.resolved.generatedActorRuntime]
  for (const profile of catalog.runtimeProfiles) {
    if (!selected.some(value => value.id === profile.id && value.version === profile.version)) continue
    signal.throwIfAborted()
    const runtime = ctx.get('agentRuntimes')?.getProvider(profile.provider)
    profile.available = profile.available && runtime !== undefined && isInProcessAgentRuntimeProvider(runtime)
    const presets = ctx.get('agentPresets')
    if (presets === undefined) profile.available = false
    else {
      let preset: Awaited<ReturnType<typeof presets.resolve>> | undefined
      try { preset = await presets.resolve(profile.preset) }
      catch { /* An unavailable preset cannot produce an executable role; private lookup errors are withheld. */ }
      profile.available = profile.available && preset !== undefined && preset.broken === undefined
    }
    const llm = ctx.get('llm')
    profile.model.available = profile.model.available && profile.available
      && llm?.listProviders().some(provider => provider.id === profile.model.provider) === true
    if (profile.model.available && llm !== undefined) {
      let info: Awaited<ReturnType<typeof llm.resolveModelInfo>> | undefined
      try { info = await llm.resolveModelInfo(profile.model.provider, profile.model.name, signal) }
      catch { profile.model.available = false /* Metadata failure must not claim model readiness. */ }
      if (info !== undefined) {
        signal.throwIfAborted()
        const actors = requiredContexts.filter(value => value.runtime.id === profile.id && value.runtime.version === profile.version)
        for (const actor of actors.length === 0 ? [undefined] : actors) {
          const capacity = ctx.get('simulationTeams')?.requestCapacity({ tokensPerRequest: preliminary.resolved.native.tokensPerModelRequest,
            ...info.context === undefined ? {} : { contextWindow: info.context.contextWindow },
            ...actor === undefined ? {} : { knownRequiredContext: actor.sections } })
          if (capacity?.status === 'impossible') return { ok: false, diagnostics: [{ source: 'preflight',
            path: actor === undefined ? ['runtimeProfiles', profile.id, 'model'] : ['actors', actor.entityId, 'context'], code: 'capacity',
            message: `The ${capacity.dimension} allowance ${capacity.limit} cannot fit the known required minimum `
              + `${capacity.minimumRequired} ${capacity.dimension === 'context-bytes' ? 'bytes' : 'tokens'}. `
              + 'Additional request context and future consumption remain unknown.' }] }
        }
      }
    }
    const currentRuntime = ctx.get('agentRuntimes')?.getProvider(profile.provider)
    profile.available = profile.available && currentRuntime !== undefined && isInProcessAgentRuntimeProvider(currentRuntime)
    profile.model.available = profile.model.available
      && ctx.get('llm')?.listProviders().some(provider => provider.id === profile.model.provider) === true
  }
  signal.throwIfAborted()
  const currentModel = resolveWorldModel(ctx, installed, modelSelection)
  if ('error' in currentModel || currentModel.catalog.generation !== catalog.generation) {
    return { ok: false, diagnostics: [{ source: 'catalog', path: ['runtimeProfiles'], code: 'model-unavailable',
      message: 'The default model changed during preflight. Check the scenario again.' }] }
  }
  const current = ctx.get('teams')
  if (current === undefined || !isDeepStrictEqual(current.getCreationLimits(), actual)) {
    return { ok: false, diagnostics: [{ source: 'catalog', path: ['limits', 'team'],
      code: 'capacity', message: 'The Team creation limits changed during preflight' }] }
  }
  domains()
  const finalDependencies = dependencyIssues()
  if (finalDependencies.length > 0) return { ok: false, diagnostics: finalDependencies }
  return await compile()
}
