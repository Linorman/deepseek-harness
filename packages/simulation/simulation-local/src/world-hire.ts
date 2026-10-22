import { WORLD_HIRING_MARKET_PIN, hasAcceptedHiringOffer, simulationMaintenanceRequestSchema, simulationRelationIdSchema } from '@clocky/clocky-simulation'
import { reservedHiringOffers } from '@clocky/clocky-simulation'
import { worldRolePlanOperationId } from '@clocky/clocky-simulation'
import { assertWorldMutationSlot, assertWorldBirthBudget } from './world-structure-budget.ts'
import { pendingExternalIdentityCapacity } from './world-external-actor.ts'
import { hireIntentRequest, hirePlanPayload, hireResultPayload } from './world-organization.ts'
import { requireHireApproval } from './world-hire-approval.ts'
import { simulationHireApprovalBasisSchema } from '@clocky/clocky-simulation'
import type { NativeWorldRuntime } from './world-runtime.ts'
/** Native position reservation and atomic hire settlement; no Team, model or filesystem IO occurs in these folds. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationWorldHireReserveRequestSchema, simulationWorldHireIdentitiesSchema,
  simulationWorldHireReservationSchema, simulationWorldIdentityCleanupEvidenceSchema, worldIntentIdSchema,
  simulationChangeSchema, activeSimulationMaintenance, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldHireReservation, WorldIntentId,
  SimulationWorldPlan, SimulationWorldRequest, SimulationWorldIntent, SimulationChannelSpec,
  SimulationWorldIdentityCleanupEvidence, SimulationWorldIdentityChannelCleanup,
  SimulationChannelReservation, SimulationEntityId } from '@clocky/clocky-simulation'
import { requireWorld, worldExecutionReads, withWorldResult, worldResultIdentity } from './world.ts'
import { foldEntityChange } from './entities.ts'
import { installHiringResourceReservation, requireHiringResourceReservation, commitHiringResourceReservation,
  cancelHiringResourceReservations, existingHiringResourceHolds } from './world-hiring-resources.ts'
import { simulationResourceReservationSchema } from '@clocky/clocky-simulation'

/** All caller-selected execution fields and allocated identities are immutable after this record. */
export const worldHireRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hire/reserved'), request: simulationWorldHireReserveRequestSchema,
    identities: simulationWorldHireIdentitiesSchema, approvals: z.array(simulationHireApprovalBasisSchema),
    resourceHold: simulationResourceReservationSchema.optional() }),
  z.strictObject({ kind: z.literal('hire/preparing'), id: worldIntentIdSchema }),
  z.strictObject({ kind: z.literal('hire/candidate-ready'), id: worldIntentIdSchema }),
  z.strictObject({ kind: z.literal('hire/committed'), id: worldIntentIdSchema }),
  z.strictObject({ kind: z.literal('hire/abandoned'), id: worldIntentIdSchema, evidence: simulationWorldIdentityCleanupEvidenceSchema }),
])
/** Validated Native reservation transition. */
export type WorldHireRecord = z.infer<typeof worldHireRecordSchema>

/**
 * Validate the original latest hiring application before policy approval is evaluated or identities are selected.
 * @param state - Actual Native owner prefix.
 * @param planId - Original accepted apply plan, never a replacement payload.
 * @param runtime - Original pinned domain catalog used for critical execution reads.
 * @returns the exact retained plan, request and intent; stale or terminal cases reject before any policy classification.
 */
export function requireWorldHireApplication(state: SimulationSnapshot, planId: SimulationWorldPlan['id'], runtime?: NativeWorldRuntime): {
  plan: SimulationWorldPlan
  request: SimulationWorldRequest
  intent: SimulationWorldIntent
} {
  const world = requireWorld(state), plan = world.plans[planId]
  const request = plan === undefined ? undefined : world.requests[plan.requestId]
  const intent = request === undefined ? undefined : world.intents[request.intentId]
  const operation = plan === undefined ? undefined : state.operations[worldRolePlanOperationId(plan)]
  const decision = operation === undefined ? undefined : state.decisions[operation.decisionId]
  if (plan === undefined || request === undefined || intent === undefined || plan.status !== 'accepted'
    || plan.proposal.resolution.kind !== 'apply' || request.status !== 'open' || request.plans.at(-1) !== plan.id
    || decision?.status !== 'accepted') {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hire requires the latest accepted apply plan for an open business case')
  }
  if (!isDeepStrictEqual(plan.reads, worldExecutionReads(state, intent, runtime))) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hire plan execution reads changed; retain the plan and replan explicitly')
  }
  return { plan, request, intent }
}

