import { assertRepresentationAdmission } from './world-representation-access.ts'
import { worldDecisionSource, worldRolePlanOperationId, worldRoleRequester } from '@clocky/clocky-simulation'
/** Pure original director adjudication. IO, appends, resource writes and scheduler writes remain with their original Native owners. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import {
  worldFactIdSchema, worldFactVersionSchema, simulationExternalIdentitySchema,
  simulationExternalMediatedRequestSchema, simulationExternalMediatedPlanSchema, simulationExternalAdjudicationSchema,
  simulationExternalClaimSchema, simulationExternalAdjudicatedFactPayloadSchema, simulationExternalAdjudicationInputsSchema,
  simulationExternalMediatedPolicyParametersSchema,
  simulationExternalMediatedEffectSchema,
  simulationExternalMediatedMutationSchema, simulationExternalMediatedResultSchema, simulationExternalAdjudicatedEventStateSchema,
  simulationWorldFactAdjudicatedRequestSchema, simulationWorldReadSetSchema, simulationEventIdSchema, worldResultIdSchema,
  WORLD_EXTERNAL_MEDIATED_PIN, WORLD_EXTERNAL_MEDIATED_DEFINITION, WORLD_EXTERNAL_MEDIATION_POLICY_REF,
  WORLD_EXTERNAL_MEDIATION_FACT_SCHEMA_REF, SimulationWorldError, simulationContextConsumptionSchema, simulationResourceTransaction,
  simulationContextConsumptionHash, worldOperationGrants, activePersonnelFences,
} from '@clocky/clocky-simulation'
import type {
  SimulationSnapshot, SimulationWorldIntent, SimulationWorldPlan, SimulationEntityId, SimulationWorldDomainMutation,
  SimulationWorldDomainRequest, SimulationWorldBusinessResolution, SimulationWorldJsonValue, NativeWorldDomain,
  SimulationExternalMediatedRequest as Request, SimulationExternalAdjudicatedOutcome as Outcome,
  SimulationExternalClaim as Claim, SimulationExternalAdjudication as AdjudicationRecord,
  SimulationExternalMediatedPolicyParameters as PolicyParameters, SimulationExternalMediatedEffect,
  SimulationExternalState, SimulationWorldFactRequest, SimulationWorldEvidenceRef as Evidence,
  SimulationExternalAdjudicatedEventState, SimulationWorldResult, SimulationCommitment,
} from '@clocky/clocky-simulation'
import { businessFingerprint } from './business.ts'
import { externalIdentityId } from './world-external.ts'
import { assertDirectorTrigger } from './world-director-event.ts'
type Basis = AdjudicationRecord['basis']
type Disclosure = Request['responseScope']['disclosure']
/** Deeply frozen complete installed policy and its persisted effective-parameter fingerprint. */
export interface SimulationExternalAdjudicationPolicy extends Readonly<PolicyParameters> {
  /** Complete parsed deployment values retained in the original adjudication. */
  readonly parameters: Readonly<PolicyParameters>
  /** Canonical hash of every effective parameter, including generation. */
  readonly fingerprint: string
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
/**
 * Resolve explicit deployment values; no omitted field gains a runtime default.
 * @param owner - Validated frozen World definition configuration.
 * @returns deeply frozen effective parameters and their canonical fingerprint; unknown or incomplete values reject.
 */
export function resolveExternalAdjudicationPolicy(owner: unknown): SimulationExternalAdjudicationPolicy {
  const parameters = deepFreeze(simulationExternalMediatedPolicyParametersSchema.parse(owner))
  return Object.freeze({ ...parameters, parameters, fingerprint: fingerprint(parameters) })
}
/** Stable World rejection with the precise adjudication category retained outside model-visible results. */
export class SimulationExternalAdjudicationError extends SimulationWorldError {
  /** @param category - Failed source, authority or closed semantic invariant. @param message - Private diagnostic. */
  constructor(readonly category: 'source' | 'subject' | 'policy' | 'authority' | 'evidence' | 'disclosure' | 'time'
    | 'inventory' | 'resource' | 'contract' | 'fact-conflict' | 'condition' | 'persona', message: string) {
    super(category === 'authority' ? 'SIM_WORLD_AUTHORITY' : category === 'source' ? 'SIM_WORLD_INTEGRITY' : 'SIM_WORLD_CONFLICT', message)
  }
}
function deny(code: SimulationExternalAdjudicationError['category'],
  message: string): never { throw new SimulationExternalAdjudicationError(code, message) }
/** Canonical Native hash shared with the original resource and source owners. */
const fingerprint = businessFingerprint
function inventoryInputs(state: SimulationSnapshot, subject: SimulationEntityId, unit: string) {
  return Object.values(state.resources).filter(value => value.owner === subject && value.kind === 'inventory' && value.unit === unit)
    .sort((a, b) => a.id.localeCompare(b.id)).map(({ id, revision, owner, unit: actualUnit, quantity }) =>
      ({ id, revision, owner, unit: actualUnit, quantity }))
}
function evidenceMatches(state: SimulationSnapshot, evidence: Evidence): boolean {
  switch (evidence.kind) {
    case 'external-adjudication-policy': {
      const policy = policyFor(state)
      return evidence.generation === policy.generation && evidence.hash === policy.fingerprint
    }
    case 'entity': return Object.values(state.entities).some(value => value.id === evidence.id && value.revision === evidence.revision)
    case 'entity-profile': {
      const value = Object.values(state.entities).find(value => value.id === evidence.id)
      return value?.revision === evidence.revision && fingerprint(value.profile) === evidence.hash
    }
    case 'entity-binding': {
      const binding = state.entities[evidence.id]?.binding
      return binding !== undefined && fingerprint(binding) === evidence.hash
    }
    case 'relation': {
      const value = Object.values(state.relations).find(value => value.id === evidence.id)
      return value?.revision === evidence.revision && value.validFrom === evidence.effectiveFrom
        && value.validUntil === evidence.effectiveUntil
    }
    case 'resource': return Object.values(state.resources).some(value => String(value.id) === String(evidence.id)
      && value.revision === evidence.revision)
    case 'resource-owner-set': return fingerprint(inventoryInputs(state, evidence.owner, evidence.unit)) === evidence.hash
    case 'world-fact': {
      const value = state.world?.facts[evidence.reference.factId]?.find(item => item.version === evidence.reference.version)
      return value !== undefined && fingerprint(value) === evidence.hash
    }
    case 'world-fact-set': return fingerprint(Object.values(state.world?.facts ?? {}).flat()
      .filter(value => value.subject === evidence.subject && value.scope === evidence.scope)) === evidence.hash
    case 'commitment': {
      const value = Object.values(state.commitments).find(item => item.id === evidence.id)
      return value?.revision === evidence.revision && fingerprint(value) === evidence.hash
    }
    case 'commitment-party-set': return fingerprint(Object.values(state.commitments)
      .filter(value => value.debtor === evidence.subject || value.creditor === evidence.subject).sort((a, b) =>
        a.id.localeCompare(b.id))) === evidence.hash
    case 'external': return state.world?.external.identities[evidence.id]?.revision === evidence.revision
    case 'external-representation': return fingerprint(Object.values(state.world?.external.representatives ?? {})
      .filter(value => value.identityId === evidence.id)) === evidence.hash
    // Existing owner reference variants remain in Core's normal revalidation. They are not reinterpretations of this domain's facts.
    default: return false
  }
}
function resolveDisclosure(state: SimulationSnapshot, disclosure: Disclosure,
  requester: SimulationEntityId, policy: SimulationExternalAdjudicationPolicy): SimulationWorldFactRequest['audience'] {
  switch (disclosure.kind) {
    case 'requester': return { kind: 'actors', entityIds: [requester] }
    case 'actors': {
      if (disclosure.entityIds.some(id => !Object.hasOwn(state.entities, id)
          || id !== requester && !policy.actorDisclosure.includes(id))) deny('disclosure', 'Readers exceed installed policy')
      return disclosure
    }
    case 'public': if (!policy.allowPublicDisclosure) deny('disclosure', 'Public disclosure is not installed'); return disclosure
    case 'scope-members': if (!policy.allowScopeDisclosure) deny('disclosure', 'Scope disclosure is not installed'); return disclosure
    default: return assertNever(disclosure)
  }
}
function disclosureAudience(state: SimulationSnapshot, request: Request, outcome: Outcome,
  requester: SimulationEntityId, policy: SimulationExternalAdjudicationPolicy): SimulationWorldFactRequest['audience'] {
  const maximum = resolveDisclosure(state, request.responseScope.disclosure, requester, policy),
    selected = resolveDisclosure(state, outcome.disclosure, requester, policy)
  if (maximum.kind !== 'public') {
    if (selected.kind !== maximum.kind) deny('disclosure', 'Outcome widens the original request disclosure')
    if (selected.kind === 'actors' && maximum.kind === 'actors' && selected.entityIds.some(id => !maximum.entityIds.includes(id)))
      deny('disclosure', 'Outcome widens the original request readers')
  }
  return selected
}
/** Native derives cognition versions from the already consumed director view; model output supplies no version claims. */
function deriveBasis(state: SimulationSnapshot, plan: SimulationWorldPlan, policy: SimulationExternalAdjudicationPolicy): Basis {
  const operation = state.operations[worldRolePlanOperationId(plan)],
    decision = operation === undefined ? undefined : state.decisions[operation.decisionId]
  if (state.world === undefined || operation?.action.kind !== 'world/resolve' || decision?.status !== 'accepted'
    || decision.entityId !== state.world.definition.directorEntityId || decision.context?.status !== 'prepared'
    || decision.consumption === undefined
    || decision.context.world?.kind !== 'resolve' && decision.context.world?.kind !== 'scenario-resolve'
    || decision.context.world.requestId !== plan.requestId || operation.entityId !== decision.entityId
    || !decision.operationIds.includes(operation.id) || !isDeepStrictEqual(operation.action, plan.proposal)) deny('source',
    'Adjudication lacks its original consumed director decision')
  const request = state.world.requests[plan.requestId], intent = request === undefined ? undefined : state.world.intents[request.intentId]
  const context = decision.context.world
  if (context.kind === 'scenario-resolve' ? request?.notificationOperationId !== null || intent?.scenarioTrigger === undefined
    || !isDeepStrictEqual(context.trigger, intent.scenarioTrigger)
      || !isDeepStrictEqual(worldDecisionSource(request).trigger, context.trigger)
    : request?.notificationOperationId === null || intent?.scenarioTrigger !== undefined)
    deny('source', 'Adjudication context changed its original Channel or scenario source')
  const view = decision.context.view, consumption = decision.consumption, actor = state.entities[decision.entityId]
  if (!simulationContextConsumptionSchema.safeParse(consumption).success || actor?.binding?.sessionId !== consumption.sessionId
    || consumption.contextHash !== simulationContextConsumptionHash(view) || consumption.inputId !== view.inputId
    || view.entityId !== actor.id || view.runId !== state.spec.runId || view.epoch !== decision.epoch
    || view.slot !== decision.slot || view.time !== decision.time || view.projections.run !== decision.snapshotRevision
    || view.projections.entity !== decision.entityRevision)
    deny('source', 'Adjudication lost its exact canonical consumed director view')
  if (decision.deterministic !== undefined) return { kind: 'policy', actorId: decision.entityId, decisionId: decision.id,
    policy: decision.deterministic.policy, contextFingerprint: decision.context.fingerprint,
    adjudicationPolicyRef: WORLD_EXTERNAL_MEDIATION_POLICY_REF, policyVersion: policy.version, policyFingerprint: policy.fingerprint }
  return { kind: 'model', actorId: decision.entityId, decisionId: decision.id, modelVersion: view.versions.model,
    personaVersion: view.versions.persona, contextFingerprint: decision.context.fingerprint,
    policyRef: WORLD_EXTERNAL_MEDIATION_POLICY_REF, policyVersion: policy.version, policyFingerprint: policy.fingerprint }
}
function validateClaim(state: SimulationSnapshot, request: Request, claim: Claim, policy: SimulationExternalAdjudicationPolicy,
  effectiveFrom: string): void {
  switch (claim.kind) {
    case 'condition': {
      if (!policy.conditionInstalls.includes(claim.predicate)) deny('condition', 'Condition schema is not installed')
      // The Core discriminated schema is closed. A predicate cannot carry account, stock or contract prose through generic JSON.
      simulationExternalClaimSchema.parse(claim)
      if (!policy.futureConditionInstalls.includes(claim.predicate) && effectiveFrom !== state.time)
        deny('time', 'Condition does not permit future authority')
      break
    }
    case 'inventory-as-of': {
      const accounts = inventoryInputs(state, request.subjectRef, claim.unit)
      if (accounts.length === 0 && request.input.inventoryUnit !== claim.unit)
        deny('inventory', 'Unknown inventory requires the original requester-authorized unit')
      if (effectiveFrom !== state.time) deny('time', 'Inventory observations cannot assert an unverified future balance')
      const actual = accounts.length === 0 ? { status: 'unknown' } : { status: 'known',
        quantity: String(accounts.reduce((sum, value) => sum + BigInt(value.quantity), 0n)) }
      if (!isDeepStrictEqual(actual, claim.availability)) deny('inventory', 'Inventory conflicts with current original Native accounts')
      break
    }
    case 'balance-as-of': {
      const account = Object.values(state.resources).find(value => value.id === claim.resourceId)
      if (effectiveFrom !== state.time) deny('time', 'Balance observations cannot assert an unverified future account')
      if (account?.owner !== request.subjectRef || account.quantity !== claim.quantity) deny('resource',
        'Balance differs from its original account')
      // A can-interact grant does not reveal private money. The authoritative reader must already control the account.
      if (account.kind === 'money' && !account.controllers.includes(owned(state).definition.directorEntityId))
        deny('authority', 'A private monetary account cannot be disclosed through interaction permission')
      break
    }
    case 'commitment-as-of': {
      const contract = Object.values(state.commitments).find(value => value.id === claim.commitmentId)
      if (effectiveFrom !== state.time) deny('time', 'A contract observation cannot rewrite its future state')
      if (contract === undefined || !contractBelongsToSubject(state, contract.id, request.subjectRef)
        || contract.phase !== claim.phase) deny('contract', 'Contract differs from its original Native obligation')
      break
    }
    default: assertNever(claim)
  }
}
function factIdentity(identity: AdjudicationRecord['identityId'], factKey: string) {
  return worldFactIdSchema.parse(`external-fact:${fingerprint([identity, factKey]).slice('sha256:'.length)}`)
}
/** A semantic axis does not depend on the model's factKey; renamed facts cannot overwrite the same known condition or unit. */
function semanticAxis(claim: Claim): string {
  switch (claim.kind) {
    case 'condition': return `condition/${claim.predicate}/${claim.schemaRef}`
    case 'inventory-as-of': return `inventory/${claim.unit}`
    case 'balance-as-of': return `balance/${claim.resourceId}`
    case 'commitment-as-of': return `commitment/${claim.commitmentId}`
    default: return assertNever(claim)
  }
}
function factConflict(state: SimulationSnapshot, request: Request, outcome: Extract<Outcome, { kind: 'environmental-fact' }>) {
  const start = BigInt(outcome.effectiveFrom), end = outcome.effectiveUntil === null ? null : BigInt(outcome.effectiveUntil)
  for (const history of Object.values(state.world?.facts ?? {})) {
    for (const existing of history) {
      if (existing.subject !== request.subjectRef || existing.scope !== request.scope) continue
      let until = existing.effectiveUntil === null ? null : BigInt(existing.effectiveUntil)
      for (const successor of history) {
        if (BigInt(successor.version) <= BigInt(existing.version)) continue
        const cutoff = BigInt(successor.effectiveFrom)
        if (until === null || cutoff < until) until = cutoff
      }
      const from = BigInt(existing.effectiveFrom)
      if (until !== null && (until <= from || until <= start) || end !== null && end <= from) continue
      if (String(existing.schemaRef) !== WORLD_EXTERNAL_MEDIATION_FACT_SCHEMA_REF)
        deny('fact-conflict', 'Unknown overlapping authoritative semantics cannot become an overwritten premise')
      const payload: unknown = existing.payload
      if (payload === null || typeof payload !== 'object' || !('claim' in payload))
        deny('fact-conflict', 'Overlapping authoritative semantic body is unavailable')
      const prior = simulationExternalClaimSchema.parse(payload.claim)
      if (prior.kind !== 'condition' && outcome.claim.kind !== 'condition' && semanticAxis(prior) === semanticAxis(outcome.claim)) {
        const original = simulationExternalAdjudicatedFactPayloadSchema.safeParse(payload)
        if (!original.success) deny('fact-conflict', 'Historical as-of authority lost its original Native cursor')
        const cursor = original.data.provenance.event?.consumedSequence ?? original.data.provenance.adjudicationSequence
        if (cursor === existing.sequence && cursor <= state.revision && BigInt(original.data.asOf) <= BigInt(state.time)) continue
      }
      if (semanticAxis(prior) === semanticAxis(outcome.claim) && !isDeepStrictEqual(prior, outcome.claim))
        deny('fact-conflict', 'Overlapping semantic conditions conflict regardless of factKey, including retained future facts')
    }
  }
}
/**
 * Verify an external obligation through its actual accepted source and transfer terms.
 * @param state - Native prefix with original operation and account owners.
 * @param id - Exact obligation identity.
 * @param subject - Original external organization.
 * @returns whether the actual parties or explicitly controlled transfer accounts establish this association.
 */
export function contractBelongsToSubject(state: SimulationSnapshot, id: string, subject: SimulationEntityId): boolean {
  const contract = Object.values(state.commitments).find(value => value.id === id)
  if (contract === undefined) return false
  const interaction = state.interactions[contract.interactionId]
  const creator = interaction === undefined ? undefined : state.operations[interaction.createdBy]
  const acceptance = state.operations[contract.createdBy]
  if (interaction?.commitmentId !== contract.id || interaction.assignee !== contract.debtor || interaction.requester !== contract.creditor
    || creator?.action.kind !== 'interaction/request' || creator.result?.status !== 'applied'
    || creator.entityId !== contract.creditor || creator.action.id !== interaction.id || creator.action.assignee !== contract.debtor
    || acceptance?.action.kind !== 'interaction/accept' || acceptance.result?.status !== 'applied'
    || acceptance.entityId !== contract.debtor || acceptance.action.id !== interaction.id
    || !isDeepStrictEqual(creator.action.fulfillment, interaction.fulfillment)) return false
  if (contract.debtor === subject || contract.creditor === subject) return true
  if (interaction.fulfillment.kind !== 'transfer') return false
  const from = state.resources[interaction.fulfillment.from], to = state.resources[interaction.fulfillment.to]
  if (from === undefined || to === undefined || from.kind !== to.kind || from.unit !== to.unit
    || from.owner !== subject && to.owner !== subject) return false
  if (contract.phase !== 'fulfilled') return from.controllers.includes(contract.debtor)
  return contract.evidence.some((operationId) => {
    const transfer = state.operations[operationId]
    const transaction = transfer === undefined ? undefined : simulationResourceTransaction(state, transfer)
    return transfer?.result?.status === 'applied' && transaction?.commitmentId === contract.id && transaction.transfers.some(value =>
      value.from === from.id && value.to === to.id
          && value.quantity === (interaction.fulfillment.kind === 'transfer' ? interaction.fulfillment.quantity : undefined))
  })
}

function assertOutcome(state: SimulationSnapshot, request: Request, outcome: Outcome,
  identity: AdjudicationRecord['identityId'], policy: SimulationExternalAdjudicationPolicy, requester: SimulationEntityId): void {
  if (outcome.subjectRef !== request.subjectRef
    || !request.responseScope.allowed.includes(outcome.kind) || !policy.allowedOutcomeKinds.includes(outcome.kind))
    deny('policy', 'Outcome differs from its original subject, family or installed policy')
  disclosureAudience(state, request, outcome, requester, policy)
  for (const evidence of outcome.evidence) if (!evidenceMatches(state, evidence)) deny('evidence',
    'Outcome refers to missing or changed Native evidence')
  switch (outcome.kind) {
    case 'environmental-fact':
      if (BigInt(outcome.effectiveFrom) < BigInt(state.time)) deny('time', 'Adjudication cannot replace past facts')
      validateClaim(state, request, outcome.claim, policy, outcome.effectiveFrom)
      factConflict(state, request, outcome)
      break
    case 'delayed-event':
      if (BigInt(outcome.deliverAt) <= BigInt(state.time) || BigInt(outcome.deliverAt) > BigInt(state.spec.maxTime)
        || BigInt(outcome.deliverAt) - BigInt(state.time) > BigInt(policy.maxDelay)) deny('time',
        'Event is outside its frozen positive delay')
      assertOutcome(state, request, outcome.outcome, identity, policy, requester)
      if (!isDeepStrictEqual(outcome.outcome.disclosure, outcome.disclosure)) deny('disclosure',
        'Delayed leaf widens its original disclosure')
      break
    case 'representative-preparation-plan': {
      if (request.input.contactUnit === undefined || outcome.contactUnit !== request.input.contactUnit)
        deny('policy', 'Representative contact unit differs from the original requester-authorized dimension')
      const template = state.world?.definition.templates.find(value => value.id === outcome.preparation.templateId
        && value.version === outcome.preparation.templateVersion)
      const persona = outcome.preparation.persona
      if (template === undefined || !template.names.includes(persona.name) || !isDeepStrictEqual(template.skills, persona.skills)
        || !isDeepStrictEqual(template.traits, persona.traits) || !isDeepStrictEqual(template.goals, persona.goals))
        deny('persona', 'Representative preparation requires the original complete finite template')
      break
    }
    case 'unverified-report':
      if (request.input.quoteScope === undefined) deny('policy',
        'Unverified quotations require request.input.quoteScope with an authorized unit and currency; use another allowed outcome when it is absent')
      if (outcome.quote.unit !== request.input.quoteScope.unit
        || outcome.quote.price.currency !== request.input.quoteScope.currency)
        deny('policy', 'Quote dimensions differ from the original requester-authorized unit and currency')
      if (outcome.quote.validUntil !== null && BigInt(outcome.quote.validUntil) <= BigInt(state.time)) deny('time',
        'Quote report is already expired')
      break
    case 'failure': break
    default: assertNever(outcome)
  }
}

function owned(state: SimulationSnapshot) {
  if (state.world === undefined) throw new SimulationWorldError('SIM_WORLD_NOT_CONFIGURED', 'Adjudication needs its original World')
  return state.world
}
function policyFor(state: SimulationSnapshot): SimulationExternalAdjudicationPolicy {
  const value = owned(state).definition.externalAdjudicationPolicy
  if (value === undefined) deny('policy', 'Director-mediated policy was not installed in the frozen World definition')
  return resolveExternalAdjudicationPolicy(value)
}
function parsed(state: SimulationSnapshot, payload: unknown, requester: SimulationEntityId): Request {
  const request = simulationExternalMediatedRequestSchema.parse(payload), subject = state.entities[request.subjectRef]
  const policy = policyFor(state)
  if (request.responseScope.allowed.some(kind => !policy.allowedOutcomeKinds.includes(kind)))
    deny('policy', 'Request response families exceed the frozen installed policy')
  resolveDisclosure(state, request.responseScope.disclosure, requester, policy)
  if (request.scope !== owned(state).definition.organizationEntityId || subject?.kind !== 'organization'
    || subject.cognition !== 'none' || subject.phase !== 'active' || subject.readiness !== 'ready' || subject.id === request.scope)
    deny('subject', 'Adjudication requires the original active noncognitive external subject')
  const identity = owned(state).external.identities[externalIdentityId(state, request)]
  assertRepresentationAdmission(state, request.subjectRef, externalIdentityId(state, request), 'director-mediated')
  if (identity !== undefined && identity.subjectRef !== request.subjectRef) deny('subject',
    'Stable external key names another original subject')
  return request
}
/**
 * Preserve the original creation representation when another installed representation uses this business identity.
 * @param state - Original accepted-request prefix.
 * @param intent - Exact mediated Native intent.
 * @param requestId - Its original accepted case.
 * @param sequence - Exact acceptance position.
 * @returns same registry for an existing identity, or one immutable original identity; no actor is allocated.
 */
export function acceptExternalMediatedIdentity(state: SimulationSnapshot, intent: SimulationWorldIntent,
  requestId: SimulationWorldPlan['requestId'], sequence: number): SimulationExternalState {
  if (!isDeepStrictEqual(intent.pin, WORLD_EXTERNAL_MEDIATED_PIN)) deny('source', 'Identity acceptance has a different original pin')
  const request = parsed(state, intent.payload, worldRoleRequester(intent)), external = owned(state).external,
    id = externalIdentityId(state, request)
  if (external.identities[id] !== undefined) return external
  const identity = simulationExternalIdentitySchema.parse({ id, scope: request.scope, externalKey: request.externalKey,
    subjectRef: request.subjectRef, representation: 'director-mediated', policyRef: request.policyRef,
    revision: 1, source: { kind: 'request', requestId }, sequence })
  return bounded(state, { ...external, identities: { ...external.identities, [id]: identity } })
}
function bounded(state: SimulationSnapshot, external: SimulationExternalState): SimulationExternalState {
  if (Buffer.byteLength(JSON.stringify(external), 'utf8') > state.spec.maxKnowledgeBytes)
    throw new SimulationWorldError('SIM_WORLD_LIMIT', 'Complete external adjudication history exceeds its frozen byte allowance', 'bytes')
  return external
}
function source(state: SimulationSnapshot, mutation: SimulationWorldDomainMutation, proposed: SimulationExternalMediatedEffect) {
  const effect = simulationExternalMediatedEffectSchema.parse(proposed), world = owned(state), plan = world.plans[mutation.planId]
  const request = world.requests[mutation.requestId], intent = request === undefined ? undefined : world.intents[request.intentId]
  if (intent === undefined || plan?.status !== 'accepted' || plan.proposal.resolution.kind !== 'apply' || request?.status !== 'open'
    || request.plans.at(-1) !== plan.id || plan.requestId !== request.id || effect.intentId !== intent.id || effect.planId !== plan.id
    || !isDeepStrictEqual(mutation.pin, WORLD_EXTERNAL_MEDIATED_PIN) || !isDeepStrictEqual(plan.pin, mutation.pin)
    || !isDeepStrictEqual(intent.pin, mutation.pin) || mutation.id !== `world-mutation:${plan.id}`
    || mutation.time !== state.time || mutation.sequence !== state.revision + 1 || world.external.adjudications[intent.id] !== undefined)
    deny('source', 'Adjudication lost its latest original accepted plan, sole mutation or original clocks')
  simulationExternalMediatedMutationSchema.parse(mutation.payload)
  const input = parsed(state, intent.payload, worldRoleRequester(intent)),
    proposal = simulationExternalMediatedPlanSchema.parse(plan.proposal.resolution.payload)
  const identityId = externalIdentityId(state, input)
  if (world.external.identities[identityId] === undefined) deny('source', 'Adjudication lost its accepted original identity')
  return { intent, plan, request: input, proposal, identityId, requester: worldRoleRequester(request) }
}
function actualInputs(state: SimulationSnapshot, request: Request): AdjudicationRecord['actualInputs'] {
  const commitments = Object.values(state.commitments).filter(value => contractBelongsToSubject(state, value.id, request.subjectRef))
    .sort((a, b) => a.id.localeCompare(b.id))

  const accounts = new Set(Object.values(state.resources).filter(value => value.owner === request.subjectRef).map(value => value.id))
  for (const contract of commitments) {
    const interaction = state.interactions[contract.interactionId]
    if (interaction?.fulfillment.kind === 'transfer') { accounts.add(interaction.fulfillment.from); accounts.add(interaction.fulfillment.to) }
  }
  const subject = state.entities[request.subjectRef]
  if (subject === undefined) deny('subject', 'Original external subject is absent')
  return simulationExternalAdjudicationInputsSchema.parse({ subject: { id: request.subjectRef, revision: subject.revision },
    resources: Object.values(state.resources).filter(value => accounts.has(value.id)).sort((a, b) => a.id.localeCompare(b.id)), commitments,
    facts: Object.values(owned(state).facts).flat().filter(value => value.subject === request.subjectRef && value.scope === request.scope)
      .sort((a, b) => a.factId.localeCompare(b.factId) || Number(BigInt(a.version) - BigInt(b.version))) })
}
function checkedInputHash(state: SimulationSnapshot, request: Request): string { return fingerprint(actualInputs(state, request)) }
function publication(state: SimulationSnapshot, record: AdjudicationRecord,
  outcome: Extract<Outcome, { kind: 'environmental-fact' }>, sequence: number,
  event?: { eventId: SimulationExternalAdjudicatedEventState['original']['eventId']; consumedSequence: number }): SimulationWorldFactRequest {
  const factId = factIdentity(record.identityId, outcome.factKey), history = owned(state).facts[factId] ?? [], prior = history.at(-1)
  const requester = owned(state).requests[record.requestId]?.requesterEntityId
  const plan = owned(state).plans[record.planId]
  if (requester === undefined || plan === undefined) deny('source', 'Fact publication lost its original requester or plan')
  return simulationWorldFactAdjudicatedRequestSchema.parse({ factId,
    version: worldFactVersionSchema.parse(String(BigInt(prior?.version ?? '0') + 1n)), subject: record.request.subjectRef,
    scope: record.request.scope, schemaRef: WORLD_EXTERNAL_MEDIATION_FACT_SCHEMA_REF,
    effectiveFrom: outcome.effectiveFrom, effectiveUntil: outcome.effectiveUntil, availableAt: state.time,
    audience: disclosureAudience(state, record.request, outcome, worldRoleRequester({ requesterEntityId: requester }),
      resolveExternalAdjudicationPolicy(record.policyParameters)),
    supersedes: prior === undefined ? null : { factId, version: prior.version },
    payload: { claim: outcome.claim, asOf: state.time, provenance: { kind: 'external-adjudication', identityId: record.identityId,
      intentId: record.intentId, requestId: record.requestId, planId: record.planId, adjudicationSequence: record.sequence,
      policyFingerprint: record.policyFingerprint, ...event === undefined ? {} : { event } } },
    sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: record.sequence < sequence ? record.sequence : plan.sequence }] })
}
/**
 * Capture actual checked inputs and the canonical publication before the sole Native append.
 * @param state - Original accepted-plan execution prefix.
 * @param mutation - Native-derived identity, pin and clocks.
 * @param effect - Closed instruction naming only the original intent and plan.
 * @returns strict original adjudication; changed authority, source, semantic claim or disclosure rejects before effects.
 */
