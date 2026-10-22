import { assertRepresentationAdmission } from './world-representation-access.ts'
import { worldRolePlanOperationId, worldRoleRequester } from '@clocky/clocky-simulation'
import { assertWorldMutationSlot, assertWorldBirthBudget } from './world-structure-budget.ts'
import { businessFingerprint } from './business.ts'
/** Native-owned simulated representative preparation; all canonical IO remains outside these synchronous folds. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_ACTOR_DEFINITION, WORLD_EXTERNAL_MEDIATED_PIN,
  simulationExternalMediatedRequestSchema, simulationExternalMediatedPlanSchema, simulationExternalAdjudicationSchema,
  simulationExternalMediatedResultSchema,
  simulationExternalActorRequestSchema,
  simulationExternalActorPlanSchema, simulationExternalActorResultSchema, simulationExternalIdentitySchema,
  simulationExternalRepresentativeReservationSchema, simulationExternalContactSchema, simulationWorldFinitePersonaSelectionSchema,
  simulationWorldIdentityCleanupEvidenceSchema, simulationExternalContactCleanupEvidenceSchema,
  simulationWorldHireReserveRequestSchema, simulationWorldHireIdentitiesSchema,
  worldIntentIdSchema, simulationChangeSchema, simulationWorldReadSetSchema, worldPlanIdSchema, activeSimulationMaintenance,
  SimulationWorldError } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan, SimulationEntityId,
  SimulationWorldDomainRequest, SimulationWorldBusinessResolution, SimulationWorldJsonValue, SimulationExternalRepresentativeReservation,
  SimulationWorldResult, SimulationExternalState, SimulationChannelSpec, SimulationExternalContact, SimulationWorldIdentityCleanupEvidence,
  SimulationWorldIdentityChannelCleanup, SimulationChannelReservation, WorldIntentId,
  SimulationExternalContactCleanupEvidence } from '@clocky/clocky-simulation'
import { requireWorld, worldExecutionReads, withWorldResult, worldResultIdentity } from './world.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
import { externalIdentityId } from './world-external.ts'
import { prepareExternalRepresentativeAdjudication, verifyExternalRepresentativeAdjudication,
  externalAdjudicationResult } from './world-external-mediated.ts'
import { foldEntityChange } from './entities.ts'

/** Only original identities and pure lifecycle transitions are admitted from the durable stream. */
export const externalRepresentativeRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('external/reserved'), request: simulationWorldHireReserveRequestSchema,
    identities: simulationWorldHireIdentitiesSchema, adjudication: simulationExternalAdjudicationSchema.optional() }),
  z.strictObject({ kind: z.literal('external/contact-reserved'), planId: worldPlanIdSchema,
    channel: simulationExternalContactSchema.shape.channel }),
  z.strictObject({ kind: z.literal('external/contact-committed'), id: worldIntentIdSchema }),
  z.strictObject({ kind: z.literal('external/contact-cancelled'), id: worldIntentIdSchema,
    evidence: simulationExternalContactCleanupEvidenceSchema }),
  z.strictObject({ kind: z.literal('external/preparing'), id: worldIntentIdSchema }),
  z.strictObject({ kind: z.literal('external/abandoned'), id: worldIntentIdSchema,
    evidence: simulationWorldIdentityCleanupEvidenceSchema }),
  z.strictObject({ kind: z.literal('external/committed'), id: worldIntentIdSchema }),
])
/** Parsed canonical preparation transition; it carries no caller-selected resource effect. */
export type ExternalRepresentativeRecord = z.infer<typeof externalRepresentativeRecordSchema>

function input(state: SimulationSnapshot, payload: unknown) {
  const body = simulationExternalActorRequestSchema.parse(payload), subject = state.entities[body.subjectRef], world = requireWorld(state)
  if (body.scope !== world.definition.organizationEntityId || body.subjectRef === body.scope || subject?.kind !== 'organization'
    || subject.cognition !== 'none' || subject.phase !== 'active' || subject.readiness !== 'ready')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative requires its original active noncognitive external organization')
  const identity = world.external.identities[externalIdentityId(state, body)]
  assertRepresentationAdmission(state, body.subjectRef, externalIdentityId(state, body), 'simulated-actor')
  const representative = Object.values(world.external.representatives).find(value => value.identityId === externalIdentityId(state, body)
    && value.status !== 'abandoned')
  const shared = representative !== undefined && representative.adjudication !== undefined
    && committedMediatedRepresentative(state, representative)
  if (identity !== undefined && (identity.subjectRef !== body.subjectRef || identity.representation !== 'simulated-actor' && !shared)
    || representative?.adjudication !== undefined && !shared)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Actor2 may only explicitly reuse an actually committed original mediated representative')
  return body
}
/**
 * Retain the actor policy identity in its actual request acceptance, without allocating a person.
 * @param state - Actual accepted request prefix.
 * @param intent - Original Native-derived actor intent.
 * @param requestId - Original accepted contact case.
 * @param sequence - Exact request position.
 * @returns stable identity table; different display names never allocate another identity.
 */
export function acceptExternalActorIdentity(state: SimulationSnapshot, intent: SimulationWorldIntent,
  requestId: SimulationWorldPlan['requestId'], sequence: number): SimulationExternalState {
  if (!isDeepStrictEqual(intent.pin, WORLD_EXTERNAL_ACTOR_PIN)) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Actor identity lost its exact operation')
  const body = input(state, intent.payload), external = requireWorld(state).external, id = externalIdentityId(state, body)
  if (external.identities[id] !== undefined) return external
  const identity = simulationExternalIdentitySchema.parse({ id, scope: body.scope, externalKey: body.externalKey,
    subjectRef: body.subjectRef, revision: 1, representation: 'simulated-actor', policyRef: body.policyRef,
    source: { kind: 'request', requestId }, sequence })
  return bounded(state, { ...external, identities: { ...external.identities, [id]: identity } })
}
function bounded(state: SimulationSnapshot, external: SimulationExternalState): SimulationExternalState {
  if (Buffer.byteLength(JSON.stringify(external), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Representative identity and preparation history exceeds its byte allowance', 'bytes')
  return external
}
/**
 * Require the exact latest accepted actor plan and unchanged actual grants/reads before preparation or commit.
 * @param state - Authoritative current prefix.
 * @param planId - Original accepted plan, never a replacement generated payload.
 * @param runtime - Original pinned pure domain implementation.
 * @returns original intent/plan/request; stale, cancelled and unaccepted work rejects.
 */
export function requireExternalActorApplication(state: SimulationSnapshot, planId: SimulationWorldPlan['id'],
  runtime?: NativeWorldRuntime): { plan: SimulationWorldPlan; intent: SimulationWorldIntent; request: import('@clocky/clocky-simulation').SimulationWorldRequest } {
  const world = requireWorld(state), plan = world.plans[planId], request = plan === undefined ? undefined : world.requests[plan.requestId]
  const intent = request === undefined ? undefined : world.intents[request.intentId]
  const operation = plan === undefined ? undefined : state.operations[worldRolePlanOperationId(plan)]
  if (plan?.status !== 'accepted' || plan.proposal.resolution.kind !== 'apply' || request?.status !== 'open'
    || request.plans.at(-1) !== plan.id || intent === undefined || !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_ACTOR_PIN)
      && !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN)
    || operation === undefined || state.decisions[operation.decisionId]?.status !== 'accepted')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative requires its latest accepted open apply plan')
  if (!isDeepStrictEqual(plan.reads, worldExecutionReads(state, intent, runtime)))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative original authorization or read set changed')
  return { plan, intent, request }
}
function quiescent(state: SimulationSnapshot, value: SimulationExternalRepresentativeReservation): void {
  const owner = activeSimulationMaintenance(state)
  if (owner?.status !== 'quiescent' || !isDeepStrictEqual(owner.request, value.request.maintenance)
    || state.phase !== 'paused' || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released'))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative requires its exact proven-quiescent maintenance owner')
}
/**
 * Read only an original persistent representative preparation.
 * @param state - Current authoritative state.
 * @param id - Original business intent.
 * @returns exact canonical reservation; absent history rejects.
 */
