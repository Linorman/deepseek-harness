/** Single-commit representation switches preserve the original subject, facts, resources and identities. */
import { isDeepStrictEqual } from 'node:util'
import { representationSwitchRequestSchema, representationSwitchResultSchema, representationHistorySchema,
  WORLD_REPRESENTATION_PIN, WORLD_REPRESENTATION_DEFINITION, simulationChangeSchema, simulationWorldReadSetSchema } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan, SimulationWorldJsonValue,
  SimulationWorldDomainRequest, SimulationWorldBusinessResolution, SimulationEntityId } from '@clocky/clocky-simulation'

/** Pure planning and execution checks also run inside Native's serialized mutation queue. */
export class RepresentationNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_REPRESENTATION_DEFINITION
  readonly ref = WORLD_REPRESENTATION_PIN.implementationRef
  readonly generation = WORLD_REPRESENTATION_PIN.generation
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }
  private current(state: SimulationSnapshot, payload: unknown, ownRequest?: string) {
    const input = representationSwitchRequestSchema.parse(payload), world = state.world
    const subject = state.entities[input.targetEntityId], identity = world?.external.identities[input.identityId]
    if (world === undefined || input.scopeEntityId !== world.definition.organizationEntityId
      || subject?.kind !== 'organization' || subject.cognition !== 'none' || subject.binding !== undefined
      || subject.phase !== 'active' || subject.readiness !== 'ready' || identity?.subjectRef !== subject.id
      || identity.scope !== input.scopeEntityId || identity.representation === 'simulated-actor'
      || Object.values(world.external.representatives).some(value => value.identityId === identity.id))
      throw new Error('Representation switch requires a memoryless original external identity; cognitive downgrade is unsupported')
    if (input.to === 'director-mediated' && world.definition.externalAdjudicationPolicy === undefined
      || !world.definition.operations.some(pin => pin.domain === 'external' && pin.operation === 'interact'
        && pin.version === (input.to === 'simulated-rule' ? '1' : '3')))
      throw new Error('Target representation requires its installed policy and operation')
    if (Object.values(world.intents).some(intent => intent.targetEntityId === subject.id && intent.requestId !== ownRequest
      && !Object.values(world.results).some(result => result.intentId === intent.id))
      || Object.values(world.external.events).some(event => event.original.identityId === identity.id && event.status !== 'consumed'))
      throw new Error('Representation switch retains outstanding original obligations')
    const raw = subject.profile.externalRepresentations
    if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) throw new Error('Malformed representation history')
    const histories = raw ?? {}
    const history = histories[input.identityId] === undefined ? [] : representationHistorySchema.parse(histories[input.identityId])
    const previous = history.at(-1)
    if (input.expectedGeneration !== (previous?.generation ?? 1) || input.from !== (previous?.to ?? identity.representation)
      || history.length >= 128) throw new Error('Representation switch has stale generation or exhausted history capacity')
    return { input, subject, identity, histories, history }
  }
  /** @param retained - Original Native intent during revalidation; its own pending request does not block itself. */
  admitRequest(state: SimulationSnapshot, _actorId: SimulationEntityId, request: SimulationWorldDomainRequest,
    retained?: SimulationWorldIntent) {
    const { input } = this.current(state, request.payload, retained?.requestId)
    return { scopeEntityId: input.scopeEntityId, targetEntityId: input.targetEntityId,
      description: 'Switch the original memoryless external representation.', payload: input }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent, _actorId: SimulationEntityId) {
    const { input, history } = this.current(state, intent.payload, intent.requestId)
    return { input, history, memory: 'none', obligations: 'no-pending-representation-io' }
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution) {
    this.current(state, intent.payload, intent.requestId)
    if (resolution.kind === 'apply' && !isDeepStrictEqual(resolution.payload, intent.payload)) throw new Error('Representation plan changed original mapping')
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const { subject } = this.current(state, intent.payload, intent.requestId)
    return simulationWorldReadSetSchema.parse([{ kind: 'entity', id: subject.id, revision: subject.revision }])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.status !== 'accepted' || plan.proposal.resolution.kind !== 'apply'
      || !isDeepStrictEqual(plan.proposal.resolution.payload, intent.payload)) throw new Error('Representation requires its original accepted plan')
    const { input, subject, identity, histories, history } = this.current(state, intent.payload, intent.requestId)
    const actual = representationSwitchResultSchema.parse(payload)
    const expected = { ...input, generation: input.expectedGeneration + 1, sourceRevision: state.revision,
      identitySequence: identity.sequence, time: state.time, memory: 'none', obligations: 'no-pending-representation-io' }
    if (!isDeepStrictEqual(actual, expected)) throw new Error('Representation result changed its original source or generation')
    return { changes: [simulationChangeSchema.parse({ kind: 'entity/profile', id: subject.id, entityRevision: subject.revision,
      profile: { ...subject.profile, externalRepresentations: { ...histories, [identity.id]: [...history, actual] } } })],
    resultPayload: actual }
  }
}
