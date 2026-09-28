/** Accepted communication is owned by the run, independently of live sender residency. @module @clocky/clocky-simulation/outbox-types */
import type { ChannelId, EnvelopeId, ParticipantId, TeamId } from '@clocky/clocky-team'
import type { SimulationEntityBinding } from './writer-types.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationDecisionId, SimulationOperationId, SimulationOperationResult } from './business-types.ts'
import type { SimulationRunId } from './types.ts'

/** Exact target receipt retained for replay and dependent operations. */
export interface SimulationPostReceipt {
  readonly runId: SimulationRunId
  readonly teamId: TeamId
  readonly recipientId: ParticipantId
  /** Exact Envelope position in the channel WAL. */
  readonly sequence: number
  readonly operationId: SimulationOperationId
  readonly fingerprint: string
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
}
/** Immutable accepted message plus current permission to publish a new target record. */
export interface SimulationOutboundMessage {
  readonly runId: SimulationRunId
  readonly decisionId: SimulationDecisionId
  readonly operationId: SimulationOperationId
  readonly fingerprint: string
  readonly entityId: SimulationEntityId
  readonly sender: SimulationEntityBinding
  readonly recipient: SimulationEntityBinding
  readonly channelId: ChannelId
  readonly text: string
  /** False permits reconciliation of an existing receipt only, never new publication. */
  readonly publishAllowed: boolean
}
/** Definitive transport result; a thrown error means the target outcome is uncertain. */
export type SimulationPostOutcome =
  | { readonly status: 'applied'; readonly receipt: SimulationPostReceipt }
  | { readonly status: 'rejected' | 'blocked-authority'; readonly code: string }
/** Narrow Team posting implementation. It must atomically deduplicate operationId and reject changed fingerprints. */
export interface SimulationTeamTransport {
  /**
   * Return the same durable target receipt for retries, including response loss.
   * Recheck target policy before any new append; publishAllowed false only allows existing-result reconciliation.
   * @param message - Frozen accepted message and exact identities.
   * @returns authoritative receipt or definitive rejection.
   */
  post(message: SimulationOutboundMessage): Promise<SimulationPostOutcome>
}
/** One durable technical attempt; simulation time is stored separately in the run. */
export interface SimulationPostAttempt {
  readonly number: number
  readonly startedAt: number
  readonly outcome: 'in-flight' | 'uncertain' | 'applied' | 'rejected' | 'blocked-authority'
  readonly finishedAt?: number
  readonly detail?: string
}
/** Publication responsibility survives uncertainty and source-writer retirement. */
export interface SimulationOutbox {
  readonly ready: boolean
  readonly attempts: readonly SimulationPostAttempt[]
  readonly budgetStart: number
  readonly nextAttemptAt?: number
  readonly receipt?: SimulationPostReceipt
  readonly taskReceipt?: import('./task-outbox.ts').SimulationTaskReceipt
}
/** One dispatch step may finish, wait for backoff, or require explicit unknown-outcome recovery. */
export type SimulationDispatchResult =
  | { readonly status: 'settled'; readonly result: SimulationOperationResult }
  | { readonly status: 'retry'; readonly nextAttemptAt: number }
  | { readonly status: 'outcome-unknown' }
