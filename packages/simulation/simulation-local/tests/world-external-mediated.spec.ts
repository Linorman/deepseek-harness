/**
 * Pure owner rejection checks over parsed causal records; actual Loader/session acceptance belongs to the independent composition
 * suite.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { SimulationContextViewEventData } from '@clocky/clocky-session'
import { simulationChangeSchema, simulationEntityIdSchema, simulationWorldDefinitionSchema, simulationWorldRoleIntentSchema,
  simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema, simulationOperationIdSchema,
  simulationDecisionIdSchema, simulationWriterEpochSchema, simulationDecisionSlotSchema, worldRequestIdSchema,
  worldPlanIdSchema, simulationWorldDomainMutationSchema, WORLD_EXTERNAL_MEDIATED_PIN,
  simulationExternalMediatedRequestSchema, SimulationWorldDomainRegistry, simulationContextConsumptionHash,
  simulationExternalAdjudicatedOutcomeSchema, WORLD_EXTERNAL_MEDIATION_POLICY_REF, simulationExternalAdjudicationSchema,
  simulationExternalAdjudicatedEventStateSchema, simulationEventIdSchema, worldResultIdSchema, worldFactIdSchema,
  worldFactVersionSchema } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldRequest, SimulationWorldPlan, SimulationOperation,
  SimulationExternalAdjudicatedOutcome } from '@clocky/clocky-simulation'
import { ExternalMediatedNativeWorldDomain, acceptExternalMediatedIdentity, prepareExternalAdjudication,
  applyExternalAdjudication, resolveExternalAdjudicationPolicy, validateExternalAdjudicatedEvent,
  prepareExternalAdjudicatedEventConsumption, SimulationExternalAdjudicationError } from '../src/world-external-mediated.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { businessFingerprint } from '../src/business.ts'
import { createBusinessHarness } from './business-harness.ts'
const policy = { ref: WORLD_EXTERNAL_MEDIATION_POLICY_REF, version: '1', generation: 1,
  conditionInstalls: ['weather'], futureConditionInstalls: ['weather'], maxDelay: '20', allowPublicDisclosure: false,
  allowScopeDisclosure: false, actorDisclosure: [],
  allowedOutcomeKinds: ['environmental-fact','unverified-report','failure','delayed-event','representative-preparation-plan'] }
const common = { subjectRef: 'supplier', sourceKind: 'director-mediated', policyRef: WORLD_EXTERNAL_MEDIATION_POLICY_REF,
  attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' } }
const fact = simulationExternalAdjudicatedOutcomeSchema.parse({ ...common, kind: 'environmental-fact', factKey: 'stock',
  claim: { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known', quantity: '7' } },
  effectiveFrom: '0', effectiveUntil: null })
const weather = simulationExternalAdjudicatedOutcomeSchema.parse({ ...common, kind: 'environmental-fact', factKey: 'weather',
  claim: { kind: 'condition', predicate: 'weather', schemaRef: 'weather/1', value: { status: 'rain' } },
  effectiveFrom: '0', effectiveUntil: null })
async function fixture(outcome: SimulationExternalAdjudicatedOutcome, unknown = false, withContract = false) {
  const h = await createBusinessHarness('json', { relationRules: [
      { relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false },
      { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    ] }), requester = await h.actor('requester'), director = await h.actor('director')
  for (const [id, entityKind] of [['organization', 'organization'], ['role', 'position'], ['supplier', 'organization'], ['other',
    'organization']])
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition: 'none', readiness: 'ready',
      profile: { name: 'Same display name' } }), h.run.snapshot().revision)
  for (const [id, relation, target] of [['employment', 'assignment', 'role'], ['permission', 'can-interact', 'supplier']])
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id, subject: requester.id, relation,
      object: target, scope: 'organization', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
  if (!unknown) await h.account('stock', simulationEntityIdSchema.parse('supplier'), '7', withContract ? [director.id] : [],
    'inventory', 'widget')
  await h.account('money', simulationEntityIdSchema.parse('supplier'), '999', withContract ? [director.id] : [], 'money', 'widget')
  if (withContract) {
    await h.account('buyer-stock', requester.id, '0', [requester.id], 'inventory', 'widget')
    await h.apply(requester.lease, 'contract-request', { kind: 'interaction/request', id: 'custodian-contract', assignee: director.id,
      description: 'A supplier custodian transfer.', replyBy: null, completeBy: null,
      fulfillment: { kind: 'transfer', from: 'stock', to: 'buyer-stock', quantity: '2' } })
    await h.apply(director.lease, 'contract-accept', { kind: 'interaction/accept', id: 'custodian-contract', expectedRevision: 1 })
  }
  let state: SimulationSnapshot = { ...h.run.snapshot(), world: { executions: {}, definition: simulationWorldDefinitionSchema.parse({
    directorEntityId: director.id, organizationEntityId: 'organization', operations: [WORLD_EXTERNAL_MEDIATED_PIN],
    operationGrants: [{ requesterEntityId: requester.id, domain: 'external', operation: 'interact', version: '3',
      scopeEntityId: 'organization',
      targetEntityId: 'supplier', relationId: 'permission', relation: 'can-interact' }], positionRolePermissions: [],
    authorizations: [], positions: [{ entityId: 'role', capacity: 1 }], policyVersion: '1', externalAdjudicationPolicy: policy,
    templates: [{ id: 'finite', version: '1', names: ['Original'], skills: [], traits: [], goals: [], description: 'Finite' }],
    limits: { maxRequests: 10,
      maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
      maxRequestsPerActorPerInterval: 10,
      maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 } }),
  external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
  personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] },
  facts: {}, evidence: { challenges: {}, revisions: {} }, governance: { proposals: {}, votes: {}, resolutions: {} },
  norms: { versions: {}, closures: [], announcements: {} },
  sequence: 1, channels: {}, intents: {}, requests: {}, plans: {}, mutations: {}, results: {}, cancellations: {}, reservations: {} } }
  const payload = simulationExternalMediatedRequestSchema.parse({ scope: 'organization', subjectRef: 'supplier', externalKey: 'vendor',
    sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1', input: { kind: 'adjudicate',
      question: 'Observe the simulated supplier.', contactUnit: 'widget', inventoryUnit: 'widget',
      quoteScope: { unit: 'widget', currency: 'USD' } },
    responseScope: { allowed: ['environmental-fact','unverified-report','failure','delayed-event',
      'representative-preparation-plan'], disclosure: { kind: 'requester' } } })
  const module = new ExternalMediatedNativeWorldDomain(), registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const unregister = registry.register(module.definition, module), runtime = new NativeWorldRuntime(registry)
  // These parsed sources isolate rejection folds; actual decision consumption and sender provenance are exercised by the Loader fixture.
  const { requestId: _requestId, ...parsedIntent } = simulationWorldRoleIntentSchema.parse({ id: 'original-intent',
    pin: WORLD_EXTERNAL_MEDIATED_PIN, businessKey: 'availability',
    requesterEntityId: requester.id, scopeEntityId: 'organization', targetEntityId: payload.subjectRef,
    expectedTime: null, evidence: [], description: 'Inventory availability',
    payload, sequence: 3, requestId: 'original-request' })
  const intent = { ...parsedIntent, requestId: worldRequestIdSchema.parse('original-request') }
  const proposal = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: 'external',
    operation: 'interact', version: '3',
    businessKey: intent.businessKey, expectedTime: null, evidence: [], payload })
  const request: SimulationWorldRequest = { id: worldRequestIdSchema.parse('original-request'), intentId: intent.id,
    operationId: simulationOperationIdSchema.parse('request-op'), notificationOperationId: simulationOperationIdSchema.parse('notify-op'),
    requesterEntityId: requester.id, proposal, pin: intent.pin, source: { kind: 'decision',
      decisionId: simulationDecisionIdSchema.parse('request-decision'),
      epoch: simulationWriterEpochSchema.parse('1'), binding: state.entities[requester.id]!.binding! },
    description: intent.description, payloadHash: businessFingerprint(proposal), sequence: 3,
    plans: [worldPlanIdSchema.parse('original-plan')], status: 'open' }
  state = { ...state, world: { ...state.world!, intents: { [intent.id]: intent }, requests: { [request.id]: request } } }
  const external = acceptExternalMediatedIdentity(state, intent, request.id, 3)
  state = { ...state, world: { ...state.world!, external } }
  const disposition = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: request.id, supersedes: null,
    resolution: { kind: 'apply', payload: { kind: 'adjudicate', outcome }, rationale: 'PRIVATE-DIRECTOR-CANARY' } })
  const plan: SimulationWorldPlan = { id: request.plans[0]!, requestId: request.id,
    operationId: simulationOperationIdSchema.parse('plan-op'),
    proposal: disposition, pin: intent.pin, reads: module.executionReads(state, intent), baseRevision: state.revision,
    sequence: 4, hash: businessFingerprint(disposition), status: 'accepted' }
  const operation: SimulationOperation = { id: plan.operationId, entityId: director.id,
    decisionId: simulationDecisionIdSchema.parse('director-decision'),
    index: 0, action: disposition, dependencies: [], fingerprint: businessFingerprint(disposition), status: 'pending' }
  const actor = state.entities[director.id]!, inputId = 'input:director' as SimulationContextViewEventData['inputId']
  const view: SimulationContextViewEventData = { version: 1, runId: state.spec.runId, entityId: director.id,
    windowId: 'director-window' as SimulationContextViewEventData['windowId'], slot: simulationDecisionSlotSchema.parse('0'),
    epoch: actor.writer!.epoch, time: state.time, inputId, projections: { run: state.revision, entity: actor.revision, team: 1 },
    versions: { rules: '1', policy: '1', persona: 'finite-version', model: 'actual-model-version' }, sources: [],
    content: [{ kind: 'goals', blocks: [{ type: 'text', text: 'Pure owner source fixture.' }] }] }
  state = { ...state, world: { ...state.world!, plans: { [plan.id]: plan } }, operations: { ...state.operations,
    [operation.id]: operation },
  decisions: { ...state.decisions, [operation.decisionId]: { id: operation.decisionId, entityId: director.id, epoch: actor.writer!.epoch,
    slot: view.slot, snapshotRevision: state.revision, entityRevision: actor.revision, time: state.time,
    status: 'accepted', operationIds: [operation.id], context: { status: 'prepared', requiredSections: ['goals'],
      fingerprint: businessFingerprint({ purpose: 'original-prepared-request' }), view, teamCursor: 1, maxBytes: 16384,
      retainedBytes: 1000, omitted: [], world: { kind: 'resolve', intentId: intent.id, pin: intent.pin, reads: plan.reads,
        baseRevision: state.revision, requestId: request.id, notificationOperationId: request.notificationOperationId } },
    consumption: { sessionId: actor.binding!.sessionId, inputId, contextHash: simulationContextConsumptionHash(view),
      viewSequence: 0, consumedSequence: 1 } } } }
  const mutation = (current = state) => simulationWorldDomainMutationSchema.parse({ kind: 'world/mutation',
    id: `world-mutation:${plan.id}`, requestId: request.id, planId: plan.id, pin: plan.pin,
    payload: { kind: 'apply-original-adjudication' }, time: current.time, recordedAt: 1234, sequence: current.revision + 1 })
  const effect = { kind: 'external/adjudicate-original' as const, intentId: intent.id, planId: plan.id }
  const record = (current = state) => prepareExternalAdjudication(current, mutation(current), effect)
  const fold = (current = state, retained = record(current)) => applyExternalAdjudication(current, mutation(current), effect, retained)
  return { state, payload, intent, request, plan, module, runtime, record, fold, effect, mutation,
    increaseStock: async () => {
      await h.account('incoming-stock', requester.id, '1', [requester.id], 'inventory', 'widget')
      const from = Object.values(h.run.snapshot().resources).find(value => value.id === 'incoming-stock')!
      const to = Object.values(h.run.snapshot().resources).find(value => value.id === 'stock')!
      const result = await h.apply(requester.lease, 'original-stock-transfer', { kind: 'resource/transfer', grants: [],
        transaction: { commitmentId: null, reads: [{ resourceId: from.id, revision: from.revision },
          { resourceId: to.id, revision: to.revision }], transfers: [{ from: from.id, to: to.id, quantity: '1' }] } })
      expect(result.status).toBe('applied')
      return h.run.snapshot()
    },
    close: async () => { runtime.close(); await unregister(); await h.close() } }

}

describe('original mediated adjudication owner', () => {
  it('accepts a new proven as-of balance after an actual Native transfer while preserving the old observation and rejecting a false amount', async () => {
    const h = await fixture(fact)
    try {
      const old = h.record(), publication = old.actualPublication!
      const { sources, ...fields } = publication
      const version = { ...fields, source: { kind: 'owner' as const, owner: 'parsed-original-adjudication', references: sources },
        sequence: old.sequence, recordedAt: old.recordedAt }
      const transferred = await h.increaseStock(), stock = Object.values(transferred.resources).find(value => value.id === 'stock')!
      expect(stock.quantity).toBe('8')
      const state: SimulationSnapshot = { ...h.state, revision: transferred.revision, resources: transferred.resources,
        world: { ...h.state.world!, facts: { [publication.factId]: [version] } } }
      const current = simulationExternalAdjudicatedOutcomeSchema.parse({ ...fact,
        claim: { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known', quantity: '8' } } })
      expect(() => { h.module.validatePlan(state, h.intent, { kind: 'apply', payload: { kind: 'adjudicate', outcome: current },
        rationale: '' }) }).not.toThrow()
      const falseAmount = simulationExternalAdjudicatedOutcomeSchema.parse({ ...current,
        claim: { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known', quantity: '9' } } })
      expect(() => { h.module.validatePlan(state, h.intent, { kind: 'apply', payload: { kind: 'adjudicate',
        outcome: falseAmount }, rationale: '' }) }).toThrow()
      expect(old.actualPublication!.payload.claim).toMatchObject({ availability: { quantity: '7' } })
      expect(old.actualInputs.resources.find(value => value.id === 'stock')?.quantity).toBe('7')
      expect(state.world!.facts[publication.factId]).toEqual([version])
    } finally { await h.close() }
  })
  it('keeps a legally referenced private Fact identity in the original book while excluding it from the safe result', async () => {
    const h = await fixture(weather)
    try {
      const record = h.record(), canary = 'PRIVATE-FLOOR-CANARY', factId = worldFactIdSchema.parse(canary)
      const privateFact = { ...record.actualPublication!, factId, audience: { kind: 'actors' as const,
        entityIds: [h.state.world!.definition.directorEntityId] }, source: { kind: 'owner' as const,
        owner: 'parsed-private-source', references: [] },
      sequence: 1, recordedAt: 0 }
      const { sources: _sources, ...version } = privateFact
      const evidence = { kind: 'world-fact' as const, reference: { factId, version: version.version }, hash: businessFingerprint(version) }
      const outcome = simulationExternalAdjudicatedOutcomeSchema.parse({ ...weather, evidence: [evidence] })
      const plan = { ...h.plan, proposal: { ...h.plan.proposal, resolution: { kind: 'apply' as const,
        payload: { kind: 'adjudicate', outcome }, rationale: '' } } }
      const operation = h.state.operations[plan.operationId]!
      const state: SimulationSnapshot = { ...h.state, operations: { ...h.state.operations, [operation.id]: { ...operation,
        action: plan.proposal } },
      world: { ...h.state.world!, facts: { [factId]: [version] }, plans: { ...h.state.world!.plans, [plan.id]: plan } } }
      const original = h.record(state), projection = h.fold(state, original)
      expect(original.actualEvidence).toEqual([evidence])
      expect(JSON.stringify(projection.resultPayload)).not.toContain(canary)
      expect(projection.resultPayload).toMatchObject({ evidence: [] })
    } finally { await h.close() }
  })
  it('retains a raw delayed key privately and exposes only the Native opaque event identity', async () => {
    const canary = 'PRIVATE-FLOOR-CANARY', leaf = simulationExternalAdjudicatedOutcomeSchema.parse({ ...weather, effectiveFrom: '3' })
    const outcome = simulationExternalAdjudicatedOutcomeSchema.parse({ ...common, kind: 'delayed-event', key: canary,
      deliverAt: '3', outcome: leaf })
    const h = await fixture(outcome)
    try {
      const projection = h.fold(), event = projection.event!
      expect(event.original.key).toBe(canary)
      expect(event.original.eventId).not.toContain(canary)
      expect(JSON.stringify(projection.resultPayload)).not.toContain(canary)
    } finally { await h.close() }
  })
  it.each(['failure', 'unverified-report'] as const)('retains canary-bearing raw %s privately while projecting Native fixed text', async (kind) => {
    const canary = 'PRIVATE-FLOOR-CANARY'
    const outcome = simulationExternalAdjudicatedOutcomeSchema.parse(kind === 'failure'
      ? { ...common, kind, code: 'declined', description: canary }
      : { ...common, kind, reliability: 'unverified', statement: canary,
        quote: { unit: 'widget', quantity: '7', price: { currency: 'USD', quantity: '12' }, validUntil: '9' } })
    const h = await fixture(outcome)
    try {
      const record = h.record(), projection = h.fold()
      expect(JSON.stringify(record.proposal)).toContain(canary)
      expect(JSON.stringify(projection.resultPayload)).not.toContain(canary)
      expect(projection.publications).toEqual([])
    } finally { await h.close() }
  })
  it('binds Actor, quotation and unknown-inventory literal dimensions to the original requester input', async () => {
    const h = await fixture(weather)
    try {
      const report = { ...common, kind: 'unverified-report', reliability: 'unverified', statement: 'A raw unverified report.',
        quote: { unit: 'widget', quantity: '7', price: { currency: 'USD', quantity: '12' }, validUntil: '9' } }
      const template = h.state.world!.definition.templates[0]!
      const actor = { ...common, kind: 'representative-preparation-plan', contactUnit: 'PRIVATE-FLOOR-CANARY',
        preparation: { templateId: template.id, templateVersion: template.version, persona: { name: template.names[0],
          skills: template.skills, traits: template.traits, goals: template.goals } } }
      const outcomes = [actor, { ...report, quote: { ...report.quote, unit: 'PRIVATE-FLOOR-CANARY' } },
        { ...report, quote: { ...report.quote, price: { ...report.quote.price, currency: 'PRIVATE-FLOOR-CANARY' } } },
        { ...weather, claim: { kind: 'inventory-as-of', unit: 'PRIVATE-FLOOR-CANARY', availability: { status: 'unknown' } } }]
      for (const value of outcomes) {
        const outcome = simulationExternalAdjudicatedOutcomeSchema.parse(value)
        expect(() => { h.module.validatePlan(h.state, h.intent, { kind: 'apply', payload: { kind: 'adjudicate', outcome },
          rationale: '' }) }).toThrow()
      }
      const payload = simulationExternalMediatedRequestSchema.parse({ ...h.payload, input: { kind: 'adjudicate',
        question: 'No permitted quote dimensions.' } })
      const intent = { ...h.intent, payload: z.json().parse(payload) }
      const outcome = simulationExternalAdjudicatedOutcomeSchema.parse(report)
      expect(() => { h.module.validatePlan(h.state, intent, { kind: 'apply', payload: { kind: 'adjudicate', outcome },
        rationale: '' }) }).toThrow('Unverified quotations require request.input.quoteScope with an authorized unit and currency; use another allowed outcome when it is absent')
    } finally { await h.close() }
  })
  it.each([true, false])('compares retained future authority by actual interval overlap=%s, independent of fact key', async (overlap) => {
    const h = await fixture(weather)
    try {
      const record = h.record(), publication = record.actualPublication!, factId = worldFactIdSchema.parse('stored-weather')
      const prior = { ...publication, factId, effectiveFrom: '10' as SimulationSnapshot['time'],
        effectiveUntil: null, payload: { ...publication.payload, claim: { kind: 'condition' as const, predicate: 'weather' as const,
          schemaRef: 'weather/1' as const, value: { status: 'clear' as const } } },
        source: { kind: 'owner' as const, owner: 'parsed-existing-native-authority', references: [] }, sequence: 1, recordedAt: 0 }
      const { sources: _sources, ...version } = prior
      const state: SimulationSnapshot = { ...h.state, world: { ...h.state.world!, facts: { [factId]: [version] } } }
      const outcome = simulationExternalAdjudicatedOutcomeSchema.parse({ ...weather, factKey: 'different-key',
        effectiveFrom: overlap ? '10' : '0', effectiveUntil: overlap ? null : '8' })
      const validate = () => { h.module.validatePlan(state, h.intent, { kind: 'apply', payload: { kind: 'adjudicate', outcome },
        rationale: '' }) }
      if (overlap) expect(validate).toThrow()
      else expect(validate).not.toThrow()
    } finally { await h.close() }
  })
  it('rejects a request with uninstalled outcome families or disclosure before identity acceptance', async () => {
    const h = await fixture(weather)
    try {
      const state: SimulationSnapshot = { ...h.state, world: { ...h.state.world!,
        external: { ...h.state.world!.external, identities: {} } } }
      const before = structuredClone(state), proposal = h.request.proposal
      for (const disclosure of [{ kind: 'public' }, { kind: 'scope-members' },
        { kind: 'actors', entityIds: [state.world!.definition.directorEntityId] }]) {
        const payload = simulationExternalMediatedRequestSchema.parse({ ...h.payload,
          responseScope: { ...h.payload.responseScope, disclosure } })
        expect(() => h.module.admitRequest(state, h.request.requesterEntityId, { ...proposal, payload: z.json().parse(payload) })).toThrow()
      }
      const narrow: SimulationSnapshot = { ...state, world: { ...state.world!, definition: { ...state.world!.definition,
        externalAdjudicationPolicy: { ...state.world!.definition.externalAdjudicationPolicy!, allowedOutcomeKinds: ['failure'] } } } }
      expect(() => h.module.admitRequest(narrow, h.request.requesterEntityId, proposal)).toThrow()
      expect(state).toEqual(before)
      expect(state.world!.external.identities).toEqual({})
    } finally { await h.close() }
  })
  it('projects director-controlled money only to the actual director reader, including bootstrap requester contexts', async () => {
    const h = await fixture(weather, false, true)
    try {
      const requester = h.module.planningContext(h.state, h.intent, h.request.requesterEntityId)
      const director = h.module.planningContext(h.state, h.intent, h.state.world!.definition.directorEntityId)
      const unknownReader = h.module.planningContext(h.state, h.intent)
      expect(requester).toMatchObject({ balances: [], commitments: [], templates: [] })
      expect(unknownReader).toMatchObject({ balances: [], commitments: [], templates: [] })
      expect(JSON.stringify(director)).toContain('"id":"money"')
      expect(JSON.stringify(director)).toContain('"quantity":"999"')
      expect(JSON.stringify(requester)).not.toContain('"quantity":"999"')
    } finally { await h.close() }
  })
  it('validates an actual external custodian obligation and captures both original transfer accounts', async () => {
    const h = await fixture(weather, false, true)
    try {
      const contract = Object.values(h.state.commitments)[0]!
      const outcome = simulationExternalAdjudicatedOutcomeSchema.parse({ ...weather,
        claim: { kind: 'commitment-as-of', commitmentId: contract.id, phase: 'open' } })
      const plan = { ...h.plan, proposal: { ...h.plan.proposal, resolution: { kind: 'apply' as const,
        payload: { kind: 'adjudicate', outcome }, rationale: 'Original custodian observation.' } } }
      const operation = h.state.operations[plan.operationId]!
      const state: SimulationSnapshot = { ...h.state, operations: { ...h.state.operations, [operation.id]: { ...operation,
        action: plan.proposal } },
      world: { ...h.state.world!, plans: { ...h.state.world!.plans, [plan.id]: plan } } }
      const record = h.record(state)
      expect(contract.debtor).not.toBe(record.request.subjectRef)
      expect(record.actualInputs.resources.map(value => value.id)).toContain('buyer-stock')
      expect(record.actualInputs.commitments.map(value => value.id)).toContain(contract.id)
      const stock = Object.values(state.resources).find(value => value.id === 'stock')!
      expect(() => h.record({ ...state, resources: { ...state.resources, [stock.id]: { ...stock, controllers: [] } } })).toThrow()
    } finally { await h.close() }
  })
  it('rejects the same authoritative semantic axis under a renamed fact key', async () => {
    const h = await fixture(weather)
    try {
      const factId = worldFactIdSchema.parse('original-independent-weather'), source = h.record()
      const prior = { factId, version: worldFactVersionSchema.parse('1'), schemaRef: source.actualPublication!.schemaRef,
        subject: h.payload.subjectRef, scope: h.payload.scope, effectiveFrom: h.state.time, effectiveUntil: null,
        availableAt: h.state.time, audience: { kind: 'public' as const }, supersedes: null,
        payload: { ...source.actualPublication!.payload, claim: { kind: 'condition' as const, predicate: 'weather' as const,
          schemaRef: 'weather/1' as const, value: { status: 'clear' as const } } },
        source: { kind: 'owner' as const, owner: 'original-native', references: [] }, sequence: 1, recordedAt: 0 }
      const outcome = simulationExternalAdjudicatedOutcomeSchema.parse({ ...weather, factKey: 'another-key' })
      const state: SimulationSnapshot = { ...h.state, world: { ...h.state.world!, facts: { [factId]: [prior] } } }
      expect(() =>{  h.module.validatePlan(state, h.intent, { kind: 'apply', payload: { kind: 'adjudicate', outcome },
        rationale: '' }) }).toThrow()
    } finally { await h.close() }
  })
  it('freezes explicit policy parameters and refuses incomplete or hidden configuration', () => {
    const resolved = resolveExternalAdjudicationPolicy(policy)
    expect(Object.isFrozen(resolved.parameters)).toBe(true)
    expect(Object.isFrozen(resolved.parameters.conditionInstalls)).toBe(true)
    expect(() => resolveExternalAdjudicationPolicy({ ...policy, futureConditionInstalls: ['lead-time'] })).toThrow()
    expect(() => resolveExternalAdjudicationPolicy({ ...policy, mutableEvaluator: true })).toThrow()
    expect(resolveExternalAdjudicationPolicy({ ...policy, maxDelay: '21' }).fingerprint).not.toBe(resolved.fingerprint)
  })
  it('captures actual inventory, canonical publication and real cognition versions without changing balances', async () => {
    const h = await fixture(fact)
    try {
      const before = structuredClone(h.state), record = h.record(), projection = h.fold()
      expect(record.basis).toMatchObject({ kind: 'model', modelVersion: 'actual-model-version', personaVersion: 'finite-version' })
      expect(record.actualPublication?.payload.claim).toMatchObject({ availability: { quantity: '7' } })
      expect(record.actualInputs.resources.find(value => value.id === 'stock')?.quantity).toBe('7')
      expect(projection.publications).toEqual([record.actualPublication])
      expect(projection.external.adjudications[h.intent.id]).toEqual(record)
      expect(h.state).toEqual(before)
      expect(JSON.stringify(projection.resultPayload)).not.toContain('PRIVATE-DIRECTOR-CANARY')
    } finally { await h.close() }
  })
  it('retains absent inventory as unknown and refuses a claimed empty known balance', async () => {
    const outcome = simulationExternalAdjudicatedOutcomeSchema.parse({ ...fact,
      claim: { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'unknown' } } })
    const h = await fixture(outcome, true)
    try {
      expect(h.record().actualPublication?.payload.claim).toMatchObject({ availability: { status: 'unknown' } })
      const invalid = simulationExternalAdjudicatedOutcomeSchema.parse({ ...fact,
        claim: { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known', quantity: '0' } } })
      expect(() =>{  h.module.validatePlan(h.state, h.intent, { kind: 'apply', payload: { kind: 'adjudicate', outcome: invalid },
        rationale: '' }) })
        .toThrow(SimulationExternalAdjudicationError)
    } finally { await h.close() }
  })
  it.each([
    { name: 'wrong inventory', value: { ...fact, claim: { kind: 'inventory-as-of', unit: 'widget',
      availability: { status: 'known', quantity: '8' } } } },
    { name: 'private money', value: { ...fact, claim: { kind: 'balance-as-of', resourceId: 'money', quantity: '999' } } },
    { name: 'uninstalled condition', value: { ...weather, claim: { kind: 'condition', predicate: 'lead-time',
      schemaRef: 'lead-time/1', value: { ticks: '3' } } } },
    { name: 'wider public disclosure', value: { ...weather, disclosure: { kind: 'public' } } },
    { name: 'wrong subject', value: { ...weather, subjectRef: 'other' } },
  ])('rejects $name before creating a publication', async ({ value }) => {
    const h = await fixture(weather)
    try {
      const outcome = simulationExternalAdjudicatedOutcomeSchema.parse(value)
      expect(() =>{  h.module.validatePlan(h.state, h.intent, { kind: 'apply', payload: { kind: 'adjudicate', outcome },
        rationale: '' }) }).toThrow()
      expect(h.state.world!.external.adjudications).toEqual({})
    } finally { await h.close() }
  })
  it.each(['sender', 'url', 'credentials', 'modelVersion', 'resourceChanges'])('refuses proposed %s outside the closed contract',
    (field) => {
      expect(simulationExternalAdjudicatedOutcomeSchema.safeParse({ ...weather, [field]: 'forged' }).success).toBe(false)
    })
  it('refuses resource or obligation semantics hidden inside a condition value', () => {
    for (const claim of [
      { kind: 'condition', predicate: 'inventory', schemaRef: 'weather/1', value: { quantity: '99' } },
      { kind: 'condition', predicate: 'weather', schemaRef: 'weather/1', value: { status: 'rain', money: '99' } },
      { kind: 'condition', predicate: 'weather', schemaRef: 'weather/1', value: { status: 'Supplier owes widgets' } },
    ]) expect(simulationExternalAdjudicatedOutcomeSchema.safeParse({ ...weather, claim }).success).toBe(false)
  })
  it('refuses altered cognition version, captured publication or policy parameters at replay', async () => {
    const h = await fixture(weather)
    try {
      const record = h.record()
      if (record.basis.kind !== 'model') throw new Error('Expected model source')
      for (const altered of [
        { ...record, basis: { ...record.basis, modelVersion: 'forged' } },
        { ...record, actualInputHash: businessFingerprint(null) },
        { ...record, policyParameters: { ...record.policyParameters, maxDelay: '21' } },
        { ...record, actualPublication: { ...record.actualPublication!, version: '2' } },
      ]) expect(() => h.fold(h.state, simulationExternalAdjudicationSchema.parse(altered))).toThrow()
      const decision = h.state.decisions[h.state.operations[h.plan.operationId]!.decisionId]!
      const { consumption: _receipt, ...withoutReceipt } = decision
      expect(() => h.record({ ...h.state, decisions: { ...h.state.decisions, [decision.id]: withoutReceipt } })).toThrow()
    } finally { await h.close() }
  })
  it.each(['unverified-report', 'failure'] as const)('keeps %s separate from authoritative Facts', async (kind) => {
    const outcome = simulationExternalAdjudicatedOutcomeSchema.parse(kind === 'failure'
      ? { ...common, kind, code: 'declined', description: 'A simulated decline.' }
      : { ...common, kind, reliability: 'unverified', statement: 'An attributed unverified offer.',
        quote: { unit: 'widget', quantity: '7', price: { currency: 'USD', quantity: '12' }, validUntil: '9' } })
    const h = await fixture(outcome)
    try {
      const projection = h.fold()
      expect(projection.publications).toEqual([])
      expect(projection.event).toBeUndefined()
      expect(projection.resultPayload).toMatchObject({ attribution: 'scenario-generated', outcome: { kind } })
    } finally { await h.close() }
  })
  it('retains one finite delayed leaf, refuses early consumption and blocks changed policy', async () => {
    const leaf = simulationExternalAdjudicatedOutcomeSchema.parse({ ...weather, effectiveFrom: '3' })
    const outcome = simulationExternalAdjudicatedOutcomeSchema.parse({ ...common, kind: 'delayed-event', key: 'weather-later',
      deliverAt: '3', outcome: leaf })
    const h = await fixture(outcome)
    try {
      const projection = h.fold(), duty = projection.event!
      expect(projection.publications).toEqual([])
      expect(duty.original.eventId).toBe(`simulation-external-adjudication:${h.intent.id}:${businessFingerprint([h.intent.id,
        'weather-later']).slice(7)}`)
      expect(duty.original.initialResultId).toBe(worldResultIdSchema.parse(`world-result:${h.intent.id}`))
      let state: SimulationSnapshot = { ...h.state, world: { ...h.state.world!, external: projection.external,
        requests: { ...h.state.world!.requests, [h.request.id]: { ...h.request, status: 'committed' } } } }
      expect(validateExternalAdjudicatedEvent(state, duty)).toBe('source-change')
      state = { ...state, time: '3' as SimulationSnapshot['time'] }
      const actual = prepareExternalAdjudicatedEventConsumption(state, duty, state.revision + 1)
      expect('block' in actual).toBe(false)
      if ('block' in actual) throw new Error('Expected original finite consumption')
      expect(actual.publications).toHaveLength(1)
      expect(actual.consumption.actualPublication).toEqual(actual.publications[0])
      const changed: SimulationSnapshot = { ...state, world: { ...state.world!, definition: { ...state.world!.definition,
        externalAdjudicationPolicy: { ...state.world!.definition.externalAdjudicationPolicy!,
          maxDelay: '21' as SimulationSnapshot['time'] } } } }
      expect(validateExternalAdjudicatedEvent(changed, duty)).toBe('policy-mismatch')
      expect(validateExternalAdjudicatedEvent({ ...state, relations: {} }, duty)).toBe('authority-conflict')
      const forged = simulationExternalAdjudicatedEventStateSchema.parse({ ...duty, original: { ...duty.original,
        eventId: simulationEventIdSchema.parse('forged-original') } })
      expect(validateExternalAdjudicatedEvent(state, forged)).toBe('source-change')
    } finally { await h.close() }
  })
})


it('director environment normalization refuses a representative conversation while ordinary requester plans retain that family', async () => {
  const h = await fixture(weather)
  try {
    const request = h.request.proposal, director = h.state.world!.definition.directorEntityId
    expect(h.payload.responseScope.allowed).toContain('representative-preparation-plan')
    expect(() => h.module.admitRequest(h.state, director, request)).toThrow(/cannot prepare representatives/)
    expect(h.module.admitRequest(h.state, h.intent.requesterEntityId, request).targetEntityId).toBe(h.payload.subjectRef)
    const narrowed = { ...h.payload, responseScope: { ...h.payload.responseScope,
      allowed: h.payload.responseScope.allowed.filter(value => value !== 'representative-preparation-plan') } }
    expect(h.module.admitRequest(h.state, director, { ...request, payload: z.json().parse(narrowed) })
      .targetEntityId).toBe(h.payload.subjectRef)
  } finally { await h.close() }
})
