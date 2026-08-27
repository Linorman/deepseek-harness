/**
 * Package-owned invariant companion for `@clocky/clocky-typert-generator`.
 * @module @clocky/clocky-typert-generator/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-typert-generator'

/** Cordis companion plugin name. */
export const name = 'typert-generator-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this source-project analyzer and build-time emitter
 * runs outside any cordis runtime; model snapshots, executable artifacts, and
 * consuming-package typechecks enforce its output contract.
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
