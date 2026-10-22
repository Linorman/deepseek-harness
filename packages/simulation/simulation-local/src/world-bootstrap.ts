/** Original local scenario initialization is retained once and applied in one Native publication without IO. */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { validateHiringFeeAccounts } from './world-hiring-resources.ts'
import { simulationWorldBootstrapRequestSchema, simulationWorldBootstrapBookSchema, simulationChangeSchema,
  simulationWorldFactRequestSchema, WORLD_FACT_TEXT_SCHEMA_REF, simulationKnowledgeRequestSchema,
  simulationExternalIdentitySchema, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN,
  parseSimTime, compileCalendarTimes } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldBootstrapRequest } from '@clocky/clocky-simulation'
import { foldEntityChange } from './entities.ts'
import { foldWorld, requireWorld } from './world.ts'
import { NativeWorldRuntime } from './world-runtime.ts'
import { foldBusinessRecord } from './decisions.ts'
import { foldWorldFact, worldFactOwner } from './world-facts.ts'
import { prepareInitialNorm, foldInitialNorm, assertFrozenCommitteeInitialization } from './world-norm-bootstrap.ts'
import { normAnnouncementRecords, normBoundaryRecords } from './world-norm-announcement.ts'
import { initialWorldCalendarRecords } from './world-calendar.ts'
import { foldSchedulerRecord } from './scheduler.ts'
import { externalIdentityId } from './world-external.ts'