export function requireExternalRepresentative(state: SimulationSnapshot,
  id: SimulationWorldIntent['id']): SimulationExternalRepresentativeReservation {
  const value = requireWorld(state).external.representatives[id]
  if (value === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative original reservation is missing')
  return value
}

function applicationInput(state: SimulationSnapshot, intent: SimulationWorldIntent) {
  if (isDeepStrictEqual(intent.pin, WORLD_EXTERNAL_ACTOR_PIN)) return input(state, intent.payload)
  if (!isDeepStrictEqual(intent.pin, WORLD_EXTERNAL_MEDIATED_PIN)) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Representative has a different original operation')
  return simulationExternalMediatedRequestSchema.parse(intent.payload)
}
function applicationPreparation(plan: SimulationWorldPlan) {
  if (plan.proposal.resolution.kind !== 'apply') throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Representative lost its original apply plan')
  if (isDeepStrictEqual(plan.pin,
    WORLD_EXTERNAL_ACTOR_PIN)) return simulationWorldFinitePersonaSelectionSchema.parse(plan.proposal.resolution.payload)
  if (!isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN)) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Representative has a different original operation')
  const selected = simulationExternalMediatedPlanSchema.parse(plan.proposal.resolution.payload)
  if (selected.outcome.kind !== 'representative-preparation-plan') throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Mediated Actor requires its original finite preparation plan')
  return selected.outcome.preparation
}

function profile(state: SimulationSnapshot, value: SimulationExternalRepresentativeReservation) {
  const world = requireWorld(state), plan = world.plans[value.request.planId]
  if (plan?.proposal.resolution.kind !== 'apply') throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Representative lost its accepted Persona')
  const selected = applicationPreparation(plan)
  const template = world.definition.templates.find(candidate =>
    candidate.id === selected.templateId && candidate.version === selected.templateVersion)
  if (template === undefined) throw new SimulationWorldError('SIM_WORLD_TEMPLATE', 'Representative lost its original finite template')
  return { name: selected.persona.name, description: template.description, persona: selected.persona }
}
/**
 * Derive original private memberships without adding historical director or buyer messages.
 * @param state - Original canonical world and requester.
 * @param value - Complete retained allocation.
 * @returns exact two new private Channel specifications.
 */
export function externalRepresentativeChannels(state: SimulationSnapshot,
  value: SimulationExternalRepresentativeReservation): SimulationChannelSpec[] {
  const world = requireWorld(state), intent = world.intents[value.id]
  if (intent === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative lost its original requester')
  return value.identities.channels.map(channel => ({ key: channel.key, limits: {}, members: [
    { entityId: value.identities.entityId, role: 'member' },
    { entityId: channel.purpose === 'director' ? world.definition.directorEntityId : worldRoleRequester(intent), role: channel.purpose },
  ] }))
}
/**
 * Count original allocated people still absent from the Entity book; preparing entries are already counted by that book.
 * @param state - Authoritative current projection.
 * @returns charged future identities across both generated-hire and representative preparation.
 */
export function pendingExternalIdentityCapacity(state: SimulationSnapshot): number {
  return Object.values(state.world?.external.representatives ?? {}).filter(value => value.status === 'reserved'
    && state.entities[value.identities.entityId] === undefined).length
}
/**
 * Admit only the original withdrawn preparation under its proven quiescent maintenance owner.
 * @param state - Authoritative current prefix.
 * @param value - Original uncommitted representative and allocation.
 */
export function assertExternalRepresentativeCancellationAdmission(state: SimulationSnapshot,
  value: SimulationExternalRepresentativeReservation): void {
  if (value.status !== 'cancel-requested' || requireWorld(state).requests[value.requestId]?.status !== 'cancel-requested')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Representative cleanup requires its original pending cancellation')
  quiescent(state, value)
}
function cleanupIdentity(state: SimulationSnapshot, value: SimulationExternalRepresentativeReservation,
  evidence: SimulationWorldIdentityCleanupEvidence): void {
  if (!isDeepStrictEqual(evidence.binding, value.identities.binding)
    || evidence.channels.some((channel, index) => channel.channelId !== value.identities.channels[index]?.channelId)
    || evidence.participant === 'absent' && state.entities[value.identities.entityId]?.binding !== undefined
    || evidence.channels.some((channel, index) => {
      const original = value.identities.channels[index]
      return channel.phase === 'absent' && original !== undefined && state.channelReservations?.[original.key]?.confirmed === true
    })) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative cleanup lost original confirmed topology or identity history')
}
function abandonRepresentative(state: SimulationSnapshot, value: SimulationExternalRepresentativeReservation,
  evidence: SimulationWorldIdentityCleanupEvidence, sequence: number, runtime?: NativeWorldRuntime): SimulationSnapshot {
  assertExternalRepresentativeCancellationAdmission(state, value)
  cleanupIdentity(state, value, evidence)
  const world = requireWorld(state), entity = state.entities[value.identities.entityId]
  const { modelVersion: _version, ...participant } = value.request.member
  if (entity?.cognition !== 'agent' || entity.phase !== 'active' || entity.readiness !== 'preparing' || entity.writer !== undefined
    || !isDeepStrictEqual(entity.profile, profile(state, value))
    || !isDeepStrictEqual(entity.participantReservation, { binding: value.identities.binding, participant })
    || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, value.identities.binding)
    || state.relations[value.identities.relationId] !== undefined || world.external.contacts[value.id] !== undefined
    || externalRepresentativeChannels(state, value).some((spec, index) => {
      const original = value.identities.channels[index], channel = state.channelReservations?.[spec.key]
      return channel?.channelId !== original?.channelId || !isDeepStrictEqual(channel?.spec, spec)
    })) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative cancellation lost original preparing Persona or topology')
  const commands = Object.values(world.cancellations).filter(command => command.request.requestId === value.requestId
    && command.status === 'cancel-requested').sort((a, b) => a.sequence - b.sequence)
  const first = commands[0]
  if (first === undefined || first.sequence >= sequence)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative cleanup has no original earlier cancellation command')
  const abandoned = { ...value, status: 'abandoned' as const, updatedSequence: sequence, cleanup: { sequence, evidence } }
  let next: SimulationSnapshot = { ...state, world: { ...world, external: bounded(state, { ...world.external,
    representatives: { ...world.external.representatives, [value.id]: abandoned } }) } }
  next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'entity/readiness', id: entity.id,
    entityRevision: entity.revision, readiness: 'abandoned' }))
  next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'entity/phase', id: entity.id,
    entityRevision: entity.revision + 1, phase: 'terminated' }))
  const resultId = worldResultIdentity(value.id)
  next = withWorldResult(next, { id: resultId, intentId: value.id, requestId: value.requestId,
    source: { kind: 'cancel', commandId: first.request.id }, outcome: { kind: 'cancelled' }, payload: {},
    time: state.time, sequence }, runtime)
  const cancellations = { ...world.cancellations }
  for (const command of commands) cancellations[command.request.id] = { ...command, resultId,
    status: command.request.id === first.request.id ? 'cancelled' : 'already-resolved' }
  return { ...next, world: { ...requireWorld(next), cancellations } }
}
/**
 * Locate proven cleanup for an original abandoned Person; confirmed identities are never recycled.
 * @param state - Full retained Native prefix.
 * @param entityId - Exact original preparation identity.
 * @returns cancelled original reservation after its terminal cross-owner proof is retained.
 */
