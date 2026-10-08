import { simulationPolicyRefSchema, simulationTaskResultRequestSchema, taskInteractionExecutable,
  taskContinuationEvidence, taskReportContinuationEvidence, simulationTaskCancellationSchema } from '@clocky/clocky-simulation'
import { taskAttemptIdSchema } from '@clocky/clocky-team'
/** Replay task reservations and exact canonical assignment facts. @module @clocky/clocky-simulation-local/task-execution */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationTaskDecisionRequestSchema, simulationTaskInputReceiptSchema, simulationTaskExecutionRequestSchema, simulationTaskExecutionObservationSchema, simulationTaskExecutionRetirementSchema } from '@clocky/clocky-simulation'
import { foldTaskEvidence } from './task-evidence.ts'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'

/** Durable attempt intent or canonical Team observation. */
export const taskExecutionRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('task/cancellation'), request: simulationTaskCancellationSchema }),
  z.strictObject({ kind: z.literal('task/execution-policy'), attemptId: taskAttemptIdSchema, policy: simulationPolicyRefSchema }),
  z.strictObject({ kind: z.literal('task/execution-result'), request: simulationTaskResultRequestSchema }),
  z.strictObject({ kind: z.literal('task/execution-decision'), request: simulationTaskDecisionRequestSchema }),
  z.strictObject({ kind: z.literal('task/execution-input'), receipt: simulationTaskInputReceiptSchema }),
  z.strictObject({ kind: z.literal('task/execution-reserved'), request: simulationTaskExecutionRequestSchema }),
  z.strictObject({ kind: z.literal('task/execution-retired'), retirement: simulationTaskExecutionRetirementSchema }),
  z.strictObject({ kind: z.literal('task/execution-observed'), observation: simulationTaskExecutionObservationSchema }),
])
/** Validated cross-owner attempt record. */
export type TaskExecutionRecord = z.infer<typeof taskExecutionRecordSchema>

/**
 * Commit an attempt identity before assignment or retain its exact Team revision afterwards.
 * @param state - Authoritative run projection.
 * @param record - Parsed durable reservation or observation.
 * @param sequence - Journal position at which the fact is retained.
 * @returns projection with the same immutable reservation and newer source evidence.
 */