export function prepareExternalAdjudication(state: SimulationSnapshot, mutation: SimulationWorldDomainMutation,
  effect: SimulationExternalMediatedEffect): AdjudicationRecord {
  const original = source(state, mutation, effect), policy = policyFor(state)
  assertOutcome(state, original.request, original.proposal.outcome, original.identityId, policy, original.requester)
  const record = simulationExternalAdjudicationSchema.parse({ identityId: original.identityId, intentId: original.intent.id,
    requestId: original.plan.requestId, planId: original.plan.id, request: original.request, proposal: original.proposal,
    basis: deriveBasis(state, original.plan, policy), policyParameters: policy.parameters, policyFingerprint: policy.fingerprint,
    actualEvidence: original.proposal.outcome.evidence, actualInputs: actualInputs(state, original.request),
    actualInputHash: checkedInputHash(state, original.request),
    time: mutation.time, recordedAt: mutation.recordedAt, sequence: mutation.sequence })
  if (record.proposal.outcome.kind !== 'environmental-fact') return record
  return simulationExternalAdjudicationSchema.parse({ ...record, actualPublication: publication(state, record,
    record.proposal.outcome, record.sequence) })
}
/** Owner-consumable projection: this module cannot append Fact, queue, result, resource or Actor records itself. */
export interface SimulationExternalAdjudicationProjection {
  /** Complete original registry, with no resource or contract writes. */
  readonly external: SimulationExternalState
  /** Canonical captured publications for the original Fact owner to fold atomically. */
  readonly publications: readonly SimulationWorldFactRequest[]
  /** Finite original duty for the existing scheduler owner. */
  readonly event?: SimulationExternalAdjudicatedEventState
  /** Safe original director result, published only alongside the actual effects. */
  readonly resultPayload: SimulationWorldJsonValue
}
/**
 * Derive the safe result from actual verified owner effects.
 * @param state - Original Native world with its immutable director.
 * @param record - Strict retained original source and proposal.
 * @param actualActor - Actual Actor commit refs; required only for representative preparation.
 * @returns scenario-attributed strict result with no private rationale; uncommitted actor or fact claims reject.
 */