export function externalRepresentativeCleanupReservation(state: SimulationSnapshot,
  entityId: SimulationEntityId): SimulationExternalRepresentativeReservation | undefined {
  return Object.values(state.world?.external.representatives ?? {}).find(value => value.status === 'abandoned'
    && value.cleanup !== undefined && value.identities.entityId === entityId)
}
/**
 * Read an original Channel's terminal cleanup without treating unconfirmed IO as absence.
 * @param state - Authoritative retained cleanup.
 * @param channel - Exact Native reservation under inspection.
 * @returns original terminal/absence proof, or undefined while responsibility remains unresolved.
 */
export function externalRepresentativeChannelCleanup(state: SimulationSnapshot,
  channel: SimulationChannelReservation): SimulationWorldIdentityChannelCleanup | undefined {
  for (const value of Object.values(state.world?.external.representatives ?? {})) {
    if (value.status !== 'abandoned' || value.cleanup === undefined) continue
    for (const [index, selected] of value.identities.channels.entries()) {
      if (selected.key === channel.spec.key && selected.channelId === channel.channelId)
        return value.cleanup.evidence.channels[index]
    }
  }
}
/**
 * Fold one original reserve/preparing/commit as Native truth, with no model, Team or resource IO.
 * @param state - Previous authoritative prefix.
 * @param record - Strict original transition and identity allocation.
 * @param sequence - Exact append position.
 * @param runtime - Original held domain implementation.
 * @returns complete atomic projection; representation commit never changes the external subject or its accounts/contracts.
 */