/**
 * Count the peak overlapping retained assignments from now onward plus every unconfirmed reservation.
 * @param state - Authoritative current world.
 * @param position - Position whose capacity is being admitted.
 * @param exclude - Own reservation during its commit; it is replaced by the assignment in the same append.
 * @returns complete occupied/reserved count.
 */
export function worldPositionUsage(state: SimulationSnapshot, position: string, exclude?: WorldIntentId): number {
  const world = requireWorld(state)
  const assignments = Object.values(state.relations).filter(relation => relation.relation === 'assignment'
    && relation.object === position && relation.scope === world.definition.organizationEntityId
    && (relation.validUntil === null || BigInt(relation.validUntil) > BigInt(state.time)))
  const points = [state.time, ...assignments.map(value => value.validFrom).filter(value => BigInt(value) > BigInt(state.time))]
  const occupied = points.reduce((maximum, time) => Math.max(maximum, assignments.filter(value => BigInt(value.validFrom) <= BigInt(time)
    && (value.validUntil === null || BigInt(value.validUntil) > BigInt(time))).length), 0)
  const reserved = Object.values(world.reservations).filter((value) => {
    const intent = world.intents[value.id]
    return value.id !== exclude && value.status !== 'committed' && value.status !== 'abandoned'
      && intent !== undefined && hireIntentRequest(intent).positionEntityId === position
  }).length
  const personnel = Object.values(world.personnel.reservations).filter(value => value.id !== exclude
    && value.status !== 'committed' && value.status !== 'cancelled' && value.targetPositionId === position
    && world.intents[value.id]?.scopeEntityId === world.definition.organizationEntityId).length
  const existing = existingHiringResourceHolds(state, exclude).filter(value => value.world?.fee.positionEntityId === position).length
  const offers = reservedHiringOffers(state).filter((value) => {
    const plan = world.plans[value.planId]
    if (plan === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Accepted hiring offer lost its original plan')
    return value.positionEntityId === position && world.requests[plan.requestId]?.intentId !== exclude
      && !Object.values(world.reservations).some(reservation => reservation.request.planId === value.planId
        && reservation.status !== 'committed' && reservation.status !== 'abandoned')
      && !Object.values(state.resourceReservations).some(hold => hold.phase === 'active' && hold.world?.planId === value.planId)
  }).length
  return occupied + reserved + personnel + existing + offers
}

function quiescent(state: SimulationSnapshot, reservation: SimulationWorldHireReservation): void {
  const owner = activeSimulationMaintenance(state)
  if (owner?.status !== 'quiescent' || !isDeepStrictEqual(owner.request, reservation.candidate?.maintenance ?? reservation.request.maintenance)
    || state.phase !== 'paused' || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released')) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Hire preparation and commit require their exact proven-quiescent maintenance owner')
  }
}

/**
 * Admit cleanup only for an original pending cancellation under its exact quiescent maintenance owner.
 * @param state - Current Native state, revalidated before IO and before settlement.
 * @param reservation - Immutable original obligation; terminal or executable hires cannot initiate cleanup.
 */
export function assertWorldHireCancellationAdmission(state: SimulationSnapshot, reservation: SimulationWorldHireReservation): void {
  if (reservation.status !== 'cancel-requested' || requireWorld(state).requests[reservation.requestId]?.status !== 'cancel-requested') {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hire cleanup requires its original pending prepared cancellation')
  }
  quiescent(state, reservation)
}

