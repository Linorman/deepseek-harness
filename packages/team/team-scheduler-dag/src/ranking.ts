/** Scalar deterministic owner ranking from Hub-derived summaries and frozen rates. @module @clocky/clocky-team-scheduler-dag/ranking */
import { teamUsageRateSchema } from '@clocky/clocky-team'
import type { ActivationBindingSnapshot, JsonObject, ParticipantSnapshot, TeamTaskRankingPolicy, TeamTaskSnapshot } from '@clocky/clocky-team'

/** Outcome and bucket values compared after proposal, capability surplus, and live load. */
export interface TaskOwnerRank {
  /** Completed attempts minus failed, expired, released, and cancelled attempts; unseen owners have zero. */
  readonly outcomeBalance: number
  /** Lower median bucket, with absent observations after the overflow bucket. */
  readonly latencyBucket: number
  /** Frozen maximum-token rate bucket, or the policy's final unknown bucket. */
  readonly costBucket: number
}

/**
 * Resolve one candidate's scalar ranking values without reading attempt history.
 * @param task - pending task whose frozen capability set and budget select the evidence.
 * @param participant - eligible owner carrying Hub-derived capability-set aggregates.
 * @param binding - exact current binding; only its retained recovery model route can prove a rate selection.
 * @param policy - Team creation-time ranking interpretation.
 * @param rules - Team creation-time usage rate table.
 * @returns deterministic integer values for lexicographic comparison.
 */
export function taskOwnerRank(
  task: TeamTaskSnapshot,
  participant: ParticipantSnapshot,
  binding: ActivationBindingSnapshot,
  policy: TeamTaskRankingPolicy,
  rules: JsonObject,
): TaskOwnerRank {
  const capabilities = JSON.stringify([...task.requiredCapabilities].sort())
  const stats = participant.stats?.taskOutcomes?.find(value => JSON.stringify(value.requiredCapabilities) === capabilities)
  let latencyBucket = policy.latencyUpperBoundsMs.length + 1
  const total = (stats?.completedAttempts ?? 0) + (stats?.failedAttempts ?? 0)
  if (stats !== undefined && total > 0) {
    const target = Math.ceil(total / 2)
    let count = 0
    for (const [index, value] of stats.latencyBucketCounts.entries()) {
      count += value
      if (count >= target) { latencyBucket = index; break }
    }
  }
  return {
    outcomeBalance: (stats?.completedAttempts ?? 0) - (stats?.failedAttempts ?? 0),
    latencyBucket,
    costBucket: costBucket(task, binding, policy, rules),
  }
}

/** Use only a retained current model route and its creation-time rate, never participant hints or historical models. */
function costBucket(task: TeamTaskSnapshot, binding: ActivationBindingSnapshot, policy: TeamTaskRankingPolicy, rules: JsonObject): number {
  if (task.budget.maxCostUnits === undefined) return 0
  const unknown = policy.costRateUpperBounds.length + 1
  const route = binding.recovery?.kind === 'sdk-local-cold-replace' ? binding.recovery.agent : undefined
  const rates = rules.usageRates
  if (route === undefined || rates === undefined || rates === null || typeof rates !== 'object' || Array.isArray(rates)) return unknown
  const table = rates as JsonObject
  const raw = table[`${route.provider}/${route.model}`] ?? table[route.provider] ?? table['*']
  if (raw === undefined) return unknown
  const rate = teamUsageRateSchema.parse(raw)
  const maximum = Math.max(rate.input, rate.output, rate.cacheRead, rate.cacheWrite)
  const index = policy.costRateUpperBounds.findIndex(bound => maximum <= bound)
  return index === -1 ? policy.costRateUpperBounds.length : index
}
