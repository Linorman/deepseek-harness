/** Package-owned invariant companion for `@clocky/clocky-team-artifact-local`. @module @clocky/clocky-team-artifact-local/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-artifact-local'

/** Cordis companion plugin name. */
export const name = 'team-artifact-local-invariant'
/** Invariant registry required by this companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: content-addressed bytes are validated by the local
 * provider, while Team task provenance remains Hub-owned.
 */
const install: InvariantInstaller = () => {}

/** Register the provider's invariant companion. @param ctx - invariant context. @returns disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
