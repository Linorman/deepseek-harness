import { worldRolePlanOperationId } from '@clocky/clocky-simulation'
/** Accepted timed World requests retain one bounded clock fact, independent of actors, model wakes or terminal case disposition. */
import { expect, it, vi } from 'vitest'
import { simulationChangeSchema, simulationEntityIdSchema, simulationDecisionIdSchema,
  simulationWorldDefinitionSchema, simulationProposalSchema, simulationEventIdSchema, simulationOperationIdSchema,
  simulationWorldRequestOperationSchema, simTimeSchema, WORLD_DEPART_PIN } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { companyFixture } from '../../simulation-product/tests/company-driver-fixture.ts'
import { contextRequest } from './context-fixture.ts'
import { decisionInput } from '../../simulation-team/src/input.ts'
import { worldExecutionTimeRecords, assertWorldExecutionTimeSource, assertWorldExecutionTimeProjection } from '../src/world-execution-time.ts'
import { foldSchedulerRecord, schedulerRecordSchema, nextScheduledEvent } from '../src/scheduler.ts'
import { foldEntry } from '../src/journal.ts'

const requesterId = simulationEntityIdSchema.parse('buyer'), personId = simulationEntityIdSchema.parse('supplier')
async function fixture(backend: 'json' | 'sqlite', pendingEvents = 100, requestBytes = 65536) {
  const h = await companyFixture(backend, true, { maxPendingEvents: pendingEvents,
    relationRules: ['assignment', 'can-depart'].map(relation => ({ relation, subjectKinds: ['person'],
      objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false })) })
  try {
    for (const [name, kind] of [['clock-org', 'organization'], ['clock-hr-role', 'position'], ['clock-old-role', 'position']]) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: name, entityKind: kind,
        cognition: 'none', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
    }
    for (const [name, subject, relation, object] of [['clock-hr-assignment', requesterId, 'assignment', 'clock-hr-role'],
      ['clock-person-assignment', personId, 'assignment', 'clock-old-role'], ['clock-depart-grant', requesterId, 'can-depart', 'clock-old-role']]) {
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: name, subject, object,
        relation, scope: 'clock-org', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
    }
    await h.run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: personId,
      organizationEntityId: 'clock-org', operations: [WORLD_DEPART_PIN], operationGrants: [{ domain: 'organization', operation: 'depart',
        version: '1', requesterEntityId: requesterId, scopeEntityId: 'clock-org', targetEntityId: 'clock-old-role',
        relationId: 'clock-depart-grant', relation: 'can-depart' }], authorizations: [],
      positions: [{ entityId: 'clock-hr-role', capacity: 1 }, { entityId: 'clock-old-role', capacity: 1 }],
      templates: [{ id: 'finite', version: '1', names: ['Finite'], skills: [], traits: [], goals: [], description: 'Finite' }],
      policyVersion: '1', limits: { maxRequests: 16,
        maxBirthsPerInterval: 16, maxExternalExpansionsPerInterval: 16, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 16,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: requestBytes, maxBytesPerPlan: 65536 } }),
    h.run.snapshot().revision)
    await h.start()
    await h.connection.ensureResident(requesterId, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [] })
    const proposal = simulationProposalSchema.parse({ after: [], action: simulationWorldRequestOperationSchema.parse({ kind: 'world/request',
      domain: 'organization', operation: 'depart', version: '1', businessKey: 'future-clock-source', expectedTime: '5', evidence: [],
      payload: { organizationEntityId: 'clock-org', personId, assignmentId: 'clock-person-assignment', assignmentRevision: 1,
        requestedEffectiveAt: '5', description: 'PRIVATE-CLOCK-PAYLOAD', retire: false } }) })
    const decisionId = simulationDecisionIdSchema.parse('original-timed-request')
    const submit = async () => {
      await h.connection.openDecision(requesterId, decisionId)
      const prepared = await h.connection.prepareContext(requesterId, decisionId, { ...contextRequest(), world: { kind: 'goal' } })
      if (prepared.status !== 'prepared') throw new Error('Bounded original World context was not prepared')
      const binding = h.run.snapshot().entities[requesterId]!.binding!
      const actor = h.ctx.agents.get(binding.sessionId)
      if (actor === undefined) throw new Error('Original canonical requester Agent is unavailable')
      // Native owner-boundary test: canonical Session facts are real and flushed; no receipt or authority token is invented.
      actor.session.append('simulation/context-view', prepared.view, { surfaceOp: 'append' })
      actor.session.append('user/message', decisionInput(prepared.view), { surfaceOp: 'append' })
      if (!await h.ctx.sessions.flush(actor.session)) throw new Error('Original requester Session did not flush')
      await h.ctx.simulationTeams.modelRequest(actor, { kind: 'observe' }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(actor, { kind: 'stage', proposals: [proposal] }, h.lifetime.signal)
      await h.ctx.simulationTeams.modelRequest(actor, { kind: 'submit' }, h.lifetime.signal)
      return h.run.snapshot().decisions[decisionId]!
    }
    const stream = (h.run as unknown as { readonly stream: LogStream }).stream
    const append = vi.spyOn(stream, 'append')
    const settle = async () => {
      const decision = await submit(), request = Object.values(h.run.snapshot().world!.requests)[0]!
      const intent = h.run.snapshot().world!.intents[request.intentId]!
      await h.run.executeOperation(worldRolePlanOperationId(request))
      // Only the clock is under test: use the actual Native cancellation seam for its never-attempted notification.
      const notification = Object.values(h.run.snapshot().scheduledEvents).find(value => value.action.kind === 'outbox-ready'
        && value.action.operationId === request.notificationOperationId)
      if (notification === undefined) throw new Error('Original accepted notification readiness is missing')
      await h.run.cancelEvent(notification.id, 'Isolate original clock without publishing a target receipt', h.run.snapshot().revision)
      const state = h.run.snapshot(), eventId = simulationEventIdSchema.parse(`simulation-world-execution-time:${intent.id}`)
      const event = state.scheduledEvents[eventId]
      if (event === undefined) throw new Error('Actual timed request did not retain its original clock event')
      return { decision, request, intent, state, eventId, event }
    }
    return { ...h, submit, settle, decisionId, append }
  } catch (error) { await h.close(); throw error }
}

