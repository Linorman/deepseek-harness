/** Installed scene routes select administrative reviewers without parsing task text or browser claims. */
import type { SimulationSnapshot, SimulationTaskExecution, SimulationOperationId } from '@clocky/clocky-simulation'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'
import type { SimulationCompanyDriverConfig } from './company-driver.ts'
import { companyReviewSummary, taskReviewSummary } from './company-review.ts'
import { taskScenarioPrefix } from './task-scenario-config.ts'
import type { SimulationTaskScenarioStep } from './task-scenario-config.ts'
import type { SimulationProductTaskReviewSummary } from './review-types.ts'
import { taskScenarioCompletion, taskScenarioReport } from './task-scenario-policies.ts'

/**
 * Check whether the installed scene exposes an administrative review route.
 * @param config - Immutable installed scene generation.
 * @returns whether it includes an administratively reviewable task route.
 */
export function scenarioHasReview(config: SimulationCompanyDriverConfig): boolean {
  return config.tasks?.review === 'buyer' || config.scenario?.steps.some(step => step.reviewerEntityId !== undefined) === true
}

/**
 * Resolve an exact accepted task creation to its immutable trusted workflow step.
 * @param state - Committed run-owned task creation and decision facts.
 * @param operationId - Original task creation identity.
 * @param config - Immutable installed execution routes.
 * @returns exact configured step, or undefined when the accepted source does not match.
 */
export function scenarioTaskStep(state: SimulationSnapshot, operationId: SimulationOperationId,
  config: SimulationCompanyDriverConfig): SimulationTaskScenarioStep | undefined {
  const operation = state.operations[operationId]
  return config.scenario?.steps.find((step, index) => operation?.action.kind === 'task/create'
    && operation.entityId === step.sourceEntityId && operation.decisionId.startsWith(taskScenarioPrefix(index))
    && state.decisions[operation.decisionId]?.status === 'accepted'
    && state.decisions[operation.decisionId]?.operationIds.length === 1
    && state.decisions[operation.decisionId]?.operationIds[0] === operationId)
}

/**
 * Select a reviewer and verify only supported report/inventory evidence from an installed scene.
 * @param state - Committed original run history.
 * @param execution - Exact retained native attempt selected for canonical observation.
 * @param task - Canonical task fetched by the Host, never supplied by the browser.
 * @param config - Immutable resolved driver configuration stored at creation.
 * @returns scene-scoped action hint and evidence without task/report bodies.
 */
export function scenarioReviewSummary(state: SimulationSnapshot, execution: SimulationTaskExecution,
  task: TeamTaskSnapshot, config: SimulationCompanyDriverConfig): SimulationProductTaskReviewSummary {
  if (config.scenario === undefined) return companyReviewSummary(state, execution, task)
  const step = scenarioTaskStep(state, execution.request.operationId, config)
  if (step === undefined || execution.request.entityId !== step.entityId) throw new Error('Task workflow review has no immutable execution route')
  const result = execution.result?.request
  const report = result?.outcome.kind === 'completed' && result.policy.id === taskScenarioCompletion.id
    && result.policy.version === taskScenarioCompletion.version && execution.completionPolicy?.id === taskScenarioCompletion.id
    && execution.completionPolicy.version === taskScenarioCompletion.version
    ? taskScenarioReport(state, execution) : undefined
  const channel = state.channelReservations?.[step.channelKey]
  const evidence = report?.action.kind === 'communication/post' && result?.operations.length === 1
    && result.operations[0] === report.id && report.action.recipient === step.recipientEntityId
    && channel?.confirmed === true && report.action.channelId === channel.channelId
    ? { report: { operationId: report.id, delivery: 'persisted' as const } } : undefined
  const summary = taskReviewSummary(state, execution, task, step.reviewerEntityId ?? step.recipientEntityId, evidence)
  return step.reviewerEntityId === undefined ? { ...summary, action: { allowed: false, reason: 'review-disabled' as const } } : summary
}
