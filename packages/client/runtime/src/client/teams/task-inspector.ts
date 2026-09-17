/** One task inspection owner; no historical Team state or accumulated page cache is retained. */
import type { IApiClient, TeamId, TeamTaskId } from '@clocky/clocky-client-connection/client'
import type { TeamTaskDetailState, TeamTaskDetailReadMode, TeamTaskInspection } from '../contract/team-tasks.ts'

const HISTORY_LIMIT = 32
type Section = 'record' | 'attempts' | 'reviews'

/** Own task read generations independently from Team list refreshes. */
export class TaskInspector {
  private state: TeamTaskDetailState | undefined
  private generation = 0
  private minimumRevision = 0
  private readonly requests = new Map<string, AbortController>()

  /**
   * @param api - Shared Host transport.
   * @param publish - Runtime snapshot publisher.
   */
  constructor(private readonly api: IApiClient, private readonly publish: (state: TeamTaskDetailState | undefined) => void) {}

  /** Release reads synchronously; late replies cannot recreate the dismissed inspector. */
  close(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.state = undefined
    this.minimumRevision = 0
    this.publish(undefined)
  }

  /** Preserve readable data after transport loss without leaving any spinner active. */
  disconnect(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    const state = this.state
    if (state !== undefined) this.set({ ...state, disconnected: true, hasNewer: true,
      record: { ...state.record, loading: false }, latest: { ...state.latest, loading: false },
      attempts: { ...state.attempts, loading: false }, reviews: { ...state.reviews, loading: false } })
  }

  /** Revalidate the same task after reconnect without restarting its Agent. */
  async reconnect(): Promise<void> {
    const state = this.state
    if (state !== undefined) await this.read(state.teamId, state.taskId)
  }

  /** Mark changed data while preserving the window the user is reading.
   * @param teamId - Owning Team.
   * @param taskId - Task whose revision changed.
   * @param revision - New authoritative revision.
   */
  changed(teamId: TeamId, taskId: TeamTaskId, revision: number): void {
    const state = this.state
    if (state?.teamId !== teamId || state.taskId !== taskId) return
    this.minimumRevision = Math.max(this.minimumRevision, revision)
    if (!state.hasNewer && revision > (state.record.value?.revision ?? 0)) this.set({ ...state, hasNewer: true })
  }

  /** Read current fields or one window; errors preserve previously loaded data.
   * @param teamId - Exact Team selection.
   * @param taskId - Exact task selection, including tasks outside the list page.
   * @param section - Current fields or an immutable history.
   * @param mode - Refresh this window, read its successor, or return to the beginning.
   */
  async read(teamId: TeamId, taskId: TeamTaskId, section: Section = 'record', mode: TeamTaskDetailReadMode = 'refresh'): Promise<void> {
    if (this.state?.teamId !== teamId || this.state.taskId !== taskId) {
      if (section !== 'record') return
      const generation = this.cancel()
      if (generation !== this.generation) return
      this.minimumRevision = 0
      this.set({ teamId, taskId, record: { loading: false }, latest: { loading: false },
        attempts: { loading: false }, reviews: { loading: false }, hasNewer: false, disconnected: false })
    }
    const state = this.state
    if (state === undefined || this.requests.has(section)) return
    if (section === 'record' && mode === 'first' && state.record.value !== undefined) return
    if (section !== 'record' && (state.record.value === undefined || state.hasNewer || state.disconnected)) return
    if (section === 'record') {
      const generation = this.cancel()
      if (generation !== this.generation) return
    }
    const previous = state[section]
    const page = section === 'record' ? undefined : state[section].value
    let afterCursor: number
    if (mode === 'next') {
      const nextCursor = page?.nextCursor
      if (nextCursor === undefined) return
      afterCursor = nextCursor
    } else afterCursor = mode === 'first' ? -1 : page?.startCursor ?? -1
    const generation = this.generation
    const controller = new AbortController()
    this.requests.set(section, controller)
    this.set({ ...state, ...(section === 'record' ? { latest: { ...state.latest, loading: false },
      attempts: { ...state.attempts, loading: false }, reviews: { ...state.reviews, loading: false } } : {}),
    [section]: { ...previous, loading: true, error: undefined } })
    try {
      if (!this.current(generation, controller)) return
      const response = await this.api.teams.taskInspect(section === 'record' ? { teamId, taskId, section }
        : { teamId, taskId, section, expectedRevision: state.record.value?.revision, afterCursor, limit: HISTORY_LIMIT }, controller.signal)
      if (!this.current(generation, controller)) return
      if (!response.result.ok) {
        if (response.result.error.code === 'team-task-stale-revision') this.set({ ...this.active(), hasNewer: true })
        throw new Error(response.result.error.message)
      }
      const value = response.result.value
      if (value.teamId !== teamId || value.taskId !== taskId || value.section !== section
        || section !== 'record' && value.revision !== state.record.value?.revision) throw new Error('Task inspection selection changed')
      if (value.section !== 'record' && (value.items.length > HISTORY_LIMIT || value.startCursor !== afterCursor
        || value.total !== state.record.value?.history[value.section])) {
        throw new Error('Task history exceeded its selected window')
      }
      const current = this.active()
      if (value.section === 'record') {
        if (value.revision < this.minimumRevision) throw new Error('Task inspection is older than the observed task revision')
        this.minimumRevision = value.revision
        const changed = value.revision !== current.record.value?.revision
        this.set({ ...current, record: { value, loading: false }, hasNewer: false, disconnected: false,
          ...(changed ? { latest: { loading: false }, attempts: { loading: false }, reviews: { loading: false } } : {}) })
        await this.readLatest(value, generation)
      } else {
        this.set({ ...current, [value.section]: { value, loading: false } })
      }
    } catch (error: unknown) {
      if (this.current(generation, controller)) this.set({ ...this.active(),
        [section]: { ...this.active()[section], loading: false, error: error instanceof Error ? error.message : String(error) } })
    } finally {
      if (this.requests.get(section) === controller) this.requests.delete(section)
    }
  }