export function foldExternalRepresentative(state: SimulationSnapshot, record: ExternalRepresentativeRecord, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state)
  if (Buffer.byteLength(JSON.stringify({ kind: 'run/external-representative', runId: state.spec.runId,
    expectedRevision: sequence - 1, change: record }), 'utf8') > world.definition.limits.maxBytesPerPlan)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete representative transition exceeds its byte allowance', 'bytes')
  if (record.kind === 'external/contact-cancelled') return abandonExternalContact(state, record.id, record.evidence, sequence, runtime)
  if (record.kind === 'external/contact-reserved' || record.kind === 'external/contact-committed')
    return foldExternalContact(state, record, sequence, runtime)
  if (record.kind === 'external/reserved') {
    const { plan, intent, request } = requireExternalActorApplication(state, record.request.planId, runtime)
    const body = applicationInput(state, intent), identityId = externalIdentityId(state, body), ids = record.identities
    const prior = Object.values(world.external.representatives).find(value => value.identityId === identityId
      && value.status !== 'abandoned')
    if (prior !== undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'External identity already retains its original representative generation')
    assertWorldMutationSlot(state)
    assertWorldBirthBudget(state, true)
    if (state.activeWindowId !== undefined || activeSimulationMaintenance(state) !== undefined
      || Object.values(world.reservations).some(value => value.status !== 'committed' && value.status !== 'abandoned')
      || Object.values(world.external.representatives).some(value => value.status !== 'committed' && value.status !== 'abandoned')
      || Object.values(world.personnel.reservations).some(value => value.status !== 'committed' && value.status !== 'cancelled'))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Another structural responsibility or decision window is occupied')
    const limits = state.teamReservation?.creation.limits
    const selected = applicationPreparation(plan)
    if (record.request.member.displayName !== selected.persona.name || state.teamReservation?.confirmed !== true
      || ids.binding.teamId !== state.teamReservation.teamId || limits === undefined || state.entities[ids.entityId] !== undefined
      || state.relations[ids.relationId] !== undefined || ids.channels[0].channelId === ids.channels[1].channelId
      || ids.channels[0].key === ids.channels[1].key || ids.channels.some(channel => state.channelReservations?.[channel.key] !== undefined
        || Object.values(state.channelReservations ?? {}).some(value => value.channelId === channel.channelId))
      || Object.values(state.entities).some((entity) => {
        const binding = entity.binding ?? entity.participantReservation?.binding
        return binding?.participantId === ids.binding.participantId || binding?.sessionId === ids.binding.sessionId
      })) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative allocation conflicts with canonical identity history')
    if (Object.values(state.entities).filter(value => value.phase !== 'terminated').length + pendingExternalIdentityCapacity(state) >= state.spec.maxEntities)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Representative Entity capacity is occupied', 'entities')
    if (Object.values(state.entities).filter(value => value.binding !== undefined || value.participantReservation !== undefined).length
      + pendingExternalIdentityCapacity(state) >= limits.maxParticipants)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Representative historical Participant capacity is occupied', 'participants')
    if (Object.keys(state.channelReservations ?? {}).length + 2 > limits.maxChannels)
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Representative Channel capacity is occupied', 'channels')
    const mediated = isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN)
    if (mediated) {
      const expected = prepareExternalRepresentativeAdjudication(state, plan.id, sequence, record.adjudication?.recordedAt ?? -1)
      if (!isDeepStrictEqual(record.adjudication, expected)) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
        'Mediated reservation lost its original adjudication')
    } else if (record.adjudication !== undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
      'Actor2 cannot carry mediated adjudication')
    const reservation = simulationExternalRepresentativeReservationSchema.parse({ id: intent.id, identityId, generation: 1,
      ...record.adjudication === undefined ? {} : { adjudication: record.adjudication },
      requestId: request.id, request: record.request, identities: ids, reservedAt: state.time, status: 'reserved', sequence, updatedSequence: sequence })
    return { ...state, world: { ...world, external: bounded(state, { ...world.external,
      representatives: { ...world.external.representatives, [intent.id]: reservation } }) } }
  }
  const original = requireExternalRepresentative(state, record.id)
  if (record.kind === 'external/abandoned') return abandonRepresentative(state, original, record.evidence, sequence, runtime)
  quiescent(state, original)
  assertWorldMutationSlot(state, original.id)
  assertWorldBirthBudget(state, true, original.id)
  const { plan, intent } = requireExternalActorApplication(state, original.request.planId, runtime), body = applicationInput(state, intent)
  if (record.kind === 'external/preparing') {
    if (original.status !== 'reserved') throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Representative preparation requires its original reservation')
    const preparing = { ...original, prepared: { time: state.time, sequence }, status: 'preparing' as const, updatedSequence: sequence }
    const preparedState = { ...state, world: { ...world, external: { ...world.external,
      representatives: { ...world.external.representatives, [original.id]: preparing } } } }
    let next = foldEntityChange(preparedState, simulationChangeSchema.parse({ kind: 'entity/create', id: original.identities.entityId,
      entityKind: 'person', cognition: 'agent', readiness: 'preparing', profile: profile(state, original) }))
    const entity = next.entities[original.identities.entityId]
    if (entity === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative preparing Person is missing')
    const { modelVersion: _version, ...participant } = original.request.member
    next = { ...next, entities: { ...next.entities, [entity.id]: { ...entity,
      participantReservation: { binding: original.identities.binding, participant } } } }
    const channels = { ...next.channelReservations }
    for (const [index, spec] of externalRepresentativeChannels(state, original).entries()) {
      const channel = original.identities.channels[index]
      if (channel === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative Channel allocation is missing')
      channels[spec.key] = { channelId: channel.channelId, spec, confirmed: false }
    }
    return { ...next, channelReservations: channels, world: { ...world, external: bounded(state, { ...world.external,
      representatives: { ...world.external.representatives, [original.id]: preparing } }) } }
  }
  if (original.adjudication !== undefined) verifyExternalRepresentativeAdjudication(state, original.adjudication, plan.id)
  const entity = state.entities[original.identities.entityId]
  if (original.status !== 'preparing' || entity?.readiness !== 'preparing' || entity.phase !== 'active'
    || !isDeepStrictEqual(entity.binding, original.identities.binding) || !isDeepStrictEqual(entity.profile, profile(state, original))
    || externalRepresentativeChannels(state, original).some((spec, index) => {
      const channel = state.channelReservations?.[spec.key]
      return channel?.confirmed !== true || channel.channelId !== original.identities.channels[index]?.channelId
        || !isDeepStrictEqual(channel.spec, spec)
    })) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Representative lacks its exact Persona, binding or confirmed topology receipts')
  const committedState = { ...state, world: { ...world, external: { ...world.external,
    representatives: { ...world.external.representatives, [original.id]: { ...original, status: 'committed' as const,
      updatedSequence: sequence } } } } }
  let next = foldEntityChange(committedState, simulationChangeSchema.parse({ kind: 'relation/create', id: original.identities.relationId,
    relation: 'represents', subject: entity.id, object: body.subjectRef, scope: body.scope, validFrom: state.time, validUntil: null }))
  next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'entity/readiness', id: entity.id,
    entityRevision: entity.revision, readiness: 'ready' }))
  if (original.adjudication !== undefined) {
    const selected = original.adjudication.proposal.outcome
    if (selected.kind !== 'representative-preparation-plan') throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
      'Mediated reserve lost finite Actor outcome')
    const actual = { identityId: original.identityId, entityId: entity.id, relationId: original.identities.relationId,
      generation: 1 as const, contactUnit: selected.contactUnit, requesterEntityId: worldRoleRequester(intent),
      channelId: original.identities.channels[1].channelId }
    const adjudication = simulationExternalAdjudicationSchema.parse({ ...original.adjudication, actualActor: { ...actual,
      committedSequence: sequence } })
    next = { ...next, world: { ...requireWorld(next), external: bounded(state, { ...world.external,
      representatives: { ...world.external.representatives, [original.id]: { ...original, status: 'committed',
        updatedSequence: sequence } },
      adjudications: { ...world.external.adjudications, [intent.id]: adjudication },
      contacts: { ...world.external.contacts, [intent.id]: { id: intent.id, identityId: original.identityId,
        representativeIntentId: original.id, generation: 1, requestId: original.requestId, planId: plan.id,
        requesterEntityId: worldRoleRequester(intent), channel: { key: original.identities.channels[1].key,
          channelId: original.identities.channels[1].channelId }, status: 'committed', sequence, updatedSequence: sequence } } }) } }
    return withWorldResult(next, { id: worldResultIdentity(intent.id), intentId: intent.id, requestId: original.requestId,
      source: { kind: 'plan', planId: plan.id }, outcome: { kind: 'committed' }, time: state.time, sequence,
      payload: externalAdjudicationResult(next, adjudication, actual) }, runtime)
  }
  if (body.sourceKind !== 'simulated-actor') throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'Mediated representative lost its actual adjudication')
  next = { ...next, world: { ...requireWorld(next), external: bounded(state, { ...world.external,
    representatives: { ...world.external.representatives, [original.id]: { ...original, status: 'committed', updatedSequence: sequence } },
    contacts: { ...world.external.contacts, [intent.id]: { id: intent.id, identityId: original.identityId,
      representativeIntentId: original.id, generation: 1, requestId: original.requestId, planId: plan.id,
      requesterEntityId: worldRoleRequester(intent), channel: { key: original.identities.channels[1].key,
        channelId: original.identities.channels[1].channelId }, status: 'committed', sequence, updatedSequence: sequence } } }) } }
  return withWorldResult(next, { id: worldResultIdentity(intent.id), intentId: intent.id, requestId: original.requestId,
    source: { kind: 'plan', planId: plan.id }, outcome: { kind: 'committed' }, time: state.time, sequence,
    payload: { identityId: original.identityId, subjectRef: body.subjectRef, generation: 1, entityId: entity.id,
      requesterEntityId: worldRoleRequester(intent), channelId: original.identities.channels[1].channelId,
      relationId: original.identities.relationId, sourceKind: 'simulated-actor', unit: body.input.unit } }, runtime)
}
/**
 * Resolve one retained generation by stable external key; display names and current requester are irrelevant.
 * @param state - Authoritative native table.
 * @param body - Strict original scoped contact payload.
 * @returns existing non-abandoned allocation, whether reserved, preparing or ready.
 */