export function foldTaskExecution(state: SimulationSnapshot, record: TaskExecutionRecord, sequence: number): SimulationSnapshot {
  const executions = state.taskExecutions ?? {}
  if (record.kind === 'task/cancellation') {
    const request = record.request, operation = state.operations[request.operationId]
    const receipt = operation?.outbox?.taskReceipt
    const creator = operation === undefined ? undefined : state.entities[operation.entityId]?.binding
    const target = request.cancellation.target
    const execution = target.kind === 'attempt' ? executions[target.attemptId] : undefined
    if (state.taskCancellations?.[request.operationId] !== undefined
      || operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied'
      || receipt?.teamId !== request.teamId || receipt.taskId !== request.taskId
      || creator?.participantId !== request.cancellation.requestedBy
      || target.kind === 'attempt' && (execution?.request.operationId !== request.operationId
        || execution.request.teamId !== request.teamId || execution.request.taskId !== request.taskId
        || execution.request.participantId !== target.participantId || execution.request.activationId !== target.activationId)) {
      throw new Error('Simulation task cancellation requires its exact accepted source and canonical target')
    }
    return { ...state, taskCancellations: { ...state.taskCancellations,
      [request.operationId]: { request, sequence } } }
  }
  if (record.kind === 'task/execution-reserved') {
    const request = record.request
    if (Object.hasOwn(executions, request.attemptId)) throw new Error('Simulation task attempt is already reserved')
    const operation = Object.hasOwn(state.operations, request.operationId) ? state.operations[request.operationId] : undefined
    const receipt = operation?.outbox?.taskReceipt
    const entity = state.entities[request.entityId]
    const writer = entity?.writer
    if (request.runId !== state.spec.runId || state.phase !== 'running' || state.activeWindowId !== undefined
      || state.taskCancellations?.[request.operationId] !== undefined
      || operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied'
      || receipt?.taskId !== request.taskId || receipt.teamId !== request.teamId
      || request.ordinal > operation.action.task.maxAttempts
      || entity?.phase !== 'active' || writer?.phase !== 'active' || writer.epoch !== request.epoch
      || writer.activationId !== request.activationId || writer.reservationId !== request.reservationId
      || entity.binding?.teamId !== request.teamId || entity.binding.participantId !== request.participantId
      || entity.binding.sessionId !== request.sessionId) {
      throw new Error('Simulation task reservation has no current accepted source and writer')
    }
    for (const value of Object.values(executions)) {
      if (value.request.teamId !== request.teamId || value.request.taskId !== request.taskId) continue
      if (value.request.interaction?.interactionId !== request.interaction?.interactionId) {
        throw new Error('Simulation task retry changed its original interaction association')
      }
      if (value.retired === undefined && value.task?.executor?.outcome === undefined) {
        throw new Error('Simulation task already retains an unresolved attempt')
      }
    }
    const predecessor = Object.values(executions).filter(value => value.request.teamId === request.teamId
      && value.request.taskId === request.taskId).sort((left, right) => right.reservedSequence - left.reservedSequence)[0]
    const retainedEffects = predecessor?.retired !== undefined && (predecessor.request.reportContinuation !== undefined
      || predecessor.decisions?.some(value => state.decisions[value.request.decisionId]?.status === 'accepted'
        && (state.decisions[value.request.decisionId]?.operationIds.length ?? 0) > 0))
    if (retainedEffects && request.reportContinuation === undefined && request.interaction?.execution !== 'continuation') {
      throw new Error('Simulation retired task effects require source-backed continuation instead of repeated execution')
    }
    let linked = state
    if (request.reportContinuation !== undefined && taskReportContinuationEvidence(state, request) === undefined) {
      throw new Error('Simulation report continuation has no exact retired owned report and persisted recipient evidence')
    }
    if (request.interaction !== undefined) {
      if (!taskInteractionExecutable(state, request)) throw new Error('Simulation task interaction requires its accepted open commitment and assignee or original continuation evidence')
      assertTaskInteractionSource(request)
      if (request.interaction.execution === 'obligation') {
        linked = foldTaskEvidence(state, { kind: 'task/reconciled', request: { ...request.interaction, requireOpenCommitment: true } })
      } else if (state.interactions[request.interaction.interactionId]?.revision !== request.interaction.expectedRevision) {
        throw new Error('Simulation task continuation interaction revision conflict')
      }
    }
    return { ...linked, taskExecutions: { ...executions, [request.attemptId]: { request, reservedSequence: sequence } } }
  }
  if (record.kind === 'task/execution-policy' || record.kind === 'task/execution-result') {
    const attemptId = record.kind === 'task/execution-policy' ? record.attemptId : record.request.attemptId
    const execution = Object.hasOwn(executions, attemptId) ? executions[attemptId] : undefined
    const writer = execution === undefined ? undefined : state.entities[execution.request.entityId]?.writer
    if (execution === undefined || execution.retired !== undefined || execution.task?.executor?.outcome !== undefined
      || writer?.phase !== 'active' || writer.epoch !== execution.request.epoch) {
      throw new Error('Simulation task result requires its current unfinished writer')
    }
    if (record.kind === 'task/execution-policy') {
      if (execution.completionPolicy !== undefined) throw new Error('Simulation task completion policy is already selected')
      return { ...state, taskExecutions: { ...executions, [attemptId]: { ...execution, completionPolicy: record.policy } } }
    }
    if (execution.result !== undefined || !isDeepStrictEqual(execution.completionPolicy, record.request.policy)
      || state.activeWindowId !== undefined || state.activeDecisionId !== undefined || execution.task?.phase !== 'running') {
      throw new Error('Simulation task result requires its selected policy and closed running decision')
    }
    if (record.request.outcome.kind === 'completed' && state.taskCancellations?.[execution.request.operationId] !== undefined) {
      throw new Error('Simulation cancelled task cannot accept a new completed result')
    }
    assertTaskResultEvidence(state, execution, record.request)
    return { ...state, taskExecutions: { ...executions, [attemptId]: { ...execution,
      result: { request: record.request, sequence } } } }
  }
  if (record.kind === 'task/execution-decision') {
    const request = record.request
    const execution = Object.hasOwn(executions, request.attemptId) ? executions[request.attemptId] : undefined
    const writer = execution === undefined ? undefined : state.entities[execution.request.entityId]?.writer
    if (execution === undefined || execution.retired !== undefined || execution.result !== undefined
      || state.taskCancellations?.[execution.request.operationId] !== undefined
      || execution.task?.executor?.outcome !== undefined || execution.task === undefined || execution.task.phase !== 'assigned' && execution.task.phase !== 'running'
      || request.task.revision !== execution.task.revision || state.phase !== 'running' || state.activeWindowId !== undefined
      || writer?.phase !== 'active' || writer.epoch !== execution.request.epoch) {
      throw new Error('Simulation task decision requires its live assigned attempt')
    }
    const previous = execution.decisions?.at(-1)
    if ((previous?.request.decisionId ?? null) !== request.predecessor
      || previous !== undefined && state.decisions[previous.request.decisionId]?.status !== 'accepted'
        && state.decisions[previous.request.decisionId]?.status !== 'cancelled'
      || Object.hasOwn(state.decisions, request.decisionId)
      || Object.hasOwn(state.taskDecisionOwners ?? {}, request.decisionId)) {
      throw new Error('Simulation task decision has a conflicting predecessor or identity')
    }
    return { ...state, taskDecisionOwners: { ...state.taskDecisionOwners,
      [request.decisionId]: { attemptId: request.attemptId, index: execution.decisions?.length ?? 0 } },
    taskExecutions: { ...executions, [request.attemptId]: { ...execution,
      decisions: [...execution.decisions ?? [], { request, sequence, epoch: execution.request.epoch }] } } }
  }
  if (record.kind === 'task/execution-input') {
    const { attemptId, decisionId, inputId } = record.receipt
    const execution = Object.hasOwn(executions, attemptId) ? executions[attemptId] : undefined
    const association = execution?.decisions?.find(value => value.request.decisionId === decisionId)
    const decision = Object.hasOwn(state.decisions, decisionId) ? state.decisions[decisionId] : undefined
    if (execution === undefined || association === undefined || association.input !== undefined || execution.retired !== undefined
      || state.taskCancellations?.[execution.request.operationId] !== undefined
      || decision?.entityId !== execution.request.entityId || decision.epoch !== association.epoch
      || decision.status !== 'open' || decision.context?.status !== 'prepared' || decision.context.view.inputId !== inputId) {
      throw new Error('Simulation task input requires its exact prepared decision')
    }
    return { ...state, taskExecutions: { ...executions, [attemptId]: { ...execution,
      decisions: execution.decisions?.map(value => value === association ? { ...value, input: { id: inputId, sequence } } : value) } } }
  }
  if (record.kind === 'task/execution-retired') {
    const { attemptId, quiescedAt, source, reason } = record.retirement
    const execution = Object.hasOwn(executions, attemptId) ? executions[attemptId] : undefined
    const writer = execution === undefined ? undefined : state.entities[execution.request.entityId]?.writer
    if (execution === undefined || execution.retired !== undefined || writer === undefined
      || BigInt(writer.epoch) < BigInt(execution.request.epoch)
      || writer.epoch === execution.request.epoch && writer.phase !== 'released') {
      throw new Error('Simulation task retirement requires its stopped writer epoch')
    }
    return { ...state, taskExecutions: { ...executions, [attemptId]: { ...execution,
      retired: { sequence, quiescedAt, source, reason } } } }
  }
  const { attemptId, task } = record.observation
  const execution = Object.hasOwn(executions, attemptId) ? executions[attemptId] : undefined
  if (execution === undefined) throw new Error('Simulation task observation has no reserved attempt')
  const request = execution.request
  if (task.operationId !== request.operationId || task.teamId !== request.teamId || task.taskId !== request.taskId
    || task.revision <= request.taskRevision || task.executor?.attemptId !== attemptId
    || task.executor.participantId !== request.participantId || task.executor.activationId !== request.activationId
    || task.executor.ordinal !== request.ordinal) {
    throw new Error('Simulation task observation differs from its reserved attempt')
  }
  if (execution.task !== undefined && (task.revision < execution.task.revision
    || task.revision === execution.task.revision && !isDeepStrictEqual(task, execution.task))) {
    throw new Error('Simulation task observation changed its immutable revision')
  }
  return { ...state, taskExecutions: { ...executions, [attemptId]: { ...execution, task } } }
}

