/** Runtime-owned exact member metadata and one bounded capability page. */
import type { IApiClient, ParticipantId, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamMemberDetailState } from '../contract/team-tasks.ts'
import { isTeamAuthorizationError } from './access.ts'

/** Independent inspection lifetime; navigation never activates a member. */
export class MemberInspector {
  private state: TeamMemberDetailState | undefined
  private request: AbortController | undefined
  private generation = 0
  private connected = true
  private minimumCursor = 0

  /**
   * @param api - Authenticated transport.
   * @param publish - Sole business snapshot publisher.
   * @param denied - Current-Team authorization invalidation.
   */
  constructor(private readonly api: IApiClient, private readonly publish: (state: TeamMemberDetailState | undefined) => void,
    private readonly denied: (teamId: TeamId) => void) {}

  /** Read one capability window, preserving prior content on ordinary failures.
   * @param teamId - Owning Team.
   * @param participantId - Exact member.
   * @param mode - First, current or next capability page.
   * @returns completion after publication or cancellation.
   */
  async read(teamId: TeamId, participantId: ParticipantId, mode: 'first' | 'refresh' | 'next' = 'first'): Promise<void> {
    const previous = this.state
    const same = previous?.teamId === teamId && previous.participantId === participantId
    const value = same ? previous.value : undefined
    if (mode === 'next' && (value?.nextCursor === undefined || previous?.hasNewer || previous?.error !== undefined)) return
    const afterCursor = mode === 'next' ? value?.nextCursor ?? -1 : mode === 'refresh' ? value?.startCursor ?? -1 : -1
    const expectedTeamCursor = mode === 'next' ? value?.teamCursor : undefined
    this.minimumCursor = same ? Math.max(this.minimumCursor, value?.teamCursor ?? 0) : 0
    const generation = this.cancel()
    if (generation !== this.generation) return
    const controller = new AbortController()
    this.request = controller
    this.set({ teamId, participantId, value, loading: this.connected, disconnected: !this.connected,
      hasNewer: same && previous.hasNewer })
    try {
      if (!this.connected || !this.current(generation, controller)) return
      const response = await this.api.teams.memberInspect({ teamId, participantId, afterCursor,
        ...expectedTeamCursor === undefined ? {} : { expectedTeamCursor } }, controller.signal)
      if (!this.current(generation, controller)) return
      if (!response.result.ok) {
        if (isTeamAuthorizationError(response.result.error)) { this.close(); this.denied(teamId); return }
        throw new Error(response.result.error.message)
      }
      const result = response.result.value
      if (result.record.teamId !== teamId || result.record.id !== participantId || result.startCursor !== afterCursor
        || result.teamCursor < this.minimumCursor || expectedTeamCursor !== undefined && result.teamCursor !== expectedTeamCursor
        || result.nextCursor !== undefined && result.nextCursor <= afterCursor) {
        throw new Error('Member inspection does not match its identity, revision or capability page')
      }
      this.set({ teamId, participantId, value: result, loading: false, disconnected: false, hasNewer: false })
    } catch (error: unknown) {
      if (this.current(generation, controller) && this.state !== undefined) this.set({ ...this.state, loading: false,
        error: error instanceof Error ? error.message : String(error) })
    } finally { if (this.request === controller) this.request = undefined }
  }

  /** Mark retained detail stale without replacing its window.
   * @param teamId - Changed Team.
   * @param cursor - Observed journal revision. */
  changed(teamId: TeamId, cursor: number): void {
    if (this.state?.teamId !== teamId) return
    this.minimumCursor = Math.max(this.minimumCursor, cursor)
    if (this.state.value !== undefined && cursor > this.state.value.teamCursor) this.set({ ...this.state, hasNewer: true })
  }

  /** Cancel old transport IO while retaining authorized content. */
  disconnect(): void {
    this.connected = false
    const generation = this.cancel()
    if (generation === this.generation && this.state !== undefined) {
      this.set({ ...this.state, loading: false, disconnected: true, hasNewer: true })
    }
  }

  /** Revalidate the retained window after handshake. */
  async reconnect(): Promise<void> {
    this.connected = true
    const state = this.state
    if (state !== undefined) await this.read(state.teamId, state.participantId, 'refresh')
  }

  /** Release detail and fence late responses before abort callbacks. */
  close(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.state = undefined
    this.publish(undefined)
  }

  private cancel(): number {
    const generation = ++this.generation
    const request = this.request
    this.request = undefined
    request?.abort()
    return generation
  }

  private current(generation: number, controller: AbortController): boolean {
    return generation === this.generation && !controller.signal.aborted
  }
  private set(state: TeamMemberDetailState): void { this.state = state; this.publish(state) }
}
