/**
 * Package-owned invariant companion for `@clocky/clocky-host-product-principal-local`.
 * @module @clocky/clocky-host-product-principal-local/invariant
 */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-host-product-principal-local'

/** Cordis companion plugin name. */
export const name = 'product-principal-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: private-file rotation and digest validation are provider I/O pinned by unit tests. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
