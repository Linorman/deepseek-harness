import { worldDecisionSource } from '@clocky/clocky-simulation'
/** Native scenario provenance and finite request budgets; model text never creates this authority. */
import { isDeepStrictEqual } from 'node:util'
import { simulationEventIdSchema, simulationWorldDirectorTriggerSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldCalendarOccurrence, SimulationWorldDirectorTrigger,
  SimulationEventId, WorldDirectorEventId, SimulationWorldInitialData } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import type { SchedulerRecord } from './scheduler.ts'
import { allocateEventKey, foldSchedulerRecord } from './scheduler.ts'

/** Read one immutable initial declaration.
 * @param state - Complete source-retaining Native projection.
 * @param id - Original scenario declaration identity.
 * @returns the exact frozen declaration; missing source data rejects.
 */
export function directorDeclaration(state: SimulationSnapshot, id: WorldDirectorEventId):
SimulationWorldInitialData['behavior']['directorEvents'][number] {
  const declaration = state.worldBootstrap?.request.data.behavior.directorEvents.find(value => value.id === id)
  if (declaration === undefined) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Director event has no original scenario declaration')
  return declaration
}

/** Count accepted business identities without refunding rejected or cancelled requests.
 * @param state - Current Native request history.
 * @param id - Original independent declaration budget.
 * @returns accepted intents charged to this declaration.
 */
export function directorRequestCount(state: SimulationSnapshot, id: WorldDirectorEventId): number {
  return Object.values(state.world?.intents ?? {}).filter(value => value.scenarioTrigger?.declarationId === id).length
}

/** Derive the sole director wake for one actual occurrence.
 * @param declarationId - Original declaration.
 * @param calendarId - Actual immutable calendar identity.
 * @param occurrence - Actual finite index.
 * @returns the original Native wake identity.
 */
export function directorEventWakeId(declarationId: WorldDirectorEventId,
  calendarId: SimulationWorldDirectorTrigger['calendarId'], occurrence: number): SimulationEventId {
  return simulationEventIdSchema.parse(`simulation-world-director-event:${businessFingerprint([declarationId, calendarId, occurrence]).slice(7)}`)
}

/** Render exact scheduler-owned input; an arbitrary message cannot impersonate its event identity.
 * @param state - Original source-retaining state.
 * @param trigger - Actual persisted occurrence.
 * @returns the exact source-labelled goal reason.
 */
