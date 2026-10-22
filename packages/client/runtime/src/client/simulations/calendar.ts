/** One bounded calendar command owns its original quote across uncertain transport; React only renders this source. */
import type { Context } from '@clocky/cordis'
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import type { SimulationProductCalendarInput, SimulationProductCalendarPreview, SimulationProductCalendarReceipt, SimulationProductCalendarCommandResult } from '@clocky/clocky-simulation-product/types'
import { simulationProductCalendarInputSchema, simulationProductCalendarPreviewSchema, simulationProductCalendarReceiptSchema, simulationProductCalendarCommandResultSchema, simulationProductCalendarCommandInputSchema } from '@clocky/clocky-simulation-product/schema'
import { createSnapshotStore } from '../contract/store.ts'
import type { SimulationRuntime } from './service.ts'

/** One original command; unknown outcome cannot be overwritten by a new preview. */
export interface SimulationCalendarState {
  readonly status: 'idle' | 'previewing' | 'ready' | 'submitting' | 'unknown' | 'completed' | 'error' | 'recovering' | 'cancelling' | 'cancelled'
  readonly input?: SimulationProductCalendarInput | undefined
  readonly preview?: SimulationProductCalendarPreview | undefined
  readonly receipt?: SimulationProductCalendarReceipt | undefined
  readonly error?: string | undefined
  readonly phase?: 'retention' | 'execution' | undefined
}
/** Explicit consumer allowances bound complete retained payloads and each transport wait. */
export interface SimulationCalendarOptions { readonly maxBytes: number; readonly timeoutMs: number }
/** Single-original preview/submit owner; exact retries cannot mint a replacement command. */
export class SimulationCalendarRuntime {
  /** Original quote, uncertain submission and durable receipt owned independently of UI components. */
  readonly state = createSnapshotStore<SimulationCalendarState>({ status: 'idle' })
  private epoch = 0
  private pending: AbortController | undefined
  private retired = false
  private authority: number
  private recoveryScope = ''
  private readonly jobs = new Set<Promise<void>>()

