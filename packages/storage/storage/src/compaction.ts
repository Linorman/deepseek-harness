/** Shared checkpoint-gated log compaction validation for storage backends. @module @clocky/clocky-storage/src/compaction */

import { StorageError } from './error.ts'
import { EMPTY_LOG_SEQUENCE } from './log.ts'
import type { LogCompactionRequest } from './log.ts'

/**
 * Validate one caller-supplied compaction fence before backend work begins.
 * @param request - prefix bound and exact checkpoint watermark.
 */
export function assertLogCompactionRequest(request: LogCompactionRequest): void {
  assertSequence('throughSequence', request.throughSequence)
  if (!Number.isSafeInteger(request.expectedCheckpointSequence) || request.expectedCheckpointSequence < 0) {
    throw new Error('expectedCheckpointSequence must be a non-negative safe integer')
  }
}

/**
 * Reject compaction unless an exact later checkpoint can rebuild the removed prefix.
 * @param name - stream name used in the diagnostic.
 * @param tail - current durable stream tail.
 * @param checkpointSequence - currently stored checkpoint watermark.
 * @param request - requested prefix bound and checkpoint fence.
 */
export function assertLogCompactionBounds(
  name: string,
  tail: number,
  checkpointSequence: number | undefined,
  request: LogCompactionRequest,
): void {
  if (checkpointSequence !== request.expectedCheckpointSequence
    || request.expectedCheckpointSequence > tail
    || request.expectedCheckpointSequence <= request.throughSequence
    || request.throughSequence >= tail) {
    throw new StorageError(
      'checkpoint-conflict',
      `log stream '${name}' cannot compact through ${request.throughSequence} without checkpoint ${request.expectedCheckpointSequence} after its retained tail ${tail}`,
    )
  }
}

/** Reject a sequence outside the append-only log's representable range. */
function assertSequence(name: string, sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < EMPTY_LOG_SEQUENCE) {
    throw new Error(`${name} must be a safe integer at least ${EMPTY_LOG_SEQUENCE}`)
  }
}
