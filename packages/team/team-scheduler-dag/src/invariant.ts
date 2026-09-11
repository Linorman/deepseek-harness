/** Invariant companion for `@clocky/clocky-team-scheduler-dag`. @module @clocky/clocky-team-scheduler-dag/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-scheduler-dag'

/** Cordis companion plugin name. */
export const name = 'team-scheduler-dag-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: task and workspace eligibility are transient reads
 * used to propose Team compare-and-set operations, while Team and workspace
 * providers validate and own their durable mutations and allocations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Context carrying the invariant service.
 * @returns the installed registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