function cleanupIdentity(state: SimulationSnapshot, reservation: SimulationWorldHireReservation,
  evidence: SimulationWorldIdentityCleanupEvidence): void {
  if (!isDeepStrictEqual(evidence.binding, reservation.identities.binding)
    || evidence.channels.some((channel, index) => channel.channelId !== reservation.identities.channels[index]?.channelId)
    || evidence.participant === 'absent' && state.entities[reservation.identities.entityId]?.binding !== undefined
    || evidence.channels.some((channel, index) => {
      const original = reservation.identities.channels[index]
      return channel.phase === 'absent' && original !== undefined && state.channelReservations?.[original.key]?.confirmed === true
    })) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire cleanup lost its original identity or confirmed topology history')
  }
}

function abandon(state: SimulationSnapshot, reservation: SimulationWorldHireReservation, evidence: SimulationWorldIdentityCleanupEvidence,
  sequence: number, runtime?: NativeWorldRuntime): SimulationSnapshot {
  assertWorldHireCancellationAdmission(state, reservation)
  cleanupIdentity(state, reservation, evidence)
  const world = requireWorld(state), entity = state.entities[reservation.identities.entityId]
  const { modelVersion: _version, ...participant } = reservation.request.member
  if (entity?.phase !== 'active' || entity.readiness !== 'preparing' || entity.cognition !== 'agent'
    || entity.writer !== undefined
    || !isDeepStrictEqual(entity.profile, profile(state, reservation))
    || !isDeepStrictEqual(entity.participantReservation, { binding: reservation.identities.binding, participant })
    || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, reservation.identities.binding)
    || state.relations[reservation.identities.relationId] !== undefined
    || specs(state, reservation).some(spec => !isDeepStrictEqual(state.channelReservations?.[spec.key]?.spec, spec)
      || state.channelReservations?.[spec.key]?.channelId
        !== reservation.identities.channels.find(channel => channel.key === spec.key)?.channelId)) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
      'Hire cancellation lacks its original preparing identity and retained topology reservations')
  }
  const pending = Object.values(world.cancellations).filter(command => command.request.requestId === reservation.requestId
    && command.status === 'cancel-requested').sort((first, second) => first.sequence - second.sequence)
  const first = pending[0]
  if (first === undefined || first.sequence >= sequence) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire cancellation has no original pending command before cleanup')
  }
  const abandoned: SimulationWorldHireReservation = { ...reservation, status: 'abandoned', updatedSequence: sequence,
    cleanup: { sequence, evidence } }
  let next: SimulationSnapshot = cancelHiringResourceReservations({ ...state, world: { ...world,
    reservations: { ...world.reservations, [reservation.id]: abandoned } } }, reservation.id, sequence)
  next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'entity/readiness', id: entity.id,
    entityRevision: entity.revision, readiness: 'abandoned' }))
  next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'entity/phase', id: entity.id,
    entityRevision: entity.revision + 1, phase: 'terminated' }))
  const resultId = worldResultIdentity(reservation.id)
  next = withWorldResult(next, { id: resultId, requestId: reservation.requestId, intentId: reservation.id,
    source: { kind: 'cancel', commandId: first.request.id }, outcome: { kind: 'cancelled' }, payload: {}, time: state.time,
    sequence }, runtime)
  const cancellations = { ...world.cancellations }
  for (const command of pending) {
    cancellations[command.request.id] = { ...command, resultId,
      status: command.request.id === first.request.id ? 'cancelled' : 'already-resolved' }
  }
  return { ...next, world: { ...requireWorld(next), cancellations } }
}

/**
 * Read the original business reservation without inventing progress from IO absence.
 * @param state - Current authoritative world.
 * @param id - Original business identity.
 * @returns original reservation or rejects an unknown application.
 */
export function requireWorldHire(state: SimulationSnapshot, id: WorldIntentId): SimulationWorldHireReservation {
  const world = requireWorld(state)
  if (!Object.hasOwn(world.reservations, id)) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hire reservation is not retained')
  return world.reservations[id] as SimulationWorldHireReservation
}

/**
 * Recover retained cleanup responsibility for a terminated original generated identity.
 * @param state - Complete authoritative world projection.
 * @param entityId - Exact originally reserved generated Entity.
 * @returns its abandoned reservation only after Native has retained the canonical owner's cleanup evidence.
 */
