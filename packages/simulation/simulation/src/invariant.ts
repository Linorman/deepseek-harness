/** Simulation provider registry invariant ownership. @module @clocky/clocky-simulation/invariant */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
/** Companion name. */
export const name = 'simulation-invariant'
/** Required diagnostic registry. */
export const inject = ['invariants']
/** No runtime invariant: this registry has no journal; providers own durable state relationships. */
const install: InvariantInstaller = () => {}
/**
 * Register ownership.
 * @param ctx - Diagnostic context.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@clocky/clocky-simulation', install))
