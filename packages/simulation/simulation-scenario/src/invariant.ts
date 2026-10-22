/** Diagnostic ownership for the pure world scenario compiler. */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
/** Companion registration name. */
export const name = 'simulation-scenario-invariant'
/** Required diagnostic registry. */
export const inject = ['invariants']
/** No runtime invariant: the pure compiler owns no runtime events or mutable state; compilation validates all input relationships. */
const install: InvariantInstaller = () => {}
/** @param ctx - Diagnostic registry context. @returns package ownership disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@clocky/clocky-simulation-scenario', install))
