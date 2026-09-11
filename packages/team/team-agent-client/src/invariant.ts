/** Invariant companion for `@clocky/clocky-team-agent-client`. @module @clocky/clocky-team-agent-client/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-agent-client'

/** Cordis companion plugin name. */
export const name = 'team-agent-client-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the only owned relationship is a live Agent's
 * Session-header pair to its own inbox, and rechecking it from a global
 * observer would duplicate the client's ephemeral binding table.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
