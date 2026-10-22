import { hiringMarketAcceptance, pendingHiringOffers, reservedHiringOffers, WORLD_HIRING_MARKET_PIN } from '@clocky/clocky-simulation'
import { assertWorldMutationSlot } from './world-structure-budget.ts'
import { worldOperationGrants, currentWorldOperationGrants } from '@clocky/clocky-simulation'
/** Pure existing-person hiring: controlled eligibility, exact reads and one assignment; no identity or channel IO. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { WORLD_HIRE_EXISTING_DEFINITION, WORLD_HIRE_EXISTING_PIN, WORLD_GENERATE_AND_HIRE_PIN,
  simulationWorldHireExistingPayloadSchema, simulationWorldHireExistingCommittedResultPayloadSchema,
  simulationWorldHirePayloadSchema, simulationWorldReadSetSchema, simulationChangeSchema,
  simulationRelationIdSchema, worldMutationIdSchema, SimulationWorldError, effectiveNorms } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationEntityId,
  SimulationRelation, SimulationWorldDomainRequest, SimulationWorldBusinessResolution, SimulationWorldPlan,
  SimulationWorldJsonValue, SimulationWorldResult, SimulationWorldHireExistingPayload } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import { requireHireApproval, assertHiringRequestPolicy } from './world-hire-approval.ts'
import { hiringFee, hiringResourceReads, existingHiringResourceHolds } from './world-hiring-resources.ts'

function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
function world(state: SimulationSnapshot) {
  if (state.world === undefined)
    throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Existing-person hiring requires a configured World')
  return state.world
}
function live(state: SimulationSnapshot, relation: SimulationRelation): boolean {
  return BigInt(relation.validFrom) <= BigInt(state.time)
    && (relation.validUntil === null || BigInt(state.time) < BigInt(relation.validUntil))
}
function pendingAssignments(state: SimulationSnapshot, personId: SimulationEntityId) {
  return Object.values(state.relations).filter(value => value.relation === 'assignment' && value.subject === personId
    && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time)))
    .sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
}
function authorization(state: SimulationSnapshot, actorId: SimulationEntityId, payload: SimulationWorldHireExistingPayload) {
  const actor = lookup(state.entities, actorId)
  if (actor?.phase !== 'active' || actor.cognition !== 'agent' || actor.readiness !== 'ready'
    || actor.binding === undefined || actor.binding.teamId !== state.teamReservation?.teamId) {
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Existing hiring permission requires its actual active canonical requester')
  }
  const grants = worldOperationGrants(state).filter(value => value.requesterEntityId === actorId
    && value.domain === WORLD_HIRE_EXISTING_PIN.domain && value.operation === WORLD_HIRE_EXISTING_PIN.operation
    && value.version === WORLD_HIRE_EXISTING_PIN.version && value.targetEntityId === payload.positionEntityId
    && value.scopeEntityId === payload.organizationEntityId && value.relation === 'can-hire')
    .flatMap((grant) => {
      const relation = lookup(state.relations, grant.relationId)
      return relation?.subject === actorId && relation.object === payload.positionEntityId
        && relation.scope === payload.organizationEntityId && relation.relation === 'can-hire' && live(state, relation) ? [relation] : []
    })
  if (!grants.length)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Existing-person hiring requires its exact live scoped can-hire grant')
  return grants.sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
}
function directorChannel(state: SimulationSnapshot, personId: SimulationEntityId) {
  const owned = world(state), person = lookup(state.entities, personId)
  const director = lookup(state.entities, owned.definition.directorEntityId), team = state.teamReservation
  if (team?.confirmed !== true || person?.binding?.teamId !== team.teamId || director?.binding?.teamId !== team.teamId) return undefined
  const channels = Object.values(state.channelReservations ?? {}).filter(value => value.confirmed && value.spec.members.length === 2
    && value.spec.members.some(member => member.entityId === personId)
    && value.spec.members.some(member => member.entityId === owned.definition.directorEntityId))
  const channel = channels[0], indexed = lookup(owned.channels, personId)
  // Requester indexing grants no authority; an unassigned candidate can own a real private Channel without an operation grant.
  return channels.length === 1 && channel !== undefined && (indexed === undefined || indexed === channel.channelId)
    ? channel.channelId : undefined
}
function candidate(state: SimulationSnapshot, payload: SimulationWorldHireExistingPayload) {
  const owned = world(state), person = lookup(state.entities, payload.personId), team = state.teamReservation
  const director = lookup(state.entities, owned.definition.directorEntityId)
  if (person?.kind !== 'person' || person.phase !== 'active' || person.readiness !== 'ready' || person.cognition !== 'agent'
    || person.binding === undefined || team?.confirmed !== true || person.binding.teamId !== team.teamId
    || director?.binding === undefined || director.binding.teamId !== team.teamId || person.id === director.id) {
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
      'Existing hire requires an active ready cognitive person with its original canonical Team binding')
  }
  if (pendingAssignments(state, person.id).length) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Existing person has a current or future assignment; completed assignment history is preserved')
  }
  const channelId = directorChannel(state, person.id)
  if (channelId === undefined) {
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY',
      'Existing person needs its original confirmed private Channel to the canonical director')
  }
  const eligibility = Object.values(state.relations).filter(value => value.subject === person.id && value.relation === 'eligible-for-hire'
    && value.object === payload.organizationEntityId && value.scope === payload.organizationEntityId && live(state, value))
    .sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
  if (!eligibility.length)
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Existing person lacks current explicit scoped hiring eligibility')
  return { person, binding: person.binding, channelId, eligibility }
}
function occupancy(state: SimulationSnapshot, payload: SimulationWorldHireExistingPayload, exclude?: SimulationWorldIntent['id']) {
  const owned = world(state)
  const assignments = Object.values(state.relations).filter(value => value.relation === 'assignment'
    && value.object === payload.positionEntityId && value.scope === payload.organizationEntityId
    && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time)))
    .sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
  const reservations = Object.values(owned.reservations).filter((value) => {
    if (value.status === 'committed' || value.status === 'abandoned') return false
    const intent = lookup(owned.intents, value.id)
    if (intent === undefined || !isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN)) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Existing-person occupancy lost a retained generated-hire responsibility')
    }
    const request = simulationWorldHirePayloadSchema.parse(intent.payload)
    return request.organizationEntityId === payload.organizationEntityId && request.positionEntityId === payload.positionEntityId
  }).sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
  const personnelReservations = Object.values(owned.personnel.reservations).filter(value => value.status !== 'committed'
    && value.status !== 'cancelled' && value.targetPositionId === payload.positionEntityId
    && owned.intents[value.id]?.scopeEntityId === payload.organizationEntityId)
    .sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
  const hiringReservations = existingHiringResourceHolds(state, exclude).filter(value =>
    value.world?.fee.positionEntityId === payload.positionEntityId)
  const points = [state.time, ...assignments.map(value => value.validFrom).filter(value => BigInt(value) > BigInt(state.time))]
  const peak = points.reduce((maximum, time) => Math.max(maximum, assignments.filter(value => BigInt(value.validFrom) <= BigInt(time)
    && (value.validUntil === null || BigInt(time) < BigInt(value.validUntil))).length), 0)
  return { assignments, reservations, personnelReservations, hiringReservations, peak,
    occupied: assignments.filter(value => live(state, value)).length }
}
function current(state: SimulationSnapshot, actorId: SimulationEntityId | null, payload: SimulationWorldHireExistingPayload,
  exclude?: SimulationWorldIntent['id']) {
  const promises = pendingHiringOffers(state).filter((value) => {
    const plan = state.world?.plans[value.planId], request = plan === undefined ? undefined : state.world?.requests[plan.requestId]
    return request?.intentId !== exclude
  })
  if (promises.some(value => value.candidateId === payload.personId))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Candidate retains another accepted offer obligation')
  const owned = world(state), position = lookup(state.entities, payload.positionEntityId)
  const capacity = owned.definition.positions.find(value => value.entityId === payload.positionEntityId)?.capacity
  if (payload.organizationEntityId !== owned.definition.organizationEntityId || lookup(state.entities,
    payload.organizationEntityId)?.phase !== 'active'
    || position?.phase !== 'active' || position.cognition !== 'none' || capacity === undefined) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing hiring requires its owned active organization and declared position')
  }
  const grants = actorId === null ? [] : authorization(state, actorId, payload), selected = candidate(state, payload),
    usage = occupancy(state, payload, exclude)
  if (usage.peak + usage.reservations.length + usage.personnelReservations.length + usage.hiringReservations.length
    + reservedHiringOffers(state).filter((value) => {
      const plan = owned.plans[value.planId], request = plan === undefined ? undefined : owned.requests[plan.requestId]
      return request?.intentId !== exclude && value.positionEntityId === payload.positionEntityId
      && !Object.values(owned.reservations).some(reservation => reservation.request.planId === value.planId
        && reservation.status !== 'committed' && reservation.status !== 'abandoned')
      && !Object.values(state.resourceReservations).some(hold => hold.phase === 'active' && hold.world?.planId === value.planId)
    }).length >= capacity) {
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Existing hiring position is occupied or reserved', 'position')
  }
  if (existingHiringResourceHolds(state, exclude).some((hold) => {
    const intent = hold.world === undefined ? undefined : owned.intents[hold.world.intentId]
    return intent !== undefined && simulationWorldHireExistingPayloadSchema.parse(intent.payload).personId === payload.personId
  })) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing person has another original uncommitted hiring reservation')
  return { position, capacity, grants, selected, usage }
}
function original(intent: SimulationWorldIntent): SimulationWorldHireExistingPayload {
  if (!isDeepStrictEqual(intent.pin, WORLD_HIRE_EXISTING_PIN))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing hire requires its exact original implementation pin')
  return simulationWorldHireExistingPayloadSchema.parse(intent.payload)
}
function committed(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult) {
  const requested = original(intent), payload = simulationWorldHireExistingCommittedResultPayloadSchema.parse(result.payload)
  const owned = world(state)
  const plan = result.source.kind === 'plan' ? lookup(owned.plans, result.source.planId) : undefined
  const mutation = plan === undefined ? undefined : lookup(owned.mutations, worldMutationIdSchema.parse(`world-mutation:${plan.id}`))
  const relation = lookup(state.relations, payload.relationId), person = lookup(state.entities, requested.personId)
  const channelId = directorChannel(state, requested.personId)
  const bindingRead = plan?.reads.find(value => value.kind === 'entity-binding' && value.id === requested.personId)
  if (result.outcome.kind !== 'committed' || result.intentId !== intent.id || result.requestId !== intent.requestId
    || payload.entityId !== requested.personId || plan?.requestId !== result.requestId || plan.status !== 'accepted'
    || plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(plan.proposal.resolution.payload, requested)
    || mutation?.planId !== plan.id || mutation.requestId !== result.requestId || mutation.time !== result.time
    || !isDeepStrictEqual(mutation.pin, intent.pin) || !isDeepStrictEqual(mutation.payload, requested)
    || person?.binding === undefined || person.binding.teamId !== state.teamReservation?.teamId
    || bindingRead?.kind !== 'entity-binding' || bindingRead.hash !== businessFingerprint(person.binding)
    || channelId === undefined
    || relation?.relation !== 'assignment' || relation.id !== `world-existing-assignment:${intent.id}`
    || relation.subject !== requested.personId || relation.object !== requested.positionEntityId
    || relation.scope !== requested.organizationEntityId || relation.validFrom !== result.time) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
      'Existing hire onboarding lost its original mutation, binding, assignment or confirmed private Channel')
  }
  return { requested, person, relation, channelId }
}

/** Pure installed existing-person hire; Native owns final grant, read-set and atomic effect validation. */
export class ExistingHireNativeWorldDomain implements NativeWorldDomain {
  personnelSubjects(intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [original(intent).personId] }