export function externalAdjudicationResult(state: SimulationSnapshot, record: AdjudicationRecord,
  actualActor?: z.infer<typeof import('@clocky/clocky-simulation').simulationExternalMediatedReadyActorSchema>): SimulationWorldJsonValue {
  const selected = record.proposal.outcome
  let outcome: unknown
  switch (selected.kind) {
    case 'environmental-fact':
      if (record.actualPublication === undefined) deny('source', 'Fact outcome lacks its actual canonical publication')
      outcome = { kind: selected.kind, fact: { factId: record.actualPublication.factId, version: record.actualPublication.version } }; break
    case 'unverified-report': outcome = { kind: selected.kind, reliability: 'unverified',
      statement: 'Unverified scenario-generated quotation; this report does not change balances or commitments.',
      quote: selected.quote }; break
    case 'failure': outcome = { kind: selected.kind, code: selected.code, description: externalFailureDescriptions[selected.code] }; break
    case 'delayed-event': outcome = { kind: selected.kind, eventId: eventId(record, selected.key), deliverAt: selected.deliverAt,
      status: 'scheduled' }; break
    case 'representative-preparation-plan':
      if (actualActor === undefined) deny('source', 'A finite preparation proposal is not an actually committed representative')
      outcome = { kind: 'representative-prepared', actual: actualActor }; break
    default: return assertNever(selected)
  }
  return z.json().parse(simulationExternalMediatedResultSchema.parse({ identityId: record.identityId, subjectRef: record.request.subjectRef,
    sourceKind: 'director-mediated', attribution: 'scenario-generated', policyRef: record.request.policyRef,
    policyVersion: record.policyParameters.version, policyFingerprint: record.policyFingerprint,
    adjudicatorEntityId: owned(state).definition.directorEntityId, evidence: safeResultEvidence(state, record),
    disclosure: selected.disclosure, outcome }))
}
function safeResultEvidence(state: SimulationSnapshot, record: AdjudicationRecord): AdjudicationRecord['actualEvidence'] {
  const intent = owned(state).intents[record.intentId]
  if (intent === undefined) deny('source', 'Result evidence lost its original requester declaration')
  return record.actualEvidence.filter(reference => intent.evidence.some(original => isDeepStrictEqual(reference, original)))
}
const externalFailureDescriptions = Object.freeze({
  unavailable: 'The simulated external subject is unavailable.',
  declined: 'The simulated external subject declined this request.',
  unsupported: 'This request is unsupported by the installed simulation policy.',
  'dependency-unmet': 'A required simulated dependency is unmet.',
  expired: 'The simulated offer has expired.',
})
function eventId(record: AdjudicationRecord, key: string) {
  return simulationEventIdSchema.parse(`simulation-external-adjudication:${record.intentId}:${fingerprint([record.intentId,
    key]).slice(7)}`)
}
/**
 * Verify the retained original prefix and propose the complete atomic owner effects.
 * @param state - Original pre-append Native projection.
 * @param mutation - Sole original mutation and clocks.
 * @param effect - Exact closed original instruction.
 * @param retained - Captured actual adjudication; absence or any alteration rejects replay.
 * @returns same Native external book plus canonical publications, optional finite event and safe result.
 */
