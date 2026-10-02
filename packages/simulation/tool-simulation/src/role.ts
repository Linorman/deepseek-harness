/** Scoped native-tool composition for a Simulation role. @module @clocky/clocky-tool-simulation/role */
import type { Context } from '@clocky/cordis'
import { SIMULATION_MODEL_TOOLS } from '@clocky/clocky-simulation-team'
import type {} from '@clocky/clocky-tools'
import type {} from '@clocky/clocky-system-prompt'

/** Cordis plugin name. */
export const name = 'simulation-role'
/** Tool definitions must already be registered by the host composition. */
export const inject = ['tools', 'systemPrompt']

/**
 * Select the three installed native Simulation tools for this preset scope.
 * @param ctx - Agent or standing preset scope; a plain context is rejected by the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.restrict({ allow: SIMULATION_MODEL_TOOLS })
  ctx.tools.presentAs('native')
  const allowed = new Set<string>(SIMULATION_MODEL_TOOLS)
  // Scoped tool registrations bypass inherited registry restrictions; filter the final request schemas as well.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembly = await next()
    return { ...assembly, tools: assembly.tools.filter(tool => allowed.has(tool.name)) }
  }, { prepend: true })
}
