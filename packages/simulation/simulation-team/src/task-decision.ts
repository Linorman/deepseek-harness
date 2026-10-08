/** Execute a recorded task decision through the existing scoped cognition path. @module @clocky/clocky-simulation-team/task-decision */
import { isDeepStrictEqual } from 'node:util'
import { simulationWindowIdSchema } from '@clocky/clocky-simulation'
import type { Context } from '@clocky/cordis'
import type { TaskAttemptId } from '@clocky/clocky-team'
import type { SimulationRun, SimulationDecisionId, SimulationContextRequest, SimulationDecision } from '@clocky/clocky-simulation'
import type { SimulationTeamConnection } from './types.ts'
import { projectTaskEvidence } from './task-evidence.ts'

/**
 * Freeze canonical task instructions and ordered association before preparing or waking a model decision.
 * @param ctx - Canonical Team task reader.
 * @param run - Exclusive run and task execution owner.
 * @param connection - Scoped decision producer; its dispatch starts the exact task before wake.
 * @param request - Stable decision/predecessor, explicit reason and authorized scenario context.
 * @param check - Connection fence around every awaited owner operation.
 * @returns submitted/accepted decision; world effects and task completion remain separately owned.
 */
export async function executeTaskDecision(ctx: Context, run: SimulationRun, connection: SimulationTeamConnection,
  request: { readonly attemptId: TaskAttemptId
    readonly decisionId: SimulationDecisionId
    readonly predecessor: SimulationDecisionId | null
    readonly reason: string
    readonly policy?: import('@clocky/clocky-simulation').SimulationPolicyRef
    readonly context: Omit<SimulationContextRequest, 'maxBytes' | 'teamCursor'> }, check: () => void): Promise<SimulationDecision> {
  const selected = { ...request, ...request.policy === undefined ? {} : { policy: { ...request.policy } } }
  check()
  const execution = run.snapshot().taskExecutions?.[selected.attemptId]
  if (execution === undefined || execution.retired !== undefined || execution.task?.executor?.outcome !== undefined) {
    throw new Error('Simulation task decision requires an unfinished original attempt')
  }
  const existing = execution.decisions?.find(value => value.request.decisionId === selected.decisionId)
  if (existing === undefined) {
    const task = await ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
    check()
    const evidence = projectTaskEvidence(run.snapshot(), task)
    if (evidence.executor?.attemptId !== selected.attemptId || evidence.executor.outcome !== undefined) {
      throw new Error('Simulation task decision has another target attempt')
    }
    await run.observeTaskExecution({ attemptId: selected.attemptId, task: evidence })
    check()
    await run.associateTaskDecision({ attemptId: selected.attemptId, decisionId: selected.decisionId,
      predecessor: selected.predecessor, reason: selected.reason, ...selected.policy === undefined ? {} : { policy: selected.policy },
      task: { revision: task.revision, subject: task.subject, description: task.description } })
    check()
  } else if (existing.request.predecessor !== selected.predecessor || existing.request.reason !== selected.reason
    || !isDeepStrictEqual(existing.request.policy, selected.policy)) {
    throw new Error('Simulation task decision retry changed its predecessor, reason or cognition policy')
  }
  const windowId = simulationWindowIdSchema.parse(`task-window/1/${selected.decisionId}`)
  const retainedDecision = run.snapshot().decisions[selected.decisionId]
  if (retainedDecision === undefined) {
    await connection.openWindow({ id: windowId, decisions: [{ id: selected.decisionId,
      entityId: execution.request.entityId, context: selected.context,
      ...selected.policy === undefined ? {} : { policy: selected.policy } }] })
    check()
  } else if (retainedDecision.windowId !== windowId) {
    throw new Error('Simulation task decision changed its exact ordered window')
  }
  const result = selected.policy === undefined
    ? await connection.executeDecision(execution.request.entityId, selected.decisionId, selected.context)
    : await connection.executeDeterministicDecision(execution.request.entityId, selected.decisionId, selected.context, selected.policy)
  check()
  if (run.snapshot().phase !== 'running') return result
  await run.commitWindow(windowId)
  check()
  const accepted = run.snapshot().decisions[selected.decisionId]
  /* v8 ignore next -- a successful native window commit retains its exact decision in append-only history. */
  if (accepted === undefined) throw new Error('Simulation task window lost its exact decision')
  return accepted
}
