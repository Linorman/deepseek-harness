/** Durable task attempt reservations before cross-owner assignment. @module @clocky/clocky-simulation/task-execution */
import { z } from 'zod'
import { SessionId } from '@clocky/clocky-session'
import { teamIdSchema, teamTaskIdSchema, participantIdSchema, activationIdSchema, activationReservationIdSchema,
  taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationRunIdSchema } from './schema.ts'
import { simulationOperationIdSchema, simulationDecisionIdSchema } from './business.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationWriterEpochSchema } from './writer.ts'
import { simulationPolicyRefSchema } from './deterministic.ts'
import { simulationTaskEvidenceSchema } from './task-evidence.ts'
import { simulationInteractionIdSchema } from './interaction.ts'
import { simulationTaskReportContinuationSchema } from './task-report-continuation.ts'
export { simulationTaskReportContinuationSchema, taskReportContinuationEvidence } from './task-report-continuation.ts'
export type { SimulationTaskReportContinuation } from './task-report-continuation.ts'
export { simulationTaskCancellationSchema } from './task-cancellation.ts'
export type { SimulationTaskCancellation, SimulationTaskCancellationRecord } from './task-cancellation.ts'

/** Immutable source identity and assignment selection for one task attempt. */
export const simulationTaskExecutionRequestSchema = z.strictObject({
  runId: simulationRunIdSchema, attemptId: taskAttemptIdSchema, operationId: simulationOperationIdSchema,
  interaction: z.strictObject({ interactionId: simulationInteractionIdSchema,
    expectedRevision: z.number().int().positive(), task: simulationTaskEvidenceSchema,
    execution: z.enum(['obligation', 'continuation']),
  }).optional(),
  reportContinuation: simulationTaskReportContinuationSchema.optional(),
  teamId: teamIdSchema, taskId: teamTaskIdSchema, taskRevision: z.number().int().positive(), ordinal: z.number().int().positive(),
  entityId: simulationEntityIdSchema, participantId: participantIdSchema,
  sessionId: z.string().min(1).transform(SessionId), activationId: activationIdSchema,
  reservationId: activationReservationIdSchema, epoch: simulationWriterEpochSchema, leaseDurationMs: z.number().int().positive(),
}).refine(value => value.reportContinuation === undefined || value.interaction === undefined,
  'Report continuation cannot borrow an interaction or commitment')
/** Assignment intent recorded before Hub IO; a retry preserves every field. */
export type SimulationTaskExecutionRequest = z.infer<typeof simulationTaskExecutionRequestSchema>
/** Canonical Team fact for the attempt that was reserved in this run. */
export const simulationTaskExecutionObservationSchema = z.strictObject({
  attemptId: taskAttemptIdSchema, task: simulationTaskEvidenceSchema,
})
/** Exact source observation, independent of any model request or world effect. */
export type SimulationTaskExecutionObservation = z.infer<typeof simulationTaskExecutionObservationSchema>
/** Physical controller quiescence selected by the trusted canonical Team reader. */
export const simulationTaskExecutionRetirementSchema = z.strictObject({
  attemptId: taskAttemptIdSchema, quiescedAt: z.number().int().nonnegative(), source: z.enum(['quiesced', 'fenced']),
  reason: z.string().min(1),
})
/** Retire unfinished responsibility after the writer epoch has been proven stopped. */
export type SimulationTaskExecutionRetirement = z.infer<typeof simulationTaskExecutionRetirementSchema>
/** Exact task instructions and predecessor selected before a decision or model input exists. */
export const simulationTaskDecisionRequestSchema = z.strictObject({
  attemptId: taskAttemptIdSchema, decisionId: simulationDecisionIdSchema,
  predecessor: simulationDecisionIdSchema.nullable(), reason: z.string().min(1), policy: simulationPolicyRefSchema.optional(),
  task: z.strictObject({ revision: z.number().int().positive(), subject: z.string().min(1), description: z.string().min(1) }),
})
/** One caller-selected decision within the same live task attempt. */
export type SimulationTaskDecisionRequest = z.infer<typeof simulationTaskDecisionRequestSchema>
/** Exact durable input identity after queued or deterministic-consumed Session input has been flushed. */
export const simulationTaskInputReceiptSchema = z.strictObject({
  attemptId: taskAttemptIdSchema, decisionId: simulationDecisionIdSchema, inputId: z.string().min(1),
})
/** Task input receipt; recording this fact never wakes an Agent. */
export type SimulationTaskInputReceipt = z.infer<typeof simulationTaskInputReceiptSchema>
/** Ordered task decision association, retained across response loss and epoch retirement. */
export interface SimulationTaskDecision {
  readonly request: SimulationTaskDecisionRequest
  readonly sequence: number
  readonly epoch: import('./writer-types.ts').SimulationWriterEpoch
  readonly input?: { readonly id: string; readonly sequence: number }
}
/** Retained responsibility and latest immutable Team revision for one attempt. */
export interface SimulationTaskExecution {
  readonly completionPolicy?: import('./deterministic.ts').SimulationPolicyRef
  readonly result?: import('./task-completion.ts').SimulationTaskResult
  readonly decisions?: readonly SimulationTaskDecision[]
  readonly retired?: { readonly sequence: number; readonly quiescedAt: number; readonly source: 'quiesced' | 'fenced'; readonly reason: string }
  readonly request: SimulationTaskExecutionRequest
  readonly reservedSequence: number
  readonly task?: import('./task-evidence.ts').SimulationTaskEvidence
}

