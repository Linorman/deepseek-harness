/** Scenario result evaluation and original target reconciliation. @module @clocky/clocky-simulation-team/task-completion */
import { isDeepStrictEqual } from 'node:util'
import { deepFreeze } from '@clocky/clocky-llm'
import type { Context } from '@clocky/cordis'
import type { TaskAttemptId } from '@clocky/clocky-team'
import { simulationTaskResultRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationPolicyRef, SimulationTaskCompletionPolicy } from '@clocky/clocky-simulation'
import type { SimulationTaskAuthority } from './task-transport.ts'
import type { SimulationTaskCompletionResult } from './types.ts'
import { projectTaskEvidence } from './task-evidence.ts'

/**
 * Evaluate a pinned scene policy once per accepted result, then reconcile its exact Team attempt.
 * @param ctx - Canonical task reader and current local actor registry.
 * @param run - Native result and effect owner.
 * @param authority - Runtime-only result proof owner.
 * @param lifecycleOwner - Canonical Team activation rule.
 * @param request - Original attempt and exact registered policy generation.
 * @param resolve - Current pure policy implementation; only required before result acceptance.
 * @param check - Connection fence around awaited owner operations.
 * @returns waiting, original target receipt or interruption; submission alone is never completion.
 */
export async function completeTask(ctx: Context, run: SimulationRun, authority: SimulationTaskAuthority,
  lifecycleOwner: string, request: { readonly attemptId: TaskAttemptId; readonly policy: SimulationPolicyRef },
  resolve: () => SimulationTaskCompletionPolicy, check: () => void): Promise<SimulationTaskCompletionResult> {
  const selected = { ...request, policy: { ...request.policy } }
  check()
  let execution = run.snapshot().taskExecutions?.[selected.attemptId]
  if (execution === undefined) throw new Error('Simulation task completion has no original attempt')
  if (execution.completionPolicy !== undefined && !isDeepStrictEqual(execution.completionPolicy, selected.policy)) {
    throw new Error('Simulation task completion retry changed its selected policy')
  }
  if (execution.retired !== undefined) return await reconcileInteraction(run, execution, 'interrupted', check)
  let intent = execution.result
  if (intent === undefined) {
    resolve()
    execution = await run.selectTaskCompletionPolicy(selected.attemptId, selected.policy)
    check()
    const policy = resolve()
    const state = deepFreeze(run.snapshot())
    const retained = deepFreeze(execution)
    const actor = ctx.agents.get(retained.request.sessionId)
    if (actor?.status !== 'idle') return { status: 'waiting', reason: 'Task actor has not finished its turn', execution: retained }
    const assessment = policy.evaluate(state, retained)
    if (assessment.status === 'waiting') return { ...assessment, execution: retained }
    const result = simulationTaskResultRequestSchema.parse({ attemptId: selected.attemptId, policy: selected.policy,
      operations: assessment.operations, outcome: assessment.outcome })
    const accepted = await run.recordTaskResult(result, state.revision)
    check()
    intent = accepted
    execution = { ...retained, result: accepted }
  }
  let task = await ctx.teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId })
  check()
  const recorded = task.attemptHistory.find(value => value.id === selected.attemptId)
  if (recorded !== undefined && !isDeepStrictEqual(recorded.outcome, intent.request.outcome)) {
    const evidence = projectTaskEvidence(run.snapshot(), task)
    const observed = await run.observeTaskExecution({ attemptId: selected.attemptId, task: evidence })
    return await reconcileInteraction(run, observed, 'interrupted', check)
  }
  if (recorded === undefined) {
    task = await authority.settle(run, selected.attemptId, lifecycleOwner, () => {
      try { check(); return true }
      catch { return false } // The accepted result cannot retain live authority after connection retirement.
    })
    check()
  }
  const evidence = projectTaskEvidence(run.snapshot(), task)
  const observed = await run.observeTaskExecution({ attemptId: selected.attemptId, task: evidence })
  return await reconcileInteraction(run, observed, 'settled', check)
}

/** Publish only newer facts for the retained accepted interaction while its commitment remains open. */
async function reconcileInteraction(run: SimulationRun, execution: import('@clocky/clocky-simulation').SimulationTaskExecution,
  status: 'settled' | 'interrupted', check: () => void): Promise<SimulationTaskCompletionResult> {
  const association = execution.request.interaction, task = execution.task
  if (association === undefined || task === undefined) return { status, execution }
  const state = run.snapshot(), interaction = state.interactions[association.interactionId]
  const commitment = interaction?.commitmentId === undefined ? undefined : state.commitments[interaction.commitmentId]
  if (interaction === undefined || commitment === undefined) throw new Error('Simulation task completion lost its interaction source')
  if (commitment.phase !== 'open') return { status, execution }
  if (interaction.task === undefined || interaction.task.revision < task.revision) {
    if (state.activeWindowId !== undefined) {
      return { status: 'waiting', reason: 'Interaction reconciliation requires a closed decision window', execution }
    }
    await run.reconcileTask({ interactionId: interaction.id, expectedRevision: interaction.revision, task, requireOpenCommitment: true })
    check()
  }
  return interaction.fulfillment.kind === 'task-completed' && task.phase === 'review'
    ? { status: 'waiting', reason: 'Task review is still pending', execution } : { status, execution }
}
