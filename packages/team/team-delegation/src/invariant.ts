/** Invariant companion for `@clocky/clocky-team-delegation`. @module @clocky/clocky-team-delegation/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-delegation'

/** Cordis companion plugin name. */
export const name = 'team-delegation-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the Hub validates child reservation, result admission, and charge provenance from durable records. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the package registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
