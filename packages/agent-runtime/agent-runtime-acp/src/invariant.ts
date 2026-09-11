/** Package-owned invariant companion for the ACP AgentRuntime provider. */

import type { Context } from '@clocky/cordis'
import type { InvariantInstaller } from '@clocky/clocky-invariants'

const PACKAGE_NAME = '@clocky/clocky-agent-runtime-acp'

/** Cordis companion plugin name. */
export const name = 'agent-runtime-acp-invariant'
/** Invariant registry must be available before installation. */
export const inject = ['invariants']

/**
 * No runtime invariant: ACP owns an external process and publishes lifecycle
 * facts through AgentRuntime; Team binding and delivery invariants belong to
 * the activation controller and Team Link consumers.
 */
const install: InvariantInstaller = () => {}

/** Register the empty ACP provider invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
