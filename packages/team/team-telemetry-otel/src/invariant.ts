/**
 * Package-owned invariant companion for `@clocky/clocky-team-telemetry-otel`.
 * @module @clocky/clocky-team-telemetry-otel/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-telemetry-otel'

/** Cordis companion plugin name. */
export const name = 'team-telemetry-otel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * The provider's invariant is entirely at its SDK/export boundary: the Team
 * runtime retains authority and no independent package projection exists.
 */
const install: InvariantInstaller = () => {
  /* No runtime invariant: Team telemetry exports operational observations and owns no business projection. */
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