export function worldHireCleanupReservation(state: SimulationSnapshot,
  entityId: SimulationEntityId): SimulationWorldHireReservation | undefined {
  return Object.values(state.world?.reservations ?? {}).find(reservation => reservation.status === 'abandoned'
    && reservation.cleanup !== undefined && reservation.identities.entityId === entityId)
}

/**
 * Resolve one original Channel's retained terminal observation without dropping its historical reservation.
 * @param state - Complete authoritative world projection.
 * @param channel - Exact Native Channel reservation under inspection.
 * @returns its cleanup observation; unfinished or unrelated Channels have no terminal permission.
 */
export function worldHireChannelCleanup(state: SimulationSnapshot,
  channel: SimulationChannelReservation): SimulationWorldIdentityChannelCleanup | undefined {
  for (const reservation of Object.values(state.world?.reservations ?? {})) {
    if (reservation.status !== 'abandoned' || reservation.cleanup === undefined) continue
    for (const [index, identity] of reservation.identities.channels.entries()) {
      const evidence = reservation.cleanup.evidence.channels[index]
      if (identity.key === channel.spec.key && identity.channelId === channel.channelId && evidence?.channelId === identity.channelId) {
        return evidence
      }
    }
  }
  return undefined
}

function specs(state: SimulationSnapshot, reservation: SimulationWorldHireReservation): SimulationChannelSpec[] {
  const world = requireWorld(state), intent = world.intents[reservation.id]
  if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire lost its application')
  return reservation.identities.channels.map(channel => ({ key: channel.key,
    members: [{ entityId: reservation.identities.entityId, role: 'member' }, { entityId: channel.purpose === 'director'
      ? world.definition.directorEntityId : hireIntentRequest(intent).requesterEntityId, role: channel.purpose }], limits: {} }))
}

function profile(state: SimulationSnapshot, reservation: SimulationWorldHireReservation) {
  const world = requireWorld(state), plan = world.plans[reservation.request.planId]
  if (plan?.proposal.resolution.kind !== 'apply') throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Hire lost its complete accepted persona')
  const selected = hirePlanPayload(plan)
  const template = world.definition.templates.find(value => value.id === selected.templateId && value.version === selected.templateVersion)
  if (template === undefined) throw new SimulationWorldError('SIM_WORLD_TEMPLATE', 'Hire lost its original template version')
  return { name: selected.persona.name, description: template.description, persona: selected.persona,
    ...selected.personaDraft === undefined ? {} : { personaDraft: selected.personaDraft } }
}

/**
 * Validate and fold one reservation/preparation/commit transition before its atomic append.
 * @param state - Prior authoritative projection.
 * @param record - Strict transition; identity UUIDs are already selected by the Native run owner.
 * @param sequence - Durable transition position.
 * @param runtime - Original explicit World parser/reducer catalog; absent only for base simulation operations.
 * @returns new projection; a committed record installs all local hiring facts together.
 */
