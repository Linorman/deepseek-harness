/**
 * Package-owned invariant companion for `@clocky/clocky-headless`.
 * @module @clocky/clocky-headless/invariant
 */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-headless'

/** Cordis companion plugin name. */
export const name = 'headless-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the runner's Team final-output and exit contract is
 * process-level and pinned by the launcher tests; it owns no in-tree relation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
