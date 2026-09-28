/** Scoped native-tool composition for a Simulation role. @module @clocky/clocky-tool-simulation/role */
import type { Context } from '@clocky/cordis'
import { SIMULATION_MODEL_TOOLS } from '@clocky/clocky-simulation-team'
import type {} from '@clocky/clocky-tools'

/** Cordis plugin name. */
export const name = 'simulation-role'
/** Tool definitions must already be registered by the host composition. */
export const inject = ['tools']

/**
 * Select the three installed native Simulation tools for this preset scope.
 * @param ctx - Agent or standing preset scope; a plain context is rejected by the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.restrict({ allow: SIMULATION_MODEL_TOOLS })
  ctx.tools.presentAs('native')
}
