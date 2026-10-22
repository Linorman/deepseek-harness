/** Native retained calendar intent precedes execution and remains queryable after transport or browser restart. */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { simulationCalendarCommandSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { foldCalendarRevision } from './world-calendar.ts'
/** Closed journal events preserve the original authenticated command and separate pre-execution cancellation. */
export const calendarCommandRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('calendar-command/retained'), command: simulationCalendarCommandSchema }),
  z.strictObject({ kind: z.literal('calendar-command/cancelled'), commandId: z.string().min(1).max(256), principalId: z.string().min(1) }),
])
/** Fold one original calendar-intent record without performing its calendar effect.
 * @param state - Current paused Native prefix.
 * @param raw - Strict retained intent or cancellation.
 * @param sequence - Exact next journal position.
 * @returns immutable intent history; duplicates, stale quotes and author substitutions reject.
 */
export function foldCalendarCommand(state: SimulationSnapshot, raw: z.infer<typeof calendarCommandRecordSchema>,
  sequence: number): SimulationSnapshot {
  const record = calendarCommandRecordSchema.parse(raw), book = state.worldBootstrap
  if (book?.status !== 'applied' || sequence !== state.revision + 1) throw new Error('Calendar intent requires an initialized exact Native prefix')
  const commands = book.calendarCommands ?? []
  if (record.kind === 'calendar-command/cancelled') {
    const command = commands.find(value => value.request.commandId === record.commandId)
    if (command === undefined || command.principalId !== record.principalId || command.cancelledAt !== undefined
      || book.calendarRevisions?.some(value => value.request.commandId === record.commandId))
      throw new Error('Only an original unexecuted calendar command can be cancelled')
    return { ...state, worldBootstrap: { ...book, calendarCommands: commands.map(value =>
      value === command ? { ...value, cancelledAt: sequence } : value) } }
  }
  const command = record.command
  if (command.sequence !== sequence || command.quoteRevision !== state.revision || command.cancelledAt !== undefined
    || commands.some(value => value.request.commandId === command.request.commandId))
    throw new Error('Calendar intent changed its original quote or append identity')
  if (commands.some(value => value.principalId === command.principalId && value.cancelledAt === undefined
    && !book.calendarRevisions?.some(revision => revision.request.commandId === value.request.commandId)))
    throw new Error('The original author must settle the retained calendar command before creating another')
  const projected = foldCalendarRevision(state, command.request, sequence)
  const preview = { cancelled: Object.values(projected.scheduledEvents).filter(event => event.status === 'cancelled'
      && state.scheduledEvents[event.id]?.status === 'pending').map(event => event.id),
  queued: Object.values(projected.scheduledEvents).filter(event => state.scheduledEvents[event.id] === undefined)
    .map(event => ({ id: event.id, time: event.key.time })) }
  if (!isDeepStrictEqual(command.preview, preview)) throw new Error('Retained calendar command changed its exact preview effects')
  const next = { ...state, worldBootstrap: { ...book, calendarCommands: [...commands, command] } }
  foldCalendarRevision({ ...next, revision: sequence }, command.request, sequence + 1, { kind: 'host', principalId: command.principalId })
  if (Buffer.byteLength(JSON.stringify(next.worldBootstrap), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new Error('Complete retained calendar intent exceeds its original byte allowance')
  return next
}
/** Verify that every retained intent and calendar acceptance still share the same original author and payload.
 * @param state - Complete reconstructed Native history.
 * @returns normally only for exact immutable source relationships.
 */
export function assertCalendarCommands(state: SimulationSnapshot): void {
  const book = state.worldBootstrap
  for (const command of book?.calendarCommands ?? []) {
    simulationCalendarCommandSchema.parse(command)
    const revision = book?.calendarRevisions?.find(value => value.request.commandId === command.request.commandId)
    if (command.sequence > state.revision || command.quoteRevision + 1 !== command.sequence
      || command.cancelledAt !== undefined && (command.cancelledAt <= command.sequence || command.cancelledAt > state.revision)
      || revision !== undefined && (command.cancelledAt !== undefined || revision.sequence <= command.sequence
        || revision.author.principalId !== command.principalId || !isDeepStrictEqual(revision.request, command.request)))
      throw new Error('Calendar command lost its original quote, author or execution relationship')
  }
}
