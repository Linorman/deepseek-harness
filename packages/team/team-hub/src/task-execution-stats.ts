/** Incremental attempt aggregates derived exclusively from retained Task histories. @module @clocky/clocky-team-hub/task-execution-stats */
import { teamTaskRankingPolicySchema } from '@clocky/clocky-team'
import { TeamHubError } from './error.ts'
import type { JsonObject, TeamTaskExecutionStats, TeamTaskSnapshot, TaskAttemptSnapshot } from '@clocky/clocky-team'

/**
 * Add only newly settled attempts to fixed-size capability-set histograms.
 * @param previous - previously accepted aggregates.
 * @param task - task whose frozen requirements classify the attempts.
 * @param attempts - newly accepted immutable attempts, never repeated history.
 * @param rules - provider-frozen ranking bounds, when ranking is enabled.
 * @returns a detached map containing the updated groups.
 */
export function addTaskExecutionStats(
  previous: ReadonlyMap<string, TeamTaskExecutionStats>,
  task: TeamTaskSnapshot,
  attempts: readonly TaskAttemptSnapshot[],
  rules: JsonObject,
): Map<string, TeamTaskExecutionStats> {
  const stats = new Map(previous)
  const bounds = rules.taskRanking === undefined ? [] : teamTaskRankingPolicySchema.parse(rules.taskRanking).latencyUpperBoundsMs
  const requiredCapabilities = [...task.requiredCapabilities].sort()
  for (const attempt of attempts) {
    const key = JSON.stringify([attempt.participantId, requiredCapabilities])
    const current = stats.get(key)
    const latency = attempt.settledAt - attempt.assignedAt
    const found = bounds.findIndex(bound => latency <= bound)
    const bucket = found === -1 ? bounds.length : found
    const counts = current === undefined ? new Array<number>(bounds.length + 1).fill(0) : [...current.latencyBucketCounts]
    counts[bucket] = add(counts[bucket] as number, 1)
    stats.set(key, {
      participantId: attempt.participantId, requiredCapabilities,
      completedAttempts: add(current?.completedAttempts ?? 0, attempt.outcome.kind === 'completed' ? 1 : 0),
      failedAttempts: add(current?.failedAttempts ?? 0, attempt.outcome.kind === 'completed' ? 0 : 1),
      totalLatencyMs: add(current?.totalLatencyMs ?? 0, latency),
      latencyBucketCounts: counts,
    })
  }
  return stats
}

/**
 * Recompute checkpoint aggregates from all retained attempts, including task tombstones.
 * @param tasks - complete checkpoint task history retained across journal compaction.
 * @param rules - immutable histogram interpretation.
 * @returns aggregate groups for source-relation validation during recovery.
 */
export function recoverTaskExecutionStats(tasks: readonly TeamTaskSnapshot[], rules: JsonObject): Map<string, TeamTaskExecutionStats> {
  let stats = new Map<string, TeamTaskExecutionStats>()
  for (const task of tasks) stats = addTaskExecutionStats(stats, task, task.attemptHistory, rules)
  return stats
}

/** Reject counter or millisecond sums that lose exact integer representation. */
function add(left: number, right: number): number {
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) throw new TeamHubError('Task execution statistics exceed exact integer range', 'TEAM_JOURNAL_MALFORMED')
  return value
}
