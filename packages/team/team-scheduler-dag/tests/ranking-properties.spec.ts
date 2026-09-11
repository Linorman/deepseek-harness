import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ActivationBindingSnapshot, JsonObject, ParticipantSnapshot, TeamTaskRankingPolicy, TeamTaskSnapshot } from '@clocky/clocky-team'
import { taskOwnerRank } from '../src/ranking.ts'

const policy: TeamTaskRankingPolicy = {
  name: 'outcome-latency', version: 1, latencyUpperBoundsMs: [1, 5], costRateUpperBounds: [1, 10], missingCost: 'unknown-last',
}

const participant = {
  stats: { taskOutcomes: [{ requiredCapabilities: ['a', 'b'], completedAttempts: 2, failedAttempts: 1,
    totalLatencyMs: 8, latencyBucketCounts: [1, 2, 0] }] },
} as unknown as ParticipantSnapshot

const rules: JsonObject = { usageRates: { 'provider/model': { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 } } }

function task(requiredCapabilities: readonly string[], constrained: boolean): TeamTaskSnapshot {
  return { requiredCapabilities, budget: constrained ? { maxCostUnits: 1 } : {} } as unknown as TeamTaskSnapshot
}

function binding(withRoute: boolean): ActivationBindingSnapshot {
  return (withRoute
    ? { recovery: { kind: 'sdk-local-cold-replace', agent: { provider: 'provider', model: 'model' } } }
    : { selection: { provider: 'hint-provider', model: 'hint-model' } }) as unknown as ActivationBindingSnapshot
}

describe('deterministic task-owner ranking properties', () => {
  it('is stable across capability order and never uses an unverified route hint', () => {
    const result = fc.check(fc.property(
      fc.record({
        capabilities: fc.uniqueArray(fc.constantFrom('a', 'b', 'c'), { maxLength: 3 }),
        constrained: fc.boolean(),
      }),
      ({ capabilities, constrained }) => {
        const current = task(capabilities, constrained)
        const reversed = task([...capabilities].reverse(), constrained)
        const known = taskOwnerRank(current, participant, binding(true), policy, rules)
        expect(taskOwnerRank(reversed, participant, binding(true), policy, rules)).toEqual(known)
        expect(taskOwnerRank(current, participant, binding(false), policy, rules).costBucket)
          .toBe(constrained ? policy.costRateUpperBounds.length + 1 : 0)
      },
    ), { numRuns: 100, seed: 20260910 })
    if (result.failed) throw new Error(`ranking property counterexample: ${JSON.stringify(result)}`)
  })

  it('changes only when the frozen policy changes, not when a live input is re-read', () => {
    const constrained = task(['a', 'b'], true)
    const wider: TeamTaskRankingPolicy = { ...policy, costRateUpperBounds: [5, 20] }
    const first = taskOwnerRank(constrained, participant, binding(true), policy, rules)
    const second = taskOwnerRank(
      structuredClone(constrained), structuredClone(participant), structuredClone(binding(true)), policy, structuredClone(rules),
    )
    expect(second).toEqual(first)
    expect(taskOwnerRank(constrained, participant, binding(true), wider, rules).costBucket).toBe(0)
    expect(first.costBucket).toBe(1)
  })
})