it.each(['json', 'sqlite'] as const)('%s appends one exact boundary with actual accepted business and preserves its key on cold reopen', async (backend) => {
  const h = await fixture(backend)
  try {
    const s = await h.settle()
    expect(s.event).toMatchObject({ id: s.eventId, key: { time: '5', phase: 'deadline' },
      action: { kind: 'world-execution-time', intentId: s.intent.id }, sourceOperationId: s.request.operationId, status: 'pending' })
    expect(assertWorldExecutionTimeSource(s.state, s.event)).toEqual(s.intent)
    expect(worldExecutionTimeRecords(s.state)).toEqual([])
    expect(Object.values(s.state.scheduledEvents).filter(value => value.action.kind === 'world-execution-time')).toHaveLength(1)
    const batches = h.append.mock.calls.map(call => call[1]).filter(values => values.some(value =>
      (value as { kind: string; change?: { kind: string; action?: { kind: string } } }).change?.action?.kind === 'world-execution-time'))
    expect(batches).toHaveLength(1)
    expect(batches[0]!.some(value => (value as { change?: { kind: string } }).change?.kind === 'decision/accepted')).toBe(true)
    expect(JSON.stringify(s.event)).not.toContain('PRIVATE-CLOCK-PAYLOAD')
    expect(s.state.wakes).toEqual({})
    expect(h.requests).toHaveLength(0)
    await h.connection.hibernate(requesterId)
    await h.connection.close()
    const frozen = h.run.snapshot()
    await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try {
      expect(reopened.snapshot()).toEqual(frozen)
      expect(reopened.snapshot().scheduledEvents[s.eventId]).toEqual(frozen.scheduledEvents[s.eventId])
      expect(worldExecutionTimeRecords(reopened.snapshot())).toEqual([])
      expect(() => { assertWorldExecutionTimeProjection(reopened.snapshot()) }).not.toThrow()
      const driven = await reopened.drive({ until: simTimeSchema.parse('5') })
      expect(driven.reason).toBe('until')
      const final = reopened.snapshot()
      expect(final.time).toBe('5')
      expect(final.scheduledEvents[s.eventId]).toMatchObject({ key: s.event.key, status: 'consumed' })
      expect(final.world).toEqual(frozen.world)
      expect(final.wakes).toEqual(frozen.wakes)
      expect(final.decisions).toEqual(frozen.decisions)
      expect(h.requests).toHaveLength(0)
    } finally { await reopened.close() }
  } finally { vi.restoreAllMocks(); await h.close() }
})

