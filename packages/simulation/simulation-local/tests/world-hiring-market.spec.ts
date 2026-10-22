import type { SimulationContextViewEventData } from '@clocky/clocky-session'
import type { SimulationDecision, SimulationOperation } from '@clocky/clocky-simulation'
import { simulationContextConsumptionHash, simulationWorldAuthenticatedUserSourceSchema } from '@clocky/clocky-simulation'
import { OrganizationNativeWorldDomain } from '../src/world-organization.ts'
import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation'
import { hiringResourceSchedulerRecords, requireHiringResourceReservation, commitHiringResourceReservation, assertHiringResourceProjection } from '../src/world-hiring-resources.ts'
import { consumeResourceReservationExpiry } from '../src/resource-reservation.ts'
import { simulationResourceSpecSchema, simulationHiringFeePolicySchema } from '@clocky/clocky-simulation'
/** Native atomic result folds cover actor identity, revision races and immutable hiring obligations. */
import { describe, expect, it } from 'vitest'
import { WORLD_HIRING_MARKET_PIN, WORLD_HIRING_MARKET_DEFINITION, simulationHiringMarketCommandSchema,
  simulationEntityIdSchema, simulationWorldRequestOperationSchema, simulationWorldRoleIntentSchema,
  worldIntentIdSchema, worldRequestIdSchema, worldPlanIdSchema, simulationOperationIdSchema, simulationDecisionIdSchema,
  simulationWriterEpochSchema, simulationDecisionSlotSchema, simulationWorldResolveOperationSchema,
  simulationWorldDomainMutationSchema, simTimeSchema, hiringMarket, hiringMarketAcceptance,
  SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import type { SimulationWorldIntent, SimulationWorldRequest, SimulationWorldPlan, NativeWorldDomain } from '@clocky/clocky-simulation'
import { marketFixture } from './world-hiring-market-fixture.ts'
import { HiringMarketNativeWorldDomain, projectHiringMarket } from '../src/world-hiring-market.ts'
import { businessFingerprint } from '../src/business.ts'
import { foldWorldMutation } from '../src/world-mutation.ts'
import { worldExecutionReads, expandWorldProposals, acceptWorldOperation } from '../src/world.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'

function fixture() {
  const base = marketFixture(), module = new HiringMarketNativeWorldDomain()
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  registry.register(module.definition, module)
  registry.register(base.module.definition, base.module)
  const runtime = new NativeWorldRuntime(registry)
  const state = base.state
  const grants = ['requester', 'candidate'].map(actor => ({ requesterEntityId: simulationEntityIdSchema.parse(actor),
    domain: 'organization', operation: 'hiring-market', version: '1', scopeEntityId: base.payload.organizationEntityId,
    targetEntityId: base.payload.positionEntityId, relationId: base.relation(`market-${actor}`, actor, 'can-market', 'vacancy').id,
    relation: 'can-market' }))
  base.setState({ ...state, spec: { ...state.spec, relationRules: [...state.spec.relationRules,
    { relation: 'can-market', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false }] }, relations: { ...state.relations, ...Object.fromEntries(grants.map(grant => [grant.relationId,
    base.relation(grant.relationId, grant.requesterEntityId, 'can-market', 'vacancy')])) },
  world: { ...state.world!, definition: { ...state.world!.definition,
    operations: [...state.world!.definition.operations, WORLD_HIRING_MARKET_PIN],
    operationGrants: [...state.world!.definition.operationGrants, ...grants] } } })
  let next = 20
  function apply(input: object, actor = 'requester') {
    const command = simulationHiringMarketCommandSchema.parse({
      organizationEntityId: 'organization', positionEntityId: 'vacancy', ...input })
    const actorId = simulationEntityIdSchema.parse(actor), number = next++, s = base.state
    const action = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: 'organization', operation: 'hiring-market',
      version: '1', businessKey: `market-${number}`, expectedTime: null, evidence: [], payload: command })
    const admitted = module.admitRequest(s, actorId, action)
    const parsed = simulationWorldRoleIntentSchema.parse({ id: `market-intent-${number}`, pin: WORLD_HIRING_MARKET_PIN,
      businessKey: action.businessKey, requesterEntityId: actorId, ...admitted, expectedTime: null, evidence: [], sequence: number })
    const { requestId: _, ...withoutRequest } = parsed
    const intent: SimulationWorldIntent = { ...withoutRequest, requestId: worldRequestIdSchema.parse(`market-request-${number}`) }
    const request: SimulationWorldRequest = { ...base.request, id: intent.requestId!, intentId: intent.id, pin: intent.pin,
      requesterEntityId: actorId, proposal: action, description: admitted.description, payloadHash: businessFingerprint(action),
      sequence: number,
      source: { kind: 'decision', decisionId: simulationDecisionIdSchema.parse(`request-${number}`), epoch: simulationWriterEpochSchema.parse('1'),
        binding: s.entities[actorId]!.binding! },
      plans: [worldPlanIdSchema.parse(`market-plan-${number}`)] }
    const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: request.id, supersedes: null,
      resolution: { kind: 'apply', payload: command, rationale: 'Preserve original actor decision.' } })
    let prepared = { ...s, world: { ...s.world!, intents: { ...s.world!.intents, [intent.id]: intent },
      requests: { ...s.world!.requests, [request.id]: request } } }
    const plan: SimulationWorldPlan = { ...base.plan, id: request.plans[0]!, requestId: request.id, pin: intent.pin,
      proposal, reads: worldExecutionReads(prepared, intent, runtime), sequence: number + 1,
      operationId: simulationOperationIdSchema.parse(`plan-op-${number}`), hash: businessFingerprint(proposal) }
    const decisionId = simulationDecisionIdSchema.parse(`director-${number}`)
    prepared = { ...prepared, revision: number + 1, operations: { ...prepared.operations, [plan.operationId]: {
      id: plan.operationId, decisionId, index: 0, entityId: simulationEntityIdSchema.parse('director'), action: proposal,
      dependencies: [], fingerprint: businessFingerprint(proposal), status: 'pending' } },
    decisions: { ...prepared.decisions, [decisionId]: { id: decisionId, entityId: simulationEntityIdSchema.parse('director'),
      epoch: simulationWriterEpochSchema.parse('1'), slot: simulationDecisionSlotSchema.parse('0'), snapshotRevision: number,
      entityRevision: 1, time: prepared.time, status: 'accepted', operationIds: [plan.operationId] } },
    world: { ...prepared.world, plans: { ...prepared.world.plans, [plan.id]: plan } } }
    const mutation = simulationWorldDomainMutationSchema.parse({ kind: 'world/mutation', id: `world-mutation:${plan.id}`,
      requestId: request.id, planId: plan.id, pin: intent.pin, payload: command,
      time: prepared.time, sequence: number + 2, recordedAt: 1 })
    const folded = foldWorldMutation(prepared, { kind: 'world/mutation', mutation }, number + 2, runtime)
    base.setState({ ...folded, revision: number + 2 })
    next += 3
    return hiringMarket(base.state)
  }
  return { ...base, get state() { return base.state }, apply, module,
    close: async () => { runtime.close(); await base.close() } }
}

