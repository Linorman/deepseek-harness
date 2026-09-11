/** Package-owned invariant companion for `@clocky/clocky-team-channel-basic`. @module @clocky/clocky-team-channel-basic/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-channel-basic'

/** Cordis companion plugin name. */
export const name = 'team-channel-basic-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: these adapters own pure protocol folds; TeamHub owns channel durability. */
const install: InvariantInstaller = () => {}

/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
