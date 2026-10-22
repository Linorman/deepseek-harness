import { worldRolePlanOperationId } from '@clocky/clocky-simulation'
/** Native representative rejection folds; real canonical IO and Session/sender isolation belong to the Loader matrix. */
import { describe, expect, it } from 'vitest'
import { teamRootCreateInputSchema } from '@clocky/clocky-team/schema'
import { simulationChangeSchema, simulationEntityIdSchema, simulationWorldDefinitionSchema,
  simulationWorldRoleIntentSchema, simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema,
  simulationOperationIdSchema, simulationDecisionIdSchema, simulationWriterEpochSchema, simulationDecisionSlotSchema,
  simulationWorldHireReserveRequestSchema, simulationWorldHireIdentitiesSchema, simulationMaintenanceRequestSchema,
  WORLD_EXTERNAL_ACTOR_PIN, simulationExternalActorRequestSchema, SimulationWorldDomainRegistry,
  worldRequestIdSchema, worldPlanIdSchema, simulationWorldCancelRequestSchema, simulationWorldIdentityCleanupEvidenceSchema,
  simulationExternalContactCleanupEvidenceSchema, simulationExternalContactSchema,
  assertSimulationWorldPreparationAdmission } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationWorldPlan, SimulationWorldRequest, NativeWorldDomain,
  SimulationOperation } from '@clocky/clocky-simulation'
import { ExternalActorNativeWorldDomain, acceptExternalActorIdentity, foldExternalRepresentative,
  assertExternalRepresentativeProjection } from '../src/world-external-actor.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { worldExecutionReads, worldPlanStaleReason, foldWorld } from '../src/world.ts'
import { foldEntityChange } from '../src/entities.ts'
import { assertWriterProjection } from '../src/writers.ts'
import { foldMaintenance } from '../src/maintenance.ts'
import { businessFingerprint } from '../src/business.ts'
import { createBusinessHarness } from './business-harness.ts'

