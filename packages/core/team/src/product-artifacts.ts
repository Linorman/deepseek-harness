/** Artifact metadata projection shared by authenticated human product readers. */
import type { TeamStateSnapshot, TeamTaskSnapshot, TeamWorkflowPlanSnapshot } from './types.ts'
import { withoutPrivateTaskArtifacts } from './task-inspection.ts'

/** Exclude private references from every completed attempt.
 * @param task - Authoritative task snapshot.
 * @returns task history with product-visible artifact metadata.
 */
export function withoutPrivateTaskHistoryArtifacts(task: TeamTaskSnapshot): TeamTaskSnapshot {
  return { ...task, attemptHistory: task.attemptHistory.map(attempt => attempt.outcome.kind !== 'completed' ? attempt : {
    ...attempt, outcome: { ...attempt.outcome, result: withoutPrivateTaskArtifacts(attempt.outcome.result) },
  }) }
}

/** Exclude private references from task histories and lost workspace results.
 * @param state - Authoritative Team snapshot.
 * @returns current state with product-visible artifact metadata.
 */
export function withoutPrivateTeamArtifacts(state: TeamStateSnapshot): TeamStateSnapshot {
  return { ...state, tasks: state.tasks.map(withoutPrivateTaskHistoryArtifacts),
    workspaceAllocations: state.workspaceAllocations.map(allocation => allocation.loss === undefined ? allocation : {
      ...allocation, loss: { ...allocation.loss, artifacts: allocation.loss.artifacts.filter(reference => reference.visibility !== 'private') },
    }) }
}

/** Exclude private references from completed workflow task results.
 * @param plan - Authoritative workflow snapshot.
 * @returns workflow result with product-visible artifact metadata.
 */
export function withoutPrivateWorkflowArtifacts(plan: TeamWorkflowPlanSnapshot): TeamWorkflowPlanSnapshot {
  if (plan.result === undefined) return plan
  return { ...plan, result: { ...plan.result, tasks: plan.result.tasks.map(task => task.phase === 'completed'
    ? { ...task, result: withoutPrivateTaskArtifacts(task.result) } : task) } }
}
