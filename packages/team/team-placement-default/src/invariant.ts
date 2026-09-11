/** Invariant companion for `@clocky/clocky-team-placement-default`. @module @clocky/clocky-team-placement-default/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-placement-default'

/** Cordis companion plugin name. */
export const name = 'team-placement-default-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the controller owns activation uniqueness; the Hub owns durable assignment restrictions. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the package registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
