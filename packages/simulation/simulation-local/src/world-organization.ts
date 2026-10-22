import { hiringMarket, WORLD_HIRING_MARKET_PIN, validateWorldHiringEnvelope } from '@clocky/clocky-simulation'
import { worldRoleRequester } from '@clocky/clocky-simulation'
import { assertHiringRequestPolicy } from './world-hire-approval.ts'
import { worldOperationGrants, currentWorldOperationGrants } from '@clocky/clocky-simulation'
import { z } from 'zod'
import { effectiveNorms } from '@clocky/clocky-simulation'
/** Pure hiring policy over Native facts; canonical identity preparation remains a separate Native capability. */
import { isDeepStrictEqual } from 'node:util'
import { WORLD_GENERATE_AND_HIRE_DEFINITION, WORLD_GENERATE_AND_HIRE_PIN, simulationWorldHirePayloadSchema,
  simulationHireIntentRequestSchema, simulationWorldHirePlanPayloadSchema, simulationWorldReadSetSchema,
  simulationChangeSchema, simulationWorldHireCommittedResultPayloadSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationEntityId,
  SimulationWorldDomainRequest, SimulationWorldBusinessResolution, SimulationWorldPlan, SimulationWorldJsonValue,
  SimulationWorldResult } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import { hiringFee, hiringResourceReads } from './world-hiring-resources.ts'

/**
 * Recover hiring business fields only through its installed strict payload parser.
 * @param intent - Original generic business intent with the exact hiring operation pin.
 * @returns owner-validated hiring fields, without a model-selected requester.
 */
export function hireIntentRequest(intent: SimulationWorldIntent): import('@clocky/clocky-simulation').SimulationHireIntentRequest {
  if (!isDeepStrictEqual(intent.pin, WORLD_GENERATE_AND_HIRE_PIN))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring requires its original installed operation')
  const payload = simulationWorldHirePayloadSchema.parse(intent.payload)
  return simulationHireIntentRequestSchema.parse({ organizationEntityId: payload.organizationEntityId,
    positionEntityId: payload.positionEntityId, requesterEntityId: worldRoleRequester(intent),
    applicationId: intent.businessKey, ...payload.priorRequestId === undefined ? {} : { priorRequestId: payload.priorRequestId } })
}

/**
 * Parse an original hiring apply payload before reading Persona fields.
 * @param plan - Exact recorded generic plan.
 * @returns strict selected hiring content; rejects other domain or non-apply plans.
 */
export function hirePlanPayload(plan: SimulationWorldPlan): z.infer<typeof simulationWorldHirePlanPayloadSchema> {
  if (!isDeepStrictEqual(plan.pin, WORLD_GENERATE_AND_HIRE_PIN) || plan.proposal.resolution.kind !== 'apply')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring requires its original apply plan')
  return simulationWorldHirePlanPayloadSchema.parse(plan.proposal.resolution.payload)
}

