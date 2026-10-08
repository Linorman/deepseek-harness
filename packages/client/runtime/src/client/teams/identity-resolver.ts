import type { HostDescription, IApiClient, ParticipantId, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamIdentityState, TeamIdentityItem, TeamIdentityOptions } from '../contract/team-tasks.ts'
export type { TeamIdentityState, TeamIdentityItem, TeamIdentityOptions } from '../contract/team-tasks.ts'
import { isTeamAuthorizationError } from './access.ts'
/** A connection handshake pins authority; identity responses cannot replace that pin. */
export class IdentityResolver {
  private scope: HostDescription['authorizationScope']
  private readonly cache = new Map<string, { teamId: TeamId; item: TeamIdentityItem }>()
  private current: { teamId: TeamId; ids: readonly ParticipantId[]; options: TeamIdentityOptions } | undefined
  private request: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private watcher = 0
  private connected = true
  private state: TeamIdentityState | undefined

  /**
   * @param api - Authenticated Host transport.
   * @param publish - Sole runtime snapshot publisher.
   * @param denied - Clear other Team name/detail projections when authority is lost.
   */
  constructor(private readonly api: IApiClient, private readonly publish: (state: TeamIdentityState | undefined) => void,
    private readonly denied: () => void) {}

  /** Apply authority from a completed connection handshake, never from a late identity response.
   * @param scope - Current handshake scope or absent authentication.
   * @returns whether cache authority changed, including the first authenticated handshake.
   */
  authorize(scope: HostDescription['authorizationScope']): boolean {
    if (this.scope === scope) return false
    this.scope = scope
    this.cache.clear()
    const generation = this.cancel()
    if (generation !== this.generation) return true
    if (this.current !== undefined) this.set({ teamId: this.current.teamId, items: [],
      loading: false, disconnected: !this.connected, forbidden: scope === undefined })
    return true
  }

  /** Observe the finite visible references without enumerating members.
   * @param teamId - Selected Team.
   * @param ids - Referenced identities, deduplicated in first-occurrence order.
   * @param options - Validated deployment limits.
   * @returns disposer fenced to this view lifetime.
   */
  watch(teamId: TeamId, ids: readonly ParticipantId[], options: TeamIdentityOptions): () => void {
    const generation = this.cancel()
    if (generation !== this.generation) return () => {}
    const watcher = ++this.watcher
    this.current = { teamId, ids: [...new Set(ids)], options }
    this.trim(options.capacity)
    this.set({ teamId, items: this.rows(teamId), loading: false, disconnected: !this.connected, forbidden: this.scope === undefined })
    void this.refresh()
    return () => { if (watcher === this.watcher) this.close() }
  }

  /** Refresh all requested names atomically across bounded, revision-consistent pages. */
  async refresh(): Promise<void> {
    const current = this.current
    const scope = this.scope
    if (!this.connected || current === undefined || scope === undefined || this.request !== undefined) return
    clearTimeout(this.timer)
    const controller = new AbortController()
    this.request = controller
    const generation = this.generation
    this.set({ teamId: current.teamId, items: this.rows(current.teamId), loading: true, disconnected: false,
      forbidden: false, error: this.state?.error })
    try {
      const items: TeamIdentityItem[] = []
      let teamCursor: number | undefined
      const ids = current.ids
      for (let start = 0; start < Math.max(1, ids.length); start += current.options.batchSize) {
        const batch = ids.slice(start, start + current.options.batchSize)
        let offset = 0
        do {
          controller.signal.throwIfAborted()
          const response = await this.api.teams.identityResolve({ teamId: current.teamId, participantIds: batch,
            afterCursor: offset, ...teamCursor === undefined ? {} : { expectedTeamCursor: teamCursor } }, controller.signal)
          if (generation !== this.generation || controller.signal.aborted) return
          if (!response.result.ok) {
            const error = response.result.error
            if (isTeamAuthorizationError(error)) {
              this.refuse(current.teamId, error.message)
              return
            }
            throw new Error(error.message)
          }
          const page = response.result.value
          if (page.authorizationScope !== scope) { this.refuse(current.teamId, 'Authenticated identity changed; reconnect to reload member names'); return }
          if (page.teamId !== current.teamId || teamCursor !== undefined && page.teamCursor !== teamCursor
            || page.items.some((item, index) => item.participantId !== batch[offset + index])
            || page.items.length === 0 && offset < batch.length
            || page.nextCursor !== undefined && (page.nextCursor !== offset + page.items.length || page.nextCursor >= batch.length)
            || page.nextCursor === undefined && offset + page.items.length !== batch.length) {
            throw new Error('Identity page does not match the requested references and revision')
          }
          teamCursor = page.teamCursor
          items.push(...page.items)
          if (page.nextCursor === undefined) break
          offset = page.nextCursor
        } while (true)
      }
      for (const item of items) {
        const key = JSON.stringify([current.teamId, item.participantId])
        this.cache.delete(key)
        this.cache.set(key, { teamId: current.teamId, item })
      }
      this.trim(current.options.capacity)
      this.set({ teamId: current.teamId, items: this.rows(current.teamId), loading: false, disconnected: false, forbidden: false })
    } catch (error: unknown) {
      if (generation === this.generation && !controller.signal.aborted) this.set({ teamId: current.teamId, items: this.rows(current.teamId),
        loading: false, disconnected: false, forbidden: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.request === controller) {
        this.request = undefined
        this.timer = setTimeout(() => { void this.refresh() }, current.options.refreshMs)
      }
    }
  }

  /** Stop reads during connection loss without pretending cached names lost authorization. */
  disconnect(): void {
    this.connected = false
    const generation = this.cancel()
    if (generation !== this.generation) return
    if (this.state !== undefined) this.set({ ...this.state, loading: false, disconnected: true })
  }
  /** Recheck references only after the connection owner has applied its authenticated scope. */
  reconnect(): void { this.connected = true; void this.refresh() }
  /** Stop a view's observation while keeping bounded names for later views in this scope. */
  close(): void {
    this.watcher++
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.current = undefined; this.state = undefined; this.publish(undefined)
  }
  /** Dispose the runtime owner and all retained names. */
  dispose(): void { this.cache.clear(); this.scope = undefined; this.close() }

  private cancel(): number {
    const generation = ++this.generation
    clearTimeout(this.timer)
    this.timer = undefined
    const request = this.request
    this.request = undefined
    request?.abort()
    return generation
  }
  private rows(teamId: TeamId): readonly TeamIdentityItem[] {
    return [...this.cache.values()].filter(entry => entry.teamId === teamId).map(entry => entry.item)
  }
  private trim(capacity: number): void {
    for (const key of this.cache.keys()) {
      if (this.cache.size <= capacity) break
      this.cache.delete(key)
    }
  }
  private set(state: TeamIdentityState): void { this.state = state; this.publish(state) }
  private refuse(teamId: TeamId, error: string): void {
    this.cache.clear()
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.set({ teamId, items: [], loading: false, disconnected: false, forbidden: true, error })
    this.denied()
  }
}