export function externalRepresentativeFor(state: SimulationSnapshot,
  body: z.infer<typeof simulationExternalActorRequestSchema>): SimulationExternalRepresentativeReservation | undefined {
  const id = externalIdentityId(state, body)
  return Object.values(requireWorld(state).external.representatives).find(value => value.identityId === id && value.status !== 'abandoned')
}
function representationAllocation(state: SimulationSnapshot, intent: SimulationWorldIntent,
  body: z.infer<typeof simulationExternalActorRequestSchema>) {
  const value = externalRepresentativeFor(state, body)
  // The creator owns its own preparatory transitions; competing cases must retain or explicitly replan against that allocation.
  return value === undefined || value.id === intent.id ? null : { id: value.id, identityId: value.identityId,
    generation: value.generation, identities: value.identities }
}
function committedMediatedRepresentative(state: SimulationSnapshot, value: SimulationExternalRepresentativeReservation): boolean {
  const world = requireWorld(state), record = world.external.adjudications[value.id], actual = record?.actualActor
  const plan = world.plans[value.request.planId], entity = state.entities[value.identities.entityId]
  const relation = state.relations[value.identities.relationId]
  if (value.status !== 'committed' || value.adjudication === undefined || actual === undefined || record === undefined
    || !isDeepStrictEqual(plan?.pin, WORLD_EXTERNAL_MEDIATED_PIN) || record.identityId !== value.identityId
    || record.intentId !== value.id || record.planId !== value.request.planId || record.requestId !== value.requestId
    || !isDeepStrictEqual({ ...record, actualActor: undefined }, { ...value.adjudication, actualActor: undefined })
    || actual.entityId !== value.identities.entityId || actual.relationId !== value.identities.relationId
    || actual.channelId !== value.identities.channels[1].channelId || actual.committedSequence !== value.updatedSequence
    || entity?.phase !== 'active' || entity.cognition !== 'agent' || entity.readiness !== 'ready'
    || !isDeepStrictEqual(entity.binding, value.identities.binding) || !isDeepStrictEqual(entity.profile, profile(state, value))
    || relation?.relation !== 'represents' || relation.subject !== entity.id || relation.object !== record.request.subjectRef
    || relation.scope !== record.request.scope || BigInt(relation.validFrom) > BigInt(state.time)
    || relation.validUntil !== null && BigInt(relation.validUntil) <= BigInt(state.time)) return false
  verifyExternalRepresentativeAdjudication(state, value.adjudication, value.request.planId, false)
  return externalRepresentativeChannels(state, value).every((spec, index) => {
    const channel = state.channelReservations?.[spec.key]
    return channel?.confirmed === true && channel.channelId === value.identities.channels[index]?.channelId
      && isDeepStrictEqual(channel.spec, spec)
  })
}
function readyRepresentative(state: SimulationSnapshot, value: SimulationExternalRepresentativeReservation): void {
  const entity = state.entities[value.identities.entityId]
  if (value.status !== 'committed' || entity?.phase !== 'active' || entity.cognition !== 'agent' || entity.readiness !== 'ready'
    || !isDeepStrictEqual(entity.binding, value.identities.binding))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original representative generation is not ready; retain the accepted reuse plan')
}
/**
 * Derive only the original caller's conversation, without granting another caller's Channel history.
 * @param state - Current canonical requester and represented identity.
 * @param contact - Original case-to-generation reservation.
 * @returns exact canonical Channel specification.
 */
