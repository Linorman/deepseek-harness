/** Simulation product orchestration has no independent authoritative world event stream. */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

/** Cordis companion identity. */
export const name = 'simulation-product-invariant'
/** Required package invariant registration owner. */
export const inject = ['invariants']
/** No runtime invariant: directory folds validate registration; native owners assert world, checkpoint, management and writer facts. */
const install: InvariantInstaller = () => {}
/**
 * Register the directory's invariant companion without inspecting service presence.
 * @param ctx - Required invariant registry.
 * @returns the effect-scoped package ownership disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@clocky/clocky-simulation-product', install))
