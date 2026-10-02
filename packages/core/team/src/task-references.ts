/** Exact dependency display/status reads without task histories or unrelated collection pages. */
import { TeamError } from './error.ts'
import { teamTextSummary } from './display-text.ts'
import type { TeamId, TeamTaskId, TeamTaskSnapshot, TeamSelectionText } from './types.ts'

/** Requested references and a revision-pinned offset within that exact input vector. */
export interface TeamTaskReferencesInput {
  readonly teamId: TeamId
  readonly taskIds: readonly TeamTaskId[]
  readonly expectedTeamCursor?: number | undefined
  readonly afterCursor?: number | undefined
}

/** Missing and foreign-Team IDs are indistinguishable within an authorized Team read. */
export type TeamTaskReference = { readonly taskId: TeamTaskId
  readonly state: 'unavailable' }
  | { readonly taskId: TeamTaskId
    readonly state: 'resolved'
    readonly revision: number
    readonly phase: TeamTaskSnapshot['phase']
    readonly subject: TeamSelectionText }

/** One byte-bounded slice of the requested references. */
export interface TeamTaskReferencesPage {
  readonly teamId: TeamId
  readonly teamCursor: number
  readonly items: readonly TeamTaskReference[]
  readonly nextCursor?: number | undefined
}

/**
 * Project only explicitly selected IDs under the provider's Team serializer.
 * @param tasks - Authoritative Team task map, including tombstones.
 * @param cursor - Current Team journal watermark.
 * @param input - Parsed, duplicate-free reference vector and optional continuation.
 * @param maxRows - Resolved provider page allowance.
 * @param maxTextBytes - UTF-8 title allowance.
 * @param maxBytes - Complete JSON response allowance, including metadata and continuation.
 * @returns one exact ordered slice; cursor movement and indivisible oversized rows reject.
 */
export function resolveTaskReferences(tasks: ReadonlyMap<TeamTaskId, TeamTaskSnapshot>, cursor: number,
  input: TeamTaskReferencesInput, maxRows: number, maxTextBytes: number, maxBytes: number): TeamTaskReferencesPage {
  if (input.expectedTeamCursor !== undefined && input.expectedTeamCursor !== cursor) {
    throw new TeamError('Task references changed; refresh the selected set', 'TEAM_CURSOR_CONFLICT')
  }
  const offset = input.afterCursor ?? 0
  if (offset > input.taskIds.length) throw new TeamError('Task reference offset exceeds the requested set', 'TEAM_INVALID_ARGUMENT')
  const items: TeamTaskReference[] = []
  const page = (nextCursor?: number): TeamTaskReferencesPage => ({ teamId: input.teamId, teamCursor: cursor, items,
    ...nextCursor === undefined ? {} : { nextCursor } })
  const bytes = (value: TeamTaskReferencesPage) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (bytes(page()) > maxBytes) throw new TeamError('Task reference metadata exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
  let next: number | undefined
  for (let index = offset; index < input.taskIds.length; index++) {
    if (items.length === maxRows) { next = index; break }
    const taskId = input.taskIds[index] as TeamTaskId
    const task = tasks.get(taskId)
    items.push(task === undefined ? { taskId, state: 'unavailable' } : { taskId, state: 'resolved', revision: task.revision,
      phase: task.phase, subject: teamTextSummary(task.subject, maxTextBytes) })
    if (bytes(page(index + 1 < input.taskIds.length ? index + 1 : undefined)) > maxBytes) {
      items.pop()
      if (items.length === 0) throw new TeamError('Task reference row exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
      next = index; break
    }
  }
  return page(next)
}
