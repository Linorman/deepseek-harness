/** Bounded serialized SDK notification publication, including authorization and transport drain. */
import { Buffer } from 'node:buffer'

/** Deployment allowance for notifications awaiting publication. */
export interface NotificationLimits {
  readonly frames: number
  readonly bytes: number
}

/** One notification whose publisher must check current authority immediately before writing. */
export interface PendingNotification {
  readonly method: string
  readonly params: object
  readonly publish: (signal: AbortSignal) => Promise<void>
}

/** Own one ordered queue; overflow fails the notification stream rather than losing an arbitrary middle frame. */
export class NotificationQueue {
  private pending: { packet: PendingNotification; bytes: number }[] = []
  private frames = 0
  private bytes = 0
  private controller = new AbortController()
  private failed = false
  private running: Promise<void> | undefined

  /**
   * @param limits - Positive safe count and serialized-byte allowances.
   * @param failure - Transport owner callback for a terminal publication failure.
   */
  constructor(private readonly limits: NotificationLimits, private readonly failure: (error: Error) => void) {
    if (!Number.isSafeInteger(limits.frames) || limits.frames <= 0 || !Number.isSafeInteger(limits.bytes) || limits.bytes <= 0) {
      throw new Error('SDK notification allowances must be positive safe integers')
    }
  }

  /** Start a new connection generation; pending packets from the previous one cannot publish. */
  reset(): void {
    this.controller.abort()
    this.controller = new AbortController()
    this.pending = []
    this.frames = 0
    this.bytes = 0
    this.failed = false
  }

  /** Stop new notification admission and drop packets which have not published. */
  stop(): void {
    this.reset()
    this.failed = true
  }

  /** Enqueue one exact packet without permitting unbounded accumulation.
   * @param packet - Immutable notification and its current-authority publisher.
   */
  push(packet: PendingNotification): void {
    if (this.failed) return
    const bytes = Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', method: packet.method, params: packet.params }) + '\n')
    if (this.frames === this.limits.frames || this.bytes + bytes > this.limits.bytes) {
      this.stop()
      this.fail(new Error('SDK notification backlog exceeded its configured allowance'))
      return
    }
    this.pending.push({ packet, bytes })
    this.frames++
    this.bytes += bytes
    this.start()
  }

  /** Await publication of admitted packets; used before transport or credential retirement.
   * @returns completion after the active publisher settles.
   */
  async drain(): Promise<void> {
    while (this.running !== undefined) await this.running
  }

  private fail(error: Error): void {
    try { this.failure(error) }
    catch {
      // A transport-owner callback cannot revive this failed queue or reject its publisher.
    }
  }

  private start(): void {
    this.running ??= this.publish().finally(() => {
      this.running = undefined
      if (this.pending.length > 0) this.start()
    })
  }

  private async publish(): Promise<void> {
    while (this.pending.length > 0 && !this.failed) {
      const controller = this.controller
      const entry = this.pending.shift() as { packet: PendingNotification; bytes: number }
      try { await entry.packet.publish(controller.signal) }
      catch (_error: unknown) {
        if (controller === this.controller) {
          this.stop()
          this.fail(new Error('SDK notification publication failed'))
        }
      }
      if (controller === this.controller) { this.frames--; this.bytes -= entry.bytes }
    }
  }
}
