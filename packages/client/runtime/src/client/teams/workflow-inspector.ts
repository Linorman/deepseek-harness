/** One revision-pinned workflow page, with cancellable reads and explicit refresh. */
import type { IApiClient, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamWorkflowDetailState, TeamWorkflowDetailReadMode, TeamWorkflowSummary } from '../contract/team-tasks.ts'

const WORKFLOW_PAGE_LIMIT = 64

/** Own the workflow inspector independently from list refreshes and module navigation. */
export class WorkflowInspector {
  private state: TeamWorkflowDetailState | undefined
  private generation = 0
  private minimumRevision = 0
  private request: AbortController | undefined

  /** @param api - Host transport.
   * @param publish - Product snapshot owner.
   */
  constructor(private readonly api: IApiClient, private readonly publish: (state: TeamWorkflowDetailState | undefined) => void) {}

  /** Release the visible workflow and retire its pending request. */
  close(): void {
    const generation = this.cancel()
    if (generation !== this.generation) return
    this.minimumRevision = 0
    this.state = undefined
    this.publish(undefined)
  }

  /** Keep the page visible while disabling further reads until reconnection. */
  disconnect(): void {
    const generation = this.cancel()
    if (generation === this.generation && this.state !== undefined) {
      this.set({ ...this.state, loading: false, disconnected: true, hasNewer: true })
    }
  }

  /** Revalidate the selected page against the reconnected Host. */
  async reconnect(): Promise<void> {
    if (this.state !== undefined) await this.read(this.state.teamId, this.state.planId, 'refresh')
  }

  /** Mark a newer workflow without replacing the page being read.
   * @param teamId - Owning Team.
   * @param planId - Changed plan.
   * @param revision - Observed revision.
   */
  changed(teamId: TeamId, planId: TeamWorkflowSummary['id'], revision: number): void {
    if (this.state?.teamId !== teamId || this.state.planId !== planId) return
    this.minimumRevision = Math.max(this.minimumRevision, revision)
    if (revision > (this.state.value?.record.revision ?? 0)) this.set({ ...this.state, hasNewer: true })
  }

  /** Read one workflow window; stale replies and failures cannot erase an existing page.
   * @param teamId - Selected Team.
   * @param planId - Selected workflow.
   * @param mode - Requested page navigation.
   */
  async read(teamId: TeamId, planId: TeamWorkflowSummary['id'], mode: TeamWorkflowDetailReadMode = 'open'): Promise<void> {
    const previous = this.state?.teamId === teamId && this.state.planId === planId ? this.state : undefined
    if (mode === 'open' && previous?.value !== undefined) return
    const pageSelection = this.resolveWindow(previous, mode)
    if (pageSelection === undefined) return
    const generation = this.cancel()
    if (generation !== this.generation) return
    if (previous === undefined) this.minimumRevision = 0
    const controller = new AbortController()
    this.request = controller
    const { afterCursor, expectedRevision } = pageSelection
    this.set({ ...previous, teamId, planId, loading: true, hasNewer: previous?.hasNewer ?? false, disconnected: false, error: undefined })
    if (generation !== this.generation) return
    try {
      const response = await this.api.teams.workflowPlanInspect({ teamId, planId, afterCursor, limit: WORKFLOW_PAGE_LIMIT,
        ...expectedRevision === undefined ? {} : { expectedRevision } }, controller.signal)
      if (generation !== this.generation) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      const value = response.result.value
      if (value.items.length > WORKFLOW_PAGE_LIMIT) throw new Error('Workflow inspection exceeds its requested row limit')
      if (value.record.teamId !== teamId || value.record.id !== planId || value.startCursor !== afterCursor
        || value.record.revision < this.minimumRevision || expectedRevision !== undefined && value.record.revision !== expectedRevision) throw new Error('Workflow inspection is stale or belongs to another selection')
      this.minimumRevision = value.record.revision
      this.set({ teamId, planId, value, loading: false, hasNewer: false, disconnected: false })
    } catch (error: unknown) {
      if (generation === this.generation && this.state !== undefined) {
        this.set({ ...this.state, loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    } finally { if (generation === this.generation) this.request = undefined }
  }

  private resolveWindow(previous: TeamWorkflowDetailState | undefined, mode: TeamWorkflowDetailReadMode):
    { afterCursor: number; expectedRevision?: number } | undefined {
    switch (mode) {
      case 'open': case 'first': return { afterCursor: -1 }
      case 'refresh': return { afterCursor: previous?.value?.startCursor ?? -1 }
      case 'next': {
        if (previous?.value?.nextCursor === undefined || previous.hasNewer) return undefined
        return { afterCursor: previous.value.nextCursor, expectedRevision: previous.value.record.revision }
      }
      // v8 ignore next -- typed callers can only select the four handled modes.
      default: { const invalid: never = mode; throw new Error(`Unknown workflow read mode: ${String(invalid)}`) }
    }
  }

  private cancel(): number {
    const generation = ++this.generation
    const request = this.request
    this.request = undefined
    request?.abort()
    return generation
  }

  private set(state: TeamWorkflowDetailState): void { this.state = state; this.publish(state) }
}
