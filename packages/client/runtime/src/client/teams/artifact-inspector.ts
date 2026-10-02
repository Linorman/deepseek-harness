/** One authoritative artifact byte window, independent of React and list pagination. */
import type { IApiClient, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamArtifactDetailState } from '../contract/team-tasks.ts'
import { isTeamAuthorizationError } from './access.ts'

/** Retained bytes are never republished after target or authorization retirement. */
export class ArtifactInspector {
  private state: TeamArtifactDetailState | undefined
  private request: AbortController | undefined
  private generation = 0
  private connected = true
  private transitions = 0

  /** @param api - Authenticated carrier. @param publish - Sole byte-window publisher. @param denied - Team authorization retirement. */
  constructor(private readonly api: IApiClient, private readonly publish: (state: TeamArtifactDetailState | undefined) => void,
    private readonly denied: (teamId: TeamId) => void) {}

  /**
   * Read one exact artifact; refresh failure preserves this target's approved bytes.
   * @param teamId - Owning Team.
   * @param artifactId - Exact provider-backed reference.
   * @param signal - Caller viewing cancellation, never an execution cancellation.
   * @returns read settlement; content is published only through the owning snapshot.
   */
  async read(teamId: TeamId, artifactId: string, signal?: AbortSignal): Promise<void> {
    if (this.transitions !== 0) return
    const previous = this.state
    const same = previous?.teamId === teamId && previous.artifactId === artifactId
    const value = same ? previous.value : undefined
    const generation = this.cancel()
    if (generation !== this.generation) return
    const request = new AbortController()
    this.request = request
    const linked = signal === undefined ? request.signal : AbortSignal.any([request.signal, signal])
    this.set({ teamId, artifactId, value, loading: this.connected && !linked.aborted,
      disconnected: !this.connected, stale: same && previous.stale || !this.connected })
    try {
      if (!this.current(generation, request, linked)) return
      const response = await this.api.teams.artifactRead({ teamId, artifactId }, linked)
      if (!this.current(generation, request, linked)) return
      if (!response.result.ok) {
        if (isTeamAuthorizationError(response.result.error)) { this.close(); this.denied(teamId); return }
        throw new Error(response.result.error.message)
      }
      const result = response.result.value
      if (result.artifact.id !== artifactId) throw new Error('Artifact response belongs to another reference')
      const padding = result.data.endsWith('==') ? 2 : result.data.endsWith('=') ? 1 : 0
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data)
        || result.data.length / 4 * 3 - padding !== result.bytes) throw new Error('Artifact response has invalid encoded byte metadata')
      this.set({ teamId, artifactId, value: result, loading: false, disconnected: false, stale: false })
    } catch (error: unknown) {
      if (this.current(generation, request, linked) && this.state !== undefined) this.set({ ...this.state,
        loading: false, stale: true, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (this.request === request) {
        this.request = undefined
        if (this.state?.loading) this.set({ ...this.state, loading: false, stale: true })
      }
    }
  }

  /** Ordinary disconnection retains authorized bytes and rejects old responses. */
  disconnect(): void {
    this.transitions++
    try {
      this.connected = false; this.cancel()
      if (this.state !== undefined) this.set({ ...this.state, loading: false, disconnected: true, stale: true })
    } finally { this.transitions-- }
  }
  /** Revalidate the exact retained target after the completed handshake. @returns read settlement. */
  async reconnect(): Promise<void> {
    this.connected = true
    if (this.state !== undefined) await this.read(this.state.teamId, this.state.artifactId)
  }
  /** Close or revoke the selected window without retaining its private bytes. */
  close(): void {
    this.transitions++
    try { this.cancel(); this.set(undefined) } finally { this.transitions-- }
  }

  private cancel(): number {
    const generation = ++this.generation
    const request = this.request; this.request = undefined; request?.abort()
    return generation
  }
  private current(generation: number, request: AbortController, linked: AbortSignal): boolean {
    return this.connected && !linked.aborted && this.generation === generation && this.request === request
  }
  private set(state: TeamArtifactDetailState | undefined): void { this.state = state; this.publish(state) }
}
