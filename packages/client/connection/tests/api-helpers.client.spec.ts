/**
 * Contract-layer helpers: transport-error folding and response unwrapping.
 * (The assistant block classifier half of the legacy spec lives in
 * runtime/tests — the classifier moved there.)
 */

import { describe, expect, it } from 'vitest'
import { RpcId, emptyTeamLatencyHistogram, resultOf, transportError } from '../src/client/api.ts'

it('creates a complete zero-sample Team latency histogram for wire fixtures', () => {
  const histogram = emptyTeamLatencyHistogram()
  expect(histogram).toMatchObject({ count: 0, sumMs: 0 })
  expect(histogram.buckets).toHaveLength(16)
  expect(histogram.buckets[0]).toEqual({ upperBoundMs: 1, count: 0 })
  expect(histogram.buckets.at(-1)).toEqual({ upperBoundMs: null, count: 0 })
  expect(histogram.buckets.every(bucket => bucket.count === 0)).toBe(true)
})

describe('transportError', () => {
  it('folds an Error to internal keeping the message, and stringifies non-Errors', () => {
    expect(transportError(new Error('线断了'))).toEqual({ ok: false, error: { code: 'internal', message: '线断了', details: {} } })
    expect(transportError('raw string')).toMatchObject({ ok: false, error: { message: 'raw string' } })
  })
})

describe('resultOf', () => {
  it('unwraps the result slot', () => {
    expect(resultOf({ rpcId: RpcId('r'), result: { ok: true, value: 7 } })).toEqual({ ok: true, value: 7 })
  })
})
