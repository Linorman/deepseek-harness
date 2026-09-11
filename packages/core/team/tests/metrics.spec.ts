import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import {
  TEAM_LATENCY_BUCKETS_MS,
  addTeamLatencySample,
  emptyTeamLatencyHistogram,
  teamLatencyHistogramSchema,
} from '../src/index.ts'

describe('Team latency metrics', () => {
  it('uses stable cumulative buckets and includes the positive-infinity count', () => {
    let histogram = emptyTeamLatencyHistogram()
    histogram = addTeamLatencySample(histogram, 0)
    histogram = addTeamLatencySample(histogram, 7)
    histogram = addTeamLatencySample(histogram, 400_000)

    expect(histogram.count).toBe(3)
    expect(histogram.sumMs).toBe(400_007)
    expect(histogram.buckets).toHaveLength(TEAM_LATENCY_BUCKETS_MS.length + 1)
    expect(histogram.buckets.find(bucket => bucket.upperBoundMs === 5)?.count).toBe(1)
    expect(histogram.buckets.find(bucket => bucket.upperBoundMs === 10)?.count).toBe(2)
    expect(histogram.buckets.at(-1)).toEqual({ upperBoundMs: null, count: 3 })
    expect(teamLatencyHistogramSchema.parse(histogram)).toEqual(histogram)
  })

  it('preserves histogram invariants for arbitrary bounded sample sequences', () => {
    fc.assert(fc.property(fc.array(fc.nat({ max: 500_000 }), { maxLength: 40 }), (samples) => {
      let histogram = emptyTeamLatencyHistogram()
      for (const sample of samples) histogram = addTeamLatencySample(histogram, sample)
      expect(histogram.count).toBe(samples.length)
      expect(histogram.sumMs).toBe(samples.reduce((sum, sample) => sum + sample, 0))
      expect(histogram.buckets.at(-1)?.count).toBe(samples.length)
      for (let index = 1; index < histogram.buckets.length; index += 1) {
        expect(histogram.buckets[index]!.count).toBeGreaterThanOrEqual(histogram.buckets[index - 1]!.count)
      }
      expect(() => teamLatencyHistogramSchema.parse(histogram)).not.toThrow()
    }), { numRuns: 40 })
  })

  it.each([
    [-1, /non-negative/],
    [Number.NaN, /non-negative/],
    [Number.POSITIVE_INFINITY, /non-negative/],
  ])('rejects invalid sample %s', (sample, message) => {
    expect(() => addTeamLatencySample(emptyTeamLatencyHistogram(), sample)).toThrow(message)
  })

  it('rejects malformed cumulative boundaries at the wire schema', () => {
    const histogram = emptyTeamLatencyHistogram()
    const wrong = histogram.buckets.map((bucket, index) => index === 0
      ? { ...bucket, upperBoundMs: 2 }
      : bucket)
    expect(() => teamLatencyHistogramSchema.parse({ ...histogram, buckets: wrong })).toThrow(/protocol boundary/)
    const nonCumulative = histogram.buckets.map((bucket, index) => index === 0
      ? { ...bucket, count: 1 }
      : index === 1 ? { ...bucket, count: 0 } : bucket)
    expect(() => teamLatencyHistogramSchema.parse({ ...histogram, buckets: nonCumulative })).toThrow(/cumulative/)
  })

  it('rejects a sample that would overflow the safe sum range', () => {
    const histogram = { ...emptyTeamLatencyHistogram(), sumMs: Number.MAX_SAFE_INTEGER }
    expect(() => addTeamLatencySample(histogram, 1)).toThrow(/safe integer range/)
  })
})