export function directorEventReason(state: SimulationSnapshot, trigger: SimulationWorldDirectorTrigger): string {
  const calendar = state.worldBootstrap?.request.data.behavior.calendars.find(value => value.id === trigger.calendarId)
  if (calendar === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Director event lost its finite calendar')
  return JSON.stringify({ kind: 'world-director-event', version: 1, declarationId: trigger.declarationId,
    calendarId: trigger.calendarId, occurrence: trigger.occurrence, goal: calendar.body })
}

/** Resolve authority only from the recorded calendar and its exact derived director wake.
 * @param state - Complete actual scheduler projection.
 * @param wakeId - Original decision wake, never a caller-supplied declaration.
 * @returns the Native-derived trigger; unrelated, absent or changed wake data rejects.
 */
export function directorTriggerFromWake(state: SimulationSnapshot, wakeId: SimulationEventId): SimulationWorldDirectorTrigger {
  const book = state.worldBootstrap, event = state.scheduledEvents[wakeId]
  const occurrence = book?.occurrences.find(value => value.directorEvents.some(entry => entry.status === 'eligible' && entry.wakeId === wakeId))
  const entry = occurrence?.directorEvents.find(value => value.status === 'eligible' && value.wakeId === wakeId)
  if (book?.status !== 'applied' || occurrence?.source.kind !== 'calendar' || entry === undefined
    || event?.action.kind !== 'wake' || event.action.entityId !== state.world?.definition.directorEntityId)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Director event requires its actual calendar-selected director wake')
  const trigger = simulationWorldDirectorTriggerSchema.parse({ declarationId: entry.declarationId,
    calendarId: occurrence.source.id, occurrence: occurrence.occurrence, eventId: occurrence.eventId,
    sequence: occurrence.sequence, time: occurrence.time, bootstrapSequence: book.sequence })
  const source = state.scheduledEvents[occurrence.eventId]
  if (source?.status !== 'consumed' || source.settledAt !== occurrence.sequence
    || wakeId !== directorEventWakeId(entry.declarationId, occurrence.source.id, occurrence.occurrence)
    || event.sourceOperationId !== undefined || event.key.time !== occurrence.time || event.key.phase !== 'decision'
    || event.action.reason !== directorEventReason(state, trigger))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Director event lost its original consumed calendar or exact wake')
  directorDeclaration(state, trigger.declarationId)
  return trigger
}

/** Verify retained intent authority without looking up a newer assignment or scene.
 * @param state - Complete original projection.
 * @param trigger - Native-derived source retained in an accepted intent/context.
 * @returns the exact declaration, independent of later employment or quota charges.
 */
export function assertDirectorTrigger(state: SimulationSnapshot, trigger: SimulationWorldDirectorTrigger):
SimulationWorldInitialData['behavior']['directorEvents'][number] {
  const original = directorTriggerFromWake(state, directorEventWakeId(trigger.declarationId, trigger.calendarId, trigger.occurrence))
  if (!isDeepStrictEqual(original, trigger)) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Director request changed its original trigger')
  const declaration = directorDeclaration(state, trigger.declarationId)
  if (declaration.calendarId !== trigger.calendarId) throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Director request changed its declared calendar')
  return declaration
}

/** Freeze independent declaration eligibility at the actual calendar occurrence.
 * @param state - Actual consumed scheduler prefix.
 * @param occurrence - Original source/index before its director responsibilities are published.
 * @returns finite eligible or budget-exhausted entries; no model or callback chooses their actor.
 */
export function directorOccurrenceEntries(state: SimulationSnapshot,
  occurrence: Pick<SimulationWorldCalendarOccurrence, 'source' | 'occurrence'>): SimulationWorldCalendarOccurrence['directorEvents'] {
  if (occurrence.source.kind !== 'calendar') return []
  const id = occurrence.source.id
  return (state.worldBootstrap?.request.data.behavior.directorEvents ?? []).filter(value => value.calendarId === id).map(value =>
    directorRequestCount(state, value.id) >= value.maxRequests
      ? { declarationId: value.id, status: 'budget-exhausted' as const }
      : { declarationId: value.id, status: 'eligible' as const, wakeId: directorEventWakeId(value.id, id, occurrence.occurrence) })
}

/** Derive one stable business key per scenario declaration/occurrence.
 * @param trigger - Original Native calendar source.
 * @returns the only accepted business key for this occurrence, preventing alternate-ID quota bypass.
 */
export function directorEventBusinessKey(trigger: SimulationWorldDirectorTrigger): string {
  return `scenario:${businessFingerprint([trigger.declarationId, trigger.calendarId, trigger.occurrence]).slice(7)}`
}

/** Verify the historical budget decision, not a later mutable count.
 * @param state - Complete original run history.
 * @param occurrence - Actual persisted finite occurrence.
 * @returns normally only for every original declaration's exact eligibility and wake duty.
 */
export function assertDirectorOccurrence(state: SimulationSnapshot, occurrence: SimulationWorldCalendarOccurrence): void {
  const declarations = occurrence.source.kind === 'calendar'
    ? (state.worldBootstrap?.request.data.behavior.directorEvents ?? []).filter(value => value.calendarId === occurrence.source.id) : []
  if (declarations.length !== occurrence.directorEvents.length
    || new Set(occurrence.directorEvents.map(value => value.declarationId)).size !== declarations.length)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Calendar lost an original director declaration responsibility')
  for (const declaration of declarations) {
    const entry = occurrence.directorEvents.find(value => value.declarationId === declaration.id)
    const spent = Object.values(state.world?.intents ?? {}).filter(value => value.scenarioTrigger?.declarationId === declaration.id
      && value.sequence < occurrence.sequence).length
    if (entry === undefined || (entry.status === 'eligible') !== (spent < declaration.maxRequests))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Director occurrence changed its original finite request budget')
    if (entry.status === 'eligible') directorTriggerFromWake(state, entry.wakeId)
  }
}

/** Preserve the original local planning duty in the same request acceptance batch.
 * @param state - Accepted scenario business identities.
 * @returns one Native planning wake per original case, without a fabricated Envelope or publisher.
 */
export function scenarioRequestRecords(state: SimulationSnapshot): SchedulerRecord[] {
  const records: SchedulerRecord[] = []
  let projected = state
  for (const request of Object.values(state.world?.requests ?? {})) {
    // User commands already retain their direct immutable plan and have no simulated director planning wake.
    if (request.source.kind !== 'decision' || request.notificationOperationId !== null) continue
    const id = simulationEventIdSchema.parse(`simulation-world-scenario-resolve:${request.id}`)
    if (projected.scheduledEvents[id] !== undefined) continue
    const actor = state.world?.definition.directorEntityId
    const decision = state.decisions[worldDecisionSource(request).decisionId]
    if (actor === undefined || worldDecisionSource(request).trigger === undefined || decision === undefined)
      throw new Error('Scenario planning lost its original director request and trigger')
    const action = { kind: 'wake' as const, entityId: actor, reason: JSON.stringify({ scenarioRequestId: request.id }) }
    const event: SchedulerRecord = { kind: 'event/queued', id, action, key: allocateEventKey(projected, decision.time, action) }
    records.push(event)
    projected = foldSchedulerRecord(projected, event, state.revision + records.length)
  }
  return records
}