  /** @param ctx - Consumer lifetime. @param api - Authenticated transport. @param source - Current run and authority.
   * @param options - Finite complete payload and transport-wait bounds. */
  constructor(ctx: Context, private readonly api: IApiClient, private readonly source: SimulationRuntime,
    private readonly options: SimulationCalendarOptions) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1
      || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
      throw new Error('Calendar runtime requires positive finite byte and wait allowances')
    this.authority = source.state.getSnapshot().authorizationVersion
    ctx.effect(() => source.state.subscribe(() => {
      const current = source.state.getSnapshot()
      if (current.authorizationVersion !== this.authority) {
        this.authority = current.authorizationVersion; this.clear(); this.recoveryScope = ''
      }
      this.synchronize()
    }), 'calendar command authority')
    ctx.effect(() => async () => { this.retired = true; this.clear(); await Promise.allSettled([...this.jobs]) }, 'calendar command lifetime')
    this.synchronize()
  }

  /** Validate one complete proposed edit without mutating the run.
   * @param raw - Complete authored command.
   * @returns settlement without mutation or inference.
   */
  preview(raw: SimulationProductCalendarInput): Promise<void> {
    const input = simulationProductCalendarInputSchema.parse(raw)
    const current = this.state.getSnapshot()
    if (['submitting', 'unknown', 'recovering', 'cancelling'].includes(current.status)) return Promise.reject(new Error('Resolve the original calendar command before replacing it'))
    this.bytes(input); this.clear()
    return this.track(this.perform(input, false))
  }

  /** Submit the retained quote or retry that exact same quote after unknown transport outcome. */
  submit(): Promise<void> {
    const current = this.state.getSnapshot()
    if (current.status === 'submitting') return Promise.resolve()
    if (current.status !== 'ready' && current.status !== 'unknown' || current.input === undefined || current.preview === undefined)
      return Promise.reject(new Error('Calendar submission requires its original ready or unknown quote'))
    return this.track(this.perform(current.input, true))
  }

  /** Dismiss settled/read-only state; uncertain business responsibility must first be retried.
   * @returns false while a submission is pending or unknown; otherwise clears the retained slot.
   */
  close(): boolean {
    if (['submitting', 'unknown', 'recovering', 'cancelling'].includes(this.state.getSnapshot().status)) return false
    this.clear(); return true
  }

  /** Recover an original retained quote after refresh without acquiring execution ownership.
   * @param runId - Current selected Product run.
   * @returns original author-scoped pending or settled state; no calendar effect is issued.
   */
  recover(runId: string): Promise<void> {
    if (this.pending !== undefined) return Promise.resolve()
    const original = this.state.getSnapshot()
    if (original.status === 'unknown' && original.input !== undefined && original.input.runId !== runId) return Promise.resolve()
    const input = simulationProductCalendarCommandInputSchema.parse({ runId,
      ...original.input?.runId === runId ? { commandId: original.input.request.commandId } : {} })
    return this.track(this.inspectCommand(input, false))
  }

  /** Withdraw only the retained, unexecuted original; an application race remains completed.
   * @returns the Native cancellation/application outcome while preserving unknown transport responsibility.
   */
  cancel(): Promise<void> {
    const original = this.state.getSnapshot()
    if (original.input === undefined || this.pending !== undefined) return Promise.resolve()
    return this.track(this.inspectCommand({ runId: original.input.runId, commandId: original.input.request.commandId }, true))
  }

  private synchronize(): void {
    const source = this.source.state.getSnapshot(), runId = source.observation.value?.runId
    if (!source.connected || runId === undefined || source.run.scope !== JSON.stringify(['run', runId])) return
    const signature = JSON.stringify([source.authorizationVersion, runId])
    if (signature === this.recoveryScope) return
    this.recoveryScope = signature
    if (this.state.getSnapshot().status === 'idle') void this.recover(runId)
  }

  private recovered(value: SimulationProductCalendarCommandResult, original: SimulationCalendarState): void {
    const command = value.command
    if (command === null) {
      this.state.set(original.input === undefined ? { status: 'idle' } : { ...original, status: original.phase === 'retention' ? 'error' : 'unknown', error: 'not-retained' })
      return
    }
    this.bytes(command)
    this.state.set({ input: command.preview.input, preview: command.preview,
      ...command.receipt === null ? {} : { receipt: command.receipt },
      phase: 'execution', status: command.status === 'applied' ? 'completed' : command.status === 'cancelled' ? 'cancelled' : 'unknown' })
  }

  private async inspectCommand(input: { runId: SimulationProductCalendarInput['runId']; commandId?: string | undefined }, cancelling: boolean): Promise<void> {
    const source = this.source.state.getSnapshot(), original = this.state.getSnapshot()
    if (this.retired || !source.connected || source.run.scope !== JSON.stringify(['run', input.runId])) return
    const controller = new AbortController(), epoch = this.epoch
    this.pending = controller; this.state.set({ ...original, status: cancelling ? 'cancelling' : 'recovering' })
    const timer = setTimeout(() => { controller.abort() }, this.options.timeoutMs)
    let remove = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      const listener = () => { reject(new Error('Calendar recovery timed out')) }
      controller.signal.addEventListener('abort', listener, { once: true })
      remove = () => { controller.signal.removeEventListener('abort', listener) }
    })
    try {
      const operation = cancelling && input.commandId !== undefined
        ? this.api.simulations.cancelWorldCalendar({ runId: input.runId, commandId: input.commandId }, controller.signal)
        : this.api.simulations.readWorldCalendarCommand(input, controller.signal)
      const response = await Promise.race([operation, aborted])
      if (epoch !== this.epoch) return
      if (!response.result.ok) {
        if (['PRODUCT_AUTH_INVALID', 'PRODUCT_AUTH_REQUIRED', 'simulation-product-forbidden'].includes(response.result.error.code)) {
          this.source.clearAuthorization(); return
        }
        throw new Error(response.result.error.code)
      }
      const result = simulationProductCalendarCommandResultSchema.parse(response.result.value)
      if (result.command !== null && (result.command.preview.input.runId !== input.runId
        || input.commandId !== undefined && result.command.preview.input.request.commandId !== input.commandId))
        throw new Error('Calendar recovery returned another original command')
      this.recovered(result, original)
    } catch (error) {
      if (epoch === this.epoch) this.state.set({ ...original, status: 'unknown',
        error: error instanceof Error ? error.message : 'Calendar recovery failed' })
    } finally { clearTimeout(timer); remove(); if (this.pending === controller) this.pending = undefined }
  }

  private track(job: Promise<void>): Promise<void> {
    this.jobs.add(job); void job.then(() => this.jobs.delete(job), () => this.jobs.delete(job)); return job
  }
  private clear(): void {
    this.epoch++; const pending = this.pending; this.pending = undefined
    this.state.set({ status: 'idle' }); pending?.abort()
  }
  private bytes(value: unknown): void {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > this.options.maxBytes) throw new Error('Complete calendar command exceeds its retained byte allowance')
  }
  private async perform(input: SimulationProductCalendarInput, submitting: boolean): Promise<void> {
    const source = this.source.state.getSnapshot()
    if (this.retired || !source.connected || source.run.scope !== JSON.stringify(['run', input.runId]))
      throw new Error('Calendar command is outside the active authenticated run')
    const original = this.state.getSnapshot(), quote = original.preview
    let phase: 'retention' | 'execution' = 'retention'
    const controller = new AbortController(), epoch = this.epoch
    this.pending = controller
    this.state.set({ ...original, input, status: submitting ? 'submitting' : 'previewing', error: undefined })
    const timer = setTimeout(() =>{  controller.abort() }, this.options.timeoutMs)
    let remove = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      const listener = () =>{  reject(new Error('Calendar request timed out or was cancelled')) }
      controller.signal.addEventListener('abort', listener, { once: true })
      remove = () =>{  controller.signal.removeEventListener('abort', listener) }
    })
    try {
      const operation = async () => {
        if (!submitting) return await this.api.simulations.previewWorldCalendar(input, controller.signal)
        if (quote === undefined) throw new Error('Calendar quote is missing')
        const payload = { input: quote.input, revision: quote.revision, previewHash: quote.previewHash }
        const retained = await this.api.simulations.retainWorldCalendar(payload, controller.signal)
        if (controller.signal.aborted || epoch !== this.epoch) throw new Error('Calendar retention response is no longer current')
        if (!retained.result.ok) return { ...retained, result: retained.result }
        const result = simulationProductCalendarCommandResultSchema.parse(retained.result.value)
        if (result.command === null || JSON.stringify(result.command.preview.input) !== JSON.stringify(input)
          || result.command.preview.previewHash !== quote.previewHash) throw new Error('Calendar retention changed the original quote')
        phase = 'execution'
        if (result.command.status !== 'retained') { this.recovered(result, original); return null }
        return await this.api.simulations.submitWorldCalendar(payload, controller.signal)
      }
      const reply = await Promise.race([operation(), aborted])
      if (epoch !== this.epoch || reply === null) return
      if (!reply.result.ok) {
        const code = reply.result.error.code
        if (code === 'PRODUCT_AUTH_INVALID' || code === 'PRODUCT_AUTH_REQUIRED' || code === 'simulation-product-forbidden') {
          this.source.clearAuthorization(); return
        }
        this.state.set({ ...original, input, phase, status: submitting && code !== 'simulation-product-management-preview-changed' ? 'unknown' : 'error', error: code })
        return
      }
      this.bytes(reply.result.value)
      if (submitting) {
        const receipt = simulationProductCalendarReceiptSchema.parse(reply.result.value)
        if (receipt.runId !== input.runId || receipt.commandId !== input.request.commandId) throw new Error('Calendar receipt changed original identity')
        this.state.set({ input, preview: quote, receipt, status: 'completed' })
      } else {
        const preview = simulationProductCalendarPreviewSchema.parse(reply.result.value)
        if (JSON.stringify(preview.input) !== JSON.stringify(input)) throw new Error('Calendar quote changed original content')
        this.state.set({ input, preview, status: 'ready' })
      }
    } catch (error) {
      if (epoch === this.epoch) this.state.set({ ...original, input, phase,
        status: submitting ? 'unknown' : 'error', error: error instanceof Error ? error.message : 'Calendar transport failed' })
    } finally { clearTimeout(timer); remove(); if (this.pending === controller) this.pending = undefined }
  }
}
