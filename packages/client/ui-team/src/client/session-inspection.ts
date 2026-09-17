/** Latest-request-wins Session inspection; navigation never owns execution cancellation. */
import type { SessionId, TeamId } from '@clocky/clocky-client-runtime/client'

interface SessionInspection {
  cancel: () => void
  open: (teamId: TeamId, resolve: (signal: AbortSignal) => Promise<SessionId>) => Promise<void>
}

/**
 * Coordinate asynchronous Session resolution and refresh under one cancellable viewing request.
 * @param controls - current Team identity and the runtime Session read/select operations.
 * @returns inspection and invalidation operations for the plugin's UI callbacks.
 */
export function createSessionInspection(controls: {
  currentTeam: () => TeamId | undefined
  refresh: () => Promise<unknown>
  select: (sessionId: SessionId) => void
}): SessionInspection {
  let pending: AbortController | undefined
  const cancel = () => { pending?.abort(); pending = undefined }
  return {
    cancel,
    async open(teamId: TeamId, resolve: (signal: AbortSignal) => Promise<SessionId>): Promise<void> {
      cancel()
      const controller = new AbortController()
      pending = controller
      const isCurrent = () => !controller.signal.aborted && controls.currentTeam() === teamId
      try {
        const sessionId = await resolve(controller.signal)
        if (!isCurrent()) return
        await controls.refresh()
        if (isCurrent()) controls.select(sessionId)
      } catch (error: unknown) {
        if (isCurrent()) throw error
      } finally {
        if (pending === controller) pending = undefined
      }
    },
  }
}
