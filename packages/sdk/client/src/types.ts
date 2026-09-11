/**
 * Types for the TypeScript SDK client: launch options, notification shapes,
 * and owned activity results.
 *
 * @module @clocky/clocky-sdk-client/types
 */

import type { ContentBlock } from '@clocky/clocky-llm'
import type { SessionEvent } from '@clocky/clocky-session'
import type { TeamWaitFinalResult } from '@clocky/clocky-sdk-protocol'

/** One server-to-client notification as received off the wire. */
export interface HarnessNotification {
  /** The JSON-RPC notification method name. */
  method: string
  /** The raw params object; see `HarnessSdkNotificationMap` for the shapes per method. */
  params: Record<string, unknown>
}

/** Predicate deciding whether a subscription receives a notification. */
export type NotificationFilter = (notification: HarnessNotification) => boolean

/** Launch and timeout options for {@link HarnessClient}. */
export interface HarnessClientOptions {
  /** The runtime executable (the `clocky-jsonrpc-agent` bin, a packaged exe, or `node`). */
  command: string
  /** Arguments passed to {@link command}. */
  args?: string[]
  /** Working directory for the runtime process itself. */
  cwd?: string
  /** Start the child in its own POSIX process group for an external stale-process fencer. */
  detached?: boolean
  /**
   * The complete child environment. `undefined` inherits the parent env
   * verbatim; passing an object replaces it entirely. The initialization
   * credential is a separate option and is removed from this environment
   * before the child starts.
   */
  env?: NodeJS.ProcessEnv
  /** Per-request timeout (ms); `undefined` waits indefinitely (a turn can legitimately run long). */
  requestTimeoutMs?: number
  /** Bound (ms) on the protocol `shutdown` exchange inside `close()` (default 1000). */
  shutdownTimeoutMs?: number
  /** Grace (ms) for the runtime's stdin-EOF quiesce during `close()` (default 6000). */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms) after SIGTERM/SIGKILL during `close()` (default 3000). */
  disposeGraceMs?: number
}

/** Options for the high-level {@link Clocky} wrapper. */
export interface ClockyOptions {
  /** Launch spec for the runtime subprocess (command, args, cwd, env, timeouts). */
  launch: HarnessClientOptions
  /** Opaque product credential sent only in the runtime initialization handshake. */
  credential: string
  /** Workspace cwd recorded on every SDK-created coordinator Session (default: launch cwd, else `process.cwd()`). */
  cwd?: string
  /** Provider route for SDK-created Team coordinators; required because the runtime has no provider fallback. */
  provider: string
  /** Model for SDK-created Team coordinators; required because the runtime has no model fallback. */
  model: string
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}

/** One completed Team run and its coordinator transcript projection. */
export interface RunResult {
  /** Product Team that owned the run. */
  teamId: string
  /** Human-addressed explicit final text. */
  finalResponse: string
  /** Complete durable final-result receipt. */
  final: TeamWaitFinalResult
  /** Every `session.event` payload for the coordinator Session, in wire order. */
  events: SessionEvent[]
  /** Every notification for the coordinator Session, in wire order. */
  notifications: HarnessNotification[]
}

/** Re-exported content-block alias so SDK callers need no extra import. */
export type { ContentBlock }
