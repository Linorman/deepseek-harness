/** Read-only institution impacts derive from the Native calendar/rule and obligation owners, including lazy successors. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { compileCalendarTimes, simulationWorldCalendarSourceSchema } from './world-calendar.ts'
import { simulationNormEnforcementSchema, simulationNormObligationReferenceSchema } from './world-norms.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationEntityId } from './identities.ts'
import type { WorldRequestId } from './world-types.ts'
import type { SimulationNormObligationReference } from './world-norms-types.ts'
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const text = z.string().min(1)
/** Only semantic policy fields are needed to preview; a quote does not invent an approval or publication. */
export const simulationNormImpactInputSchema = z.strictObject({ normId: text, scope: simulationEntityIdSchema,
  effectiveFrom: simTimeSchema, effectiveUntil: simTimeSchema.nullable(), enforcement: simulationNormEnforcementSchema,
  impact: z.enum(['future-admissions', 'migrate-existing']) })
/** Actual complete future rule coverage and existing duties, without pretending only the next queued event exists. */
export const simulationNormImpactSchema = z.strictObject({ revision: count, time: simTimeSchema, scope: simulationEntityIdSchema,
  newOperations: z.array(text), futureCalendar: z.array(z.strictObject({ calendarId: text, ruleRevision: count.positive(),
    source: simulationWorldCalendarSourceSchema, firstAt: simTimeSchema, lastAt: simTimeSchema, occurrences: count.positive(),
    pendingEventIds: z.array(text) })), existingObligations: z.array(simulationNormObligationReferenceSchema),
  existingObligationsPolicy: z.literal('preserve-original'),
  policyCombination: z.strictObject({ rule: z.literal('all-applicable-hiring-approvals'), policies: z.array(z.strictObject({
    id: text, version: text, enforcement: simulationNormEnforcementSchema })) }),
  blocked: z.enum(['existing-obligations-require-explicit-migration', 'unresolved-policy-conflict']).nullable(),
})
/** Exact inert preview selector. */
export type SimulationNormImpactInput = z.infer<typeof simulationNormImpactInputSchema>
/** Complete source-derived impact report. */
export type SimulationNormImpact = z.infer<typeof simulationNormImpactSchema>
/** List actual outstanding duties; unknown institution scope remains conservatively included.
 * @param state - Current Native owner projection.
 * @param scope - Exact policy scope.
 * @param exclude - Original enactment case excluded from its own impact list.
 * @returns exact duty references, without rewriting prior commitments.
 */
export function existingNormObligations(state: SimulationSnapshot, scope: SimulationEntityId,
  exclude?: WorldRequestId): readonly SimulationNormObligationReference[] {
  const owned = state.world
  if (owned === undefined) throw new Error('Norm impact requires its original World')
  const refs: SimulationNormObligationReference[] = []
  for (const request of Object.values(owned.requests)) {
    if (request.id !== exclude && (request.status === 'open' || request.status === 'cancel-requested' || request.status === 'awaiting-evidence')
      && owned.intents[request.intentId]?.scopeEntityId === scope) {
      refs.push(simulationNormObligationReferenceSchema.parse({ kind: 'world-case', id: request.id, sequence: request.sequence }))
    }
  }
  // Base commitments/tasks lack a frozen institution scope; claiming they are unaffected would invent missing ownership evidence.
  for (const commitment of Object.values(state.commitments)) if (commitment.phase === 'open') {
    refs.push(simulationNormObligationReferenceSchema.parse({ kind: 'commitment', id: commitment.id, revision: commitment.revision }))
  }
  const seen = new Set<string>()
  for (const task of [...Object.values(state.interactions).flatMap(value => value.task === undefined ? [] : [value.task]),
    ...Object.values(state.taskExecutions ?? {}).flatMap(value => value.task === undefined ? [] : [value.task])]) {
    if (['completed', 'failed', 'cancelled', 'deleted'].includes(task.phase)) continue
    const key = JSON.stringify([task.teamId, task.taskId])
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(simulationNormObligationReferenceSchema.parse({ kind: 'task', id: task.taskId,
      teamId: task.teamId, revision: task.revision }))
  }
  for (const execution of Object.values(state.taskExecutions ?? {})) {
    if (execution.task !== undefined || execution.result !== undefined) continue
    const key = JSON.stringify([execution.request.teamId, execution.request.taskId])
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(simulationNormObligationReferenceSchema.parse({ kind: 'task', id: execution.request.taskId,
      teamId: execution.request.teamId, revision: execution.request.taskRevision }))
  }
  for (const hold of Object.values(state.resourceReservations)) if (hold.phase === 'active')
    refs.push(simulationNormObligationReferenceSchema.parse({ kind: 'resource-hold', id: hold.id, revision: hold.revision }))
  for (const operation of Object.values(state.operations)) if (operation.result === undefined)
    refs.push(simulationNormObligationReferenceSchema.parse({ kind: 'operation', id: operation.id,
      decisionId: operation.decisionId, fingerprint: operation.fingerprint }))
  for (const wake of Object.values(state.wakes)) if (wake.status === 'pending' || wake.status === 'claimed')
    refs.push(simulationNormObligationReferenceSchema.parse({ kind: 'wake', id: wake.eventId,
      sequence: state.scheduledEvents[wake.eventId]?.settledAt }))
  return refs
}

/** Preview future admissions and every future calendar rule interval, including unqueued lazy successors.
 * @param state - Complete current Native projection.
 * @param raw - Exact semantic proposed policy and effective interval.
 * @param exclude - Original enacting case, when previewing its accepted command.
 * @returns complete bounded report with immutable duty references and installed policy semantics.
 */
