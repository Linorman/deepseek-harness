/** Reconcile task facts without treating execution as delivery evidence. @module @clocky/clocky-simulation-local/task-evidence */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationTaskReconcileRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationTaskEvidence } from '@clocky/clocky-simulation'

/** Durable source observation and interaction revision fence. */
export const taskRecordSchema = z.strictObject({ kind: z.literal('task/reconciled'), request: simulationTaskReconcileRequestSchema })
/** Validated task reconciliation record. */
export type TaskRecord = z.infer<typeof taskRecordSchema>
/**
 * Verify task provenance against the accepted creation operation and immutable target receipt.
 * @param state - Current durable run projection.
 * @param task - Exact source task observation.
 */
function assertTaskOrigin(state: SimulationSnapshot, task: SimulationTaskEvidence): void {
  const operation = Object.hasOwn(state.operations, task.operationId) ? state.operations[task.operationId] : undefined
  const receipt = operation?.outbox?.taskReceipt
  if (operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied' || receipt === undefined
    || receipt.operationId !== task.operationId || receipt.fingerprint !== operation.fingerprint
    || receipt.teamId !== task.teamId || receipt.taskId !== task.taskId
    || state.decisions[operation.decisionId]?.status !== 'accepted') {
    throw new Error('Simulation task has no matching accepted creation receipt')
  }
}

/**
 * Apply a newer immutable Team revision, preserving delivery and creditor-acceptance requirements.
 * @param state - Current run facts.
 * @param record - Task fact read by the trusted coordinator.
 * @returns task-linked execution and, only for task-completed policy, fulfilled commitment.
 */
export function foldTaskEvidence(state: SimulationSnapshot, record: TaskRecord): SimulationSnapshot {
  if (state.activeWindowId !== undefined) throw new Error('Simulation task reconciliation requires closed decision windows')
  const { interactionId, expectedRevision, task } = record.request
  assertTaskOrigin(state, task)
  const request = state.interactions[interactionId]
  const obligation = request?.commitmentId === undefined ? undefined : state.commitments[request.commitmentId]
  if (request === undefined || request.reply !== 'accepted' || obligation === undefined) {
    throw new Error('Simulation task requires an accepted interaction')
  }
  if (record.request.requireOpenCommitment === true && obligation.phase !== 'open') {
    throw new Error('Simulation task reconciliation requires its open commitment')
  }
  if (request.task !== undefined && (request.task.teamId !== task.teamId || request.task.taskId !== task.taskId
    || request.task.operationId !== task.operationId)) {
    throw new Error('Simulation task linkage cannot change its authoritative identity')
  }
  if (task.executor !== undefined && state.entities[request.assignee]?.binding?.participantId !== task.executor.participantId) {
    throw new Error('Simulation task attempt belongs to another executor')
  }
  if (request.task?.revision === task.revision) {
    if (!isDeepStrictEqual(request.task, task)) throw new Error('Simulation task revision changed its evidence')
    return state
  }
  if (request.revision !== expectedRevision || request.task !== undefined && task.revision < request.task.revision) {
    throw new Error('Simulation task reconciliation revision conflict')
  }
  if (state.entities[request.requester]?.binding?.teamId !== task.teamId
    || state.entities[request.assignee]?.binding?.teamId !== task.teamId) throw new Error('Simulation task belongs to another Team')
  if (request.task === undefined && (request.execution !== 'pending' || obligation.phase !== 'open')) {
    throw new Error('Simulation task cannot replace completed or cancelled local execution')
  }
  const fulfilled = request.fulfillment.kind === 'task-completed' && task.phase === 'completed' && obligation.phase === 'open'
  return { ...state, interactions: { ...state.interactions, [request.id]: { ...request, task,
    execution: 'task', revision: request.revision + 1 } },
  ...fulfilled ? { commitments: { ...state.commitments, [obligation.id]: { ...obligation, phase: 'fulfilled',
    revision: obligation.revision + 1, fulfilledAt: state.time, taskEvidence: task } } } : {} }
}

/**
 * Assert that task-derived execution and fulfillment retain their exact source relationships.
 * @param state - Rebuilt run projection.
 */
export function assertTaskEvidence(state: SimulationSnapshot): void {
  for (const interaction of Object.values(state.interactions)) {
    if ((interaction.execution === 'task') !== (interaction.task !== undefined)) {
      throw new Error('Simulation task execution lost its source revision')
    }
    const task = interaction.task
    if (task === undefined) continue
    assertTaskOrigin(state, task)
    if (task.executor !== undefined && state.entities[interaction.assignee]?.binding?.participantId !== task.executor.participantId) {
      throw new Error('Simulation task linkage lost its exact executor')
    }
    if (state.entities[interaction.assignee]?.binding?.teamId !== task.teamId
      || state.entities[interaction.requester]?.binding?.teamId !== task.teamId || interaction.reply !== 'accepted') {
      throw new Error('Simulation task linkage lost its accepted Team scope')
    }
    const obligation = interaction.commitmentId === undefined ? undefined : state.commitments[interaction.commitmentId]
    if (obligation === undefined) throw new Error('Simulation task linkage lost its commitment')
    const source = obligation.taskEvidence
    if (source !== undefined && (interaction.fulfillment.kind !== 'task-completed' || obligation.phase !== 'fulfilled'
      || source.phase !== 'completed' || source.operationId !== task.operationId
      || source.executor?.outcome !== 'completed'
      || source.executor.participantId !== state.entities[interaction.assignee]?.binding?.participantId
      || source.taskId !== task.taskId || source.teamId !== task.teamId || source.revision > task.revision)) {
      throw new Error('Simulation task fulfillment lost its completed source revision')
    }
    if (interaction.fulfillment.kind === 'task-completed' && obligation.phase === 'fulfilled' && source === undefined) {
      throw new Error('Simulation task fulfillment has no completed evidence')
    }
  }
}
