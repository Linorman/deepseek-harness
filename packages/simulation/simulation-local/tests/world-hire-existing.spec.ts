/** Pure Native admission/fold tests; actual Team/Agent/Session composition is owned by the Loader scenario suite. */
import { describe, expect, it } from 'vitest'
import { teamRootCreateInputSchema } from '@clocky/clocky-team/schema'
import { channelIdSchema, teamIdSchema } from '@clocky/clocky-team'
import { simulationEntityIdSchema, simulationRelationIdSchema, simulationEntityBindingSchema,
  simulationRunSpecSchema, simulationWorldDefinitionSchema, simulationWorldRoleIntentSchema,
  simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema,
  simulationOperationIdSchema, simulationDecisionIdSchema, simulationDecisionSlotSchema, simulationWriterEpochSchema,
  simulationEventSlotSchema, simulationChannelKeySchema, simulationWorldDomainMutationSchema,
  worldPlanIdSchema, worldRequestIdSchema, WORLD_HIRE_EXISTING_PIN, WORLD_HIRE_EXISTING_DEFINITION,
  WORLD_GENERATE_AND_HIRE_PIN, simulationWorldHireExistingPayloadSchema, SimulationWorldDomainRegistry,
  simulationWorldHireReservationSchema, simTimeSchema, SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationEntity, SimulationRelation, SimulationWorldIntent,
  SimulationWorldRequest, SimulationWorldPlan, SimulationOperation, NativeWorldDomain } from '@clocky/clocky-simulation'
import { ExistingHireNativeWorldDomain } from '../src/world-hire-existing.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { foldWorldMutation } from '../src/world-mutation.ts'
import { worldExecutionReads, worldPlanStaleReason } from '../src/world.ts'
import { businessFingerprint } from '../src/business.ts'

