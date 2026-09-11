/** Invariant companion for `@clocky/clocky-team-workspace-sandbox`. @module @clocky/clocky-team-workspace-sandbox/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-workspace-sandbox'

/** Cordis companion plugin name. */
export const name = 'team-workspace-sandbox-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider validates its durable lease before every
 * allocation, and its provider-owned root is verified again before release.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
