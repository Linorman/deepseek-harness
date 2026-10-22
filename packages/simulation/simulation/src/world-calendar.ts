/** Closed finite calendar declarations and actual recipient selections; no executable or host-clock callback exists. */
import { z } from 'zod'
import { simulationCivilCalendarSchema, compileCivilCalendar } from './world-calendar-civil.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { simulationEventIdSchema } from './event-identities.ts'
import type { WorldCalendarId } from './world-bootstrap-types.ts'
import type { WorldDirectorEventId } from './world-bootstrap-types.ts'

const text = z.string().min(1)
const key = text.max(256)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** An authored stable finite calendar identity; its occurrence is separately Native-owned. */
export const worldCalendarIdSchema = key.transform(value => value as WorldCalendarId)
/** Original authored director declaration identity, separate from its calendar and actual occurrence. */
export const worldDirectorEventIdSchema = key.transform(value => value as WorldDirectorEventId)
/** Exact persisted scenario authorization, derived by Native rather than supplied in a model operation. */
export const simulationWorldDirectorTriggerSchema = z.strictObject({ declarationId: worldDirectorEventIdSchema,
  calendarId: worldCalendarIdSchema, occurrence: count, eventId: simulationEventIdSchema,
  time: simTimeSchema, sequence: count.positive(), bootstrapSequence: count.positive(),
})
/** Trusted actor or position target; no model may supply its later resolved recipient. */
export const simulationWorldGoalTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('person'), personId: simulationEntityIdSchema }),
  z.strictObject({ kind: z.literal('position'), positionId: simulationEntityIdSchema }),
])
/** Finite simulated shifts; wall-clock timezone rules are deliberately unsupported rather than host-dependent. */
export const simulationCalendarRecurrenceSchema = z.strictObject({
  version: z.literal(1), clock: z.literal('simulation'),
  shifts: z.array(simTimeSchema).min(1).max(64),
  exceptions: z.array(simTimeSchema).max(4096),
  additions: z.array(simTimeSchema).max(4096),
}).refine(value => [value.shifts, value.exceptions, value.additions].every(items => new Set(items).size === items.length),
  'Calendar shifts and exception times must be distinct')
/** Compile finite shifts and exceptions against the explicit simulated horizon.
 * @param value - Original finite calendar declaration, with no ambient timezone or clock.
 * @returns canonical ordered unique simulated times, bounded by maxOccurrences.
 */
export function compileCalendarTimes(value: {
  startsAt: string
  endsAt: string | null
  period: string
  maxOccurrences: number
  recurrence?: z.infer<typeof simulationCalendarRecurrenceSchema> | undefined
  civil?: z.infer<typeof simulationCivilCalendarSchema> | undefined
}): string[] {
  if (value.civil !== undefined) {
    if (value.recurrence !== undefined || value.endsAt === null) throw new Error('Civil calendar requires one finite clock declaration')
    const times = compileCivilCalendar(value.civil, value.maxOccurrences)
    if (times.some(time => BigInt(time) < BigInt(value.startsAt) || BigInt(time) > BigInt(value.endsAt ?? '0')))
      throw new Error('Compiled civil occurrences exceed their canonical simulation horizon')
    return times
  }
  if (value.recurrence === undefined) throw new Error('Explicit recurrence is required for expanded calendar compilation')
  const recurrence = simulationCalendarRecurrenceSchema.parse(value.recurrence)
  if (value.endsAt === null || value.maxOccurrences > 4096 || value.maxOccurrences < 1)
    throw new Error('Expanded calendar requires a finite horizon and at most 4096 occurrences')
  const start = BigInt(value.startsAt), end = BigInt(value.endsAt), period = BigInt(value.period)
  if (period <= 0n || end < start || (end - start) / period >= 4096n)
    throw new Error('Calendar recurrence exceeds its finite cycle bound')
  if (recurrence.shifts.some(shift => BigInt(shift) >= period)) throw new Error('Shift must lie within its recurrence period')
  const excluded = new Set<string>(recurrence.exceptions), times = new Set<string>()
  for (let cycle = start; cycle <= end; cycle += period) {
    for (const shift of recurrence.shifts) {
      const time = cycle + BigInt(shift)
      if (time <= end && !excluded.has(String(time))) times.add(String(time))
    }
  }
  for (const time of recurrence.additions) {
    if (BigInt(time) < start || BigInt(time) > end || excluded.has(time))
      throw new Error('Added calendar occurrence is outside the horizon or excluded')
    times.add(time)
  }
  if (times.size === 0 || times.size > value.maxOccurrences)
    throw new Error('Compiled calendar must contain between one and maxOccurrences events')
  return [...times].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
}
/** A finite periodic goal queues only its next original occurrence. */
export const simulationWorldCalendarSchema = z.strictObject({ id: worldCalendarIdSchema,
  target: simulationWorldGoalTargetSchema, body: text, startsAt: simTimeSchema, endsAt: simTimeSchema.nullable(),
  recurrence: simulationCalendarRecurrenceSchema.optional(), civil: simulationCivilCalendarSchema.optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  period: simTimeSchema.refine(value => BigInt(value) > 0n, 'Calendar period must be positive'), maxOccurrences: count.positive(),
}).refine(value => value.endsAt === null || BigInt(value.endsAt) >= BigInt(value.startsAt),
  'Calendar end cannot precede its first occurrence')
  .refine(value => value.recurrence === undefined || value.civil === undefined, 'A calendar selects one clock expression')
