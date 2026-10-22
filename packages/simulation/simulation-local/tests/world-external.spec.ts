/** Pure external rejection and read-set checks; the independent Loader suite owns actual Agent/Channel/checkpoint evidence. */
import { describe, expect, it } from 'vitest'
import { simulationChangeSchema, simulationEntityIdSchema, simulationResourceIdSchema, simulationResourceSpecSchema,
  simulationWorldDefinitionSchema, simulationWorldRoleIntentSchema, simulationWorldRequestOperationSchema,
  simulationWorldResolveOperationSchema, simulationOperationIdSchema, simulationDecisionIdSchema,
  simulationWriterEpochSchema, simulationDecisionSlotSchema, worldRequestIdSchema, worldPlanIdSchema,
  simulationWorldDomainMutationSchema, WORLD_EXTERNAL_INTERACT_PIN, simulationExternalInteractRequestSchema,
  simulationExternalInteractPlanSchema, SimulationWorldDomainRegistry, worldResourceIdSchema,
  simulationChannelSpecSchema, simulationChannelKeySchema } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldRequest, SimulationWorldPlan, SimulationOperation } from '@clocky/clocky-simulation'
import { ExternalInteractNativeWorldDomain, acceptExternalIdentity, externalIdentityId, assertExternalProjection } from '../src/world-external.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { worldExecutionReads, worldPlanStaleReason, worldContext } from '../src/world.ts'
import { foldWorldMutation, prepareWorldMutationRecord } from '../src/world-mutation.ts'
import { worldResultNotificationActor } from '../src/world-result-role.ts'
import { worldResultWakeRecords, foldSchedulerRecord } from '../src/scheduler.ts'
import { channelIdSchema } from '@clocky/clocky-team/schema'
import { businessFingerprint } from '../src/business.ts'
import { createBusinessHarness } from './business-harness.ts'