export function applyExternalAdjudication(state: SimulationSnapshot, mutation: SimulationWorldDomainMutation,
  effect: SimulationExternalMediatedEffect, retained: AdjudicationRecord | undefined): SimulationExternalAdjudicationProjection {
  if (retained === undefined) deny('source', 'Adjudication append lacks its actual original record')
  const record = simulationExternalAdjudicationSchema.parse(retained), expected = prepareExternalAdjudication(state, mutation, effect)
  if (!isDeepStrictEqual(record, expected)) deny('source',
    'Retained adjudication differs from its original actual basis, evidence or canonical publication')
  const selected = record.proposal.outcome
  if (selected.kind === 'representative-preparation-plan') deny('source',
    'Representative preparation must commit through its original Actor owner')
  const event = selected.kind !== 'delayed-event' ? undefined : simulationExternalAdjudicatedEventStateSchema.parse({
    original: { eventId: eventId(record, selected.key), intentId: record.intentId, requestId: record.requestId,
      planId: record.planId, identityId: record.identityId, adjudicationSequence: record.sequence, key: selected.key,
      deliverAt: selected.deliverAt, leaf: selected.outcome, leafHash: fingerprint(selected.outcome),
      policyFingerprint: record.policyFingerprint,
      evidence: selected.outcome.evidence, initialResultId: worldResultIdSchema.parse(`world-result:${record.intentId}`) },
    status: 'scheduled', blocks: [] })
  const external = owned(state).external
  return { external: bounded(state, { ...external, adjudications: { ...external.adjudications, [record.intentId]: record },
    events: event === undefined ? external.events : { ...external.events, [event.original.eventId]: event } }),
  publications: record.actualPublication === undefined ? [] : [record.actualPublication],
  ...event === undefined ? {} : { event }, resultPayload: externalAdjudicationResult(state, record) }
}
/** Native registration uses this closed capability; its director role is fixed by the original operation pin. */
export class ExternalMediatedNativeWorldDomain implements NativeWorldDomain {
  readonly definition = WORLD_EXTERNAL_MEDIATED_DEFINITION
  readonly ref = WORLD_EXTERNAL_MEDIATED_PIN.implementationRef
  readonly generation = WORLD_EXTERNAL_MEDIATED_PIN.generation
  readonly acceptedResponsibility = 'external-mediated-identity' as const
  readonly resultNotificationRole = 'director' as const
  personnelSubjects(_intent: SimulationWorldIntent): readonly SimulationEntityId[] { return [] }
  /**
   * @param state - Original authenticated request prefix.
   * @param actor - Actual requester authenticated by Native.
   * @param request - Original strict body and response scope.
   * @returns normalized scoped request; absent policy or excessive families/readers reject before identity acceptance.
   */
  admitRequest(state: SimulationSnapshot, actor: SimulationEntityId, request: SimulationWorldDomainRequest) {
    if (request.expectedTime !== null) deny('time', 'Adjudication uses its original next safe boundary')
    const input = parsed(state, request.payload, actor)
    if (actor === owned(state).definition.directorEntityId && input.responseScope.allowed.includes('representative-preparation-plan'))
      deny('source', 'Scenario-directed environment requests cannot prepare representatives or fabricate a requester conversation')
    return { scopeEntityId: input.scope, targetEntityId: input.subjectRef, description: input.input.question,
      payload: z.json().parse(input) }
  }
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent, actorId?: SimulationEntityId) {
    const request = parsed(state, intent.payload, worldRoleRequester(intent)), policy = policyFor(state)
    const director = actorId === owned(state).definition.directorEntityId
    return z.json().parse({ externalMediated: request, policy: { parameters: policy.parameters, fingerprint: policy.fingerprint },
      templates: director ? owned(state).definition.templates : [],
      inventory: Object.values(state.resources).filter(value => value.owner === request.subjectRef && value.kind === 'inventory')
        .map(({ id, revision, unit, quantity }) => ({ id, revision, unit, quantity })),
      balances: !director ? [] : Object.values(state.resources).filter(value =>
        value.owner === request.subjectRef
        && (value.kind === 'inventory' || value.controllers.includes(owned(state).definition.directorEntityId)))
        .map(({ id, revision, kind, unit, quantity }) => ({ id, revision, kind, unit, quantity })),
      commitments: !director ? [] : Object.values(state.commitments).filter(value =>
        contractBelongsToSubject(state, value.id, request.subjectRef))
        .map(({ id, revision, phase }) => ({ id, revision, phase })) })
  }
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void {
    if (resolution.kind === 'reject') return
    const proposal = simulationExternalMediatedPlanSchema.parse(resolution.payload), request = parsed(state, intent.payload,
      worldRoleRequester(intent))
    assertOutcome(state, request, proposal.outcome, externalIdentityId(state, request), policyFor(state), worldRoleRequester(intent))
  }
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent) {
    const input = parsed(state, intent.payload, worldRoleRequester(intent)), subject = state.entities[input.subjectRef],
      policy = policyFor(state)
    if (subject === undefined) deny('subject', 'Original external subject is absent')
    return simulationWorldReadSetSchema.parse([{ kind: 'entity', id: subject.id, revision: subject.revision },
      { kind: 'external', id: externalIdentityId(state, input), revision: 1 },
      { kind: 'external-adjudication-policy', policyRef: policy.ref, generation: policy.generation, hash: policy.fingerprint },
      { kind: 'world-fact-set', subject: input.subjectRef, scope: input.scope, hash: fingerprint(Object.values(owned(state).facts).flat()
        .filter(value => value.subject === input.subjectRef && value.scope === input.scope)) },
      { kind: 'commitment-party-set', subject: input.subjectRef, hash: fingerprint(Object.values(state.commitments)
        .filter(value => value.debtor === input.subjectRef || value.creditor === input.subjectRef).sort((a, b) =>
          a.id.localeCompare(b.id))) },
      ...Object.values(state.resources).filter(value => value.owner === input.subjectRef
        && (value.kind === 'inventory' || value.controllers.includes(owned(state).definition.directorEntityId)))
        .sort((a,b) => a.id.localeCompare(b.id)).map(value => ({ kind: 'resource', id: value.id, revision: value.revision })),
      ...Object.values(state.commitments).filter(value => contractBelongsToSubject(state, value.id, input.subjectRef))
        .sort((a,b) => a.id.localeCompare(b.id)).map(value => ({ kind: 'commitment', id: value.id, revision: value.revision,
          hash: fingerprint(value) })),
      ...[...new Set(Object.values(state.resources).filter(value => value.owner === input.subjectRef
        && value.kind === 'inventory').map(value => value.unit))]
        .sort().map(unit => ({ kind: 'resource-owner-set', owner: input.subjectRef, unit,
          hash: fingerprint(inventoryInputs(state, input.subjectRef, unit)) }))])
  }
  firstActionActor(_state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult) {
    const payload = simulationExternalMediatedResultSchema.parse(result.payload)
    return result.outcome.kind === 'committed' && 'outcome' in payload && payload.outcome.kind === 'representative-prepared'
      ? worldRoleRequester(intent) : undefined
  }
  resultContext(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult,
    purpose: 'result' | 'first-action') {
    if (purpose !== 'first-action' || result.outcome.kind !== 'committed') return undefined
    const payload = simulationExternalMediatedResultSchema.parse(result.payload)
    if (!('outcome' in payload) || payload.outcome.kind !== 'representative-prepared') return undefined
    const original = owned(state).external.representatives[intent.id], actual = payload.outcome.actual
    if (original?.status !== 'committed' || original.adjudication === undefined || actual.identityId !== original.identityId
      || actual.entityId !== original.identities.entityId || actual.relationId !== original.identities.relationId
      || actual.requesterEntityId !== worldRoleRequester(intent) || actual.channelId !== original.identities.channels[1].channelId
      || state.entities[actual.entityId]?.readiness !== 'ready') deny('source',
      'Mediated first contact lost its actual committed representative')
    return { expectedActorId: worldRoleRequester(intent), recipient: actual.entityId, channelId: actual.channelId,
      facts: { externalContact: { identityId: actual.identityId, subjectRef: payload.subjectRef,
        representativeEntityId: actual.entityId, unit: actual.contactUnit } } }
  }
  reduceMutation(_state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan, payload: SimulationWorldJsonValue) {
    simulationExternalMediatedMutationSchema.parse(payload)
    return { changes: [], externalAdjudicationEffects: [{ kind: 'external/adjudicate-original' as const, intentId: intent.id,
      planId: plan.id }], resultPayload: {} }
  }
}
function assertNever(value: never): never { throw new Error(`Unrecognized closed adjudication member: ${String(value)}`) }
/** Exact finite event constraint failures. The scheduler retains a blocked original duty and records this typed reason. */
export type SimulationExternalAdjudicatedEventBlockCode = SimulationExternalAdjudicatedEventState['blocks'][number]['code']
/**
 * Revalidate the retained closed leaf against current authority without inference or writes.
 * @param state - Exact current scheduler prefix at the original delivery boundary.
 * @param retained - Original finite event responsibility.
 * @returns typed blocking reason, or undefined for a valid original leaf; a block retains responsibility.
 */
