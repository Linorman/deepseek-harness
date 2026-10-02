/** Product-owned task cancellation selects only accepted Simulation task sources, never general Team authority. */
import type { TaskAttemptId, TeamId, TeamTaskId, TeamTaskPhase } from '@clocky/clocky-team/types'
import type { SimulationOperationId } from '@clocky/clocky-simulation/identities'
import type { SimulationProductCommandId } from './administration-types.ts'
import type { SimulationProductCursor, SimulationProductRunId } from './types.ts'

/** Exact run-owned task metadata window; no task instructions or original cancellation reason are exposed. */
export interface SimulationProductTasksInput {
  readonly runId: SimulationProductRunId
  readonly limit?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
  readonly expectedRevision?: number | undefined
}
/** Current canonical cancellation selection; hints are independently rechecked at native admission. */
export interface SimulationProductTaskControl {
  readonly operationId: SimulationOperationId
  readonly teamId: TeamId
  readonly taskId: TeamTaskId
  readonly taskRevision: number
  readonly phase: TeamTaskPhase
  readonly attemptCount: number
  readonly maxAttempts: number
  readonly expectedAttemptId: TaskAttemptId | null
  readonly cancellation?: { readonly requestedAt: number; readonly target: 'pending' | 'review' | 'attempt' | 'delegation' } | undefined
  readonly cancel: { readonly allowed: boolean
    readonly reason: 'ready' | 'terminal' | 'cancellation-pending' | 'recovery-required' | 'maintenance-in-progress' }
}
/** Bounded metadata fenced by both run history and canonical task observations. */
export interface SimulationProductTasksPage {
  readonly runId: SimulationProductRunId
  readonly snapshotRevision: number
  readonly observedAt: number
  readonly total: number
  readonly items: readonly SimulationProductTaskControl[]
  readonly nextCursor?: SimulationProductCursor | undefined
}
/** One original cancellation intent; null requires no active lease, not a wildcard for any attempt. */
export interface SimulationProductTaskCancelInput {
  readonly runId: SimulationProductRunId
  readonly commandId: SimulationProductCommandId
  readonly operationId: SimulationOperationId
  readonly expectedRevision: number
  readonly expectedAttemptId: TaskAttemptId | null
  readonly reason: string
}
