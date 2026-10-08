/**
 * Package-owned invariant companion for `@clocky/clocky-team-workspace-local-files`.
 * @module @clocky/clocky-team-workspace-local-files/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-workspace-local-files'

/** Cordis companion plugin name. */
export const name = 'team-workspace-local-files-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this filesystem implementation library owns no durable event stream or mutable runtime data;
 * provider tests exercise its file publication, symlink protection and staged change semantics.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
