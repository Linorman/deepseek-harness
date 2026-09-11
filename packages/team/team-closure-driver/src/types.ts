/** Type-only provider contract for restart-safe Team closure drives. @module @clocky/clocky-team-closure-driver/types */

import type {
  ActivationId,
  ChannelId,
  ParticipantId,
  TeamId,
  TeamStallReason,
  TeamStateSnapshot,
  TeamSystemClosureDriverProof,
} from '@clocky/clocky-team'
import type { SessionId } from '@clocky/clocky-session'

/** Why the driver selected a Team for one coalesced recovery pass. */
export type TeamClosureDriveTrigger = 'startup' | 'team-event' | 'channel-event' | 'turn-end' | 'pulse' | 'manual'

/** Current coordinator observation that must be durably admitted before its caller reports failure. */
export type TeamClosureDriverTurnEndRequest = {
  /** Team selected by the Session provenance. */
  readonly teamId: TeamId
  /** Coordinator participant selected by the current activation binding. */
  readonly coordinatorId: ParticipantId
  /** Activation epoch that produced this turn. */
  readonly activationId: ActivationId
  /** Session that emitted the turn-end fact. */
  readonly sessionId: SessionId
  /** AgentRuntime provider that owns the activation epoch. */
  readonly provider: string
  /** Coordinator turn that ended. */
  readonly turn: number
  /** Canonical direct-v3 final channel owned by the current Team consumer. */
  readonly finalChannelId?: ChannelId | undefined
  /** Human recipient whose durable receipt qualifies that final. */
  readonly humanId?: ParticipantId | undefined
  /** Exact durable reason retained by the resulting Team lifecycle fact. */
  readonly reason: TeamStallReason
  /** Whether the turn ended without a final or with a structured failure. */
  readonly outcome: 'missing-final' | 'failure'
}

/** Current observer request for one frozen Team budget stall. */
export interface TeamClosureDriverBudgetStallRequest {
  /** Team whose budget observation is being admitted. */
  readonly teamId: TeamId
  /** Exact reason computed from the frozen Team budget and current usage. */
  readonly reason: TeamStallReason
}

/** One backend invocation over a detached current Team projection. */
export interface TeamClosureDriveRequest {
  /** Immutable Team state used to select at most one next idempotent cleanup action. */
  readonly state: TeamStateSnapshot
  /** Every event or discovery source coalesced into this pass. */
  readonly triggers: readonly TeamClosureDriveTrigger[]
  /** Core Team proof valid only while the source-owned recovery pass remains pending. */
  readonly actor: TeamSystemClosureDriverProof
  /** Aborts when the driver begins disposal. */
  readonly signal: AbortSignal
}

/** Provider bridge that maps one bounded driver pass to Hub-owned closure operations. */
export interface TeamClosureDriveBackend {
  /** Stable registry identity selected by deployment configuration. */
  readonly name: string
  /** Perform only the next idempotent closure-recovery action for this Team. */
  drive(request: TeamClosureDriveRequest): Promise<void>
}

/** Detached identity of one registered closure-drive backend. */
export interface TeamClosureDriveBackendRef {
  /** Stable backend registry identity. */
  readonly name: string
}

/** Optional Team restriction for one explicit drive. */
export interface TeamClosureDriverDriveRequest {
  /** Omit to scan the next bounded page sequence of every discovered Team. */
  readonly teamId?: TeamId
}
