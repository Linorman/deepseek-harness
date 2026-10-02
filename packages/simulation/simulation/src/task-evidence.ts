/** Immutable observations of authoritative Team task revisions. @module @clocky/clocky-simulation/task-evidence */
import { z } from 'zod'
import { teamIdSchema, teamTaskIdSchema, participantIdSchema, activationIdSchema, taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationInteractionIdSchema } from './interaction.ts'
import { simulationOperationIdSchema } from './business.ts'

/** Exact executor and attempt retained by the canonical Team owner. */
export const simulationTaskExecutorSchema = z.strictObject({
  participantId: participantIdSchema, activationId: activationIdSchema.optional(),
  attemptId: taskAttemptIdSchema, ordinal: z.number().int().positive(),
  outcome: z.enum(['released', 'lease-expired', 'failed', 'completed', 'cancelled']).optional(),
})
/** Task attempt attribution; omission of outcome denotes a current lease. */
export type SimulationTaskExecutor = z.infer<typeof simulationTaskExecutorSchema>

/** Exact Team task revision observed by the coordinator; task contents stay with Team. */
export const simulationTaskEvidenceSchema = z.strictObject({
  operationId: simulationOperationIdSchema, teamId: teamIdSchema, taskId: teamTaskIdSchema, revision: z.number().int().positive(),
  phase: z.enum(['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted']),
  executor: simulationTaskExecutorSchema.optional(),
}).refine(value => value.phase !== 'assigned' && value.phase !== 'running'
  || value.executor !== undefined && value.executor.outcome === undefined, 'Active tasks require the current attempt')
  .refine(value => value.phase !== 'review' && value.phase !== 'completed'
    || value.executor?.outcome === 'completed', 'Completed tasks require the completed attempt')
/** Task execution fact at one immutable source revision. */
export type SimulationTaskEvidence = z.infer<typeof simulationTaskEvidenceSchema>
/** A coordinator links one accepted interaction to one task and reconciles later revisions. */
export const simulationTaskReconcileRequestSchema = z.strictObject({
  interactionId: simulationInteractionIdSchema, expectedRevision: z.number().int().positive(), task: simulationTaskEvidenceSchema,
  requireOpenCommitment: z.literal(true).optional(),
})
/** Durable task observation with an interaction revision fence. */
export type SimulationTaskReconcileRequest = z.infer<typeof simulationTaskReconcileRequestSchema>
