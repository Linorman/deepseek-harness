/** Typed errors raised by the Team Link provider registry. @module @clocky/clocky-team-link/error */

/** Stable machine-routable Team Link registry failure code. */
export type TeamLinkErrorCode =
  | 'TEAM_LINK_PROVIDER_INVALID'
  | 'TEAM_LINK_PROVIDER_DUPLICATE'
  | 'TEAM_LINK_PROVIDER_NOT_FOUND'
  | 'TEAM_LINK_CONNECTION_MISMATCH'
  | 'TEAM_LINK_ENROLLMENT_PROVIDER_INVALID'
  | 'TEAM_LINK_ENROLLMENT_PROVIDER_DUPLICATE'
  | 'TEAM_LINK_ENROLLMENT_PROVIDER_NOT_FOUND'
  | 'TEAM_LINK_ENROLLMENT_MISMATCH'
  | 'TEAM_LINK_BOUND_LINK_BORROWER_DUPLICATE'
  | 'TEAM_LINK_BOUND_LINK_UNAVAILABLE'

/** Provider-owned connection failure classification consumed without importing a transport implementation. */
export class TeamLinkConnectionError extends Error {
  /**
   * @param message - diagnostic without credentials.
   * @param retryable - whether reconnecting the same provider and binding can recover the failure.
   * @param options - optional underlying error.
   */
  constructor(message: string, readonly retryable: boolean, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TeamLinkConnectionError'
  }
}

/** Error raised when the Team Link registry cannot honor its public contract. */
export class TeamLinkError extends TeamLinkConnectionError {
  /** Stable machine-routable error classification. */
  readonly code: TeamLinkErrorCode

  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable error classification.
   * @param options - optional cause retained for diagnostics.
   */
  constructor(message: string, code: TeamLinkErrorCode, options?: ErrorOptions) {
    super(message, code === 'TEAM_LINK_PROVIDER_NOT_FOUND' || code === 'TEAM_LINK_BOUND_LINK_UNAVAILABLE', options)
    this.name = 'TeamLinkError'
    this.code = code
  }
}
