/** Pure personnel validation/projection; complete Native/Team settlement is owned by the real Loader integration suite. */
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { teamRootCreateInputSchema, channelIdSchema } from '@clocky/clocky-team/schema'
import { WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_HIRE_EXISTING_PIN, WORLD_GENERATE_AND_HIRE_PIN,
  simulationWorldTransferPayloadSchema, simulationWorldDepartPayloadSchema, simulationEntityIdSchema,
  simulationEntityBindingSchema, simulationRunSpecSchema, simulationWorldDefinitionSchema, simulationWorldRoleIntentSchema,
  simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema, simulationDecisionSlotSchema,
  simulationEventSlotSchema, simulationRelationIdSchema, simulationChannelKeySchema, simulationOperationIdSchema,
  worldRequestIdSchema, worldPlanIdSchema, worldIntentIdSchema, simulationWorldResultSchema,
  simulationWorldDomainMutationSchema, simulationWorldHireReservationSchema, simTimeSchema, PersonnelDomainError } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationEntity, SimulationRelation, SimulationWorldIntent,
  SimulationWorldPlan, SimulationWorldPersonnelPayload } from '@clocky/clocky-simulation'
import { TransferNativeWorldDomain, DepartNativeWorldDomain } from '../src/world-personnel-domain.ts'
import type { PersonnelDomainOwner, PersonnelPositionReservation } from '../src/world-personnel-domain.ts'
import { businessFingerprint } from '../src/business.ts'
import { foldEntityChange } from '../src/entities.ts'

