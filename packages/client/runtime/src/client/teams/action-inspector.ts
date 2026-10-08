import { disconnectedRead, failedRead } from './read-state.ts'
import { ReadRequest } from './read-request.ts'
/** One selected human-request body with current handling and independent cancellation. */
import type { IApiClient, TeamId, TeamHumanActionId, TeamHumanActionSnapshot, TeamActionInspection } from '@clocky/clocky-client-connection/client'
import type { TeamActionDetailState } from '../contract/team-tasks.ts'
import { isTeamAuthorizationError } from './access.ts'

/** Keep authority-sensitive records outside React and its draft store. */
export class ActionInspector {
  private state: TeamActionDetailState | undefined
  private readonly requests = new ReadRequest()
  private connected = true
  private minimumCursor = 0

  /**
   * @param api - Shared current Host transport.
   * @param publish - Runtime snapshot publisher.
   * @param denied - Current-Team authority invalidation owner.
   */
  constructor(private readonly api: IApiClient, private readonly publish: (value: TeamActionDetailState | undefined) => void,
    private readonly denied: (teamId: TeamId) => void) {}

  /** Read or refresh one exact retained request.
   * @param teamId - Selected Team.
   * @param actionId - Request selected independently from pending pagination.
   * @returns the accepted current inspection, or undefined after failure, cancellation or retirement.
   */
  async read(teamId: TeamId, actionId: TeamHumanActionId): Promise<TeamActionInspection | undefined> {
    if (!this.connected) return
    const previous = this.state
    const same = previous?.teamId === teamId && previous.actionId === actionId
    this.minimumCursor = same ? Math.max(this.minimumCursor, previous.value?.teamCursor ?? 0) : 0
    const generation = this.requests.cancel()
    if (generation !== this.requests.generation) return
    const controller = new AbortController()
    this.requests.begin(controller)
    this.set({ teamId, actionId, value: same ? previous.value : undefined, loading: true,
      hasNewer: same && previous.hasNewer, disconnected: false })
    try {
      if (!this.requests.current(generation, controller)) return
      const response = await this.api.teams.actionInspect({ teamId, actionId }, controller.signal)
      if (!this.requests.current(generation, controller)) return
      if (!response.result.ok) {
        if (isTeamAuthorizationError(response.result.error)) { this.close(); this.denied(teamId); return }
        this.set({ ...this.active(), loading: false, error: response.result.error.message })
        return
      }
      const value = response.result.value
      if (value.teamId !== teamId || value.action.teamId !== teamId || value.action.id !== actionId
        || value.teamCursor < this.minimumCursor
        || this.state?.value !== undefined && value.action.updatedAt < this.state.value.action.updatedAt) {
        throw new Error('Request inspection does not match its current identity or revision')
      }
      this.set({ teamId, actionId, value, loading: false, hasNewer: false, disconnected: false })
      return this.requests.current(generation, controller) && this.state?.value === value && !this.state.hasNewer ? value : undefined
    } catch (error: unknown) {
      if (this.requests.current(generation, controller)) this.set(failedRead(this.active(), error))
    } finally { if (this.requests.request === controller) this.requests.finish(controller) }
  }

  /** Reflect an authorized answer/read receipt for the already selected request.
   * @param action - Current authenticated request fact.
   */
  observe(action: TeamHumanActionSnapshot): void {
    const state = this.state
    if (state?.teamId !== action.teamId || state.actionId !== action.id || state.value === undefined
      || action.updatedAt < state.value.action.updatedAt) return
    this.set({ ...state, value: { ...state.value, action,
      handling: action.phase !== 'pending' ? { kind: 'waiting', reason: 'already-processed' }
        : action.response !== undefined ? { kind: 'waiting', reason: 'response-accepted' } : state.value.handling }, hasNewer: true })
  }

  /** Mark a retained request as needing explicit current inspection after Team changes.
   * @param teamId - Team which changed.
   * @param cursor - Current journal watermark.
   */
  changed(teamId: TeamId, cursor: number): void {
    if (this.state?.teamId !== teamId) return
    this.minimumCursor = Math.max(this.minimumCursor, cursor)
    if (this.state.value !== undefined && cursor > this.state.value.teamCursor) {
      this.set({ ...this.state, hasNewer: true })
    }
  }

  /** Stop old connection IO while retaining visibly stale content. */
  disconnect(): void {
    this.connected = false
    const generation = this.requests.cancel()
    if (generation !== this.requests.generation) return
    if (this.state !== undefined) this.set(disconnectedRead(this.state))
  }

  /** Revalidate the retained identity after a fresh connection handshake. */
  async reconnect(): Promise<void> {
    this.connected = true
    const state = this.state
    if (state !== undefined) await this.read(state.teamId, state.actionId)
  }

  /** Release its body and prevent late responses from recreating it. */
  close(): void {
    const generation = this.requests.cancel()
    if (generation !== this.requests.generation) return
    this.state = undefined
    this.publish(undefined)
  }



  private active(): TeamActionDetailState {
    // v8 ignore next -- a current request retains its state between publication and response handling.
    if (this.state === undefined) throw new Error('Request inspector has no current identity')
    return this.state
  }

  private set(state: TeamActionDetailState): void { this.state = state; this.publish(state) }
}