export function validateExternalAdjudicatedEvent(state: SimulationSnapshot,
  retained: SimulationExternalAdjudicatedEventState): SimulationExternalAdjudicatedEventBlockCode | undefined {
  const event = simulationExternalAdjudicatedEventStateSchema.parse(retained), original = event.original
  const record = owned(state).external.adjudications[original.intentId]
  if (record === undefined || record.proposal.outcome.kind !== 'delayed-event'
    || record.sequence !== original.adjudicationSequence || record.identityId !== original.identityId
    || record.requestId !== original.requestId || record.planId !== original.planId
    || original.eventId !== eventId(record, record.proposal.outcome.key)
    || original.deliverAt !== record.proposal.outcome.deliverAt || original.leafHash !== fingerprint(original.leaf)
    || !isDeepStrictEqual(original.leaf, record.proposal.outcome.outcome) || !isDeepStrictEqual(original.evidence, original.leaf.evidence))
    return 'source-change'
  const policy = policyFor(state)
  if (policy.fingerprint !== original.policyFingerprint || policy.fingerprint !== record.policyFingerprint
    || !isDeepStrictEqual(policy.parameters, record.policyParameters)) return 'policy-mismatch'
  if (BigInt(state.time) < BigInt(original.deliverAt)) return 'source-change'
  const request = owned(state).requests[record.requestId]
  if (request?.status !== 'committed') return 'source-change'
  if (!requesterAuthority(state, worldRoleRequester(request), record.request,
    owned(state).intents[record.intentId])) return 'authority-conflict'
  try {
    parsed(state, record.request, worldRoleRequester(request))
    assertOutcome(state, record.request, original.leaf, record.identityId, policy, worldRoleRequester(request))
  } catch (error: unknown) {
    if (!(error instanceof SimulationExternalAdjudicationError)) throw error
    switch (error.category) {
      case 'policy': return 'policy-mismatch'
      case 'disclosure': return 'disclosure-invalid'
      case 'inventory': case 'resource': return 'resource-conflict'
      case 'contract': return 'contract-conflict'
      case 'fact-conflict': return 'fact-conflict'
      case 'authority': case 'subject': return 'authority-conflict'
      case 'source': case 'evidence': case 'time': case 'condition': case 'persona': return 'source-change'
      default: return assertNever(error.category)
    }
  }
  return undefined
}
/**
 * Capture one canonical Fact version and safe result before the atomic scheduler consumption.
 * @param state - Original pre-consumption prefix.
 * @param retained - Original finite pending responsibility.
 * @param sequence - Sole next append position.
 * @returns exact retained consumption and publications, or a typed block with the checked current input hash.
 */
