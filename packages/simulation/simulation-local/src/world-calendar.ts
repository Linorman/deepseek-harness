/** Finite authored goal scheduling shares the original Native queue and records each actual recipient selection. */
import { isDeepStrictEqual } from 'node:util'
import { simulationEventIdSchema, simTimeSchema, parseSimTime, simulationWorldCalendarOccurrenceSchema, compileCalendarTimes, simulationCalendarRevisionRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationScheduledEvent, SimulationEntityId, SimulationWorldCalendarSource,
  SimulationWorldCalendarOccurrence } from '@clocky/clocky-simulation'
import type { SchedulerRecord } from './scheduler.ts'
import { allocateEventKey, foldSchedulerRecord } from './scheduler.ts'
import { businessFingerprint } from './business.ts'
import { directorOccurrenceEntries, directorEventReason, directorTriggerFromWake, assertDirectorOccurrence } from './world-director-event.ts'

type CalendarAction = Extract<SimulationScheduledEvent['action'], { kind: 'world-calendar' }>
function definition(state: SimulationSnapshot, source: SimulationWorldCalendarSource) {
  const data = state.worldBootstrap?.request.data.behavior
  if (data === undefined) throw new Error('World calendar lost its original scenario bootstrap')
  if (source.kind === 'initial') {
    const value = data.initialGoals.find(value => value.id === source.id)
    if (value === undefined) throw new Error('Initial world goal is absent from its original bootstrap')
    return { recurrence: undefined, civil: undefined, priority: undefined, target: value.target, body: value.body, startsAt: value.at, endsAt: value.at, period: simTimeSchema.parse('1'), maxOccurrences: 1 }
  }
  if (source.revision !== undefined && source.revision !== 1) {
    const saved = state.worldBootstrap?.calendarRevisions?.find(value =>
      value.request.calendar.id === source.id && value.revision === source.revision)
    if (saved === undefined) throw new Error('Calendar revision is absent from its Native owner')
    return saved.request.calendar
  }
  const value = data.calendars.find(value => value.id === source.id)
  if (value === undefined) throw new Error('World calendar is absent from its original bootstrap')
  return value
}
/** Derive the stable identity for one authored calendar occurrence.
 * @param source - Immutable authored declaration.
 * @param occurrence - Zero-based actual occurrence.
 * @returns the sole run-local event identity; unrelated names cannot collide with the composite key.
 */
export function worldCalendarEventId(source: SimulationWorldCalendarSource, occurrence: number): SimulationScheduledEvent['id'] {
  return simulationEventIdSchema.parse(`simulation-world-calendar:${businessFingerprint([source, occurrence]).slice(7)}`)
}
/** Resolve one finite index against its original simulated horizon.
 * @param state - Original frozen declaration.
 * @param action - Retained finite index.
 * @returns the exact canonical simulated time, or rejects an occurrence beyond its original end or horizon.
 */
export function worldCalendarTime(state: SimulationSnapshot, action: CalendarAction): SimulationScheduledEvent['key']['time'] {
  const value = definition(state, action.source)
  if (action.occurrence >= value.maxOccurrences) throw new Error('World calendar occurrence exceeds its frozen maximum')
  if ((value.recurrence !== undefined || value.civil !== undefined)) {
    const time = compileCalendarTimes(value)[action.occurrence]
    if (time === undefined) throw new Error('World calendar occurrence exceeds its compiled schedule')
    return parseSimTime(time, state.spec.maxTime)
  }
  const time = parseSimTime(String(BigInt(value.startsAt) + BigInt(value.period) * BigInt(action.occurrence)), state.spec.maxTime)
  if (value.endsAt !== null && BigInt(time) > BigInt(value.endsAt)) throw new Error('World calendar occurrence exceeds its declared end')
  return time
}
/** Reject an event detached from its original calendar declaration.
 * @param state - Complete original bootstrap.
 * @param event - Proposed or replayed event.
 * @returns normally only for the original finite declaration, index, predecessor and time.
 */
