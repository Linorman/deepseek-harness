/** Typed failures raised by the authoritative local Team Hub. @module @clocky/clocky-team-hub/error */

/** Stable failure codes owned by Team-journal and channel-WAL recovery. */
export type TeamHubErrorCode =
  | 'TEAM_JOURNAL_MALFORMED'
  | 'TEAM_CHANNEL_WAL_MALFORMED'
  | 'TEAM_CHECKPOINT_INVALID'

/**
 * Failure raised when the Hub cannot reconstruct or maintain one of its durable projections.
 */
export class TeamHubError extends Error {
  /** Stable failure classification. */
  readonly code: TeamHubErrorCode

  /**
   * @param message - Human-readable explanation of the rejected durable relation.
   * @param code - Stable failure classification.
   * @param options - Optional causal failure retained for diagnostics.
   */
  constructor(message: string, code: TeamHubErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TeamHubError'
    this.code = code
  }
}