export function foldWorldHire(state: SimulationSnapshot, record: WorldHireRecord, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state)
  if (record.kind === 'hire/abandoned' && Buffer.byteLength(JSON.stringify({ kind: 'run/world-hire', runId: state.spec.runId,
    expectedRevision: sequence - 1, change: record }), 'utf8') > world.definition.limits.maxBytesPerPlan) {
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Hire cleanup exceeds its complete retained record byte allowance', 'bytes')
  }
  if (record.kind === 'hire/reserved') {
    if (state.activeWindowId !== undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Hire reservation waits for window closure')
    const { plan, request, intent } = requireWorldHireApplication(state, record.request.planId, runtime)
    const approvals = requireHireApproval(state, intent, plan)
    if (!isDeepStrictEqual(record.approvals, approvals)) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
      'Hire reservation changed its exact current committee approval basis')
    assertWorldMutationSlot(state)
    assertWorldBirthBudget(state, false)
    if (Object.hasOwn(world.reservations, intent.id)
      || existingHiringResourceHolds(state).length > 0
      || Object.values(world.reservations).some(value => value.status !== 'committed' && value.status !== 'abandoned')
      || Object.values(world.external.representatives).some(value => value.status !== 'committed' && value.status !== 'abandoned')) {
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'An original hire or structural change is already retained')
    }
    const capacity = world.definition.positions.find(value => value.entityId === hireIntentRequest(intent).positionEntityId)?.capacity
    if (capacity === undefined || worldPositionUsage(state, hireIntentRequest(intent).positionEntityId) >= capacity) {
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World position capacity is occupied or reserved', 'position')
    }
    const ids = record.identities, limits = state.teamReservation?.creation.limits
    if (state.teamReservation?.confirmed !== true || ids.binding.teamId !== state.teamReservation.teamId || limits === undefined
      || Object.hasOwn(state.entities, ids.entityId) || Object.hasOwn(state.relations, ids.relationId)
      || ids.channels[0].channelId === ids.channels[1].channelId || ids.channels[0].key === ids.channels[1].key
      || ids.channels.some(channel => Object.hasOwn(state.channelReservations ?? {}, channel.key)
        || Object.values(state.channelReservations ?? {}).some(value => value.channelId === channel.channelId))
      || Object.values(state.entities).some((entity) => {
        const binding = entity.binding ?? entity.participantReservation?.binding
        return binding?.participantId === ids.binding.participantId || binding?.sessionId === ids.binding.sessionId
      })) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire identities conflict or frozen Team limits are missing')
    if (Object.values(state.entities).filter(entity => entity.phase !== 'terminated').length + pendingExternalIdentityCapacity(state) >= state.spec.maxEntities)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World hire exceeds Entity capacity', 'entities')
    if (Object.values(state.entities).filter(entity => entity.participantReservation !== undefined
      || entity.binding !== undefined).length + pendingExternalIdentityCapacity(state) >= limits.maxParticipants)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World hire exceeds historical identity capacity', 'participants')
    if (Object.keys(state.channelReservations ?? {}).length + 2 > limits.maxChannels)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World hire exceeds Channel capacity', 'channels')
    if (plan.proposal.resolution.kind !== 'apply' || record.request.member.displayName !== hirePlanPayload(plan).persona.name) {
      throw new SimulationWorldError('SIM_WORLD_TEMPLATE', 'Hire display identity differs from the accepted persona')
    }
    const funded = installHiringResourceReservation(state, plan, record.resourceHold, sequence)
    const reservation: SimulationWorldHireReservation = { id: intent.id, requestId: request.id, request: record.request,
      ...record.resourceHold === undefined ? {} : { resourceReservationId: record.resourceHold.id },
      identities: ids, approvals, reservedAt: state.time, sequence, updatedSequence: sequence, status: 'reserved' }
    return { ...funded, world: { ...world, reservations: { ...world.reservations, [intent.id]: reservation } } }
  }
  const original = requireWorldHire(state, record.id)
  if (record.kind === 'hire/abandoned') return abandon(state, original, record.evidence, sequence, runtime)
  quiescent(state, original)
  assertWorldMutationSlot(state, original.id)
  assertWorldBirthBudget(state, false, original.id)
  const { intent, plan } = requireWorldHireApplication(state, original.request.planId, runtime)
  requireHiringResourceReservation(state, plan)
  if (record.kind === 'hire/preparing') {
    if (original.status !== 'reserved') throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Hire preparation requires its unresolved reservation')
    const preparing = { ...original, prepared: { time: state.time, sequence }, status: 'preparing' as const, updatedSequence: sequence }
    let next = foldEntityChange({ ...state, world: { ...world, reservations: { ...world.reservations, [original.id]: preparing } } },
      simulationChangeSchema.parse({ kind: 'entity/create', id: original.identities.entityId,
        entityKind: 'person', cognition: 'agent', readiness: 'preparing', profile: profile(state, original) }))
    const entity = next.entities[original.identities.entityId]
    if (entity === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire preparing Entity is missing')
    const { modelVersion: _version, ...participant } = original.request.member
    next = { ...next, entities: { ...next.entities, [entity.id]: { ...entity,
      participantReservation: { binding: original.identities.binding, participant } } } }
    const channels = { ...next.channelReservations }
    for (const [index, spec] of specs(state, original).entries()) {
      const identity = original.identities.channels[index]
      if (identity === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire channel identity is missing')
      channels[spec.key] = { channelId: identity.channelId, spec, confirmed: false }
    }
    return { ...next, channelReservations: channels, world: { ...world, reservations: { ...world.reservations,
      [original.id]: preparing } } }
  }
  const reviewedMarket = world.definition.operations.some(pin => pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef)
  if (record.kind === 'hire/candidate-ready') {
    if (!reviewedMarket || original.status !== 'preparing')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Candidate readiness requires original reviewed preparation')
    const person = state.entities[original.identities.entityId]
    if (person?.readiness !== 'preparing' || !isDeepStrictEqual(person.binding, original.identities.binding)
      || !isDeepStrictEqual(person.profile, profile(state, original))
      || specs(state, original).some(spec => state.channelReservations?.[spec.key]?.confirmed !== true))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Candidate readiness requires confirmed original identity and channels')
    const candidate = { time: state.time, sequence, maintenance: simulationMaintenanceRequestSchema.parse({
      id: `world-candidate-commit:${original.id}`, owner: original.request.maintenance.owner }) }
    const directorChannel = original.identities.channels[0].channelId
    const requested = hireIntentRequest(intent)
    const permission = simulationRelationIdSchema.parse(`world-candidate-permission:${original.id}`)
    const confirmed: SimulationSnapshot = { ...state, world: { ...world, reservations: { ...world.reservations,
      [original.id]: { ...original, status: 'candidate', candidate, updatedSequence: sequence } } } }
    let next = foldEntityChange(confirmed, simulationChangeSchema.parse({ kind: 'entity/readiness', id: person.id,
      entityRevision: person.revision, readiness: 'ready' }))
    for (const [id, relation, object] of [[`world-candidate-eligibility:${original.id}`, 'eligible-for-hire', requested.organizationEntityId],
      [permission, 'can-market', requested.positionEntityId]]) next = foldEntityChange(next, simulationChangeSchema.parse({
      kind: 'relation/create', id, subject: person.id, relation, object, scope: requested.organizationEntityId, validFrom: state.time, validUntil: null }))
    return { ...next, world: { ...world, channels: { ...world.channels, [person.id]: directorChannel },
      reservations: { ...world.reservations, [original.id]: { ...original, status: 'candidate', candidate, updatedSequence: sequence } },
      personnel: { ...world.personnel, operationGrants: [...world.personnel.operationGrants, { requesterEntityId: person.id,
        domain: 'organization', operation: 'hiring-market', version: '1', scopeEntityId: requested.organizationEntityId,
        targetEntityId: requested.positionEntityId, relation: 'can-market', relationId: permission }] } } }
  }
  if (reviewedMarket && (original.status !== 'candidate' || !hasAcceptedHiringOffer(state, plan.id)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Reviewed generated hiring requires its independent candidate acceptance')
  if (original.status !== 'preparing' && original.status !== 'candidate') throw new SimulationWorldError('SIM_WORLD_CONFLICT',
    'Hire commit requires proven preparation without cancellation')
  requireHireApproval(state, intent, plan, original.approvals)
  const entity = state.entities[original.identities.entityId]
  if (entity?.phase !== 'active' || entity.readiness !== (original.candidate === undefined ? 'preparing' : 'ready') || !isDeepStrictEqual(entity.binding, original.identities.binding)
    || !isDeepStrictEqual(entity.profile, profile(state, original))
    || specs(state, original).some(spec => state.channelReservations?.[spec.key]?.confirmed !== true
      || !isDeepStrictEqual(state.channelReservations[spec.key]?.spec, spec))) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire commit lacks its exact canonical identity, persona or confirmed channels')
  }
  const capacity = world.definition.positions.find(value => value.entityId === hireIntentRequest(intent).positionEntityId)?.capacity
  if (capacity === undefined || worldPositionUsage(state, hireIntentRequest(intent).positionEntityId, original.id) >= capacity) {
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'World position capacity changed before commit', 'position')
  }
  const directorChannel = original.identities.channels.find(value => value.purpose === 'director')
  if (directorChannel === undefined || world.channels[entity.id] !== undefined && world.channels[entity.id] !== directorChannel.channelId)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hire commit cannot substitute its original confirmed private director Channel')
  let next: SimulationSnapshot = { ...commitHiringResourceReservation(state, plan, sequence),
    world: { ...world, channels: { ...world.channels, [entity.id]: directorChannel.channelId }, reservations: { ...world.reservations,
      [original.id]: { ...original, status: 'committed', updatedSequence: sequence } } } }
  next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'relation/create', id: original.identities.relationId,
    subject: entity.id, relation: 'assignment', object: hireIntentRequest(intent).positionEntityId,
    scope: hireIntentRequest(intent).organizationEntityId, validFrom: state.time, validUntil: null }))
  if (entity.readiness !== 'ready') next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'entity/readiness', id: entity.id,
    entityRevision: entity.revision, readiness: 'ready' }))
  return withWorldResult(next, { id: worldResultIdentity(intent.id), requestId: original.requestId, intentId: intent.id,
    source: { kind: 'plan', planId: original.request.planId }, outcome: { kind: 'committed' }, payload: { entityId: entity.id,
      relationId: original.identities.relationId }, time: state.time, sequence }, runtime)
}

