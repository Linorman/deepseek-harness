/** Invariant companion for `@clocky/clocky-team-workspace-worktree`. @module @clocky/clocky-team-workspace-worktree/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-workspace-worktree'

/** Cordis companion plugin name. */
export const name = 'team-workspace-worktree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider validates each allocation against the
 * Team projection before Git mutation, while an accepted handle alone owns its
 * provider-created worktree and retryable release state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
