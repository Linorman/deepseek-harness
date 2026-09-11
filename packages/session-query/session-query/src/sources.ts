/** Shared immutable-header checks for logical session source observers. */

import type { SessionHeader } from '@clocky/clocky-session'
import { SessionQueryError } from './config.ts'

/**
 * Reject incompatible observations of one logical session source.
 * @param a - first live, listed, or loaded header observation.
 * @param b - second header observation expected to identify the same source.
 */
export function assertSessionHeadersCompatible(a: SessionHeader, b: SessionHeader): void {
  if (
    a.version !== b.version
    || a.id !== b.id
    || a.createdAt !== b.createdAt
    || a.cwd !== b.cwd
    || a.teamId !== b.teamId
    || a.participantId !== b.participantId
    || a.parentSession !== b.parentSession
    || a.seedLength !== b.seedLength
    || a.agentPreset !== b.agentPreset
  ) {
    throw new SessionQueryError(
      `session source headers conflict for session "${a.id}"`,
      'SESSION_QUERY_SOURCE_CONFLICT',
    )
  }
}
