/**
 * Package-owned invariant companion for `@clocky/clocky-team-channel-direct`.
 * @module @clocky/clocky-team-channel-direct/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-channel-direct'

/** Cordis companion plugin name. */
export const name = 'team-channel-direct-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package registers one stateless pure adapter;
 * TeamRuntime owns its registration lifetime and TeamHub owns every durable
 * channel-record relationship.
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
