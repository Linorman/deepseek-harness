/** Scenario-scoped administrative review metadata; task bodies and general Team authority are withheld. */
import type { TaskAttemptId, TeamId, TeamTaskId, TeamTaskPhase } from '@clocky/clocky-team/types'
import type { SimulationEntityId, SimulationOperationId } from '@clocky/clocky-simulation/identities'
import type { SimulationProductCommandId } from './administration-types.ts'
import type { SimulationProductCursor, SimulationProductRunId } from './types.ts'

/** Exact registered run and bounded canonical task observation. */
export interface SimulationProductTaskReviewListInput {
  readonly runId: SimulationProductRunId
  readonly limit?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
  readonly expectedRevision?: number | undefined
}
/** A hint is never authority; each submission rechecks current ownership, source, attempt and reviewer. */
export interface SimulationProductTaskReviewSummary {
  readonly operationId: SimulationOperationId
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly attemptId: TaskAttemptId
  readonly taskRevision: number
  readonly reviewerEntityId: SimulationEntityId
  readonly phase: TeamTaskPhase
  readonly attemptCount: number
  readonly maxAttempts: number
  /** Fixed scene effects only; arbitrary report text, result bodies and account balances remain private. */
  readonly evidence?: {
    readonly inventoryTransfer?: { readonly operationId: SimulationOperationId
      readonly status: 'applied'
      readonly quantity: '1' } | undefined
    readonly report: { readonly operationId: SimulationOperationId
      readonly delivery: 'persisted' }
  } | undefined
  readonly action: {
    readonly allowed: boolean
    readonly reason: 'ready' | 'review-disabled' | 'recovery-required'
    | 'maintenance-in-progress' | 'target-changed' | 'review-unavailable'
  }
}
/** Complete bounded task metadata window; no model input or Team write is performed. */
export interface SimulationProductTaskReviewPage {
  readonly runId: SimulationProductRunId
  readonly snapshotRevision: number
  readonly observedAt: number
  readonly items: readonly SimulationProductTaskReviewSummary[]
  readonly total: number
  readonly nextCursor?: SimulationProductCursor | undefined
}
/** One immutable original review intent; reviewer authority is derived from the installed scene. */
export interface SimulationProductTaskReviewResolveInput {
  readonly runId: SimulationProductRunId
  readonly commandId: SimulationProductCommandId
  readonly operationId: SimulationOperationId
  readonly attemptId: TaskAttemptId
  readonly expectedRevision: number
  readonly nextPhase: 'completed' | 'pending'
  readonly reason: string
}