/**
 * Verify current-attempt effects or an empty current acknowledgement of the retired source's fulfilled transfer evidence.
 * @param state - Committed world projection.
 * @param execution - Exact original task attempt.
 * @param result - Immutable terminal intent selected by its scenario policy.
 */
export function assertTaskResultEvidence(state: SimulationSnapshot,
  execution: import('@clocky/clocky-simulation').SimulationTaskExecution,
  result: import('@clocky/clocky-simulation').SimulationTaskResultRequest): void {
  if (execution.request.reportContinuation !== undefined) {
    const report = taskReportContinuationEvidence(state, execution.request)
    const acknowledged = hasCurrentEmptyAcknowledgement(state, execution)
    if (report === undefined || !acknowledged || result.operations.length !== 1 || result.operations[0] !== report.id) {
      throw new Error('Simulation report continuation result requires its recorded acknowledgement and exact original report')
    }
    return
  }
  if (execution.request.interaction?.execution === 'continuation') {
    const evidence = taskContinuationEvidence(state, execution.request)
    const acknowledged = hasCurrentEmptyAcknowledgement(state, execution)
    if (evidence === undefined || !acknowledged || result.operations.length !== evidence.length
      || result.operations.some(id => !evidence.includes(id))) {
      throw new Error('Simulation task continuation result requires its recorded acknowledgement and exact original transfer evidence')
    }
    return
  }
  for (const id of result.operations) {
    const operation = Object.hasOwn(state.operations, id) ? state.operations[id] : undefined
    const association = execution.decisions?.find(value => value.request.decisionId === operation?.decisionId)
    const decision = operation === undefined ? undefined : state.decisions[operation.decisionId]
    if (operation?.result?.status !== 'applied' || association === undefined || association.input === undefined
      || decision?.status !== 'accepted' || decision.epoch !== execution.request.epoch
      || operation.entityId !== execution.request.entityId
      || operation.action.kind === 'communication/post' && operation.delivery?.receipt === undefined) {
      throw new Error('Simulation task result has no exact applied effect or recipient persistence evidence')
    }
  }
}

