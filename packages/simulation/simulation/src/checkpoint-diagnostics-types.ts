/** Public checkpoint failure facts carry canonical identities, never storage paths or private error text. */
import type { TeamId, ChannelId, ParticipantId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'
import type { SimulationEntityId, SimulationCheckpointId } from './identities.ts'

/** The owner or retained reference at which collection or recovery stopped. */
export type SimulationCheckpointSubject = { readonly kind: 'run' }
  | { readonly kind: 'checkpoint'; readonly checkpointId: SimulationCheckpointId }
  | { readonly kind: 'team'; readonly teamId: TeamId }
  | { readonly kind: 'channel'; readonly teamId: TeamId; readonly channelId: ChannelId }
  | { readonly kind: 'session'; readonly sessionId: SessionId; readonly teamId: TeamId; readonly participantId: ParticipantId }
  | { readonly kind: 'entity'; readonly entityId: SimulationEntityId }

/** Fixed safe categories describe the failed rule rather than provider messages. */
export interface SimulationCheckpointDiagnostic {
  readonly stage: 'collect' | 'validate' | 'restore' | 'retire' | 'publish'
  readonly code: 'source-unavailable' | 'source-moved' | 'history-incomplete' | 'binding-mismatch' | 'owner-conflict'
    | 'owner-not-quiescent' | 'unsupported-ownership' | 'manifest-mismatch' | 'version-mismatch' | 'cancelled' | 'unavailable'
  readonly subject: SimulationCheckpointSubject
  /** Failed cleanup is independent of the primary validation failure. */
  readonly cleanup?: 'unconfirmed' | undefined
}
