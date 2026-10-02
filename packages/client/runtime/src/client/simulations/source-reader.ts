/** One visible frozen source has its own bounded page, permission refresh and cancellation lifetime. */
import type { Context } from '@clocky/cordis'
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import type { SimulationProductSourceInput, SimulationProductSourceInspection } from '@clocky/clocky-simulation-product/types'
import type { SimulationRuntime, SimulationReadState } from './service.ts'

/** Source coordinates are stable independently of lookup and content pagination.
 * @param input - Exact frozen source identity.
 * @returns stable scope shared with the view consumer. */
export function simulationSourceScope(input: SimulationProductSourceInput): string {
  return JSON.stringify([input.runId, input.decisionId, input.sourceIndex])
}

/** Runtime owner keeps Team permission checks independent of Simulation policy watches. */
export class SimulationSourceReader {
  private input: SimulationProductSourceInput | undefined
  private value: SimulationReadState<SimulationProductSourceInspection> = { loading: false, stale: false }
  private request: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private interval = 2000
  private epoch = 0
  private watchId = 0
  private signature = ''
  private authorization = 0
  private retired = false
  private readonly jobs = new Set<Promise<void>>()

  /**
   * @param ctx - Runtime lifetime.
   * @param api - Authenticated bounded source transport.
   * @param source - Connection and run-policy owner.
   * @param publish - Sole public source snapshot publisher.
   * @param denied - Product ownership/authentication invalidation.
   */
  constructor(ctx: Context, private readonly api: IApiClient, private readonly source: SimulationRuntime,
    private readonly publish: (value: SimulationReadState<SimulationProductSourceInspection>) => void,
    private readonly denied: () => void) {
    this.authorization = source.state.getSnapshot().authorizationVersion
    ctx.effect(() => source.state.subscribe(() => { this.synchronize() }))
    ctx.effect(() => async () => {
      this.retired = true; this.close()
      await Promise.allSettled([...this.jobs])
    })
  }