/**
 * Verify retained attempt responsibility against its accepted creation and exact executor.
 * @param state - Committed or replayed run projection.
 */
export function assertTaskExecutions(state: SimulationSnapshot): void {
  for (const [id, record] of Object.entries(state.taskCancellations ?? {})) {
    const request = record.request, operation = state.operations[request.operationId], receipt = operation?.outbox?.taskReceipt
    const creator = operation === undefined ? undefined : state.entities[operation.entityId]?.binding
    if (id !== request.operationId || record.sequence > state.revision || operation?.action.kind !== 'task/create'
      || operation.result?.status !== 'applied' || receipt?.teamId !== request.teamId || receipt.taskId !== request.taskId
      || creator?.participantId !== request.cancellation.requestedBy) {
      throw new Error('Simulation task cancellation lost its original canonical source')
    }
  }
  const interactions = new Map<string, import('@clocky/clocky-simulation').SimulationInteractionId | undefined>()
  for (const [id, execution] of Object.entries(state.taskExecutions ?? {})) {
    const { request, task } = execution
    if (request.reportContinuation !== undefined && taskReportContinuationEvidence(state, request) === undefined) {
      throw new Error('Simulation report continuation lost its immutable retired source evidence')
    }
    const key = JSON.stringify([request.teamId, request.taskId]), interactionId = request.interaction?.interactionId
    if (interactions.has(key) && interactions.get(key) !== interactionId) throw new Error('Simulation task lost its original interaction association')
    interactions.set(key, interactionId)
    if (request.interaction !== undefined) {
      assertTaskInteractionSource(request)
      const interaction = state.interactions[request.interaction.interactionId]
      const linked = interaction?.task
      if (interaction?.reply !== 'accepted' || interaction.assignee !== request.entityId || interaction.commitmentId === undefined
        || state.commitments[interaction.commitmentId] === undefined || interaction.revision < request.interaction.expectedRevision
        || linked?.operationId !== request.operationId || linked.teamId !== request.teamId || linked.taskId !== request.taskId
        || request.interaction.execution === 'obligation' && linked.revision < request.taskRevision
        || request.interaction.execution === 'continuation' && taskContinuationEvidence(state, request) === undefined) {
        throw new Error('Simulation task lost its retained interaction source')
      }
    }
    const operation = state.operations[request.operationId]
    const receipt = operation?.outbox?.taskReceipt
    if (id !== request.attemptId || request.runId !== state.spec.runId || operation?.action.kind !== 'task/create'
      || operation.result?.status !== 'applied' || receipt?.taskId !== request.taskId || receipt.teamId !== request.teamId
      || request.ordinal > operation.action.task.maxAttempts || execution.reservedSequence > state.revision
      || execution.retired !== undefined && (execution.retired.sequence <= execution.reservedSequence
        || execution.retired.sequence > state.revision)) {
      throw new Error('Simulation task attempt lost its accepted creation responsibility')
    }
    if (execution.result !== undefined) {
      if (execution.result.sequence <= execution.reservedSequence || execution.result.sequence > state.revision
        || execution.result.request.attemptId !== request.attemptId
        || !isDeepStrictEqual(execution.result.request.policy, execution.completionPolicy)) {
        throw new Error('Simulation task result lost its original policy or acceptance sequence')
      }
      assertTaskResultEvidence(state, execution, execution.result.request)
    }
    for (const [index, association] of (execution.decisions ?? []).entries()) {
      const owner = state.taskDecisionOwners?.[association.request.decisionId]
      const decision = state.decisions[association.request.decisionId]
      const policy = association.request.policy
      if (decision?.deterministic !== undefined && !isDeepStrictEqual(decision.deterministic.policy, policy)
        || policy !== undefined && (decision?.status === 'submitted' || decision?.status === 'accepted') && decision.deterministic === undefined) {
        throw new Error('Simulation task decision lost its selected cognition policy')
      }
      const previous = execution.decisions?.[index - 1]
      if (owner?.attemptId !== request.attemptId || owner.index !== index
        || association.request.attemptId !== request.attemptId || association.epoch !== request.epoch
        || association.sequence <= (previous?.sequence ?? execution.reservedSequence) || association.sequence > state.revision
        || association.request.predecessor !== (previous?.request.decisionId ?? null)
        || decision !== undefined && (decision.entityId !== request.entityId || decision.epoch !== request.epoch)
        || association.input !== undefined && (association.input.sequence <= association.sequence
          || association.input.sequence > state.revision || decision?.context?.status !== 'prepared'
          || association.input.id !== decision.context.view.inputId)) {
        throw new Error('Simulation task decision lost its ordered source or input relationship')
      }
    }
    const writer = state.entities[request.entityId]?.writer
    if (execution.retired !== undefined && (writer === undefined || BigInt(writer.epoch) < BigInt(request.epoch)
      || writer.epoch === request.epoch && writer.phase !== 'released')) {
      throw new Error('Simulation task retirement lost its stopped writer epoch')
    }
    if (task !== undefined && (task.operationId !== request.operationId || task.teamId !== request.teamId
      || task.taskId !== request.taskId || task.revision <= request.taskRevision || task.executor?.attemptId !== request.attemptId
      || task.executor.participantId !== request.participantId || task.executor.activationId !== request.activationId
    || task.executor.ordinal !== request.ordinal)) {
      throw new Error('Simulation task attempt lost its canonical source identity')
    }
  }
  for (const [id, owner] of Object.entries(state.taskDecisionOwners ?? {})) {
    if (state.taskExecutions?.[owner.attemptId]?.decisions?.[owner.index]?.request.decisionId !== id) {
      throw new Error('Simulation task decision index lost its ordered source')
    }
  }

}

/** Check the immutable canonical pending task captured by an explicit interaction selection. */
function assertTaskInteractionSource(request: import('@clocky/clocky-simulation').SimulationTaskExecutionRequest): void {
  const task = request.interaction?.task
  if (task?.operationId !== request.operationId || task.teamId !== request.teamId || task.taskId !== request.taskId
    || task.revision !== request.taskRevision || task.phase !== 'pending'
    || task.executor !== undefined && (task.executor.outcome === undefined || task.executor.participantId !== request.participantId)) {
    throw new Error('Simulation task interaction differs from its original pending task')
  }
}

/** Require a current accepted empty-effect decision before acknowledging retained continuation evidence. */
function hasCurrentEmptyAcknowledgement(
  state: SimulationSnapshot, execution: import('@clocky/clocky-simulation').SimulationTaskExecution,
): boolean {
  return execution.decisions?.some((association) => {
    const decision = state.decisions[association.request.decisionId]
    return association.input !== undefined && decision?.status === 'accepted' && decision.epoch === execution.request.epoch
      && decision.entityId === execution.request.entityId && decision.operationIds.length === 0
  }) === true
}
