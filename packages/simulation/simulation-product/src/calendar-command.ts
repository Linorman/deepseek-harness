/** Private calendar command recovery projects the same Native intent owner used by execution. */
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { SimulationProductRunId } from './types.ts'
import { simulationProductCalendarCommandResultSchema } from './calendar-schema.ts'
import type { SimulationProductCalendarCommandResult } from './calendar-types.ts'

/** Select the original author's unresolved command, preferring it over older settled edits.
 * @param state - Authoritatively inspected current Native prefix.
 * @param runId - Actual Product-owned run selector.
 * @param principalId - Current authenticated principal, never a field supplied by the browser.
 * @param commandId - Optional exact original identity; omission recovers one bounded latest command.
 * @returns a private original quote and outcome, or null without leaking another author's command.
 */
export function projectCalendarCommand(state: SimulationSnapshot, runId: SimulationProductRunId, principalId: string,
  commandId?: string): SimulationProductCalendarCommandResult {
  const book = state.worldBootstrap
  const candidates = (book?.calendarCommands ?? []).filter(value => value.principalId === principalId
    && (commandId === undefined || value.request.commandId === commandId)).sort((a, b) => b.sequence - a.sequence)
  const command = candidates.find(value => value.cancelledAt === undefined
    && !book?.calendarRevisions?.some(revision => revision.request.commandId === value.request.commandId)) ?? candidates[0]
  if (command === undefined) return { command: null }
  const revision = book?.calendarRevisions?.find(value => value.request.commandId === command.request.commandId)
  return simulationProductCalendarCommandResultSchema.parse({ command: {
    preview: { input: { runId, request: command.request }, revision: command.quoteRevision, previewHash: command.quoteHash,
      cancelled: command.preview.cancelled, queued: command.preview.queued }, retainedSequence: command.sequence,
    status: revision !== undefined ? 'applied' : command.cancelledAt !== undefined ? 'cancelled' : 'retained',
    receipt: revision === undefined ? null : { runId, commandId: command.request.commandId, revision: revision.sequence,
      ruleRevision: revision.revision, sequence: revision.sequence } } })
}
