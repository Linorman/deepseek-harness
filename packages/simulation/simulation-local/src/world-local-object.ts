/** Native-only name mutation. Cross-owner resources and unknown model reads require whole-run maintenance. */
import { isDeepStrictEqual } from 'node:util'
import { WORLD_LOCAL_OBJECT_PIN, WORLD_LOCAL_OBJECT_DEFINITION, localObjectRenameSchema,
  localObjectFallbackReasonSchema, activeSimulationMaintenance, SimulationWorldError, simulationChangeSchema, simulationWorldReadSetSchema } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan, SimulationEntity,
  LocalObjectFallbackReason, LocalObjectFootprint,
  SimulationWorldDomainRequest, SimulationEntityId, SimulationWorldBusinessResolution, SimulationWorldJsonValue } from '@clocky/clocky-simulation'

/**
 * Require the closed supported object class before presenting local eligibility.
 * @param state - Original Native prefix.
 * @param id - Exact object identity.
 * @returns the original plain metadata object and its string name; people, writers and arbitrary profiles reject.
 */
export function localObjectTarget(state: SimulationSnapshot, id: SimulationEntityId): { target: SimulationEntity; name: string } {
  const target = state.entities[id], name = target?.profile.name
  if (target?.kind !== 'object' || target.cognition !== 'none' || target.phase !== 'active'
    || target.binding !== undefined || target.participantReservation !== undefined || target.writer !== undefined
    || typeof name !== 'string' || Object.keys(target.profile).some(key => key !== 'name' && key !== 'description')
    || target.profile.description !== undefined && typeof target.profile.description !== 'string')
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Local rename requires a plain non-cognitive object without a writer')
  return { target, name }
}

/**
 * Prove the entire write footprint is one non-cognitive name and every open model read is disjoint.
 * @param state - Exact Native queue prefix.
 * @param targetId - Existing non-cognitive object.
 * @returns visible fallback reason, or undefined for the sole Native-owner local path.
 */
export function localObjectFallback(state: SimulationSnapshot, targetId: SimulationEntityId):
'related-object' | 'window-read-set-unknown' | 'window-overlap' | undefined {
  const authorityRelations = new Set((state.world?.definition.operationGrants ?? [])
    .filter(grant => grant.targetEntityId === targetId && grant.domain === WORLD_LOCAL_OBJECT_PIN.domain
      && grant.operation === WORLD_LOCAL_OBJECT_PIN.operation).map(grant => grant.relationId))
  if (Object.values(state.relations).some(value => (value.subject === targetId || value.object === targetId || value.scope === targetId)
    && !authorityRelations.has(value.id))
    || Object.values(state.resources).some(value => value.owner === targetId || value.controllers.includes(targetId))
    || Object.values(state.channelReservations ?? {}).some(value => value.spec.members.some(member => member.entityId === targetId)))
    return 'related-object'
  for (const decision of Object.values(state.decisions)) {
    if (decision.status !== 'open' && decision.status !== 'submitted') continue
    const context = decision.context
    if (context?.status !== 'prepared' || context.world === undefined || !('reads' in context.world)
      || !isDeepStrictEqual(context.world.pin, WORLD_LOCAL_OBJECT_PIN)) return 'window-read-set-unknown'
    // Only this exact installed provider declares a complete name-only planning read set.
    if (context.world.reads.some(read => (read.kind === 'entity' || read.kind === 'entity-profile' || read.kind === 'entity-binding')
      && read.id === targetId)) return 'window-overlap'
  }
  return undefined
}

/**
 * Derive complete private references from the same serialized source used by the mutation.
 * @param state - Native source prefix.
 * @param targetId - Original plain object.
 * @returns deterministic owner references; never serialize this metadata into the actor's result.
 */
