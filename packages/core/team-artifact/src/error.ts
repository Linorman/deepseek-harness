/** Errors raised by the Team artifact storage seam. @module @clocky/clocky-team-artifact/error */

/** Stable machine-routable Team artifact error codes. */
export type TeamArtifactErrorCode =
  | 'TEAM_ARTIFACT_PROVIDER_INVALID'
  | 'TEAM_ARTIFACT_PROVIDER_DUPLICATE'
  | 'TEAM_ARTIFACT_PROVIDER_NOT_FOUND'
  | 'TEAM_ARTIFACT_INVALID'
  | 'TEAM_ARTIFACT_NOT_FOUND'
  | 'TEAM_ARTIFACT_TOO_LARGE'
  | 'TEAM_ARTIFACT_COLLECTION_UNAVAILABLE'

/** Typed error raised when an artifact provider cannot honor its contract. */
export class TeamArtifactError extends Error {
  /** Stable machine-routable artifact error classification. */
  readonly code: TeamArtifactErrorCode
  /**
   * @param message - bounded human-readable artifact failure.
   * @param code - machine-routable artifact error code.
   * @param options - optional causal failure.
   */
  constructor(message: string, code: TeamArtifactErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TeamArtifactError'
    this.code = code
  }
}
