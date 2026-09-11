/** Invariant companion for `@clocky/clocky-team-closure-driver`. @module @clocky/clocky-team-closure-driver/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-closure-driver'

/** Cordis companion plugin name. */
export const name = 'team-closure-driver-invariant'
/** Invariant registry must exist before this companion reserves package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the Team provider validates every durable closure transition selected by the backend. */
const install: InvariantInstaller = () => {}

/** Register this package's explicit invariant slot. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
