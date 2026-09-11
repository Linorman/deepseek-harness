/**
 * Package-owned invariant companion for `@clocky/clocky-team-channel-task-assignment`.
 * @module @clocky/clocky-team-channel-task-assignment/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-channel-task-assignment'

/** Cordis companion plugin name. */
export const name = 'team-channel-task-assignment-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter retains only pure protocol state;
 * TeamRuntime owns its registration lifetime and TeamHub owns durable WAL
 * replay and recipient delivery relationships.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
