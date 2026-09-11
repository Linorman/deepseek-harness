/** Per-projection serialization and cursor-watch bookkeeping. @module @clocky/clocky-team-hub/activity */

/** One completed cursor watch. */
export type CursorWatchResult =
  | { readonly kind: 'changed'; readonly cursor: number }
  | { readonly kind: 'closed' }

/** Serializes commands for one durable projection without retaining rejected tails. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()

  /**
   * Run one operation after every earlier operation settles.
   * @param operation - mutation or recovery work for one projection.
   * @returns the operation's value or failure.
   */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

interface CursorWaiter {
  readonly afterCursor: number
  readonly resolve: (result: CursorWatchResult) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: (() => void) | undefined
}

/** Coordinates cursor-based waits after a projection has already loaded. */
export class CursorActivity {
  private readonly waiters = new Set<CursorWaiter>()
  private closed = false

  /**
   * Return immediately when `cursor` is newer than the caller's watermark,
   * otherwise register a waiter before the caller releases its projection queue.
   * @param cursor - projection cursor observed while holding its queue.
   * @param afterCursor - caller's exclusive durable watermark.
   * @param signal - optional cancellation of this wait only.
   * @returns the next changed cursor or the Hub-closed result.
   */
  wait(cursor: number, afterCursor: number, signal: AbortSignal | undefined): Promise<CursorWatchResult> {
    if (this.closed) return Promise.resolve({ kind: 'closed' })
    if (cursor > afterCursor) return Promise.resolve({ kind: 'changed', cursor })
    if (signal?.aborted === true) return Promise.reject(abortError(signal))
    return new Promise<CursorWatchResult>((resolve, reject) => {
      const waiter: CursorWaiter = {
        afterCursor,
        resolve,
        signal,
        onAbort: signal === undefined ? undefined : () => {
          this.waiters.delete(waiter)
          reject(abortError(signal))
        },
      }
      this.waiters.add(waiter)
      if (signal !== undefined && waiter.onAbort !== undefined) signal.addEventListener('abort', waiter.onAbort, { once: true })
      if (this.closed) this.settle(waiter, { kind: 'closed' })
    })
  }

  /**
   * Resolve all waiters whose exclusive watermark precedes a committed cursor.
   * @param cursor - newly committed projection cursor.
   */
  notify(cursor: number): void {
    for (const waiter of [...this.waiters]) {
      if (cursor > waiter.afterCursor) this.settle(waiter, { kind: 'changed', cursor })
    }
  }

  /** Resolve every remaining waiter when Hub admission closes. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of [...this.waiters]) this.settle(waiter, { kind: 'closed' })
  }

  /** Detach one waiter before resolving it. */
  private settle(waiter: CursorWaiter, result: CursorWatchResult): void {
    // v8 ignore next -- one public completion path removes each waiter before a second can reach this helper.
    if (!this.waiters.delete(waiter)) return
    if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
      waiter.signal.removeEventListener('abort', waiter.onAbort)
    }
    waiter.resolve(result)
  }
}

/** Preserve a caller-provided abort reason where available. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return signal.reason === undefined
    ? new Error('The operation was aborted')
    : new Error('The operation was aborted', { cause: signal.reason })
}
