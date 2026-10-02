/** Reserve and reconcile one exact Simulation task assignment. @module @clocky/clocky-simulation-team/task-assignment */
import type { Context } from '@clocky/cordis'
import type { SimulationRun, SimulationEntityId, SimulationOperationId, SimulationTaskExecution } from '@clocky/clocky-simulation'
import type { TaskAttemptId } from '@clocky/clocky-team'
import type { SimulationTaskAuthority } from './task-transport.ts'
import { projectTaskEvidence } from './task-evidence.ts'

/**
 * Persist source responsibility before Hub assignment, and reconcile target IO by the same attempt identity.
 * @param ctx - Canonical Team reader and provider.
 * @param run - Exclusive native owner.
 * @param authority - Runtime-only exact-operation proof owner.
 * @param lifecycleOwner - Canonical activation lifecycle rule.
 * @param selection - Caller-retained attempt and selected entity; no placement or inference is implicit.
 * @param check - Connection admission fence around every awaited owner operation.
 * @returns durable reservation with the exact observed assignment or terminal attempt fact.
 */
export async function assignSimulationTask(ctx: Context, run: SimulationRun, authority: SimulationTaskAuthority,
  lifecycleOwner: string, selection: { readonly attemptId: TaskAttemptId
    readonly operationId: SimulationOperationId
    readonly entityId: SimulationEntityId
    readonly interactionId?: import('@clocky/clocky-simulation').SimulationInteractionId
    readonly reportContinuation?: import('@clocky/clocky-simulation').SimulationTaskReportContinuation
    readonly leaseDurationMs: number }, check: () => void): Promise<SimulationTaskExecution> {
  const request = { ...selection }
  check()
  const state = run.snapshot()
  const prior = Object.hasOwn(state.taskExecutions ?? {}, request.attemptId) ? state.taskExecutions?.[request.attemptId] : undefined
  if (prior !== undefined && (prior.request.operationId !== request.operationId || prior.request.entityId !== request.entityId
    || prior.request.leaseDurationMs !== request.leaseDurationMs || prior.request.interaction?.interactionId !== request.interactionId
    || JSON.stringify(prior.request.reportContinuation) !== JSON.stringify(request.reportContinuation))) {
    throw new Error('Simulation task retry changed its assignment selection')
  }
  const operation = Object.hasOwn(state.operations, request.operationId) ? state.operations[request.operationId] : undefined
  const receipt = operation?.outbox?.taskReceipt
  if (receipt === undefined || operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied') {
    throw new Error('Simulation task assignment requires its accepted creation receipt')
  }
  if (prior?.retired !== undefined || prior?.task?.executor?.outcome !== undefined) return prior
  let task = await ctx.teams.getTask({ teamId: receipt.teamId, taskId: receipt.taskId })
  check()
  if (projectTaskEvidence(run.snapshot(), task).operationId !== request.operationId) {
    throw new Error('Simulation task assignment source differs from its accepted creation')
  }
  if (prior === undefined) {
    if (task.phase !== 'pending' || task.cancellation !== undefined) {
      throw new Error('Simulation task assignment requires a pending task without cancellation')
    }
    const current = run.snapshot()
    const entity = current.entities[request.entityId]
    const binding = entity?.binding
    const writer = entity?.writer
    if (binding === undefined || writer?.phase !== 'active' || writer.activationId === undefined || binding.teamId !== task.teamId) {
      throw new Error('Simulation task assignment requires the selected resident actor')
    }
    const { interactionId, ...assignment } = request
    const interaction = interactionId === undefined ? undefined : current.interactions[interactionId]
    if (interactionId !== undefined && interaction === undefined) throw new Error('Simulation task assignment has no selected interaction')
    await run.reserveTaskExecution({ ...assignment, runId: current.spec.runId, teamId: task.teamId,
      ...interaction === undefined ? {} : { interaction: { interactionId: interaction.id,
        expectedRevision: interaction.revision, task: projectTaskEvidence(current, task),
        execution: interaction.commitmentId !== undefined && current.commitments[interaction.commitmentId]?.phase === 'fulfilled'
          ? 'continuation' : 'obligation' } },
      taskId: task.id, taskRevision: task.revision, ordinal: task.attemptCount + 1,
      participantId: binding.participantId, sessionId: binding.sessionId, activationId: writer.activationId,
      reservationId: writer.reservationId, epoch: writer.epoch }, current.revision)
    check()
  }
  if (task.lease?.attemptId !== request.attemptId && !task.attemptHistory.some(value => value.id === request.attemptId)) {
    task = await authority.assign(run, request.attemptId, lifecycleOwner, () => {
      try { check(); return true }
      catch { return false } // The resolver cannot retain authority after its connection admission fence rejects.
    })
    check()
  }
  const evidence = projectTaskEvidence(run.snapshot(), task)
  if (evidence.executor?.attemptId !== request.attemptId) {
    throw new Error('Simulation task assignment returned another attempt')
  }
  return await run.observeTaskExecution({ attemptId: request.attemptId, task: evidence })
}
