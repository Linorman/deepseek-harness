/** Immutable observations of authoritative Team task revisions. @module @clocky/clocky-simulation/task-evidence */
import { z } from 'zod'
import { teamIdSchema, teamTaskIdSchema } from '@clocky/clocky-team'
import { simulationInteractionIdSchema } from './interaction.ts'

/** Exact Team task revision observed by the coordinator; task contents stay with Team. */
export const simulationTaskEvidenceSchema = z.strictObject({
  teamId: teamIdSchema, taskId: teamTaskIdSchema, revision: z.number().int().positive(),
  phase: z.enum(['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted']),
})
/** Task execution fact at one immutable source revision. */
export type SimulationTaskEvidence = z.infer<typeof simulationTaskEvidenceSchema>
/** A coordinator links one accepted interaction to one task and reconciles later revisions. */
export const simulationTaskReconcileRequestSchema = z.strictObject({
  interactionId: simulationInteractionIdSchema, expectedRevision: z.number().int().positive(), task: simulationTaskEvidenceSchema,
})
/** Durable task observation with an interaction revision fence. */
export type SimulationTaskReconcileRequest = z.infer<typeof simulationTaskReconcileRequestSchema>
