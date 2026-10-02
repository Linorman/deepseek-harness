/** Retain task interruption only after canonical controller quiescence. @module @clocky/clocky-simulation-team/task-retirement */
import type { Context } from '@clocky/cordis'
import type { SimulationRun, SimulationEntityId } from '@clocky/clocky-simulation'
import type { TeamId } from '@clocky/clocky-team'
import { projectTaskEvidence } from './task-evidence.ts'

/**
 * Reconcile unfinished attempt responsibility after the controller has stopped its writer.
 * @param ctx - Authoritative Team reader, still live during admitted cleanup.
 * @param run - Native owner retaining the original attempt and epoch.
 * @param teamId - Canonical execution Team.
 * @param entityId - Entity whose writer release triggered cleanup.
 * @returns completion after every affected original attempt is observed or durably retired.
 */
export async function retireTaskExecutions(ctx: Context, run: SimulationRun, teamId: TeamId,
  entityId: SimulationEntityId): Promise<void> {
  const pending = Object.values(run.snapshot().taskExecutions ?? {}).filter(value => value.request.entityId === entityId
    && value.retired === undefined && value.task?.executor?.outcome !== 'completed')
  if (pending.length === 0) return
  const team = await ctx.teams.getTeam({ teamId })
  if (team.team.id !== teamId) throw new Error('Simulation task retirement returned another Team')
  for (const execution of pending) {
    const request = execution.request
    const binding = team.activations.find(value => value.activation.id === request.activationId)
    if (binding?.quiescedAt === undefined || binding.quiescenceSource === undefined
      || binding.activation.participantId !== request.participantId || binding.sessionId !== request.sessionId) {
      throw new Error('Simulation task retirement requires exact controller quiescence')
    }
    const task = team.tasks.find(value => value.id === request.taskId)
    if (task === undefined || task.lease?.attemptId === request.attemptId) {
      throw new Error('Simulation task retirement retains an unresolved target lease')
    }
    const evidence = projectTaskEvidence(run.snapshot(), task)
    if (evidence.operationId !== request.operationId) throw new Error('Simulation task retirement has another creation source')
    if (evidence.executor?.attemptId === request.attemptId && evidence.executor.outcome !== undefined) {
      await run.observeTaskExecution({ attemptId: request.attemptId, task: evidence })
      if (evidence.executor.outcome === 'completed') continue
    }
    await run.retireTaskExecution({ attemptId: request.attemptId, quiescedAt: binding.quiescedAt,
      source: binding.quiescenceSource, reason: 'Simulation writer retired before task execution completed' })
  }
}
