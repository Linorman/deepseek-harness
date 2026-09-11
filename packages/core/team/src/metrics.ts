/** Fixed-boundary Team latency histogram helpers. */

import type { TeamLatencyBucket, TeamLatencyHistogram } from './types.ts'

/** Stable latency boundaries in milliseconds; the final `null` bucket is +Inf. */
export const TEAM_LATENCY_BUCKETS_MS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000,
] as const

const EMPTY_BUCKET_COUNT = 0

/**
 * Return a frozen empty histogram with the protocol's stable boundaries.
 * @returns an immutable zero-sample Team latency histogram.
 */
export function emptyTeamLatencyHistogram(): TeamLatencyHistogram {
  const buckets: TeamLatencyBucket[] = [
    ...TEAM_LATENCY_BUCKETS_MS.map(upperBoundMs => ({ upperBoundMs, count: EMPTY_BUCKET_COUNT })),
    { upperBoundMs: null, count: EMPTY_BUCKET_COUNT },
  ]
  return Object.freeze({ count: 0, sumMs: 0, buckets: Object.freeze(buckets) })
}

/**
 * Add one non-negative integer latency sample to a cumulative histogram.
 * @param histogram - existing histogram to extend.
 * @param latencyMs - observed latency in milliseconds.
 * @returns a new immutable histogram containing the sample.
 */
export function addTeamLatencySample(histogram: TeamLatencyHistogram, latencyMs: number): TeamLatencyHistogram {
  if (!Number.isSafeInteger(latencyMs) || latencyMs < 0) {
    throw new Error(`Team latency sample must be a non-negative safe integer, got ${String(latencyMs)}`)
  }
  const count = histogram.count + 1
  const sumMs = histogram.sumMs + latencyMs
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(sumMs)) {
    throw new Error('Team latency histogram exceeded safe integer range')
  }
  const buckets = histogram.buckets.map((bucket) => {
    const included = bucket.upperBoundMs === null || latencyMs <= bucket.upperBoundMs
    return { ...bucket, count: bucket.count + (included ? 1 : 0) }
  })
  return Object.freeze({ count, sumMs, buckets: Object.freeze(buckets) })
}
