/** Diagnostic ownership for the World driver consumer. */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'
export const name = 'simulation-world-invariant'
export const inject = ['invariants']
/**
 * No runtime invariant: Native and Team own authoritative events/data;
 * the driver and factory registry only admit and coordinate their capabilities.
 */
const install: InvariantInstaller = () => {}
/** @param ctx - Diagnostic registry context. @returns package ownership disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@clocky/clocky-simulation-world', install))