/** Closed retained/apply records; no model operation can select this capability. */
export const worldBootstrapRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('world-bootstrap/retained'), request: simulationWorldBootstrapRequestSchema }),
  z.strictObject({ kind: z.literal('world-bootstrap/applied'), bootstrapSequence: z.number().int().positive(),
    recordedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
])
/** Exact original Native preparation fact. */
export type WorldBootstrapRecord = z.infer<typeof worldBootstrapRecordSchema>
function assertInitial(state: SimulationSnapshot, request: SimulationWorldBootstrapRequest): void {
  const empty = [state.decisions, state.operations, state.resources, state.interactions, state.commitments, state.knowledge,
    state.wakes, state.scheduledEvents, state.windows, state.maintenance, state.tokenReservations]
  if (state.phase !== 'paused' || state.time !== '0' || state.world !== undefined || state.activeWindowId !== undefined
    || state.teamReservation?.confirmed !== true || empty.some(value => Object.keys(value ?? {}).length !== 0))
    throw new Error('Scenario initialization requires its unstarted paused canonical preparation')
  const actors = Object.values(state.entities).filter(value => value.cognition === 'agent').map(value => value.id).sort()
  if (!isDeepStrictEqual(actors, [...request.actorIds].sort()) || request.actorIds.some((id) => {
    const actor = state.entities[id]
    return actor?.phase !== 'active' || actor.cognition !== 'agent' || actor.readiness !== 'preparing'
      || actor.binding?.teamId !== state.teamReservation?.teamId || actor.writer !== undefined
  }) || Object.values(state.channelReservations ?? {}).some(value => !value.confirmed))
    throw new Error('Scenario initialization requires all original confirmed identities and no prior writer')
  const ids = new Set(request.actorIds)
  if (!ids.has(request.definition.directorEntityId)) throw new Error('Original bootstrap omitted its canonical director')
  const data = request.data
  for (const rows of [data.resources, data.facts, data.knowledge, data.norms, data.committeePolicies,
    data.behavior.initialGoals, data.behavior.calendars, data.behavior.directorEvents]) {
    if (new Set(rows.map(value => value.id)).size !== rows.length) throw new Error('Initial owner identities must be distinct')
  }
  const allEvents = [...data.behavior.initialGoals, ...data.behavior.calendars]
  if (new Set(allEvents.map(value => value.id)).size !== allEvents.length) throw new Error('Initial goals and calendars cannot share identities')
  for (const value of allEvents) {
    const target = value.target.kind === 'person' ? state.entities[value.target.personId] : state.entities[value.target.positionId]
    if (target === undefined || (value.target.kind === 'person' ? !ids.has(target.id) : target.kind !== 'position'))
      throw new Error('Initial world event requires its declared cognitive actor or position')
    parseSimTime('at' in value ? value.at : value.startsAt, state.spec.maxTime)
    if ('maxOccurrences' in value) {
      const compiled = value.recurrence === undefined && value.civil === undefined ? undefined : compileCalendarTimes(value)
      const last = compiled === undefined
        ? String(BigInt(value.startsAt) + BigInt(value.period) * BigInt(value.maxOccurrences - 1)) : compiled.at(-1)
      if (last === undefined) throw new Error('Calendar expansion must retain a finite occurrence')
      parseSimTime(last, state.spec.maxTime)
      if (value.endsAt !== null) parseSimTime(value.endsAt, state.spec.maxTime)
    }
  }
  for (const declaration of data.behavior.directorEvents) {
    const calendar = data.behavior.calendars.find(value => value.id === declaration.calendarId)
    const pin = request.definition.operations.find(value => value.domain === declaration.domain
      && value.operation === declaration.operation && value.version === declaration.version)
    if (calendar === undefined || declaration.maxRequests > calendar.maxOccurrences || pin === undefined
      || declaration.scopeId !== request.definition.organizationEntityId || state.entities[declaration.targetId] === undefined)
      throw new Error('Director event requires its original finite calendar, bounded budget, installed selector and exact scope/target')
  }
  if (Buffer.byteLength(JSON.stringify({ request, sequence: state.revision + 1, status: 'retained', occurrences: [] }), 'utf8')
    > state.spec.maxKnowledgeBytes) throw new Error('Complete retained initialization exceeds its frozen byte bound')
}
function seedExternal(state: SimulationSnapshot, sequence: number): SimulationSnapshot {
  const book = state.worldBootstrap, world = requireWorld(state)
  if (book === undefined) throw new Error('Initial external identity lost its original bootstrap')
  let identities = world.external.identities
  for (const input of book.request.data.externalIdentities) {
    const subject = state.entities[input.subjectId]
    if (input.scopeId !== world.definition.organizationEntityId || input.subjectId === input.scopeId
      || subject?.kind !== 'organization' || subject.cognition !== 'none' || subject.phase !== 'active')
      throw new Error('Initial external identity requires its original noncognitive outside subject and World scope')
    const pin = input.representation === 'simulated-rule' ? WORLD_EXTERNAL_INTERACT_PIN
      : input.representation === 'simulated-actor' ? WORLD_EXTERNAL_ACTOR_PIN : WORLD_EXTERNAL_MEDIATED_PIN
    if (!world.definition.operations.some(value => isDeepStrictEqual(value, pin)))
      throw new Error('Initial external identity requires its exact installed simulation operation')
    const id = externalIdentityId(state, { scope: input.scopeId, externalKey: input.externalKey })
    if (identities[id] !== undefined) throw new Error('Initial external scope/key identity is duplicated')
    const policyRef = input.representation === 'simulated-rule' ? 'clocky.external.availability/1'
      : input.representation === 'simulated-actor' ? 'clocky.external.representative/1' : 'clocky.external.adjudication/1'
    identities = { ...identities, [id]: simulationExternalIdentitySchema.parse({ id, scope: input.scopeId,
      externalKey: input.externalKey, subjectRef: input.subjectId, representation: input.representation, policyRef,
      revision: 1, source: { kind: 'scenario', definitionHash: book.request.definitionHash, bootstrapSequence: book.sequence }, sequence }) }
  }
  return { ...state, world: { ...world, external: { ...world.external, identities } } }
}
/**
 * Fold a retained original or its complete atomic local application.
 * @param state - Exact preceding Native prefix with original canonical identities.
 * @param input - Parsed journal-owned retained/apply fact.
 * @param sequence - Actual append cursor; all local effects share the single apply record.
 * @param runtime - Original installed pure domain capabilities.
 * @returns one prospective projection; no model, Team IO or intermediate ready state is published.
 */
