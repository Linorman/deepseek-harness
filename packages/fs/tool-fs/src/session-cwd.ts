/**
 * Derive the working directory a filesystem tool resolves relative paths against: the calling
 * agent's current Team allocation root, falling back to its durable Session cwd, so each
 * `read`/`write`/`edit` acts on the execution world selected for that task.
 * Non-agent calls return `undefined`, leaving the fallback in the provider rather than reading
 * `process.cwd()` at the tool boundary.
 * @module @clocky/clocky-tool-fs/session-cwd
 */

import { resolveAgentWorkspaceRoot } from '@clocky/clocky-agent'
import type { ToolExecution } from '@clocky/clocky-tools'
import { canonicalPath } from '@clocky/clocky-sandbox'

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal
 *   makes a symlinked cwd's filesystem identity observable.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller (the backend then applies its own default).
 */
export function sessionCwd(exec: ToolExecution, requestedPath: string): string | undefined {
  const cwd = exec.agent === undefined ? undefined : resolveAgentWorkspaceRoot(exec.agent)
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * Resolution options shared by all model-facing filesystem tools.
 * @param exec - the tool-execution context supplying session cwd and cancellation.
 * @param requestedPath - the path the provider will resolve.
 * @param policyWorkspaceRoot - resolved per-call root, when a mutation carries sandbox policy.
 * @returns provider resolution options for the current tool call.
 */
export function sessionResolveOptions(
  exec: ToolExecution,
  requestedPath: string,
  policyWorkspaceRoot?: string,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? sessionCwd(exec, requestedPath)
  return {
    ...cwd !== undefined ? { cwd } : {},
    signal: exec.signal,
  }
}
