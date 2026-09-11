/** Package-owned invariant companion for `@clocky/clocky-team-link`. @module @clocky/clocky-team-link/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-link'

/** Cordis companion plugin name. */
export const name = 'team-link-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry checks provider replacement and each
 * returned Link against its requested binding before publication.
 * A provider owns connection lifecycle and notification delivery, so observing
 * either here would duplicate that provider implementation.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
