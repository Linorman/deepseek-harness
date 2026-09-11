/** Package-owned invariant companion for `@clocky/clocky-storage-log`. @module @clocky/clocky-storage-log/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-storage-log'

/** Cordis companion plugin name. */
export const name = 'storage-log-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns a routed handle registry but no
 * event stream or independent mutable projection. The backend log facet owns
 * each durable expected-tail and checkpoint relationship.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the companion with the invariant registry.
 * @param ctx - Context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