/**
 * Verify every retained identity/capacity obligation and its atomic assignment/result/first-wake relationship.
 * @param state - Complete accepted or replayed Native projection; intermediate append records are not published.
 */
export function assertWorldHireProjection(state: SimulationSnapshot): void {
  const world = state.world
  if (world === undefined) return
  for (const position of world.definition.positions) {
    if (worldPositionUsage(state, position.entityId) > position.capacity) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World occupied and reserved positions exceed capacity')
    }
  }
  const entities = new Set<string>(), participants = new Set<string>(), sessions = new Set<string>(), channels = new Set<string>()
  for (const [id, stored] of Object.entries(world.reservations)) {
    const reservation = simulationWorldHireReservationSchema.parse(stored), ids = reservation.identities
    const request = world.requests[reservation.requestId], plan = world.plans[reservation.request.planId]
    if (id !== reservation.id || request?.intentId !== reservation.id || plan?.requestId !== request.id
      || plan.proposal.resolution.kind !== 'apply' || reservation.status === 'committed' && plan.status !== 'accepted'
      || reservation.sequence > reservation.updatedSequence || reservation.updatedSequence > state.revision
      || entities.has(ids.entityId) || participants.has(ids.binding.participantId) || sessions.has(ids.binding.sessionId)
      || ids.binding.teamId !== state.teamReservation?.teamId || ids.channels.some(value => channels.has(value.channelId))) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World hire lost its accepted plan, identities or transition order')
    }
    entities.add(ids.entityId); participants.add(ids.binding.participantId); sessions.add(ids.binding.sessionId)
    for (const channel of ids.channels) channels.add(channel.channelId)
    const entity = state.entities[ids.entityId]
    if ((reservation.status === 'reserved' || reservation.status === 'abandoned' && reservation.cleanup === undefined && reservation.candidate === undefined)
      && entity !== undefined
      || Object.values(state.entities).some(other => other.id !== ids.entityId
        && (other.binding?.participantId === ids.binding.participantId
          || other.participantReservation?.binding.participantId === ids.binding.participantId
          || other.binding?.sessionId === ids.binding.sessionId
          || other.participantReservation?.binding.sessionId === ids.binding.sessionId))) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World future identity was reused outside its original preparation')
    }
    if ((reservation.status === 'preparing' || reservation.status === 'cancel-requested')
      && (entity?.cognition !== 'agent' || entity.phase !== 'active' || entity.readiness !== 'preparing'
        || !isDeepStrictEqual(entity.profile, profile(state, reservation))
        || entity.writer !== undefined && entity.writer.phase !== 'released')) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World preparing or cancelled identity acquired ordinary execution')
    }
    if (reservation.status === 'preparing' || reservation.status === 'candidate' || reservation.status === 'cancel-requested' || reservation.status === 'committed'
      || reservation.cleanup !== undefined) {
      const { modelVersion: _version, ...member } = reservation.request.member
      if (!isDeepStrictEqual(entity?.participantReservation, { binding: ids.binding, participant: member })
        || specs(state, reservation).some(spec => !isDeepStrictEqual(state.channelReservations?.[spec.key]?.spec, spec)
          || state.channelReservations?.[spec.key]?.channelId !== ids.channels.find(channel => channel.key === spec.key)?.channelId)) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
          'World prepared hire lost its exact reserved identities or private memberships')
      }
    }
    if (reservation.candidate !== undefined && (entity?.readiness !== 'ready' || entity.phase !== 'active'
      || !isDeepStrictEqual(entity.binding, ids.binding) || !isDeepStrictEqual(entity.profile, profile(state, reservation))
      || reservation.candidate.sequence > reservation.updatedSequence
      || reservation.candidate.maintenance.id !== `world-candidate-commit:${reservation.id}`
      || reservation.candidate.maintenance.owner !== reservation.request.maintenance.owner))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Independent candidate lost its original confirmed identity or commit owner')
    if (reservation.status === 'cancel-requested' && (request.status !== 'cancel-requested'
      || !Object.values(world.cancellations).some(command => command.request.requestId === request.id
        && command.status === 'cancel-requested'))) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cancelled preparation lost its original unresolved cancellation command')
    }
    if (reservation.status === 'abandoned') {
      const result = world.results[worldResultIdentity(reservation.id)]
      if (request.status !== 'cancelled' || result?.outcome.kind !== 'cancelled' || result.sequence !== reservation.updatedSequence
        || state.relations[ids.relationId] !== undefined
        || Object.values(state.scheduledEvents).some(event => event.id === `simulation-world-first:${reservation.id}`)) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
          'World abandoned reservation lost its sole cancellation result or acquired hiring effects')
      }
      if (reservation.candidate !== undefined) {
        if (entity?.readiness !== 'ready' || !isDeepStrictEqual(entity.binding, ids.binding))
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Cancelled candidate must retain its original independent identity')
      } else if (reservation.cleanup === undefined) {
        if (ids.channels.some(channel => state.channelReservations?.[channel.key] !== undefined)) {
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World unprepared abandonment acquired retained preparation identities')
        }
      } else {
        const cleanup = reservation.cleanup
        cleanupIdentity(state, reservation, cleanup.evidence)
        if (entity?.cognition !== 'agent' || entity.phase !== 'terminated' || entity.readiness !== 'abandoned'
          || !isDeepStrictEqual(entity.profile, profile(state, reservation))
          || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, ids.binding)
          || entity.writer !== undefined) {
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
            'World cleaned identity lost its original persona, abandoned readiness or terminated lifecycle')
        }
        const earlier = Object.values(world.cancellations).filter(command => command.request.requestId === request.id
          && command.sequence < cleanup.sequence).sort((first, second) => first.sequence - second.sequence)
        if (result.source.kind !== 'cancel' || earlier[0]?.request.id !== result.source.commandId
          || earlier.some((command, index) => command.resultId !== result.id
            || command.status !== (index === 0 ? 'cancelled' : 'already-resolved'))) {
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World cleanup changed its original cancellation order or command receipts')
        }
      }
    }
    if (reservation.status === 'committed') {
      if (entity === undefined || !isDeepStrictEqual(entity.profile, profile(state, reservation))) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Committed World hire lost its original accepted Persona')
      }
      const result = world.results[worldResultIdentity(reservation.id)], relation = state.relations[ids.relationId]
      const intent = world.intents[reservation.id]
      const wake = Object.values(state.scheduledEvents).find(value => value.id === `simulation-world-first:${reservation.id}`)
      if (request.status !== 'committed' || result?.outcome.kind !== 'committed' || hireResultPayload(result).entityId !== ids.entityId
        || hireResultPayload(result).relationId !== ids.relationId || result.sequence !== reservation.updatedSequence
        || entity.readiness !== 'ready' || !isDeepStrictEqual(entity.binding, ids.binding)
        || relation?.subject !== ids.entityId || intent === undefined || relation.object !== hireIntentRequest(intent).positionEntityId
        || relation.scope !== hireIntentRequest(intent).organizationEntityId || relation.relation !== 'assignment'
          || relation.validFrom !== result.time
        || wake?.action.kind !== 'wake' || wake.action.entityId !== ids.entityId || wake.key.time !== result.time
        || wake.action.reason !== JSON.stringify({ resultId: result.id })) {
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'World hire has partial assignment, readiness, result or first action')
      }
    }
  }
}
