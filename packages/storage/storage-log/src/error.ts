/** Error vocabulary of the append-only storage-log data form. @module @clocky/clocky-storage-log/src/error */

/** Discriminant codes carried by every {@link StorageLogError}. */
export type StorageLogErrorCode = 'already-open' | 'facet-unsupported' | 'closed'

/**
 * Error thrown by the data form. Backend durability errors retain their
 * `StorageError` identity and pass through unchanged.
 */
export class StorageLogError extends Error {
  override readonly name = 'StorageLogError'
  /** Stable failure class for callers to switch on. */
  readonly code: StorageLogErrorCode

  /**
   * @param code - Stable failure class for callers to switch on.
   * @param message - Human-readable diagnostic detail.
   * @param options - Standard error options, including a causal failure.
   */
  constructor(
    code: StorageLogErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
  }
}
