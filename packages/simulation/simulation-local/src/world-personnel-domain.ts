import { personnelRoleAuthorities } from './personnel-authorities.ts'
export { personnelRoleAuthorities } from './personnel-authorities.ts'
/** Pure personnel domain projections; the original Native owner must separately prove quiescence and structural reservation. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { WORLD_TRANSFER_PIN, WORLD_TRANSFER_DEFINITION, WORLD_DEPART_PIN, WORLD_DEPART_DEFINITION,
  WORLD_GENERATE_AND_HIRE_PIN, simulationWorldTransferPayloadSchema, simulationWorldDepartPayloadSchema,
  simulationWorldTransferCommittedResultPayloadSchema, simulationWorldHirePayloadSchema,
  simulationWorldReadSetSchema, simulationChangeSchema, simulationRelationIdSchema, worldMutationIdSchema,
  PersonnelDomainError, SimulationWorldError, currentWorldOperationGrants,
  effectiveNorms } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan,
  SimulationEntityId, SimulationRelation, SimulationWorldDomainRequest, SimulationWorldBusinessResolution,
  SimulationWorldJsonValue, SimulationWorldResult, SimulationWorldPersonnelPayload, SimTime, WorldIntentId,
  SimulationRelationId } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'

/** Additional pending capacity owned by Native personnel state, including blocked and uncertain preparations. */
export interface PersonnelPositionReservation {
  /** Exact original business identity, not a model-selected replacement. */
  readonly intentId: WorldIntentId
  /** Current original reservation journal cursor. */
  readonly updatedSequence: number
}
/** Synchronous owner capability supplied by Native; parser/reducer installation grants no quiescence or reservation authority. */
export interface PersonnelDomainOwner {
  /**
   * Read all unsettled personnel reservations at this target, excluding only the exact committing original intent.
   * @param state - Original authoritative Native snapshot.
   * @param scope - Exact organization.
   * @param position - Target position with finite declared capacity.
   * @param excludeIntentId - This operation's original reservation; undefined during fresh admission.
   * @returns all retained target responsibilities, including blocked, cancel-requested and outcome-unknown states.
   */
  positionReservations(state: SimulationSnapshot, scope: SimulationEntityId, position: SimulationEntityId,
    excludeIntentId?: WorldIntentId): readonly PersonnelPositionReservation[]
  /**
   * Require the original reservation, current exact reads and complete Native/Team settlement before commit.
   * @param state - Authoritative Native prefix before effects.
   * @param intent - Original pinned request and personnel subject.
   * @param plan - Exact original accepted apply plan.
   * @param effectiveAt - Actual safe-boundary time; strict requests cannot select an earlier interval.
   * @returns exact old-role authority closures only after all proofs hold, including requested retirement confirmation; otherwise throws.
   */
  requireCommit(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, effectiveAt: SimTime): {
    readonly closedAuthorityRelationIds: readonly SimulationRelationId[]
  }
}
function lookup<T>(values: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(values, id) ? values[id] : undefined
}
function world(state: SimulationSnapshot) {
  if (state.world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Personnel changes require a configured World')
  return state.world
}
function live(state: SimulationSnapshot, relation: SimulationRelation): boolean {
  return BigInt(relation.validFrom) <= BigInt(state.time)
    && (relation.validUntil === null || BigInt(state.time) < BigInt(relation.validUntil))
}
function sorted<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
}
function assignments(state: SimulationSnapshot, personId: SimulationEntityId) {
  return sorted(Object.values(state.relations).filter(value => value.relation === 'assignment' && value.subject === personId
    && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time))))
}
/** Shared pure validation; final caller authority, owned proofs and atomic append remain Native responsibilities. */
abstract class PersonnelNativeWorldDomain implements NativeWorldDomain {
  readonly definition
  readonly ref
  readonly generation
  private readonly pin

  /** @param operation - Installed fixed operation. @param owner - Actual Native pure reservation and quiescence authority. */
  constructor(private readonly operation: 'transfer' | 'depart', private readonly owner: PersonnelDomainOwner) {
    this.pin = operation === 'transfer' ? WORLD_TRANSFER_PIN : WORLD_DEPART_PIN
    this.definition = operation === 'transfer' ? WORLD_TRANSFER_DEFINITION : WORLD_DEPART_DEFINITION
    this.ref = this.pin.implementationRef
    this.generation = this.pin.generation
  }

