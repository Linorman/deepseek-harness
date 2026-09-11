/** Invariant companion for `@clocky/clocky-team-workspace-shared`. @module @clocky/clocky-team-workspace-shared/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-workspace-shared'

/** Cordis companion plugin name. */
export const name = 'team-workspace-shared-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Hub observation events and allocation projections own
 * scan continuity and scope relationships. Comparing a past fingerprint with
 * the mutable shared tree would incorrectly treat later writes as corruption.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
