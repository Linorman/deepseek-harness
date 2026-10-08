/** Scoped native-tool composition for a Simulation role. @module @clocky/clocky-tool-simulation/role */
import type { Context } from '@clocky/cordis'
import { SIMULATION_MODEL_TOOLS } from '@clocky/clocky-simulation-team'
import { apply as registerNativeTools } from './index.ts'
import type {} from '@clocky/clocky-tools'
import type { ToolRunContext } from '@clocky/clocky-tools'
import type {} from '@clocky/clocky-system-prompt'

/** Cordis plugin name. */
export const name = 'simulation-role'
/** Native definitions and prompt filtering share the actor's preset scope. */
export const inject = ['tools', 'systemPrompt', 'simulationTeams']

/**
 * Register the three native Simulation tools and hide inherited tools in this preset scope.
 * @param ctx - Agent or standing preset scope; a plain context is rejected by the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.presentAs('native')
  registerNativeTools(ctx)
  const installed = new Map<NonNullable<ToolRunContext['agent']>, () => void>()
  // Standing preset definitions are inherited by each joined Agent. Apply
  // its allow-list there, where those definitions are inherited capabilities;
  // filtering the defining layer itself would hide them from descendants.
  ctx.on('agent/created', ({ agent }) => {
    if (!installed.has(agent)) installed.set(agent, agent.ctx.tools.restrict({ allow: SIMULATION_MODEL_TOOLS }))
  })
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent) })
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear() }, 'simulation-role: joined Agent restrictions')
  const allowed = new Set<string>(SIMULATION_MODEL_TOOLS)
  // Scoped tool registrations bypass inherited registry restrictions; filter the final request schemas as well.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, tools: assembly.tools.filter(tool => allowed.has(tool.name)) }
  }, { prepend: true })
}
