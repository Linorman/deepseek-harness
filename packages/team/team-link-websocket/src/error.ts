/** Typed failures raised by the WebSocket Team Link provider. @module @clocky/clocky-team-link-websocket/error */

import { TeamLinkConnectionError } from '@clocky/clocky-team-link'

/** Stable machine-routable WebSocket Team Link failure code. */
export type TeamLinkWebSocketErrorCode =
  | 'TEAM_LINK_WEBSOCKET_ABORTED'
  | 'TEAM_LINK_WEBSOCKET_CAPABILITY_MISSING'
  | 'TEAM_LINK_WEBSOCKET_CONFIGURATION_INVALID'
  | 'TEAM_LINK_WEBSOCKET_PROVIDER_CLOSED'
  | 'TEAM_LINK_WEBSOCKET_CONNECT_TIMEOUT'
  | 'TEAM_LINK_WEBSOCKET_RESPONSE_TIMEOUT'
  | 'TEAM_LINK_WEBSOCKET_CONNECT_FAILED'
  | 'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH'
  | 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME'
  | 'TEAM_LINK_WEBSOCKET_FRAME_TOO_LARGE'
  | 'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME'
  | 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME'
  | 'TEAM_LINK_WEBSOCKET_REMOTE_REJECTED'
  | 'TEAM_LINK_WEBSOCKET_UNAUTHORIZED'
  | 'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT'
  | 'TEAM_LINK_WEBSOCKET_REQUEST_LIMIT'
  | 'TEAM_LINK_WEBSOCKET_NOTIFICATION_LIMIT'
  | 'TEAM_LINK_WEBSOCKET_INVALID_REQUEST'
  | 'TEAM_LINK_WEBSOCKET_TRANSPORT_CLOSED'
  | 'TEAM_LINK_WEBSOCKET_TRANSPORT_FAILED'
  | 'TEAM_LINK_WEBSOCKET_CLOSED'

/** Error raised when the WebSocket Team Link provider cannot honor its contract. */
export class TeamLinkWebSocketError extends TeamLinkConnectionError {
  /**
   * @param message - Human-readable failure reason without capability material.
   * @param code - Stable machine-routable failure classification.
   * @param options - Optional diagnostic cause.
   */
  constructor(message: string, readonly code: TeamLinkWebSocketErrorCode, options?: ErrorOptions) {
    super(message, ![
      'TEAM_LINK_WEBSOCKET_CAPABILITY_MISSING', 'TEAM_LINK_WEBSOCKET_CONFIGURATION_INVALID',
      'TEAM_LINK_WEBSOCKET_BINDING_MISMATCH', 'TEAM_LINK_WEBSOCKET_MALFORMED_FRAME',
      'TEAM_LINK_WEBSOCKET_UNEXPECTED_FRAME', 'TEAM_LINK_WEBSOCKET_OUT_OF_ORDER_FRAME',
      'TEAM_LINK_WEBSOCKET_MALFORMED_RESULT', 'TEAM_LINK_WEBSOCKET_UNAUTHORIZED',
    ].includes(code), options)
    this.name = 'TeamLinkWebSocketError'
  }
}
