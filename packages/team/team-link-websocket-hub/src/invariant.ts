/** Package-owned invariant companion. @module @clocky/clocky-team-link-websocket-hub/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-link-websocket-hub'

/** Cordis companion plugin name. */
export const name = 'team-link-websocket-hub-invariant'
/** The invariant registry must exist before this companion reserves package ownership. */
export const inject = ['invariants']

/** No runtime invariant: TeamRuntime remains authoritative for durable bindings, delivery, and receipts. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
