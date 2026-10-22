/** Actual Native relationship selection and complete-envelope bounds; external Team observation remains explicitly separate. */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { simulationRunSpecSchema, simulationEntityIdSchema, simulationEntityBindingSchema, simulationRelationIdSchema,
  simulationDecisionIdSchema, simulationWriterEpochSchema, simulationDecisionSlotSchema, simulationOperationIdSchema,
  simulationEventIdSchema, simulationEventSlotSchema, simulationEventKeySchema, simulationTaskExecutionRequestSchema,
  simulationInteractionIdSchema, simulationCommitmentIdSchema, simulationResourceSpecSchema, simulationOperationSchema,
  simulationTaskReceiptSchema, simulationTaskEvidenceSchema,
  personnelObligationQuerySchema, personnelObligationReportSchema, boundPersonnelObligationReport,
  PersonnelObligationError, simTimeSchema, simulationCoordinatorIdSchema,
  SimulationWorldDomainRegistry, simulationWorldDomainPinSchema, simulationWorldDefinitionSchema,
  simulationWorldRoleIntentSchema, simulationWorldDomainRequestSchema, worldRequestIdSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationOperation, SimulationDecision, SimulationTaskExecution, PersonnelObligationReport,
  NativeWorldDomain, SimulationWorldDomainDefinition, SimulationWorldRequest, SimulationWorldIntent } from '@clocky/clocky-simulation'
import { activationReservationIdSchema, channelIdSchema, teamIdSchema, participantIdSchema } from '@clocky/clocky-team/schema'
import { inspectPersonnelObligations } from '../src/personnel-obligations.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'