const entityId = (value: string) => simulationEntityIdSchema.parse(value)
const relationId = (value: string) => simulationRelationIdSchema.parse(value)
function actor(value: string): SimulationEntity {
  return { id: entityId(value), kind: 'person', cognition: 'agent', readiness: 'ready', phase: 'active', revision: 1, profileRevision: 1,
    profile: { name: value, private: 'CANDIDATE-PRIVATE-CANARY', persona: { name: value, memory: ['original-memory'] } },
    binding: simulationEntityBindingSchema.parse({ teamId: 'canonical', participantId: value, sessionId: `session:${value}` }) }
}
function fixture() {
  const spec = simulationRunSpecSchema.parse({ runId: 'existing', tickUnit: 'minute', origin: '0', maxTime: '100',
    rulesVersion: '1', policyVersion: '1', relationRules: [{ relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'],
      scopeKinds: ['organization'], acyclic: false },
    { relation: 'can-hire', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false },
    { relation: 'eligible-for-hire', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }], outboxMaxAttempts: 3, outboxRetryDelayMs: 10,
    maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000,
    maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 4, maxTokensPerInterval: 1000000,
    tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
    maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
    maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 4, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000' })
  const people = ['director', 'requester', 'candidate', 'unrelated'].map(actor)
  const fixed = ['organization', 'foreign-organization', 'role', 'vacancy'].map(value => ({ id: entityId(value),
    kind: value.includes('organization') ? 'organization' : 'position', cognition: 'none' as const, readiness: 'ready' as const,
    phase: 'active' as const, revision: 1, profileRevision: 1, profile: {} }))
  const entities = Object.fromEntries([...people, ...fixed].map(value => [value.id, value]))
  const relation = (id: string, subject: string, name: string, object: string): SimulationRelation => ({ id: relationId(id),
    subject: entityId(subject), relation: name, object: entityId(object), scope: entityId('organization'), revision: 1,
    validFrom: simTimeSchema.parse('0'), validUntil: null })
  const relations = [relation('requester-role', 'requester', 'assignment', 'role'),
    relation('permission', 'requester', 'can-hire', 'vacancy'), relation('eligibility', 'candidate', 'eligible-for-hire', 'organization')]
  const channelId = channelIdSchema.parse('candidate-director-channel'), key = simulationChannelKeySchema.parse('candidate-director')
  let state: SimulationSnapshot = { spec, revision: 10, time: simTimeSchema.parse('2'), phase: 'running', entities,
    relations: Object.fromEntries(relations.map(value => [value.id, value])),
    teamReservation: { teamId: teamIdSchema.parse('canonical'), confirmed: true, creation: teamRootCreateInputSchema.parse({
      goal: { objective: 'Existing hire', budgets: {} }, budgets: {}, rules: { activationLifecycleOwner: 'existing-owner' } }) },
    channelReservations: { [key]: { channelId, confirmed: true, spec: { key, limits: {},
      members: [{ entityId: entityId('candidate'), role: 'member' }, { entityId: entityId('director'), role: 'director' }] } } },
    nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), nextEventSlot: simulationEventSlotSchema.parse('0'),
    decisions: {}, operations: {}, resources: {},
    resourceReservations: {}, grants: {}, interactions: {}, commitments: {}, scheduledEvents: {}, wakes: {},
    world: { executions: {}, external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} }, personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] }, definition: simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: 'director', organizationEntityId: 'organization',
      operations: [WORLD_HIRE_EXISTING_PIN], operationGrants: [{ requesterEntityId: 'requester', ...WORLD_HIRE_EXISTING_PIN,
        scopeEntityId: 'organization', targetEntityId: 'vacancy', relationId: 'permission', relation: 'can-hire' }].map(({ schemaRef: _s,
        implementationRef: _i, generation: _g, ...grant }) => grant), authorizations: [], positions: [{ entityId: 'vacancy', capacity: 1 }],
      templates: [{ id: 'original-template', version: '1', names: ['New'], skills: [], traits: [], goals: [], description: 'Finite' }],
      policyVersion: '1', limits: { maxRequests: 16,
        maxBirthsPerInterval: 16, maxExternalExpansionsPerInterval: 16, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 16,
        maxEvidenceAttemptsPerRequest: 3,
        maxPlansPerRequest: 3, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } }),
    sequence: 1, channels: { [entityId('candidate')]: channelId }, intents: {}, requests: {}, plans: {}, results: {}, cancellations: {},
    reservations: {}, mutations: {}, facts: {}, evidence: { challenges: {}, revisions: {} },
    governance: { proposals: {}, votes: {}, resolutions: {} },
    norms: { versions: {}, closures: [], announcements: {} } } }
  const payload = simulationWorldHireExistingPayloadSchema.parse({ organizationEntityId: 'organization', positionEntityId: 'vacancy',
    personId: 'candidate', description: 'Hire the eligible existing colleague.' })
  const action = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: WORLD_HIRE_EXISTING_PIN.domain,
    operation: WORLD_HIRE_EXISTING_PIN.operation, version: WORLD_HIRE_EXISTING_PIN.version,
    businessKey: 'existing-job', expectedTime: null, evidence: [], payload })
  const module = new ExistingHireNativeWorldDomain(), registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const dispose = registry.register(WORLD_HIRE_EXISTING_DEFINITION, module), runtime = new NativeWorldRuntime(registry)
  const { requestId: _request, ...parsed } = simulationWorldRoleIntentSchema.parse({ id: 'existing-intent', pin: WORLD_HIRE_EXISTING_PIN,
    businessKey: action.businessKey, requesterEntityId: 'requester', scopeEntityId: 'organization', targetEntityId: payload.positionEntityId,
    expectedTime: null,
    evidence: [], description: payload.description, payload, sequence: 2, requestId: 'existing-request' })
  const intent: SimulationWorldIntent = { ...parsed, requestId: worldRequestIdSchema.parse('existing-request') }
  const request: SimulationWorldRequest = { id: worldRequestIdSchema.parse('existing-request'), intentId: intent.id,
    operationId: simulationOperationIdSchema.parse('request-operation'), notificationOperationId: simulationOperationIdSchema.parse('notify-operation'),
    requesterEntityId: entityId('requester'), proposal: action, pin: intent.pin,
    source: { kind: 'decision', decisionId: simulationDecisionIdSchema.parse('request-decision'), epoch: simulationWriterEpochSchema.parse('1'),
      binding: people.find(value => value.id === entityId('requester'))!.binding! }, description: payload.description,
    payloadHash: businessFingerprint(action), sequence: 3, plans: [worldPlanIdSchema.parse('existing-plan')], status: 'open' }
  state = { ...state, world: { ...state.world!, intents: { [intent.id]: intent }, requests: { [request.id]: request } } }
  const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: request.id, supersedes: null,
    resolution: { kind: 'apply', payload, rationale: 'Original bounded selection.' } })
  const plan: SimulationWorldPlan = { id: request.plans[0]!, requestId: request.id,
    operationId: simulationOperationIdSchema.parse('plan-operation'), pin: intent.pin, proposal,
    reads: worldExecutionReads(state, intent, runtime), baseRevision: 3, sequence: 4, hash: businessFingerprint(proposal), status: 'accepted' }
  const operation: SimulationOperation = { id: plan.operationId, decisionId: simulationDecisionIdSchema.parse('director-decision'), index: 0,
    entityId: entityId('director'), action: proposal, dependencies: [], fingerprint: businessFingerprint(proposal), status: 'pending' }
  state = { ...state, world: { ...state.world!, plans: { [plan.id]: plan } }, operations: { [operation.id]: operation },
    decisions: { [operation.decisionId]: { id: operation.decisionId, entityId: operation.entityId, epoch: simulationWriterEpochSchema.parse('1'),
      slot: simulationDecisionSlotSchema.parse('0'), snapshotRevision: 3, entityRevision: 1, time: state.time,
      status: 'accepted', operationIds: [operation.id] } } }
  const reserve = (position: string, status: 'reserved' | 'cancel-requested' | 'abandoned' | 'committed' = 'reserved') => {
    const { requestId: _requestId, ...generated } = simulationWorldRoleIntentSchema.parse({ id: 'generated-intent',
      pin: WORLD_GENERATE_AND_HIRE_PIN, businessKey: 'generated-job', requesterEntityId: 'requester', scopeEntityId: 'organization',
      targetEntityId: position,
      expectedTime: null, evidence: [], description: 'Generate another colleague', sequence: 8,
      payload: { organizationEntityId: 'organization', positionEntityId: position, description: 'Generate another colleague' } })
    const reservation = simulationWorldHireReservationSchema.parse({ id: generated.id, requestId: 'generated-request',
      request: { planId: 'generated-plan', maintenance: { id: 'generated-maintenance', owner: 'existing-owner' },
        member: { displayName: 'New', role: 'member', capabilities: [], provider: 'in-process', preset: 'simulation',
          model: 'scripted/world', modelVersion: '1' } },
      identities: { entityId: 'reserved-person', relationId: 'generated-assignment', binding: {
        teamId: 'canonical', participantId: 'reserved-person', sessionId: 'reserved-session' }, channels: [
        { purpose: 'director', key: 'reserved-director', channelId: 'reserved-director-channel' },
        { purpose: 'requester', key: 'reserved-requester', channelId: 'reserved-requester-channel' }] },
      approvals: [], reservedAt: '0', sequence: 8, updatedSequence: status === 'cancel-requested' || status === 'committed' ? 9 : 8,
      ...status === 'cancel-requested' || status === 'committed' ? { prepared: { time: '0', sequence: 9 } } : {}, status })
    state = { ...state, world: { ...state.world!, intents: { ...state.world!.intents, [generated.id]: generated },
      reservations: { [generated.id]: reservation } } }
    return reservation
  }
  return { module, runtime, payload, intent, request, plan, channelId, key, relation,
    reserve,
    get state() { return state }, setState(value: SimulationSnapshot) { state = value },
    close: async () => { runtime.close(); await dispose() } }
}