export function assertWorldCalendarSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'action' | 'key'>): void {
  if (event.action.kind !== 'world-calendar' || event.id !== worldCalendarEventId(event.action.source, event.action.occurrence)
    || event.key.time !== worldCalendarTime(state, event.action) || event.key.phase !== 'decision'
    || event.key.priority !== worldCalendarPriority(state, event.action))
    throw new Error('World calendar event differs from its original source or simulated time')
  if (event.action.occurrence > 0 && !state.worldBootstrap?.occurrences.some(value =>
    isDeepStrictEqual(value.source, event.action.kind === 'world-calendar' ? event.action.source : undefined)
    && value.occurrence === (event.action.kind === 'world-calendar' ? event.action.occurrence - 1 : -1)))
    throw new Error('World calendar cannot queue an occurrence before its actual predecessor')
}
function queue(state: SimulationSnapshot, action: CalendarAction): SchedulerRecord {
  return { kind: 'event/queued', id: worldCalendarEventId(action.source, action.occurrence), action,
    key: allocateEventKey(state, worldCalendarTime(state, action), action) }
}
/** Queue only the first event of each original finite declaration.
 * @param state - Original source-retaining paused initialization.
 * @returns at most one initial event per declared goal/calendar; future occurrences are never pre-expanded.
 */
export function initialWorldCalendarRecords(state: SimulationSnapshot): SchedulerRecord[] {
  const data = state.worldBootstrap?.request.data.behavior
  if (data === undefined) return []
  const sources: SimulationWorldCalendarSource[] = [
    ...data.initialGoals.map(value => ({ kind: 'initial' as const, id: value.id })),
    ...data.calendars.map(value => ({ kind: 'calendar' as const, id: value.id })),
  ]
  let projected = state
  return sources.map((source) => {
    const record = queue(projected, { kind: 'world-calendar', source, occurrence: 0 })
    projected = foldSchedulerRecord(projected, record, state.revision + 1)
    return record
  })
}
function recipients(state: SimulationSnapshot, action: CalendarAction): SimulationEntityId[] {
  const target = definition(state, action.source).target
  const ids = target.kind === 'person' ? [target.personId] : Object.values(state.relations)
    .filter(value => value.relation === 'assignment' && value.object === target.positionId
      && BigInt(value.validFrom) <= BigInt(state.time) && (value.validUntil === null || BigInt(state.time) < BigInt(value.validUntil)))
    .map(value => value.subject)
  return [...new Set(ids)].filter((id) => {
    const actor = state.entities[id]
    const scenarioDirector = id === state.world?.definition.directorEntityId && action.source.kind === 'calendar'
      && state.worldBootstrap?.request.data.behavior.directorEvents.some(value => value.calendarId === action.source.id)
    return !scenarioDirector && actor?.phase === 'active' && actor.cognition === 'agent'
      && actor.readiness === 'ready' && actor.binding !== undefined
  }).sort()
}
/** Derive an original selected recipient’s stable goal wake identity.
 * @param occurrence - Actual frozen source selection.
 * @param recipient - One of its original recipients.
 * @returns the sole derived wake identity.
 */
export function worldCalendarWakeId(occurrence: SimulationWorldCalendarOccurrence, recipient: SimulationEntityId): SimulationScheduledEvent['id'] {
  return simulationEventIdSchema.parse(`simulation-world-calendar-wake:${businessFingerprint([occurrence.source,
    occurrence.occurrence, recipient]).slice(7)}`)
}
/** Verify a goal wake against its actual persisted recipient selection.
 * @param state - Actual consumed scheduler prefix.
 * @param event - Derived proposed or historical wake.
 * @returns the original occurrence; the source clock and selected actor cannot be changed by a model or later reassignment.
 */
export function assertWorldCalendarWakeSource(state: SimulationSnapshot,
  event: Pick<SimulationScheduledEvent, 'id' | 'action' | 'key'>): SimulationWorldCalendarOccurrence {
  const occurrence = state.worldBootstrap?.occurrences.find(value =>
    value.recipients.some(id => event.id === worldCalendarWakeId(value, id)))
  if (occurrence === undefined || event.action.kind !== 'wake' || !occurrence.recipients.includes(event.action.entityId)
    || event.key.time !== occurrence.time || event.key.phase !== 'decision'
    || event.action.reason !== JSON.stringify({ kind: 'world-goal', version: 1, goal: definition(state, occurrence.source).body }))
    throw new Error('World calendar wake lost its actual source, time or frozen recipient')
  return occurrence
}
/** Consume a finite occurrence and transfer its exact scheduling responsibilities.
 * @param state - Current consumed-event prefix with its committed simulation time.
 * @param event - Actual next calendar event.
 * @param sequence - Original Native consumption cursor.
 * @returns atomic recipient selection, original goal wakes and at most one successor.
 */