const id = (value: string) => simulationEntityIdSchema.parse(value)
const relationId = (value: string) => simulationRelationIdSchema.parse(value)
function fixture(operation: 'transfer' | 'depart' = 'transfer') {
  const spec = simulationRunSpecSchema.parse({ runId: 'personnel', tickUnit: 'minute', origin: '0', maxTime: '100',
    rulesVersion: '1', policyVersion: '1', relationRules: ['assignment', 'can-transfer', 'can-transfer-target', 'can-depart', 'can-hire']
      .map(relation => ({
        relation, subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false })),
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
    maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 4, maxTokensPerInterval: 1000000,
    tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
    maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
    maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 4, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000' })
  const entities: SimulationEntity[] = ['requester', 'person', 'director', 'unrelated'].map(value => ({ id: id(value), kind: 'person',
    cognition: 'agent', readiness: 'ready', phase: 'active', revision: 1, profileRevision: 1,
    profile: { memory: ['PRIVATE-PERSONNEL-CANARY'] }, binding: simulationEntityBindingSchema.parse({ teamId: 'canonical',
      participantId: value, sessionId: `session:${value}` }) }))
  entities.push(...['organization', 'old-position', 'new-position'].map(value => ({ id: id(value),
    kind: value === 'organization' ? 'organization' : 'position', cognition: 'none' as const, readiness: 'ready' as const,
    phase: 'active' as const, revision: 1, profileRevision: 1, profile: {} })))
  const relation = (key: string, subject: string, name: string, object: string, from = '0', until: string | null = null): SimulationRelation => ({
    id: relationId(key), subject: id(subject), relation: name, object: id(object), scope: id('organization'), revision: 1,
    validFrom: simTimeSchema.parse(from), validUntil: until === null ? null : simTimeSchema.parse(until) })
  const relations = [relation('old-assignment', 'person', 'assignment', 'old-position'),
    relation('permission', 'requester', `can-${operation}`, 'old-position'),
    ...operation === 'transfer' ? [relation('target-permission', 'requester', 'can-transfer-target', 'new-position')] : [],
    relation('old-role-grant', 'person', 'can-hire', 'old-position'),
    relation('future-role-grant', 'person', 'can-hire', 'new-position', '10')]
  const pin = operation === 'transfer' ? WORLD_TRANSFER_PIN : WORLD_DEPART_PIN
  const channelId = channelIdSchema.parse('person-director'), key = simulationChannelKeySchema.parse('person-director')
  let state: SimulationSnapshot = { spec, revision: 10, time: simTimeSchema.parse('2'), phase: 'running',
    entities: Object.fromEntries(entities.map(value => [value.id, value])),
    relations: Object.fromEntries(relations.map(value => [value.id, value])),
    teamReservation: { teamId: entities[0]!.binding!.teamId, confirmed: true, creation: teamRootCreateInputSchema.parse({
      goal: { objective: 'Personnel', budgets: {} }, budgets: {}, rules: { activationLifecycleOwner: 'personnel-owner' } }) },
    channelReservations: { [key]: { channelId, confirmed: true, spec: { key, limits: {},
      members: [{ entityId: id('person'), role: 'member' }, { entityId: id('director'), role: 'director' }] } } },
    nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), nextEventSlot: simulationEventSlotSchema.parse('0'),
    decisions: {}, operations: {}, resources: {},
    resourceReservations: {}, grants: {}, interactions: {}, commitments: {}, scheduledEvents: {}, wakes: {},
    world: { executions: {}, definition: simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: 'director', organizationEntityId: 'organization',
      operations: [pin, WORLD_HIRE_EXISTING_PIN], operationGrants: [
        { domain: pin.domain, operation: pin.operation, version: pin.version, requesterEntityId: 'requester', scopeEntityId: 'organization',
          targetEntityId: 'old-position', relationId: 'permission', relation: `can-${operation}` },
        ...operation === 'transfer' ? [{ domain: pin.domain, operation: pin.operation, version: pin.version,
          requesterEntityId: 'requester', scopeEntityId: 'organization', targetEntityId: 'new-position',
          relationId: 'target-permission', relation: 'can-transfer-target' }] : [],
        ...['old', 'future'].map(value => ({ domain: 'organization', operation: 'hire-existing', version: '1', requesterEntityId: 'person',
          scopeEntityId: 'organization', targetEntityId: value === 'old' ? 'old-position' : 'new-position',
          relationId: `${value}-role-grant`, relation: 'can-hire' }))], authorizations: [],
      positions: [{ entityId: 'old-position', capacity: 1 }, { entityId: 'new-position', capacity: 1 }],
      templates: [{ id: 'finite', version: '1', names: ['Finite'], skills: [], traits: [], goals: [], description: 'Finite' }],
      policyVersion: '1', limits: { maxRequests: 16,
        maxBirthsPerInterval: 16, maxExternalExpansionsPerInterval: 16, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 16,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } }),
    sequence: 1, channels: { [id('person')]: channelId }, intents: {}, requests: {}, plans: {}, results: {}, cancellations: {},
    reservations: {}, mutations: {}, facts: {}, evidence: { challenges: {}, revisions: {} },
    governance: { proposals: {}, votes: {}, resolutions: {} },
    norms: { versions: {}, closures: [], announcements: {} },
    external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
    personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] } } }
  let ready = false, reservations: readonly PersonnelPositionReservation[] = []
  let closureIds = [relationId('old-role-grant')]
  const owner: PersonnelDomainOwner = {
    positionReservations: (_state, _scope, _position, exclude) => reservations.filter(value => value.intentId !== exclude),
    requireCommit: (actual, intent, plan, effectiveAt) => {
      if (!ready || effectiveAt !== actual.time || plan.requestId !== intent.requestId
        || !isDeepStrictEqual(plan.reads, module.executionReads(actual, intent))) {
        throw new PersonnelDomainError('SIM_PERSONNEL_HANDOFF_REQUIRED', 'Original obligation and reservation proofs are not settled')
      }
      return { closedAuthorityRelationIds: closureIds }
    },
  }
  const module = operation === 'transfer' ? new TransferNativeWorldDomain(owner) : new DepartNativeWorldDomain(owner)
  const raw = { organizationEntityId: 'organization', personId: 'person', assignmentId: 'old-assignment', assignmentRevision: 1,
    requestedEffectiveAt: null, description: 'Original change', ...operation === 'transfer' ? { targetPositionId: 'new-position' } : { retire: false } }
  const payload = operation === 'transfer' ? simulationWorldTransferPayloadSchema.parse(raw) : simulationWorldDepartPayloadSchema.parse(raw)
  const intentFor = (requested: SimulationWorldPersonnelPayload = payload): SimulationWorldIntent => {
    const { requestId: _requestId, ...parsed } = simulationWorldRoleIntentSchema.parse({ id: `original-${operation}`, pin,
      businessKey: 'original', requesterEntityId: 'requester', scopeEntityId: 'organization', targetEntityId: 'old-position',
      expectedTime: requested.requestedEffectiveAt, evidence: [], description: requested.description, payload: requested, sequence: 2 })
    return { ...parsed, requestId: worldRequestIdSchema.parse('original-request') }
  }
  const planFor = (intent: SimulationWorldIntent): SimulationWorldPlan => {
    const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: intent.requestId,
      supersedes: null, resolution: { kind: 'apply', payload: intent.payload, rationale: 'Original exact selection' } })
    return { id: worldPlanIdSchema.parse('original-plan'), requestId: intent.requestId!, pin,
      operationId: simulationOperationIdSchema.parse('original-plan-op'), proposal, reads: module.executionReads(state, intent),
      baseRevision: 10, sequence: 4, hash: businessFingerprint(proposal), status: 'accepted' }
  }
  return { module, payload, intentFor, planFor, relation, pin, get state() { return state },
    setState(value: SimulationSnapshot) { state = value }, ready() { ready = true },
    reservations(values: readonly PersonnelPositionReservation[]) { reservations = values },
    closures(values: typeof closureIds) { closureIds = values } }
}