const draft = { kind: 'draft', id: 'draft', expectedRevision: 0, validUntil: '90',
  body: { templateId: 'original-template', templateVersion: '1', persona: { name: 'New', skills: [], traits: [], goals: [] } } }
function offerSetup(f: ReturnType<typeof fixture>, reservationPolicy: 'on-proposal' | 'on-acceptance' = 'on-acceptance', validUntil = '80') {
  f.apply({ kind: 'vacancy', id: 'job', validUntil: '90', capacity: 1, requirements: [], reservationPolicy })
  f.apply({ kind: 'application', id: 'application', vacancyId: 'job' }, 'candidate')
  return f.apply({ kind: 'offer', id: 'offer', expectedRevision: 0, vacancyId: 'job', applicationId: 'application',
    planId: 'existing-plan', candidateId: 'candidate', validUntil,
    terms: 'One original assignment. No recurring salary.' }).offers.get('offer')!
}

describe('Native finite Persona review and hiring offers', () => {
  it('registers strict schemas with no opaque result objects', () => {
    const registry = new SimulationWorldDomainRegistry()
    expect(() => registry.register(WORLD_HIRING_MARKET_DEFINITION,
      { ref: WORLD_HIRING_MARKET_PIN.implementationRef, generation: 1 })).not.toThrow()
  })
  it('persists finite review revisions and rejects stale approvals and edits to accepted births', async () => {
    const f = fixture()
    try {
      const first = f.apply(draft).drafts.get('draft')!
      f.apply({ kind: 'review', reason: 'Finite source checked.', id: first.id, revision: first.revision, bodyHash: first.bodyHash, decision: 'reviewed' })
      const second = f.apply({ ...draft, expectedRevision: 1 }).drafts.get('draft')!
      expect(second).toMatchObject({ revision: 2, status: 'draft', reviewerId: null })
      expect(() => f.apply({ kind: 'review', reason: 'Finite source checked.', id: first.id, revision: 1, bodyHash: first.bodyHash, decision: 'accepted' })).toThrow(/exact current/)
      f.apply({ kind: 'review', reason: 'Finite source checked.', id: second.id, revision: 2, bodyHash: second.bodyHash, decision: 'reviewed' })
      f.apply({ kind: 'review', reason: 'Finite source checked.', id: second.id, revision: 2, bodyHash: second.bodyHash, decision: 'accepted' })
      expect(() => f.apply({ ...draft, expectedRevision: 2 })).toThrow(/immutable/)
      expect(hiringMarket(structuredClone(f.state)).drafts.get('draft')?.status).toBe('accepted')
      const generated = new OrganizationNativeWorldDomain(), intent = { ...f.intent, pin: WORLD_GENERATE_AND_HIRE_PIN }
      const reference = { id: second.id, revision: 2, bodyHash: second.bodyHash }
      expect(() => { generated.validatePlan(f.state, intent, { kind: 'apply', rationale: 'Reviewed birth',
        payload: { ...draft.body, personaDraft: reference } }) }).not.toThrow()
      for (const personaDraft of [undefined, { ...reference, revision: 1 }, { ...reference, id: 'another' },
        { ...reference, bodyHash: `sha256:${'0'.repeat(64)}` }]) expect(() => { generated.validatePlan(f.state, intent,
        { kind: 'apply', rationale: 'Wrong source', payload: { ...draft.body, ...personaDraft === undefined ? {} : { personaDraft } } }) }).toThrow(/draft reference/)
      expect(() => f.apply({ ...draft, id: 'invalid', body: { ...draft.body, persona: { ...draft.body.persona, name: 'Unauthorized' } } })).toThrow(/finite template/)
    } finally { await f.close() }
  })
  it('requires an independent candidate and exact delivered terms, then preserves the original hire identity', async () => {
    const f = fixture()
    try {
      const originalPerson = structuredClone(f.state.entities[simulationEntityIdSchema.parse('candidate')])
      const offer = offerSetup(f)
      const response = { kind: 'offer-response', id: offer.id, revision: 1, bodyHash: offer.bodyHash }
      expect(hiringMarketAcceptance(f.state, f.plan.id)).toBe(false)
      expect(() => f.apply({ ...response, decision: 'accepted' }, 'candidate')).toThrow(/receive/)
      f.apply({ ...response, decision: 'delivered' })
      expect(() => f.apply({ ...response, decision: 'accepted' })).toThrow(/original candidate/)
      expect(() => f.apply({ ...response, bodyHash: `sha256:${'0'.repeat(64)}`, decision: 'accepted' }, 'candidate')).toThrow(/exact live/)
      f.apply({ ...response, decision: 'accepted' }, 'candidate')
      expect(hiringMarketAcceptance(f.state, f.plan.id)).toBe(true)
      expect(() => f.apply({ ...response, decision: 'withdrawn' })).toThrow(/exact live/)
      expect(f.state.entities[simulationEntityIdSchema.parse('candidate')]).toEqual(originalPerson)
      expect(hiringMarket(structuredClone(f.state)).offers.get('offer')).toMatchObject({ status: 'accepted', compensation: 'one-time-only' })
    } finally { await f.close() }
  })
  it('creates counteroffer revisions without rewriting original terms or accepting stale revisions', async () => {
    const f = fixture()
    try {
      const first = offerSetup(f), history = structuredClone(f.state.world!.results)
      const second = f.apply({ kind: 'offer', id: first.id, expectedRevision: 1, vacancyId: 'job', applicationId: 'application',
        planId: first.planId, candidateId: first.candidateId, validUntil: '80', terms: 'Revised bounded terms.' }).offers.get(first.id)!
      expect(second.revision).toBe(2)
      expect(second.bodyHash).not.toBe(first.bodyHash)
      for (const [id, original] of Object.entries(history))
        expect(Object.values(f.state.world!.results).find(value => value.id === id)).toEqual(original)
      expect(() => f.apply({ kind: 'offer-response', id: first.id, revision: 1, bodyHash: first.bodyHash, decision: 'delivered' })).toThrow(/exact live/)
      const response = { kind: 'offer-response', id: second.id, revision: 2, bodyHash: second.bodyHash }
      f.apply({ ...response, decision: 'delivered' })
      f.apply({ ...response, decision: 'accepted' }, 'candidate')
      expect(hiringMarket(f.state).offers.get(first.id)?.terms).toBe('Revised bounded terms.')
    } finally { await f.close() }
  })
  it('attributes human revision separately while preserving the actor original and invalidating review', async () => {
    const f = fixture()
    try {
      const first = f.apply(draft).drafts.get('draft')!
      f.apply({ kind: 'review', id: first.id, revision: first.revision, bodyHash: first.bodyHash,
        decision: 'rejected', reason: 'Revise the finite selection.' })
      const source = simulationWorldAuthenticatedUserSourceSchema.parse({ kind: 'authenticated-user', principalId: 'reviewer',
        commandId: 'human-revision', credentialGeneration: 1, policyRef: 'human/1', policyGeneration: '1', time: '0' })
      const revised = projectHiringMarket(f.state, null, simulationHiringMarketCommandSchema.parse({ ...draft, expectedRevision: 1,
        organizationEntityId: 'organization', positionEntityId: 'vacancy' }), source)
      expect(revised).toMatchObject({ revision: 2, status: 'draft', source: first.source,
        prior: { revision: first.revision, bodyHash: first.bodyHash }, editedBy: { actorId: null, user: source },
        reviewerId: null, reviewerSource: null, reviewReason: null })
      expect(hiringMarket(f.state).drafts.get(first.id)?.status).toBe('rejected')
    } finally { await f.close() }
  })
  it('serializes incompatible offers and withdrawal against the same candidate obligation', async () => {
    const f = fixture()
    try {
      const first = offerSetup(f)
      const requestId = worldRequestIdSchema.parse('second-request'), planId = worldPlanIdSchema.parse('second-plan')
      const intent = { ...f.intent, id: worldIntentIdSchema.parse('second-intent'), requestId, businessKey: 'another-job' }
      const request = { ...f.request, id: requestId, intentId: intent.id, plans: [planId] }
      const plan = { ...f.plan, id: planId, requestId, proposal: { ...f.plan.proposal, requestId } }
      f.setState({ ...f.state, world: { ...f.state.world!, intents: { ...f.state.world!.intents, [intent.id]: intent },
        requests: { ...f.state.world!.requests, [requestId]: request }, plans: { ...f.state.world!.plans, [planId]: plan } } })
      const second = f.apply({ kind: 'offer', id: 'second-offer', expectedRevision: 0, vacancyId: 'job', applicationId: 'application',
        planId, candidateId: 'candidate', validUntil: '80', terms: 'Another incompatible assignment.' }).offers.get('second-offer')!
      const response = (offer: typeof first) => ({ kind: 'offer-response', id: offer.id, revision: offer.revision, bodyHash: offer.bodyHash })
      f.apply({ ...response(first), decision: 'delivered' })
      f.apply({ ...response(second), decision: 'delivered' })
      f.apply({ ...response(first), decision: 'accepted' }, 'candidate')
      const accepted = structuredClone(f.state)
      expect(() => f.apply({ ...response(second), decision: 'accepted' }, 'candidate')).toThrow(/incompatible/)
      expect(() => f.apply({ ...response(first), decision: 'withdrawn' })).toThrow(/exact live/)
      expect(f.state).toEqual(accepted)
      f.apply({ ...response(second), decision: 'withdrawn' })
      expect(() => f.apply({ ...response(second), decision: 'accepted' }, 'candidate')).toThrow(/exact live/)
    } finally { await f.close() }
  })
  it('reserves free proposal capacity without manufacturing candidate consent', async () => {
    const f = fixture()
    try {
      const offer = offerSetup(f, 'on-proposal')
      expect(offer.reservationPolicy).toBe('on-proposal')
      expect(hiringMarketAcceptance(f.state, f.plan.id)).toBe(false)
      const response = { kind: 'offer-response', id: offer.id, revision: offer.revision, bodyHash: offer.bodyHash }
      f.apply({ ...response, decision: 'delivered' })
      f.apply({ ...response, decision: 'accepted' }, 'candidate')
      expect(hiringMarketAcceptance(f.state, f.plan.id)).toBe(true)
    } finally { await f.close() }
  })
  it('refuses a superseded free hiring plan before accepting a candidate obligation', async () => {
    const f = fixture()
    try {
      const offer = offerSetup(f), response = { kind: 'offer-response', id: offer.id, revision: 1, bodyHash: offer.bodyHash }
      expect(hiringMarketAcceptance(f.state, f.plan.id)).toBe(false)
      f.apply({ ...response, decision: 'delivered' })
      const newest = { ...f.plan, id: worldPlanIdSchema.parse('replacement-plan') }
      f.setState({ ...f.state, world: { ...f.state.world!, plans: { ...f.state.world!.plans, [newest.id]: newest },
        requests: { ...f.state.world!.requests, [f.request.id]: { ...f.request, plans: [f.plan.id, newest.id] } } } })
      const before = structuredClone(f.state)
      expect(() => f.apply({ ...response, decision: 'accepted' }, 'candidate')).toThrow(/original hiring plan/)
      expect(f.state).toEqual(before)
      expect(hiringMarket(f.state).offers.get(offer.id)?.status).toBe('delivered')
    } finally { await f.close() }
  })
  it('freezes the accepted free hiring plan against replanning and clarification in admission and replay', async () => {
    const f = fixture()
    try {
      const offer = offerSetup(f), response = { kind: 'offer-response', id: offer.id, revision: 1, bodyHash: offer.bodyHash }
      expect(hiringMarketAcceptance(f.state, f.plan.id)).toBe(false)
      f.apply({ ...response, decision: 'delivered' })
      f.apply({ ...response, decision: 'accepted' }, 'candidate')
      const state = f.state, entityId = simulationEntityIdSchema.parse('director'), id = simulationDecisionIdSchema.parse('replacement-decision')
      if (f.request.notificationOperationId === null) throw new Error('Role hiring requires its original notification')
      const notificationOperationId = f.request.notificationOperationId
      const epoch = simulationWriterEpochSchema.parse('1'), opId = simulationOperationIdSchema.parse('replacement-operation')
      const inputId = 'replacement-input' as SimulationContextViewEventData['inputId']
      const view: SimulationContextViewEventData = { version: 1, runId: state.spec.runId, entityId,
        windowId: 'replacement-window' as SimulationContextViewEventData['windowId'], slot: simulationDecisionSlotSchema.parse('1'),
        epoch, time: state.time, inputId, projections: { run: state.revision, entity: 1, team: 1 },
        versions: { rules: '1', policy: '1', persona: '1', model: '1' }, sources: [], content: [] }
      const decision: SimulationDecision = { id, entityId, epoch, slot: view.slot, snapshotRevision: state.revision, entityRevision: 1,
        time: state.time, status: 'accepted', operationIds: [opId], context: { status: 'prepared', requiredSections: [],
          fingerprint: businessFingerprint(view), view, teamCursor: 1, maxBytes: 65536, retainedBytes: 0, omitted: [],
          world: { kind: 'resolve', intentId: f.intent.id, pin: f.plan.pin, reads: f.plan.reads, baseRevision: state.revision,
            requestId: f.request.id, notificationOperationId } },
        consumption: { notification: { operationId: notificationOperationId, consumedSequence: 1 },
          sessionId: state.entities[entityId]!.binding!.sessionId, inputId, contextHash: simulationContextConsumptionHash(view),
          viewSequence: 0, consumedSequence: 1 } }
      for (const resolution of [{ kind: 'apply', payload: f.payload, rationale: 'Replacement' },
        { kind: 'awaiting-evidence', missingFields: ['requirements'], deadline: '90', maxAttempts: 1, rationale: 'Ask again' }]) {
        const action = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: f.request.id,
          supersedes: f.plan.id, resolution })
        const operation: SimulationOperation = { id: opId, decisionId: id, entityId, index: 0, action, dependencies: [],
          fingerprint: businessFingerprint(action), status: 'pending', worldPin: f.plan.pin }
        const attempted = { ...state, decisions: { ...state.decisions, [id]: decision } }
        expect(() => expandWorldProposals(attempted, decision, [{ after: [], action }], f.runtime)).toThrow(/freezes its original/)
        expect(() => acceptWorldOperation(attempted, operation, state.revision + 1, f.runtime)).toThrow(/freezes its original/)
      }
      expect(f.state).toEqual(state)
    } finally { await f.close() }
  })
  it.each(['on-proposal', 'on-acceptance'] as const)('keeps the %s original accepted fee reserved after its deadline and settles it once', async (policy) => {
    const f = fixture()
    try {
      const accounts = [{ id: 'cash', owner: 'requester', controllers: ['requester'], kind: 'money', unit: 'credit', quantity: '10' },
        { id: 'payee', owner: 'candidate', controllers: [], kind: 'money', unit: 'credit', quantity: '0' }]
        .map(value => ({ ...simulationResourceSpecSchema.parse(value), revision: 1 }))
      const fee = simulationHiringFeePolicySchema.parse({ id: 'fee', version: '1', policyRef: 'clocky.organization.hiring-fee/1',
        operation: 'hire-existing', positionEntityId: 'vacancy', from: 'cash', to: 'payee', unit: 'credit', quantity: '3', grants: [], reservationPeriod: '5' })
      f.setState({ ...f.state, resources: Object.fromEntries(accounts.map(value => [value.id, value])),
        world: { ...f.state.world!, definition: { ...f.state.world!.definition, hiringFees: [fee] } } })
      const offer = offerSetup(f, policy, '5'), response = { kind: 'offer-response', id: offer.id, revision: 1, bodyHash: offer.bodyHash }
      expect(Object.values(f.state.resourceReservations)).toHaveLength(policy === 'on-proposal' ? 1 : 0)
      expect(hiringMarketAcceptance(f.state, f.plan.id)).toBe(false)
      f.apply({ ...response, decision: 'delivered' })
      f.apply({ ...response, decision: 'accepted' }, 'candidate')
      const state = f.state, hold = Object.values(state.resourceReservations)[0]!
      expect(hold).toMatchObject({ phase: 'active', world: { planId: f.plan.id, fee } })
      expect(state.resources[accounts[0]!.id]?.quantity).toBe('10')
      const record = hiringResourceSchedulerRecords(state)[0]!
      if (record.kind !== 'event/queued') throw new Error('Expected original fee deadline')
      const sequence = state.revision + 1, event = { id: record.id, key: record.key, action: record.action,
        status: 'consumed' as const, settledAt: sequence }
      const due = { ...state, revision: sequence, time: hold.expiresAt, scheduledEvents: { ...state.scheduledEvents, [event.id]: event } }
      const expired = consumeResourceReservationExpiry(due, event, sequence)
      expect(expired.resourceReservations[hold.id]).toMatchObject({ phase: 'active', revision: 1,
        world: { expiryConsumed: { eventId: event.id, sequence, time: hold.expiresAt } } })
      assertHiringResourceProjection(expired, expired.resourceReservations[hold.id]!)
      expect(requireHiringResourceReservation(structuredClone(expired), f.plan)?.id).toBe(hold.id)
      const settled = commitHiringResourceReservation(expired, f.plan, sequence + 1)
      expect(settled.resources[accounts[0]!.id]?.quantity).toBe('7')
      expect(settled.resources[accounts[1]!.id]?.quantity).toBe('3')
      expect(() => commitHiringResourceReservation(settled, f.plan, sequence + 2)).toThrow(/settlement/)
    } finally { await f.close() }
  })
  it('rejects expiry, revision reuse and employer-created candidate applications', async () => {
    const f = fixture()
    try {
      const offer = offerSetup(f)
      const response = { kind: 'offer-response', id: offer.id, revision: 1, bodyHash: offer.bodyHash }
      f.apply({ ...response, decision: 'delivered' })
      f.setState({ ...f.state, time: simTimeSchema.parse('80') })
      expect(() => f.apply({ ...response, decision: 'accepted' }, 'candidate')).toThrow(/validity/)
      f.apply({ ...response, decision: 'expired' })
      expect(() => f.apply({ kind: 'application', id: 'forged', vacancyId: 'job' })).toThrow(/eligibility/)
      expect(() => simulationHiringMarketCommandSchema.parse({ ...draft, expectedRevision: 16 })).toThrow()
      expect(() => projectHiringMarket(f.state, simulationEntityIdSchema.parse('candidate'), simulationHiringMarketCommandSchema.parse({
        ...draft, organizationEntityId: 'organization', positionEntityId: 'vacancy' }))).toThrow(/can-hire/)
    } finally { await f.close() }
  })
})
