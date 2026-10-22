/** Pure external identity admission and rule evaluation over Native resources; replay never performs IO or sampling. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { SimulationWorldError, WORLD_EXTERNAL_INTERACT_PIN, WORLD_EXTERNAL_INTERACT_DEFINITION,
  simulationExternalInteractRequestSchema, simulationExternalInteractPlanSchema, simulationExternalIdentitySchema,
  simulationExternalInteractionSchema, simulationExternalEffectSchema, simulationExternalInteractResultSchema,
  simulationWorldReadSetSchema, worldExternalIdentityIdSchema, simulationExternalActorRequestSchema, WORLD_EXTERNAL_ACTOR_PIN,
  simulationExternalMediatedRequestSchema, WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan, SimulationEntityId, SimulationWorldDomainRequest,
  SimulationWorldBusinessResolution, SimulationWorldJsonValue, NativeWorldDomain, SimulationExternalState, SimulationExternalEffect,
  SimulationWorldDomainMutation, SimulationExternalInteraction, WorldExternalIdentityId } from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import { assertRepresentationAdmission } from './world-representation-access.ts'

function owned(state: SimulationSnapshot) {
  if (state.world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED',
    'External operation requires a configured World')
  return state.world
}
function parsed(state: SimulationSnapshot, payload: unknown) {
  const input = simulationExternalInteractRequestSchema.parse(payload), subject = state.entities[input.subjectRef]
  if (input.scope !== owned(state).definition.organizationEntityId || subject?.kind !== 'organization'
    || subject.phase !== 'active' || subject.cognition !== 'none' || subject.readiness !== 'ready'
    || subject.id === input.scope) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
    'External interaction requires an active noncognitive external organization in its declared scope')
  const identity = owned(state).external.identities[externalIdentityId(state, input)]
  assertRepresentationAdmission(state, input.subjectRef, externalIdentityId(state, input), 'simulated-rule')
  if (identity !== undefined && (identity.subjectRef !== input.subjectRef))
    throw new SimulationWorldError('SIM_WORLD_CONFLICT', 'External key already identifies its original subject and policy')
  return input
}
/**
 * Derive stable identity independently of display names, requester, request or decision IDs.
 * @param state - Original run identity.
 * @param input - Strict scope and external key selected by the original request.
 * @returns collision-resistant run-local external identity.
 */
export function externalIdentityId(state: SimulationSnapshot,
  input: Pick<z.infer<typeof simulationExternalInteractRequestSchema>, 'scope' | 'externalKey'>): WorldExternalIdentityId {
  return worldExternalIdentityIdSchema.parse(`external:${businessFingerprint([state.spec.runId, input.scope, input.externalKey])}`)
}
function resourceInputs(state: SimulationSnapshot, input: z.infer<typeof simulationExternalInteractRequestSchema>) {
  // The installed can-interact grant authorizes only this subject's inventory aggregate, never money or unrelated accounts.
  return Object.values(state.resources).filter(value => value.owner === input.subjectRef && value.kind === 'inventory'
    && value.unit === input.input.unit).sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, revision, owner, unit, quantity }) => ({ id, revision, owner, unit, quantity }))
}
function evaluate(state: SimulationSnapshot, input: z.infer<typeof simulationExternalInteractRequestSchema>) {
  const resources = resourceInputs(state, input)
  const quantity = resources.reduce((sum, value) => sum + BigInt(value.quantity), 0n)
  const result = simulationExternalInteractResultSchema.options[0].parse({ identityId: externalIdentityId(state, input),
    subjectRef: input.subjectRef, sourceKind: input.sourceKind, policyRef: input.policyRef, disclosure: 'requester',
    availability: resources.length ? { status: 'known', quantity: String(quantity), unit: input.input.unit }
      : { status: 'unknown', unit: input.input.unit } })
  return { resources, result }
}
/**
 * Retain the original latent identity in the same request acceptance as its Channel notification intent.
 * @param state - Authoritative request acceptance prefix.
 * @param intent - Native-derived accepted external application.
 * @param requestId - Its sole original request.
 * @param sequence - Request acceptance position.
 * @returns immutable registry; a subsequent same-key request reuses the original record.
 */