export function projectNormImpact(state: SimulationSnapshot, raw: SimulationNormImpactInput,
  exclude?: WorldRequestId): SimulationNormImpact {
  const input = simulationNormImpactInputSchema.parse(raw)
  if (state.world === undefined || state.entities[input.scope]?.phase !== 'active')
    throw new Error('Institution impact requires an active owned scope')
  if (input.enforcement.kind === 'validated') {
    const params = input.enforcement.params
    if (input.scope !== state.world.definition.organizationEntityId || state.entities[params.committeeId]?.kind !== 'organization'
      || params.positionIds.some(id => !state.world?.definition.positions.some(position => position.entityId === id)))
      throw new Error('Institution impact references an unsupported policy scope, committee or position')
  }
  if (BigInt(input.effectiveFrom) < BigInt(state.time)) throw new Error('Institution preview cannot backdate a new policy')
  const lower = BigInt(input.effectiveFrom) > BigInt(state.time) ? BigInt(input.effectiveFrom) : BigInt(state.time)
  const ceiling = input.effectiveUntil === null ? BigInt(state.spec.maxTime) : BigInt(input.effectiveUntil) - 1n
  if (ceiling < lower || BigInt(input.effectiveFrom) > BigInt(state.spec.maxTime)) throw new Error('Norm impact interval is outside the run horizon')
  const book = state.worldBootstrap
  const futureCalendar: SimulationNormImpact['futureCalendar'] = []
  for (const initial of book?.request.data.behavior.calendars ?? []) {
    const revision = book?.calendarRevisions?.filter(value => value.request.calendar.id === initial.id).at(-1)
    const calendar = revision?.request.calendar ?? initial, ruleRevision = revision?.revision ?? 1
    const source = simulationWorldCalendarSourceSchema.parse({ kind: 'calendar', id: calendar.id,
      ...ruleRevision === 1 ? {} : { revision: ruleRevision } })
    const consumed = book?.occurrences.filter(value => value.source.kind === 'calendar' && value.source.id === calendar.id
      && (value.source.revision ?? 1) === ruleRevision).reduce((highest, value) => Math.max(highest, value.occurrence), -1) ?? -1
    let firstAt: string | undefined, lastAt: string | undefined, occurrences = 0
    if (calendar.recurrence !== undefined || calendar.civil !== undefined) {
      const times = compileCalendarTimes(calendar).filter((time, index) => index > consumed
        && BigInt(time) >= lower && BigInt(time) <= ceiling)
      firstAt = times[0]; lastAt = times.at(-1); occurrences = times.length
    } else {
      const start = BigInt(calendar.startsAt), period = BigInt(calendar.period)
      const end = calendar.endsAt === null || BigInt(calendar.endsAt) > ceiling ? ceiling : BigInt(calendar.endsAt)
      const lowerIndex = lower <= start ? 0n : (lower - start + period - 1n) / period
      const first = lowerIndex > BigInt(consumed + 1) ? lowerIndex : BigInt(consumed + 1)
      const upperIndex = end < start ? -1n : (end - start) / period
      const last = upperIndex < BigInt(calendar.maxOccurrences - 1) ? upperIndex : BigInt(calendar.maxOccurrences - 1)
      if (first <= last) {
        firstAt = String(start + first * period); lastAt = String(start + last * period); occurrences = Number(last - first + 1n)
      }
    }
    if (firstAt === undefined || lastAt === undefined) continue
    futureCalendar.push({ calendarId: calendar.id, ruleRevision, source, firstAt: simTimeSchema.parse(firstAt),
      lastAt: simTimeSchema.parse(lastAt), occurrences, pendingEventIds: Object.values(state.scheduledEvents)
        .filter(event => event.status === 'pending' && event.action.kind === 'world-calendar'
          && event.action.source.kind === 'calendar' && event.action.source.id === calendar.id
          && (event.action.source.revision ?? 1) === ruleRevision).map(event => event.id) })
  }
  const obligations = existingNormObligations(state, input.scope, exclude)
  const owned = state.world
  const policies = Object.values(owned.norms.versions).flat().filter((value) => {
    if (value.id === input.normId || value.scope !== input.scope || value.status !== 'enacted'
      || value.enforcement.kind !== 'validated') return false
    const ends = [value.effectiveUntil, ...owned.norms.closures.filter(closure => closure.norm.id === value.id
      && closure.norm.version === value.version).map(closure => closure.at)]
      .filter((time): time is NonNullable<typeof time> => time !== null)
    const end = ends.reduce((minimum, time) => BigInt(time) < minimum ? BigInt(time) : minimum, BigInt(state.spec.maxTime) + 1n)
    return BigInt(value.effectiveFrom) <= ceiling && end > lower
  })
  return simulationNormImpactSchema.parse({ revision: state.revision, time: state.time, scope: input.scope,
    newOperations: input.enforcement.kind === 'validated' ? [...new Set(state.world.definition.operations
      .filter(pin => pin.domain === 'organization' && ['generate-and-hire', 'hire-existing'].includes(pin.operation))
      .map(pin => `${pin.domain}.${pin.operation}`))] : [],
    futureCalendar, existingObligations: obligations, existingObligationsPolicy: 'preserve-original',
    policyCombination: { rule: 'all-applicable-hiring-approvals', policies: policies.map(value => ({
      id: value.id, version: value.version, enforcement: value.enforcement })) },
    blocked: input.impact === 'migrate-existing' && obligations.length > 0 ? 'existing-obligations-require-explicit-migration' : null })
}