it('reconstructs only missing actual timed occurrences once and rejects retiming, source, pin, request or accepted-owner substitution', async () => {
  const h = await fixture('json')
  try {
    const s = await h.settle(), { [s.eventId]: _boundary, ...remaining } = s.state.scheduledEvents
    const missing = { ...s.state, scheduledEvents: remaining }
    expect(() => { assertWorldExecutionTimeProjection(missing) }).toThrow(/clock boundary/)
    const records = worldExecutionTimeRecords(missing)
    expect(records).toHaveLength(1)
    const queued = records.reduce((state, record) => foldSchedulerRecord(state, record, state.revision + 1), missing)
    expect(worldExecutionTimeRecords(queued)).toEqual([])
    expect(() => { assertWorldExecutionTimeProjection(queued) }).not.toThrow()
    const operation = s.state.operations[worldRolePlanOperationId(s.request)]!, decision = s.state.decisions[operation.decisionId]!
    for (const event of [{ ...s.event, id: simulationEventIdSchema.parse('substituted-clock') },
      { ...s.event, key: { ...s.event.key, time: simTimeSchema.parse('6') } },
      { ...s.event, key: { ...s.event.key, phase: 'decision' as const } },
      { ...s.event, sourceOperationId: simulationOperationIdSchema.parse('other-operation') }]) {
      expect(() => assertWorldExecutionTimeSource(s.state, event)).toThrow(/original accepted/)
    }
    for (const changed of [
      { ...s.state, operations: { ...s.state.operations, [operation.id]: { ...operation,
        worldPin: { ...s.intent.pin, generation: s.intent.pin.generation + 1 } } } },
      { ...s.state, decisions: { ...s.state.decisions, [decision.id]: { ...decision, status: 'cancelled' as const } } },
      { ...s.state, world: { ...s.state.world!, requests: { ...s.state.world!.requests, [s.request.id]: { ...s.request,
        source: { ...s.request.source, epoch: '999' as typeof decision.epoch } } } } },
      { ...s.state, world: { ...s.state.world!, requests: { ...s.state.world!.requests, [s.request.id]: { ...s.request,
        payloadHash: 'substituted-fingerprint' } } } },
    ]) expect(() => assertWorldExecutionTimeSource(changed, s.event)).toThrow(/original accepted/)
    const tampered = schedulerRecordSchema.parse({ kind: 'event/queued', id: s.eventId, key: { ...s.event.key, slot: '999' },
      action: s.event.action, sourceOperationId: s.event.sourceOperationId })
    expect(() => foldSchedulerRecord(missing, tampered, missing.revision + 1)).toThrow(/allocation/)
    expect(() => foldSchedulerRecord(s.state, { kind: 'event/cancelled', id: s.eventId, reason: 'Hide old boundary' },
      s.state.revision + 1)).toThrow(/immutable/)
    expect(h.run.snapshot()).toEqual(s.state)
  } finally { vi.restoreAllMocks(); await h.close() }
})

