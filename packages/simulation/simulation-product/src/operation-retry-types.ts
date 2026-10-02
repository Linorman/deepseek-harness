/** Exact administrative outbox-retry authorization; no transport payload or native configuration is caller-selected. */
import type { SimulationOperationId } from '@clocky/clocky-simulation/identities'
import type { SimulationProductRunId } from './types.ts'
import type { SimulationProductCommandId } from './administration-types.ts'

/** One original permission to retry the same unknown external intent under its unchanged native bound. */
export interface SimulationProductOperationRetryInput {
  readonly runId: SimulationProductRunId
  readonly commandId: SimulationProductCommandId
  readonly operationId: SimulationOperationId
  /** Exact positive count of already recorded attempts, including the latest uncertain attempt. */
  readonly expectedAttemptCount: number
  readonly reason: string
}

/** Read-only capability hint; later writes revalidate every fence and owner constraint. */
export interface SimulationProductOperationRetryCapability {
  readonly allowed: boolean
  readonly reason: 'ready' | 'not-external' | 'outcome-known' | 'not-unknown' | 'not-due' | 'maintenance-in-progress'
    | 'recovery-required' | 'request-in-progress' | 'capacity-unavailable'
  readonly expectedAttemptCount: number
  readonly maxAttempts: number
}