function world(state: SimulationSnapshot) {
  if (state.world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Hiring requires a configured World')
  return state.world
}
function authorization(state: SimulationSnapshot, intent: SimulationWorldIntent) {
  const request = hireIntentRequest(intent)
  const grant = worldOperationGrants(state).find(value => value.requesterEntityId === worldRoleRequester(request)
    && value.domain === 'organization' && value.operation === 'generate-and-hire' && value.version === '1'
    && value.relation === 'can-hire' && value.targetEntityId === request.positionEntityId && value.scopeEntityId === request.organizationEntityId)
  const relation = grant === undefined ? undefined : state.relations[grant.relationId]
  if (relation === undefined || relation.subject !== worldRoleRequester(request) || relation.object !== request.positionEntityId
    || relation.scope !== request.organizationEntityId || relation.relation !== 'can-hire'
    || BigInt(relation.validFrom) > BigInt(state.time)
    || relation.validUntil !== null && BigInt(relation.validUntil) <= BigInt(state.time))
    throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Hiring has no current authoritative permission relation')
  return relation
}

/** Registered synchronous hiring business rules; every append and canonical IO remains Native-owned. */
export class OrganizationNativeWorldDomain implements NativeWorldDomain {
  // This operation addresses its requester and non-person scope/target; it accepts no additional existing person.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }

  readonly definition = WORLD_GENERATE_AND_HIRE_DEFINITION
  readonly ref = WORLD_GENERATE_AND_HIRE_PIN.implementationRef
  readonly generation = WORLD_GENERATE_AND_HIRE_PIN.generation

  goalContext(state: SimulationSnapshot, actorId: SimulationEntityId) {
    const positions = new Set(currentWorldOperationGrants(state, actorId, WORLD_GENERATE_AND_HIRE_PIN)
      .map(({ grant }) => grant.targetEntityId))
    return z.json().parse({ hiringFees: (world(state).definition.hiringFees ?? []).filter(value =>
      value.operation === 'generate-and-hire' && positions.has(value.positionEntityId)) })
  }

  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    const owned = world(state), payload = simulationWorldHirePayloadSchema.parse(request.payload)
    try { validateWorldHiringEnvelope(request) }
    catch { throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Installed hiring supports the next safe boundary without supplemental evidence') }
    if (payload.organizationEntityId !== owned.definition.organizationEntityId
      || !owned.definition.positions.some(value => value.entityId === payload.positionEntityId))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring references another organization or position')
    const organization = state.entities[payload.organizationEntityId], position = state.entities[payload.positionEntityId]
    if (organization?.kind !== 'organization' || organization.phase !== 'active' || organization.cognition !== 'none'
      || position?.kind !== 'position' || position.phase !== 'active' || position.cognition !== 'none')
      throw new SimulationWorldError('SIM_WORLD_AUTHORITY', 'Hiring requires its active organization and noncognitive position')
    assertHiringRequestPolicy(state, payload.organizationEntityId, payload.positionEntityId)
    const original = Object.values(owned.intents).find(value => value.pin.domain === request.domain
      && value.pin.operation === request.operation && value.businessKey === request.businessKey)
    const cases = Object.values(owned.requests).filter(value => value.sequence < (original?.sequence ?? Infinity)
      && value.pin.domain === request.domain
      && value.pin.operation === request.operation && value.requesterEntityId === actorId)
      .filter(value => simulationWorldHirePayloadSchema.parse(value.proposal.payload).positionEntityId === payload.positionEntityId)
      .sort((a, b) => b.sequence - a.sequence)
    const insufficient = (id: string | undefined) => Object.values(owned.results).some(value => value.requestId === id
      && value.outcome.kind === 'rejected' && value.outcome.reason === 'insufficient-information')
    if (payload.priorRequestId !== undefined && !cases.some(value => value.id === payload.priorRequestId && insufficient(value.id)))
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Resubmission requires its original insufficient-information rejection')
    if (insufficient(cases[0]?.id) && payload.priorRequestId !== cases[0]?.id)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Resubmission must reference the latest insufficient-information rejection')
    return { scopeEntityId: payload.organizationEntityId, targetEntityId: payload.positionEntityId,
      description: payload.description, payload: z.json().parse(payload) }
  }

  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const owned = world(state), request = hireIntentRequest(intent)
    return z.json().parse({ application: { ...request, description: intent.description },
      position: owned.definition.positions.find(value => value.entityId === request.positionEntityId) ?? null,
      templates: owned.definition.templates, policyVersion: owned.definition.policyVersion,
      ...owned.definition.operations.some(pin => pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef) ? {
        acceptedDrafts: [...hiringMarket(state).drafts.values()].filter(value => value.status === 'accepted'
          && value.organizationEntityId === intent.scopeEntityId && value.positionEntityId === intent.targetEntityId)
          .map(value => ({ id: value.id, revision: value.revision, bodyHash: value.bodyHash, body: value.body })),
      } : {},
      hiringFee: hiringFee(state, intent) ?? null })
  }

  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'reject') return
    const selected = simulationWorldHirePlanPayloadSchema.parse(resolution.payload)
    const reviewed = world(state).definition.operations.some(pin => pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef)
    const reference = selected.personaDraft, draft = reference === undefined ? undefined : hiringMarket(state).drafts.get(reference.id)
    if (reviewed ? reference === undefined || draft?.status !== 'accepted' || draft.revision !== reference.revision
      || draft.bodyHash !== reference.bodyHash || draft.organizationEntityId !== intent.scopeEntityId
      || draft.positionEntityId !== intent.targetEntityId || !isDeepStrictEqual(draft.body,
      { templateId: selected.templateId, templateVersion: selected.templateVersion, persona: selected.persona })
      : reference !== undefined)
      throw new SimulationWorldError('SIM_WORLD_TEMPLATE', 'Generated hire requires its exact accepted Persona draft reference and birth content')
    const template = world(state).definition.templates.find(value => value.id === selected.templateId
      && value.version === selected.templateVersion)
    if (template === undefined || !template.names.includes(selected.persona.name)
      || (['skills', 'traits', 'goals'] as const).some(key => selected.persona[key].some(value => !template[key].includes(value))))
      throw new SimulationWorldError('SIM_WORLD_TEMPLATE', 'Selected Persona exceeds the original finite template')
  }

  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const request = hireIntentRequest(intent), position = state.entities[request.positionEntityId], grant = authorization(state, intent)
    if (position?.phase !== 'active' || position.cognition !== 'none')
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring position is unavailable')
    const assignments = Object.values(state.relations).filter(value => value.relation === 'assignment'
      && value.object === request.positionEntityId && value.scope === request.organizationEntityId
      && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time)))
      .map(value => ({ id: value.id, revision: value.revision })).sort((a, b) => a.id.localeCompare(b.id))
    return simulationWorldReadSetSchema.parse([
      ...hiringResourceReads(state, intent),
      { kind: 'entity', id: position.id, revision: position.revision },
      { kind: 'relation', id: grant.id, revision: grant.revision, effectiveFrom: grant.validFrom, effectiveUntil: grant.validUntil },
      { kind: 'relation-set', relation: 'assignment', object: position.id, scope: request.organizationEntityId,
        hash: businessFingerprint(assignments) },
      ...effectiveNorms(state, request.organizationEntityId, state.time, state.revision)
        .filter(value => value.enforcement.kind === 'validated').map(value => ({ kind: 'norm' as const,
          id: value.id, version: value.version })),
    ])
  }

  firstActionActor(_state: SimulationSnapshot, _intent: SimulationWorldIntent, result: SimulationWorldResult) {
    return result.outcome.kind === 'committed'
      ? hireResultPayload(result).entityId : undefined
  }

  resultContext(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult,
    purpose: 'result' | 'first-action') {
    if (result.outcome.kind !== 'committed') return undefined
    const payload = hireResultPayload(result)
    const owned = world(state), request = hireIntentRequest(intent), reservation = owned.reservations[intent.id]
    const entity = state.entities[payload.entityId], relation = state.relations[payload.relationId]
    const plan = reservation === undefined ? undefined : owned.plans[reservation.request.planId]
    if (reservation?.status !== 'committed' || reservation.identities.entityId !== payload.entityId
      || reservation.identities.relationId !== payload.relationId || entity?.readiness !== 'ready' || entity.cognition !== 'agent'
      || !isDeepStrictEqual(entity.binding, reservation.identities.binding) || relation?.relation !== 'assignment'
      || relation.subject !== entity.id || relation.object !== request.positionEntityId || relation.scope !== request.organizationEntityId
      || relation.validFrom !== result.time || plan === undefined)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring result lost its original committed identity and assignment')
    const channel = reservation.identities.channels[1], retained = state.channelReservations?.[channel.key]
    if (retained?.confirmed !== true || retained.channelId !== channel.channelId)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring result lost its original requester Channel')
    const selected = hirePlanPayload(plan), template = owned.definition.templates.find(value => value.id === selected.templateId
      && value.version === selected.templateVersion)
    if (template === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring result lost its original template')
    return { expectedActorId: purpose === 'result' ? worldRoleRequester(intent) : entity.id,
      recipient: purpose === 'result' ? entity.id : worldRoleRequester(intent), channelId: channel.channelId,
      facts: { newcomer: { entityId: entity.id, persona: selected.persona, description: template.description,
        assignment: { relationId: relation.id, organizationEntityId: relation.scope, positionEntityId: relation.object,
          validFrom: relation.validFrom } } } }
  }

  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    const owned = world(state), reservation = owned.reservations[intent.id], request = hireIntentRequest(intent)
    const parsed = this.definition.schemas.mutation.parse(payload)
    if (reservation?.status !== 'preparing' || reservation.request.planId !== plan.id
      || reservation.request.maintenance.id !== parsed.maintenanceId)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Hiring mutation requires its original prepared canonical identity')
    const entity = state.entities[reservation.identities.entityId]
    if (entity === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Hiring mutation lost its original entity')
    return { changes: [simulationChangeSchema.parse({ kind: 'relation/create', id: reservation.identities.relationId,
      subject: entity.id, relation: 'assignment', object: request.positionEntityId, scope: request.organizationEntityId,
      validFrom: state.time, validUntil: null }), simulationChangeSchema.parse({ kind: 'entity/readiness', id: entity.id,
      entityRevision: entity.revision, readiness: 'ready' })],
    resultPayload: { entityId: entity.id, relationId: reservation.identities.relationId } }
  }
}

/** Pure result projection is held with the original hiring implementation. */

/**
 * Parse a committed hiring result through its exact registered safe schema.
 * @param result - Original recorded committed hiring result.
 * @returns strictly parsed original identity references; other dispositions reject.
 */
export function hireResultPayload(result: SimulationWorldResult): { entityId: SimulationEntityId
  relationId: import('@clocky/clocky-simulation').SimulationRelationId } {
  if (result.outcome.kind !== 'committed')
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Committed hiring result requires its original identity references')
  return simulationWorldHireCommittedResultPayloadSchema.parse(result.payload)
}
