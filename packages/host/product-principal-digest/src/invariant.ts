/**
 * Package-owned invariant companion for `@clocky/clocky-host-product-principal-digest`.
 * @module @clocky/clocky-host-product-principal-digest/invariant
 */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-host-product-principal-digest'

/** Cordis companion plugin name. */
export const name = 'product-principal-digest-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: digest comparison and provider revocation are contained by authentication unit tests. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
