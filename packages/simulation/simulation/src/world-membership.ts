import { candidateMembership, WORLD_HIRING_MARKET_PIN } from './world-hiring-market.ts'
/** Current scope authority is independent of the historical time selected for content. */
import type { SimulationWorldOperationGrant } from './world-types.ts'
import type { SimulationWorldDomainPin } from './world-domain-types.ts'
import type { SimulationDecision } from './business-types.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationRelation } from './entity-types.ts'
import type { SimulationEntityId } from './identities.ts'

/**
 * Select current organizational assignments with live canonical endpoints.
 * @param state - Authoritative Native prefix at which access is being decided.
 * @param viewer - Actual reader or requester; profile text does not grant membership.
 * @param scope - Original organizational scope.
 * @returns current assignments; historical content queries do not restore expired membership.
 */
export function currentWorldAssignments(state: SimulationSnapshot, viewer: SimulationEntityId,
  scope: SimulationEntityId): readonly SimulationRelation[] {
  const reader = Object.hasOwn(state.entities, viewer) ? state.entities[viewer] : undefined
  const organization = Object.hasOwn(state.entities, scope) ? state.entities[scope] : undefined
  if (reader?.phase !== 'active'
    || organization?.phase !== 'active' || organization.kind !== 'organization' || organization.cognition !== 'none') return []
  return Object.values(state.relations).filter((relation) => {
    const position = Object.hasOwn(state.entities, relation.object) ? state.entities[relation.object] : undefined
    return relation.subject === viewer && relation.relation === 'assignment' && relation.scope === scope
      && position?.phase === 'active' && position.kind === 'position' && position.cognition === 'none'
      && BigInt(relation.validFrom) <= BigInt(state.time)
      && (relation.validUntil === null || BigInt(state.time) < BigInt(relation.validUntil))
  })
}

/**
 * Recheck selected scope material and original goal authority at a live disclosure boundary.
 * @param state - Current authoritative Native projection, read synchronously before disclosure.
 * @param decision - Decision retaining the original preparation and its access requirements.
 */
export function assertPreparedWorldScopeAccess(state: SimulationSnapshot, decision: SimulationDecision): void {
  if (decision.context?.status !== 'prepared') return
  if (state.world !== undefined && decision.snapshotRevision >= state.world.sequence && decision.context.worldScopeAccess === undefined)
    throw new Error('Simulation prepared World material has no original scope access evidence')
  if (decision.context.worldScopeAccess?.some(scope => currentWorldAssignments(state, decision.entityId, scope).length === 0))
    throw new Error('Simulation prepared World material is no longer authorized')
  const goal = decision.context.world
  if (goal?.kind === 'goal') {
    let assignments = state.world === undefined ? [] : currentWorldAssignments(state, decision.entityId,
      state.world.definition.organizationEntityId)
    if (!assignments.length && state.world !== undefined && goal.operations.length > 0
      && goal.operations.every(value => value.pin.implementationRef === WORLD_HIRING_MARKET_PIN.implementationRef))
      assignments = candidateMembership(state, decision.entityId, state.world.definition.organizationEntityId)
    if (goal.assignments.some(original => !assignments.some(current => current.id === original.id
      && current.revision === original.revision))
      || goal.operations.some((operation) => {
        const grants = currentWorldOperationGrants(state, decision.entityId, operation.pin)
        return operation.grants.some(original => original.kind !== 'relation' || !grants.some(current => current.relation.id === original.id
          && current.relation.revision === original.revision))
      })) throw new Error('Simulation prepared World goal authority is no longer available')
  }
  const selected = goal?.governance ?? [], witnesses = goal?.governanceAccess ?? []
  if (selected.length !== witnesses.length || selected.some((original, index) => {
    const witness = witnesses[index], proposal = state.world?.governance.proposals[original.proposalId]
    if (witness?.proposal.proposalId !== original.proposalId || witness.proposal.proposalRevision !== original.proposalRevision
      || witness.proposal.bodyHash !== original.bodyHash || proposal?.revision !== original.proposalRevision
      || proposal.bodyHash !== original.bodyHash || !proposal.electorate.some(member => member.entityId === decision.entityId)
      || witness.pin.domain !== 'governance' || witness.pin.operation !== 'vote' || !witness.grants.length) return true
    const grants = currentWorldOperationGrants(state, decision.entityId, witness.pin, proposal.scopeId, proposal.committeeId)
    return witness.grants.some(originalGrant => originalGrant.kind !== 'relation' || !grants.some(current =>
      current.relation.id === originalGrant.id && current.relation.revision === originalGrant.revision))
  })) throw new Error('Simulation prepared governance body authority is no longer available')
}

/**
 * Select current operation grants with active canonical endpoints and the declared relation rule.
 * @param state - Current authoritative Native projection.
 * @param actor - Actual actor seeking the operation or its domain material.
 * @param pin - Original installed operation selector.
 * @param scope - Optional exact organizational scope.
 * @param target - Optional exact operation target.
 * @returns matching scenario or personnel grants and their current relation evidence.
 */
export function currentWorldOperationGrants(state: SimulationSnapshot, actor: SimulationEntityId,
  pin: SimulationWorldDomainPin, scope?: SimulationEntityId, target?: SimulationEntityId):
readonly { readonly grant: SimulationWorldOperationGrant; readonly relation: SimulationRelation }[] {
  return worldOperationGrants(state).filter(value => value.requesterEntityId === actor
    && value.domain === pin.domain && value.operation === pin.operation && value.version === pin.version
    && (scope === undefined || value.scopeEntityId === scope) && (target === undefined || value.targetEntityId === target))
    .flatMap((value) => {
      const relation = state.relations[value.relationId]
      const subject = state.entities[actor], object = state.entities[value.targetEntityId]
      const scopeEntity = state.entities[value.scopeEntityId]
      const rule = state.spec.relationRules.find(candidate => candidate.relation === value.relation)
      if (subject?.phase !== 'active' || object?.phase !== 'active' || scopeEntity?.phase !== 'active'
        || rule === undefined || !rule.subjectKinds.includes(subject.kind) || !rule.objectKinds.includes(object.kind)
        || !rule.scopeKinds?.includes(scopeEntity.kind)
        || relation === undefined || relation.subject !== actor || relation.object !== value.targetEntityId
        || relation.scope !== value.scopeEntityId || relation.relation !== value.relation
        || BigInt(relation.validFrom) > BigInt(state.time)
        || relation.validUntil !== null && BigInt(relation.validUntil) <= BigInt(state.time)) return []
      return [{ grant: value, relation }]
    })
}

/**
 * Read original static and Native-derived permission declarations; live relations and fences still decide actual authority.
 * @param state - Current original run snapshot.
 * @returns frozen declarations only, without granting a caller any operation or hiding historical permissions.
 */
export function worldOperationGrants(state: SimulationSnapshot): readonly SimulationWorldOperationGrant[] {
  const revoked = new Set(Object.values(state.world?.personnel.reservations ?? {}).filter(value => value.status === 'committed')
    .flatMap(value => value.revokedAuthorityRelationIds))
  return [...state.world?.definition.operationGrants ?? [], ...state.world?.personnel.operationGrants ?? []]
    .filter(value => !revoked.has(value.relationId))
}