it.each(['cancelled', 'committed'] as const)('retains an accepted %s case boundary as a pure clock no-op without granting execution or creating a model wake', async (status) => {
  const h = await fixture('json')
  try {
    const s = await h.settle()
    // Only the source/clock contract is varied: no personnel mutation or real terminal result is claimed by this pure prefix unit.
    const terminal = { ...s.state, world: { ...s.state.world!, requests: { ...s.state.world!.requests,
      [s.request.id]: { ...s.request, status } } } }
    expect(assertWorldExecutionTimeSource(terminal, s.event)).toEqual(s.intent)
    expect(worldExecutionTimeRecords(terminal)).toEqual([])
    expect(nextScheduledEvent(terminal)?.id).toBe(s.eventId)
    const consumed = foldSchedulerRecord(terminal, { kind: 'event/consumed', id: s.eventId }, terminal.revision + 1)
    expect(consumed.time).toBe('5')
    expect(consumed.world).toEqual(terminal.world)
    expect(consumed.entities).toEqual(terminal.entities)
    expect(consumed.operations).toEqual(terminal.operations)
    expect(consumed.decisions).toEqual(terminal.decisions)
    expect(consumed.wakes).toEqual(terminal.wakes)
    expect(consumed.scheduledEvents[s.eventId]!.key).toEqual(s.event.key)
    const replayed = foldEntry(terminal, { sequence: terminal.revision + 1, value: { kind: 'run/scheduler',
      runId: terminal.spec.runId, expectedRevision: terminal.revision, change: { kind: 'event/consumed', id: s.eventId } } },
    terminal.spec, 'json')
    expect(replayed.scheduledEvents[s.eventId]!.key).toEqual(s.event.key)
    expect(replayed.wakes).toEqual(terminal.wakes)
  } finally { vi.restoreAllMocks(); await h.close() }
})

it('refuses the actual complete acceptance under a declared one-event budget before publishing any request or boundary', async () => {
  const h = await fixture('json', 1)
  try {
    await expect(h.submit()).rejects.toThrow(/pending events capacity exhausted/)
    const state = h.run.snapshot()
    expect(state.world!.requests).toEqual({})
    expect(Object.values(state.scheduledEvents).filter(value => value.action.kind === 'world-execution-time')).toEqual([])
    expect(state.decisions[h.decisionId]!.status).toBe('open')
    expect(h.append.mock.calls.every(call => call[1].every(value =>
      (value as { change?: { kind: string } }).change?.kind !== 'decision/accepted'))).toBe(true)
    expect(h.requests).toHaveLength(0)
  } finally { vi.restoreAllMocks(); await h.close() }
})

it('counts clock records inside the actual original request byte allowance and rejects before acceptance append', async () => {
  const reference = await fixture('json')
  let allowance: number
  try {
    await reference.settle()
    const values = reference.append.mock.calls.map(call => call[1]).find(batch => batch.some(value =>
      (value as { change?: { action?: { kind: string } } }).change?.action?.kind === 'world-execution-time'))
    if (values === undefined) throw new Error('Original actual timed acceptance append was not captured')
    allowance = Buffer.byteLength(JSON.stringify(values), 'utf8') - 1
  } finally { vi.restoreAllMocks(); await reference.close() }
  // A fresh fixture declares this smaller budget before work starts; no failed run's budget is enlarged.
  const h = await fixture('json', 100, allowance)
  try {
    await expect(h.submit()).rejects.toMatchObject({ code: 'SIM_WORLD_LIMIT', failure: { code: 'SIM_WORLD_LIMIT', limit: 'bytes' } })
    expect(h.run.snapshot().world!.requests).toEqual({})
    expect(h.append.mock.calls.every(call => call[1].every(value =>
      (value as { change?: { kind: string } }).change?.kind !== 'decision/accepted'))).toBe(true)
  } finally { vi.restoreAllMocks(); await h.close() }
})