async function fixture() {
  const h = await createBusinessHarness('json', { relationRules: [
      { relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false },
      { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
      { relation: 'represents', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    ] }), requester = await h.actor('requester'), director = await h.actor('director'), secondRequester = await h.actor('second-requester')
  for (const [id, entityKind] of [['organization', 'organization'], ['supplier', 'organization'], ['role', 'position']])
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition: 'none',
      readiness: 'ready', profile: {} }), h.run.snapshot().revision)
  for (const actor of [requester, secondRequester]) {
    for (const [suffix, relation, object] of [['employment', 'assignment', 'role'], ['permission', 'can-interact', 'supplier']])
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: `${actor.id}-${suffix}`,
        subject: actor.id, relation, object,
        scope: 'organization', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
  }
  await h.account('stock', simulationEntityIdSchema.parse('supplier'), '7', [], 'inventory', 'widget')
  let state: SimulationSnapshot = { ...h.run.snapshot(), teamReservation: { confirmed: true,
    teamId: h.run.snapshot().entities[requester.id]!.binding!.teamId,
    creation: teamRootCreateInputSchema.parse({ limits: { maxParticipants: 16, maxActivations: 100, maxTasks: 100, maxChannels: 100,
      maxEnvelopeBytes: 65536, maxChannelViewBytes: 65536, maxPendingDeliveriesPerChannel: 100, maxPendingDeliveriesPerParticipant: 100,
      maxPendingDeliveryPageSize: 100, maxPostIdempotencyEntriesPerChannel: 100, maxTaskAttemptsPerTask: 3, maxTaskLeaseDurationMs: 60000,
      maxTurnsPerTeam: 1000, maxModelTokensPerTeam: 1000000, maxWallTimeMsPerTeam: 100000,
      maxCostUnitsPerTeam: 1000, maxRetriesPerTeam: 100, maxInboxItemsPerParticipant: 100, maxRatePerParticipantPerMinute: 100 },
    goal: { objective: 'Representative', budgets: {} }, budgets: {},
    rules: { activationLifecycleOwner: 'original-owner' } }) },
  world: { executions: {}, external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
    definition: simulationWorldDefinitionSchema.parse({ directorEntityId: director.id, organizationEntityId: 'organization',
      operations: [WORLD_EXTERNAL_ACTOR_PIN], operationGrants: [requester, secondRequester].map(actor => ({ requesterEntityId: actor.id,
        domain: 'external', operation: 'interact', version: '2', scopeEntityId: 'organization', targetEntityId: 'supplier',
        relationId: `${actor.id}-permission`, relation: 'can-interact' })),
      positionRolePermissions: [], positions: [{ entityId: 'role', capacity: 2 }], authorizations: [],
      templates: [{ id: 'external', version: '1', names: ['Lin'], skills: ['supply'], traits: [], goals: ['reply'],
        description: 'Public representative Persona' }],
      policyVersion: '1', limits: { maxRequests: 10,
        maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 10,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 8192, maxBytesPerPlan: 8192 } }),
    personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] }, sequence: 1, channels: {},
    intents: {}, requests: {}, plans: {},
    mutations: {}, results: {}, reservations: {}, cancellations: {}, facts: {}, evidence: { challenges: {}, revisions: {} },
    governance: { proposals: {}, votes: {}, resolutions: {} },
    norms: { versions: {}, closures: [], announcements: {} } } }
  const payload = simulationExternalActorRequestSchema.parse({ scope: 'organization', externalKey: 'supplier-key', subjectRef: 'supplier',
    sourceKind: 'simulated-actor', policyRef: 'clocky.external.representative/1', input: { kind: 'contact', unit: 'widget' } })
  const { requestId: _absent, ...body } = simulationWorldRoleIntentSchema.parse({ id: 'original-intent', pin: WORLD_EXTERNAL_ACTOR_PIN,
    requesterEntityId: requester.id, scopeEntityId: 'organization', targetEntityId: payload.subjectRef,
    businessKey: 'original-contact', payload, expectedTime: null, evidence: [], description: 'Contact supplier', sequence: 3 })
  const intent = { ...body, requestId: worldRequestIdSchema.parse('original-request') }
  const request: SimulationWorldRequest = { id: intent.requestId, intentId: intent.id, pin: intent.pin, requesterEntityId: requester.id,
    operationId: simulationOperationIdSchema.parse('request-op'), notificationOperationId: simulationOperationIdSchema.parse('notify-op'),
    proposal: simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: 'external', operation: 'interact', version: '2',
      businessKey: intent.businessKey, payload, expectedTime: null, evidence: [] }), description: intent.description,
    payloadHash: 'sha256:' + 'a'.repeat(64),
    sequence: 3, status: 'open', plans: [worldPlanIdSchema.parse('original-plan')], source: { kind: 'decision',
      decisionId: simulationDecisionIdSchema.parse('request-decision'),
      epoch: simulationWriterEpochSchema.parse('1'), binding: state.entities[requester.id]!.binding! } }
  const module = new ExternalActorNativeWorldDomain(), registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const unregister = registry.register(module.definition, module), runtime = new NativeWorldRuntime(registry)
  state = { ...state, world: { ...state.world!, intents: { [intent.id]: intent }, requests: { [request.id]: request } } }
  state = { ...state, world: { ...state.world!, external: acceptExternalActorIdentity(state, intent, request.id, 3) } }
  const disposition = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: request.id, supersedes: null,
    resolution: { kind: 'apply', payload: { templateId: 'external', templateVersion: '1', persona: { name: 'Lin',
      skills: ['supply'], traits: [], goals: ['reply'] } },
    rationale: 'PRIVATE-DIRECTOR-RATIONALE' } })
  const plan: SimulationWorldPlan = { id: request.plans[0]!, requestId: request.id, pin: intent.pin,
    operationId: simulationOperationIdSchema.parse('plan-op'),
    proposal: disposition, status: 'accepted', reads: worldExecutionReads(state, intent, runtime),
    baseRevision: state.revision, sequence: 4, hash: businessFingerprint(disposition) }
  const operation: SimulationOperation = { id: plan.operationId,
    decisionId: simulationDecisionIdSchema.parse('director-decision'), entityId: director.id,
    index: 0, action: disposition, dependencies: [], status: 'pending', fingerprint: businessFingerprint(disposition) }
  // Parsed linkage isolates synchronous rejection folds. Real Session consumption and target receipts belong to the Loader matrix.
  state = { ...state, world: { ...state.world!, plans: { [plan.id]: plan } }, operations: { [operation.id]: operation },
    decisions: { [operation.decisionId]: { id: operation.decisionId, entityId: director.id, status: 'accepted',
      epoch: simulationWriterEpochSchema.parse('1'),
      slot: simulationDecisionSlotSchema.parse('0'), entityRevision: 1, snapshotRevision: 3, time: state.time,
      operationIds: [operation.id] } } }
  const requestInput = simulationWorldHireReserveRequestSchema.parse({ planId: plan.id,
    maintenance: { id: 'original-maintenance', owner: 'original-owner' },
    member: { displayName: 'Lin', role: 'member', capabilities: [], provider: 'in-process', preset: 'simulation',
      model: 'scripted/representative', modelVersion: '1' } })
  const identities = simulationWorldHireIdentitiesSchema.parse({ entityId: 'representative',
    relationId: 'represents-original', binding: { teamId: 'company', participantId: 'rep', sessionId: 'rep-session' },
    channels: [{ purpose: 'director', key: 'rep-director', channelId: 'rep-director-channel' }, { purpose: 'requester',
      key: 'rep-requester', channelId: 'rep-requester-channel' }] })
  const reserve = () => foldExternalRepresentative(state, { kind: 'external/reserved', request: requestInput, identities },
    state.revision + 1, runtime)
  const pause = (previous: SimulationSnapshot) => {
    const entities = Object.fromEntries(Object.entries(previous.entities).map(([id, value]) => [id, value.writer === undefined ? value : {
      ...value, writer: { ...value.writer, phase: 'released' as const } }]))
    return { ...previous, phase: 'paused' as const, entities, maintenance: { [requestInput.maintenance.id]: {
      request: requestInput.maintenance, status: 'quiescent' as const, startedSequence: previous.revision - 1,
      quiescentSequence: previous.revision } } }
  }
  const prepare = () => {
    const reserved = reserve(), quiescent = pause({ ...reserved, revision: state.revision + 1 })
    return { ...foldExternalRepresentative(quiescent, { kind: 'external/preparing', id: intent.id }, quiescent.revision + 1,
      runtime), revision: quiescent.revision + 1 }
  }
  return { state, intent, request, plan, module, runtime, requestInput, identities, reserve, pause, prepare, secondRequester,
    close: async () => { runtime.close(); await unregister(); await h.close() } }
}

