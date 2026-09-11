/** Invariant companion for `@clocky/clocky-command-team-goal`. @module @clocky/clocky-command-team-goal/invariant */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-command-team-goal'

/** Cordis companion plugin name. */
export const name = 'command-team-goal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the command reads a Team-bound Session header and delegates every durable
 * mutation, participant check, revision fence, and policy decision to the authoritative Team provider.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
