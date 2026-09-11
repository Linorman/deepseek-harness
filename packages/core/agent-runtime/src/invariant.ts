/** Package-owned invariant companion for `@clocky/clocky-agent-runtime`. @module @clocky/clocky-agent-runtime/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-agent-runtime'

/** Cordis companion plugin name. */
export const name = 'agent-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry's duplicate, replacement, and activation
 * binding checks execute synchronously inside the service. A provider owns its
 * activation state and durable binding, so checking it here would duplicate a
 * provider implementation rather than observe an independent relationship.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