export function localObjectFootprint(state: SimulationSnapshot, targetId: SimulationEntityId): LocalObjectFootprint {
  const { target } = localObjectTarget(state, targetId)
  return { entityId: target.id, entityRevision: target.revision, writerEpoch: null,
    relations: Object.values(state.relations)
      .filter(value => value.subject === target.id || value.object === target.id || value.scope === target.id)
      .map(value => value.id).sort(),
    resources: Object.values(state.resources).filter(value => value.owner === target.id || value.controllers.includes(target.id))
      .map(value => value.id).sort(),
    channels: Object.values(state.channelReservations ?? {})
      .filter(value => value.spec.members.some(member => member.entityId === target.id)).map(value => value.channelId).sort(),
    permissionRelations: (state.world?.definition.operationGrants ?? []).filter(value => value.targetEntityId === target.id)
      .map(value => value.relationId).sort(), owner: 'native' as const }
}

/**
 * Require exact quiescent fallback ownership; another operation cannot authorize this commit.
 * @param state - Current Native source prefix.
 * @param planId - Original accepted local object plan.
 * @returns its retained fallback reason only after canonical quiescence.
 */
export function localObjectMaintenance(state: SimulationSnapshot, planId: string): LocalObjectFallbackReason | undefined {
  const maintenance = activeSimulationMaintenance(state)
  if (maintenance?.status !== 'quiescent' || maintenance.request.id !== `local-object:${planId}`) return undefined
  const reason = localObjectFallbackReasonSchema.safeParse(maintenance.request.owner.replace(/^local-object-fallback:/, ''))
  return maintenance.request.owner.startsWith('local-object-fallback:') && reason.success ? reason.data : undefined
}

/** Single-owner pure mutation; global norms, personnel and arbitrary profile updates are outside this capability. */
export class LocalObjectNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_LOCAL_OBJECT_DEFINITION
  readonly ref = WORLD_LOCAL_OBJECT_PIN.implementationRef
  readonly generation = WORLD_LOCAL_OBJECT_PIN.generation
  /** Targets cannot represent people; Native independently tracks the original requester. */
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }
  private current(state: SimulationSnapshot, payload: SimulationWorldJsonValue) {
    const input = localObjectRenameSchema.parse(payload), world = state.world
    const { target, name } = localObjectTarget(state, input.targetEntityId)
    if (world === undefined || target.revision !== input.entityRevision || input.scopeEntityId !== world.definition.organizationEntityId)
      throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'Local rename requires its original object revision and World scope')
    return { input, target, name, world }
  }
  admitRequest(state: SimulationSnapshot, _actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    const { input } = this.current(state, request.payload)
    return { scopeEntityId: input.scopeEntityId, targetEntityId: input.targetEntityId,
      description: 'Rename the original non-cognitive object.', payload: input }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent, _actorId: SimulationEntityId) {
    const { name } = this.current(state, intent.payload)
    return { input: intent.payload, name }
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution) {
    this.current(state, intent.payload)
    if (resolution.kind === 'apply' && !isDeepStrictEqual(resolution.payload, intent.payload)) throw new Error('Rename plan changed original input')
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const { target } = this.current(state, intent.payload)
    return simulationWorldReadSetSchema.parse([{ kind: 'entity', id: target.id, revision: target.revision }])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    const { input, target, name } = this.current(state, intent.payload)
    if (!isDeepStrictEqual(input, payload) || plan.proposal.resolution.kind !== 'apply'
      || !isDeepStrictEqual(plan.proposal.resolution.payload, input)) throw new Error('Rename mutation changed original plan')
    const fallback = localObjectFallback(state, target.id), reason = localObjectMaintenance(state, plan.id)
    if (fallback !== undefined && reason === undefined) throw new Error(`Local object requires whole-run maintenance: ${fallback}`)
    return { changes: [simulationChangeSchema.parse({ kind: 'entity/profile', id: target.id,
      entityRevision: target.revision, profile: { ...target.profile, name: input.name } })],
    resultPayload: { ...input, previousName: name,
      execution: reason === undefined ? { kind: 'local' as const, owner: 'native' as const }
        : { kind: 'maintenance' as const, reason } } }
  }
}
