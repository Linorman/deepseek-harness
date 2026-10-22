/** Durable identities and outcomes for explicit run management. @module @clocky/clocky-simulation/management */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'
import { simulationTokenRecoverySchema } from './tokens.ts'

/** Stable caller-selected management request identity. */
export const simulationManagementIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationManagementId'>)
/** Pause/resume scheduling; this does not claim cross-owner checkpoint quiescence. */
export const simulationPhaseManagementRequestSchema = z.strictObject({
  id: simulationManagementIdSchema, phase: z.enum(['paused', 'running']),
  tokenRecovery: simulationTokenRecoverySchema.optional(),
}).refine(value => value.tokenRecovery === undefined || value.phase === 'paused', 'Token acknowledgement must remain paused')
/** Stable management request identity. */
export type SimulationManagementId = z.infer<typeof simulationManagementIdSchema>
/** Explicit phase request retried by its immutable id and payload. */
export type SimulationPhaseManagementRequest = z.infer<typeof simulationPhaseManagementRequestSchema>
/** Pending work survives interruption; terminal results remain historical even after later phase changes. */
export type SimulationManagementOperation = {
  readonly request: SimulationPhaseManagementRequest
  readonly startedSequence: number
} & (
  | { readonly status: 'in-progress' }
  | { readonly status: 'completed'; readonly finishedSequence: number }
  | { readonly status: 'failed'; readonly finishedSequence: number; readonly error: string }
)