export function foldWorldBootstrap(state: SimulationSnapshot, input: WorldBootstrapRecord, sequence: number,
  runtime: NativeWorldRuntime | undefined): SimulationSnapshot {
  const record = worldBootstrapRecordSchema.parse(input)
  if (record.kind === 'world-bootstrap/retained') {
    if (state.worldBootstrap !== undefined) throw new Error('Scenario bootstrap already retained its original request')
    assertInitial(state, record.request)
    runtime?.manifest(record.request.definition)
    if (runtime === undefined) throw new Error('Scenario initialization requires its installed domain owner')
    for (const declaration of record.request.data.behavior.directorEvents) {
      const pin = record.request.definition.operations.find(value => value.domain === declaration.domain
        && value.operation === declaration.operation && value.version === declaration.version)
      if (pin === undefined || runtime.original(pin).definition.directorEvents !== true)
        throw new Error('Director declaration requires its exact installed environment capability')
    }
    return { ...state, worldBootstrap: { request: record.request, sequence, status: 'retained', occurrences: [] } }
  }
  const book = state.worldBootstrap
  if (book?.status !== 'retained' || book.sequence !== record.bootstrapSequence || sequence !== state.revision + 1)
    throw new Error('Scenario apply lost its sole original retained bootstrap')
  assertInitial(state, book.request)
  let next = state
  for (const id of book.request.actorIds) {
    const actor = next.entities[id]
    if (actor === undefined) throw new Error('Original bootstrap actor is absent')
    if (actor.readiness === 'preparing') next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'entity/readiness',
      id, entityRevision: actor.revision, readiness: 'ready' }))
  }
  next = foldWorld(next, { kind: 'world/defined', definition: book.request.definition }, sequence, runtime)
  for (const resource of book.request.data.resources) next = foldBusinessRecord(next,
    { kind: 'resource/created', resource }, sequence, runtime)
  validateHiringFeeAccounts(next, book.request.definition.hiringFees ?? [])
  for (const fact of book.request.data.facts) {
    const request = simulationWorldFactRequestSchema.parse({ factId: fact.id, version: '1', schemaRef: WORLD_FACT_TEXT_SCHEMA_REF,
      subject: fact.subjectId, scope: fact.scopeId, payload: { body: fact.body }, effectiveFrom: fact.effectiveFrom,
      effectiveUntil: fact.effectiveUntil, availableAt: fact.availableAt, audience: fact.audience, supersedes: null,
      sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: book.sequence }] })
    const { sources, ...fields } = request
    next = foldWorldFact(next, { kind: 'world/fact-recorded', fact: { ...fields,
      source: { kind: 'owner', owner: worldFactOwner(next), references: sources }, sequence, recordedAt: record.recordedAt } }, sequence)
  }
  for (const knowledge of book.request.data.knowledge) {
    const owner = next.entities[knowledge.ownerId]
    if (owner?.cognition !== 'agent') throw new Error('Initial knowledge requires its original cognitive owner')
    const request = simulationKnowledgeRequestSchema.parse({ id: knowledge.id, owner: knowledge.ownerId,
      statement: knowledge.body, expectedRevision: 0, source: { kind: 'belief', profileRevision: owner.profileRevision,
        policyVersion: state.spec.policyVersion }, observedAt: knowledge.observedAt, availableAt: knowledge.availableAt,
      validFrom: knowledge.validFrom, validUntil: knowledge.validUntil, readers: knowledge.readers })
    next = foldBusinessRecord(next, { kind: 'knowledge/recorded', request }, sequence, runtime)
  }
  for (const committee of book.request.data.committeePolicies) assertFrozenCommitteeInitialization(next, committee)
  for (const norm of book.request.data.norms) {
    const version = prepareInitialNorm(next, norm, { definitionHash: book.request.definitionHash,
      bootstrapSequence: book.sequence }, sequence, record.recordedAt)
    next = { ...next, world: { ...requireWorld(next), norms: foldInitialNorm(next, version) } }
  }
  next = seedExternal(next, sequence)
  for (const factory of [normAnnouncementRecords, normBoundaryRecords, initialWorldCalendarRecords]) {
    for (const event of factory(next)) next = foldSchedulerRecord(next, event, sequence, runtime)
  }
  const applied = simulationWorldBootstrapBookSchema.parse({ ...book, status: 'applied', appliedSequence: sequence })
  next = { ...next, worldBootstrap: applied }
  if (Buffer.byteLength(JSON.stringify({ world: next.world, knowledge: next.knowledge, bootstrap: applied }), 'utf8')
    > state.spec.maxKnowledgeBytes) throw new Error('Complete initialized world and source data exceed their frozen byte bound')
  return next
}

/**
 * Require the exact original complete publication or its still-inert retained responsibility.
 * @param state - Complete durable tail, never an intermediate bootstrap fold.
 * @returns normally only when original data authority, clock and initial ready state are consistent.
 */
export function assertWorldBootstrapProjection(state: SimulationSnapshot): void {
  const original = state.worldBootstrap
  if (original === undefined) return
  const book = simulationWorldBootstrapBookSchema.parse(original)
  if (book.status === 'retained') {
    assertInitial(state, book.request)
    return
  }
  if (book.appliedSequence === undefined || book.appliedSequence <= book.sequence || book.appliedSequence > state.revision
    || state.world?.sequence !== book.appliedSequence || !isDeepStrictEqual(state.world.definition, book.request.definition))
    throw new Error('World initialization lost its original atomic publication and definition')
  for (const id of book.request.actorIds) {
    const actor = state.entities[id]
    if (actor?.binding === undefined || actor.cognition !== 'agent' || actor.readiness === 'preparing')
      throw new Error('Applied world initialization lost an original canonical cognitive identity')
  }
  if (Buffer.byteLength(JSON.stringify(book), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new Error('Complete retained world initialization history exceeds its frozen byte bound')
}
