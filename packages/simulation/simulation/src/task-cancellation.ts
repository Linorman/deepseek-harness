/** Canonical task cancellation closes exact native task admission while accepted effects retain their identities. */
import { z } from 'zod'
import { teamIdSchema, teamTaskIdSchema, teamTaskCancellationSnapshotSchema } from '@clocky/clocky-team'
import { simulationOperationIdSchema } from './business.ts'

/** Original canonical cancellation intent recorded before actor cleanup; no replacement task or actor claim. */
export const simulationTaskCancellationSchema = z.strictObject({ operationId: simulationOperationIdSchema,
  teamId: teamIdSchema, taskId: teamTaskIdSchema, cancellation: teamTaskCancellationSnapshotSchema })
/** Run-owned reference to the exact Team cancellation and its original target. */
export type SimulationTaskCancellation = z.infer<typeof simulationTaskCancellationSchema>
/** Durable native admission fence, independent of whether physical actor cleanup has finished. */
export interface SimulationTaskCancellationRecord {
  readonly request: SimulationTaskCancellation
  readonly sequence: number
}
