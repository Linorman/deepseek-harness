/** Pure workflow and child dependency propagation plus terminal result derivation. @module @clocky/clocky-team-hub/workflow-outcomes */
import type {
  TeamTaskSnapshot,
  TeamTaskId,
  TeamWorkflowPlanSnapshot,
  TeamWorkflowPlanResult,
  TeamWorkflowProjectedTaskResult,
  TeamStallReason,
} from '@clocky/clocky-team'
import type { TeamJournalRecord, TeamProjection } from './types.ts'

/** Aggregate execution outcome available only after every bound task is terminal. */
export interface WorkflowTerminalOutcome {
  /** Aggregate outcome across all bound tasks, including tasks omitted from the configured projection. */
  readonly phase: 'completed' | 'failed' | 'cancelled'
  /** Task results in the configured template order. */
  readonly result: TeamWorkflowPlanResult
  /** Stable failure attribution for a failed task. */
  readonly failure?: TeamStallReason | undefined
}

/**
 * Derive the exact terminal result from one fully compiled workflow and its Task facts.
 * @param plan - immutable bindings and configured result selection.
 * @param tasks - authoritative Team task projections.
 * @returns the terminal aggregate, or undefined while a binding or task remains unfinished.
 */
export function workflowTerminalOutcome(
  plan: TeamWorkflowPlanSnapshot,
  tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>,
): WorkflowTerminalOutcome | undefined {
  if (plan.taskBindings.length !== plan.plan.tasks.length) return undefined
  const bound = plan.taskBindings.map(binding => tasks.get(binding.taskId))
  if (bound.some(task => task === undefined || !terminal(task))) return undefined
  const projected: TeamWorkflowProjectedTaskResult[] = []
  for (const templateId of plan.plan.result.taskTemplateIds) {
    const binding = plan.taskBindings.find(item => item.templateId === templateId)
    const task = binding === undefined ? undefined : tasks.get(binding.taskId)
    if (task === undefined) return undefined
    const outcome = task.attemptHistory.at(-1)?.outcome
    switch (task.phase) {
      case 'completed':
        if (outcome?.kind !== 'completed') return undefined
        projected.push({ templateId, taskId: task.id, phase: task.phase, result: structuredClone(outcome.result) })
        break
      case 'failed':
        projected.push({ templateId, taskId: task.id, phase: task.phase,
          ...outcome?.kind === 'failed' ? { failure: structuredClone(outcome.failure) } : {} })
        break
      case 'cancelled':
      case 'deleted':
        projected.push({ templateId, taskId: task.id, phase: task.phase,
          ...task.blockedByOutcome === undefined ? {} : { blockedByOutcome: { ...task.blockedByOutcome } } })
        break
      default:
        return undefined
    }
  }
  const failed = bound.find(task => task?.phase === 'failed')
  return {
    phase: failed !== undefined ? 'failed' : bound.some(task => task?.phase === 'cancelled' || task?.phase === 'deleted') ? 'cancelled' : 'completed',
    result: { kind: 'task-results', tasks: projected },
    ...failed === undefined ? {} : { failure: { code: 'WORKFLOW_TASK_FAILED', message: `Workflow task '${failed.id}' failed.` } },
  }
}

/**
 * Cancel only unstarted workflow tasks or child reservations whose prerequisite cannot complete, then settle ready plans.
 * @param projection - proposed state after the owning command's explicit records.
 * @returns ordered task and plan records to append in that same transaction.
 */
export function workflowOutcomeRecords(projection: TeamProjection): TeamJournalRecord[] {
  const records: TeamJournalRecord[] = []
  const tasks = new Map(projection.tasks)
  const createdAt = projection.team.updatedAt
  for (const plan of projection.workflowPlans.values()) {
    if (plan.phase !== 'ready') continue
    let advanced = true
    while (advanced) {
      advanced = false
      for (const binding of plan.taskBindings) {
        const task = tasks.get(binding.taskId)
        if (task === undefined || task.phase !== 'pending' || task.cancellation !== undefined || task.attemptCount !== 0) continue
        const blocker = task.blockedBy.map(id => tasks.get(id)).find(candidate => candidate?.workflowPlanId === plan.id
          && (candidate.phase === 'failed' || candidate.phase === 'cancelled' || candidate.phase === 'deleted'))
        if (blocker === undefined || (blocker.phase !== 'failed' && blocker.phase !== 'cancelled' && blocker.phase !== 'deleted')) continue
        const cancelled: TeamTaskSnapshot = { ...task, revision: task.revision + 1, phase: 'cancelled',
          blockedByOutcome: { taskId: blocker.id, revision: blocker.revision, phase: blocker.phase } }
        tasks.set(task.id, cancelled)
        records.push({ type: 'task/changed', task: cancelled, createdAt })
        advanced = true
      }
    }
    const result = workflowTerminalOutcome(plan, tasks)
    if (result !== undefined) {
      records.push({ type: 'workflow-plan/changed', plan: { ...plan, revision: plan.revision + 1, ...result }, createdAt })
    }
  }
  let childAdvanced = true
  while (childAdvanced) {
    childAdvanced = false
    for (const task of [...tasks.values()]) {
      if (task.execution.kind !== 'child-team' || task.phase !== 'pending' || task.attemptCount !== 0
        || task.cancellation !== undefined || task.blockedByOutcome !== undefined
        || task.delegation?.phase !== 'requested' || task.delegation.childTeamId !== undefined) continue
      const blocker = task.blockedBy.map(id => tasks.get(id)).find(candidate =>
        candidate?.phase === 'failed' || candidate?.phase === 'cancelled' || candidate?.phase === 'deleted')
      if (blocker === undefined || (blocker.phase !== 'failed' && blocker.phase !== 'cancelled' && blocker.phase !== 'deleted')) continue
      const cancelled: TeamTaskSnapshot = { ...task, revision: task.revision + 1, phase: 'cancelled',
        blockedByOutcome: { taskId: blocker.id, revision: blocker.revision, phase: blocker.phase },
        delegation: { ...task.delegation, phase: 'cancelled', updatedAt: createdAt } }
      tasks.set(task.id, cancelled)
      records.push({ type: 'task/changed', task: cancelled, createdAt })
      childAdvanced = true
    }
  }
  return records
}

/** Whether a task can never satisfy another attempt or dependency transition. */
function terminal(task: TeamTaskSnapshot): boolean {
  return task.phase === 'completed' || task.phase === 'failed' || task.phase === 'cancelled' || task.phase === 'deleted'
}