async function fixture(unknown = false, replacement?: NativeWorldDomain) {
  const h = await createBusinessHarness('json', { relationRules: [
      { relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false },
      { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    ] }), requester = await h.actor('requester'), director = await h.actor('director')
  for (const [id, entityKind] of [['organization', 'organization'], ['role', 'position'], ['supplier', 'organization'], ['other', 'organization']])
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition: 'none', readiness: 'ready',
      profile: { name: 'Same display name' } }), h.run.snapshot().revision)
  for (const [id, relation, target] of [['employment', 'assignment', 'role'], ['permission', 'can-interact', 'supplier']])
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id, subject: requester.id, relation,
      object: target, scope: 'organization', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
  if (!unknown) await h.account('stock', simulationEntityIdSchema.parse('supplier'), '7', [], 'inventory', 'widget')
  await h.account('money', simulationEntityIdSchema.parse('supplier'), '999', [], 'money', 'widget')
  let state: SimulationSnapshot = { ...h.run.snapshot(), world: { executions: {}, definition: simulationWorldDefinitionSchema.parse({
    directorEntityId: director.id, organizationEntityId: 'organization', operations: [WORLD_EXTERNAL_INTERACT_PIN],
    operationGrants: [{ requesterEntityId: requester.id, domain: 'external', operation: 'interact', version: '1', scopeEntityId: 'organization',
      targetEntityId: 'supplier', relationId: 'permission', relation: 'can-interact' }], positionRolePermissions: [],
    authorizations: [], positions: [{ entityId: 'role', capacity: 1 }], policyVersion: '1',
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
  const payload = simulationExternalInteractRequestSchema.parse({ scope: 'organization', subjectRef: 'supplier', externalKey: 'vendor-供应商',
    sourceKind: 'simulated-rule', policyRef: 'clocky.external.availability/1', input: { kind: 'availability', unit: 'widget' } })
  const module = replacement ?? new ExternalInteractNativeWorldDomain(), registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const unregister = registry.register(module.definition, module), runtime = new NativeWorldRuntime(registry)
  // These parsed sources isolate rejection folds; actual decision consumption and sender provenance are exercised by the Loader fixture.
  const { requestId: _requestId, ...parsedIntent } = simulationWorldRoleIntentSchema.parse({ id: 'original-intent', pin: WORLD_EXTERNAL_INTERACT_PIN, businessKey: 'availability',
    requesterEntityId: requester.id, scopeEntityId: 'organization', targetEntityId: payload.subjectRef,
    expectedTime: null, evidence: [], description: 'Inventory availability',
    payload, sequence: 3, requestId: 'original-request' })
  const intent = { ...parsedIntent, requestId: worldRequestIdSchema.parse('original-request') }
  const proposal = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: 'external', operation: 'interact', version: '1',
    businessKey: intent.businessKey, expectedTime: null, evidence: [], payload })
  const request: SimulationWorldRequest = { id: worldRequestIdSchema.parse('original-request'), intentId: intent.id,
    operationId: simulationOperationIdSchema.parse('request-op'), notificationOperationId: simulationOperationIdSchema.parse('notify-op'),
    requesterEntityId: requester.id, proposal, pin: intent.pin, source: { kind: 'decision', decisionId: simulationDecisionIdSchema.parse('request-decision'),
      epoch: simulationWriterEpochSchema.parse('1'), binding: state.entities[requester.id]!.binding! },
    description: intent.description, payloadHash: businessFingerprint(proposal), sequence: 3, plans: [worldPlanIdSchema.parse('original-plan')], status: 'open' }
  state = { ...state, world: { ...state.world!, intents: { [intent.id]: intent }, requests: { [request.id]: request } } }
  const external = acceptExternalIdentity(state, intent, request.id, 3)
  state = { ...state, world: { ...state.world!, external } }
  const disposition = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: request.id, supersedes: null,
    resolution: { kind: 'apply', payload: { kind: 'evaluate-rule' }, rationale: 'PRIVATE-DIRECTOR-CANARY' } })
  const plan: SimulationWorldPlan = { id: request.plans[0]!, requestId: request.id, operationId: simulationOperationIdSchema.parse('plan-op'),
    proposal: disposition, pin: intent.pin, reads: worldExecutionReads(state, intent, runtime), baseRevision: state.revision,
    sequence: 4, hash: businessFingerprint(disposition), status: 'accepted' }
  const operation: SimulationOperation = { id: plan.operationId, entityId: director.id, decisionId: simulationDecisionIdSchema.parse('director-decision'),
    index: 0, action: disposition, dependencies: [], fingerprint: businessFingerprint(disposition), status: 'pending' }
  state = { ...state, world: { ...state.world!, plans: { [plan.id]: plan } }, operations: { [operation.id]: operation },
    decisions: { [request.source.decisionId]: { id: request.source.decisionId, entityId: requester.id, epoch: request.source.epoch,
      slot: simulationDecisionSlotSchema.parse('0'), snapshotRevision: 2, entityRevision: state.entities[requester.id]!.revision,
      time: state.time, status: 'accepted', operationIds: [request.operationId], closedAt: 3 },
    [operation.decisionId]: { id: operation.decisionId, entityId: director.id, epoch: simulationWriterEpochSchema.parse('1'),
      slot: simulationDecisionSlotSchema.parse('0'), snapshotRevision: state.revision, entityRevision: 1, time: state.time,
      status: 'accepted', operationIds: [operation.id] } } }
  const record = (current = state) => {
    const mutation = simulationWorldDomainMutationSchema.parse({ kind: 'world/mutation', id: `world-mutation:${plan.id}`, requestId: request.id,
      planId: plan.id, pin: plan.pin, payload: { kind: 'evaluate-rule' }, time: current.time, recordedAt: 1234, sequence: current.revision + 1 })
    return prepareWorldMutationRecord(current, mutation, runtime)
  }
  const fold = (current = state) => {
    const retained = record(current)
    const next = foldWorldMutation(current, retained, retained.mutation.sequence, runtime)
    return { ...next, revision: retained.mutation.sequence }
  }
  return { state, payload, proposal, intent, request, plan, module, runtime, fold, record,
    close: async () => { runtime.close(); await unregister(); await h.close() } }
}