export function prepareExternalAdjudicatedEventConsumption(state: SimulationSnapshot,
  retained: SimulationExternalAdjudicatedEventState, sequence: number):
  { readonly consumption: NonNullable<SimulationExternalAdjudicatedEventState['consumption']>
    readonly publications: readonly SimulationWorldFactRequest[]
    readonly resultPayload: SimulationWorldJsonValue }
  | { readonly block: { readonly code: SimulationExternalAdjudicatedEventBlockCode; readonly currentReadSetHash: string } } {
  const code = validateExternalAdjudicatedEvent(state, retained)
  const record = owned(state).external.adjudications[retained.original.intentId]
  if (record === undefined) return { block: { code: 'source-change', currentReadSetHash: fingerprint(null) } }
  const requester = owned(state).requests[record.requestId]?.requesterEntityId
  const currentInputHash = fingerprint({ input: checkedInputHash(state, record.request),
    requester: requester == null ? null : state.entities[requester],
    grants: worldOperationGrants(state).filter(value => value.requesterEntityId === requester),
    relations: Object.values(state.relations).filter(value => value.subject === requester).sort((a, b) => a.id.localeCompare(b.id)) })
  if (code !== undefined) return { block: { code, currentReadSetHash: currentInputHash } }
  if (retained.status === 'consumed' || sequence !== state.revision + 1) deny('source',
    'Event consumption requires its original pending next append')
  const leaf = retained.original.leaf, actualPublication = leaf.kind === 'environmental-fact'
    ? publication(state, record, leaf, sequence, { eventId: retained.original.eventId, consumedSequence: sequence }) : undefined
  const leafRecord = simulationExternalAdjudicationSchema.parse({ ...record, proposal: { kind: 'adjudicate', outcome: leaf },
    actualEvidence: leaf.evidence,
    ...actualPublication === undefined ? {} : { actualPublication } })
  const resultPayload = externalAdjudicationResult(state, leafRecord)
  const consumption = { sequence, time: state.time, checkedInputHash: currentInputHash, leafHash: retained.original.leafHash,
    publicationRefs: actualPublication === undefined ? leaf.kind === 'unverified-report' ? [{ kind: 'report' as const,
      intentId: record.intentId }] : []
      : [{ factId: actualPublication.factId, version: actualPublication.version }],
    ...actualPublication === undefined ? {} : { actualPublication }, resultPayload }
  const parsed = simulationExternalAdjudicatedEventStateSchema.parse({ ...retained, status: 'consumed', consumption }).consumption
  if (parsed === undefined) deny('source', 'Completed original event omitted its consumption')
  return { consumption: parsed, publications: actualPublication === undefined ? [] : [actualPublication], resultPayload }
}
/**
 * Revalidate a retained consumption against its original prefix without choosing a new leaf.
 * @param state - Original pre-consumption projection.
 * @param retained - Original finite duty.
 * @param consumption - Actual captured consumption from the Native journal.
 * @returns the exact verified publication/result projection; changed or blocked consumption rejects.
 */