export function acceptExternalIdentity(state: SimulationSnapshot, intent: SimulationWorldIntent,
  requestId: SimulationWorldPlan['requestId'], sequence: number): SimulationExternalState {
  if (!isDeepStrictEqual(intent.pin, WORLD_EXTERNAL_INTERACT_PIN)) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'External identity requires its exact installed operation')
  const input = parsed(state, intent.payload), external = owned(state).external, id = externalIdentityId(state, input)
  if (external.identities[id] !== undefined) return external
  const identity = simulationExternalIdentitySchema.parse({ id, scope: input.scope, externalKey: input.externalKey,
    subjectRef: input.subjectRef, revision: 1, representation: 'simulated-rule', policyRef: input.policyRef,
    source: { kind: 'request', requestId }, sequence })
  return bounded(state, { ...external, identities: { ...external.identities, [id]: identity } })
}
function bounded(state: SimulationSnapshot, external: SimulationExternalState): SimulationExternalState {
  if (Buffer.byteLength(JSON.stringify(external), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new SimulationWorldError('SIM_WORLD_LIMIT',
      'Complete external identities and interaction history exceed the frozen byte allowance', 'bytes')
  return external
}
/**
 * Validate the exact closed external mutation source before recording or verifying an evaluation.
 * @param state - Original current prefix, already checked for plan/read-set authority by the mutation owner.
 * @param mutation - Sole pinned original mutation and clocks.
 * @param proposed - Closed evaluation effect; it cannot supply an outcome or resource changes.
 * @returns exact original causal source; no accounts, contracts, people or messages are changed.
 */
function externalMutationBasis(state: SimulationSnapshot, mutation: SimulationWorldDomainMutation, proposed: SimulationExternalEffect) {
  const effect = simulationExternalEffectSchema.parse(proposed), world = owned(state), plan = world.plans[mutation.planId]
  const request = world.requests[mutation.requestId], intent = request === undefined ? undefined : world.intents[request.intentId]
  if (intent === undefined || plan?.proposal.resolution.kind !== 'apply' || plan.status !== 'accepted'
    || request?.status !== 'open' || request.plans.at(-1) !== plan.id || plan.requestId !== request.id
    || !isDeepStrictEqual(mutation.pin, WORLD_EXTERNAL_INTERACT_PIN) || !isDeepStrictEqual(plan.pin, mutation.pin)
    || !isDeepStrictEqual(intent.pin, mutation.pin) || mutation.id !== `world-mutation:${plan.id}`
    || mutation.time !== state.time || mutation.sequence !== state.revision + 1
    || !isDeepStrictEqual(effect.input, intent.payload) || world.external.interactions[intent.id] !== undefined)
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External evaluation lost its original request, plan or unique mutation')
  simulationExternalInteractPlanSchema.parse(plan.proposal.resolution.payload)
  simulationExternalInteractPlanSchema.parse(mutation.payload)
  const input = parsed(state, effect.input), id = externalIdentityId(state, input)
  if (world.external.identities[id] === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'External evaluation lost its accepted identity')
  return { intentId: intent.id, identityId: id, requestId: request.id, planId: plan.id, mutationId: mutation.id, input,
    time: state.time, recordedAt: mutation.recordedAt, sequence: mutation.sequence }
}

/**
 * Record actual deterministic policy output once before the Native append.
 * @param state - Exact Native prefix whose accounts supply the actual input.
 * @param mutation - Original pinned mutation identity and clocks.
 * @param effect - Closed evaluation of the original retained request.
 * @returns complete persisted original evaluation, without IO or sampling.
 */
export function prepareExternalEvaluation(state: SimulationSnapshot, mutation: SimulationWorldDomainMutation,
  effect: SimulationExternalEffect): SimulationExternalInteraction {
  const source = externalMutationBasis(state, mutation, effect)
  return simulationExternalInteractionSchema.parse({ ...source, ...evaluate(state, source.input) })
}

/**
 * Verify and apply the actual persisted evaluation without replacing its output on replay.
 * @param state - Exact original Native prefix at the mutation append.
 * @param mutation - Original pinned source and clocks.
 * @param effect - Original closed effect, reconstructed from its accepted request.
 * @param retained - Actual Native-recorded input and output; absence refuses replay.
 * @returns complete external table with the exact retained evaluation.
 */
export function applyExternalEffect(state: SimulationSnapshot, mutation: SimulationWorldDomainMutation,
  effect: SimulationExternalEffect, retained: SimulationExternalInteraction | undefined): SimulationExternalState {
  if (retained === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY',
    'External mutation lacks its actual recorded evaluation')
  const actual = simulationExternalInteractionSchema.parse(retained)
  const source = externalMutationBasis(state, mutation, effect), resources = resourceInputs(state, source.input)
  const { resources: _inputs, result, ...retainedSource } = actual
  const quantity = resources.reduce((sum, value) => sum + BigInt(value.quantity), 0n)
  const availability = resources.length ? { status: 'known', unit: source.input.input.unit, quantity: String(quantity) }
    : { status: 'unknown', unit: source.input.input.unit }
  // Arithmetic proof checks the recorded policy result; replay never invokes the policy evaluator or chooses a replacement.
  if (!isDeepStrictEqual(retainedSource, source) || !isDeepStrictEqual(actual.resources, resources)
    || result.identityId !== source.identityId || result.subjectRef !== source.input.subjectRef
    || !isDeepStrictEqual(result.availability, availability))
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Recorded external evaluation differs from its exact input or rule output')
  const external = owned(state).external
  return bounded(state, { ...external, interactions: { ...external.interactions, [actual.intentId]: actual } })
}
/** Registered availability rule; only Native can accept its stable identity and commit its recorded result. */
export class ExternalInteractNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_EXTERNAL_INTERACT_DEFINITION
  readonly ref = WORLD_EXTERNAL_INTERACT_PIN.implementationRef
  readonly generation = WORLD_EXTERNAL_INTERACT_PIN.generation
  readonly acceptedResponsibility = 'external-identity' as const
  // The requester and noncognitive subject are the only identities involved; no person or representative is prepared here.
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }
  /** @param _actor - Native independently authenticates this caller and its scoped inventory-read grant. */
  admitRequest(state: SimulationSnapshot, _actor: SimulationEntityId, request: SimulationWorldDomainRequest) {
    if (request.expectedTime !== null || request.evidence.length) throw new SimulationWorldError('SIM_WORLD_CONFLICT',
      'Installed availability rule supports the next safe boundary without supplemental evidence')
    const input = parsed(state, request.payload)
    return { scopeEntityId: input.scope, targetEntityId: input.subjectRef,
      description: 'Evaluate simulated inventory availability.', payload: z.json().parse(input) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const input = parsed(state, intent.payload)
    return z.json().parse({ external: { identityId: externalIdentityId(state, input), ...input,
      disclosure: 'requester', execution: { kind: 'evaluate-rule' } } })
  }
  validatePlan(_state: SimulationSnapshot, _intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'apply') simulationExternalInteractPlanSchema.parse(resolution.payload)
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const input = parsed(state, intent.payload), subject = state.entities[input.subjectRef]
    if (subject === undefined) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External subject is missing')
    const id = externalIdentityId(state, input), identity = owned(state).external.identities[id]
    return simulationWorldReadSetSchema.parse([{ kind: 'entity', id: subject.id, revision: subject.revision },
      { kind: 'resource-owner-set', owner: subject.id, unit: input.input.unit, hash: businessFingerprint(resourceInputs(state, input)) },
      ...identity === undefined ? [] : [{ kind: 'external', id, revision: identity.revision }]])
  }
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, _plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    simulationExternalInteractPlanSchema.parse(payload)
    const input = parsed(state, intent.payload)
    return { changes: [], externalEffects: [{ kind: 'external/evaluate' as const, input }], resultPayload: {} }
  }
}
/**
 * Verify original identity and recorded evaluations against their immutable request/plan/mutation/result sources.
 * @param state - Fully replayed prefix; present-day balances never replace historical rule inputs.
 * @returns nothing when all original sources are complete; missing or altered references reject writable open.
 */
