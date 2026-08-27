/**
 * Package-owned invariant companion for `@clocky/clocky-session-title-llm`.
 * @module @clocky/clocky-session-title-llm/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-session-title-llm'

/** Cordis companion plugin name. */
export const name = 'session-title-llm-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless helper validates and freezes each auxiliary request before
 * dispatch; deadline, stream, cited message seqs, and provider/model fields are checked synchronously and by tests.
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
