/** Native source-backed report continuation admits acknowledgement, never a replacement business effect. */
import { z } from 'zod'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
import { simulationOperationIdSchema } from './business.ts'
import type { SimulationTaskExecutionRequest } from './task-execution.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationOperation } from './business-types.ts'

/** Exact retired report source and original frozen context fingerprint, retained before new assignment. */
export const simulationTaskReportContinuationSchema = z.strictObject({
  attemptId: taskAttemptIdSchema,
  operationId: simulationOperationIdSchema,
  contextFingerprint: z.string().min(1),
})
/** A new task attempt may consume only this exact owned persisted report after physical retirement. */
export type SimulationTaskReportContinuation = z.infer<typeof simulationTaskReportContinuationSchema>

/**
 * Verify original task, actor, Session, frozen input, accepted report and canonical recipient persistence.
 * @param state - Authoritative run history, including physically retired attempts and delivery receipts.
 * @param request - New exact assignment with its source-backed continuation selector.
 * @returns original persisted report, or undefined for missing, altered, foreign or unretired evidence.
 */
export function taskReportContinuationEvidence(state: SimulationSnapshot,
  request: SimulationTaskExecutionRequest & { readonly reportContinuation?: SimulationTaskReportContinuation | undefined }):
SimulationOperation | undefined {
  const claim = request.reportContinuation
  if (claim === undefined || request.interaction !== undefined || request.runId !== state.spec.runId) return undefined
  const previous = state.taskExecutions?.[claim.attemptId]
  const reservedAt = state.taskExecutions?.[request.attemptId]?.reservedSequence ?? state.revision + 1
  const predecessor = Object.values(state.taskExecutions ?? {}).filter(value => value.reservedSequence < reservedAt
    && value.request.runId === request.runId && value.request.operationId === request.operationId
    && value.request.teamId === request.teamId && value.request.taskId === request.taskId)
    .sort((left, right) => right.reservedSequence - left.reservedSequence)[0]
  if (predecessor?.retired === undefined || predecessor.retired.sequence >= reservedAt
    || predecessor.request.attemptId !== claim.attemptId
      && JSON.stringify(predecessor.request.reportContinuation) !== JSON.stringify(claim)) return undefined
  if (previous?.retired === undefined || previous.request.interaction !== undefined
    || previous.request.runId !== request.runId || previous.request.operationId !== request.operationId
    || previous.request.teamId !== request.teamId || previous.request.taskId !== request.taskId
    || previous.request.entityId !== request.entityId || previous.request.participantId !== request.participantId
    || previous.request.sessionId !== request.sessionId || previous.request.ordinal >= request.ordinal
    || BigInt(previous.request.epoch) >= BigInt(request.epoch)) return undefined
  const report = state.operations[claim.operationId]
  const association = previous.decisions?.find(value => value.request.decisionId === report?.decisionId)
  const decision = association === undefined ? undefined : state.decisions[association.request.decisionId]
  const proposals = decision?.deterministic?.proposals ?? decision?.submission
  if (association?.input === undefined || decision?.status !== 'accepted' || decision.context?.status !== 'prepared'
    || decision.context.fingerprint !== claim.contextFingerprint || association.input.id !== decision.context.view.inputId
    || decision.entityId !== request.entityId || decision.epoch !== previous.request.epoch
    || decision.operationIds.length !== 1 || decision.operationIds[0] !== claim.operationId
    || report?.action.kind !== 'communication/post'
    || proposals !== undefined && (proposals.length !== 1 || JSON.stringify(proposals[0]?.action) !== JSON.stringify(report.action))
    || report.entityId !== request.entityId || report.result?.status !== 'applied'
    || report.deliveryFailure !== undefined) return undefined
  const recipient = state.entities[report.action.recipient]?.binding
  const published = report.outbox?.receipt, delivered = report.delivery?.receipt
  if (recipient?.teamId !== request.teamId || published?.runId !== state.spec.runId
    || published.operationId !== report.id || published.teamId !== request.teamId
    || published.channelId !== report.action.channelId || published.recipientId !== recipient.participantId
    || delivered?.participantId !== recipient.participantId || delivered.envelopeId !== published.envelopeId
    || report.delivery?.sessionId !== recipient.sessionId) return undefined
  return report
}
