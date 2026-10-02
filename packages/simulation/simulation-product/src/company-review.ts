/** Canonical run-owned task review projection with no body or general Team grant disclosure. */
import { companyTaskTransfer, companyTaskReviewedCompletion } from './company-task-policies.ts'
import type { SimulationSnapshot, SimulationTaskExecution, SimulationEntityId } from '@clocky/clocky-simulation'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'
import type { SimulationProductTaskReviewSummary } from './review-types.ts'

/**
 * Validate immutable source and current completed-attempt/reviewer facts before projecting metadata.
 * @param state - Original run-owned operations and participant bindings.
 * @param execution - Exact retained native attempt selected by this scene.
 * @param task - Canonical Team observation, never a browser supplied task.
 * @returns safe current metadata; a changed or unsupported target remains visible with a refusal hint.
 */
export function companyReviewSummary(state: SimulationSnapshot, execution: SimulationTaskExecution,
  task: TeamTaskSnapshot): SimulationProductTaskReviewSummary {
  return taskReviewSummary(state, execution, task, 'buyer' as SimulationEntityId, companyReviewEvidence(state, execution))
}

/**
 * Project an exact native source and current canonical review with scene-provided verified evidence.
 * @param state - Original run-owned operations and actor bindings.
 * @param execution - Latest retained native attempt.
 * @param task - Canonical Team observation.
 * @param reviewerEntityId - Immutable installed scene route, never browser supplied.
 * @param evidence - Scene-owned completed-attempt evidence, omitted when verification refuses it.
 * @returns bounded metadata and action hint; the native review operation independently enforces authority.
 */
export function taskReviewSummary(state: SimulationSnapshot, execution: SimulationTaskExecution, task: TeamTaskSnapshot,
  reviewerEntityId: SimulationEntityId, evidence: SimulationProductTaskReviewSummary['evidence']): SimulationProductTaskReviewSummary {
  const operation = state.operations[execution.request.operationId], receipt = operation?.outbox?.taskReceipt
  const creator = task.createCommand.creator
  if (!('kind' in creator) || creator.runId !== state.spec.runId || creator.operationId !== execution.request.operationId
    || operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied'
    || receipt?.teamId !== task.teamId || receipt.taskId !== task.id
    || task.teamId !== execution.request.teamId || task.id !== execution.request.taskId
    || creator.teamId !== task.teamId || creator.participantId !== state.entities[operation.entityId]?.binding?.participantId
    || task.createCommand.idempotencyKey !== JSON.stringify(['simulation-task', state.spec.runId, operation.id])
    || task.execution.kind !== 'participant') throw new Error('Company review lost its canonical task source')
  const reviewer = state.entities[reviewerEntityId]
  const attempt = task.attemptHistory.at(-1)
  const ready = task.phase === 'review' && task.cancellation === undefined
    && execution.result?.request.outcome.kind === 'completed' && execution.retired === undefined
    && attempt?.id === execution.request.attemptId && attempt.outcome.kind === 'completed'
    && attempt.ordinal === execution.request.ordinal && task.attemptCount === execution.request.ordinal
    && reviewer?.phase === 'active' && reviewer.binding?.teamId === task.teamId
    && task.reviewPolicy.kind === 'participant' && task.reviewPolicy.reviewerId === reviewer.binding.participantId
  const reason = !ready ? 'target-changed' : evidence === undefined ? 'review-unavailable' : 'ready'
  return { operationId: execution.request.operationId, teamId: task.teamId, taskId: task.id,
    attemptId: execution.request.attemptId, taskRevision: task.revision,
    reviewerEntityId, phase: task.phase,
    attemptCount: task.attemptCount, maxAttempts: task.maxAttempts,
    ...evidence === undefined ? {} : { evidence },
    action: { allowed: reason === 'ready', reason } }
}

/** Only the exact reviewed scene generation and this attempt's persisted report authorize administrative review. */
function companyReviewEvidence(state: SimulationSnapshot, execution: SimulationTaskExecution):
SimulationProductTaskReviewSummary['evidence'] {
  const selected = execution.result?.request, policy = execution.completionPolicy
  if (selected?.outcome.kind !== 'completed' || selected.attemptId !== execution.request.attemptId
    || selected.policy.id !== companyTaskReviewedCompletion.id || selected.policy.version !== companyTaskReviewedCompletion.version
    || policy?.id !== companyTaskReviewedCompletion.id || policy.version !== companyTaskReviewedCompletion.version
    || selected.operations.length !== 1 || execution.request.entityId !== 'supplier') return undefined
  const purchase = Object.values(state.interactions).find(value => value.id === 'purchase')
  if (purchase?.requester !== 'buyer' || purchase.assignee !== 'supplier' || purchase.commitmentId === undefined) return undefined
  const transfer = companyTaskTransfer(state, execution.request.operationId)
  if (transfer === undefined) return undefined
  const reportId = selected.operations[0]
  if (reportId === undefined) return undefined
  const report = state.operations[reportId]
  const ownDecision = execution.decisions?.find(value => value.request.decisionId === report?.decisionId)
  const decision = ownDecision === undefined ? undefined : state.decisions[ownDecision.request.decisionId]
  const buyer = state.entities['buyer' as import('@clocky/clocky-simulation').SimulationEntityId]?.binding
  const purchaseChannel = state.channelReservations?.['purchase' as import('@clocky/clocky-simulation').SimulationChannelKey]
  const outbox = report?.outbox?.receipt, delivered = report?.delivery?.receipt
  if (report?.action.kind !== 'communication/post' || report.entityId !== execution.request.entityId
    || report.action.recipient !== 'buyer' || report.result?.status !== 'applied' || decision?.status !== 'accepted'
    || !decision.operationIds.includes(report.id) || purchaseChannel?.confirmed !== true
    || report.action.channelId !== purchaseChannel.channelId || outbox?.channelId !== purchaseChannel.channelId
    || outbox.runId !== state.spec.runId
    || outbox.operationId !== report.id || outbox.teamId !== execution.request.teamId
    || outbox.recipientId !== buyer?.participantId || delivered?.participantId !== buyer.participantId
    || delivered.envelopeId !== outbox.envelopeId || report.delivery?.sessionId !== buyer.sessionId
    || report.deliveryFailure !== undefined) return undefined
  return { inventoryTransfer: { operationId: transfer.id, status: 'applied', quantity: '1' },
    report: { operationId: report.id, delivery: 'persisted' } }
}
