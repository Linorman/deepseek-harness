/**
 * Delegation-depth accounting: the recursion budget a parent passes to its
 * children. Kept apart from the service so composition helpers can read it
 * without importing the registry.
 *
 * @module @clocky/clocky-subagent/depth
 */

import type { Agent } from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-session-projection'

declare module '@clocky/clocky-agent' {
  interface AgentOptions {
    /** Delegation depth: zero for a top-level agent and parent depth + 1 for a child. */
    subagentDepth?: number
  }
}

/**
 * Read an agent's delegation depth, treating absence as top-level depth zero.
 * The durable subagent descriptor projection is authoritative and monotone:
 * runtime `AgentOptions.subagentDepth` may DEEPEN the count but can never lower
 * it. A resumed child restores the descriptor depth into fresh options before
 * publication, so counting it from zero would still be impossible when the
 * projection service is unavailable.
 * @param agent - the agent whose header and options carry the depth.
 * @returns its non-negative safe-integer depth.
 * @throws if the runtime `AgentOptions.subagentDepth` is not a non-negative safe integer.
 */
export function delegationDepthOf(agent: Agent): number {
  const runtime = agent.options?.subagentDepth
  if (runtime !== undefined && (!Number.isSafeInteger(runtime) || runtime < 0 || Object.is(runtime, -0))) {
    throw new TypeError('agent subagentDepth must be a non-negative safe integer')
  }
  const session = (agent as unknown as { session?: Agent['session'] }).session
  const durable = session === undefined
    ? 0
    : agent.ctx?.get('sessionProjections')?.snapshot(session).values.subagent?.depth ?? 0
  return Math.max(durable, runtime ?? 0)
}

/**
 * Reject a recursion cap that cannot represent an exact delegation depth.
 * @param maxDepth - the optional runtime value to validate.
 */
export function assertSubagentMaxDepth(maxDepth: unknown): void {
  if (maxDepth !== undefined && (
    typeof maxDepth !== 'number'
    || !Number.isSafeInteger(maxDepth)
    || maxDepth < 0
    || Object.is(maxDepth, -0)
  )) {
    throw new TypeError('subagent maxDepth must be a non-negative safe integer')
  }
}
