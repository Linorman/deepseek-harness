import { describe, expect, it } from 'vitest'
import { SessionId, decodeStorageRecord } from '@clocky/clocky-session'
import type { SimulationTokenReservation } from '../src/tokens.ts'
import { simulationTokenReservationIdSchema } from '../src/tokens.ts'
import { simulationEntityIdSchema } from '../src/entity.ts'
import { simulationWriterEpochSchema } from '../src/writer.ts'
import { simTimeSchema } from '../src/time.ts'
import { attributeSimulationTokens } from '../src/token-attribution.ts'

const sessionId = SessionId('original-session')
function reservation(id: string, status: SimulationTokenReservation['status']): SimulationTokenReservation {
  return { id: simulationTokenReservationIdSchema.parse(id), entityId: simulationEntityIdSchema.parse('actor'),
    epoch: simulationWriterEpochSchema.parse('1'), sessionId,
    request: { sessionSequence: 0, provider: 'original', model: 'model' }, interval: simTimeSchema.parse('0'),
    reserved: 100, status,
    ...status === 'settled' ? { usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 5, cacheWriteTokens: 3 } } : {},
    ...status === 'unknown' ? { observedUsage: { inputTokens: 2, outputTokens: 1 } } : {} }
}

describe('usage attribution', () => {
  it('reconciles unknown and incomplete usage without fabricating complete settlements', () => {
    const attempts = ['reserved', 'unknown', 'settled', 'not-dispatched'].map((status, index) =>
      reservation(`request-${index}`, status as SimulationTokenReservation['status']))
    const report = attributeSimulationTokens(attempts, {}, new Map())
    expect(report.total.attempts).toBe(4)
    expect(report.total.statuses).toEqual({ reserved: 1, unknown: 1, settled: 1, 'not-dispatched': 1 })
    expect(report.total.outstandingReservedTokens).toBe(200)
    expect(report.total.settled).toEqual({ inputTokens: 11, outputTokens: 7, cacheReadTokens: 5, cacheWriteTokens: 3 })
    expect(report.total.unknownReported).toEqual({ inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(report.categories.unknown).toEqual(report.total)
    expect(Object.values(report.categories).reduce((sum, bucket) => sum + bucket.attempts, 0)).toBe(4)
  })

  it('assigns compaction only with its exact canonical Session request and never duplicates usage', () => {
    const compactionId = 'compaction-original' as NonNullable<SimulationTokenReservation['compactionId']>
    const attempt = { ...reservation('compact', 'settled'), compactionId }
    const events = decodeStorageRecord({ seq: 0, time: 0, type: 'compaction/request',
      data: { compactionId, startSequence: 0, request: { provider: 'original', model: 'model', messages: [] } } })
    const report = attributeSimulationTokens([attempt], {}, new Map([[sessionId, events]]))
    expect(report.categories.compaction).toEqual(report.total)
    expect(report.categories.unknown.attempts).toBe(0)
    const mismatched = { ...attempt, request: { ...attempt.request, model: 'another-model' } }
    expect(attributeSimulationTokens([mismatched], {}, new Map([[sessionId, events]])).categories.unknown.attempts).toBe(1)
  })

  it('refuses duplicate reservation identities and unsafe totals', () => {
    const attempt = reservation('same', 'settled')
    expect(() => attributeSimulationTokens([attempt, attempt], {}, new Map())).toThrow(/Duplicate/)
    const unsafe = { ...attempt, usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } }
    expect(() => attributeSimulationTokens([unsafe], {}, new Map())).toThrow(/safe integer/)
  })
})