export function applyExternalAdjudicatedEventConsumption(state: SimulationSnapshot,
  retained: SimulationExternalAdjudicatedEventState, consumption: NonNullable<SimulationExternalAdjudicatedEventState['consumption']>): {
  readonly consumption: NonNullable<SimulationExternalAdjudicatedEventState['consumption']>
  readonly publications: readonly SimulationWorldFactRequest[]
  readonly resultPayload: SimulationWorldJsonValue
} {
  const expected = prepareExternalAdjudicatedEventConsumption(state, retained, consumption.sequence)
  if ('block' in expected || !isDeepStrictEqual(expected.consumption, consumption)) deny('source',
    'Event consumption lost its exact checked leaf or captured publication')
  return expected
}
/**
 * Capture a preparation source before original canonical Actor IO.
 * @param state - Original accepted-plan reserve prefix.
 * @param planId - Exact original finite preparation plan.
 * @param sequence - Actual reserve append position.
 * @param recordedAt - Actual Native reserve recording clock.
 * @returns immutable mediated source; a non-representative plan rejects.
 */
export function prepareExternalRepresentativeAdjudication(state: SimulationSnapshot, planId: SimulationWorldPlan['id'],
  sequence: number, recordedAt: number): AdjudicationRecord {
  const world = owned(state), plan = world.plans[planId], request = plan === undefined ? undefined : world.requests[plan.requestId]
  if (plan === undefined || request === undefined) deny('source', 'Representative preparation lost its original accepted source')
  const record = prepareExternalAdjudication(state, { kind: 'world/mutation',
    id: `world-mutation:${plan.id}` as SimulationWorldDomainMutation['id'],
    requestId: request.id, planId: plan.id, pin: plan.pin, time: state.time, sequence, recordedAt,
    payload: { kind: 'apply-original-adjudication' } }, { kind: 'external/adjudicate-original', intentId: request.intentId,
    planId: plan.id })
  if (record.proposal.outcome.kind !== 'representative-preparation-plan') deny('source',
    'Actor reservation requires the original finite representative outcome')
  return record
}
/**
 * Verify the original mediated reserve without replacing its consumed proposal or clocks.
 * @param state - Current original Actor-owner preparation/commit projection.
 * @param retained - Immutable original reserve adjudication.
 * @param planId - Original accepted finite plan.
 * @param revalidateCurrent - True for unfinished preparation; a committed historical source does not reobserve later evidence.
 * @returns normally only when its source, policy, finite Persona and current authority remain exact.
 */
export function verifyExternalRepresentativeAdjudication(state: SimulationSnapshot, retained: AdjudicationRecord,
  planId: SimulationWorldPlan['id'], revalidateCurrent = true): void {
  const record = simulationExternalAdjudicationSchema.parse(retained), world = owned(state), plan = world.plans[planId]
  const request = plan === undefined ? undefined : world.requests[plan.requestId],
    intent = request === undefined ? undefined : world.intents[request.intentId]
  if (plan === undefined || request === undefined || intent === undefined || !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN)
    || plan.proposal.resolution.kind !== 'apply' || record.planId !== plan.id || record.requestId !== request.id
    || record.intentId !== intent.id || !isDeepStrictEqual(record.request, intent.payload)
    || !isDeepStrictEqual(record.proposal, plan.proposal.resolution.payload)
      || record.proposal.outcome.kind !== 'representative-preparation-plan'
    || record.actualPublication !== undefined || record.actualActor !== undefined
      || record.identityId !== externalIdentityId(state, record.request)
    || !isDeepStrictEqual(record.policyParameters, policyFor(state).parameters)
    || !isDeepStrictEqual(record.basis, deriveBasis(state, plan, policyFor(state)))) deny('source',
    'Mediated Actor reserve lost its original consumed basis or installed policy')
  if (revalidateCurrent) assertOutcome(state, record.request, record.proposal.outcome, record.identityId, policyFor(state),
    worldRoleRequester(request))
}
/**
 * Verify every retained original adjudication and safe terminal consequence without reobserving current resources.
 * @param state - Complete replayed or checkpoint projection, including original accepted decisions and historical captured inputs.
 * @returns normally only when original policy, causal source, canonical publications and terminal results remain exact.
 */
