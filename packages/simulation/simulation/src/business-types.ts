/** Durable decision, operation and resource projections. @module @clocky/clocky-simulation/business-types */
import type { SimulationOutbox } from './outbox-types.ts'
import type { z } from 'zod'
import type {
  simulationGrantIdSchema,
  simulationFulfillmentSchema, simulationOperationSchema, simulationProposalSchema, simulationQuantitySchema, simulationResourceIdSchema,
  simulationResourceSpecSchema, simulationTransactionSchema,
} from './business.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationWriterEpoch } from './writer-types.ts'
import type { simulationInteractionIdSchema, simulationCommitmentIdSchema } from './interaction.ts'
import type { SimulationEventId } from './scheduler-types.ts'
import type { SimTime } from './types.ts'
import type { SimulationDecisionId, SimulationDecisionSlot, SimulationOperationId } from './identities.ts'
export type { SimulationDecisionId, SimulationDecisionSlot, SimulationOperationId } from './identities.ts'

/** Run-owned resource identity. */
export type SimulationResourceId = z.infer<typeof simulationResourceIdSchema>
/** Run-owned resource permission identity. */
export type SimulationGrantId = z.infer<typeof simulationGrantIdSchema>
/** JSON-safe integer amount in a fixed resource unit. */
export type SimulationQuantity = z.infer<typeof simulationQuantitySchema>
/** Explicit bootstrap resource configuration. */
export type SimulationResourceSpec = z.infer<typeof simulationResourceSpecSchema>
/** Whole resource transaction with a fixed read set. */
export type SimulationTransaction = z.infer<typeof simulationTransactionSchema>
/** Staged business operation. */
export type SimulationOperationAction = z.infer<typeof simulationOperationSchema>
/** Staged operation and its causal prerequisites. */
export type SimulationProposal = z.infer<typeof simulationProposalSchema>
/** Resource state reconstructed from creation and transfer events. */
export interface SimulationResource extends SimulationResourceSpec { readonly revision: number }
/** A decision slot remains observable after acceptance or cancellation. */
export interface SimulationDecision {
  readonly deterministic?: import('./deterministic.ts').SimulationDeterministicDecision
  readonly ingressId?: import('./ingress.ts').SimulationIngressId
  readonly retry?: {
    readonly rootDecisionId: SimulationDecisionId
    readonly attempt: number
    readonly sourceOperationId: SimulationOperationId
  }
  /** Real-time budget; finishedAt records a durable proposal, not merely a returned model response. */
  readonly inference?: { readonly startedAt: number; readonly deadline: number; readonly finishedAt?: number; readonly expiredAt?: number }
  readonly windowId?: import('./window.ts').SimulationWindowId
  readonly submission?: readonly SimulationProposal[]
  readonly context?: import('./context.ts').SimulationContextPreparation
  readonly id: SimulationDecisionId
  readonly entityId: SimulationEntityId
  readonly epoch: SimulationWriterEpoch
  readonly slot: SimulationDecisionSlot
  readonly snapshotRevision: number
  readonly entityRevision: number
  readonly time: SimTime
  readonly status: 'open' | 'submitted' | 'accepted' | 'cancelled'
  readonly wakeId?: SimulationEventId
  readonly operationIds: readonly SimulationOperationId[]
  readonly fingerprint?: string
  readonly closedAt?: number
  readonly cancellation?: 'requested' | 'writer-revoked' | 'scheduled-wake-cancelled' | 'timeout'
}
/** An accepted operation remains owned by the run after its originating writer retires. */
export interface SimulationOperation {
  readonly conflictRetry?: { readonly kind: 'scheduled'; readonly eventId: SimulationEventId }
    | { readonly kind: 'exhausted'; readonly rootDecisionId: SimulationDecisionId; readonly attempt: number; readonly acknowledged: boolean }
  /** Definitive target transport failure; local input and business responsibility remain independent. */
  readonly deliveryFailure?: {
    readonly record: import('@clocky/clocky-team').ChannelDeliveryExpiredRecord
    readonly resolution?: { readonly kind: 'retained-input' | 'absent-input' | 'entity-terminated'; readonly sequence: number; readonly time: SimTime }
    readonly sequence: number
    readonly time: SimTime
  }
  /** Consumer-attested durable input and its persistent wake responsibility. */
  readonly delivery?: {
    readonly wakeId: SimulationEventId
    readonly sessionId: import('@clocky/clocky-session').SessionId
    readonly sequence: number
    readonly time: SimTime
    readonly receipt?: import('@clocky/clocky-team').ChannelReceiptRecord
  }
  readonly id: SimulationOperationId
  readonly decisionId: SimulationDecisionId
  readonly index: number
  readonly entityId: SimulationEntityId
  readonly action: SimulationOperationAction
  readonly dependencies: readonly SimulationOperationId[]
  readonly fingerprint: string
  readonly status: 'pending' | 'applied' | 'rejected' | 'blocked-authority' | 'blocked-dependency' | 'outcome-unknown'
  readonly outbox?: SimulationOutbox
  readonly result?: SimulationOperationResult
}
/** Durable terminal result; retrying the same operation returns this exact value. */
export interface SimulationOperationResult {
  readonly operationId: SimulationOperationId
  readonly status: Exclude<SimulationOperation['status'], 'pending' | 'outcome-unknown'>
  readonly sequence: number
  readonly time: SimTime
  readonly code: string
}
/** Exact one-use transfer grant, independently revocable and rechecked at execution. */
export interface SimulationResourceGrant {
  readonly id: SimulationGrantId
  readonly issuer: SimulationEntityId
  readonly grantee: SimulationEntityId
  readonly resources: readonly SimulationResourceId[]
  readonly transactionFingerprint: string
  readonly revision: number
  readonly phase: 'available' | 'consumed' | 'revoked'
  readonly operationId: SimulationOperationId
  readonly consumedBy?: SimulationOperationId
}