  /**
   * Observe one exact source until selection changes or its view leaves.
   * @param input - Safe frozen source selection and initial page allowance.
   * @param intervalMs - Positive deployment-owned real-time permission refresh interval.
   * @returns disposer for this watch only; older disposers cannot close a replacement.
   */
  watch(input: SimulationProductSourceInput, intervalMs: number): () => void {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) throw new Error('Invalid source refresh interval')
    const closing = this.watchId + 1
    this.close()
    if (this.watchId !== closing || this.retired) return () => {}
    const id = ++this.watchId
    this.interval = intervalMs
    this.input = { ...input }
    this.authorization = this.source.state.getSnapshot().authorizationVersion
    this.signature = ''
    this.synchronize()
    return () => { if (id === this.watchId) this.close() }
  }

  /**
   * Read an explicit continuation without changing the selected source.
   * @param input - Same source with its returned lookup/body cursor and position.
   * @returns completion after publication, refusal or cancellation.
   */
  read(input: SimulationProductSourceInput): Promise<void> {
    if (this.input === undefined || simulationSourceScope(input) !== simulationSourceScope(this.input)) return Promise.resolve()
    this.input = { ...input }
    return this.enqueue(false)
  }

  private enqueue(background: boolean): Promise<void> {
    const job = this.load(background)
    this.jobs.add(job)
    void job.then(() => this.jobs.delete(job), () => this.jobs.delete(job))
    return job
  }

  /** Restart the current original's first text page, or its first lookup page if not yet located. */
  refresh(): Promise<void> {
    if (this.input === undefined) return Promise.resolve()
    return this.read({ ...this.input, cursor: undefined, expectedRevision: undefined })
  }

  /** Clear the single source on policy or Team revocation, including unexposed canonical-ancestor authority. */
  revokeAccess(): void {
    if (this.input === undefined) return
    if (this.invalidate()) this.schedule()
  }

  /** Discard private content and cancel IO when the inspector leaves. */
  close(): void {
    const id = ++this.watchId
    this.input = undefined
    this.cancel()
    if (this.watchId === id) this.set({ loading: false, stale: false })
  }

  private synchronize(): void {
    if (this.retired || this.input === undefined) return
    const state = this.source.state.getSnapshot(), observation = state.observation.value
    const signature = JSON.stringify([state.generation, state.authorizationVersion, state.connected,
      state.run.scope, observation?.runId, observation?.readVersion, observation?.world.status])
    if (signature === this.signature) return
    this.signature = signature
    if (this.authorization !== state.authorizationVersion) {
      this.close(); return
    }
    if (state.run.scope !== JSON.stringify(['run', this.input.runId])) { this.invalidate(); return }
    if (!state.connected) {
      this.cancel(); this.set({ ...this.value, loading: false, stale: true }); return
    }
    if (observation?.runId !== this.input.runId || observation.world.status !== 'observed') { this.invalidate(); return }
    if (this.value.value?.readVersion === observation.readVersion && !this.value.stale) return
    if (this.invalidate()) void this.refresh()
  }

  private ready(): boolean {
    const state = this.source.state.getSnapshot(), observation = state.observation.value
    return !this.retired && this.input !== undefined && state.connected
      && observation?.runId === this.input.runId && observation.world.status === 'observed'
      && state.run.scope === JSON.stringify(['run', this.input.runId])
  }

  private async load(background: boolean): Promise<void> {
    const input = this.input
    if (input === undefined || !this.ready()) return
    const epoch = this.cancel()
    if (this.input !== input || this.epoch !== epoch || !this.ready()) return
    const controller = new AbortController()
    this.request = controller
    const active = () => this.request === controller && this.epoch === epoch && !controller.signal.aborted && this.ready()
    this.set({ ...this.value, scope: simulationSourceScope(input), loading: true,
      stale: this.value.scope === undefined ? false : this.value.stale, error: background ? this.value.error : undefined })
    try {
      if (!active()) return
      const response = await this.api.simulations.inspectSource(input, controller.signal)
      if (!active()) return
      if (!response.result.ok) {
        const code = response.result.error.code
        if (code === 'PRODUCT_AUTH_INVALID' || code === 'PRODUCT_AUTH_REQUIRED' || code === 'simulation-product-forbidden') {
          this.denied(); return
        }
        const error = code === 'simulation-product-stale' ? 'stale' : code === 'simulation-product-unavailable' ? 'unavailable' : 'invalid'
        this.input = { ...input, cursor: undefined, expectedRevision: undefined }
        this.set({ scope: simulationSourceScope(input), loading: false, stale: true, error }); return
      }
      const value = response.result.value
      const observed = this.source.state.getSnapshot().observation.value
      if (value.runId !== input.runId || value.decisionId !== input.decisionId || value.sourceIndex !== input.sourceIndex
        || value.readVersion !== observed?.readVersion
        || observed.world.status !== 'observed') {
        if (this.invalidate()) this.schedule(); return
      }
      // A lookup cursor is never reused as a text cursor after the immutable Envelope is located.
      if (value.status === 'found' && input.envelopeSequence === undefined) this.input = { ...input,
        envelopeSequence: value.envelope?.sequence, cursor: undefined, expectedRevision: undefined }
      this.set({ scope: simulationSourceScope(input), value, loading: false, stale: false })
    } catch {
      if (active()) this.set({ ...this.value, loading: false, stale: true, error: 'network' })
    } finally {
      if (this.request === controller) { this.request = undefined; this.schedule() }
    }
  }

  private invalidate(): boolean {
    const id = this.watchId, epoch = this.cancel()
    if (this.watchId !== id || this.epoch !== epoch) return false
    if (this.input !== undefined) this.input = { ...this.input, cursor: undefined, expectedRevision: undefined }
    this.set({ scope: this.value.scope, loading: false, stale: true })
    return this.watchId === id && this.epoch === epoch
  }
  private schedule(): void {
    clearTimeout(this.timer)
    if (!this.ready() || this.value.value?.status === 'searching') return
    const id = this.watchId, epoch = this.epoch
    this.timer = setTimeout(() => {
      if (this.input !== undefined && this.watchId === id && this.epoch === epoch) {
        this.input = { ...this.input, expectedRevision: undefined }
        void this.enqueue(true)
      }
    }, this.interval)
  }
  private cancel(): number {
    const epoch = ++this.epoch
    clearTimeout(this.timer); this.timer = undefined
    const request = this.request; this.request = undefined
    request?.abort()
    return epoch
  }
  private set(value: SimulationReadState<SimulationProductSourceInspection>): void { this.value = value; this.publish(value) }
}