  private parse(payload: SimulationWorldJsonValue): SimulationWorldPersonnelPayload {
    return this.operation === 'transfer' ? simulationWorldTransferPayloadSchema.parse(payload) : simulationWorldDepartPayloadSchema.parse(payload)
  }
  private original(intent: SimulationWorldIntent): SimulationWorldPersonnelPayload {
    if (!isDeepStrictEqual(intent.pin, this.pin))
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel request lost its original installed pin')
    const payload = this.parse(intent.payload)
    if (intent.scopeEntityId !== payload.organizationEntityId || intent.expectedTime !== payload.requestedEffectiveAt
      || intent.description !== payload.description) {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT',
        'Personnel intent must preserve its original scope, time and request description')
    }
    return payload
  }
  personnelSubjects(intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [this.original(intent).personId] }

  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId) {
    const owned = world(state)
    const opportunities = sorted(Object.values(state.relations).filter(value => value.relation === 'assignment'
      && value.scope === owned.definition.organizationEntityId && live(state, value))).flatMap((assignment) => {
      const common = { organizationEntityId: owned.definition.organizationEntityId, personId: assignment.subject,
        assignmentId: assignment.id, assignmentRevision: assignment.revision, requestedEffectiveAt: null,
        description: 'Change an explicitly authorized original assignment.' }
      const candidates = this.operation === 'transfer' ? owned.definition.positions.filter(value => value.entityId !== assignment.object)
        .map(value => simulationWorldTransferPayloadSchema.parse({ ...common, targetPositionId: value.entityId }))
        : [simulationWorldDepartPayloadSchema.parse({ ...common, retire: false })]
      return candidates.flatMap((payload) => {
        try { this.current(state, actorId, payload) }
        catch (error) {
          if (error instanceof PersonnelDomainError || error instanceof SimulationWorldError && error.code === 'SIM_WORLD_LIMIT') {
            return [] /* Unavailable assignments are not model opportunities; Native still retains their original obligations. */
          }
          throw error
        }
        return [{ organizationEntityId: payload.organizationEntityId, personId: payload.personId,
          assignmentId: payload.assignmentId, assignmentRevision: payload.assignmentRevision,
          previousPositionId: assignment.object, assignmentValidFrom: assignment.validFrom, currentTime: state.time,
          ...'targetPositionId' in payload ? { targetPositionId: payload.targetPositionId } : {} }]
      })
    })
    return z.json().parse({ kind: this.operation === 'transfer' ? 'transfer-opportunities' : 'departure-opportunities', opportunities })
  }

  private current(state: SimulationSnapshot, actorId: SimulationEntityId | null, payload: SimulationWorldPersonnelPayload,
    intentId?: WorldIntentId) {
    const owned = world(state), actor = actorId === null ? undefined : lookup(state.entities, actorId),
      person = lookup(state.entities, payload.personId)
    const assignment = lookup(state.relations, payload.assignmentId), team = state.teamReservation
    const organization = lookup(state.entities, payload.organizationEntityId)
    if (team?.confirmed !== true || actorId !== null && (actor?.phase !== 'active' || actor.cognition !== 'agent'
      || actor.readiness !== 'ready' || actor.binding?.teamId !== team.teamId) || person?.kind !== 'person' || person.phase !== 'active'
      || person.readiness !== 'ready' || person.cognition !== 'agent' || person.binding?.teamId !== team.teamId
      || organization?.kind !== 'organization' || organization.phase !== 'active'
      || payload.organizationEntityId !== owned.definition.organizationEntityId) {
      throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY',
        'Personnel requires the original active ready person and canonical Team binding')
    }
    if (assignment?.relation !== 'assignment' || assignment.subject !== person.id || assignment.scope !== payload.organizationEntityId
      || assignment.revision !== payload.assignmentRevision || !live(state, assignment)) {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel requires the exact live original assignment and revision')
    }
    if (assignments(state, person.id).some(value => value.id !== assignment.id)) {
      throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED',
        'Other current or future assignments require explicit independent settlement')
    }
    const source = lookup(state.entities, assignment.object)
    if (source?.kind !== 'position' || source.phase !== 'active') {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel source assignment lost its active original position')
    }
    if (payload.requestedEffectiveAt === null && BigInt(state.time) <= BigInt(assignment.validFrom)) {
      throw new PersonnelDomainError('SIM_PERSONNEL_WAITING_TIME', 'Personnel boundary must occur strictly after the original assignment start')
    }
    if (payload.requestedEffectiveAt !== null && BigInt(payload.requestedEffectiveAt) < BigInt(state.time)) {
      throw new PersonnelDomainError('SIM_PERSONNEL_STALE_TIME', 'Personnel strict requested time has passed; obtain a new plan')
    }
    if (payload.requestedEffectiveAt !== null && (BigInt(payload.requestedEffectiveAt) <= BigInt(assignment.validFrom)
      || BigInt(payload.requestedEffectiveAt) > BigInt(state.spec.maxTime)
      || assignment.validUntil !== null && BigInt(payload.requestedEffectiveAt) >= BigInt(assignment.validUntil))) {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT',
        'Requested personnel time must lie after the original assignment start and before its end')
    }
    const permission = this.operation === 'transfer' ? 'can-transfer' : 'can-depart'
    const sourceGrants = actorId === null ? [] : sorted(currentWorldOperationGrants(state, actorId, this.pin,
      payload.organizationEntityId, assignment.object)
      .filter(({ grant }) => grant.relation === permission).map(({ relation }) => relation))
    if (actorId !== null && !sourceGrants.length) {
      throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel change requires its original exact live source-role grant')
    }
    const targetGrants = actorId !== null && 'targetPositionId' in payload ? sorted(currentWorldOperationGrants(state, actorId, this.pin,
      payload.organizationEntityId, payload.targetPositionId).filter(({ grant }) => grant.relation === 'can-transfer-target')
      .map(({ relation }) => relation)) : []
    if (actorId !== null && 'targetPositionId' in payload && !targetGrants.length) {
      throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Transfer requires its exact live scoped target-position grant')
    }
    const grants = sorted([...sourceGrants, ...targetGrants])
    const authorities = personnelRoleAuthorities(state, person.id, payload.organizationEntityId)
    const occupancy = 'targetPositionId' in payload ? this.occupancy(state, payload, intentId) : undefined
    return { person, binding: person.binding, assignment, source, grants, authorities, occupancy }
  }

  private occupancy(state: SimulationSnapshot, payload: Extract<SimulationWorldPersonnelPayload, { targetPositionId: SimulationEntityId }>,
    intentId?: WorldIntentId) {
    const owned = world(state), target = lookup(state.entities, payload.targetPositionId)
    const capacity = owned.definition.positions.find(value => value.entityId === payload.targetPositionId)?.capacity
    const original = lookup(state.relations, payload.assignmentId)
    if (target?.kind !== 'position' || target.phase !== 'active' || target.cognition !== 'none' || capacity === undefined
      || target.id === original?.object)
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Transfer requires a distinct active declared target position')
    const pending = sorted(Object.values(state.relations).filter(value => value.relation === 'assignment'
      && value.object === target.id && value.scope === payload.organizationEntityId
      && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time))))
    const generated = Object.values(owned.reservations).filter((value) => {
      if (value.status === 'committed' || value.status === 'abandoned') return false
      const intent = lookup(owned.intents, value.id)
      if (intent === undefined || !isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN)) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Personnel capacity lost a retained original generated-hire reservation')
      }
      const requested = simulationWorldHirePayloadSchema.parse(intent.payload)
      return requested.organizationEntityId === payload.organizationEntityId && requested.positionEntityId === target.id
    }).sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1)
    const personnel = [...this.owner.positionReservations(state, payload.organizationEntityId, target.id, intentId)]
      .sort((a, b) => a.intentId < b.intentId ? -1 : a.intentId === b.intentId ? 0 : 1)
    const points = [state.time, ...pending.map(value => value.validFrom).filter(value => BigInt(value) > BigInt(state.time))]
    const peak = points.reduce((maximum, time) => Math.max(maximum, pending.filter(value => BigInt(value.validFrom) <= BigInt(time)
      && (value.validUntil === null || BigInt(time) < BigInt(value.validUntil))).length), 0)
    if (peak + generated.length + personnel.length >= capacity) {
      throw new SimulationWorldError('SIM_WORLD_LIMIT',
        'Transfer target is occupied or retained by original pending reservations', 'position')
    }
    return { target, capacity, assignments: pending, generated, personnel,
      occupied: pending.filter(value => live(state, value)).length, peak }
  }

  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest,
    original?: SimulationWorldIntent) {
    const payload = this.parse(request.payload)
    if (request.domain !== this.pin.domain || request.operation !== this.pin.operation || request.version !== this.pin.version
      || request.expectedTime !== payload.requestedEffectiveAt || request.evidence.length) {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT',
        'Personnel envelope must preserve the original strict requested time and installed operation')
    }
    if (original !== undefined && (!isDeepStrictEqual(world(state).intents[original.id], original)
      || !isDeepStrictEqual(original.pin, this.pin) || original.requesterEntityId !== actorId
      || original.businessKey !== request.businessKey || !isDeepStrictEqual(original.payload, payload)
      || original.expectedTime !== request.expectedTime || !isDeepStrictEqual(original.evidence, request.evidence)))
      throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY', 'Personnel execution must retain its exact original Native intent')
    const selected = this.current(state, actorId, payload, original?.id)
    return { scopeEntityId: payload.organizationEntityId, targetEntityId: selected.assignment.object,
      description: payload.description, payload: z.json().parse(payload) }
  }
  admitManagementRequest(state: SimulationSnapshot, request: SimulationWorldDomainRequest,
    source: import('@clocky/clocky-simulation').SimulationWorldAuthenticatedUserSource, original?: SimulationWorldIntent) {
    const payload = this.parse(request.payload)
    if (request.domain !== this.pin.domain || request.operation !== this.pin.operation || request.version !== this.pin.version
      || request.expectedTime !== payload.requestedEffectiveAt || request.evidence.length
      || original !== undefined && (original.requesterEntityId !== null || !isDeepStrictEqual(original.source, source)
        || !isDeepStrictEqual(original.payload, payload) || !isDeepStrictEqual(original.pin, this.pin)))
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT',
        'Management personnel input must retain its original source, time and payload')
    const selected = this.current(state, null, payload, original?.id)
    return { scopeEntityId: payload.organizationEntityId, targetEntityId: selected.assignment.object,
      description: payload.description, payload: z.json().parse(payload) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const payload = this.original(intent), selected = this.current(state, intent.requesterEntityId, payload, intent.id)
    const usage = selected.occupancy
    return z.json().parse({ personnel: payload, operation: this.operation, currentTime: state.time,
      person: { entityId: selected.person.id, revision: selected.person.revision, profileRevision: selected.person.profileRevision },
      assignment: { id: selected.assignment.id, revision: selected.assignment.revision,
        positionId: selected.assignment.object, validFrom: selected.assignment.validFrom, validUntil: selected.assignment.validUntil },
      target: usage === undefined ? null : { entityId: usage.target.id, capacity: usage.capacity,
        occupied: usage.occupied, peakOccupied: usage.peak, reserved: usage.generated.length + usage.personnel.length } })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'reject') return
    const payload = this.original(intent), applied = this.parse(resolution.payload)
    if (!isDeepStrictEqual(payload, applied))
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel apply must preserve the exact original request')
    this.current(state, intent.requesterEntityId, payload, intent.id)
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const payload = this.original(intent), selected = this.current(state, intent.requesterEntityId, payload, intent.id)
    const relationRead = (relation: SimulationRelation) => ({ kind: 'relation' as const, id: relation.id,
      revision: relation.revision, effectiveFrom: relation.validFrom, effectiveUntil: relation.validUntil })
    const relations = sorted([...new Map([selected.assignment, ...selected.grants, ...selected.authorities]
      .map(value => [value.id, value])).values()])
    const usage = selected.occupancy
    return simulationWorldReadSetSchema.parse([
      { kind: 'entity-profile', id: selected.person.id, revision: selected.person.profileRevision,
        hash: businessFingerprint(selected.person.profile) },
      { kind: 'entity-binding', id: selected.person.id, hash: businessFingerprint(selected.binding) },
      { kind: 'entity', id: selected.source.id, revision: selected.source.revision }, ...relations.map(relationRead),
      { kind: 'relation-subject-set', relation: 'assignment', subject: selected.person.id,
        hash: businessFingerprint(assignments(state, selected.person.id)) },
      ...usage === undefined ? [] : [
        { kind: 'entity', id: usage.target.id, revision: usage.target.revision },
        { kind: 'relation-set', relation: 'assignment', object: usage.target.id, scope: payload.organizationEntityId,
          hash: businessFingerprint({ assignments: usage.assignments, generatedReservations: usage.generated,
            personnelReservations: usage.personnel }) },
      ],
      ...effectiveNorms(state, payload.organizationEntityId, state.time, state.revision)
        .filter(value => value.enforcement.kind === 'validated')
        .map(value => ({ kind: 'norm' as const, id: value.id, version: value.version })),
    ])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    const requested = this.original(intent), parsed = this.parse(payload)
    if (plan.requestId !== intent.requestId || !isDeepStrictEqual(plan.pin, intent.pin) || plan.status !== 'accepted'
      || plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(plan.proposal.resolution.payload, requested)
      || !isDeepStrictEqual(parsed, requested)) {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel mutation requires its exact original accepted apply plan')
    }
    const selected = this.current(state, intent.requesterEntityId, requested, intent.id)
    if (requested.requestedEffectiveAt !== null && requested.requestedEffectiveAt !== state.time) {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel mutation has not reached its exact strict safe boundary')
    }
    if (BigInt(state.time) <= BigInt(selected.assignment.validFrom)) {
      throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Personnel closure must occur strictly after the original assignment start')
    }
    const proof = this.owner.requireCommit(state, intent, plan, state.time)
    const closureIds = new Set(proof.closedAuthorityRelationIds)
    const authorities = selected.authorities.filter(value => closureIds.has(value.id))
    if (closureIds.size !== proof.closedAuthorityRelationIds.length || authorities.length !== closureIds.size
      || authorities.some(value => BigInt(value.validFrom) >= BigInt(state.time))) {
      throw new PersonnelDomainError('SIM_PERSONNEL_AUTHORITY',
        'Personnel owner proof must select distinct exact old-role grants with nonempty intervals')
    }
    const changes = [selected.assignment, ...authorities].map(value => simulationChangeSchema.parse({
      kind: 'relation/update', id: value.id, relationRevision: value.revision, relation: value.relation,
      subject: value.subject, object: value.object, ...value.scope === undefined ? {} : { scope: value.scope },
      validFrom: value.validFrom, validUntil: state.time }))
    const result = { entityId: selected.person.id, organizationEntityId: requested.organizationEntityId,
      closedAssignmentId: selected.assignment.id, previousPositionId: selected.assignment.object,
      requestedEffectiveAt: requested.requestedEffectiveAt, actualEffectiveAt: state.time,
      closedAuthorityRelationIds: authorities.map(value => value.id),
      revokedAuthorityRelationIds: selected.authorities.map(value => value.id) }
    if ('targetPositionId' in requested) {
      const newAssignmentId = simulationRelationIdSchema.parse(`world-transfer-assignment:${intent.id}`)
      if (Object.hasOwn(state.relations, newAssignmentId)) {
        throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Transfer deterministic assignment identity is already retained')
      }
      changes.push(simulationChangeSchema.parse({ kind: 'relation/create', id: newAssignmentId, relation: 'assignment',
        subject: requested.personId, object: requested.targetPositionId, scope: requested.organizationEntityId,
        validFrom: state.time, validUntil: null }))
      return { changes, resultPayload: { ...result, newAssignmentId, targetPositionId: requested.targetPositionId } }
    }
    return { changes, resultPayload: { ...result, retire: requested.retire } }
  }

  firstActionActor(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult) {
    if (this.operation !== 'transfer' || result.outcome.kind !== 'committed') return undefined
    return this.recordedTransfer(state, intent, result).person.id
  }
  resultContext(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult,
    purpose: 'result' | 'first-action') {
    if (purpose !== 'first-action' || this.operation !== 'transfer' || result.outcome.kind !== 'committed') return undefined
    const selected = this.recordedTransfer(state, intent, result), owned = world(state)
    return { expectedActorId: selected.person.id, recipient: owned.definition.directorEntityId, channelId: selected.channelId,
      facts: { personnel: selected.payload } }
  }
  private recordedTransfer(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult) {
    const requested = this.original(intent), owned = world(state)
    const payload = simulationWorldTransferCommittedResultPayloadSchema.parse(result.payload)
    const plan = result.source.kind === 'plan' ? lookup(owned.plans, result.source.planId) : undefined
    const mutation = plan === undefined ? undefined : lookup(owned.mutations, worldMutationIdSchema.parse(`world-mutation:${plan.id}`))
    const person = lookup(state.entities, requested.personId), previous = lookup(state.relations, requested.assignmentId)
    const replacement = lookup(state.relations, payload.newAssignmentId)
    const originalChannels = Object.values(state.channelReservations ?? {}).filter(value => value.confirmed
      && value.spec.members.length === 2
      && value.spec.members.some(member => member.entityId === requested.personId)
      && value.spec.members.some(member => member.entityId === owned.definition.directorEntityId))
    const channel = originalChannels.length === 1 ? originalChannels[0] : undefined
    const channelId = channel?.channelId, indexed = lookup(owned.channels, requested.personId)
    const bindingRead = plan?.reads.find(value => value.kind === 'entity-binding' && value.id === requested.personId)
    if (!('targetPositionId' in requested) || payload.entityId !== requested.personId
      || payload.closedAssignmentId !== requested.assignmentId
      || payload.targetPositionId !== requested.targetPositionId || payload.requestedEffectiveAt !== requested.requestedEffectiveAt
      || payload.actualEffectiveAt !== result.time || payload.organizationEntityId !== requested.organizationEntityId
      || result.intentId !== intent.id || result.requestId !== intent.requestId || plan?.requestId !== result.requestId
      || plan.status !== 'accepted' || !isDeepStrictEqual(plan.pin, intent.pin) || plan.proposal.resolution.kind !== 'apply'
      || !isDeepStrictEqual(plan.proposal.resolution.payload, requested)
      || mutation?.planId !== plan.id || mutation.requestId !== result.requestId || mutation.time !== result.time
      || !isDeepStrictEqual(mutation.payload, requested)
      || !isDeepStrictEqual(mutation.pin, intent.pin) || person?.binding === undefined || bindingRead?.kind !== 'entity-binding'
      || bindingRead.hash !== businessFingerprint(person.binding) || previous?.subject !== person.id
      || previous.relation !== 'assignment' || previous.scope !== requested.organizationEntityId
      || previous.revision !== requested.assignmentRevision + 1
      || previous.validUntil !== result.time || payload.previousPositionId !== previous.object
      || replacement?.id !== `world-transfer-assignment:${intent.id}` || replacement.subject !== person.id
      || replacement.relation !== 'assignment' || replacement.object !== requested.targetPositionId
      || replacement.scope !== requested.organizationEntityId || replacement.validFrom !== result.time
      || !payload.closedAuthorityRelationIds.every(id => lookup(state.relations, id)?.subject === person.id
        && lookup(state.relations, id)?.scope === requested.organizationEntityId && lookup(state.relations, id)?.validUntil === result.time)
      || state.teamReservation?.confirmed !== true || person.binding.teamId !== state.teamReservation.teamId
      || channelId === undefined || indexed !== undefined && indexed !== channelId || channel?.spec.members.length !== 2
      || !channel.spec.members.some(value => value.entityId === person.id)
      || !channel.spec.members.some(value => value.entityId === owned.definition.directorEntityId)) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
        'Transfer first action lost its original mutation, assignment, binding or confirmed Channel')
    }
    return { person, payload, channelId }
  }
}

/** Pure organization.transfer/1; Native supplies the actual structural reservation and complete obligation proofs. */
export class TransferNativeWorldDomain extends PersonnelNativeWorldDomain {
  /** @param owner - Native-owned pure capacity and quiescence checks; a domain cannot substitute model evidence. */
  constructor(owner: PersonnelDomainOwner) { super('transfer', owner) }
}
/** Pure organization.depart/1; stopping cognition is confirmed by its retained Native writer owner before commit. */
export class DepartNativeWorldDomain extends PersonnelNativeWorldDomain {
  /** Native acceptance installs the exact original assignment fence before planning or owner IO. */
  readonly acceptedResponsibility = 'personnel-departure' as const
  /** @param owner - Native-owned pure capacity, obligation and requested retirement checks. */
  constructor(owner: PersonnelDomainOwner) { super('depart', owner) }
}
