/** Package-owned invariant companion for `@clocky/clocky-team-artifact`. @module @clocky/clocky-team-artifact/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-artifact'

/** Cordis companion plugin name. */
export const name = 'team-artifact-invariant'
/** Invariant registry required by this companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: artifact bytes and retention are owned by the selected
 * provider; the registry only owns provider registration identity.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