export function assertExternalAdjudicationProjection(state: SimulationSnapshot): void {
  if (state.world === undefined) return
  const world = state.world
  for (const result of Object.values(world.results)) {
    if (result.outcome.kind === 'committed' && isDeepStrictEqual(world.requests[result.requestId]?.pin, WORLD_EXTERNAL_MEDIATED_PIN)
      && world.external.adjudications[result.intentId] === undefined) deny('source',
      'Committed mediated result lost its actual original adjudication')
  }
  for (const [id, stored] of Object.entries(world.external.adjudications)) {
    const record = simulationExternalAdjudicationSchema.parse(stored), plan = world.plans[record.planId]
    const intent = world.intents[record.intentId], request = world.requests[record.requestId]
    const result = world.results[worldResultIdSchema.parse(`world-result:${record.intentId}`)]
    const policy = resolveExternalAdjudicationPolicy(record.policyParameters)
    if (id !== record.intentId || plan?.status !== 'accepted' || plan.proposal.resolution.kind !== 'apply'
      || plan.requestId !== request?.id || request.intentId !== record.intentId || request.status !== 'committed'
      || result?.outcome.kind !== 'committed' || result.source.kind !== 'plan' || result.source.planId !== plan.id
      || !isDeepStrictEqual(plan.pin, WORLD_EXTERNAL_MEDIATED_PIN) || !isDeepStrictEqual(intent?.pin, plan.pin)
      || !isDeepStrictEqual(plan.proposal.resolution.payload, record.proposal) || !isDeepStrictEqual(intent?.payload, record.request)
      || record.identityId !== externalIdentityId(state, record.request) || record.sequence > state.revision
      || !isDeepStrictEqual(record.policyParameters, world.definition.externalAdjudicationPolicy)
      || record.policyFingerprint !== policy.fingerprint || fingerprint(record.actualInputs) !== record.actualInputHash
      || record.actualInputs.subject.id !== record.request.subjectRef || record.actualInputs.subject.revision < 1
      || !isDeepStrictEqual(record.actualEvidence, record.proposal.outcome.evidence)
      || !isDeepStrictEqual(record.basis, deriveBasis(state, plan, policy))) deny('source',
      'Adjudication lost its exact original source or captured inputs')
    const selected = record.proposal.outcome
    const historicalFacts: typeof world.facts =
      Object.fromEntries([...new Set(record.actualInputs.facts.map(value => value.factId))].map(factId =>
        [factId, record.actualInputs.facts.filter(value => value.factId === factId)]))
    const historical: SimulationSnapshot = { ...state, time: record.time, revision: record.sequence - 1,
      resources: Object.fromEntries(record.actualInputs.resources.map(value => [value.id, value])),
      commitments: Object.fromEntries(record.actualInputs.commitments.map(value => [value.id, canonicalCommitment(value)])),
      world: { ...world, facts: historicalFacts } }
    if (selected.kind === 'environmental-fact') {
      validateClaim(historical, record.request, selected.claim, policy, selected.effectiveFrom)
      factConflict(historical, record.request, selected)
      if (record.actualPublication === undefined || record.actualActor !== undefined) deny('source',
        'Fact adjudication lost its sole actual publication')
      const captured = record.actualPublication
      const expectedId = factIdentity(record.identityId, selected.factKey)
      if (captured.factId !== expectedId || captured.availableAt !== record.time || captured.payload.asOf !== record.time
        || !isDeepStrictEqual(captured.audience, disclosureAudience(state, record.request, selected, worldRoleRequester(request), policy)))
        deny('source', 'Fact publication changed its original canonical identity, time or frozen readers')
      const published = world.facts[captured.factId]?.find(value => value.version === captured.version)
      if (published === undefined || published.sequence !== record.sequence || published.recordedAt !== record.recordedAt
        || !isDeepStrictEqual(originalPublicationFields(published), record.actualPublication)) deny('source',
        'Adjudicated fact lost its original canonical publication')
    } else if (record.actualPublication !== undefined) deny('source', 'Non-fact adjudication acquired an authoritative publication')
    if (selected.kind === 'representative-preparation-plan') {
      const representative = world.external.representatives[record.intentId], actual = record.actualActor
      if (actual === undefined || representative?.status !== 'committed' || representative.adjudication === undefined
        || !isDeepStrictEqual({ ...record, actualActor: undefined }, { ...representative.adjudication, actualActor: undefined })
        || actual.identityId !== record.identityId || actual.entityId !== representative.identities.entityId
        || actual.relationId !== representative.identities.relationId || actual.requesterEntityId !== worldRoleRequester(request)
        || actual.channelId !== representative.identities.channels[1].channelId || actual.contactUnit !== selected.contactUnit
        || actual.committedSequence !== result.sequence || representative.updatedSequence !== result.sequence)
        deny('source', 'Mediated representative lost its exact actual Actor commit')
    } else if (record.actualActor !== undefined || result.sequence !== record.sequence) deny('source',
      'Adjudication terminal consequence changed its original append')
    const actual = record.actualActor
    const actor = actual === undefined ? undefined : { identityId: actual.identityId, entityId: actual.entityId,
      relationId: actual.relationId, generation: actual.generation, contactUnit: actual.contactUnit,
      requesterEntityId: actual.requesterEntityId, channelId: actual.channelId }
    if (!isDeepStrictEqual(result.payload, externalAdjudicationResult(state, record, actor))) deny('source',
      'Adjudication safe result differs from its actual original effect')
    if (selected.kind !== 'representative-preparation-plan') {
      const mutation = world.mutations[`world-mutation:${record.planId}` as keyof typeof world.mutations]
      if (mutation?.planId !== record.planId || mutation.sequence !== record.sequence || mutation.recordedAt !== record.recordedAt
        || mutation.time !== record.time || !isDeepStrictEqual(mutation.payload, { kind: 'apply-original-adjudication' }))
        deny('source', 'Adjudication lost its sole original mutation')
    }
  }
}
function originalPublicationFields(value: import('@clocky/clocky-simulation').SimulationWorldFact): SimulationWorldFactRequest {
  const { source, sequence: _sequence, recordedAt: _recordedAt, ...fields } = value
  return simulationWorldFactAdjudicatedRequestSchema.parse({ ...fields, sources: source.references })
}

function canonicalCommitment(value: AdjudicationRecord['actualInputs']['commitments'][number]): SimulationCommitment {
  const { taskEvidence, breachedAt, fulfilledAt, ...required } = value
  return { ...required, ...taskEvidence === undefined ? {} : { taskEvidence },
    ...breachedAt === undefined ? {} : { breachedAt }, ...fulfilledAt === undefined ? {} : { fulfilledAt } }
}

function requesterAuthority(state: SimulationSnapshot, actor: SimulationEntityId, request: Request,
  intent: SimulationWorldIntent | undefined): boolean {
  const entity = state.entities[actor]
  if (entity?.phase !== 'active' || entity.cognition !== 'agent' || entity.readiness !== 'ready'
    || entity.binding === undefined || activePersonnelFences(state, actor).length !== 0
    || !owned(state).definition.operations.some(value => isDeepStrictEqual(value, WORLD_EXTERNAL_MEDIATED_PIN))) return false
  if (intent?.scenarioTrigger !== undefined) {
    const declaration = assertDirectorTrigger(state, intent.scenarioTrigger), original = intent.requestId === undefined
      ? undefined : owned(state).requests[intent.requestId]
    return actor === owned(state).definition.directorEntityId && worldRoleRequester(intent) === actor
      && original?.notificationOperationId === null && isDeepStrictEqual(worldDecisionSource(original).trigger, intent.scenarioTrigger)
      && isDeepStrictEqual(intent.pin, WORLD_EXTERNAL_MEDIATED_PIN) && isDeepStrictEqual(intent.payload, request)
      && declaration.domain === 'external' && declaration.operation === 'interact' && declaration.version === '3'
      && declaration.scopeId === request.scope && declaration.targetId === request.subjectRef
  }
  const live = (relation: import('@clocky/clocky-simulation').SimulationRelation) =>
    BigInt(relation.validFrom) <= BigInt(state.time) && (relation.validUntil === null || BigInt(relation.validUntil) > BigInt(state.time))
  if (!Object.values(state.relations).some(value => value.subject === actor && value.relation === 'assignment'
    && value.scope === request.scope && live(value))) return false
  return worldOperationGrants(state).some((value) => {
    if (value.requesterEntityId !== actor || value.domain !== 'external' || value.operation !== 'interact' || value.version !== '3'
      || value.scopeEntityId !== request.scope || value.targetEntityId !== request.subjectRef) return false
    const relation = state.relations[value.relationId]
    return relation !== undefined && relation.subject === actor && relation.object === request.subjectRef
      && relation.scope === request.scope && relation.relation === value.relation && live(relation)
  })
}
