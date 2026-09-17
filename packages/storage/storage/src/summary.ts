/** Tail-summary validation shared by bounded log metadata readers.
 * Summaries are consumer projections, not proof that journal history is valid.
 * @module @clocky/clocky-storage/src/summary
 */

import { StorageError } from './error.ts'
import type { LogSummary, LogStreamDescriptor } from './log.ts'

/** Validate the identity and tail of one detached metadata object.
 * @param value - Parsed backend metadata, including an optional consumer summary.
 * @param descriptor - Consumer-owned stream identity and format.
 * @returns the tail summary, or undefined when the last append supplied none.
 */
export function parseLogSummary(value: unknown, descriptor: LogStreamDescriptor): LogSummary | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StorageError('malformed-medium', `log '${descriptor.name}' has invalid summary metadata`)
  }
  const header = value as Record<string, unknown>
  if (header['name'] !== descriptor.name || typeof header['version'] !== 'number'
    || !Number.isSafeInteger(header['version']) || header['version'] < 0
    || typeof header['tailSequence'] !== 'number' || !Number.isSafeInteger(header['tailSequence']) || header['tailSequence'] < -1) {
    throw new StorageError('malformed-medium', `log '${descriptor.name}' has invalid summary identity or tail`)
  }
  if (header['version'] !== descriptor.version) {
    throw new StorageError('version-mismatch', `log '${descriptor.name}' summary format does not match version ${descriptor.version}`)
  }
  return Object.hasOwn(header, 'summary') ? { sequence: header['tailSequence'], value: header['summary'] } : undefined
}
