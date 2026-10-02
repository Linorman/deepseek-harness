/** Detached, bounded log observations do not acquire backend or stream writer ownership. */
import type { LogCheckpoint, LogEntry, LogStreamDescriptor } from './log.ts'
import { StorageError } from './error.ts'

/** Explicit IO allowances supplied by the observation owner. */
export interface LogReadLimits {
  /** Maximum retained rows returned by this observation. */
  readonly maxEntries: number
  /** Maximum encoded journal payload and complete returned JSON bytes, including checkpoint and metadata. */
  readonly maxBytes: number
}

/** One consistent detached retained log prefix and optional checkpoint. */
export interface LogReadSnapshot extends LogStreamDescriptor {
  readonly firstSequence: number
  readonly tailSequence: number
  readonly entries: readonly LogEntry[]
  readonly checkpoint?: LogCheckpoint | undefined
}

/**
 * Validate observation configuration before filesystem or database IO.
 * @param descriptor - Expected opaque stream identity and durable format.
 * @param limits - Explicit row and complete-byte allowances.
 */
export function assertLogReadRequest(descriptor: LogStreamDescriptor, limits: LogReadLimits): void {
  if (!descriptor.name || !Number.isSafeInteger(descriptor.version) || descriptor.version < 0) {
    throw new StorageError('invalid-value', 'Read-only log descriptor must have a name and non-negative safe format version')
  }
  if (![limits.maxEntries, limits.maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new StorageError('invalid-value', 'Read-only log allowances must be positive safe integers')
  }
}

/**
 * Validate medium-derived continuity and enforce the complete returned JSON allowance.
 * @param snapshot - Detached rows and metadata from one consistent medium observation.
 * @param limits - Validated observation allowances.
 * @returns the validated bounded snapshot.
 */
export function boundedLogReadSnapshot(snapshot: LogReadSnapshot, limits: LogReadLimits): LogReadSnapshot {
  const { entries, firstSequence, tailSequence, checkpoint } = snapshot
  if (!Number.isSafeInteger(firstSequence) || firstSequence < 0 || !Number.isSafeInteger(tailSequence) || tailSequence < -1
    || entries.length === 0 && (firstSequence !== 0 || tailSequence !== -1)
    || entries.some((entry, index) => entry.sequence !== firstSequence + index)
    || entries.length > 0 && entries.at(-1)?.sequence !== tailSequence
    || checkpoint !== undefined && (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < -1
      || checkpoint.sequence > tailSequence || checkpoint.sequence >= 0 && checkpoint.sequence < firstSequence)) {
    throw new StorageError('malformed-medium', 'Read-only log observation has inconsistent sequence metadata')
  }
  if (entries.length > limits.maxEntries || Buffer.byteLength(JSON.stringify(snapshot)) > limits.maxBytes) {
    throw new StorageError('invalid-value', 'Read-only log observation exceeds its row or complete-byte allowance')
  }
  return snapshot
}
