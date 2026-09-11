/** Invariant companion for `@clocky/clocky-tool-team-goal`. @module @clocky/clocky-tool-team-goal/invariant */

/* jscpd:ignore-start */
import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-tool-team-goal'

/** Cordis companion plugin name. */
export const name = 'tool-team-goal-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: TeamRun revalidates the exact coordinator and Team Hub fences durable objective edits. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
