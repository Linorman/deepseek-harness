import { isTeamAuthorizationError } from './access.ts'
/** Shared lifetime for independently changing authenticated Team observations. */
import type { RpcResult, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamObservationState } from '../contract/team-tasks.ts'

/** A view owns one polling lifetime; readers own their domain-specific bounded projection. */
export class TeamObservation<Input extends { readonly teamId: TeamId }, Value extends { readonly teamId: TeamId }> {
  private state: TeamObservationState<Input, Value> | undefined
  private request: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private interval: number | undefined
  private generation = 0
  private connected = true

  /**
   * @param read - Authenticated bounded reader for this domain.
   * @param publish - Runtime-owned observation publisher.
   */
  constructor(private readonly read: (input: Input, signal: AbortSignal) => Promise<RpcResult<Value>>,
    private readonly publish: (state: TeamObservationState<Input, Value> | undefined) => void) {}

  /** Observe the exact scope draft until this watcher is replaced or disposed.
   * @param input - Team and scope selections; never a grant.
   * @param intervalMs - Validated deployment refresh interval.
   * @returns disposer for this watcher only.
   */
  watch(input: Input, intervalMs: number): () => void {
    const previous = this.state
    const generation = this.cancel()
    if (generation !== this.generation) return () => {}
    this.interval = intervalMs
    this.set({ input, value: previous?.input.teamId === input.teamId ? previous.value : undefined,
      loading: false, disconnected: !this.connected })
    if (this.connected) void this.refresh()
    return () => { if (generation === this.generation) this.close() }
  }

  /** Retry the current selections; accepted task creation remains a separate authorized command. */
  async refresh(): Promise<void> {
    const state = this.state
    const interval = this.interval
    if (state === undefined || interval === undefined || !this.connected || this.request !== undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
    const generation = this.generation
    const controller = new AbortController()
    this.request = controller
    this.set({ ...state, loading: true, disconnected: false })
    try {
      if (!this.current(generation, controller)) return
      const response = await this.read(state.input, controller.signal)
      if (!this.current(generation, controller)) return
      if (!response.ok) {
        const error = response.error
        const denied = isTeamAuthorizationError(error)
        this.set({ ...state, value: denied ? undefined : state.value, loading: false, error: error.message, disconnected: false })
        return
      }
      if (response.value.teamId !== state.input.teamId) throw new Error('Team observation belongs to another Team')
      this.set({ input: state.input, value: response.value, loading: false, disconnected: false })
    } catch (error: unknown) {
      if (this.current(generation, controller)) {
        this.set({ ...state, loading: false, error: error instanceof Error ? error.message : String(error), disconnected: false })
      }
    } finally {
      if (this.request === controller) {
        this.request = undefined
        this.timer = setTimeout(() => { void this.refresh() }, interval)
      }
    }
  }

  /** Stop polling during transport loss while retaining the unavailable observation for display. */
  disconnect(): void {
    this.connected = false
    this.cancelRequest()
    if (this.state !== undefined) this.set({ ...this.state, loading: false, disconnected: true })
  }

  /** Revalidate the same draft after reconnect without changing its fields. */
  reconnect(): void { this.connected = true; void this.refresh() }

  /** Stop the form's reads and release its capability data. */
  close(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.interval = undefined
    this.state = undefined
    this.publish(undefined)
  }

  /** Fence old watchers before running abort callbacks. */
  private cancel(): number {
    const generation = ++this.generation
    this.cancelRequest()
    return generation
  }

  /** Clear scheduling before asking the transport to cancel. */
  private cancelRequest(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    const request = this.request
    this.request = undefined
    request?.abort()
  }

  /** Match the current request after asynchronous transport work. */
  private current(generation: number, controller: AbortController): boolean {
    return generation === this.generation && !controller.signal.aborted
  }

  /** Publish the authoritative observation through its sole runtime owner. */
  private set(state: TeamObservationState<Input, Value>): void { this.state = state; this.publish(state) }
}