export function externalContactChannel(state: SimulationSnapshot, contact: SimulationExternalContact): SimulationChannelSpec {
  const value = requireWorld(state).external.representatives[contact.representativeIntentId]
  if (value === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact lost its original representation generation')
  return { key: contact.channel.key, limits: {}, members: [
    { entityId: value.identities.entityId, role: 'member' }, { entityId: contact.requesterEntityId, role: 'requester' },
  ] }
}
/**
 * Require the exact contact withdrawal under its original quiescent maintenance.
 * @param state - Current authoritative Native prefix.
 * @param contact - Original withdrawn conversation reservation.
 * @returns nothing when the original owner and all writers are quiescent; unresolved responsibility rejects.
 */
export function assertExternalContactCancellationAdmission(state: SimulationSnapshot, contact: SimulationExternalContact): void {
  const world = requireWorld(state), owner = activeSimulationMaintenance(state)
  if (contact.status !== 'cancel-requested' || contact.cancellation === undefined
    || world.requests[contact.requestId]?.status !== 'cancel-requested'
    || owner?.status !== 'quiescent' || !isDeepStrictEqual(owner.request, contact.cancellation.maintenance)
    || state.phase !== 'paused' || state.activeWindowId !== undefined || state.activeDecisionId !== undefined
    || Object.values(state.entities).some(entity => entity.writer !== undefined && entity.writer.phase !== 'released'))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact cleanup requires its original withdrawal and quiescent maintenance')
}
/**
 * Pick another existing original lease; cancellation never creates a replacement keeper.
 * @param state - Current authoritative contact history.
 * @param contact - Withdrawn original contact whose conversation is inspected.
 * @returns earliest live lease sharing its original caller, representative and canonical channel, if any.
 */
export function externalContactKeeper(state: SimulationSnapshot,
  contact: SimulationExternalContact): SimulationExternalContact | undefined {
  return Object.values(requireWorld(state).external.contacts).filter(other => other.id !== contact.id
    && other.identityId === contact.identityId && other.representativeIntentId === contact.representativeIntentId
    && other.requesterEntityId === contact.requesterEntityId && isDeepStrictEqual(other.channel, contact.channel)
    && (other.status === 'reserved' || other.status === 'committed'))
    .sort((a, b) => a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
}
function abandonExternalContact(state: SimulationSnapshot, id: WorldIntentId, evidence: SimulationExternalContactCleanupEvidence,
  sequence: number, runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state), contact = world.external.contacts[id]
  if (contact === undefined) throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original contact cancellation is not retained')
  assertExternalContactCancellationAdmission(state, contact)
  const channel = state.channelReservations?.[contact.channel.key], keeper = externalContactKeeper(state, contact)
  if (evidence.channel.channelId !== contact.channel.channelId || channel?.channelId !== contact.channel.channelId
    || !isDeepStrictEqual(channel.spec, externalContactChannel(state, contact))
    || evidence.channel.phase === 'absent' && channel.confirmed)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup lost original canonical channel history')
  if (evidence.kind === 'retained') {
    if (keeper === undefined || evidence.keeper.id !== keeper.id || evidence.keeper.sequence !== keeper.updatedSequence
      || evidence.keeper.status !== keeper.status || evidence.keeper.sequence >= sequence)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact keeper changed during cleanup; retain the original responsibility')
  } else if (keeper !== undefined) {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact terminal cleanup cannot close another original lease')
  }
  const commands = Object.values(world.cancellations).filter(command => command.request.requestId === contact.requestId
    && command.status === 'cancel-requested').sort((a, b) => a.sequence - b.sequence)
  const first = commands[0]
  if (first === undefined || contact.cancellation?.sequence !== first.sequence)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup lost its earliest original withdrawal')
  const cancelled = { ...contact, status: 'cancelled' as const, updatedSequence: sequence, cleanup: { sequence, evidence } }
  let next: SimulationSnapshot = { ...state, world: { ...world, external: bounded(state, { ...world.external,
    contacts: { ...world.external.contacts, [id]: cancelled } }) } }
  const resultId = worldResultIdentity(id)
  next = withWorldResult(next, { id: resultId, intentId: id, requestId: contact.requestId,
    source: { kind: 'cancel', commandId: first.request.id }, outcome: { kind: 'cancelled' }, payload: {}, time: state.time,
    sequence }, runtime)
  const cancellations = { ...world.cancellations }
  for (const command of commands) cancellations[command.request.id] = { ...command, resultId,
    status: command.request.id === first.request.id ? 'cancelled' : 'already-resolved' }
  return { ...next, world: { ...requireWorld(next), cancellations } }
}
/**
 * Resolve only proven sole-channel terminal cleanup; retained keeper evidence grants no running exception.
 * @param state - Authoritative retained cancellation history.
 * @param channel - Exact original Native channel reservation.
 * @returns terminal or absent cleanup for this channel, or undefined while it remains owned.
 */
export function externalContactChannelCleanup(state: SimulationSnapshot,
  channel: SimulationChannelReservation): SimulationWorldIdentityChannelCleanup | undefined {
  for (const contact of Object.values(state.world?.external.contacts ?? {})) {
    const evidence = contact.cleanup?.evidence
    if (contact.status === 'cancelled' && evidence?.kind === 'terminal'
      && contact.channel.key === channel.spec.key && contact.channel.channelId === channel.channelId)
      return evidence.channel
  }
  return undefined
}

function foldExternalContact(state: SimulationSnapshot,
  record: Extract<ExternalRepresentativeRecord, { kind: 'external/contact-reserved' | 'external/contact-committed' }>,
  sequence: number, runtime?: NativeWorldRuntime): SimulationSnapshot {
  const world = requireWorld(state)
  if (state.activeWindowId !== undefined || activeSimulationMaintenance(state) !== undefined)
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact topology waits for a safe ordinary boundary')
  if (record.kind === 'external/contact-reserved') {
    assertWorldMutationSlot(state)
    const { plan, intent, request } = requireExternalActorApplication(state, record.planId, runtime)
    const selected = simulationExternalActorPlanSchema.parse(plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : null)
    const representative = externalRepresentativeFor(state, input(state, intent.payload))
    if (!('kind' in selected) || representative === undefined || selected.identityId !== representative.identityId
      || world.external.contacts[intent.id] !== undefined)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Contact requires the original explicit reuse disposition')
    readyRepresentative(state, representative)
    if (Object.values(world.external.contacts).some(value => value.identityId === representative.identityId
      && value.requesterEntityId === worldRoleRequester(intent) && value.status === 'cancel-requested'))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Original caller conversation retains pending cancellation responsibility')
    const prior = Object.values(world.external.contacts).find(value => value.identityId === representative.identityId
      && value.requesterEntityId === worldRoleRequester(intent) && value.status !== 'cancelled')
    if (prior !== undefined && !isDeepStrictEqual(prior.channel, record.channel))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Repeated caller contact changed its canonical Channel')
    const contact = simulationExternalContactSchema.parse({ id: intent.id, identityId: representative.identityId,
      representativeIntentId: representative.id, generation: representative.generation, requestId: request.id,
      planId: plan.id, requesterEntityId: worldRoleRequester(intent), channel: record.channel, status: 'reserved', sequence,
      updatedSequence: sequence })
    const spec = externalContactChannel(state, contact), existing = state.channelReservations?.[spec.key]
    if (prior === undefined && existing !== undefined)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
        'A new contact cannot recycle historical Channel allocation without an original live lease')
    if (existing === undefined && (Object.values(state.channelReservations ?? {}).some(value =>
      value.channelId === contact.channel.channelId)
      || Object.keys(state.channelReservations ?? {}).length >= (state.teamReservation?.creation.limits?.maxChannels ?? 0)))
      throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Contact Channel history is occupied or allocation conflicts', 'channels')
    if (existing !== undefined && (existing.channelId !== contact.channel.channelId || !isDeepStrictEqual(existing.spec, spec)))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact Channel differs from its canonical original membership')
    return { ...state, channelReservations: existing === undefined ? { ...state.channelReservations,
      [spec.key]: { channelId: contact.channel.channelId, spec, confirmed: false } } : state.channelReservations ?? {},
    world: { ...world, external: bounded(state, { ...world.external, contacts: { ...world.external.contacts, [contact.id]: contact } }) } }
  }
  const contact = world.external.contacts[record.id]
  if (contact?.status !== 'reserved') throw new SimulationWorldError('SIM_WORLD_CONFLICT',
    'Contact commit requires its unresolved original reservation')
  const { plan, intent } = requireExternalActorApplication(state, contact.planId, runtime)
  const selected = simulationExternalActorPlanSchema.parse(plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : null)
  const representative = world.external.representatives[contact.representativeIntentId], body = input(state, intent.payload)
  if (!('kind' in selected) || representative === undefined || selected.identityId !== contact.identityId
    || externalIdentityId(state, body) !== contact.identityId || contact.requesterEntityId !== worldRoleRequester(intent))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact commit changed its original case, caller or generation')
  readyRepresentative(state, representative)
  const channel = state.channelReservations?.[contact.channel.key]
  if (channel?.confirmed !== true || channel.channelId !== contact.channel.channelId
    || !isDeepStrictEqual(channel.spec, externalContactChannel(state, contact)))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact lacks original canonical endpoint consent')
  const next = { ...state, world: { ...world, external: bounded(state, { ...world.external,
    contacts: { ...world.external.contacts, [contact.id]: { ...contact, status: 'committed', updatedSequence: sequence } } }) } }
  return withWorldResult(next, { id: worldResultIdentity(intent.id), intentId: intent.id, requestId: contact.requestId,
    source: { kind: 'plan', planId: plan.id }, outcome: { kind: 'committed' }, time: state.time, sequence,
    payload: { identityId: contact.identityId, subjectRef: body.subjectRef, generation: contact.generation,
      entityId: representative.identities.entityId, relationId: representative.identities.relationId,
      requesterEntityId: worldRoleRequester(intent), channelId: contact.channel.channelId, sourceKind: 'simulated-actor',
      unit: body.input.unit } }, runtime)
}
function assertExternalContactProjection(state: SimulationSnapshot): void {
  const world = requireWorld(state), callers = new Map<string, string>()
  for (const [id, stored] of Object.entries(world.external.contacts)) {
    const contact = simulationExternalContactSchema.parse(stored), request = world.requests[contact.requestId]
    const plan = world.plans[contact.planId]
    const representative = world.external.representatives[contact.representativeIntentId]
    if (id !== contact.id || request?.intentId !== contact.id || worldRoleRequester(request) !== contact.requesterEntityId
      || plan?.requestId !== request.id || representative?.identityId !== contact.identityId
      || contact.sequence > contact.updatedSequence || contact.updatedSequence > state.revision)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External conversation lost its original case, caller or generation')
    const key = JSON.stringify([contact.identityId, contact.requesterEntityId]), existing = callers.get(key)
    if (contact.status !== 'cancelled' && existing !== undefined && existing !== contact.channel.channelId)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Same caller acquired a second canonical external conversation')
    if (contact.status !== 'cancelled') callers.set(key, contact.channel.channelId)
    const channel = state.channelReservations?.[contact.channel.key]
    if (channel?.channelId !== contact.channel.channelId || !isDeepStrictEqual(channel.spec, externalContactChannel(state, contact)))
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External conversation lost its private canonical membership')
    if (contact.status === 'cancel-requested') {
      if (request.status !== 'cancel-requested' || contact.cleanup !== undefined
        || !Object.values(world.cancellations).some(command => command.request.requestId === request.id
          && command.status === 'cancel-requested' && command.sequence === contact.cancellation?.sequence))
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact withdrawal lost its original retained cancellation command')
    }
    if (contact.status === 'cancelled') {
      const result = world.results[worldResultIdentity(contact.id)], evidence = contact.cleanup?.evidence
      if (request.status !== 'cancelled' || evidence === undefined || result?.outcome.kind !== 'cancelled'
        || result.sequence !== contact.updatedSequence || contact.cleanup?.sequence !== contact.updatedSequence
        || result.source.kind !== 'cancel')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup lost its atomic original cancellation')
      const first = Object.values(world.cancellations).filter(command => command.request.requestId === contact.requestId)
        .sort((a, b) => a.sequence - b.sequence)[0]
      if (first === undefined || first.sequence !== contact.cancellation?.sequence
        || first.request.id !== result.source.commandId || first.status !== 'cancelled')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Contact cleanup changed its earliest cancellation source')
      if (evidence.kind === 'retained') {
        const keeper = world.external.contacts[evidence.keeper.id]
        if (keeper === undefined || keeper.id === contact.id || keeper.identityId !== contact.identityId
          || keeper.representativeIntentId !== contact.representativeIntentId || keeper.requesterEntityId !== contact.requesterEntityId
          || !isDeepStrictEqual(keeper.channel, contact.channel) || keeper.sequence > evidence.keeper.sequence
          || evidence.keeper.sequence >= contact.updatedSequence || keeper.updatedSequence < evidence.keeper.sequence
          || evidence.keeper.status === 'committed' && keeper.status !== 'committed')
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Retained contact lost its original historical keeper evidence')
      }
    } else if (contact.cleanup !== undefined) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'An executable contact cannot claim released cleanup responsibility')
    }
    if (contact.status === 'committed') {
      const result = world.results[worldResultIdentity(contact.id)]
      if (isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN)) {
        const payload = simulationExternalMediatedResultSchema.parse(result?.payload)
        if (result?.outcome.kind !== 'committed' || request.status !== 'committed' || result.sequence !== contact.updatedSequence
          || contact.id !== representative.id || representative.adjudication === undefined || !('outcome' in payload)
          || payload.outcome.kind !== 'representative-prepared' || payload.outcome.actual.identityId !== contact.identityId
          || payload.outcome.actual.entityId !== representative.identities.entityId
          || payload.outcome.actual.channelId !== contact.channel.channelId
          || payload.outcome.actual.requesterEntityId !== contact.requesterEntityId)
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Mediated original caller lease lost its actual atomic Actor result')
        continue
      }
      const body = simulationExternalActorRequestSchema.parse(request.proposal.payload)
      if (result?.outcome.kind !== 'committed' || result.sequence !== contact.updatedSequence || request.status !== 'committed')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External conversation lost its atomic original result')
      const payload = simulationExternalActorResultSchema.options[0].parse(result.payload)
      if (payload.identityId !== contact.identityId || payload.entityId !== representative.identities.entityId
        || payload.channelId !== contact.channel.channelId || payload.requesterEntityId !== contact.requesterEntityId
        || payload.subjectRef !== body.subjectRef || payload.unit !== body.input.unit)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External conversation result changed caller, Channel or subject')
    }
  }
}

