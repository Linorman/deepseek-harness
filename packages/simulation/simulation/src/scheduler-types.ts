/** Event and wake projections retain responsibility across process death. @module @clocky/clocky-simulation/scheduler-types */
import type { z } from 'zod'
import type {
  simulationDriveRequestSchema, simulationEventActionSchema, simulationEventKeySchema,
  simulationEventPhaseSchema, simulationEventSlotSchema, simulationWakeRequestSchema,
} from './scheduler.ts'
import type { SimulationEventId } from './identities.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationDecisionId, SimulationOperationId } from './business-types.ts'

/** Durable event identity. */
export type { SimulationEventId } from './identities.ts'
/** Decimal schedule allocation counter. */
export type SimulationEventSlot = z.infer<typeof simulationEventSlotSchema>
/** Policy-ordered event phase. */
export type SimulationEventPhase = z.infer<typeof simulationEventPhaseSchema>
/** Exact stable scheduled ordering. */
export type SimulationEventKey = z.infer<typeof simulationEventKeySchema>
/** Work retained by a scheduled event. */
export type SimulationEventAction = z.infer<typeof simulationEventActionSchema>
/** Explicit administrative wake command. */
export type SimulationWakeRequest = z.infer<typeof simulationWakeRequestSchema>
/** Bounded drive selection. */
export type SimulationDriveRequest = z.infer<typeof simulationDriveRequestSchema>
/** A queued event remains auditable after consumption or cancellation. */
export interface SimulationScheduledEvent {
  readonly id: SimulationEventId
  readonly key: SimulationEventKey
  readonly action: SimulationEventAction
  readonly status: 'pending' | 'consumed' | 'cancelled'
  readonly sourceOperationId?: SimulationOperationId
  readonly settledAt?: number
  readonly cancellation?: string
}
/** Consumption of a wake records responsibility before any Agent is asked to infer. */
export interface SimulationWake {
  readonly eventId: SimulationEventId
  readonly entityId: SimulationEntityId
  readonly reason: string
  readonly status: 'pending' | 'claimed' | 'completed' | 'cancelled'
  readonly cancellation?: string
  readonly decisionId?: SimulationDecisionId
}
/** A drive call never hides why progression stopped. */
export interface SimulationDriveResult {
  readonly steps: number
  readonly reason: 'until' | 'work-limit' | 'decision-required' | 'dispatch-required' | 'delivery-required' | 'paused' | 'stalled'
  readonly operationId?: SimulationOperationId
  readonly revision: number
}
/** Recorded scheduler stop requiring explicit intervention. */
export type SimulationStall = {
  readonly code: 'SIM_EXTERNAL_ADJUDICATION_BLOCKED'
  readonly eventId: SimulationEventId
  readonly reason: import('./world-external-mediated-types.ts').SimulationExternalAdjudicatedEventState['blocks'][number]['code']
  readonly recovery: 'inspect-original-duty-and-explicitly-resume'
} | {
  readonly code: 'SIM_WORLD_SUBMISSION_BLOCKED'
  readonly decisionId: SimulationDecisionId
  readonly recovery: 'inspect-original-submission-and-create-new-scenario'
} | {
  readonly code: 'SIM_ACTIVATION_HISTORY_LIMIT'
  readonly entityId: SimulationEntityId
  readonly recovery: 'reconcile-startup-and-create-new-scenario'
} | {
  readonly code: 'SIM_COMPACTION_MODEL_POOL_CAPACITY'
  readonly entityId: SimulationEntityId
  readonly compactionId: import('./tokens.ts').SimulationCompactionTokenRequest['compactionId']
  readonly recovery: 'release-capacity-and-explicitly-resume'
} | {
  readonly code: 'SIM_MODEL_POOL_CAPACITY'
  readonly decisionId: SimulationDecisionId
  readonly recovery: 'release-capacity-and-explicitly-resume'
} | {
  readonly code: 'SIM_QUEUE_CAPACITY'
  readonly capacity: import('./capacity.ts').SimulationCapacityKind
  readonly used: number
  readonly limit: number
  readonly requested: number
  readonly recovery: 'free-or-extend-capacity-and-resume'
} | {
  readonly code: 'SIM_TOKEN_RESERVATION_EXCEEDED'
  readonly reservationId: import('./tokens.ts').SimulationTokenReservationId
  readonly recovery: 'acknowledge-overrun-and-cover-usage'
} | {
  readonly code: 'SIM_MESSAGE_SUBMISSION_BLOCKED'
  readonly decisionId: SimulationDecisionId
  readonly recovery: 'inspect-message-rejection-and-correct-original-input'
} | {
  readonly code: 'SIM_CONTEXT_INTEGRITY' | 'SIM_DECISION_TIMEOUT'
  readonly decisionId: SimulationDecisionId
  readonly recovery: 'inspect-original-decision-before-explicit-resume'
} | {
  readonly code: 'SIM_REQUEST_BUDGET_EXCEEDED'
  readonly decisionId: SimulationDecisionId
  readonly recovery: 'compact-context-or-create-run-with-larger-request-budget'
} | {
  readonly code: 'SIM_BUDGET_LIMIT'
  readonly budget: import('./budget.ts').SimulationBudgetKind
  readonly interval: import('./types.ts').SimTime
  readonly used: number
  readonly limit: number
  readonly requested: number
  readonly recovery: 'extend-budget-and-resume'
} | {
  readonly code: 'SIM_CONFLICT_RETRY_LIMIT'
  readonly operationId: SimulationOperationId
  readonly rootDecisionId: SimulationDecisionId
  readonly attempt: number
  readonly recovery: 'acknowledge-conflict-and-resume'
} | {
  readonly code: 'SIM_DELIVERY_FAILED'
  readonly operationId: SimulationOperationId
  readonly recovery: 'reconcile-recipient-responsibility'
} | {
  readonly code: 'SIM_MICROSTEP_LIMIT'
  readonly eventId: SimulationEventId
  readonly recovery: 'cancel-event-and-resume'
} | {
  readonly code: 'SIM_OUTBOX_OUTCOME_UNKNOWN'
  readonly operationId: SimulationOperationId
  readonly recovery: 'authorize-idempotent-retry-and-resume'
} | {
  readonly code: 'SIM_CONTEXT_REQUIRED_ITEM_OVERFLOW'
  readonly decisionId: SimulationDecisionId
  readonly requiredBytes: number
  readonly maxBytes: number
  readonly recovery: 'cancel-decision-adjust-budget-and-resume'
}
