/** Invariant companion for `@clocky/clocky-agent-runtime-in-process`. @module @clocky/clocky-agent-runtime-in-process/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-agent-runtime-in-process'

/** Cordis companion plugin name. */
export const name = 'agent-runtime-in-process-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider's duplicate-activation table and Agent
 * factory handle are one activation-local ownership relation. Rechecking it
 * from an observer would duplicate provider state; focused provider tests
 * exercise publication, duplicate sharing, interruption, and disposal.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