  readonly definition = WORLD_HIRE_EXISTING_DEFINITION
  readonly ref = WORLD_HIRE_EXISTING_PIN.implementationRef
  readonly generation = WORLD_HIRE_EXISTING_PIN.generation

  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId) {
    const grants = currentWorldOperationGrants(state, actorId, WORLD_HIRE_EXISTING_PIN).map(({ grant }) => grant)
    const opportunities = grants.flatMap((grant) => {
      const relation = lookup(state.relations, grant.relationId)
      if (relation?.subject !== actorId || relation.relation !== 'can-hire' || relation.object !== grant.targetEntityId
        || relation.scope !== grant.scopeEntityId || !live(state, relation)) return []
      const eligible = Object.values(state.relations).filter(value => value.relation === 'eligible-for-hire'
        && value.object === grant.scopeEntityId && value.scope === grant.scopeEntityId && live(state, value))
      return eligible.flatMap((eligibility) => {
        const payload = simulationWorldHireExistingPayloadSchema.parse({ organizationEntityId: grant.scopeEntityId,
          positionEntityId: grant.targetEntityId, personId: eligibility.subject,
          description: 'Hire an explicitly eligible existing person.' })
        try { current(state, actorId, payload) }
        catch (error) {
          if (!(error instanceof SimulationWorldError) || error.code !== 'SIM_WORLD_AUTHORITY'
            && error.code !== 'SIM_WORLD_CONFLICT' && error.code !== 'SIM_WORLD_LIMIT') throw error
          return [] /* An unavailable or ineligible person is not a current hiring opportunity. */
        }
        return [{ organizationEntityId: payload.organizationEntityId,
          positionEntityId: payload.positionEntityId, personId: payload.personId }]
      })
    })
    return z.json().parse({ kind: 'existing-hire-opportunities', opportunities,
      hiringFees: (world(state).definition.hiringFees ?? []).filter(value => value.operation === 'hire-existing'
        && opportunities.some(item => item.positionEntityId === value.positionEntityId)) })
  }

  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    const payload = simulationWorldHireExistingPayloadSchema.parse(request.payload)
    if (request.expectedTime !== null || request.evidence.length) {
      throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'Existing hiring supports the next safe boundary with original scoped eligibility')
    }
    const prior = Object.values(world(state).intents).find(value => value.requesterEntityId === actorId
      && isDeepStrictEqual(value.pin, WORLD_HIRE_EXISTING_PIN) && value.businessKey === request.businessKey)
    current(state, actorId, payload, prior?.id)
    assertHiringRequestPolicy(state, payload.organizationEntityId, payload.positionEntityId)
    return { scopeEntityId: payload.organizationEntityId, targetEntityId: payload.positionEntityId,
      description: payload.description, payload: z.json().parse(payload) }
  }

  admitManagementRequest(state: SimulationSnapshot, request: SimulationWorldDomainRequest,
    source: import('@clocky/clocky-simulation').SimulationWorldAuthenticatedUserSource, original?: SimulationWorldIntent) {
    if (state.world?.definition.operations.some(pin => pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef))
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Market hiring requires independent employer and candidate decisions')
    const payload = simulationWorldHireExistingPayloadSchema.parse(request.payload)
    if (request.domain !== this.definition.domain || request.operation !== this.definition.operation
      || request.version !== this.definition.version
      || request.expectedTime !== null || request.evidence.length
      || original !== undefined && (original.requesterEntityId !== null || !isDeepStrictEqual(original.source, source)
        || !isDeepStrictEqual(original.payload, payload)))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'Management hiring must preserve its original source and existing-person payload')
    current(state, null, payload, original?.id)
    assertHiringRequestPolicy(state, payload.organizationEntityId, payload.positionEntityId)
    return { scopeEntityId: payload.organizationEntityId, targetEntityId: payload.positionEntityId,
      description: payload.description, payload: z.json().parse(payload) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const payload = original(intent), { selected, usage, capacity } = current(state, intent.requesterEntityId, payload, intent.id)
    const name = selected.person.profile['name']
    return z.json().parse({ existingHire: payload, candidate: { entityId: selected.person.id,
      name: typeof name === 'string' ? name : null, revision: selected.person.revision, profileRevision: selected.person.profileRevision },
    position: { entityId: payload.positionEntityId, capacity, occupied: usage.occupied,
      scheduled: usage.assignments.length - usage.occupied, peakOccupied: usage.peak,
      reserved: usage.reservations.length + usage.personnelReservations.length + usage.hiringReservations.length },
    hiringFee: hiringFee(state, intent) ?? null })
  }

  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'reject') return
    const payload = original(intent), applied = simulationWorldHireExistingPayloadSchema.parse(resolution.payload)
    if (!isDeepStrictEqual(payload, applied))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'Existing hire apply must preserve its exact person, position and original request')
    current(state, intent.requesterEntityId, payload, intent.id)
  }

  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const payload = original(intent), { selected, position, grants, usage } = current(state, intent.requesterEntityId, payload, intent.id)
    const relationRead = (relation: SimulationRelation) => ({ kind: 'relation' as const, id: relation.id,
      revision: relation.revision, effectiveFrom: relation.validFrom, effectiveUntil: relation.validUntil })
    return simulationWorldReadSetSchema.parse([
      ...hiringResourceReads(state, intent),
      { kind: 'entity', id: selected.person.id, revision: selected.person.revision },
      { kind: 'entity-binding', id: selected.person.id, hash: businessFingerprint(selected.binding) },
      { kind: 'entity', id: position.id, revision: position.revision },
      ...selected.eligibility.map(relationRead), ...grants.map(relationRead),
      { kind: 'relation-subject-set', relation: 'assignment', subject: payload.personId,
        hash: businessFingerprint(pendingAssignments(state, payload.personId)) },
      { kind: 'relation-set', relation: 'assignment', object: payload.positionEntityId, scope: payload.organizationEntityId,
        hash: businessFingerprint({ assignments: usage.assignments, reservations: usage.reservations,
          personnelReservations: usage.personnelReservations,
          ...state.world?.definition.hiringFees?.length ? { hiringReservations: usage.hiringReservations } : {} }) },
      ...effectiveNorms(state, payload.organizationEntityId, state.time, state.revision)
        .filter(value => value.enforcement.kind === 'validated').map(value => ({ kind: 'norm' as const, id: value.id,
          version: value.version })),
    ])
  }

  firstActionActor(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult) {
    return result.outcome.kind === 'committed' ? committed(state, intent, result).person.id : undefined
  }

  resultContext(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult,
    purpose: 'result' | 'first-action') {
    if (purpose === 'result' || result.outcome.kind !== 'committed') return undefined
    const { requested, person, relation, channelId } = committed(state, intent, result), owned = world(state)
    return { expectedActorId: person.id, recipient: owned.definition.directorEntityId, channelId,
      facts: { onboarding: { entityId: person.id, assignment: { relationId: relation.id,
        organizationEntityId: requested.organizationEntityId, positionEntityId: requested.positionEntityId,
        validFrom: relation.validFrom } } } }
  }

  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(plan.proposal.resolution.payload, payload)) {
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing hire mutation must preserve its original apply plan')
    }
    const requested = original(intent), parsed = simulationWorldHireExistingPayloadSchema.parse(payload)
    if (!isDeepStrictEqual(parsed, requested))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing hire mutation cannot replace its original person or request')
    current(state, intent.requesterEntityId, requested, intent.id)
    assertWorldMutationSlot(state, intent.id)
    if (Object.values(world(state).reservations).some(value => value.status !== 'committed' && value.status !== 'abandoned')
      || Object.values(world(state).external.representatives).some(value => value.status !== 'committed' && value.status !== 'abandoned')) {
      throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'Existing hiring waits for the original generated-hire structural responsibility to settle')
    }
    if (!hiringMarketAcceptance(state, plan.id))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring requires the original candidate acceptance of the exact offer')
    requireHireApproval(state, intent, plan)
    const relationId = simulationRelationIdSchema.parse(`world-existing-assignment:${intent.id}`)
    if (Object.hasOwn(state.relations, relationId))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Existing hire assignment identity is already retained')
    return { changes: [simulationChangeSchema.parse({ kind: 'relation/create', id: relationId,
      subject: requested.personId, relation: 'assignment', object: requested.positionEntityId, scope: requested.organizationEntityId,
      validFrom: state.time, validUntil: null })], resultPayload: { entityId: requested.personId, relationId } }
  }
}

/**
 * Index the already-confirmed original director Channel with the same existing-person commit, without topology IO.
 * @param state - Complete prospective business fold retaining its actual mutation, assignment and result.
 * @param id - Original existing-person intent; no caller supplies a Channel or replacement identity.
 * @param sequence - Actual committed mutation/result position.
 * @returns the exact canonical requester index; an inconsistent or foreign existing index rejects.
 */
export function installExistingHireDirectorChannel(state: SimulationSnapshot,
  id: SimulationWorldIntent['id'], sequence: number): SimulationSnapshot {
  const owned = world(state), intent = owned.intents[id]
  const result = Object.values(owned.results).find(value => value.intentId === id)
  if (intent === undefined || result?.source.kind !== 'plan' || result.outcome.kind !== 'committed' || result.sequence !== sequence)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Existing hire Channel index lost its actual committed source')
  const { person, channelId } = committed(state, intent, result)
  return { ...state, world: { ...owned, channels: { ...owned.channels, [person.id]: channelId } } }
}
