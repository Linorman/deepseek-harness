/** One visible-run observer holds one authenticated wait and bounded retry timer, without retaining response bodies. */
import type { IApiClient, RpcError } from '@clocky/clocky-client-connection/client'
import type { SimulationProductRunId, SimulationProductWatchResult, SimulationProductCursor } from '@clocky/clocky-simulation-product/types'

/** Explicit real-time wait and pacing; no simulation-time arithmetic occurs in the browser. */
export interface SimulationObservationOptions { readonly waitMs: number; readonly retryMs: number }
/** Runtime owns publication and its authority checks; this controller owns only transport and timer teardown. */
export class SimulationObserver {
  private readonly controller = new AbortController()
  /** Resolves after the authenticated wait and retry timer have retired. */
  readonly done: Promise<void>
  /**
   * @param api - Current authenticated metadata carrier.
   * @param runId - Exact registered run; one loop never changes its selection.
   * @param options - Positive validated real wait and pacing bounds.
   * @param received - Owner callback; caller fences its connection and selection before publication.
   * @param failed - Owner callback; undefined means a transport failure, not a permission denial.
   */
  constructor(api: IApiClient, readonly runId: SimulationProductRunId, options: SimulationObservationOptions,
    received: (value: SimulationProductWatchResult) => void, failed: (error?: RpcError) => void) {
    this.done = Promise.resolve().then(() => this.run(api, options, received, failed))
  }
  /** Cancel transport and its remaining retry wait; done proves quiescence. */
  close(): void { this.controller.abort() }

  private async run(api: IApiClient, options: SimulationObservationOptions,
    received: (value: SimulationProductWatchResult) => void, failed: (error?: RpcError) => void): Promise<void> {
    const signal = this.controller.signal
    let cursor: SimulationProductCursor | undefined
    const active = () => !signal.aborted
    while (active()) {
      try {
        const response = await api.simulations.watch({ runId: this.runId, cursor, waitMs: options.waitMs }, signal)
        if (!active()) return
        if (!response.result.ok) failed(response.result.error)
        else if (response.result.value.runId !== this.runId) failed({ code: 'internal', message: 'Invalid Simulation observation', details: {} })
        else { cursor = response.result.value.cursor; received(response.result.value) }
      } catch {
        if (active()) failed()
      }
      if (!active()) return
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
        const timer = setTimeout(finish, options.retryMs)
        signal.addEventListener('abort', finish, { once: true })
        if (signal.aborted) finish()
      })
    }
  }
}
