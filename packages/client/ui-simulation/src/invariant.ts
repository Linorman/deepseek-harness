/** Simulation UI has no independent business authority or stream. */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
/** Cordis companion identity. */
export const name = 'client-ui-simulation-invariant'
/** Required invariant registry. */
export const inject = ['invariants']
/** No runtime invariant: navigation is transient; native product/provider reads retain authorization and durable validation. */
const install: InvariantInstaller = () => {}
/** @param ctx - Owning invariant registry. @returns effect-scoped registration disposer. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@clocky/clocky-client-ui-simulation', install))
