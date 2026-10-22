/** Bounded, cancellable admission for live Simulation model streams. @module @clocky/clocky-simulation-team/model-capacity */
interface Waiter {
  readonly resolve: (release: () => void) => void
  readonly reject: (error: unknown) => void
  readonly signal?: AbortSignal
  readonly abort: () => void
}

/** Typed refusal preserving the exact occupied pool and queue at admission. */
export class SimulationModelCapacityExceeded extends Error {
  /** @param usage - Observed occupancy at the failed admission, independent of later releases. */
  constructor(readonly usage: { readonly active: number; readonly queued: number; readonly limit: number; readonly queueLimit: number }) {
    super('Simulation model admission queue capacity exceeded')
  }
}

/** A permit remains charged until its stream owner confirms completion. */
export class SimulationModelCapacity {
  private readonly active = new Set<symbol>()
  private readonly queue: Waiter[] = []
  private closed = false

  constructor(private readonly limit: number, private readonly queueLimit: number) {}

  /**
   * Reserve a model permit or join the bounded FIFO queue.
   * @param signal - Cancels waiting only; a granted permit remains its caller's responsibility.
   * @returns an idempotent release function owned by the downstream stream's finally block.
   */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.closed) return Promise.reject(new Error('Simulation model admission is closed'))
    if (signal?.aborted) return Promise.reject(this.cancelled(signal))
    if (this.active.size < this.limit && this.queue.length === 0) return Promise.resolve(this.grant())
    if (this.queue.length >= this.queueLimit) return Promise.reject(new SimulationModelCapacityExceeded(this.snapshot()))
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, ...signal === undefined ? {} : { signal }, abort: () => {
        const index = this.queue.indexOf(waiter)
        if (index < 0) return
        this.queue.splice(index, 1)
        signal?.removeEventListener('abort', waiter.abort)
        reject(this.cancelled(signal))
      } }
      this.queue.push(waiter)
      signal?.addEventListener('abort', waiter.abort, { once: true })
    })
  }

  /**
   * Inspect live admission without exposing actor identities.
   * @returns reserved/executing permits, waiting requests and configured limits.
   */
  snapshot(): { readonly active: number; readonly queued: number; readonly limit: number; readonly queueLimit: number } {
    return { active: this.active.size, queued: this.queue.length, limit: this.limit, queueLimit: this.queueLimit }
  }

  /** Reject waiting and future requests; active streams retain their permits until they settle. */
  close(): void {
    this.closed = true
    for (const waiter of this.queue.splice(0)) {
      waiter.signal?.removeEventListener('abort', waiter.abort)
      waiter.reject(new Error('Simulation model admission is closed'))
    }
  }

  private grant(): () => void {
    const token = Symbol()
    this.active.add(token)
    return () => {
      if (!this.active.delete(token)) return
      this.drain()
    }
  }

  private drain(): void {
    while (!this.closed && this.active.size < this.limit) {
      const waiter = this.queue.shift()
      if (waiter === undefined) return
      waiter.signal?.removeEventListener('abort', waiter.abort)
      if (waiter.signal?.aborted) waiter.reject(this.cancelled(waiter.signal))
      else waiter.resolve(this.grant())
    }
  }

  private cancelled(signal?: AbortSignal): Error {
    return new Error('Simulation model admission cancelled', { cause: signal?.reason })
  }
}
