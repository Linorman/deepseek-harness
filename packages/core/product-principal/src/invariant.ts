/** Package-owned invariant companion for `@clocky/clocky-product-principal`. @module @clocky/clocky-product-principal/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-product-principal'

/** Cordis companion plugin name. */
export const name = 'product-principal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: provider admission and revocation are asynchronous lease lifecycles covered by the seam suite. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
