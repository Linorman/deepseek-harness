/** Invariant companion for `@clocky/clocky-agent-runtime-sdk`. @module @clocky/clocky-agent-runtime-sdk/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-agent-runtime-sdk'

/** Cordis companion plugin name. */
export const name = 'agent-runtime-sdk-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: remote activation identity, status ordering, and
 * process ownership are observable only through the SDK transport. The
 * provider's scripted-client tests cover those relations without duplicating
 * child-process state in the host context.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant registry.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
