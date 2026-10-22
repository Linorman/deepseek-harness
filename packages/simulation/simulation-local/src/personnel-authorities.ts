/** Personnel closure follows actual retained authority provenance; independent candidate eligibility survives employment. */
import { PersonnelDomainError, worldOperationGrants } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationRelation, SimulationEntityId } from '@clocky/clocky-simulation'

/**
 * Classify only the canonical existing-person qualification using its persistent declaration/installation source.
 * @param state - Original Native relation, frozen position declarations and derived authority directory.
 * @param relation - Actual candidate relation; an arbitrary relation name or copied ID confers no exemption.
 * @returns true for independent person-to-organization eligibility; a derived role permission remains a closure duty.
 */
export function independentPersonnelEligibility(state: SimulationSnapshot, relation: SimulationRelation): boolean {
  const world = state.world
  if (world === undefined || relation.relation !== 'eligible-for-hire' || relation.object !== world.definition.organizationEntityId
    || relation.scope !== world.definition.organizationEntityId || state.entities[relation.subject]?.kind !== 'person') return false
  const derived = world.personnel.operationGrants.filter(value => value.relationId === relation.id)
  if (derived.length === 0) return true
  const grant = derived[0]
  if (derived.length !== 1 || grant === undefined || world.definition.operationGrants.some(value => value.relationId === relation.id)
    || grant.requesterEntityId !== relation.subject || grant.targetEntityId !== relation.object
    || grant.scopeEntityId !== relation.scope || grant.relation !== relation.relation)
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Eligibility has conflicting independent and derived role provenance')
  const origins = Object.values(state.relations).filter(assignment => assignment.relation === 'assignment'
    && assignment.subject === relation.subject && assignment.scope === world.definition.organizationEntityId
    && assignment.validFrom === relation.validFrom && world.definition.positionRolePermissions.some(declaration =>
    declaration.positionEntityId === assignment.object && declaration.permissions.some(permission => permission.domain === grant.domain
        && permission.operation === grant.operation && permission.version === grant.version
        && permission.scopeEntityId === grant.scopeEntityId
        && permission.targetEntityId === grant.targetEntityId && permission.relation === grant.relation)))
  if (origins.length !== 1)
    throw new PersonnelDomainError('SIM_PERSONNEL_CONFLICT', 'Role eligibility lost its unique original assignment and position declaration')
  return false
}

/**
 * Select actual live/future role authority references affected by personnel closure.
 * @param state - Exact Native prefix with original grants and canonical relations.
 * @param personId - Original person; a principal or label cannot select another actor.
 * @param scope - Optional exact scope; omission inventories all real role authority for this person.
 * @returns distinct original relations, excluding only independently declared candidate eligibility.
 */
export function personnelRoleAuthorities(state: SimulationSnapshot, personId: SimulationEntityId,
  scope?: SimulationEntityId): readonly SimulationRelation[] {
  const ids = new Set(worldOperationGrants(state).filter(value => value.requesterEntityId === personId
    && (scope === undefined || value.scopeEntityId === scope)).flatMap((grant) => {
    const relation = state.relations[grant.relationId]
    return relation?.subject === personId && relation.object === grant.targetEntityId && relation.scope === grant.scopeEntityId
      && relation.relation === grant.relation && (relation.validUntil === null || BigInt(relation.validUntil) > BigInt(state.time))
      && !independentPersonnelEligibility(state, relation) ? [relation.id] : []
  }))
  return Object.values(state.relations).filter(value => ids.has(value.id)).sort((a, b) => a.id.localeCompare(b.id))
}