/** Stable interaction identity. */
export type SimulationInteractionId = z.infer<typeof simulationInteractionIdSchema>
/** Stable commitment identity. */
export type SimulationCommitmentId = z.infer<typeof simulationCommitmentIdSchema>
/** Frozen fulfillment policy selected by the requester. */
export type SimulationFulfillment = z.infer<typeof simulationFulfillmentSchema>
/** Reply and execution remain independent of Team transport acknowledgements. */
export interface SimulationInteraction {
  readonly id: SimulationInteractionId
  readonly requester: SimulationEntityId
  readonly assignee: SimulationEntityId
  readonly description: string
  readonly replyBy: SimTime | null
  readonly completeBy: SimTime | null
  readonly fulfillment: SimulationFulfillment
  readonly revision: number
  readonly reply: 'pending' | 'accepted' | 'rejected' | 'deferred'
  readonly execution: 'pending' | 'completed' | 'cancelled' | 'task'
  /** Task-linked execution is read from this exact Team revision, independently of commitment phase. */
  readonly task?: import('./task-evidence.ts').SimulationTaskEvidence
  readonly createdBy: SimulationOperationId
  readonly deferUntil?: SimTime
  readonly replyExpiredAt?: SimTime
  readonly reason?: string
  readonly commitmentId?: SimulationCommitmentId
  readonly resultOperationId?: SimulationOperationId
}
/** Objective fulfillment, cancellation and deadline breach remain separately auditable. */
export interface SimulationCommitment {
  readonly id: SimulationCommitmentId
  readonly interactionId: SimulationInteractionId
  readonly debtor: SimulationEntityId
  readonly creditor: SimulationEntityId
  readonly revision: number
  readonly phase: 'open' | 'fulfilled' | 'cancelled'
  readonly createdBy: SimulationOperationId
  readonly evidence: readonly SimulationOperationId[]
  /** Completed task revision accepted by the explicit task-completed policy. */
  readonly taskEvidence?: import('./task-evidence.ts').SimulationTaskEvidence
  readonly breachedAt?: SimTime
  readonly fulfilledAt?: SimTime
}