/** Original pure actor policy; common Native authority and canonical preparation remain independent checks. */
export class ExternalActorNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_EXTERNAL_ACTOR_DEFINITION
  readonly ref = WORLD_EXTERNAL_ACTOR_PIN.implementationRef
  readonly generation = WORLD_EXTERNAL_ACTOR_PIN.generation
  readonly acceptedResponsibility = 'external-actor-identity' as const
  // The subject is a noncognitive organization; its future representative is allocated only after an accepted plan.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }
  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    void actorId
    if (request.expectedTime !== null || request.evidence.length) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Representative contact uses its next safe boundary')
    const body = input(state, request.payload)
    return { scopeEntityId: body.scope, targetEntityId: body.subjectRef,
      description: 'Contact a simulated external representative.', payload: z.json().parse(body) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const body = input(state, intent.payload)
    const representative = externalRepresentativeFor(state, body)
    return z.json().parse({ externalActor: body, templates: requireWorld(state).definition.templates,
      representative: representative === undefined ? null : {
        identityId: representative.identityId,
        generation: representative.generation, entityId: representative.identities.entityId,
        intentId: representative.id, status: representative.status } })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'reject') return
    const selected = simulationExternalActorPlanSchema.parse(resolution.payload)
    const representative = externalRepresentativeFor(state, input(state, intent.payload))
    if ('kind' in selected) {
      if (representative === undefined || selected.identityId !== representative.identityId
        || representative.status === 'cancel-requested')
        throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Reuse plan requires its original retained representative generation')
      return
    }
    if (representative !== undefined && representative.id !== intent.id)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT',
        'External identity already has an original generation; replan explicitly to reuse it')
    const template = requireWorld(state).definition.templates.find(value =>
      value.id === selected.templateId && value.version === selected.templateVersion)
    if (template === undefined || !template.names.includes(selected.persona.name)
      || (['skills', 'traits', 'goals'] as const).some(key => selected.persona[key].some(value => !template[key].includes(value))))
      throw new SimulationWorldError('SIM_WORLD_TEMPLATE', 'Representative Persona exceeds its original finite template')
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const body = input(state, intent.payload), subject = state.entities[body.subjectRef]
    if (subject === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative external subject is missing')
    return simulationWorldReadSetSchema.parse([{ kind: 'entity', id: subject.id, revision: subject.revision },
      { kind: 'external', id: externalIdentityId(state, body), revision: 1 },
      { kind: 'external-representation', id: externalIdentityId(state, body),
        hash: businessFingerprint(representationAllocation(state, intent, body)) }])
  }
  resultContext(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult,
    purpose: 'result' | 'first-action') {
    if (result.outcome.kind !== 'committed' || purpose !== 'result') return undefined
    const world = requireWorld(state), contact = world.external.contacts[intent.id]
    const original = contact === undefined ? undefined : world.external.representatives[contact.representativeIntentId]
    const payload = simulationExternalActorResultSchema.options[0].parse(result.payload)
    if (contact?.status !== 'committed' || original?.status !== 'committed' || contact.requesterEntityId !== worldRoleRequester(intent)
      || contact.channel.channelId !== payload.channelId || original.identities.entityId !== payload.entityId
      || original.identityId !== payload.identityId || state.entities[payload.entityId]?.readiness !== 'ready')
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative contact lost its committed original identity')
    return { expectedActorId: worldRoleRequester(intent), recipient: payload.entityId, channelId: contact.channel.channelId,
      facts: { externalContact: { identityId: payload.identityId, subjectRef: payload.subjectRef,
        representativeEntityId: payload.entityId, unit: payload.unit } } }
  }
  reduceMutation(_state: SimulationSnapshot, _intent: SimulationWorldIntent, _plan: SimulationWorldPlan,
    _payload: SimulationWorldJsonValue): never {
    throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Representative execution requires original canonical preparation and its Native owner')
  }
}
/**
 * Verify original reservations and committed Person/represents/result relationships at reopen and checkpoint.
 * @param state - Fully replayed authoritative prefix.
 * @returns nothing when original Persona, allocation, binding and history are intact; missing evidence rejects.
 */