  /** Latest-result identity is independent of whichever history window is visible. */
  private async readLatest(record: Extract<TeamTaskInspection, { section: 'record' }>, generation: number): Promise<void> {
    if (record.history.attempts === 0 || this.state === undefined || generation !== this.generation) return
    const controller = new AbortController()
    this.requests.set('latest', controller)
    this.set({ ...this.active(), latest: { ...this.active().latest, loading: true, error: undefined } })
    try {
      if (!this.current(generation, controller)) return
      const result = (await this.api.teams.taskInspect({ teamId: record.teamId, taskId: record.taskId, section: 'attempts',
        expectedRevision: record.revision, afterCursor: record.history.attempts - 2, limit: 1 }, controller.signal)).result
      if (!this.current(generation, controller)) return
      if (!result.ok) {
        if (result.error.code === 'team-task-stale-revision') this.set({ ...this.active(), hasNewer: true })
        throw new Error(result.error.message)
      }
      const page = result.value
      if (page.section !== 'attempts' || page.teamId !== record.teamId || page.taskId !== record.taskId
        || page.revision !== record.revision || page.items.length !== 1 || page.startCursor !== record.history.attempts - 2
        || page.total !== record.history.attempts || page.nextCursor !== undefined) {
        throw new Error('Latest task attempt does not match its record')
      }
      this.set({ ...this.active(), latest: { value: page.items[0], loading: false } })
    } catch (error: unknown) {
      if (this.current(generation, controller)) this.set({ ...this.active(), latest: { ...this.active().latest,
        loading: false, error: error instanceof Error ? error.message : String(error) } })
    } finally { if (this.requests.get('latest') === controller) this.requests.delete('latest') }
  }

  private active(): TeamTaskDetailState {
    // v8 ignore next -- every call follows a current-generation check with no intervening callback.
    if (this.state === undefined) throw new Error('Task inspector has no active selection')
    return this.state
  }

  private current(generation: number, controller: AbortController): boolean {
    return this.state !== undefined && generation === this.generation && !controller.signal.aborted
  }

  private cancel(): number {
    const generation = ++this.generation
    const requests = [...this.requests.values()]
    this.requests.clear()
    for (const controller of requests) controller.abort()
    return generation
  }

  private set(state: TeamTaskDetailState): void {
    this.state = state
    this.publish(state)
  }
}
