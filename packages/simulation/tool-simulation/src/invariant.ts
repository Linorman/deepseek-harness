/** Simulation model tool invariant ownership. @module @clocky/clocky-tool-simulation/invariant */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
/** Companion name. */
export const name = 'tool-simulation-invariant'
/** Required diagnostic registry. */
export const inject = ['invariants']
/** No runtime invariant: these tools own no world state.
 * Simulation writer admission and journal providers own decision/effect relationships. */
const install: InvariantInstaller = () => {}
/**
 * Register ownership.
 * @param ctx - Diagnostic context.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@clocky/clocky-tool-simulation', install))