describe('pure original personnel domains', () => {
  it.each(['transfer', 'depart'] as const)('withholds %s assignments without the current source relation rule', (operation) => {
    const h = fixture(operation), state = { ...h.state, spec: { ...h.state.spec,
      relationRules: h.state.spec.relationRules.filter(rule => rule.relation !== `can-${operation}`) } }
    expect(h.module.goalContext(state, id('requester'))).toMatchObject({ opportunities: [] })
    expect(() => h.module.planningContext(state, h.intentFor())).toThrow(/source-role grant/)
  })

  it.each(['transfer', 'depart'] as const)('%s parses exact assignment/identity and keeps model observations private', (operation) => {
    const h = fixture(operation), intent = h.intentFor()
    for (const field of ['persona', 'binding', 'sessionId', 'cancelTasks', 'inheritDebtor']) {
      expect(() => h.module.admitRequest(h.state, id('requester'), simulationWorldRequestOperationSchema.parse({ kind: 'world/request',
        domain: h.pin.domain, operation, version: '1', businessKey: 'original', expectedTime: null, evidence: [],
        payload: { ...h.payload, [field]: 'forged' } }))).toThrow()
    }
    expect(h.module.personnelSubjects(intent)).toEqual([id('person')])
    expect(JSON.stringify(h.module.planningContext(h.state, intent))).not.toContain('PRIVATE-PERSONNEL-CANARY')
    expect(h.module.goalContext(h.state, id('requester'))).toMatchObject({ opportunities: [
      { personId: 'person', assignmentId: 'old-assignment', assignmentRevision: 1 }] })
    expect(h.module.goalContext(h.state, id('unrelated'))).toMatchObject({ opportunities: [] })
    expect(() => { h.module.validatePlan(h.state, intent, {
      kind: 'apply', payload: { ...h.payload, personId: 'unrelated' }, rationale: 'Substitute' }) })
      .toThrow(/exact original request/)
  })

  it('requires exact current source-role scope/grant and original canonical person binding', () => {
    const h = fixture(), intent = h.intentFor()
    expect(() => h.module.planningContext({ ...h.state, relations: { ...h.state.relations,
      [relationId('permission')]: { ...h.state.relations[relationId('permission')]!, scope: id('unrelated') } } }, intent)).toThrow(/source-role grant/)
    const person = h.state.entities[id('person')]!
    expect(() => h.module.planningContext({ ...h.state, entities: { ...h.state.entities, [person.id]: { ...person,
      binding: simulationEntityBindingSchema.parse({ teamId: 'foreign', participantId: 'person', sessionId: 'session:person' }) } } }, intent))
      .toThrow(/canonical Team binding/)
    expect(() => h.module.planningContext({ ...h.state, relations: { ...h.state.relations,
      [relationId('old-assignment')]: { ...h.state.relations[relationId('old-assignment')]!, revision: 2 } } }, intent)).toThrow(/revision/)
  })

  it.each(['missing-relation', 'missing-declaration', 'foreign-scope', 'expired'] as const)
  ('rejects target permission %s and removes that target from actual goal material', (failure) => {
    const h = fixture(), intent = h.intentFor(), target = h.state.relations[relationId('target-permission')]!
    let state = h.state
    switch (failure) {
      case 'missing-relation': {
        const { [target.id]: _missing, ...remaining } = state.relations
        state = { ...state, relations: remaining }
        break
      }
      case 'missing-declaration': state = { ...state, world: { ...state.world!, definition: { ...state.world!.definition,
        operationGrants: state.world!.definition.operationGrants.filter(value => value.relationId !== target.id) } } }; break
      case 'foreign-scope': state = { ...state, relations: { ...state.relations, [target.id]: { ...target, scope: id('unrelated') } } }; break
      case 'expired': state = { ...state, relations: { ...state.relations, [target.id]: { ...target, validUntil: state.time } } }; break
    }
    expect(() => h.module.planningContext(state, intent)).toThrow(/target-position grant/)
    expect(h.module.goalContext(state, id('requester'))).toMatchObject({ opportunities: [] })
  })

  it('freezes target grant revision in the exact plan reads and refuses commit after its source changed', () => {
    const h = fixture(), intent = h.intentFor(), plan = h.planFor(intent), target = h.state.relations[relationId('target-permission')]!
    expect(plan.reads).toContainEqual({ kind: 'relation', id: target.id, revision: 1, effectiveFrom: '0', effectiveUntil: null })
    const changed = { ...h.state, relations: { ...h.state.relations, [target.id]: { ...target, revision: 2 } } }
    expect(h.module.executionReads(changed, intent)).not.toEqual(plan.reads)
    h.ready()
    expect(() => h.module.reduceMutation(changed, intent, plan, h.payload)).toThrow(/not settled/)
  })

  it('preserves ended history but rejects any other current or future assignment across scopes', () => {
    const h = fixture(), intent = h.intentFor(), ended = h.relation('ended', 'person', 'assignment', 'new-position', '0', '1')
    expect(() => h.module.planningContext({ ...h.state, relations: { ...h.state.relations, [ended.id]: ended } }, intent)).not.toThrow()
    const future = { ...h.relation('future', 'person', 'assignment', 'new-position', '50'), scope: id('unrelated') }
    expect(() => h.module.planningContext({ ...h.state, relations: { ...h.state.relations, [future.id]: future } }, intent))
      .toThrow(/independent settlement/)
  })

  it('counts future peak occupancy and every retained personnel reservation, excluding only this exact original reservation', () => {
    const h = fixture(), intent = h.intentFor(), future = h.relation('occupied', 'unrelated', 'assignment', 'new-position', '50')
    expect(() => h.module.planningContext({ ...h.state, relations: { ...h.state.relations, [future.id]: future } }, intent))
      .toThrow(/occupied/)
    h.reservations([{ intentId: worldIntentIdSchema.parse('other-unresolved'), updatedSequence: 8 }])
    expect(() => h.module.planningContext(h.state, intent)).toThrow(/pending reservations/)
    h.reservations([{ intentId: intent.id, updatedSequence: 8 }])
    expect(h.module.planningContext(h.state, intent)).toMatchObject({ target: { occupied: 0, reserved: 0 } })
  })

  it('freezes person/profile/binding and related occupancy reads while unrelated revisions do not stale the plan', () => {
    const h = fixture(), intent = h.intentFor(), original = h.module.executionReads(h.state, intent), unrelated = h.state.entities[id('unrelated')]!
    expect(h.module.executionReads({ ...h.state, revision: 999, entities: { ...h.state.entities,
      [unrelated.id]: { ...unrelated, revision: 9 } } }, intent)).toEqual(original)
    const person = h.state.entities[id('person')]!
    expect(h.module.executionReads({ ...h.state, entities: { ...h.state.entities,
      [person.id]: { ...person, revision: 2, profileRevision: 2 } } }, intent)).not.toEqual(original)
    expect(h.module.executionReads({ ...h.state, entities: { ...h.state.entities,
      [person.id]: { ...person, revision: 2 } } }, intent)).toEqual(original)
    expect(h.module.executionReads({ ...h.state, entities: { ...h.state.entities, [person.id]: { ...person,
      binding: simulationEntityBindingSchema.parse({ teamId: 'canonical', participantId: 'person', sessionId: 'other-session' }) } } }, intent))
      .not.toEqual(original)
  })

  it('retains original generated-hire capacity until its owner proves committed or abandoned', () => {
    const h = fixture(), intent = h.intentFor()
    const { requestId: _requestId, ...generated } = simulationWorldRoleIntentSchema.parse({ id: 'generated-intent',
      pin: WORLD_GENERATE_AND_HIRE_PIN, businessKey: 'generated', requesterEntityId: 'requester', scopeEntityId: 'organization',
      targetEntityId: 'new-position',
      expectedTime: null, evidence: [], description: 'Original generate', sequence: 8,
      payload: { organizationEntityId: 'organization', positionEntityId: 'new-position', description: 'Original generate' } })
    const reservation = simulationWorldHireReservationSchema.parse({ id: generated.id, requestId: 'generated-request',
      request: { planId: 'generated-plan', maintenance: { id: 'generated-maintenance', owner: 'personnel-owner' },
        member: { displayName: 'New', role: 'member', capabilities: [], provider: 'in-process', preset: 'simulation',
          model: 'scripted/world', modelVersion: '1' } }, identities: { entityId: 'reserved-person', relationId: 'reserved-assignment',
        binding: { teamId: 'canonical', participantId: 'reserved-person', sessionId: 'reserved-session' }, channels: [
          { purpose: 'director', key: 'reserved-director', channelId: 'reserved-director-channel' },
          { purpose: 'requester', key: 'reserved-requester', channelId: 'reserved-requester-channel' }] },
      approvals: [], reservedAt: '0', prepared: { time: '0', sequence: 9 }, sequence: 8, updatedSequence: 9, status: 'cancel-requested' })
    const pending = { ...h.state, world: { ...h.state.world!, intents: { [generated.id]: generated },
      reservations: { [generated.id]: reservation } } }
    expect(() => h.module.planningContext(pending, intent)).toThrow(/pending reservations/)
    const abandoned = { ...pending, world: { ...pending.world, reservations: { [generated.id]: { ...reservation, status: 'abandoned' as const } } } }
    expect(h.module.planningContext(abandoned, intent)).toMatchObject({ target: { reserved: 0 } })
    expect(() => h.module.planningContext({ ...pending, world: { ...pending.world, intents: {} } }, intent)).toThrow(/retained original/)
  })

  it('requires owner proofs, never substitutes disappearance of a writer for settlement or a retained reservation', () => {
    const h = fixture(), intent = h.intentFor(), plan = h.planFor(intent)
    expect(() => h.module.reduceMutation(h.state, intent, plan, h.payload)).toThrow(/not settled/)
    h.ready()
    const person = h.state.entities[id('person')]!
    const changed = { ...h.state, entities: { ...h.state.entities, [person.id]: { ...person, revision: 2, profileRevision: 2 } } }
    expect(() => h.module.reduceMutation(changed, intent, plan, h.payload)).toThrow(/not settled/)
  })

  it('rejects missed strict time, early commit and empty intervals without backfilling', () => {
    const h = fixture(), payload = simulationWorldTransferPayloadSchema.parse({ ...h.payload, requestedEffectiveAt: '3' })
    const intent = h.intentFor(payload), plan = h.planFor(intent)
    h.ready()
    expect(() => h.module.reduceMutation(h.state, intent, plan, payload)).toThrow(/strict safe boundary/)
    expect(h.module.reduceMutation({ ...h.state, time: simTimeSchema.parse('3') }, intent, plan, payload).resultPayload)
      .toMatchObject({ requestedEffectiveAt: '3', actualEffectiveAt: '3' })
    expect(() => h.module.planningContext({ ...h.state, time: simTimeSchema.parse('4') }, intent)).toThrow(/time has passed/)
    const atStart = { ...h.state, time: simTimeSchema.parse('0') }, next = h.intentFor()
    expect(() => h.module.reduceMutation(atStart, next, h.planFor(next), h.payload)).toThrow(/strictly after/)
  })

  it('atomically closes only explicitly approved old grants and creates one deterministic assignment with the original identity', () => {
    const h = fixture(), intent = h.intentFor(), plan = h.planFor(intent), original = h.state
    h.ready()
    const projection = h.module.reduceMutation(original, intent, plan, h.payload)
    const next = projection.changes.reduce((state, change) => foldEntityChange(state, change), original)
    expect(next.entities).toBe(original.entities)
    expect(next.relations[relationId('old-assignment')]).toMatchObject({ validFrom: '0', validUntil: '2', revision: 2 })
    expect(next.relations[relationId('old-role-grant')]).toMatchObject({ validUntil: '2' })
    expect(next.relations[relationId('future-role-grant')]).toBe(original.relations[relationId('future-role-grant')])
    expect(projection.resultPayload).toMatchObject({ entityId: 'person', requestedEffectiveAt: null, actualEffectiveAt: '2',
      newAssignmentId: `world-transfer-assignment:${intent.id}`, closedAuthorityRelationIds: ['old-role-grant'],
      revokedAuthorityRelationIds: ['future-role-grant', 'old-role-grant'] })
    expect(original.relations[relationId('old-assignment')]!.validUntil).toBeNull()
    expect(projection.changes.every(value => value.kind.startsWith('relation/'))).toBe(true)
  })

  it('rejects owner closure refs that invent authority, repeat a relation, or select a future grant', () => {
    const h = fixture(), intent = h.intentFor(), plan = h.planFor(intent)
    h.ready()
    for (const ids of [[relationId('future-role-grant')], [relationId('permission')],
      [relationId('old-role-grant'), relationId('old-role-grant')]]) {
      h.closures(ids)
      expect(() => h.module.reduceMutation(h.state, intent, plan, h.payload)).toThrow(/distinct exact old-role grants/)
    }
  })

  it.each([false, true])('departure retire=%s never changes identity or terminates an entity; owner must confirm requested stopping', (retire) => {
    const h = fixture('depart'), payload = simulationWorldDepartPayloadSchema.parse({ ...h.payload, retire })
    const intent = h.intentFor(payload), plan = h.planFor(intent)
    expect(() => h.module.reduceMutation(h.state, intent, plan, payload)).toThrow(/not settled/)
    h.ready()
    const projection = h.module.reduceMutation(h.state, intent, plan, payload)
    expect(projection.changes).toHaveLength(2)
    expect(projection.changes.every(value => value.kind === 'relation/update')).toBe(true)
    expect(projection.resultPayload).toMatchObject({ retire, actualEffectiveAt: '2', entityId: 'person' })
  })

  it('transfer first-action replay checks the recorded mutation and original Channel without reevaluating closed grants', () => {
    const h = fixture(), intent = h.intentFor(), plan = h.planFor(intent)
    h.ready()
    const projection = h.module.reduceMutation(h.state, intent, plan, h.payload)
    const folded = projection.changes.reduce((state, change) => foldEntityChange(state, change), h.state)
    const mutation = simulationWorldDomainMutationSchema.parse({ kind: 'world/mutation', id: `world-mutation:${plan.id}`,
      requestId: plan.requestId, planId: plan.id, pin: plan.pin, time: folded.time, sequence: 12, recordedAt: 0, payload: h.payload })
    const result = simulationWorldResultSchema.parse({ id: 'result', requestId: plan.requestId, intentId: intent.id,
      source: { kind: 'plan', planId: plan.id }, outcome: { kind: 'committed' }, payload: projection.resultPayload, time: folded.time, sequence: 12 })
    const recorded = { ...folded, world: { ...folded.world!, plans: { [plan.id]: plan }, mutations: { [mutation.id]: mutation } } }
    expect(h.module.firstActionActor(recorded, intent, result)).toBe(id('person'))
    expect(h.module.resultContext(recorded, intent, result, 'first-action')).toMatchObject({ expectedActorId: 'person',
      recipient: 'director', channelId: 'person-director', facts: { personnel: { newAssignmentId: `world-transfer-assignment:${intent.id}` } } })
    expect(() => h.module.firstActionActor({ ...recorded, world: { ...recorded.world, mutations: {} } }, intent, result))
      .toThrow(/original mutation/)
  })
})