export function assertExternalRepresentativeProjection(state: SimulationSnapshot): void {
  if (state.world === undefined) return
  const world = state.world, seen = new Set<string>()
  assertExternalContactProjection(state)
  for (const [id, stored] of Object.entries(world.external.representatives)) {
    const value = simulationExternalRepresentativeReservationSchema.parse(stored), intent = world.intents[value.id]
    const request = world.requests[value.requestId], plan = world.plans[value.request.planId]
    const entity = state.entities[value.identities.entityId]
    if (id !== value.id || intent === undefined || request?.intentId !== value.id || plan?.requestId !== request.id
      || !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_ACTOR_PIN) && !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN)
      || value.identityId !== externalIdentityId(state, applicationInput(state, intent))
      || isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN) !== (value.adjudication !== undefined)
      || seen.has(value.identityId) && value.status !== 'abandoned' || value.sequence > value.updatedSequence
        || value.updatedSequence > state.revision)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative lost its original unique allocation or accepted plan')
    if (value.status !== 'abandoned') seen.add(value.identityId)
    if (value.status !== 'reserved' && value.status !== 'abandoned') {
      const { modelVersion: _version, ...expectedMember } = value.request.member
      if (entity?.cognition !== 'agent' || entity.phase !== 'active' || !isDeepStrictEqual(entity.profile, profile(state, value))
        || !isDeepStrictEqual(entity.participantReservation?.binding, value.identities.binding)
        || !isDeepStrictEqual(entity.participantReservation?.participant, expectedMember)
        || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, value.identities.binding)
        || value.status !== 'committed' && (entity.readiness !== 'preparing' || entity.writer !== undefined
          && entity.writer.phase !== 'released'))
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
          'Representative lost its original preparing identity or acquired premature cognition')
    }
    if (value.status === 'abandoned') {
      const result = world.results[worldResultIdentity(value.id)]
      if (result?.outcome.kind !== 'cancelled' || request.status !== 'cancelled'
        || state.relations[value.identities.relationId] !== undefined || world.external.contacts[value.id] !== undefined)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Abandoned representative acquired effects or lost its cancellation result')
      if (value.cleanup === undefined) {
        if (entity !== undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
          'Reserved abandonment cannot conceal a prepared identity')
      } else {
        const { sequence, evidence } = value.cleanup
        const { modelVersion: _version, ...expectedMember } = value.request.member
        cleanupIdentity(state, value, evidence)
        if (sequence !== value.updatedSequence || sequence !== result.sequence || sequence <= value.sequence
          || entity?.readiness !== 'abandoned' || entity.phase !== 'terminated' || entity.cognition !== 'agent'
          || entity.writer !== undefined || !isDeepStrictEqual(entity.profile, profile(state, value))
          || !isDeepStrictEqual(entity.participantReservation?.binding, value.identities.binding)
           || !isDeepStrictEqual(entity.participantReservation?.participant, expectedMember)
          || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, value.identities.binding))
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
            'Representative cleanup lost terminal original identity or sequence evidence')
        const first = Object.values(world.cancellations).filter(command => command.request.requestId === value.requestId
          && command.sequence < sequence).sort((a, b) => a.sequence - b.sequence)[0]
        if (result.source.kind !== 'cancel' || first?.request.id !== result.source.commandId || first.status !== 'cancelled')
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative cleanup changed its original cancellation source')
      }
    } else if (value.cleanup !== undefined) {
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Unsettled representative cannot carry released cleanup evidence')
    }
    if (value.status === 'committed') {
      const relation = state.relations[value.identities.relationId], result = world.results[worldResultIdentity(value.id)]
      const body = applicationInput(state, intent)
      const contact = world.external.contacts[value.id]
      if (entity?.readiness !== 'ready' || relation?.relation !== 'represents' || relation.subject !== value.identities.entityId
        || relation.object !== body.subjectRef || relation.scope !== body.scope || result?.outcome.kind !== 'committed'
        || result.sequence !== value.updatedSequence || request.status !== 'committed')
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative lost its atomic representation and result')
      if (value.adjudication !== undefined) {
        verifyExternalRepresentativeAdjudication(state, value.adjudication, plan.id, false)
        const record = world.external.adjudications[value.id], actual = record?.actualActor
        if (record === undefined || actual === undefined || actual.entityId !== value.identities.entityId
          || actual.relationId !== value.identities.relationId || actual.committedSequence !== result.sequence
          || !isDeepStrictEqual(result.payload, externalAdjudicationResult(state, record, {
            identityId: actual.identityId, entityId: actual.entityId, relationId: actual.relationId, generation: actual.generation,
            contactUnit: actual.contactUnit, requesterEntityId: actual.requesterEntityId, channelId: actual.channelId })))
          throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Mediated representative lost actual atomic adjudication and result')
        continue
      }
      if (body.sourceKind !== 'simulated-actor') throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
        'Mediated representative lost its retained source')
      const outcome = simulationExternalActorResultSchema.options[0].parse(result.payload)
      if (outcome.identityId !== value.identityId || outcome.entityId !== value.identities.entityId
        || outcome.relationId !== value.identities.relationId || outcome.channelId !== contact?.channel.channelId
        || outcome.requesterEntityId !== worldRoleRequester(intent)
        || outcome.subjectRef !== body.subjectRef || outcome.unit !== body.input.unit
        || relation.validFrom !== result.time)
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Representative result changed its original participant, subject or contact')
    }
  }
}