/**
 * Resolve a retained task decision by its authoritative run-owned index.
 * @param state - Committed run projection.
 * @param id - Exact decision identity.
 * @returns execution and association, or absence for an ordinary Simulation decision.
 */
export function taskDecision(state: import('./types.ts').SimulationSnapshot,
  id: import('./business-types.ts').SimulationDecisionId): { readonly execution: SimulationTaskExecution; readonly decision: SimulationTaskDecision } | undefined {
  const entries = state.taskDecisionOwners ?? {}
  const owner = Object.hasOwn(entries, id) ? entries[id] : undefined
  if (owner === undefined) return undefined
  const execution = state.taskExecutions?.[owner.attemptId]
  const decision = execution?.decisions?.[owner.index]
  if (execution === undefined || decision?.request.decisionId !== id) throw new Error('Simulation task decision index lost its source')
  return { execution, decision }
}

/**
 * Materialize recorded task instructions and exact source identity for the required input section.
 * @param execution - Original retained attempt and writer identity.
 * @param decision - Recorded task instructions and source revision.
 * @returns a deterministic model-facing text block, reconstructed from the native log.
 */
export function taskDecisionBlock(execution: SimulationTaskExecution, decision: SimulationTaskDecision):
{ readonly type: 'text'; readonly text: string } {
  const request = execution.request
  return { type: 'text', text: JSON.stringify({ kind: 'simulation-task', runId: request.runId,
    teamId: request.teamId, taskId: request.taskId, attemptId: request.attemptId, ordinal: request.ordinal,
    decisionId: decision.request.decisionId, epoch: decision.epoch,
    ...request.reportContinuation === undefined ? {} : { reportContinuation: request.reportContinuation },
    ...request.interaction === undefined ? {} : { interactionId: request.interaction.interactionId,
      interactionRevision: request.interaction.expectedRevision }, ...decision.request.task }) }
}

/**
 * Resolve previously retired attempts owning the exact fulfilled transfer evidence for a continuation.
 * @param state - Authoritative world and commitment projection.
 * @param request - New task attempt retaining the original source, assignee and interaction.
 * @returns exact original fulfilled operation identities; absence denies continuation.
 */
export function taskContinuationEvidence(state: import('./types.ts').SimulationSnapshot, request: SimulationTaskExecutionRequest):
readonly import('./business-types.ts').SimulationOperationId[] | undefined {
  if (request.interaction?.execution !== 'continuation') return undefined
  const interaction = state.interactions[request.interaction.interactionId]
  const commitment = interaction?.commitmentId === undefined ? undefined : state.commitments[interaction.commitmentId]
  if (interaction?.reply !== 'accepted' || interaction.assignee !== request.entityId || interaction.fulfillment.kind !== 'transfer'
    || commitment?.phase !== 'fulfilled' || commitment.evidence.length === 0
    || interaction.task?.operationId !== request.operationId || interaction.task.teamId !== request.teamId
    || interaction.task.taskId !== request.taskId) return undefined
  const owned = Object.values(state.taskExecutions ?? {}).filter(value => value.retired !== undefined
    && value.request.runId === request.runId && value.request.operationId === request.operationId
    && value.request.teamId === request.teamId && value.request.taskId === request.taskId
    && value.request.entityId === request.entityId && value.request.participantId === request.participantId
    && value.request.sessionId === request.sessionId && value.request.ordinal < request.ordinal
    && BigInt(value.request.epoch) < BigInt(request.epoch)
    && value.request.interaction?.interactionId === request.interaction?.interactionId)
  if (!commitment.evidence.every(id => owned.some(value => value.decisions?.some((association) => {
    const decision = state.decisions[association.request.decisionId], operation = state.operations[id]
    return association.input !== undefined && decision?.status === 'accepted' && decision.epoch === value.request.epoch
      && decision.operationIds.includes(id) && operation?.result?.status === 'applied'
      && operation.entityId === request.entityId && operation.action.kind === 'resource/transfer'
      && operation.action.transaction.commitmentId === commitment.id
  })))) return undefined
  return commitment.evidence
}

/**
 * Check current obligation or source-backed continuation admission without reopening business commitments.
 * @param state - Authoritative world, task history and commitment projection.
 * @param request - Retained exact task/interaction selection; unassociated work has ordinary admission.
 * @returns whether the assignee has an open obligation or an evidenced continuation from retired original attempts.
 */
export function taskInteractionExecutable(state: import('./types.ts').SimulationSnapshot, request: SimulationTaskExecutionRequest): boolean {
  if (request.interaction === undefined) return true
  if (request.interaction.execution === 'continuation') return taskContinuationEvidence(state, request) !== undefined
  const interaction = state.interactions[request.interaction.interactionId]
  const commitment = interaction?.commitmentId === undefined ? undefined : state.commitments[interaction.commitmentId]
  return interaction?.reply === 'accepted' && interaction.assignee === request.entityId && commitment?.phase === 'open'
}