/** One original declaration, independent from a model's proposed goal or recipient. */
export const simulationWorldCalendarSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('initial'), id: key }),
  z.strictObject({ kind: z.literal('calendar'), id: worldCalendarIdSchema, revision: count.min(2).optional() }),
])
/** Exact actual trigger and frozen recipients; a later transfer cannot rewrite this original selection. */
export const simulationWorldCalendarOccurrenceSchema = z.strictObject({ source: simulationWorldCalendarSourceSchema,
  occurrence: count, eventId: simulationEventIdSchema, time: simTimeSchema, sequence: count.positive(),
  recipients: z.array(simulationEntityIdSchema).refine(values => new Set(values).size === values.length,
    'Calendar recipients must be distinct'),
  directorEvents: z.array(z.discriminatedUnion('status', [
    z.strictObject({ declarationId: worldDirectorEventIdSchema, status: z.literal('eligible'), wakeId: simulationEventIdSchema }),
    z.strictObject({ declarationId: worldDirectorEventIdSchema, status: z.literal('budget-exhausted') }),
  ])),
})
/** Original finite calendar-derived authority; no business payload or actor identity comes from the model. */
export type SimulationWorldDirectorTrigger = z.infer<typeof simulationWorldDirectorTriggerSchema>
/** Saved original selection, used by replay and model context without another position lookup. */
export type SimulationWorldCalendarOccurrence = z.infer<typeof simulationWorldCalendarOccurrenceSchema>
/** Original finite declaration reference carried by the scheduler action. */
export type SimulationWorldCalendarSource = z.infer<typeof simulationWorldCalendarSourceSchema>

/** Host-authorized replacement affects only unaccepted future occurrences and retains an idempotent command identity. */
export const simulationCalendarRevisionRequestSchema = z.strictObject({ commandId: key,
  expectedRuleRevision: count.positive(), calendar: simulationWorldCalendarSchema })
/** Original replacement command and its Native append cursor, retained alongside immutable bootstrap data. */
export const simulationCalendarRevisionSchema = z.strictObject({ request: simulationCalendarRevisionRequestSchema,
  revision: count.positive(), sequence: count.positive(), author: z.strictObject({ kind: z.literal('host'), principalId: text.nullable() }) })

/** Complete original bounded replacement command accepted by the Native calendar owner. */
export type SimulationCalendarRevisionRequest = z.infer<typeof simulationCalendarRevisionRequestSchema>
/** Original rule revision, authenticated Host source and exact Native append cursor. */
export type SimulationCalendarRevision = z.infer<typeof simulationCalendarRevisionSchema>

/** Original authenticated calendar submission is retained before execution, so a fresh client can recover its exact quote. */
export const simulationCalendarCommandSchema = z.strictObject({ request: simulationCalendarRevisionRequestSchema,
  quoteRevision: count, quoteHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  preview: z.strictObject({ cancelled: z.array(simulationEventIdSchema),
    queued: z.array(z.strictObject({ id: simulationEventIdSchema, time: simTimeSchema })) }),
  principalId: text, sequence: count.positive(), cancelledAt: count.positive().optional() })
/** Native-owned original user intent; execution/cancellation never replace its request. */
export type SimulationCalendarCommand = z.infer<typeof simulationCalendarCommandSchema>
