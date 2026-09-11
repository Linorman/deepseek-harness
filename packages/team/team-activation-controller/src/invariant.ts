/** Invariant companion for the local Team activation controller. @module @clocky/clocky-team-activation-controller/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-activation-controller'

/** Cordis companion plugin name. */
export const name = 'team-activation-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the controller's owned relation is the awaitable
 * bind-or-dispose sequence, while the Hub already validates every persisted
 * activation identity and lifecycle edge.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
