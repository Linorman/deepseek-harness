/** Package-owned invariant companion for `@clocky/clocky-activation-supervisor-http`. */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-activation-supervisor-http'

/** Cordis companion plugin name. */
export const name = 'activation-supervisor-http-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each supervisor operation validates its complete epoch
 * before returning; process ownership is private to its execution provider and
 * has no independent event stream in this registry.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
