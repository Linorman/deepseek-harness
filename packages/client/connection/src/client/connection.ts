import type { HostDescription, IApiClient, HostFrame, MuxFrame, RpcRequest } from './api.ts'

/** Reconnect/backoff tunables (deployment-varying — no hardcoded tunables; these become the
 *  future `ctx.connection` plugin's Config). All fields optional; defaults below. */
export interface ConnectionConfig {
  /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
  backoffBaseMs?: number
  /** Exponential growth factor per consecutive failed attempt. */
  backoffFactor?: number
  /** Upper bound for the backoff cap in ms. */
  backoffMaxMs?: number
  /** Cap on waiting for both streams' onOpen before onConnected, in ms. The strict handshake
   *  waits for mux+host stream establishment plus describe; a carrier that never
   *  fires onOpen (misbehaving proxy) must not wedge the connection forever — on timeout the
   *  generation proceeds as connected and the live-gap repair path covers stragglers. */
  streamOpenTimeoutMs?: number
}

const CONNECTION_DEFAULTS: Required<ConnectionConfig> = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  streamOpenTimeoutMs: 3_000,
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** Coarse connection state for the UI: 'connected' after each generation's handshake,
 *  'reconnecting' the moment the generation fails (covers the whole backoff+retry span). */
export type ConnectionState = 'connected' | 'reconnecting'

/** Frame sink callbacks: the Controller owns the physical streams; business dispatch belongs to
 *  SessionManager. */
export interface ConnectionSinks {
  onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void
  onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void
  /** After each connection generation is established (both streams open + describe succeeded), first connect included. */
  onConnected?: (description: HostDescription) => void
  /** Coarse state transitions (deduplicated: fires only on change). The initial pre-connect
   *  span reports nothing — the UI treats "no state yet" as connecting, not as an outage. */
  onStateChange?: (state: ConnectionState) => void
  /** Current transport or handshake explicitly denied product access; retire principal-scoped data. */
  onAuthorizationLost?: () => void
}

/** Recognize explicit access refusals without treating network loss as a permission change. */
function authorizationLost(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error.code === 'PRODUCT_AUTH_INVALID' || error.code === 'PRODUCT_AUTH_REQUIRED')
}

/**
 * Opens both streams and keeps iterating (pull mode: nothing reads the socket and the tap
 * never fires unless someone for-awaits), reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * The pump body feeds each frame to a sink (sink exceptions must
 * not kill the pump — a broken business layer must not drag down the connection layer).
 */
export class ConnectionController {
  private generation = 0
  private attempt = 0
  private current: AbortController | null = null
  private lifecycle: 'idle' | 'running' | 'authorization-required' | 'stopped' = 'idle'
  private lastState: ConnectionState | null = null
  private readonly config: Required<ConnectionConfig>

  constructor(
    private readonly api: IApiClient,
    private readonly sinks: ConnectionSinks = {},
    config: ConnectionConfig = {},
  ) {
    this.config = { ...CONNECTION_DEFAULTS, ...config }
  }

  /** Idempotent: begin the connect/pump/reconnect loop. */
  start(): void {
    if (this.isRunning()) return
    this.lifecycle = 'running'
    void this.loop()
  }

  /** Retry a terminal authentication refusal once on explicit user request; other states ignore it. */
  retryAuthorization(): void {
    if (this.lifecycle !== 'authorization-required') return
    this.start()
  }

  /** Stop the loop and abort the current generation's streams. */
  stop(): void {
    this.lifecycle = 'stopped'
    this.current?.abort()
    this.current = null
  }

