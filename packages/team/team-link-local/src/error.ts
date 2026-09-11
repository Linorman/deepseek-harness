/** Typed errors raised by the local Team Link provider. @module @clocky/clocky-team-link-local/error */

/** Stable machine-routable local Team Link failure code. */
export type TeamLinkLocalErrorCode =
  | 'TEAM_LINK_LOCAL_ABORTED'
  | 'TEAM_LINK_LOCAL_PROVIDER_CLOSED'
  | 'TEAM_LINK_LOCAL_BINDING_MISMATCH'
  | 'TEAM_LINK_LOCAL_ACTIVATION_UNAVAILABLE'
  | 'TEAM_LINK_LOCAL_CHANNEL_TEAM_MISMATCH'
  | 'TEAM_LINK_LOCAL_INTERRUPT_DELIVERY_INVALID'
  | 'TEAM_LINK_LOCAL_CLOSED'
  | 'TEAM_LINK_LOCAL_FAILED'
  | 'TEAM_LINK_LOCAL_DISPOSAL_TIMEOUT'

/** Error raised when the local Team Link provider cannot honor its public contract. */
export class TeamLinkLocalError extends Error {
  /** Stable machine-routable error classification. */
  readonly code: TeamLinkLocalErrorCode

  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable error classification.
   * @param options - optional cause retained for diagnostics.
   */
  constructor(message: string, code: TeamLinkLocalErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TeamLinkLocalError'
    this.code = code
  }
}
