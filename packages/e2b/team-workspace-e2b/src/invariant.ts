/** Invariant companion for `@clocky/clocky-team-workspace-e2b`. @module @clocky/clocky-team-workspace-e2b/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-workspace-e2b'

/** Cordis companion plugin name. */
export const name = 'team-workspace-e2b-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: E2B owns remote process and filesystem state, while
 * the provider verifies its remote manifest before each release.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
