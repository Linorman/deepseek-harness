import { expect, it } from 'vitest'
import { simulationProductRuntimeMetricsSchema } from '../src/schema.ts'

function metrics() {
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const bucket = { attempts: 0, statuses: { reserved: 0, unknown: 0, settled: 0, 'not-dispatched': 0 },
    outstandingReservedTokens: 0, settled: usage, unknownReported: usage }
  return { budgets: { interval: '0', width: '100', tokens: { charged: 0, limit: 100, unknownAttempts: 0 },
    decisions: { used: 0, limit: 10 }, messages: { used: 0, limit: 10 } },
  residentSlots: { used: 0, limit: 1, recoveryRequired: 0 }, pendingDecisionCount: 0,
  pendingExternalOperationCount: 0, unknownOperationCount: 0,
  tokenAttribution: { total: bucket, categories: { 'business-choice': bucket, adjudication: bucket,
    'result-closeout': bucket, communication: bucket, compaction: bucket, unknown: bucket } } }
}

it('requires mutually exclusive usage categories and exactly reconciled token/status buckets', () => {
  const valid = metrics()
  expect(simulationProductRuntimeMetricsSchema.parse(valid).tokenAttribution.total.attempts).toBe(0)
  const altered = structuredClone(valid)
  altered.tokenAttribution.total.settled.cacheReadTokens = 1
  expect(() => simulationProductRuntimeMetricsSchema.parse(altered)).toThrow(/reconcile/)
  const statusMismatch = structuredClone(valid)
  statusMismatch.tokenAttribution.categories.unknown.statuses.unknown = 1
  expect(() => simulationProductRuntimeMetricsSchema.parse(statusMismatch)).toThrow(/reconcile/)
  const privateBody = { ...valid, tokenAttribution: { ...valid.tokenAttribution, privateBody: 'hidden' } }
  expect(() => simulationProductRuntimeMetricsSchema.parse(privateBody)).toThrow()
})
