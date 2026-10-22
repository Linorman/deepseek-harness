/** Canonical cognition identities without lifecycle, Session-store or Cordis declarations. */
import type { TeamId, ParticipantId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'

/** One Entity's immutable canonical execution identity. */
export interface SimulationEntityBinding {
  readonly teamId: TeamId
  readonly participantId: ParticipantId
  readonly sessionId: SessionId
}
