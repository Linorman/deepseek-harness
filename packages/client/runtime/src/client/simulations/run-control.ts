/**
 * One original stop-target command per run. The Host persists the target and answers with a durable receipt; the
 * browser never chains it with starting or saving. An uncertain transport outcome keeps the exact command so that the
 * retry reuses its identity and payload, which the Host answers idempotently instead of installing a second target.
 */
import type { Context } from '@clocky/cordis'
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import type { SimulationProductRunControlInput } from '@clocky/clocky-simulation-product/types'
import { simulationProductRunControlInputSchema, simulationProductRunControlResultSchema } from '@clocky/clocky-simulation-product/schema'
import { createSnapshotStore } from '../contract/store.ts'
import type { SimulationRuntime } from './service.ts'

/** Durable Host receipt of one stop-target command. */
export type SimulationRunControlReceipt = NonNullable<ReturnType<typeof simulationProductRunControlResultSchema.parse>>['receipt']
/** Original command state: submitting, confirmed by a receipt, refused before acceptance, or unknown after transport loss. */
export interface SimulationRunControlState {
  readonly status: 'idle' | 'submitting' | 'confirmed' | 'refused' | 'unknown'
  readonly input?: SimulationProductRunControlInput | undefined
  readonly receipt?: SimulationRunControlReceipt | undefined
  /** Protocol category of a refusal; `invalid` covers boundary refusals such as a target before the confirmed clock. */
  readonly error?: 'invalid' | 'forbidden' | 'unavailable' | 'stale' | 'internal' | undefined
  /** The Host's safe structural refusal sentence, shown only in technical details. */
  readonly message?: string | undefined
}
/** Explicit transport wait for one command. */
export interface SimulationRunControlOptions { readonly timeoutMs: number }

/** Single-original stop-target owner; credential replacement clears it. */
export class SimulationRunControlRuntime {
  /** Current original command, independent of UI components. */
  readonly state = createSnapshotStore<SimulationRunControlState>({ status: 'idle' })
  private authority: number
  private pending: AbortController | undefined

  /** @param ctx - Consumer lifetime. @param api - Authenticated transport. @param source - Current authority.
   * @param options - Finite transport wait. */
  constructor(ctx: Context, private readonly api: IApiClient, source: SimulationRuntime,
    private readonly options: SimulationRunControlOptions) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error('Run control requires a positive finite wait')
    this.authority = source.state.getSnapshot().authorizationVersion
    ctx.effect(() => source.state.subscribe(() => {
      const version = source.state.getSnapshot().authorizationVersion
      if (version !== this.authority) { this.authority = version; this.abort(); this.state.set({ status: 'idle' }) }
    }), 'run control authority')
    ctx.effect(() => () => { this.abort(); this.state.set({ status: 'idle' }) }, 'run control lifetime')
  }

  /**
   * Submit a new target (or an explicit clear with `null`) under a fresh command identity.
   * @param input - Run and complete target; the command identity is minted here.
   * @returns settlement after a receipt, refusal or unknown outcome; scheduling is never started.
   */
  update(input: Omit<SimulationProductRunControlInput, 'commandId'>): Promise<void> {
    const current = this.state.getSnapshot()
    if (current.status === 'submitting') return Promise.resolve()
    if (current.status === 'unknown') return Promise.reject(new Error('Retry or dismiss the original stop-target command first'))
    return this.perform(simulationProductRunControlInputSchema.parse({ ...input, commandId: crypto.randomUUID() }))
  }

  /** Resend the exact original command after an unknown outcome; the Host returns the original receipt. */
  retry(): Promise<void> {
    const current = this.state.getSnapshot()
    if (current.status !== 'unknown' || current.input === undefined) return Promise.resolve()
    return this.perform(current.input)
  }

  /** Dismiss a settled command; an unknown outcome stays until retried so responsibility is not lost.
   * @returns whether the slot was cleared. */
  dismiss(): boolean {
    const status = this.state.getSnapshot().status
    if (status === 'submitting' || status === 'unknown') return false
    this.state.set({ status: 'idle' }); return true
  }

  private async perform(input: SimulationProductRunControlInput): Promise<void> {
    this.abort()
    const controller = new AbortController(), authority = this.authority
    this.pending = controller
    this.state.set({ status: 'submitting', input })
    const timer = setTimeout(() => { controller.abort() }, this.options.timeoutMs)
    try {
      const response = await this.api.simulations.updateRunControl(input, controller.signal)
      if (this.pending !== controller || authority !== this.authority) return
      if (!response.result.ok) {
        const code = response.result.error.code
        const error = code === 'simulation-product-invalid' || code === 'bad-request' ? 'invalid'
          : code === 'simulation-product-forbidden' ? 'forbidden' : code === 'simulation-product-unavailable' ? 'unavailable'
            : code === 'simulation-product-stale' ? 'stale' : 'internal'
        // Internal failures may have happened after the Host accepted the command: keep it for an exact retry.
        this.state.set(error === 'internal' ? { status: 'unknown', input, error }
          : { status: 'refused', input, error, message: response.result.error.message.slice(0, 512) })
        return
      }
      const result = simulationProductRunControlResultSchema.parse(response.result.value)
      if (result.runId !== input.runId || result.receipt.commandId !== input.commandId) throw new Error('Run control receipt belongs to another command')
      this.state.set({ status: 'confirmed', input, receipt: result.receipt })
    } catch {
      // Transport loss, timeout and malformed replies leave the Host outcome unknown; only an exact retry may resolve it.
      if (this.pending === controller && authority === this.authority) this.state.set({ status: 'unknown', input })
    } finally {
      clearTimeout(timer)
      if (this.pending === controller) this.pending = undefined
    }
  }

  private abort(): void { this.pending?.abort(); this.pending = undefined }
}
