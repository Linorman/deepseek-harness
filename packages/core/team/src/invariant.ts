/**
 * Package-owned invariant companion for `@clocky/clocky-team`.
 * @module @clocky/clocky-team/invariant
 */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team'

/** Cordis companion plugin name. */
export const name = 'team-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: task snapshot parsers validate local lease, attempt,
 * and review-history relationships at each durable boundary, while a Team provider owns the
 * journal/WAL relationships that require authoritative replay state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