// Parsed owner folds isolate Native cancellation contracts; they do not claim physical Team/Channel IO.
async function contactFixture(sameCaller: boolean) {
  const h = await fixture()
  let state = h.prepare()
  const person = state.entities[h.identities.entityId]!
  state = { ...state, entities: { ...state.entities, [person.id]: { ...person, binding: h.identities.binding } },
    channelReservations: Object.fromEntries(Object.entries(state.channelReservations ?? {})
      .map(([key, channel]) => [key, { ...channel, confirmed: true }])) }
  state = { ...foldExternalRepresentative(state, { kind: 'external/committed', id: h.intent.id }, state.revision + 1, h.runtime),
    revision: state.revision + 1, maintenance: {} }
  const first = state.world!.external.contacts[h.intent.id]!, representative = state.world!.external.representatives[h.intent.id]!
  const requesterEntityId = sameCaller ? h.intent.requesterEntityId : h.secondRequester.id
  const requestId = worldRequestIdSchema.parse('new-contact-request'), planId = worldPlanIdSchema.parse('new-contact-plan')
  const intent = { ...simulationWorldRoleIntentSchema.parse({ ...h.intent, id: 'new-contact-intent', requesterEntityId,
    businessKey: 'new-contact' }), requestId }
  const request: SimulationWorldRequest = { ...h.request, id: requestId, intentId: intent.id, requesterEntityId, plans: [planId],
    source: { ...h.request.source, binding: state.entities[requesterEntityId]!.binding! } }
  state = { ...state, world: { ...state.world!, intents: { ...state.world!.intents, [intent.id]: intent },
    requests: { ...state.world!.requests, [request.id]: request } } }
  const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId, supersedes: null,
    resolution: { kind: 'apply', payload: { kind: 'reuse', identityId: representative.identityId, generation: 1 }, rationale: 'Reuse' } })
  const plan = { ...h.plan, id: planId, requestId, proposal, operationId: simulationOperationIdSchema.parse('new-contact-plan-op'),
    reads: worldExecutionReads(state, intent, h.runtime) }
  const operation = { ...state.operations[h.plan.operationId]!, id: plan.operationId, action: proposal }
  state = { ...state, world: { ...state.world!, plans: { ...state.world!.plans, [plan.id]: plan } },
    operations: { ...state.operations, [operation.id]: operation } }
  const channel = sameCaller ? first.channel : {
    key: ('new-caller-channel' as typeof first.channel.key), channelId: ('new-caller-channel-id' as typeof first.channel.channelId) }
  state = { ...foldExternalRepresentative(state, { kind: 'external/contact-reserved', planId, channel }, state.revision + 1, h.runtime),
    revision: state.revision + 1 }
  const reserved = state
  for (const id of ['first-contact-cancel', 'second-contact-cancel']) {
    state = { ...foldWorld(state, { kind: 'world/cancelled', request: simulationWorldCancelRequestSchema.parse({ id, requestId }) },
      state.revision + 1, h.runtime), revision: state.revision + 1 }
  }
  const contact = state.world!.external.contacts[intent.id]!
  const maintenance = contact.cancellation!.maintenance
  state = { ...state, maintenance: { [maintenance.id]: { request: maintenance, status: 'quiescent',
    startedSequence: state.revision - 1, quiescentSequence: state.revision } } }
  return { ...h, state, reserved, contact, first, maintenance }
}

