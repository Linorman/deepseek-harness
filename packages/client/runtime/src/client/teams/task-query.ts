import { isTeamAuthorizationError } from './access.ts'
/** One independent, bounded task-query window for a table or dependency editor. */
import type { IApiClient, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamTaskQuery, TeamTaskQueryState } from '../contract/team-tasks.ts'

/** Own cancellation, continuation and reconnect for one query consumer. */
export class TaskQuery {
  private state: TeamTaskQueryState | undefined
  private request: AbortController | undefined
  private generation = 0
  private minimumCursor = 0

  /**
   * @param api - Shared Host transport.
   * @param limit - Requested page size, bounded again by the Host.
   * @param publish - Runtime snapshot publisher.
   */
  constructor(private readonly api: IApiClient, private readonly limit: number,
    private readonly publish: (state: TeamTaskQueryState | undefined) => void) {}

  /** Release the current query; pending responses cannot recreate it. */
  close(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.minimumCursor = 0
    this.state = undefined
    this.publish(undefined)
  }

  /** Cancel the view's pending read while retaining its page and filters for navigation. */
  pause(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    if (this.state?.loading) this.set({ ...this.state, loading: false })
  }

  /** Preserve the last page as stale after losing the transport. */
  disconnect(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    if (this.state !== undefined) this.set({ ...this.state, loading: false, disconnected: true, hasNewer: true })
  }

  /** Refresh the first page of the retained query after reconnect, without executing tasks. */
  async reconnect(): Promise<void> {
    if (this.state !== undefined) await this.read(this.state.teamId, this.state.query, 'first')
  }

  /** Mark a revision-fenced page stale when the owning Team changes.
   * @param teamId - Team whose authorized projection changed.
   * @param cursor - Observed journal watermark.
   */
  changed(teamId: TeamId, cursor: number): void {
    if (this.state?.teamId !== teamId) return
    this.minimumCursor = Math.max(this.minimumCursor, cursor)
    if (cursor > (this.state.page?.teamCursor ?? cursor)) this.set({ ...this.state, hasNewer: true })
  }

  /** Read a new query or its exact successor; errors retain the prior page but never the wrong query's rows.
   * @param teamId - Selected Team.
   * @param query - Committed title/phase/exclusion filter.
   * @param mode - Start or refresh at the beginning, or read the current page's successor.
   */
  async read(teamId: TeamId, query: TeamTaskQuery, mode: 'first' | 'next' = 'first'): Promise<void> {
    const previous = this.state
    const same = previous?.teamId === teamId && previous.query.search === query.search
      && previous.query.phase === query.phase && previous.query.excludeTaskId === query.excludeTaskId
    if (mode === 'next' && (!same || previous.loading || previous.hasNewer || previous.disconnected
      || previous.error !== undefined || previous.page?.nextQueryCursor === undefined)) return
    const cursor = mode === 'next' ? previous?.page?.nextQueryCursor : undefined
    const generation = this.cancel()
    if (generation !== this.generation) return
    if (previous?.teamId !== teamId) this.minimumCursor = 0
    const controller = new AbortController()
    this.request = controller
    this.set({ teamId, query, startCursor: same ? previous.startCursor : undefined,
      page: same ? previous.page : undefined, loading: true, error: undefined,
      hasNewer: same && previous.hasNewer, disconnected: false })
    try {
      if (!this.current(generation, controller)) return
      const response = await this.api.teams.browse({ teamId, kind: 'tasks', query,
        ...cursor === undefined ? {} : { queryCursor: cursor }, limit: this.limit }, controller.signal)
      if (!this.current(generation, controller)) return
      if (!response.result.ok) {
        const error = response.result.error
        const forbidden = isTeamAuthorizationError(error)
        this.set({ ...this.active(), loading: false, error: error.message,
          page: forbidden ? undefined : this.state?.page, hasNewer: this.active().hasNewer || error.code === 'team-cursor-conflict' })
        return
      }
      const page = response.result.value
      if (page.kind !== 'tasks' || page.teamId !== teamId || page.query?.search !== query.search
        || page.query.phase !== query.phase || page.query.excludeTaskId !== query.excludeTaskId
        || page.items.length > this.limit || page.teamCursor < this.minimumCursor) {
        throw new Error('Task query response does not match the current selection; refresh the query')
      }
      this.minimumCursor = page.teamCursor
      this.set({ teamId, query, startCursor: cursor, page, loading: false, hasNewer: false, disconnected: false })
    } catch (error: unknown) {
      if (!this.current(generation, controller)) return
      this.set({ ...this.active(), loading: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.request === controller) this.request = undefined
    }
  }

  /** Test the mutable request generation after callbacks and asynchronous transport work. */
  private current(generation: number, controller: AbortController): boolean {
    return generation === this.generation && !controller.signal.aborted
  }

  /** Fence publication before abort listeners run. */
  private cancel(): number {
    const generation = ++this.generation
    const request = this.request
    this.request = undefined
    request?.abort()
    return generation
  }

  /** A current request retains its query until its generation is cancelled. */
  private active(): TeamTaskQueryState {
    // v8 ignore next -- generation checks and publication cancellation preserve this owned relationship without an intervening callback.
    if (this.state === undefined) throw new Error('Current task query request has no retained selection')
    return this.state
  }

  /** Publish one business snapshot through its runtime owner. */
  private set(state: TeamTaskQueryState): void { this.state = state; this.publish(state) }
}
