/** Canonical Team task provenance and exact attempt projection. @module @clocky/clocky-simulation-team/task-evidence */
import type { SimulationSnapshot, SimulationTaskEvidence } from '@clocky/clocky-simulation'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'

/**
 * Resolve an observation only from the task's immutable Simulation creation attribution.
 * @param state - Run whose accepted operation owns the task.
 * @param task - Canonical Team owner observation.
 * @returns exact creation, revision and current or last settled attempt facts.
 */
export function projectTaskEvidence(state: SimulationSnapshot, task: TeamTaskSnapshot): SimulationTaskEvidence {
  const creator = task.createCommand.creator
  if (!('kind' in creator) || creator.runId !== state.spec.runId
    || task.execution.kind !== 'participant') throw new Error('Simulation task receipt has another creation source')
  const operation = Object.hasOwn(state.operations, creator.operationId) ? state.operations[creator.operationId] : undefined
  const receipt = operation?.outbox?.taskReceipt
  const sender = operation === undefined ? undefined : state.entities[operation.entityId]?.binding
  if (operation?.action.kind !== 'task/create' || operation.result?.status !== 'applied'
    || receipt?.taskId !== task.id || receipt.teamId !== task.teamId
    || creator.teamId !== task.teamId || sender?.teamId !== task.teamId || sender.participantId !== creator.participantId
    || task.createCommand.idempotencyKey !== JSON.stringify(['simulation-task', state.spec.runId, operation.id])) {
    throw new Error('Simulation task receipt differs from its retained creation')
  }
  const lease = task.lease
  const attempt = task.attemptHistory.at(-1)
  const owner = lease ?? attempt
  return { operationId: creator.operationId, teamId: task.teamId, taskId: task.id, revision: task.revision, phase: task.phase,
    ...owner === undefined ? {} : { executor: { participantId: owner.participantId,
      ...(owner.activationId === undefined ? {} : { activationId: owner.activationId }),
      attemptId: 'attemptId' in owner ? owner.attemptId : owner.id, ordinal: owner.ordinal,
      ...('outcome' in owner ? { outcome: owner.outcome.kind } : {}),
    } } }
}