describe('Native simulated representative', () => {
  it('reserves actual identity before IO, freezes Persona, and rejects a second generation or another original route', async () => {
    const h = await fixture()
    try {
      const reserved = h.reserve()
      expect(reserved.entities[h.identities.entityId]).toBeUndefined()
      expect(reserved.resources).toBe(h.state.resources)
      expect(() => foldExternalRepresentative(reserved, { kind: 'external/reserved', request: h.requestInput,
        identities: h.identities }, reserved.revision + 2, h.runtime))
        .toThrow(/original representative generation/)
      expect(() =>{  h.module.validatePlan(h.state, h.intent, { kind: 'apply', payload: { templateId: 'external', templateVersion: '1',
        persona: { name: 'Forged', skills: [], traits: [], goals: [] } }, rationale: 'Forged' }) }).toThrow(/finite template/)
      expect(() => h.module.reduceMutation(h.state, h.intent, h.plan, {})).toThrow(/original canonical preparation/)
    } finally { await h.close() }
  })
  it.each(['maxBirthsPerInterval', 'maxExternalExpansionsPerInterval'] as const)(
    'rejects zero %s before representative identity or topology allocation', async (key) => {
      const h = await fixture()
      try {
        const state = { ...h.state, world: { ...h.state.world!, definition: { ...h.state.world!.definition,
            limits: { ...h.state.world!.definition.limits, [key]: 0 } } } }, before = structuredClone(state)
        expect(() => foldExternalRepresentative(state, { kind: 'external/reserved', request: h.requestInput,
          identities: h.identities }, state.revision + 1, h.runtime)).toThrow(expect.objectContaining({
          code: 'SIM_WORLD_LIMIT', failure: { code: 'SIM_WORLD_LIMIT',
            limit: key === 'maxBirthsPerInterval' ? 'births' : 'expansions' } }))
        expect(state).toEqual(before)
      } finally { await h.close() }
    })
  it('charges original Entity, historical Participant and two Channel allocations at exact reservation limits', async () => {
    const h = await fixture()
    try {
      const record = { kind: 'external/reserved' as const, request: h.requestInput, identities: h.identities }
      const counts = { entities: Object.values(h.state.entities).filter(value => value.phase !== 'terminated').length,
        participants: Object.values(h.state.entities)
          .filter(value => value.binding !== undefined || value.participantReservation !== undefined).length,
        channels: Object.keys(h.state.channelReservations ?? {}).length }
      for (const limit of ['entities', 'participants', 'channels'] as const) {
        const required = counts[limit] + (limit === 'channels' ? 2 : 1)
        for (const available of [required - 1, required]) {
          const state = limit === 'entities' ? { ...h.state, spec: { ...h.state.spec, maxEntities: available } }
            : { ...h.state, teamReservation: { ...h.state.teamReservation!, creation: { ...h.state.teamReservation!.creation,
              limits: { ...h.state.teamReservation!.creation.limits!,
                [limit === 'participants' ? 'maxParticipants' : 'maxChannels']: available } } } }
          const before = structuredClone(state)
          if (available === required) {
            const reserved = foldExternalRepresentative(state, record, state.revision + 1, h.runtime)
            expect(Object.keys(reserved.world!.external.representatives)).toEqual([h.intent.id])
            expect(reserved.entities).toBe(state.entities)
          } else {
            try {
              foldExternalRepresentative(state, record, state.revision + 1, h.runtime)
              throw new Error('Occupied capacity was admitted')
            } catch (error) { expect(error).toMatchObject({ failure: { code: 'SIM_WORLD_LIMIT', limit } }) }
          }
          expect(state).toEqual(before)
        }
      }
    } finally { await h.close() }
  })
  it('bounds the complete multibyte reservation record and retained external history before publishing either', async () => {
    const h = await fixture()
    try {
      const identities = simulationWorldHireIdentitiesSchema.parse({ ...h.identities,
        channels: h.identities.channels.map(channel => ({ ...channel, key: `${channel.key}-代表` })) })
      const record = { kind: 'external/reserved' as const, request: h.requestInput, identities }
      const encoded = JSON.stringify({ kind: 'run/external-representative', runId: h.state.spec.runId,
        expectedRevision: h.state.revision, change: record })
      const exact = Buffer.byteLength(encoded, 'utf8')
      expect(exact).toBeGreaterThan(encoded.length)
      for (const bytes of [exact - 1, exact]) {
        const state = { ...h.state, world: { ...h.state.world!, definition: { ...h.state.world!.definition,
          limits: { ...h.state.world!.definition.limits, maxBytesPerPlan: bytes } } } }
        if (bytes === exact) expect(() => foldExternalRepresentative(state, record, state.revision + 1, h.runtime)).not.toThrow()
        else expect(() => foldExternalRepresentative(state, record, state.revision + 1, h.runtime))
          .toThrow(/Complete representative transition/)
      }
      const reserved = foldExternalRepresentative(h.state, record, h.state.revision + 1, h.runtime)
      const historyBytes = Buffer.byteLength(JSON.stringify(reserved.world!.external), 'utf8')
      for (const bytes of [historyBytes - 1, historyBytes]) {
        const state = { ...h.state, spec: { ...h.state.spec, maxKnowledgeBytes: bytes } }
        if (bytes === historyBytes) expect(() => foldExternalRepresentative(state, record, state.revision + 1, h.runtime)).not.toThrow()
        else expect(() => foldExternalRepresentative(state, record, state.revision + 1, h.runtime))
          .toThrow(/history exceeds its byte allowance/)
      }
    } finally { await h.close() }
  })
  it('protects preparing UUID, Persona, lifecycle, readiness and represents relation until its atomic original commit', async () => {
    const h = await fixture()
    try {
      const reserved = h.reserve(), preparing = h.prepare(), person = preparing.entities[h.identities.entityId]!
      expect(() => foldEntityChange(reserved, simulationChangeSchema.parse({ kind: 'entity/create', id: person.id,
        entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} })))
        .toThrow(/reserved identities/)
      for (const command of [
        { kind: 'entity/profile', id: person.id, entityRevision: person.revision, profile: { name: 'Forged' } },
        { kind: 'entity/phase', id: person.id, entityRevision: person.revision, phase: 'inactive' },
        { kind: 'entity/readiness', id: person.id, entityRevision: person.revision, readiness: 'ready' },
        { kind: 'relation/create', id: h.identities.relationId, relation: 'represents', subject: person.id,
          object: 'supplier', scope: 'organization', validFrom: '0', validUntil: null },
      ]) expect(() => foldEntityChange(preparing, simulationChangeSchema.parse(command))).toThrow()
      expect(() => foldExternalRepresentative(preparing, { kind: 'external/committed', id: h.intent.id },
        preparing.revision + 1, h.runtime)).toThrow(/binding or confirmed topology/)
      expect(preparing.entities[simulationEntityIdSchema.parse('supplier')]).toEqual(h.state.entities[simulationEntityIdSchema.parse('supplier')])
      expect(preparing.resources).toEqual(h.state.resources)
      expect(JSON.stringify(person.profile)).not.toContain('PRIVATE-DIRECTOR')
      expect(() => { assertExternalRepresentativeProjection(preparing) }).not.toThrow()
    } finally { await h.close() }
  })
  it('shares one ready generation and original caller Channel; rejects changed conversations, missing consent and cancelled contact', async () => {
    const h = await fixture()
    try {
      let ready = h.prepare()
      const person = ready.entities[h.identities.entityId]!
      ready = { ...ready, entities: { ...ready.entities, [person.id]: { ...person, binding: h.identities.binding } },
        channelReservations: Object.fromEntries(Object.entries(ready.channelReservations ?? {})
          .map(([key, value]) => [key, { ...value, confirmed: true }])) }
      ready = { ...foldExternalRepresentative(ready, { kind: 'external/committed', id: h.intent.id }, ready.revision + 1, h.runtime),
        revision: ready.revision + 1 }
      const representative = ready.world!.external.representatives[h.intent.id]!
      const firstContact = ready.world!.external.contacts[h.intent.id]!
      const newId = worldRequestIdSchema.parse('reuse-request'), newPlanId = worldPlanIdSchema.parse('reuse-plan')
      const intent = { ...h.intent, id: ('reuse-intent' as typeof h.intent.id), requestId: newId, businessKey: 'reuse-contact' }
      const request = { ...h.request, id: newId, intentId: intent.id, plans: [newPlanId], status: 'open' as const }
      ready = { ...ready, maintenance: {}, world: { ...ready.world!, intents: { ...ready.world!.intents, [intent.id]: intent },
        requests: { ...ready.world!.requests, [newId]: request } } }
      const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: newId, supersedes: null,
        resolution: { kind: 'apply', payload: { kind: 'reuse', identityId: representative.identityId, generation: 1 },
          rationale: 'Reuse original actor' } })
      const plan = { ...h.plan, id: newPlanId, requestId: newId, operationId: simulationOperationIdSchema.parse('reuse-plan-op'), proposal,
        reads: worldExecutionReads(ready, intent, h.runtime) }
      const oldOperation = ready.operations[h.plan.operationId]!, operation = { ...oldOperation, id: plan.operationId, action: proposal }
      ready = { ...ready, world: { ...ready.world!, plans: { ...ready.world!.plans, [newPlanId]: plan } },
        operations: { ...ready.operations, [operation.id]: operation } }
      const originalResources = ready.resources, originalEntities = ready.entities
      const businessResolution = proposal.resolution
      if (businessResolution.kind === 'awaiting-evidence') throw new Error('Reuse fixture requires a business resolution')
      expect(() => { h.module.validatePlan(ready, intent, businessResolution) }).not.toThrow()
      expect(() => foldExternalRepresentative(ready, { kind: 'external/contact-reserved', planId: newPlanId,
        channel: { ...firstContact.channel,
          channelId: ('forged-private-channel' as typeof firstContact.channel.channelId) } }, ready.revision + 1, h.runtime))
        .toThrow(/changed its canonical Channel/)
      const reserved = { ...foldExternalRepresentative(ready, { kind: 'external/contact-reserved', planId: newPlanId,
        channel: firstContact.channel }, ready.revision + 1, h.runtime), revision: ready.revision + 1 }
      const contact = reserved.world!.external.contacts[intent.id]!
      expect(contact.representativeIntentId).toBe(representative.id)
      expect(reserved.resources).toBe(originalResources)
      expect(reserved.entities).toBe(originalEntities)
      const noConsent = { ...reserved, channelReservations: Object.fromEntries(Object.entries(reserved.channelReservations ?? {})
        .map(([key, value]) => [key, { ...value, confirmed: false }])) }
      expect(() => foldExternalRepresentative(noConsent, { kind: 'external/contact-committed', id: intent.id },
        noConsent.revision + 1, h.runtime))
        .toThrow(/endpoint consent/)
      const committed = { ...foldExternalRepresentative(reserved, { kind: 'external/contact-committed', id: intent.id },
        reserved.revision + 1, h.runtime),
      revision: reserved.revision + 1 }
      expect(committed.resources).toBe(originalResources)
      expect(Object.keys(committed.world!.external.representatives)).toHaveLength(1)
      expect(committed.world!.external.contacts[intent.id]!.channel).toEqual(firstContact.channel)
      expect(() => { assertExternalRepresentativeProjection(committed) }).not.toThrow()
      const cancelled = { ...reserved, world: { ...reserved.world!, external: { ...reserved.world!.external,
        contacts: { ...reserved.world!.external.contacts, [intent.id]: { ...contact, status: 'cancel-requested' as const } } } } }
      expect(() => foldExternalRepresentative(cancelled, { kind: 'external/contact-committed', id: intent.id },
        cancelled.revision + 1, h.runtime))
        .toThrow(/unresolved original reservation/)
    } finally { await h.close() }
  })
  it('cancels only the original shared lease while its committed keeper and representative remain unchanged', async () => {
    const h = await contactFixture(true)
    try {
      const before = h.state, evidence = simulationExternalContactCleanupEvidenceSchema.parse({ kind: 'retained', teamCursor: 11,
        keeper: { id: h.first.id, sequence: h.first.updatedSequence, status: 'committed' },
        channel: { phase: 'active', channelId: h.contact.channel.channelId, cursor: 6 } })
      if (evidence.kind !== 'retained') throw new Error('Expected retained lease evidence')
      const record = { kind: 'external/contact-cancelled' as const, id: h.contact.id, evidence }
      expect(() => foldExternalRepresentative(before, { ...record, evidence: { ...evidence,
        keeper: { ...evidence.keeper, sequence: evidence.keeper.sequence + 1 } } }, before.revision + 1, h.runtime))
        .toThrow(/keeper changed/)
      expect(() => foldExternalRepresentative(before, { ...record, evidence: simulationExternalContactCleanupEvidenceSchema.parse({
        kind: 'terminal', teamCursor: 11, channel: { phase: 'closed', channelId: h.contact.channel.channelId, cursor: 6 } }) },
      before.revision + 1, h.runtime)).toThrow(/another original lease/)
      expect(() => foldMaintenance(before, { request: h.maintenance, status: 'completed' }, before.revision + 1))
        .toThrow(/conversation cleanup responsibility/)
      const next = { ...foldExternalRepresentative(before, record, before.revision + 1, h.runtime), revision: before.revision + 1 }
      expect(next.entities).toBe(before.entities)
      expect(next.relations).toBe(before.relations)
      expect(next.resources).toBe(before.resources)
      expect(next.channelReservations).toBe(before.channelReservations)
      expect(next.world!.external.representatives).toBe(before.world!.external.representatives)
      expect(next.world!.external.contacts[h.first.id]).toBe(h.first)
      expect(next.world!.external.contacts[h.contact.id]).toMatchObject({ status: 'cancelled', cleanup: { evidence } })
      expect(Object.values(next.world!.results).filter(result => result.requestId === h.contact.requestId))
        .toMatchObject([{ outcome: { kind: 'cancelled' }, source: { kind: 'cancel', commandId: 'first-contact-cancel' }, payload: {} }])
      expect(Object.values(next.world!.cancellations).map(command => command.status)).toEqual(['cancelled', 'already-resolved'])
      expect(() => { assertExternalRepresentativeProjection(next) }).not.toThrow()
      expect(() => { assertSimulationWorldPreparationAdmission(next, [h.identities.entityId], h.contact.channel.key) }).not.toThrow()
      expect(() => foldMaintenance(next, { request: h.maintenance, status: 'completed' }, next.revision + 1)).not.toThrow()
      expect(() => foldExternalRepresentative(next, record, next.revision + 1, h.runtime)).toThrow(/original withdrawal/)
    } finally { await h.close() }
  })
  it('requires terminal evidence for the sole caller lease, retains confirmed history and refuses cancelled channel IO', async () => {
    const h = await contactFixture(false)
    try {
      const channel = h.contact.channel
      for (const phase of ['pending', 'active', 'closing'])
        expect(() => simulationExternalContactCleanupEvidenceSchema.parse({ kind: 'terminal', teamCursor: 12,
          channel: { phase, channelId: channel.channelId, cursor: 7 } })).toThrow()
      expect(() => { assertSimulationWorldPreparationAdmission(h.state, [h.identities.entityId], channel.key) })
        .toThrow(/Withdrawn contact/)
      const evidence = simulationExternalContactCleanupEvidenceSchema.parse({ kind: 'terminal', teamCursor: 12,
        channel: { phase: 'absent', channelId: channel.channelId } })
      const confirmed = { ...h.state, channelReservations: { ...h.state.channelReservations,
        [channel.key]: { ...h.state.channelReservations![channel.key]!, confirmed: true } } }
      expect(() => foldExternalRepresentative(confirmed, { kind: 'external/contact-cancelled', id: h.contact.id, evidence },
        confirmed.revision + 1, h.runtime)).toThrow(/original canonical channel history/)
      const terminal = simulationExternalContactCleanupEvidenceSchema.parse({ kind: 'terminal', teamCursor: 12,
        channel: { phase: 'closed', channelId: channel.channelId, cursor: 7 } })
      const next = { ...foldExternalRepresentative(confirmed, { kind: 'external/contact-cancelled', id: h.contact.id, evidence: terminal },
        confirmed.revision + 1, h.runtime), revision: confirmed.revision + 1 }
      expect(next.entities).toBe(confirmed.entities)
      expect(next.resources).toBe(confirmed.resources)
      expect(next.world!.external.contacts[h.first.id]).toBe(h.first)
      expect(next.channelReservations).toBe(confirmed.channelReservations)
      expect(() => { assertExternalRepresentativeProjection(next) }).not.toThrow()
      expect(() => { assertSimulationWorldPreparationAdmission(next, [h.identities.entityId], channel.key) })
        .toThrow(/cannot be reopened or recycled/)
      const absent = { ...foldExternalRepresentative(h.state, { kind: 'external/contact-cancelled', id: h.contact.id, evidence },
        h.state.revision + 1, h.runtime), revision: h.state.revision + 1 }
      expect(() => { assertExternalRepresentativeProjection(absent) }).not.toThrow()
      const finished = { ...foldMaintenance(next, { status: 'completed', request: h.maintenance }, next.revision + 1),
        revision: next.revision + 1 }
      const requestId = worldRequestIdSchema.parse('replacement-request'), planId = worldPlanIdSchema.parse('replacement-plan')
      const previousIntent = finished.world!.intents[h.contact.id]!, previousRequest = finished.world!.requests[h.contact.requestId]!
      const intent = { ...simulationWorldRoleIntentSchema.parse({ ...previousIntent, id: 'replacement-intent',
        businessKey: 'replacement-contact', sequence: finished.revision + 1 }), requestId }
      const request = { ...previousRequest, id: requestId, intentId: intent.id, plans: [planId], status: 'open' as const }
      const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId, supersedes: null,
        resolution: { kind: 'apply', payload: { kind: 'reuse', identityId: h.contact.identityId, generation: 1 },
          rationale: 'New explicit case' } })
      const plan = { ...finished.world!.plans[h.contact.planId]!, id: planId, requestId, proposal,
        operationId: simulationOperationIdSchema.parse('replacement-plan-op'), reads: worldExecutionReads(finished, intent, h.runtime) }
      const previousOperation = finished.operations[worldRolePlanOperationId(finished.world!.plans[h.contact.planId]!)]!
      const replacement = { ...finished, world: { ...finished.world!, intents: { ...finished.world!.intents, [intent.id]: intent },
        requests: { ...finished.world!.requests, [requestId]: request }, plans: { ...finished.world!.plans, [planId]: plan } },
      operations: { ...finished.operations, [plan.operationId]: { ...previousOperation, id: plan.operationId, action: proposal } } }
      expect(() => foldExternalRepresentative(replacement, { kind: 'external/contact-reserved', planId, channel },
        replacement.revision + 1, h.runtime)).toThrow(/cannot recycle historical Channel allocation/)
      const freshChannel = simulationExternalContactSchema.shape.channel.parse({ key: 'replacement-channel',
        channelId: 'replacement-channel-id' })
      const fresh = foldExternalRepresentative(replacement, { kind: 'external/contact-reserved', planId, channel: freshChannel },
        replacement.revision + 1, h.runtime)
      expect(fresh.world!.external.contacts[h.contact.id]).toBe(replacement.world.external.contacts[h.contact.id])
      expect(fresh.world!.external.contacts[intent.id]!.channel).toEqual(freshChannel)
      expect(fresh.entities).toBe(replacement.entities)
      expect(fresh.resources).toBe(replacement.resources)
      expect(fresh.channelReservations![channel.key]).toBe(replacement.channelReservations![channel.key])

    } finally { await h.close() }
  })
  it('preserves original topology and earliest cancellation through proven representative abandonment', async () => {
    const h = await fixture()
    try {
      let state = h.prepare()
      const person = state.entities[h.identities.entityId]!
      state = { ...state, entities: { ...state.entities, [person.id]: { ...person, binding: h.identities.binding } },
        channelReservations: Object.fromEntries(Object.entries(state.channelReservations ?? {})
          .map(([key, value]) => [key, { ...value, confirmed: true }])) }
      const original = state
      for (const id of ['first-withdrawal', 'later-withdrawal']) {
        state = { ...foldWorld(state, { kind: 'world/cancelled', request: simulationWorldCancelRequestSchema.parse({
          id, requestId: h.request.id }) }, state.revision + 1, h.runtime), revision: state.revision + 1 }
      }
      expect(state.world!.external.representatives[h.intent.id]!.status).toBe('cancel-requested')
      expect(state.world!.results).toEqual({})
      const evidence = simulationWorldIdentityCleanupEvidenceSchema.parse({ binding: h.identities.binding, teamCursor: 10,
        participant: 'left', session: 'unmaterialized', channels: h.identities.channels.map(value => ({
          phase: 'closed', channelId: value.channelId, cursor: 5 })) })
      for (const bad of [
        { ...evidence, binding: { ...evidence.binding, participantId: 'foreign-participant' } },
        { ...evidence, participant: 'absent' },
        { ...evidence, channels: h.identities.channels.map(value => ({ phase: 'absent', channelId: value.channelId })) },
      ]) expect(() => foldExternalRepresentative(state, { kind: 'external/abandoned', id: h.intent.id,
        evidence: simulationWorldIdentityCleanupEvidenceSchema.parse(bad) }, state.revision + 1, h.runtime)).toThrow(/cleanup lost/)
      const next = { ...foldExternalRepresentative(state, { kind: 'external/abandoned', id: h.intent.id, evidence },
        state.revision + 1, h.runtime), revision: state.revision + 1 }
      expect(next.entities[person.id]).toMatchObject({ phase: 'terminated', readiness: 'abandoned', binding: h.identities.binding,
        profile: person.profile, participantReservation: person.participantReservation })
      expect(next.resources).toBe(original.resources)
      expect(next.channelReservations).toBe(original.channelReservations)
      expect(next.relations[h.identities.relationId]).toBeUndefined()
      expect(Object.values(next.world!.results)).toHaveLength(1)
      expect(Object.values(next.world!.results)[0]).toMatchObject({ outcome: { kind: 'cancelled' },
        source: { kind: 'cancel', commandId: 'first-withdrawal' }, payload: {} })
      expect(Object.values(next.world!.cancellations).map(value => value.status)).toEqual(['cancelled', 'already-resolved'])
      expect(() => { assertExternalRepresentativeProjection(next) }).not.toThrow()
      const partial = { ...next, entities: { ...next.entities, [person.id]: { ...next.entities[person.id]!, binding: undefined } },
        channelReservations: Object.fromEntries(Object.entries(next.channelReservations ?? {})
          .map(([key, value]) => [key, { ...value, confirmed: false }])) }
      expect(() => { assertWriterProjection(partial) }).not.toThrow()
      expect(() => foldExternalRepresentative(next, { kind: 'external/abandoned', id: h.intent.id, evidence },
        next.revision + 1, h.runtime)).toThrow(/pending cancellation/)
    } finally { await h.close() }
  })
  it('refuses changed grants, foreign source/key and cancelled preparation without releasing maintenance responsibility', async () => {
    const h = await fixture()
    try {
      expect(worldPlanStaleReason({ ...h.state, relations: {} }, h.plan, h.runtime)).toBe('authority-unavailable')
      for (const extra of [{ url: 'https://example.invalid' }, { sender: 'forged' }, { credentials: 'not-a-secret' }])
        expect(() => simulationExternalActorRequestSchema.parse({ ...h.intent.payload as object, ...extra })).toThrow()
      const preparing = h.prepare(), value = preparing.world!.external.representatives[h.intent.id]!
      const cancelled = { ...preparing, world: { ...preparing.world!, external: { ...preparing.world!.external,
        representatives: { [value.id]: { ...value, status: 'cancel-requested' as const } } },
      requests: { [h.request.id]: { ...h.request, status: 'cancel-requested' as const } } } }
      expect(() => foldExternalRepresentative(cancelled, { kind: 'external/committed', id: value.id },
        cancelled.revision + 1, h.runtime)).toThrow(/accepted open apply plan/)
      expect(() => foldMaintenance(cancelled, { status: 'completed',
        request: simulationMaintenanceRequestSchema.parse(h.requestInput.maintenance) }, cancelled.revision + 1))
        .toThrow(/External maintenance retains/)
      expect(cancelled.entities[h.identities.entityId]!.readiness).toBe('preparing')
    } finally { await h.close() }
  })
})