describe('existing-person Native hire', () => {
  it('excludes every identity/Persona field and applies only the exact original request', async () => {
    const h = fixture()
    try {
      for (const field of ['persona', 'binding', 'sessionId', 'participantId', 'requesterEntityId']) {
        expect(() => simulationWorldHireExistingPayloadSchema.parse({ ...h.payload, [field]: 'forged' })).toThrow()
      }
      expect(() =>{  h.module.validatePlan(h.state, h.intent, { kind: 'apply', payload: { ...h.payload,
        personId: 'unrelated' }, rationale: 'Replace candidate' }) }).toThrow(/exact person/)
      expect(h.module.planningContext(h.state, h.intent)).toMatchObject({ existingHire: h.payload,
        position: { occupied: 0, reserved: 0 } })
      expect(JSON.stringify(h.module.planningContext(h.state, h.intent))).not.toContain('CANDIDATE-PRIVATE-CANARY')
      expect(h.module.goalContext(h.state, entityId('requester'))).toMatchObject({ opportunities: [
        { organizationEntityId: 'organization', positionEntityId: 'vacancy', personId: 'candidate' }] })
    } finally { await h.close() }
  })

  it.each(['inactive', 'terminated', 'preparing', 'none', 'unbound', 'foreign-team', 'missing-channel', 'unconfirmed-channel', 'foreign-channel'] as const)(
    'rejects %s candidate without repairing identity or allocating a Channel', async (kind) => {
      const h = fixture()
      try {
        const person = h.state.entities[entityId('candidate')]!
        if (kind === 'missing-channel') h.setState({ ...h.state, channelReservations: {} })
        else if (kind === 'unconfirmed-channel' || kind === 'foreign-channel') {
          const channel = h.state.channelReservations![h.key]!
          h.setState({ ...h.state, channelReservations: { [h.key]: { ...channel, confirmed: kind !== 'unconfirmed-channel',
            spec: { ...channel.spec, members: kind === 'foreign-channel' ? [{ entityId: entityId('unrelated'), role: 'member' },
              { entityId: entityId('director'), role: 'director' }] : channel.spec.members } } } })
        } else {
          let changed = person
          if (kind === 'inactive' || kind === 'terminated') changed = { ...person, phase: kind }
          if (kind === 'preparing') changed = { ...person, readiness: 'preparing' }
          if (kind === 'none') changed = { ...person, cognition: 'none' }
          if (kind === 'unbound') { const { binding: _binding, ...remaining } = person; changed = remaining }
          if (kind === 'foreign-team') changed = { ...person,
            binding: simulationEntityBindingSchema.parse({ ...person.binding, teamId: 'foreign' }) }
          h.setState({ ...h.state, entities: { ...h.state.entities, [person.id]: changed } })
        }
        expect(() => h.module.admitRequest(h.state, entityId('requester'), h.request.proposal)).toThrow(SimulationWorldError)
        expect(h.state.world!.reservations).toEqual({})
      } finally { await h.close() }
    })

  it('uses the original confirmed private topology for a free candidate without granting requester authority', async () => {
    const h = fixture()
    try {
      h.setState({ ...h.state, world: { ...h.state.world!, channels: {} } })
      expect(h.module.admitRequest(h.state, entityId('requester'), h.request.proposal).payload).toEqual(h.payload)
      expect(h.state.world!.definition.operationGrants.some(value => value.requesterEntityId === h.payload.personId)).toBe(false)
      const indexed = { ...h.state, world: { ...h.state.world!, channels: { [h.payload.personId]: channelIdSchema.parse('other') } } }
      expect(() => h.module.admitRequest(indexed, entityId('requester'), h.request.proposal)).toThrow(/private Channel/)
      const original = h.state.channelReservations![h.key]!, otherKey = simulationChannelKeySchema.parse('duplicate')
      const ambiguous = { ...h.state, channelReservations: { ...h.state.channelReservations,
        [otherKey]: { ...original, channelId: channelIdSchema.parse('second'), spec: { ...original.spec, key: otherKey } } } }
      expect(() => h.module.admitRequest(ambiguous, entityId('requester'), h.request.proposal)).toThrow(/private Channel/)
    } finally { await h.close() }
  })

  it('requires exact current scoped eligibility and permission, independent of Team membership', async () => {
    const h = fixture()
    try {
      const eligible = h.state.relations[relationId('eligibility')]!
      for (const changed of [{ ...eligible, object: entityId('foreign-organization') },
        { ...eligible, scope: entityId('foreign-organization') }, { ...eligible, validFrom: simTimeSchema.parse('3') },
        { ...eligible, validUntil: simTimeSchema.parse('2') }]) {
        expect(() => h.module.admitRequest({ ...h.state, relations: { ...h.state.relations, [eligible.id]: changed } },
          entityId('requester'), h.request.proposal)).toThrow(/eligibility/)
      }
      expect(() => h.module.admitRequest({ ...h.state, world: { ...h.state.world!,
        definition: { ...h.state.world!.definition, operationGrants: [] } } }, entityId('requester'), h.request.proposal)).toThrow(/can-hire/)
      const actor = h.state.entities[entityId('requester')]!
      expect(() => h.module.reduceMutation({ ...h.state, entities: { ...h.state.entities,
        [actor.id]: { ...actor, phase: 'inactive' } } }, h.intent, h.plan, h.payload)).toThrow(/active canonical requester/)
    } finally { await h.close() }
  })

  it('rejects candidate current/future assignments in every scope but retains completed history', async () => {
    const h = fixture()
    try {
      for (const from of ['0', '3']) {
        const conflicting = { ...h.relation('candidate-job', 'candidate', 'assignment', 'role'), scope: entityId('foreign-organization'),
          validFrom: simTimeSchema.parse(from) }
        expect(() => h.module.admitRequest({ ...h.state, relations: { ...h.state.relations, [conflicting.id]: conflicting } },
          entityId('requester'), h.request.proposal)).toThrow(/current or future/)
      }
      const ended = { ...h.relation('old-job', 'candidate', 'assignment', 'role'), validUntil: simTimeSchema.parse('2') }
      h.setState({ ...h.state, relations: { ...h.state.relations, [ended.id]: ended } })
      expect(h.module.admitRequest(h.state, entityId('requester'), h.request.proposal).payload).toEqual(h.payload)
      expect(h.state.relations[ended.id]).toBe(ended)
    } finally { await h.close() }
  })

  it('enforces current and future position capacity for the new open-ended assignment', async () => {
    const h = fixture()
    try {
      for (const from of ['0', '3']) {
        const occupied = { ...h.relation('occupied', 'unrelated', 'assignment', 'vacancy'), validFrom: simTimeSchema.parse(from) }
        expect(() => h.module.admitRequest({ ...h.state, relations: { ...h.state.relations, [occupied.id]: occupied } },
          entityId('requester'), h.request.proposal)).toThrow(/occupied or reserved/)
      }
    } finally { await h.close() }
  })

  it('counts unconfirmed/cancel-requested generated reservations and fences global structural work at commit', async () => {
    const h = fixture()
    try {
      for (const status of ['reserved', 'cancel-requested'] as const) {
        h.reserve('vacancy', status)
        expect(() => h.module.admitRequest(h.state, entityId('requester'), h.request.proposal)).toThrow(/occupied or reserved/)
      }
      h.reserve('role')
      expect(h.module.admitRequest(h.state, entityId('requester'), h.request.proposal).payload).toEqual(h.payload)
      expect(() => h.module.reduceMutation(h.state, h.intent, h.plan, h.payload))
        .toThrow(/pending structural mutation allowance is occupied/)
      h.reserve('role', 'abandoned')
      expect(h.module.reduceMutation(h.state, h.intent, h.plan, h.payload).changes).toHaveLength(1)
    } finally { await h.close() }
  })

  it('pins owned binding, eligibility, candidate assignments and occupancy without a global-revision dependency', async () => {
    const h = fixture()
    try {
      expect(h.plan.reads).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'entity-binding', id: 'candidate' }),
        expect.objectContaining({ kind: 'relation-subject-set', relation: 'assignment', subject: 'candidate' }),
        expect.objectContaining({ kind: 'relation', id: 'eligibility', revision: 1 }),
      ]))
      const unrelated = h.state.entities[entityId('unrelated')]!
      expect(worldPlanStaleReason({ ...h.state, revision: 100, entities: { ...h.state.entities,
        [unrelated.id]: { ...unrelated, revision: 2 } } }, h.plan, h.runtime)).toBeUndefined()
      const person = h.state.entities[entityId('candidate')]!
      expect(worldPlanStaleReason({ ...h.state, entities: { ...h.state.entities, [person.id]: { ...person, revision: 2 } } },
        h.plan, h.runtime)).toBe('read-set-changed')
      const binding = simulationEntityBindingSchema.parse({ ...person.binding, sessionId: 'different-session' })
      expect(worldPlanStaleReason({ ...h.state, entities: { ...h.state.entities, [person.id]: { ...person, binding } } },
        h.plan, h.runtime)).toBe('read-set-changed')
    } finally { await h.close() }
  })

  it('Native folds assignment and original result together without changing any Entity, profile or binding', async () => {
    const h = fixture()
    try {
      const mutation = simulationWorldDomainMutationSchema.parse({ kind: 'world/mutation', id: `world-mutation:${h.plan.id}`,
        requestId: h.request.id, planId: h.plan.id, pin: h.intent.pin, time: h.state.time, sequence: h.state.revision + 1,
        recordedAt: 0, payload: h.payload })
      const next = foldWorldMutation(h.state, { kind: 'world/mutation', mutation }, mutation.sequence, h.runtime)
      expect(next.entities).toBe(h.state.entities)
      expect(Object.values(next.world!.results)).toHaveLength(1)
      expect(next.world!.requests[h.request.id]?.status).toBe('committed')
      expect(next.relations[relationId(`world-existing-assignment:${h.intent.id}`)]).toMatchObject({
        subject: 'candidate', object: 'vacancy', scope: 'organization', validFrom: '2', validUntil: null })
      const result = Object.values(next.world!.results)[0]!
      expect(h.module.firstActionActor(next, h.intent, result)).toBe(entityId('candidate'))
      expect(h.module.resultContext(next, h.intent, result, 'result')).toBeUndefined()
      expect(h.module.resultContext(next, h.intent, result, 'first-action')).toMatchObject({ expectedActorId: 'candidate',
        recipient: 'director', channelId: h.channelId, facts: { onboarding: { entityId: 'candidate' } } })
      const assignment = next.relations[relationId(`world-existing-assignment:${h.intent.id}`)]!
      const noNewAuthority = { ...next, relations: { [assignment.id]: assignment }, world: { ...next.world!,
        definition: { ...next.world!.definition, operationGrants: [] } } }
      expect(h.module.firstActionActor(noNewAuthority, h.intent, result)).toBe(entityId('candidate'))
      const person = next.entities[entityId('candidate')]!
      const replaced = { ...next, entities: { ...next.entities, [person.id]: { ...person,
        binding: simulationEntityBindingSchema.parse({ ...person.binding, sessionId: 'substituted-session' }) } } }
      expect(() => h.module.resultContext(replaced, h.intent, result, 'first-action')).toThrow(/original mutation, binding/)
      const historical = { ...next, relations: {} }
      expect(() => h.module.firstActionActor(historical, h.intent, result)).toThrow(/onboarding/)
      expect(() => foldWorldMutation(next, { kind: 'world/mutation', mutation }, mutation.sequence + 1, h.runtime)).toThrow()
    } finally { await h.close() }
  })
})
