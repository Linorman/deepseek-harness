/** One form's exact dependency facts; collection membership does not establish their status. */
import type { IApiClient, TeamId, TeamTaskId, TeamTaskReference } from '@clocky/clocky-client-connection/client'
import { isTeamAuthorizationError } from './access.ts'

/** Current facts only for the IDs requested by the current form. */
export interface TaskReferencesState {
  readonly teamId: TeamId
  readonly taskIds: readonly TeamTaskId[]
  readonly items: readonly TeamTaskReference[]
  readonly teamCursor?: number | undefined
  readonly loading: boolean
  readonly disconnected: boolean
  readonly hasNewer: boolean
  readonly error?: string | undefined
}

/** Validated consumer limits for retained references, requests and observation. */
export interface TaskReferencesOptions {
  readonly capacity: number
  readonly batchSize: number
  readonly refreshMs: number
}

/** Publish a complete same-revision reference set or retain the prior authorized facts. */
export class TaskReferences {
  private state: TaskReferencesState | undefined
  private options: TaskReferencesOptions | undefined
  private request: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private watcher = 0
  private minimumCursor = 0
  private connected = true

  /**
   * @param api - Shared authenticated Host transport.
   * @param publish - Sole runtime snapshot publisher.
   * @param denied - Current-Team authorization withdrawal owner.
   */
  constructor(private readonly api: IApiClient, private readonly publish: (value: TaskReferencesState | undefined) => void,
    private readonly denied: (teamId: TeamId) => void) {}

  /** Observe only a form's selected/current dependency IDs.
   * @param teamId - Currently selected Team.
   * @param taskIds - Exact references, deduplicated in first-occurrence order.
   * @param options - Deployment-resolved resource limits.
   * @returns disposer fenced to this form's observation.
   */
  watch(teamId: TeamId, taskIds: readonly TeamTaskId[], options: TaskReferencesOptions): () => void {
    const previous = this.state
    const generation = this.cancel()
    if (generation !== this.generation) return () => {}
    const watcher = ++this.watcher
    const ids = [...new Set(taskIds)]
    if (previous?.teamId !== teamId) this.minimumCursor = 0
    this.options = options
    this.set({ teamId, taskIds: ids, items: previous?.teamId === teamId ? previous.items.filter(row => ids.includes(row.taskId)) : [],
      teamCursor: previous?.teamId === teamId ? previous.teamCursor : undefined, loading: false,
      disconnected: !this.connected, hasNewer: true })
    void this.refresh()
    return () => { if (watcher === this.watcher) this.close() }
  }

  /** Refresh selected references atomically; failed partial batches never publish. */
  async refresh(): Promise<void> {
    const state = this.state
    const options = this.options
    if (state === undefined || options === undefined || !this.connected || this.request !== undefined) return
    clearTimeout(this.timer)
    const generation = this.generation
    const controller = new AbortController()
    this.request = controller
    this.set({ ...state, loading: true, error: undefined })
    try {
      if (!this.current(generation, controller)) return
      if (state.taskIds.length > options.capacity) throw new Error('Selected task references exceed the configured capacity')
      const items: TeamTaskReference[] = []
      let cursor: number | undefined
      for (let start = 0; start < Math.max(1, state.taskIds.length); start += options.batchSize) {
        const batch = state.taskIds.slice(start, start + options.batchSize)
        let offset = 0
        do {
          const response = await this.api.teams.taskReferences({ teamId: state.teamId, taskIds: batch, afterCursor: offset,
            ...cursor === undefined ? {} : { expectedTeamCursor: cursor } }, controller.signal)
          if (!this.current(generation, controller)) return
          if (!response.result.ok) {
            if (isTeamAuthorizationError(response.result.error)) { this.close(); this.denied(state.teamId); return }
            throw new Error(response.result.error.message)
          }
          const page = response.result.value
          const end = page.nextCursor ?? batch.length
          if (page.teamId !== state.teamId || page.teamCursor < this.minimumCursor
            || cursor !== undefined && page.teamCursor !== cursor || end < offset || end > batch.length
            || page.nextCursor !== undefined && end === offset || page.items.length !== end - offset
            || page.items.some((row, index) => row.taskId !== batch[offset + index])) {
            throw new Error('Task reference page does not match the current identity set or revision')
          }
          cursor = page.teamCursor
          items.push(...page.items)
          if (page.nextCursor === undefined) break
          offset = page.nextCursor
        } while (true)
      }
      // The loop reads at least one successful page, including for an empty reference set.
      this.minimumCursor = cursor as number
      this.set({ teamId: state.teamId, taskIds: state.taskIds, items, teamCursor: cursor,
        loading: false, disconnected: false, hasNewer: false })
    } catch (error: unknown) {
      if (this.current(generation, controller)) this.set({ ...this.active(), loading: false,
        error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.request === controller) {
        this.request = undefined
        this.timer = setTimeout(() => { void this.refresh() }, options.refreshMs)
      }
    }
  }

  /** Mark any newer Team revision before its dependency facts can be reused.
   * @param teamId - Team which changed.
   * @param cursor - Current journal watermark.
   */
  changed(teamId: TeamId, cursor: number): void {
    if (this.state?.teamId !== teamId) return
    this.minimumCursor = Math.max(this.minimumCursor, cursor)
    if (this.state.teamCursor === undefined || cursor > this.state.teamCursor) this.set({ ...this.state, hasNewer: true })
  }

  /** Preserve visibly stale facts during ordinary connection loss. */
  disconnect(): void {
    this.connected = false
    const generation = this.cancel()
    if (generation !== this.generation) return
    if (this.state !== undefined) this.set({ ...this.state, loading: false, disconnected: true, hasNewer: true })
  }

  /** Revalidate the current exact reference set after the new handshake. */
  reconnect(): void { this.connected = true; void this.refresh() }

  /** Release reference bodies and prevent old reads from recreating them. */
  close(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.options = undefined; this.state = undefined; this.publish(undefined)
  }

  private cancel(): number {
    const generation = ++this.generation
    clearTimeout(this.timer)
    const request = this.request
    this.request = undefined
    request?.abort()
    return generation
  }
  private current(generation: number, controller: AbortController): boolean {
    return generation === this.generation && !controller.signal.aborted
  }
  private active(): TaskReferencesState {
    // v8 ignore next -- a current request owns its state until cancellation fences its generation.
    if (this.state === undefined) throw new Error('Task references have no current selection')
    return this.state
  }
  private set(state: TaskReferencesState): void { this.state = state; this.publish(state) }
}