export function consumeWorldCalendar(state: SimulationSnapshot, event: SimulationScheduledEvent, sequence: number): SimulationSnapshot {
  assertWorldCalendarSource(state, event)
  if (event.action.kind !== 'world-calendar' || state.worldBootstrap?.status !== 'applied' || state.world === undefined)
    throw new Error('World calendar consumption requires completed scenario initialization')
  const action = event.action, original = definition(state, action.source)
  if (state.worldBootstrap.occurrences.some(value => isDeepStrictEqual(value.source, action.source)
    && value.occurrence === action.occurrence)) throw new Error('World calendar occurrence already has its actual selection')
  const occurrence = simulationWorldCalendarOccurrenceSchema.parse({ source: action.source, occurrence: action.occurrence,
    eventId: event.id, time: event.key.time, sequence, recipients: recipients(state, action),
    directorEvents: directorOccurrenceEntries(state, { source: action.source, occurrence: action.occurrence }) })
  let next: SimulationSnapshot = { ...state, worldBootstrap: { ...state.worldBootstrap,
    occurrences: [...state.worldBootstrap.occurrences, occurrence] } }
  for (const id of occurrence.recipients) {
    const wake = { kind: 'wake' as const, entityId: id,
      reason: JSON.stringify({ kind: 'world-goal', version: 1, goal: original.body }) }
    next = foldSchedulerRecord(next, { kind: 'event/queued', id: worldCalendarWakeId(occurrence, id),
      action: wake, key: allocateEventKey(next, occurrence.time, wake) }, sequence)
  }
  for (const entry of occurrence.directorEvents) {
    if (entry.status !== 'eligible') continue
    if (occurrence.source.kind !== 'calendar') throw new Error('Director event requires its original calendar')
    const trigger = { declarationId: entry.declarationId, calendarId: occurrence.source.id,
      occurrence: occurrence.occurrence, eventId: occurrence.eventId, time: occurrence.time,
      sequence, bootstrapSequence: state.worldBootstrap.sequence }
    const wake = { kind: 'wake' as const, entityId: state.world.definition.directorEntityId,
      reason: directorEventReason(next, trigger) }
    next = foldSchedulerRecord(next, { kind: 'event/queued', id: entry.wakeId,
      action: wake, key: allocateEventKey(next, occurrence.time, wake) }, sequence)
  }
  const successor = action.occurrence + 1
  const time = BigInt(original.startsAt) + BigInt(original.period) * BigInt(successor)
  const expanded = original.recurrence !== undefined || original.civil !== undefined
  const compiledCount = expanded ? compileCalendarTimes(original).length : original.maxOccurrences
  if (successor < compiledCount && (expanded || original.endsAt === null || time <= BigInt(original.endsAt))) {
    next = foldSchedulerRecord(next, queue(next, { ...action, occurrence: successor }), sequence)
  }
  if (Buffer.byteLength(JSON.stringify(next.worldBootstrap), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new Error('Complete original world calendar history exceeds its frozen byte bound')
  return next
}
/** Verify all original occurrence, event and recipient wake relationships.
 * @param state - Complete durable projection.
 * @returns normally only when each consumed occurrence retains exact source/recipients and all derived wake responsibilities.
 */
export function assertWorldCalendarProjection(state: SimulationSnapshot): void {
  const book = state.worldBootstrap
  if (book === undefined) return
  for (const occurrence of book.occurrences) {
    const event = state.scheduledEvents[occurrence.eventId]
    if (event?.status !== 'consumed' || event.settledAt !== occurrence.sequence || event.key.time !== occurrence.time)
      throw new Error('World calendar occurrence lost its original consumed scheduler event')
    assertWorldCalendarSource(state, event)
    for (const id of occurrence.recipients) {
      const wake = state.scheduledEvents[worldCalendarWakeId(occurrence, id)]
      if (wake === undefined) throw new Error('World calendar lost an original selected recipient wake')
      assertWorldCalendarWakeSource(state, wake)
    }
    assertDirectorOccurrence(state, occurrence)
  }
  for (const event of Object.values(state.scheduledEvents)) {
    if (event.action.kind === 'world-calendar') {
      assertWorldCalendarSource(state, event)
      const source = event.action.source
      if (event.status === 'pending' && source.kind === 'calendar') {
        const latest = book.calendarRevisions?.filter(value => value.request.calendar.id === source.id).at(-1)
        if ((source.revision ?? 1) !== (latest?.revision ?? 1)) throw new Error('Pending calendar belongs to a superseded rule')
      }
    }
    if (event.id.startsWith('simulation-world-calendar-wake:')) assertWorldCalendarWakeSource(state, event)
    if (event.id.startsWith('simulation-world-director-event:')) directorTriggerFromWake(state, event.id)
  }
}

/** Apply a replacement as one Native record; consumed wakes and original schedule definitions remain immutable.
 * @param state - Paused run with no accepted decision window.
 * @param raw - Exact original command retained for retry comparison.
 * @param sequence - Native append cursor.
 * @param author - Trusted Host provenance; product principals are supplied by the authenticated administration owner.
 * @returns replacement schedule with cancelled pending predecessors and one future successor.
 */
export function foldCalendarRevision(state: SimulationSnapshot,
  raw: ReturnType<typeof simulationCalendarRevisionRequestSchema.parse>, sequence: number,
  author: { kind: 'host'; principalId: string | null } = { kind: 'host', principalId: null }): SimulationSnapshot {
  const request = simulationCalendarRevisionRequestSchema.parse(raw), book = state.worldBootstrap
  if (book?.status !== 'applied' || state.phase !== 'paused' || state.activeWindowId !== undefined)
    throw new Error('Calendar revision requires paused initialized admission without an accepted window')
  if (author.principalId !== null) {
    const retained = book.calendarCommands?.find(value => value.request.commandId === request.commandId)
    if (retained === undefined || retained.principalId !== author.principalId || retained.cancelledAt !== undefined
      || retained.sequence > state.revision || !isDeepStrictEqual(retained.request, request))
      throw new Error('Calendar effect differs from its retained author command or exact execution prefix')
  }
  const history = book.calendarRevisions ?? []
  const retry = history.find(value => value.request.commandId === request.commandId)
  if (retry !== undefined) {
    if (!isDeepStrictEqual(retry.request, request)) throw new Error('Calendar command identity has different original content')
    throw new Error('Calendar revision is already retained and cannot append again')
  }
  const original = book.request.data.behavior.calendars.find(value => value.id === request.calendar.id)
  const latest = history.filter(value => value.request.calendar.id === request.calendar.id).at(-1)
  if (original === undefined || request.expectedRuleRevision !== (latest?.revision ?? 1))
    throw new Error('Calendar revision conflicts with its original current rule')
  if (book.request.data.behavior.directorEvents.some(value => value.calendarId === request.calendar.id))
    throw new Error('Director authority calendars require a new scenario rather than schedule replacement')
  const current = latest?.request.calendar ?? original
  if (!isDeepStrictEqual(current.target, request.calendar.target)) throw new Error('Calendar replacement cannot redirect its target')
  if (BigInt(request.calendar.startsAt) <= BigInt(state.time)) throw new Error('Calendar replacement only admits strictly future occurrences')
  const last = request.calendar.recurrence === undefined && request.calendar.civil === undefined
    ? String(BigInt(request.calendar.startsAt) + BigInt(request.calendar.period) * BigInt(request.calendar.maxOccurrences - 1))
    : compileCalendarTimes(request.calendar).at(-1)
  if (last === undefined) throw new Error('Compiled calendar has no occurrence')
  parseSimTime(last, state.spec.maxTime)
  const revision = request.expectedRuleRevision + 1
  let next: SimulationSnapshot = { ...state, worldBootstrap: { ...book,
    calendarRevisions: [...history, { request, revision, sequence, author }] } }
  for (const event of Object.values(state.scheduledEvents)) {
    if (event.status === 'pending' && event.action.kind === 'world-calendar'
      && event.action.source.kind === 'calendar' && event.action.source.id === request.calendar.id)
      next = foldSchedulerRecord(next, { kind: 'event/cancelled', id: event.id, reason: 'Future calendar rule superseded' }, sequence)
  }
  next = foldSchedulerRecord(next, queue(next, { kind: 'world-calendar',
    source: { kind: 'calendar', id: request.calendar.id, revision }, occurrence: 0 }), sequence)
  if (author.principalId !== null) {
    const retained = book.calendarCommands?.find(value => value.request.commandId === request.commandId)
    const observed = { cancelled: Object.values(next.scheduledEvents).filter(event => event.status === 'cancelled'
        && state.scheduledEvents[event.id]?.status === 'pending').map(event => event.id),
    queued: Object.values(next.scheduledEvents).filter(event => state.scheduledEvents[event.id] === undefined)
      .map(event => ({ id: event.id, time: event.key.time })) }
    if (retained === undefined || !isDeepStrictEqual(retained.preview, observed))
      throw new Error('Calendar execution changed the original quoted event set')
  }
  if (Buffer.byteLength(JSON.stringify(next.worldBootstrap), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new Error('Calendar revision history exceeds its frozen byte bound')
  return next
}

/** Read the original rule priority for a scheduler key without modifying its occurrence identity.
 * @param state - Original Native bootstrap and revision history.
 * @param action - Exact original calendar occurrence.
 * @returns declared priority, or undefined for the ordinary neutral ordering.
 */
export function worldCalendarPriority(state: SimulationSnapshot, action: CalendarAction): number | undefined {
  return definition(state, action.source).priority
}
