import { assertAcceptedWorldPlanSource } from './world-management.ts'
/** Declared position authority follows only a completed Native assignment, never preparation or a model-selected role. */
import { isDeepStrictEqual } from 'node:util'
import { simulationChangeSchema, simulationRelationIdSchema, SimulationWorldError,
  simulationWorldHirePayloadSchema, simulationWorldHireExistingPayloadSchema,
  simulationWorldHireCommittedResultPayloadSchema, simulationWorldTransferPayloadSchema,
  simulationWorldTransferCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, WorldIntentId, SimulationWorldOperationGrant } from '@clocky/clocky-simulation'
import { foldEntityChange } from './entities.ts'

function deny(): never {
  throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Position authority lost its original committed assignment, result or declaration')
}
/**
 * Install the frozen position mapping after the same business record establishes its actual committed result.
 * @param state - Complete prospective Native business fold, including its assignment and result.
 * @param id - Original accepted hiring or transfer intent; other domain results confer no role authority.
 * @param sequence - Actual commit record sequence, shared with the retained business result.
 * @returns the pure prospective role directory and relations, or the unchanged exact historical installation.
 */
export function installWorldRolePermissions(state: SimulationSnapshot, id: WorldIntentId, sequence: number): SimulationSnapshot {
  const world = state.world, intent = world?.intents[id]
  if (!world || !intent) return deny()
  if (intent.pin.domain !== 'organization' || !['generate-and-hire', 'hire-existing',
    'transfer'].includes(intent.pin.operation)) return state
  const request = intent.requestId === undefined ? undefined : world.requests[intent.requestId]
  const result = Object.values(world.results).find(value => value.intentId === id)
  const plan = result?.source.kind === 'plan' ? world.plans[result.source.planId] : undefined
  if (request?.status !== 'committed' || result?.outcome.kind !== 'committed' || result.sequence !== sequence
    || result.requestId !== request.id || result.time !== state.time || plan?.status !== 'accepted'
    || plan.requestId !== request.id || request.plans.at(-1) !== plan.id || plan.proposal.resolution.kind !== 'apply'
    || !isDeepStrictEqual(plan.pin, intent.pin) || !world.definition.operations.some(value => isDeepStrictEqual(value,
    plan.pin))) return deny()
  assertAcceptedWorldPlanSource(state, plan)
  let personId: import('@clocky/clocky-simulation').SimulationEntityId
  let assignmentId: import('@clocky/clocky-simulation').SimulationRelationId
  let positionId: import('@clocky/clocky-simulation').SimulationEntityId
  let scopeId: import('@clocky/clocky-simulation').SimulationEntityId
  if (intent.pin.operation === 'generate-and-hire') {
    const payload = simulationWorldHirePayloadSchema.parse(intent.payload)
    const output = simulationWorldHireCommittedResultPayloadSchema.parse(result.payload), owned = world.reservations[id]
    if (owned?.status !== 'committed' || owned.updatedSequence !== sequence || owned.requestId !== request.id
      || owned.request.planId !== plan.id || owned.identities.entityId !== output.entityId
      || owned.identities.relationId !== output.relationId
      || !isDeepStrictEqual(state.entities[output.entityId]?.binding, owned.identities.binding)) return deny()
    personId = output.entityId; assignmentId = output.relationId
    positionId = payload.positionEntityId; scopeId = payload.organizationEntityId
  } else if (intent.pin.operation === 'hire-existing') {
    const payload = simulationWorldHireExistingPayloadSchema.parse(intent.payload)
    const output = simulationWorldHireCommittedResultPayloadSchema.parse(result.payload)
    const mutation = Object.values(world.mutations).find(value => value.id === `world-mutation:${plan.id}`)
    if (output.entityId !== payload.personId || output.relationId !== `world-existing-assignment:${id}`
      || mutation?.planId !== plan.id || mutation.sequence !== sequence || mutation.requestId !== request.id
      || !isDeepStrictEqual(mutation.payload, plan.proposal.resolution.payload)) return deny()
    personId = output.entityId; assignmentId = output.relationId
    positionId = payload.positionEntityId; scopeId = payload.organizationEntityId
  } else {
    const payload = simulationWorldTransferPayloadSchema.parse(intent.payload)
    const output = simulationWorldTransferCommittedResultPayloadSchema.parse(result.payload), owned = world.personnel.reservations[id]
    if (owned?.status !== 'committed' || owned.updatedSequence !== sequence || owned.personId !== output.entityId
      || owned.personId !== payload.personId || owned.targetPositionId !== output.targetPositionId
      || output.targetPositionId !== payload.targetPositionId || output.newAssignmentId !== `world-transfer-assignment:${id}`
      || output.closedAssignmentId !== payload.assignmentId
      || state.relations[payload.assignmentId]?.validUntil !== result.time) return deny()
    personId = output.entityId; assignmentId = output.newAssignmentId
    positionId = output.targetPositionId; scopeId = payload.organizationEntityId
  }
  const assignment = state.relations[assignmentId], person = state.entities[personId]
  if (assignment?.relation !== 'assignment' || assignment.subject !== personId || assignment.object !== positionId
    || assignment.scope !== scopeId || assignment.validFrom !== result.time || assignment.validUntil !== null
    || person?.kind !== 'person' || person.cognition !== 'agent' || person.readiness !== 'ready' || person.phase !== 'active'
    || person.binding?.teamId !== state.teamReservation?.teamId || state.teamReservation?.confirmed !== true
    || !world.definition.positions.some(value => value.entityId === positionId)) return deny()
  const permissions = world.definition.positionRolePermissions.find(value => value.positionEntityId === positionId)?.permissions ?? []
  const expected = permissions.map((permission, index): SimulationWorldOperationGrant => {
    if (!world.definition.operations.some(value => value.domain === permission.domain && value.operation === permission.operation
      && value.version === permission.version)) return deny()
    return { requesterEntityId: personId, domain: permission.domain, operation: permission.operation, version: permission.version,
      scopeEntityId: permission.scopeEntityId, targetEntityId: permission.targetEntityId, relation: permission.relation,
      relationId: simulationRelationIdSchema.parse(`world-role-authority:${id}:${index}`) }
  })
  const retained = expected.map(value => world.personnel.operationGrants.filter(grant => grant.relationId === value.relationId))
  const relations = expected.map(value => state.relations[value.relationId])
  if (retained.some(values => values.length > 0) || relations.some(value => value !== undefined)) {
    if (!retained.every((values, index) => values.length === 1 && isDeepStrictEqual(values[0], expected[index]))
      || !relations.every((value, index) => value?.subject === personId && value.object === expected[index]?.targetEntityId
        && value.scope === expected[index].scopeEntityId && value.relation === expected[index].relation
        && value.validFrom === result.time)) return deny()
    return state
  }
  let next = state
  for (const grant of expected) next = foldEntityChange(next, simulationChangeSchema.parse({ kind: 'relation/create', id: grant.relationId,
    subject: personId, object: grant.targetEntityId, scope: grant.scopeEntityId, relation: grant.relation,
    validFrom: result.time, validUntil: null }))
  return { ...next, world: { ...world, personnel: { ...world.personnel,
    operationGrants: [...world.personnel.operationGrants, ...expected] } } }
}
