/** Typed errors raised by the Team workspace provider registry. @module @clocky/clocky-team-workspace/error */
import type { TeamWorkspaceLoss } from '@clocky/clocky-team'

/** Exact provider loss observed during an operation, distinct from transient network failure. */
export class TeamWorkspaceLostError extends Error {
  /** Stable classification for provider-confirmed workspace loss. */
  readonly code = 'TEAM_WORKSPACE_LOST' as const
  /** @param loss - provider-confirmed immutable world and retained artifact facts. */
  constructor(readonly loss: TeamWorkspaceLoss) {
    super(`Workspace execution world is unavailable: ${loss.reason}`)
    this.name = 'TeamWorkspaceLostError'
  }
}

/** Stable machine-routable Team workspace registry failure code. */
export type TeamWorkspaceErrorCode =
  | 'TEAM_WORKSPACE_PROVIDER_INVALID'
  | 'TEAM_WORKSPACE_PROVIDER_DUPLICATE'
  | 'TEAM_WORKSPACE_MODE_DUPLICATE'
  | 'TEAM_WORKSPACE_MODE_UNAVAILABLE'
  | 'TEAM_WORKSPACE_ALLOCATION_MISMATCH'
  | 'TEAM_WORKSPACE_SOURCE_MISMATCH'

/** Error raised when the Team workspace registry cannot honor its public contract. */
export class TeamWorkspaceError extends Error {
  /** Stable machine-routable code carried by this workspace failure. */
  readonly code: TeamWorkspaceErrorCode

  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable error classification.
   * @param options - optional cause retained for diagnostics.
   */
  constructor(message: string, code: TeamWorkspaceErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = 'TeamWorkspaceError'
  }
}