export function assertExternalProjection(state: SimulationSnapshot): void {
  if (state.world === undefined) return
  const world = state.world, used = new Set<string>()
  for (const result of Object.values(world.results)) {
    const request = world.requests[result.requestId]
    if (result.outcome.kind === 'committed' && isDeepStrictEqual(request?.pin, WORLD_EXTERNAL_INTERACT_PIN)
      && world.external.interactions[result.intentId] === undefined)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Committed external result lost its actual retained evaluation')
  }
  for (const [id, value] of Object.entries(world.external.identities)) {
    const identity = simulationExternalIdentitySchema.parse(value)
    if (identity.source.kind === 'scenario') {
      const book = state.worldBootstrap, source = identity.source
      const original = book?.request.data.externalIdentities.find(entry => entry.scopeId === identity.scope
        && entry.externalKey === identity.externalKey)
      if (id !== identity.id || book?.status !== 'applied' || source.bootstrapSequence !== book.sequence
        || source.definitionHash !== book.request.definitionHash || identity.sequence !== book.appliedSequence
        || original?.subjectId !== identity.subjectRef || original.representation !== identity.representation
        || identity.id !== externalIdentityId(state, identity))
        throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External identity lost its original applied scenario source')
      continue
    }
    const request = world.requests[identity.source.requestId]
    const schema = identity.representation === 'simulated-rule' ? simulationExternalInteractRequestSchema
      : identity.representation === 'simulated-actor' ? simulationExternalActorRequestSchema : simulationExternalMediatedRequestSchema
    const pin = identity.representation === 'simulated-rule' ? WORLD_EXTERNAL_INTERACT_PIN
      : identity.representation === 'simulated-actor' ? WORLD_EXTERNAL_ACTOR_PIN : WORLD_EXTERNAL_MEDIATED_PIN
    const input = schema.parse(request?.proposal.payload)
    if (id !== identity.id || id !== externalIdentityId(state, input) || !isDeepStrictEqual(request?.pin, pin)
      || identity.sequence !== request?.sequence || identity.scope !== input.scope || identity.externalKey !== input.externalKey
      || identity.subjectRef !== input.subjectRef)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External identity lost its exact original request')
  }
  for (const [id, value] of Object.entries(world.external.interactions)) {
    const item = simulationExternalInteractionSchema.parse(value), identity = world.external.identities[item.identityId]
    const request = world.requests[item.requestId], intent = world.intents[item.intentId], plan = world.plans[item.planId]
    const mutation = world.mutations[item.mutationId], result = Object.values(world.results).find(value => value.intentId === item.intentId)
    const quantity = item.resources.reduce((sum, value) => sum + BigInt(value.quantity), 0n)
    const availability = item.resources.length ? { status: 'known', quantity: String(quantity), unit: item.input.input.unit }
      : { status: 'unknown', unit: item.input.input.unit }
    if (id !== item.intentId || identity?.subjectRef !== item.input.subjectRef || item.identityId !== externalIdentityId(state, item.input)
      || used.has(item.mutationId) || !isDeepStrictEqual(request?.pin, WORLD_EXTERNAL_INTERACT_PIN)
      || request?.intentId !== item.intentId || request.status !== 'committed' || plan?.requestId !== request.id
      || !isDeepStrictEqual(intent?.payload, item.input) || plan.status !== 'accepted' || mutation?.planId !== plan.id
      || mutation.sequence !== item.sequence || mutation.recordedAt !== item.recordedAt || mutation.time !== item.time
      || result?.outcome.kind !== 'committed' || result.source.kind !== 'plan' || result.source.planId !== plan.id
      || result.sequence !== item.sequence || !isDeepStrictEqual(result.payload, item.result)
      || !isDeepStrictEqual(mutation.pin, WORLD_EXTERNAL_INTERACT_PIN) || !isDeepStrictEqual(plan.pin, mutation.pin)
      || !isDeepStrictEqual(mutation.payload, { kind: 'evaluate-rule' })
      || plan.proposal.resolution.kind !== 'apply' || !isDeepStrictEqual(plan.proposal.resolution.payload, mutation.payload)
      || !plan.reads.some(read => read.kind === 'resource-owner-set' && read.owner === item.input.subjectRef
        && read.unit === item.input.input.unit && read.hash === businessFingerprint(item.resources))
      || item.result.identityId !== item.identityId || item.result.subjectRef !== identity.subjectRef
      || !isDeepStrictEqual(item.result.availability, availability)
      || item.resources.some(value => value.owner !== identity.subjectRef || value.unit !== item.input.input.unit)
      || new Set(item.resources.map(value => value.id)).size !== item.resources.length)
      throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'External interaction lost its original identity, actual inputs or result')
    used.add(item.mutationId)
  }
}
