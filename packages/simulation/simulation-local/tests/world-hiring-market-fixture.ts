/** Pure Native admission/fold tests; actual Team/Agent/Session composition is owned by the Loader scenario suite. */
import { teamRootCreateInputSchema } from '@clocky/clocky-team/schema'
import { channelIdSchema, teamIdSchema } from '@clocky/clocky-team'
import { simulationEntityIdSchema, simulationRelationIdSchema, simulationEntityBindingSchema,
  simulationRunSpecSchema, simulationWorldDefinitionSchema, simulationWorldRoleIntentSchema,
  simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema,
  simulationOperationIdSchema, simulationDecisionIdSchema, simulationDecisionSlotSchema, simulationWriterEpochSchema,
  simulationEventSlotSchema, simulationChannelKeySchema,
  worldPlanIdSchema, worldRequestIdSchema, WORLD_HIRE_EXISTING_PIN, WORLD_HIRE_EXISTING_DEFINITION,
  WORLD_GENERATE_AND_HIRE_PIN, simulationWorldHireExistingPayloadSchema, SimulationWorldDomainRegistry,
  simulationWorldHireReservationSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationEntity, SimulationRelation, SimulationWorldIntent,
  SimulationWorldRequest, SimulationWorldPlan, SimulationOperation, NativeWorldDomain } from '@clocky/clocky-simulation'
import { ExistingHireNativeWorldDomain } from '../src/world-hire-existing.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { worldExecutionReads } from '../src/world.ts'
import { businessFingerprint } from '../src/business.ts'

const entityId = (value: string) => simulationEntityIdSchema.parse(value)
const relationId = (value: string) => simulationRelationIdSchema.parse(value)
function actor(value: string): SimulationEntity {
  return { id: entityId(value), kind: 'person', cognition: 'agent', readiness: 'ready', phase: 'active', revision: 1, profileRevision: 1,
    profile: { name: value, private: 'CANDIDATE-PRIVATE-CANARY', persona: { name: value, memory: ['original-memory'] } },
    binding: simulationEntityBindingSchema.parse({ teamId: 'canonical', participantId: value, sessionId: `session:${value}` }) }
}
export function marketFixture(): {
  registry: SimulationWorldDomainRegistry<NativeWorldDomain>
  module: ExistingHireNativeWorldDomain
  runtime: NativeWorldRuntime
  payload: ReturnType<typeof simulationWorldHireExistingPayloadSchema.parse>
  intent: SimulationWorldIntent
  request: Extract<SimulationWorldRequest, { operationId: NonNullable<SimulationWorldRequest['operationId']> }>
  plan: Extract<SimulationWorldPlan, { operationId: NonNullable<SimulationWorldPlan['operationId']> }>
  channelId: ReturnType<typeof channelIdSchema.parse>
  key: ReturnType<typeof simulationChannelKeySchema.parse>
  relation(id: string, subject: string, name: string, object: string): SimulationRelation
  reserve(position: string, status?: 'reserved' | 'cancel-requested' | 'abandoned' | 'committed'): ReturnType<typeof simulationWorldHireReservationSchema.parse>
  readonly state: SimulationSnapshot
  setState(value: SimulationSnapshot): void
  close(): Promise<void>
} {
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
  return { registry, module, runtime, payload, intent, request, plan, channelId, key, relation,
    reserve,
    get state() { return state }, setState(value: SimulationSnapshot) { state = value },
    close: async () => { runtime.close(); await dispose() } }
}
