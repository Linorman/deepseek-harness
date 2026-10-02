/** Independent pending preview/list ownership with cancellation, authorization and revision fences. */
import type { IApiClient, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamAttentionState } from '../contract/team-tasks.ts'
import { isTeamAuthorizationError } from './access.ts'

interface AttentionSpec { readonly teamId: TeamId; readonly limit: number; readonly minimumCursor: number }
interface AttentionWatch { readonly spec: AttentionSpec; readonly refreshMs: number }

/** Retain one bounded window; polling never fetches all continuations. */
export class AttentionQuery {
  private state: TeamAttentionState | undefined
  private request: AbortController | undefined
  private generation = 0
  private minimumCursor = 0
  private connected = true
  private watcher: AttentionWatch | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param api - Current Host transport.
   * @param publish - Runtime snapshot publisher.
   * @param denied - Current-Team authority invalidation owner.
   */
  constructor(private readonly api: IApiClient, private readonly publish: (state: TeamAttentionState | undefined) => void,
    private readonly denied: (teamId: TeamId) => void) {}

  /** Start this view's first-page observation.
   * @param spec - Resolved selected-Team bounds and known revision.
   * @param refreshMs - Validated deployment interval.
   * @returns disposer belonging to this exact watcher.
   */
  watch(spec: AttentionSpec, refreshMs: number): () => void {
    const generation = this.cancel()
    if (generation !== this.generation) return () => {}
    const watcher = { spec, refreshMs }
    this.watcher = watcher
    void this.read(spec)
    return () => { if (this.watcher === watcher) { this.watcher = undefined; this.pause() } }
  }

  /** Read one exact current page; failures preserve already authorized rows.
   * @param spec - Resolved selected-Team bounds and known revision.
   * @param mode - First page or current exact successor.
   */
  async read(spec: AttentionSpec, mode: 'first' | 'next' = 'first'): Promise<void> {
    const previous = this.state
    const same = previous?.teamId === spec.teamId && previous.limit === spec.limit
    if (!this.connected || mode === 'next' && (!same || previous.loading || previous.hasNewer || previous.error !== undefined
      || previous.disconnected || previous.page?.nextCursor === undefined)) return
    const cursor = mode === 'next' ? previous?.page?.nextCursor : undefined
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.minimumCursor = same ? Math.max(this.minimumCursor, spec.minimumCursor) : spec.minimumCursor
    const controller = new AbortController()
    this.request = controller
    this.set({ teamId: spec.teamId, limit: spec.limit, startCursor: same ? previous.startCursor : undefined,
      page: same ? previous.page : undefined, loading: true, hasNewer: same && previous.hasNewer, disconnected: false })
    try {
      if (!this.current(generation, controller)) return
      const response = await this.api.teams.attentionRead({ teamId: spec.teamId, limit: spec.limit,
        ...cursor === undefined ? {} : { cursor } }, controller.signal)
      if (!this.current(generation, controller)) return
      if (!response.result.ok) {
        const error = response.result.error
        if (isTeamAuthorizationError(error)) { this.close(); this.denied(spec.teamId); return }
        this.set({ ...this.active(), loading: false, error: error.message,
          hasNewer: this.active().hasNewer || error.code === 'team-cursor-conflict' })
        return
      }
      const page = response.result.value
      if (page.teamId !== spec.teamId || page.teamCursor < this.minimumCursor || page.items.length > spec.limit) {
        throw new Error('Pending response does not match the current Team revision; refresh the list')
      }
      this.minimumCursor = page.teamCursor
      this.set({ teamId: spec.teamId, limit: spec.limit, startCursor: cursor, page, loading: false, hasNewer: false, disconnected: false })
    } catch (error: unknown) {
      if (this.current(generation, controller)) this.set({ ...this.active(), loading: false,
        error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.request === controller) {
        this.request = undefined
        this.schedule()
      }
    }
  }

  /** Stop polling and current IO without discarding navigation's retained page. */
  pause(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    if (this.state?.loading) this.set({ ...this.state, loading: false })
  }

  /** Invalidate the old connection's IO while retaining visibly stale content. */
  disconnect(): void {
    this.connected = false
    this.pause()
    if (this.state !== undefined) this.set({ ...this.state, disconnected: true, hasNewer: true })
  }

  /** Revalidate a retained page from the beginning after the handshake. */
  async reconnect(): Promise<void> {
    this.connected = true
    const state = this.state
    if (state !== undefined) await this.read({ teamId: state.teamId, limit: state.limit, minimumCursor: this.minimumCursor })
    else if (this.watcher !== undefined) await this.read(this.watcher.spec)
  }

  /** Mark a retained snapshot stale on an authoritative Team update.
   * @param teamId - Team which changed.
   * @param cursor - Current journal watermark.
   */
  changed(teamId: TeamId, cursor: number): void {
    if (this.state?.teamId !== teamId) return
    this.minimumCursor = Math.max(this.minimumCursor, cursor)
    if (cursor > (this.state.page?.teamCursor ?? cursor)) this.set({ ...this.state, hasNewer: true })
  }

  /** Release this selection and prevent late responses from recreating it. */
  close(): void {
    this.watcher = undefined
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.minimumCursor = 0
    this.state = undefined
    this.publish(undefined)
  }

  /** Re-read the retained scope from the beginning without changing another reader. */
  async refresh(): Promise<void> {
    const state = this.state
    if (state !== undefined) await this.read({ teamId: state.teamId, limit: state.limit, minimumCursor: this.minimumCursor })
  }

  private schedule(): void {
    const watcher = this.watcher
    if (watcher === undefined || !this.connected) return
    this.timer = setTimeout(() => { void this.read(watcher.spec) }, watcher.refreshMs)
  }

  private cancel(): number {
    const generation = ++this.generation
    clearTimeout(this.timer); this.timer = undefined
    const request = this.request
    this.request = undefined
    request?.abort()
    return generation
  }

  private current(generation: number, controller: AbortController): boolean {
    return generation === this.generation && !controller.signal.aborted
  }

  private active(): TeamAttentionState {
    // v8 ignore next -- current generation checks retain the state between publication and response handling.
    if (this.state === undefined) throw new Error('Pending reader has no current Team')
    return this.state
  }

  private set(state: TeamAttentionState): void { this.state = state; this.publish(state) }
}
