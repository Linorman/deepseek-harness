/** Package-owned invariant companion for `@clocky/clocky-team-human-actor`. @module @clocky/clocky-team-human-actor/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-human-actor'

/** Cordis companion plugin name. */
export const name = 'team-human-actor-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']

/** No runtime invariant: TeamHub owns durable participant and mutation relations. */
const install: InvariantInstaller = () => {}

/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
