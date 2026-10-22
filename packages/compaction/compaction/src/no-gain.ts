/** Durable no-gain evidence validation. @module @clocky/clocky-compaction/no-gain */
import type { CompactionNoGain } from './types.ts'

/**
 * Validate persisted evidence before it can suppress an auxiliary model call.
 * @param value - untrusted event payload field.
 * @returns whether the complete version-one evidence has valid hashes and non-shrinking prices.
 */
export function isCompactionNoGain(value: unknown): value is CompactionNoGain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const fields = ['fingerprint', 'contextFingerprint', 'prefixFingerprint', 'generation',
    'selectedNodes', 'selectedTokens', 'summaryTokens']
  if (Object.keys(record).length !== fields.length || fields.some(key => !Object.hasOwn(record, key))) return false
  for (const key of ['fingerprint', 'contextFingerprint', 'prefixFingerprint']) {
    if (typeof record[key] !== 'string' || !/^[a-f0-9]{64}$/.test(record[key])) return false
  }
  for (const key of ['generation', 'selectedNodes', 'selectedTokens', 'summaryTokens']) {
    if (typeof record[key] !== 'number' || !Number.isSafeInteger(record[key]) || record[key] < 0) return false
  }
  return (record.selectedNodes as number) > 0
    && (record.summaryTokens as number) >= (record.selectedTokens as number)
}

/** Validate a diagnostic event independently of the active summary lifecycle.
 * @param value - untrusted assessment data.
 * @returns whether categories and estimates obey the diagnostic schema.
 */
export function isCompactionAssessment(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.trigger !== 'pressure' && record.trigger !== 'context-overflow') return false
  if (!['attempt', 'no-gain', 'fixed-context', 'no-range'].includes(String(record.reason))) return false
  const counts = ['generation', 'pressureTokens', 'fixedTokens', 'selectedTokens', 'retainedTokens']
  for (const key of counts) {
    if (typeof record[key] !== 'number' || !Number.isSafeInteger(record[key]) || record[key] < 0) return false
  }
  if (record.outputReserveTokens !== null
    && (typeof record.outputReserveTokens !== 'number' || !Number.isSafeInteger(record.outputReserveTokens)
      || record.outputReserveTokens < 0)) return false
  return Object.keys(record).length === 8
}