describe('external Native evaluation', () => {
  it.each(['requester', 'director'] as const)('schedules and authorizes only the original pinned %s notification role', async (role) => {
    class DirectorRule extends ExternalInteractNativeWorldDomain { readonly resultNotificationRole = 'director' as const }
    const h = await fixture(false, role === 'director' ? new DirectorRule() : undefined)
    try {
      let state = h.fold()
      const result = Object.values(state.world!.results)[0]!, requester = h.request.requesterEntityId
      const director = state.world!.definition.directorEntityId, actor = role === 'director' ? director : requester
      expect(worldResultNotificationActor(state, result, h.runtime)).toBe(actor)
      const event = worldResultWakeRecords(state, result, h.runtime)[0]!
      if (event.kind !== 'event/queued') throw new Error('Expected original result wake')
      expect(event.action).toMatchObject({ kind: 'wake', entityId: actor })
      expect(() => foldSchedulerRecord(state, { ...event, action: { kind: 'wake',
        entityId: role === 'director' ? requester : director, reason: JSON.stringify({ resultId: result.id }) } },
      state.revision + 1, h.runtime)).toThrow(/original business result/)
      state = { ...foldSchedulerRecord(state, event, state.revision + 1, h.runtime), revision: state.revision + 1 }
      expect(worldResultWakeRecords(state, result, h.runtime)).toEqual([])
      const channelId = channelIdSchema.parse('original-private-control'), key = simulationChannelKeySchema.parse('original-control')
      const original = state.decisions[state.operations[h.plan.operationId]!.decisionId]!
      const decision = { ...original, id: simulationDecisionIdSchema.parse('original-notification'), entityId: actor,
        status: 'open' as const, snapshotRevision: state.revision, wakeId: event.id }
      // Parsed causal state isolates the source/role rejection; actual Agent consumption and sender IO belong to Loader fixtures.
      const selected: SimulationSnapshot = { ...state, world: { ...state.world!, channels: { [requester]: channelId } },
        channelReservations: { [key]: { channelId, confirmed: true, spec: simulationChannelSpecSchema.parse({ key, limits: {},
          members: [{ entityId: requester, role: 'requester' }, { entityId: director, role: 'director' }] }) } },
        scheduledEvents: { ...state.scheduledEvents, [event.id]: { ...state.scheduledEvents[event.id]!, status: 'consumed' } },
        wakes: { [event.id]: { eventId: event.id, entityId: actor, reason: JSON.stringify({ resultId: result.id }),
          status: 'claimed', decisionId: decision.id } } }
      const view = worldContext(selected, decision, { kind: 'result', resultId: result.id }, h.runtime)
      expect(view.authority).toMatchObject({ kind: 'result', notification: {
        recipient: role === 'director' ? requester : director, channelId } })
      expect(() => worldContext(selected, { ...decision, entityId: role === 'director' ? requester : director },
        { kind: 'result', resultId: result.id }, h.runtime)).toThrow(/original actor/)
      expect(() => worldContext({ ...selected, channelReservations: {} }, decision,
        { kind: 'result', resultId: result.id }, h.runtime)).toThrow(/canonical private endpoints/)
      expect(() => worldResultNotificationActor({ ...selected, world: { ...selected.world!,
        definition: { ...selected.world!.definition, operations: [] } } }, result, h.runtime)).toThrow(/pinned intent/)
      expect(() => worldResultNotificationActor(selected, result, undefined)).toThrow(/installed Native domain catalog/)
    } finally { await h.close() }
  })
  it.each([false, true])('records actual input and unknown=%s result without minting resources or copying private rationale', async (unknown) => {
    const h = await fixture(unknown)
    try {
      const next = h.fold(), item = next.world!.external.interactions[h.intent.id]!
      expect(item.result.availability).toEqual(unknown ? { status: 'unknown', unit: 'widget' } : { status: 'known', unit: 'widget', quantity: '7' })
      expect(item.resources.map(value => value.id)).toEqual(unknown ? [] : ['stock'])
      expect(item.recordedAt).toBe(1234)
      expect(next.resources).toEqual(h.state.resources)
      expect(next.entities).toEqual(h.state.entities)
      expect(JSON.stringify(next.world!.external)).not.toContain('PRIVATE-DIRECTOR-CANARY')
      expect(() => { assertExternalProjection(next) }).not.toThrow()
      expect(() => h.fold(next)).toThrow(/original request, plan or unique mutation/)
    } finally { await h.close() }
  })
  it('bounds the complete UTF-8 append including retained evaluation and metadata at its exact byte limit', async () => {
    const h = await fixture()
    try {
      const record = h.record(), wrapper = { kind: 'run/world-mutation', runId: h.state.spec.runId,
        expectedRevision: record.mutation.sequence - 1, change: record }
      const serialized = JSON.stringify(wrapper), bytes = Buffer.byteLength(serialized, 'utf8')
      expect(bytes).toBeGreaterThan(serialized.length)
      const atLimit = { ...h.state, world: { ...h.state.world!, definition: { ...h.state.world!.definition,
        limits: { ...h.state.world!.definition.limits, maxBytesPerPlan: bytes } } } }
      expect(() => foldWorldMutation(atLimit, record, record.mutation.sequence, h.runtime)).not.toThrow()
      const tooSmall = { ...atLimit, world: { ...atLimit.world, definition: { ...atLimit.world.definition,
        limits: { ...atLimit.world.definition.limits, maxBytesPerPlan: bytes - 1 } } } }
      expect(() => foldWorldMutation(tooSmall, record, record.mutation.sequence, h.runtime)).toThrow(/Complete retained domain mutation/)
    } finally { await h.close() }
  })
  it('requires actual persisted rule inputs/output at replay and refuses altered or missing evaluation evidence', async () => {
    const h = await fixture()
    try {
      const record = h.record(), evaluation = record.externalEvaluation!
      expect(evaluation.result.availability).toEqual({ status: 'known', unit: 'widget', quantity: '7' })
      const { externalEvaluation: _missing, ...without } = record
      expect(() => foldWorldMutation(h.state, without, record.mutation.sequence, h.runtime)).toThrow(/actual recorded evaluation/)
      const altered = { ...record, externalEvaluation: { ...evaluation, resources: [] } }
      expect(() => foldWorldMutation(h.state, altered, record.mutation.sequence, h.runtime)).toThrow(/exact input or rule output/)
      expect(JSON.stringify(record)).not.toContain('PRIVATE-DIRECTOR-CANARY')
      expect(h.fold().world!.external.interactions[h.intent.id]).toEqual(evaluation)
    } finally { await h.close() }
  })
  it('reuses the same scope/key independently of names and request identity, rejecting reassignment to another subject', async () => {
    const h = await fixture()
    try {
      expect(acceptExternalIdentity(h.state, h.intent, worldRequestIdSchema.parse('another-request'), 99)).toBe(h.state.world!.external)
      expect(externalIdentityId(h.state, h.payload)).toBe(externalIdentityId(h.state, { ...h.payload }))
      expect(externalIdentityId({ ...h.state, spec: { ...h.state.spec, runId: h.state.spec.runId + '-other' as typeof h.state.spec.runId } }, h.payload))
        .not.toBe(externalIdentityId(h.state, h.payload))
      expect(externalIdentityId(h.state, { ...h.payload, scope: simulationEntityIdSchema.parse('other') }))
        .not.toBe(externalIdentityId(h.state, h.payload))
      expect(externalIdentityId(h.state, { ...h.payload, externalKey: 'another-vendor' }))
        .not.toBe(externalIdentityId(h.state, h.payload))
      expect(() => h.module.admitRequest(h.state, h.intent.requesterEntityId,
        { ...h.proposal, payload: { ...h.payload, scope: 'other' } })).toThrow(/declared scope/)
      expect(() => h.module.admitRequest(h.state, h.intent.requesterEntityId, { ...h.proposal, payload: { ...h.payload, subjectRef: 'other' } }))
        .toThrow(/original subject/)
    } finally { await h.close() }
  })
  it.each(['url', 'credentials', 'sender', 'requesterEntityId', 'source', 'sink', 'quantity'])('rejects the %s field and arbitrary rule output before effects', async (field) => {
    const h = await fixture()
    try {
      expect(() => simulationExternalInteractRequestSchema.parse({ ...h.payload, [field]: 'forged' })).toThrow()
      expect(() => simulationExternalInteractPlanSchema.parse({ kind: 'evaluate-rule', quantity: '900' })).toThrow()
      expect(() => simulationExternalInteractRequestSchema.parse({ ...h.payload, sourceKind: 'director-mediated' })).toThrow()
      expect(() => simulationExternalInteractRequestSchema.parse({ ...h.payload, externalKey: 'https://example.invalid' })).toThrow()
      expect(() => simulationExternalInteractRequestSchema.parse({ ...h.payload, policyRef: 'uninstalled-policy' })).toThrow()
    } finally { await h.close() }
  })
  it.each([false, true])('detects changed and newly materialized inventory while unknown=%s; unrelated accounts do not stale the plan', async (unknown) => {
    const h = await fixture(unknown)
    try {
      const money = h.state.resources[simulationResourceIdSchema.parse('money')]!
      const unrelated = { ...h.state, resources: { ...h.state.resources, [money.id]: { ...money, revision: money.revision + 1 } } }
      expect(worldPlanStaleReason(unrelated, h.plan, h.runtime)).toBeUndefined()
      const stock = { ...simulationResourceSpecSchema.parse({ id: 'stock', owner: 'supplier', kind: 'inventory', unit: 'widget', quantity: '6', controllers: [] }), revision: 2 }
      const changed = { ...h.state, resources: { ...h.state.resources, [stock.id]: stock } }
      expect(worldPlanStaleReason(changed, h.plan, h.runtime)).toBe('read-set-changed')
      expect(() => h.fold(changed)).toThrow(/execution dependencies/)
      expect(h.plan.status).toBe('accepted')
      const lostAuthority = { ...h.state, relations: {} }
      expect(() => h.fold(lostAuthority)).toThrow(/execution dependencies/)
    } finally { await h.close() }
  })
  it('bounds complete retained identity/evaluation tables and rejects a provider trying to substitute a result', async () => {
    const original = new ExternalInteractNativeWorldDomain()
    const forged = Object.create(original) as NativeWorldDomain
    forged.reduceMutation = (...args) => {
      const projection = original.reduceMutation(...args)
      return { ...projection, resultPayload: { ...projection.resultPayload, availability: { status: 'known', quantity: '900', unit: 'widget' } } }
    }
    const h = await fixture(false, forged)
    try {
      expect(() => h.fold()).toThrow(/independently derived/)
      forged.reduceMutation = (...args) => ({ ...original.reduceMutation(...args), changes: [
        simulationChangeSchema.parse({ kind: 'entity/create', id: 'forged-identity', entityKind: 'organization',
          cognition: 'none', readiness: 'ready', profile: {} }),
      ] })
      expect(() => h.fold()).toThrow(/cannot change resources/)
      forged.reduceMutation = (...args) => ({ ...original.reduceMutation(...args), externalEffects: [] })
      expect(() => h.fold()).toThrow(/omitted its required closed evaluation/)
      forged.reduceMutation = (...args) => original.reduceMutation(...args)
      const tiny = { ...h.state, spec: { ...h.state.spec, maxKnowledgeBytes: 1 } }
      expect(() => h.fold(tiny)).toThrow(/byte allowance/)
    } finally { await h.close() }
  })
  it('verifies historical inputs against retained reads rather than re-reading current balances and refuses missing source evidence', async () => {
    const h = await fixture()
    try {
      const next = h.fold(), stock = next.resources[simulationResourceIdSchema.parse('stock')]!
      const current = { ...next, resources: { ...next.resources, [stock.id]: { ...stock, quantity: '0' as typeof stock.quantity, revision: 99 } } }
      expect(() => { assertExternalProjection(current) }).not.toThrow()
      const missing = { ...next, world: { ...next.world!, external: { ...next.world!.external, interactions: {} } } }
      expect(() => { assertExternalProjection(missing) })
        .toThrow(/lost its actual retained evaluation/)
      const item = next.world!.external.interactions[h.intent.id]!
      const corrupt = { ...next, world: { ...next.world!, external: { ...next.world!.external,
        interactions: { [h.intent.id]: { ...item, resources: [{ ...item.resources[0]!, quantity: '900' as typeof stock.quantity }],
          result: { ...item.result, availability: { status: 'known' as const, unit: 'widget', quantity: '900' as typeof stock.quantity } } } } },
      results: Object.fromEntries(Object.entries(next.world!.results).map(([id, value]) => [id, { ...value, payload: {
        ...value.payload as object, availability: { status: 'known', unit: 'widget', quantity: '900' } } }])) } }
      expect(() => { assertExternalProjection(corrupt) }).toThrow(/actual inputs/)
      expect(() => { assertExternalProjection({ ...next, world: { ...next.world!, mutations: {} } }) }).toThrow(/original identity/)
      expect(h.plan.reads).toContainEqual(expect.objectContaining({ kind: 'resource-owner-set', owner: 'supplier', unit: 'widget' }))
      expect(h.plan.reads).not.toContainEqual(expect.objectContaining({ kind: 'resource', id: worldResourceIdSchema.parse('money') }))
    } finally { await h.close() }
  })
})
