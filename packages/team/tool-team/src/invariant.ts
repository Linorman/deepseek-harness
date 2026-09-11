/** Invariant companion for `@clocky/clocky-tool-team`. @module @clocky/clocky-tool-team/invariant */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-tool-team'

/** Cordis companion plugin name. */
export const name = 'tool-team-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package validates a calling Agent's durable
 * assignment source or live binding before forwarding a Team operation to the authoritative API.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
