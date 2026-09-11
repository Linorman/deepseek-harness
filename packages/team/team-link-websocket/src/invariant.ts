/** Package-owned invariant companion for `@clocky/clocky-team-link-websocket`. @module @clocky/clocky-team-link-websocket/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-link-websocket'

/** Cordis companion plugin name. */
export const name = 'team-link-websocket-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the authenticated peer is external and the core frame parser owns wire validation. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
