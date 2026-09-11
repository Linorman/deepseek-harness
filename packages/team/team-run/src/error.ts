/** Typed failures raised by the local product Team-run owner. @module @clocky/clocky-team-run/error */

/** Machine-routable Team-run failure code. */
export type TeamRunErrorCode =
  | 'TEAM_RUN_MODEL_REQUIRED'
  | 'TEAM_RUN_NOT_FOUND'
  | 'TEAM_RUN_FINAL_INVALID'
  | 'TEAM_RUN_NOT_QUIESCENT'
  | 'TEAM_RUN_COORDINATOR_INVALID'
  | 'TEAM_RUN_WORKER_PRESET_REQUIRED'
  | 'TEAM_RUN_INVALID_WORKER_POOL'
  | 'TEAM_RUN_START_CONFLICT'
  | 'TEAM_RUN_WORKFLOW_INVALID'
  | 'TEAM_RUN_WORKFLOW_NOT_FOUND'
  | 'TEAM_RUN_DISPOSED'

/** Error raised when Team-run lifecycle ownership cannot honor a product operation. */
export class TeamRunError extends Error {
  /** Stable operation failure classification. */
  readonly code: TeamRunErrorCode

  /**
   * @param message - human-readable failure description.
   * @param code - stable operation failure classification.
   * @param options - optional retained cause.
   */
  constructor(message: string, code: TeamRunErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TeamRunError'
    this.code = code
  }
}
