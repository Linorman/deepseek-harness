/**
 * Error vocabulary for the storage hub and its backends.
 * @module @clocky/clocky-storage/src/error
 */

/** Discriminant codes carried by every {@link StorageError}. */
export type StorageErrorCode =
  | 'backend-not-found'
  | 'form-not-mounted'
  | 'duplicate-backend'
  | 'duplicate-mount'
  | 'version-mismatch'
  | 'malformed-medium'
  | 'invalid-value'
  | 'read-limit'
  | 'sequence-conflict'
  | 'checkpoint-conflict'
  | 'compacted'
  | 'writer-locked'
  | 'closed'

/**
 * Error thrown by the hub and by backend implementations. The `code` is the
 * stable contract consumers may switch on; `message` is diagnostic prose.
 */
export class StorageError extends Error {
  override readonly name = 'StorageError'
  /** Stable discriminant for the failure class. */
  readonly code: StorageErrorCode

  /**
   * @param code - Stable discriminant for the failure class.
   * @param message - Human-readable diagnostic detail.
   * @param options - Standard error options (`cause`).
   */
  constructor(
    code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
  }
}

/** Safe numerical read refusal. Physical paths and source bodies remain in server-side diagnostics only. */
export class StorageReadLimitError extends StorageError {
  /** @param dimension - Observed quota dimension. @param actual - Complete measured demand. @param limit - Configured bound. */
  constructor(readonly dimension: 'entries' | 'bytes' | 'entry-bytes', readonly actual: number, readonly limit: number) {
    super('read-limit', 'Read-only log observation exceeds its configured allowance')
  }
}
