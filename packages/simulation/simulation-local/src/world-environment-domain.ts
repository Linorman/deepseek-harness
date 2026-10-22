/** Pure domain reducers; Native retains actual mutations and applies one atomic profile update. */
import { isDeepStrictEqual } from 'node:util'
import { WORLD_ENVIRONMENT_PIN, WORLD_ENVIRONMENT_DEFINITION, WORLD_EXPERIENCE_PIN, WORLD_EXPERIENCE_DEFINITION,
  environmentStateSchema, environmentRequestSchema, environmentSampleSchema, sampleEnvironment,
  personExperienceSchema, personEvolutionStateSchema, simulationChangeSchema, simulationWorldReadSetSchema } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan,
  SimulationWorldDomainRequest, SimulationEntityId, SimulationWorldBusinessResolution, SimulationWorldJsonValue } from '@clocky/clocky-simulation'

/** Supply and experience are installed operations; neither requires a driver branch or additional writer. */
export class EvolutionNativeWorldDomain implements NativeWorldDomain {
  readonly definition
  readonly ref
  readonly generation = 1
  /** @param kind - Exact operation selected by trusted plugin composition. */
  constructor(private readonly kind: 'supply' | 'experience') {
    this.definition = kind === 'supply' ? WORLD_ENVIRONMENT_DEFINITION : WORLD_EXPERIENCE_DEFINITION
    this.ref = (kind === 'supply' ? WORLD_ENVIRONMENT_PIN : WORLD_EXPERIENCE_PIN).implementationRef
  }
  personnelSubjects(intent: SimulationWorldIntent) {
    return this.kind === 'supply' ? [] : [personExperienceSchema.parse(intent.payload).personId]
  }
  private current(state: SimulationSnapshot, payload: SimulationWorldJsonValue, actorId: SimulationEntityId | null) {
    const input = this.kind === 'supply' ? environmentRequestSchema.parse(payload) : personExperienceSchema.parse(payload)
    const target = Object.hasOwn(state.entities, input.targetEntityId) ? state.entities[input.targetEntityId] : undefined
    if (target?.phase !== 'active' || target.cognition !== 'none' || target.kind !== (this.kind === 'supply' ? 'environment' : 'person-state'))
      throw new Error('Evolution requires its distinct active non-cognitive state entity')
    if (input.scopeEntityId !== state.world?.definition.organizationEntityId) throw new Error('Evolution scope does not match world')
    if (this.kind === 'supply') environmentStateSchema.parse(target.profile.environment)
    else {
      const request = personExperienceSchema.parse(payload), current = personEvolutionStateSchema.parse(target.profile.evolution)
      const source = Object.values(state.world.intents).find(value => value.id === request.sourceIntentId)
      const results = Object.values(state.world.results)
      if (current.personId !== request.personId || state.entities[request.personId]?.kind !== 'person'
        || actorId !== null && !current.audience.includes(actorId)
        || source === undefined || source.requesterEntityId !== request.personId
        || !results.some(result => result.intentId === source.id && result.outcome.kind === 'committed')
        || request.effectiveAt !== state.time || current.versions.length >= 256)
        throw new Error('Experience requires authorized audience, original committed personal experience and current time')
      const period = BigInt(request.effectiveAt) / BigInt(current.period)
      const spent = current.versions.filter(version => BigInt(version.effectiveAt) / BigInt(current.period) === period)
        .reduce((sum, version) => sum + Math.abs(version.next - version.previous), 0)
      if (spent + Math.abs(request.next - request.previous) > 5 || BigInt(request.validUntil) > BigInt(state.spec.maxTime))
        throw new Error('Experience exceeds its aggregate period delta or the declared simulation horizon')
      const previous = current.versions.filter(v => v.field === request.field && v.key === request.key).at(-1)
      if (request.previous !== (previous?.next ?? 0) || current.versions.some(v =>
        v.field === request.field && v.key === request.key && BigInt(v.effectiveAt) / BigInt(current.period)
          === BigInt(request.effectiveAt) / BigInt(current.period)))
        throw new Error('Experience requires original value and at most one bounded change per field and period')
    }
    return { input, target }
  }
  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest) {
    const { input } = this.current(state, request.payload, actorId)
    return { scopeEntityId: input.scopeEntityId, targetEntityId: input.targetEntityId,
      description: this.kind === 'supply' ? 'Advance simulated supply.' : 'Record bounded personal experience.', payload: input }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent, actorId: SimulationEntityId) {
    const { target } = this.current(state, intent.payload, actorId)
    return { input: intent.payload, state: target.profile }
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution) {
    this.current(state, intent.payload, intent.requesterEntityId)
    if (resolution.kind === 'apply' && !isDeepStrictEqual(resolution.payload, intent.payload))
      throw new Error('Evolution plan must preserve original input')
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const { target } = this.current(state, intent.payload, intent.requesterEntityId)
    return simulationWorldReadSetSchema.parse([{ kind: 'entity', id: target.id, revision: target.revision }])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    if (plan.status !== 'accepted' || plan.requestId !== intent.requestId || !isDeepStrictEqual(plan.pin, intent.pin)
      || plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(plan.proposal.resolution.payload, intent.payload))
      throw new Error('Evolution mutation requires original accepted plan')
    const { target } = this.current(state, intent.payload, intent.requesterEntityId)
    let profile, resultPayload
    if (this.kind === 'supply') {
      const current = environmentStateSchema.parse(target.profile.environment)
      const actual = environmentSampleSchema.parse(payload)
      const expected = sampleEnvironment(current, environmentRequestSchema.parse(intent.payload), state.time)
      if (!isDeepStrictEqual(actual, expected)) throw new Error('Recorded sample does not match original model and state')
      profile = { ...target.profile, environment: { ...current, inventory: actual.inventory, lastTime: state.time } }
      resultPayload = actual
    } else {
      const actual = personExperienceSchema.parse(payload)
      if (!isDeepStrictEqual(actual, intent.payload)) throw new Error('Experience mutation changed its original input')
      const current = personEvolutionStateSchema.parse(target.profile.evolution)
      profile = { ...target.profile, evolution: { ...current, versions: [...current.versions, actual] } }
      resultPayload = actual
    }
    return { changes: [simulationChangeSchema.parse({ kind: 'entity/profile', id: target.id,
      entityRevision: target.revision, profile })], resultPayload }
  }
}