const personId = simulationEntityIdSchema.parse('person'), otherId = simulationEntityIdSchema.parse('other')
function base(): SimulationSnapshot {
  const spec = simulationRunSpecSchema.parse({ runId: 'obligations', tickUnit: 'minute', origin: '0', maxTime: '100',
    rulesVersion: '1', policyVersion: '1', relationRules: [], outboxMaxAttempts: 3, outboxRetryDelayMs: 10,
    maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000,
    maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 4, maxTokensPerInterval: 1000000,
    tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
    maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
    maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 4, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000' })
  const people = [personId, otherId].map(id => ({ id, kind: 'person', cognition: 'agent' as const, phase: 'active' as const,
    readiness: 'ready' as const, revision: 1, profileRevision: 1, profile: { private: 'PRIVATE-OBLIGATION-CANARY' },
    binding: simulationEntityBindingSchema.parse({ teamId: 'canonical', participantId: id, sessionId: `session:${id}` }) }))
  return { spec, revision: 10, time: simTimeSchema.parse('2'), phase: 'running', entities: Object.fromEntries(people.map(value => [value.id, value])),
    relations: {}, nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), nextEventSlot: simulationEventSlotSchema.parse('0'),
    decisions: {}, operations: {}, resources: {},
    resourceReservations: {}, grants: {}, interactions: {}, commitments: {}, scheduledEvents: {}, wakes: {} }
}
function query(limit = 100, maxBytes = 65536) {
  return personnelObligationQuerySchema.parse({ selector: { kind: 'person', personId, personRevision: 1 }, limit, maxBytes })
}
function decision(status: SimulationDecision['status'] = 'open', id = 'decision', entityId = personId): SimulationDecision {
  return { id: simulationDecisionIdSchema.parse(id), entityId, epoch: simulationWriterEpochSchema.parse('1'),
    slot: simulationDecisionSlotSchema.parse('0'), snapshotRevision: 1, entityRevision: 1, time: simTimeSchema.parse('0'), status, operationIds: [] }
}
function message(entityId = personId, recipient = otherId): SimulationOperation {
  return { id: simulationOperationIdSchema.parse('message-op'), decisionId: simulationDecisionIdSchema.parse('accepted-decision'), entityId,
    index: 0, dependencies: [], fingerprint: 'original-fingerprint', status: 'outcome-unknown',
    action: simulationOperationSchema.parse({ kind: 'communication/post', recipient, channelId: 'private-channel',
      text: 'PRIVATE-OBLIGATION-CANARY', deliverAt: '10' }), outbox: { ready: true, budgetStart: 0,
      attempts: [{ number: 1, startedAt: 0, outcome: 'in-flight' }] } }
}
function execution(): SimulationTaskExecution {
  return { request: simulationTaskExecutionRequestSchema.parse({ runId: 'obligations', attemptId: 'attempt', operationId: 'task-create',
    teamId: 'canonical', taskId: 'task', taskRevision: 1, ordinal: 1, entityId: personId, participantId: 'person',
    sessionId: 'session:person', activationId: 'activation', reservationId: 'startup', epoch: '1', leaseDurationMs: 1000 }), reservedSequence: 5 }
}

/** Test-only original pure domain proves subject selection uses an installed contract, not business-name guesses. */
function worldFixture() {
  const pin = simulationWorldDomainPinSchema.parse({ domain: 'duty', operation: 'retain-person', version: '1',
    schemaRef: 'duty/retain-person/schema/1', implementationRef: 'duty/retain-person/native/1', generation: 1 })
  const schema = z.strictObject({ person: simulationEntityIdSchema })
  const definition: SimulationWorldDomainDefinition = { domain: pin.domain, operation: pin.operation, version: pin.version,
    schemaRef: pin.schemaRef, schemas: { request: schema, plan: schema, result: schema, mutation: schema } }
  const unused = (): never => { throw new Error('Read-only inventory must not execute business effects') }
  const module: NativeWorldDomain = { definition, ref: pin.implementationRef, generation: 1,
    personnelSubjects: intent => [schema.parse(intent.payload).person], admitRequest: unused, planningContext: unused,
    validatePlan: unused, executionReads: unused, reduceMutation: unused }
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>(), dispose = registry.register(definition, module)
  const runtime = new NativeWorldRuntime(registry)
  const { requestId: _requestId, ...parsed } = simulationWorldRoleIntentSchema.parse({ id: 'original-duty', pin,
    businessKey: 'original-key', requesterEntityId: otherId,
    scopeEntityId: otherId, targetEntityId: personId, expectedTime: null, evidence: [], description: 'PRIVATE-OBLIGATION-CANARY',
    payload: { person: personId }, sequence: 2 })
  const intent: SimulationWorldIntent = parsed
  const request: SimulationWorldRequest = { id: worldRequestIdSchema.parse('original-case'), intentId: intent.id,
    operationId: simulationOperationIdSchema.parse('original-request'), notificationOperationId: simulationOperationIdSchema.parse('notify'),
    requesterEntityId: otherId, proposal: simulationWorldDomainRequestSchema.parse({ domain: pin.domain,
      operation: pin.operation, version: pin.version, kind: 'world/request', businessKey: 'original-key',
      expectedTime: null, evidence: [], payload: intent.payload }), pin,
    source: { kind: 'decision', decisionId: simulationDecisionIdSchema.parse('original-decision'),
      epoch: simulationWriterEpochSchema.parse('1'), binding: base().entities[otherId]!.binding! },
    description: intent.description, payloadHash: 'sha256:' + 'a'.repeat(64), sequence: 3, plans: [], status: 'open' }
  const state: SimulationSnapshot = { ...base(), world: { executions: {},
    external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
    personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] },
    definition: simulationWorldDefinitionSchema.parse({ positionRolePermissions: [],
      directorEntityId: otherId, organizationEntityId: otherId,
      operations: [pin], operationGrants: [], authorizations: [], positions: [{ entityId: otherId, capacity: 1 }],
      templates: [{ id: 'finite', version: '1', names: ['Finite'], skills: [], traits: [], goals: [], description: 'Finite' }],
      policyVersion: '1', limits: { maxRequests: 16,
        maxBirthsPerInterval: 16, maxExternalExpansionsPerInterval: 16, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 16,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } }),
    sequence: 1, channels: {}, intents: { [intent.id]: intent }, requests: { [request.id]: request },
    plans: {}, results: {}, cancellations: {}, reservations: {}, mutations: {}, facts: {}, evidence: { challenges: {}, revisions: {} },
    governance: { proposals: {}, votes: {}, resolutions: {} }, norms: { versions: {}, closures: [], announcements: {} } } }
  return { state, runtime, intent, close: async () => { runtime.close(); await dispose() } }
}

