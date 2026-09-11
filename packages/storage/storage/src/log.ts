/**
 * Append-only log vocabulary shared by storage backends.
 *
 * A log stream owns ordered opaque JSON values. Consumers supply the durable
 * tail they observed, so an append can reject a stale writer without silently
 * merging concurrent Team, channel, or task mutations.
 * @module @clocky/clocky-storage/src/log
 */

/** Initial tail sequence for an empty stream. */
export const EMPTY_LOG_SEQUENCE = -1

/** Static identity and durable format version of one append-only stream. */
export interface LogStreamDescriptor {
  /** Opaque non-empty stream name, such as `team/<TeamId>` or `channel/<ChannelId>`. */
  readonly name: string
  /** Non-negative format version stamped when the stream first materializes. */
  readonly version: number
}

/** One durably accepted log value. */
export interface LogEntry {
  /** Monotonic sequence assigned by the backend, initially beginning at zero; compaction never renumbers it. */
  readonly sequence: number
  /** Opaque JSON-serializable value owned and validated by the stream consumer. */
  readonly value: unknown
}

/** A rebuildable projection checkpoint and the complete stream prefix it covers. */
export interface LogCheckpoint {
  /** Sequence of the final entry reflected by {@link value}. */
  readonly sequence: number
  /** Opaque JSON-serializable projection value. */
  readonly value: unknown
}

/** Metadata for one durable stream, returned by {@link LogFacet.list}. */
export interface LogStreamInfo extends LogStreamDescriptor {
  /** Current durable tail, or {@link EMPTY_LOG_SEQUENCE} when no entry exists. */
  readonly tailSequence: number
  /** Latest checkpoint watermark when one has been stored. */
  readonly checkpointSequence?: number
}

/** Result of one successful atomic append. */
export interface LogAppendResult {
  /** Tail sequence after the complete batch is durable. */
  readonly tailSequence: number
}

/** Checkpoint-gated request to remove an obsolete log prefix. */
export interface LogCompactionRequest {
  /** Highest sequence removed from the retained prefix. */
  readonly throughSequence: number
  /** Exact durable checkpoint that proves the remaining suffix is rebuildable. */
  readonly expectedCheckpointSequence: number
}

/**
 * Append-only storage operations supplied by one backend. Backends serialize
 * and durably commit each stream independently; callers still provide
 * expected tails so retrying a command cannot silently duplicate a mutation.
 */
export interface LogFacet {
  /**
   * Open one durable stream. Opening a missing stream serves an empty stream
   * and materializes it on the first append or checkpoint write. A stamped
   * format version mismatch rejects with `version-mismatch`; opening the same
   * stream twice without closing is a caller error.
   * @param descriptor - Stream identity and expected format version.
   * @returns the caller-owned stream handle.
   */
  open(descriptor: LogStreamDescriptor): Promise<LogStream>

  /**
   * Enumerate materialized streams. A malformed stream rejects rather than
   * hiding durable state from recovery.
   * @returns stream metadata in stable name order.
   */
  list(): Promise<readonly LogStreamInfo[]>
}

/**
 * Caller-owned handle for one append-only stream. Every mutating operation is
 * atomic: a rejection leaves the durable tail and checkpoint unchanged.
 */
export interface LogStream extends LogStreamDescriptor {
  /** First retained sequence, or zero before any prefix has been compacted. */
  readonly firstSequence: number
  /** Current durable tail sequence, or {@link EMPTY_LOG_SEQUENCE} when empty. */
  readonly tailSequence: number

  /**
   * Append a non-empty batch only when the durable tail equals
   * `expectedSequence`. The complete batch receives contiguous sequences and
   * becomes visible together; a stale expected tail rejects with
   * `sequence-conflict`.
   * @param expectedSequence - Tail observed by the caller, or -1 for an empty stream.
   * @param values - Non-empty JSON-serializable values to append atomically.
   * @returns the tail after the batch is durable.
   */
  append(expectedSequence: number, values: readonly unknown[]): Promise<LogAppendResult>

  /**
   * Read at most `limit` entries strictly after `afterSequence`, preserving
   * ascending sequence order. The caller supplies a positive bounded limit;
   * reaching the tail returns an empty list.
   * @param afterSequence - Exclusive lower sequence bound, or -1 for the beginning.
   * @param limit - Positive maximum number of entries.
   * @returns a detached ordered entry page.
   */
  read(afterSequence: number, limit: number): Promise<readonly LogEntry[]>

  /**
   * Return the latest projection checkpoint, if one exists.
   * @returns a detached checkpoint or `undefined`.
   */
  readCheckpoint(): Promise<LogCheckpoint | undefined>

  /**
   * Persist a checkpoint whose watermark is no later than the current tail and
   * no earlier than the stored checkpoint. Older writers reject with
   * `checkpoint-conflict`; this makes checkpoint recovery monotonic.
   * @param checkpoint - Projection snapshot and its covered tail sequence.
   * @returns resolution after the checkpoint is durable.
   */
  writeCheckpoint(checkpoint: LogCheckpoint): Promise<void>

  /**
   * Remove entries through a sequence only when an exact later checkpoint is
   * durable. The checkpoint entry itself remains retained; readers that start
   * before the removed prefix receive `compacted` instead of a misleading gap.
   * @param request - prefix watermark and exact checkpoint fence.
   * @returns resolution after the prefix removal is durable.
   */
  compact(request: LogCompactionRequest): Promise<void>

  /**
   * Reject new operations, drain accepted work, and release the stream name.
   * Idempotent.
   * @returns resolution after release completes.
   */
  close(): Promise<void>
}