  private backoffDelay(attempt: number): number {
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config
    const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1))
    return cap / 2 + Math.random() * (cap / 2)
  }

  /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
  private isRunning(): boolean {
    return this.lifecycle === 'running'
  }

  /** Re-read both mutable liveness guards after a potentially reentrant sink. */
  private isGenerationActive(controller: AbortController): boolean {
    return this.isRunning() && !controller.signal.aborted
  }

  private async loop(): Promise<void> {
    while (this.isRunning()) {
      const gen = ++this.generation
      const ac = new AbortController()
      this.current = ac
      let releaseReady!: () => void
      const ready = new Promise<void>((resolve) => { releaseReady = resolve })
      ac.signal.addEventListener('abort', releaseReady, { once: true })
      let denied = false
      const reportDenial = (error: unknown): void => {
        if (gen !== this.generation || !this.isRunning() || denied || !authorizationLost(error)) return
        denied = true
        this.lifecycle = 'authorization-required'
        ac.abort()
        this.callSink(() => { this.sinks.onAuthorizationLost?.() })
      }

      /* v8 ignore next -- initializer placeholder: the Promise executor
       * below runs synchronously and replaces it before anyone can call it. */
      let muxOpened = (): void => {}
      /* v8 ignore next -- same placeholder pattern as muxOpened. */
      let hostOpened = (): void => {}
      const streamsOpen = Promise.all([
        new Promise<void>((resolve) => { muxOpened = resolve }),
        new Promise<void>((resolve) => { hostOpened = resolve }),
      ])

      const failed = new Promise<void>((resolve) => {
        const settle = (error?: unknown): void => {
          reportDenial(error)
          if (gen === this.generation && !ac.signal.aborted) ac.abort()
          resolve()
        }
        void this.pumpStream(this.api.events.mux({}, ac.signal, muxOpened), this.sinks.onMuxEnvelope, settle, ready,
          () => this.isGenerationActive(ac))
        void this.pumpStream(this.api.events.host({}, ac.signal, hostOpened), this.sinks.onHostEnvelope, settle, ready,
          () => this.isGenerationActive(ac))
      })

      const timeout = new AbortController()
      try {
        // Strict readiness handshake: describe proves unary reachability, onOpen
        // proves each physical stream is established before any frame —
        // only then may onConnected fire, so the resync it triggers cannot outrun the
        // subscribed baseline. The timeout guards against a carrier that never fires onOpen
        // (see ConnectionConfig.streamOpenTimeoutMs).
        const [description] = await Promise.all([
          this.api.host.describe({}, ac.signal),
          Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)]),
        ])
        const descriptionResult = description.result
        if (!descriptionResult.ok) {
          throw Object.assign(new Error(`host.describe failed: ${descriptionResult.error.code}`), { code: descriptionResult.error.code })
        }
        if (ac.signal.aborted) throw new Error('generation aborted during readiness handshake')
        this.attempt = 0
        this.emitState('connected')
        // A state sink may synchronously stop this controller. Do not publish
        // a description for a generation that no longer exists afterward.
        if (this.isGenerationActive(ac)) {
          this.callSink(() => { this.sinks.onConnected?.(descriptionResult.value) })
        }
        if (this.isGenerationActive(ac)) releaseReady()
      } catch (error: unknown) {
        reportDenial(error)
        // Transport failure: treat as generation failure, fall through to the shared backoff.
        if (!ac.signal.aborted) ac.abort()
      }
      timeout.abort()

      ac.signal.removeEventListener('abort', releaseReady)

      await failed
      if (!this.isRunning() || gen !== this.generation) return
      this.emitState('reconnecting')
      this.attempt += 1
      console.warn(`[web-runtime] connection lost, retry #${this.attempt}`)
      const idle = new AbortController()
      this.current = idle
      await sleep(this.backoffDelay(this.attempt), idle.signal)
      if (gen !== this.generation) return
    }
  }

  /** Deduplicated state emission (sink isolation applies). */
  private emitState(state: ConnectionState): void {
    if (this.lastState === state) return
    this.lastState = state
    this.callSink(() => this.sinks.onStateChange?.(state))
  }

  private async pumpStream<F extends { type: string }>(
    stream: AsyncIterable<RpcRequest<F>>,
    sink: ((envelope: RpcRequest<F>) => void) | undefined,
    onEnd: (error?: unknown) => void,
    ready: Promise<void>,
    active: () => boolean,
  ): Promise<void> {
    try {
      for await (const envelope of stream) {
        if (envelope.payload.type === 'stream/error') {
          const frame = envelope.payload
          onEnd('error' in frame ? frame.error : undefined)
          return
        }
        await ready
        if (!active()) { onEnd(); return }
        if (sink !== undefined) this.callSink(() => { sink(envelope) })
      }
    } catch (error: unknown) {
      // Stream loss: converge on onEnd, which triggers the shared reconnect.
      onEnd(error)
      return
    }
    onEnd()
  }

  /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
  private callSink(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      console.error('[web-runtime] connection sink threw:', error)
    }
  }
}
