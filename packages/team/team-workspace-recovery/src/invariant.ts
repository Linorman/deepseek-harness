/** Package-owned invariant companion for workspace release recovery. @module @clocky/clocky-team-workspace-recovery/invariant */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-team-workspace-recovery'

/** Cordis companion plugin name. */
export const name = 'team-workspace-recovery-invariant'
/** Invariant registry must exist before this companion reserves package ownership. */
export const inject = ['invariants']

/** Recovery owns no independent mutable projection beyond the authoritative Team journal. */
const install: InvariantInstaller = () => {
  /* No runtime invariant: recovery delegates exact allocation cleanup to the Team and workspace providers. */
}

/** Register this package's explicit invariant slot. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
