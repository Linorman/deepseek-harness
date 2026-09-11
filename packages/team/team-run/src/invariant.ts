/** Package-owned invariant companion for `@clocky/clocky-team-run`. @module @clocky/clocky-team-run/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-run'

/** Cordis companion plugin name. */
export const name = 'team-run-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Team-run owns product topology and checks its durable
 * participant/channel/receipt relationships before it settles a final result.
 * The Hub and Agent Client own the independently observable durable facts.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant registry.
 * @returns the package registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