describe('Native personnel inventory', () => {
  it('requires the original configured manifest even when local tables are empty', async () => {
    const fixture = worldFixture()
    try {
      expect(() => inspectPersonnelObligations(fixture.state, query())).toThrow(/installed Native domain catalog/)
      const empty = { ...fixture.state, world: { ...fixture.state.world!, intents: {}, requests: {} } }
      expect(inspectPersonnelObligations(empty, query(), fixture.runtime).totalCount).toBe(0)
    } finally { await fixture.close() }
  })

  it('uses original immutable domain personnel subjects and refuses missing intent sources', async () => {
    const fixture = worldFixture()
    try {
      const report = inspectPersonnelObligations(fixture.state, query(), fixture.runtime)
      expect(report.items).toHaveLength(1)
      expect(report.items[0]).toMatchObject({ category: 'world-case', ref: { intentId: fixture.intent.id },
        owner: { kind: 'native', subsystem: 'world' }, dispositions: ['wait', 'cancel-supported'] })
      expect(JSON.stringify(report)).not.toContain('PRIVATE-OBLIGATION-CANARY')
      expect(() => inspectPersonnelObligations({ ...fixture.state, world: { ...fixture.state.world!, intents: {} } },
        query(), fixture.runtime)).toThrow(/original immutable intent/)
    } finally { await fixture.close() }
  })
  it.each(['open', 'awaiting-evidence', 'cancel-requested'] as const)('retains %s original case duties for requester and domain subjects', async (status) => {
    const fixture = worldFixture()
    try {
      const original = Object.values(fixture.state.world!.requests)[0]!
      const state = { ...fixture.state, world: { ...fixture.state.world!,
        requests: { [original.id]: { ...original, status } } } }
      for (const selected of [personId, otherId]) {
        const report = inspectPersonnelObligations(state, personnelObligationQuerySchema.parse({
          selector: { kind: 'person', personId: selected, personRevision: 1 }, limit: 100, maxBytes: 65536 }), fixture.runtime)
        expect(report.items).toContainEqual(expect.objectContaining({ category: 'world-case', state: status,
          ref: { kind: 'world-case', requestId: original.id, intentId: fixture.intent.id, sequence: original.sequence } }))
      }
      for (const terminal of ['committed', 'cancelled', 'rejected'] as const) {
        const ended = { ...state, world: { ...state.world, requests: { [original.id]: { ...original, status: terminal } } } }
        expect(inspectPersonnelObligations(ended, query(), fixture.runtime).items.some(value => value.category === 'world-case')).toBe(false)
      }
    } finally { await fixture.close() }
  })
  it('never reports Native emptiness as all-source coverage or permission to depart', () => {
    const report = inspectPersonnelObligations(base(), query())
    expect(report).toMatchObject({ status: 'native-only', complete: false, totalCount: 0,
      coverage: { native: 'complete', team: { kind: 'required', teamId: 'canonical', participantId: 'person' } }, items: [] })
    expect(JSON.stringify(report)).not.toContain('PRIVATE-OBLIGATION-CANARY')
  })

  it('checks both selected person and assignment revisions without mutating the snapshot', () => {
    const state = base(), id = simulationRelationIdSchema.parse('assignment')
    const withAssignment = { ...state, relations: { [id]: { id, relation: 'assignment', subject: personId,
      object: otherId, revision: 3, scope: otherId, validFrom: simTimeSchema.parse('0'), validUntil: null } } }
    const selected = personnelObligationQuerySchema.parse({ selector: { kind: 'assignment', personId, personRevision: 1,
      assignmentId: id, assignmentRevision: 3 }, limit: 20, maxBytes: 65536 })
    if (selected.selector.kind !== 'assignment') throw new Error('Fixture requires its exact assignment selector')
    const selector = selected.selector
    expect(inspectPersonnelObligations(withAssignment, selected).items).toEqual([])
    expect(() => inspectPersonnelObligations(withAssignment, { ...selected, selector: { ...selector,
      assignmentRevision: 2 } })).toThrow(PersonnelObligationError)
    expect(() => inspectPersonnelObligations({ ...state, entities: { ...state.entities,
      [personId]: { ...state.entities[personId]!, revision: 2 } } }, query())).toThrow(/person revision/)
    expect(withAssignment.relations[id]?.validUntil).toBeNull()
  })

  it.each(['open', 'submitted'] as const)('retains %s decisions and ignores unrelated or settled decisions', (status) => {
    const owned = decision(status), unrelated = decision('open', 'other-decision', otherId), settled = decision('accepted', 'done')
    const report = inspectPersonnelObligations({ ...base(), decisions: {
      [owned.id]: owned, [unrelated.id]: unrelated, [settled.id]: settled } }, query())
    expect(report.items).toHaveLength(1)
    expect(report.items[0]).toMatchObject({ ref: { kind: 'decision', id: owned.id }, owner: { subsystem: 'decision' }, dispositions: ['wait', 'cancel-supported'] })
  })

  it('accepted publication uncertainty survives writer absence and contains no message body', () => {
    const operation = message(), report = inspectPersonnelObligations({ ...base(), operations: { [operation.id]: operation } }, query())
    expect(report.items.map(value => value.category).sort()).toEqual(['message', 'operation', 'outbox'])
    expect(report.items.every(value => value.certainty === 'outcome-unknown')).toBe(true)
    expect(JSON.stringify(report)).not.toContain('PRIVATE-OBLIGATION-CANARY')
  })

  it('tracks incoming accepted messages until their exact Native delivery wake settles', () => {
    const operation = { ...message(otherId, personId), status: 'applied' as const }
    const state = { ...base(), operations: { [operation.id]: { ...operation, outbox: { ...operation.outbox!,
      attempts: [{ number: 1, startedAt: 0, outcome: 'applied' as const, finishedAt: 1 }] } } } }
    expect(inspectPersonnelObligations(state, query()).items.some(value => value.category === 'message')).toBe(true)
    const settled = { ...state, operations: { [operation.id]: { ...state.operations[operation.id]!, delivery: {
      wakeId: simulationEventIdSchema.parse('delivery-wake'), sessionId: base().entities[personId]!.binding!.sessionId,
      sequence: 5, time: simTimeSchema.parse('1') } } } }
    // No fabricated Team receipt: Native delivery alone still does not claim recipient input completion.
    expect(inspectPersonnelObligations(settled, query()).items.some(value => value.category === 'message')).toBe(true)
  })

  it('keeps task assignment outcome unknown even after the writer was physically retired', () => {
    const task = execution(), report = inspectPersonnelObligations({ ...base(), taskExecutions: { [task.request.attemptId]: {
      ...task, retired: { sequence: 8, quiescedAt: 0, source: 'quiesced' as const, reason: 'Original writer stopped' } } } }, query())
    expect(report.items.map(value => value.category).sort()).toEqual(['task-assignment', 'task-execution'])
    expect(report.items.every(value => value.certainty === 'outcome-unknown')).toBe(true)
    expect(report.items.find(value => value.ref.kind === 'task-execution')?.ref).toMatchObject({ observedRevision: null, selectedRevision: 1 })
  })

  it('task creation receipt retains its real Team target without inventing a completion revision', () => {
    const created: SimulationOperation = { ...message(), action: simulationOperationSchema.parse({ kind: 'task/create', deliverAt: '3',
      task: { subject: 'PRIVATE-OBLIGATION-CANARY', description: 'PRIVATE-OBLIGATION-CANARY', blockedBy: [], requiredCapabilities: [],
        priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 } }),
    status: 'applied', outbox: { ready: true, attempts: [], budgetStart: 0, taskReceipt: simulationTaskReceiptSchema.parse({
      operationId: 'message-op', fingerprint: 'original-fingerprint', teamId: 'canonical', taskId: 'created-task' }) } }
    const report = inspectPersonnelObligations({ ...base(), operations: { [created.id]: created } }, query())
    expect(report.items[0]).toMatchObject({ ref: { kind: 'task-target', taskId: 'created-task' },
      certainty: 'external-observation-required', owner: { kind: 'team', teamId: 'canonical' } })
    expect(report.items[0]!.ref).not.toHaveProperty('revision')
    expect(JSON.stringify(report)).not.toContain('PRIVATE-OBLIGATION-CANARY')
  })

  it('retains open interaction/commitment relationships and zero-balance resource control', () => {
    const interactionId = simulationInteractionIdSchema.parse('interaction'), commitmentId = simulationCommitmentIdSchema.parse('commitment')
    const createdBy = simulationOperationIdSchema.parse('create')
    const resource = simulationResourceSpecSchema.parse({ id: 'account', owner: otherId, controllers: [personId], quantity: '0', unit: 'item', kind: 'inventory' })
    const state = { ...base(), interactions: { [interactionId]: { id: interactionId, requester: otherId, assignee: personId,
      description: 'PRIVATE-OBLIGATION-CANARY', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' as const },
      revision: 2, reply: 'accepted' as const, execution: 'pending' as const, commitmentId, createdBy } },
    commitments: { [commitmentId]: { id: commitmentId, interactionId, debtor: personId, creditor: otherId,
      revision: 3, phase: 'open' as const, createdBy, evidence: [] } }, resources: { [resource.id]: { ...resource, revision: 4 } } }
    const report = inspectPersonnelObligations(state, query())
    expect(report.items.map(value => value.category).sort()).toEqual(['commitment', 'interaction', 'resource-control'])
    expect(JSON.stringify(report)).not.toContain('PRIVATE-OBLIGATION-CANARY')
  })

  it('a terminal observed task does not keep a completed interaction open while unretired attempt cleanup remains independent', () => {
    const task = execution(), id = simulationInteractionIdSchema.parse('task-interaction')
    const evidence = simulationTaskEvidenceSchema.parse({ operationId: 'task-create', teamId: 'canonical', taskId: 'task',
      revision: 4, phase: 'completed', executor: { participantId: 'person', activationId: 'activation',
        attemptId: 'attempt', ordinal: 1, outcome: 'completed' } })
    const state = { ...base(), interactions: { [id]: { id, requester: otherId, assignee: personId,
      description: 'no public body', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' as const },
      revision: 5, reply: 'accepted' as const, execution: 'task' as const, task: evidence,
      createdBy: simulationOperationIdSchema.parse('task-create') } },
    taskExecutions: { [task.request.attemptId]: { ...task, task: evidence } } }
    const report = inspectPersonnelObligations(state, query())
    expect(report.items.some(value => value.category === 'interaction')).toBe(false)
    expect(report.items.some(value => value.category === 'task-execution')).toBe(true)
  })

  it('collects both queued future events and claimed wake responsibilities', () => {
    const id = simulationEventIdSchema.parse('future-wake'), claimedId = simulationEventIdSchema.parse('claimed-wake')
    const state = { ...base(), scheduledEvents: { [id]: { id, key: simulationEventKeySchema.parse({ time: '99', microstep: '0', phase: 'decision', slot: '0' }),
      action: { kind: 'wake' as const, entityId: personId, reason: 'PRIVATE-OBLIGATION-CANARY' }, status: 'pending' as const } },
    wakes: { [claimedId]: { eventId: claimedId, entityId: personId, reason: 'PRIVATE-OBLIGATION-CANARY', status: 'claimed' as const,
      decisionId: simulationDecisionIdSchema.parse('claimed') } } }
    const report = inspectPersonnelObligations(state, query())
    expect(report.items.map(value => value.category).sort()).toEqual(['scheduled-event', 'wake'])
    expect(JSON.stringify(report)).not.toContain('PRIVATE-OBLIGATION-CANARY')
  })

  it('preserves arbitrary structural relation direction instead of guessing a fixed subordinate label', () => {
    const id = simulationRelationIdSchema.parse('reporting')
    const state = { ...base(), relations: { [id]: { id, subject: otherId, object: personId, scope: otherId,
      relation: 'custom-supervision-name', revision: 2, validFrom: simTimeSchema.parse('3'), validUntil: null } } }
    expect(inspectPersonnelObligations(state, query()).items[0]).toMatchObject({ ref: { kind: 'relation', subject: otherId,
      object: personId, relation: 'custom-supervision-name' }, category: 'structural-relation', state: 'future', dispositions: ['handoff-required'] })
  })

  it('does not drop a revoked but unreleased writer responsibility', () => {
    const state = base(), person = state.entities[personId]!
    const pending = { ...state, entities: { ...state.entities, [personId]: { ...person, writer: {
      epoch: simulationWriterEpochSchema.parse('4'), coordinatorId: simulationCoordinatorIdSchema.parse('coordinator'),
      reservationId: activationReservationIdSchema.parse('startup'), provider: 'in-process', phase: 'revoked' as const } } } }
    expect(inspectPersonnelObligations(pending, query()).items[0]).toMatchObject({
      ref: { kind: 'writer', epoch: '4', activationId: null }, dispositions: ['wait'] })
  })

  it('turns item overflow into explicit incomplete coverage with a nonzero total, never false clearance', () => {
    const a = decision('open', 'a'), b = decision('submitted', 'b')
    const report = inspectPersonnelObligations({ ...base(), decisions: { [a.id]: a, [b.id]: b } }, query(1))
    expect(report).toMatchObject({ status: 'overflow', complete: false, totalCount: 2, items: [], overflow: { reason: 'item-limit', omittedCount: 2 } })
  })

  it('charges UTF-8 bytes for the entire external coverage envelope and rejects oversized minimum wrappers', () => {
    const native = inspectPersonnelObligations(base(), query())
    const input: PersonnelObligationReport = { ...native, status: 'covered', complete: true, coverage: { native: 'complete', team: {
      kind: 'observed', teamId: teamIdSchema.parse('canonical'), participantId: participantIdSchema.parse('person'), cursor: 12,
      channels: Array.from({ length: 5 }, (_, index) => ({ channelId: channelIdSchema.parse(`多字节-${index}`), cursor: 1 })), hash: `sha256:${'a'.repeat(64)}` } } }
    const required = new TextEncoder().encode(JSON.stringify(input)).byteLength
    expect(boundPersonnelObligationReport(input, query(100, required))).toEqual(input)
    expect(() => boundPersonnelObligationReport(input, query(100, 10))).toThrow(/overflow summary/)
    const original = inspectPersonnelObligations({ ...base(), decisions: { [decision().id]: decision() } }, query()).items[0]!
    const huge = { ...input, items: [{ ...original,
      state: '界'.repeat(500) }], totalCount: 1 }
    const result = boundPersonnelObligationReport(huge, query(100, required + 100))
    expect(result).toMatchObject({ status: 'overflow', complete: false, totalCount: 1, overflow: { reason: 'byte-limit' } })
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(required + 100)
  })

  it('keeps partial external source coverage incomplete and refuses false source completeness', () => {
    const native = inspectPersonnelObligations(base(), query())
    const report: PersonnelObligationReport = { ...native, status: 'partial', coverage: { native: 'complete', team: {
      kind: 'partial', teamId: teamIdSchema.parse('canonical'), participantId: participantIdSchema.parse('person'), cursor: 9,
      channels: [], hash: `sha256:${'b'.repeat(64)}`, reason: 'source-moved' } } }
    expect(boundPersonnelObligationReport(report, query()).complete).toBe(false)
    expect(() => personnelObligationReportSchema.parse({ ...report, complete: true })).toThrow()
    expect(() => boundPersonnelObligationReport(native, { ...query(), selector: { ...query().selector,
      personId: otherId } })).toThrow(/changed its original selected/)
  })
})
