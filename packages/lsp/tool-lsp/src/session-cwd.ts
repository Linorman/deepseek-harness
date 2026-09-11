/**
 * Derive the workspace root an `lsp` call resolves against: the calling agent's current Team
 * allocation root, falling back to its per-session workspace, mirroring filesystem tools.
 * Unlike those tools, LSP has NO provider fallback — a missing cwd fails the call as
 * `LSP_WORKSPACE_REQUIRED`, because the local provider must canonicalize a real workspace before it
 * can start a server.
 * @module @clocky/clocky-tool-lsp/session-cwd
 */

import { resolveAgentWorkspaceRoot } from '@clocky/clocky-agent'
import type { ToolExecution } from '@clocky/clocky-tools'

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller.
 */
export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent === undefined ? undefined : resolveAgentWorkspaceRoot(exec.agent)
}
