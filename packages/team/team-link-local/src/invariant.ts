/** Package-owned invariant companion for `@clocky/clocky-team-link-local`. @module @clocky/clocky-team-link-local/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-link-local'

/** Cordis companion plugin name. */
export const name = 'team-link-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a Link verifies its durable activation binding through
 * the Team provider before publication, while Team owns channel admission,
 * claims, acknowledgements, and pending-delivery facts.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
