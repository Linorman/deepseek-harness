/**
 * Package-owned invariant companion for `@clocky/clocky-client-ui-plan`.
 * @module @clocky/clocky-client-ui-plan/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-client-ui-plan'

/** Cordis companion plugin name. */
export const name = 'client-ui-plan-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: plan state and boundary ownership are
 * audited by clocky-plan-mode, while the control is a slot effect whose
 * declaration, registration, and teardown are exercised by this package.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
