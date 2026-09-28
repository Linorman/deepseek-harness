/** Simulation/Team coordination invariant ownership. @module @clocky/clocky-simulation-team/invariant */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
/** Companion identity. */
export const name = 'simulation-team-invariant'
/** Required diagnostics registry. */
export const inject = ['invariants']
/**
 * No runtime invariant: the run journal owns selected context and epoch records; Session owns surface projection.
 * This consumer enforces flush ordering at the intercepted pre-step and model-stream waterfalls; the controller owns termination evidence.
 */
const install: InvariantInstaller = () => {}
/**
 * Register invariant ownership.
 * @param ctx - Diagnostic context.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@clocky/clocky-simulation-team', install))
