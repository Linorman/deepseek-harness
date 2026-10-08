/** Shared publication rules for retained authorized Team read windows. */
import type { RpcResult, TeamId } from '@clocky/clocky-client-connection/client'
import { isTeamAuthorizationError } from './access.ts'

/** Resolve a read receipt; retire private state on denial and throw ordinary read failures.
 * @param result - Authenticated Host receipt.
 * @param retire - Reader-specific close and Team authorization invalidation.
 * @returns authorized data, or undefined after authorization retirement.
 */
export function acceptedRead<T>(result: RpcResult<T>, retire: () => void): T | undefined {
  if (result.ok) return result.value
  if (isTeamAuthorizationError(result.error)) { retire(); return undefined }
  throw new Error(result.error.message)
}

/** Keep the retained window visibly stale after ordinary transport loss.
 * @param state - Current authorized window.
 * @returns the disconnected publication with its request settled.
 */
export function disconnectedRead<State extends { readonly loading: boolean; readonly disconnected: boolean; readonly hasNewer: boolean }>(
  state: State,
): State {
  return { ...state, loading: false, disconnected: true, hasNewer: true }
}

/** Preserve content while settling the failed request.
 * @param state - Current retained window.
 * @param error - Carrier or validation failure.
 * @returns the settled publication and human-readable error.
 */
export function failedRead<State extends { readonly loading: boolean }>(state: State, error: unknown): State & { error: string } {
  return { ...state, loading: false, error: error instanceof Error ? error.message : String(error) }
}

/** Journal watermark shared by bounded Team page readers. */
export class ReadPageRevision {
  /** Lowest acceptable revision for the retained selection; reset by its owner on selection change. */
  minimumCursor = 0

  /** Advance the watermark and mark a retained page stale for the matching Team.
   * @param state - Current selected page, absent before selection.
   * @param teamId - Team whose authoritative journal changed.
   * @param cursor - Observed journal watermark.
   * @returns the retained or invalidated page; undefined for a different Team.
   */
  changed<State extends {
    readonly teamId: TeamId
    readonly page?: { readonly teamCursor: number } | undefined
    readonly hasNewer: boolean
  }>(
    state: State | undefined, teamId: TeamId, cursor: number,
  ): State | undefined {
    if (state?.teamId !== teamId) return undefined
    this.minimumCursor = Math.max(this.minimumCursor, cursor)
    return state.page !== undefined && cursor > state.page.teamCursor ? { ...state, hasNewer: true } : state
  }
}
