/**
 * Package-owned invariant companion for `@clocky/clocky-session-query-sqlite`.
 * @module @clocky/clocky-session-query-sqlite/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-session-query-sqlite'

/** Cordis companion plugin name. */
export const name = 'session-query-sqlite-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: reconciliation, cursor generations, and derived-index
 * ownership are validated at each serialized query boundary.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
