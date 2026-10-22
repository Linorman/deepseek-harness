/** Actual Native admission/folds against parsed personnel prefixes; cross-owner settlement is covered by the Loader suite. */
import assert from 'node:assert/strict'
import { afterEach, expect, it } from 'vitest'
import { activationIdSchema, activationReservationIdSchema, channelIdSchema, teamRootCreateInputSchema } from '@clocky/clocky-team'
import { simulationChangeSchema, simulationContextConsumptionHash, simulationDecisionIdSchema,
  simulationEntityIdSchema, simulationResourceIdSchema, worldIntentIdSchema, simulationOperationIdSchema,
  simulationProposalSchema, simulationRelationIdSchema,
  simulationWorldDefinitionSchema, simulationWorldRoleIntentSchema, simulationWorldRequestOperationSchema,
  simulationWorldResolveOperationSchema, personnelReservationSchema, worldPlanIdSchema, worldRequestIdSchema,
  simulationWorldCancelRequestSchema, simulationMaintenanceRequestSchema,
  simulationWriterEpochSchema, simTimeSchema, WORLD_DEPART_PIN, WORLD_DEPART_DEFINITION,
  simulationEventIdSchema, simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema,
  SimulationWorldDomainRegistry } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationSnapshot, SimulationWorldRequest, SimulationWorldPlan } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { acceptanceRecords } from '../src/decisions.ts'
import { foldEntry } from '../src/journal.ts'
import { businessFingerprint } from '../src/business.ts'
import { DepartNativeWorldDomain } from '../src/world-personnel-domain.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { acceptDepartureFence, finishPersonnelMutation, personnelDomainOwner } from '../src/world-personnel.ts'
import { allocateEventKey } from '../src/scheduler.ts'
import { selectDecisions } from '../src/dispatch.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const id = (value: string) => simulationEntityIdSchema.parse(value)
const assignmentId = simulationRelationIdSchema.parse('original-assignment')

async function setup() {
  const h = await createBusinessHarness('json', { relationRules: ['assignment', 'can-depart'].map(relation => ({
    relation, subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false })) })
  cleanups.push(h.close)
  const actor = await h.actor('person'), director = await h.actor('director')
  for (const [name, kind] of [['organization', 'organization'], ['position', 'position'], ['later-position', 'position']]) {
    await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: name, entityKind: kind,
      cognition: 'none', readiness: 'ready', profile: {} }), h.run.snapshot().revision)
  }
  for (const [name, relation] of [['original-assignment', 'assignment'], ['original-grant', 'can-depart']]) {
    await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: name, relation,
      subject: actor.id, object: 'position', scope: 'organization', validFrom: '0', validUntil: null }), h.run.snapshot().revision)
  }
  await h.account('stock', actor.id, '10'); await h.account('received', actor.id, '0')
  const registry = new SimulationWorldDomainRegistry<NativeWorldDomain>()
  const unregister = registry.register(WORLD_DEPART_DEFINITION, new DepartNativeWorldDomain(personnelDomainOwner))
  const runtime = new NativeWorldRuntime(registry)
  cleanups.push(async () => { runtime.close(); await unregister() })
  const initial = h.run.snapshot()
  // An explicit original World prefix, like the owning pure-domain tests; this grants no new runtime proof.
  let state: SimulationSnapshot = { ...initial, time: simTimeSchema.parse('2'),
    teamReservation: { teamId: initial.entities[actor.id]!.binding!.teamId, confirmed: true,
      creation: teamRootCreateInputSchema.parse({ goal: { objective: 'Original personnel', budgets: {} }, budgets: {},
        rules: { activationLifecycleOwner: 'original-owner' } }) },
    world: { executions: {},
      definition: simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: director.id,
        organizationEntityId: 'organization', operations: [WORLD_DEPART_PIN], operationGrants: [{ domain: 'organization',
          operation: 'depart', version: '1', requesterEntityId: actor.id, scopeEntityId: 'organization',
          targetEntityId: 'position', relationId: 'original-grant', relation: 'can-depart' }], authorizations: [],
        positions: [{ entityId: 'position', capacity: 1 }, { entityId: 'later-position', capacity: 1 }],
        templates: [{ id: 'finite', version: '1', names: ['Finite'], skills: [], traits: [], goals: [], description: 'Finite' }],
        policyVersion: '1', limits: { maxRequests: 16,
          maxBirthsPerInterval: 16, maxExternalExpansionsPerInterval: 16, maxPendingMutations: 1,
          maxRequestsPerActorPerInterval: 16,
          maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 } }),
      sequence: 1, channels: { [actor.id]: channelIdSchema.parse('original-private-channel') }, intents: {}, requests: {}, plans: {},
      results: {}, cancellations: {}, reservations: {}, mutations: {}, facts: {}, evidence: { challenges: {}, revisions: {} },
      governance: { proposals: {}, votes: {}, resolutions: {} },
      norms: { versions: {}, closures: [], announcements: {} },
      external: { identities: {}, interactions: {}, representatives: {}, contacts: {}, adjudications: {}, events: {} },
      personnel: { reservations: {}, fences: {}, generations: {}, operationGrants: [] } } }
  const fold = (previous: SimulationSnapshot,
    kind: 'run/business' | 'run/writer' | 'run/change' | 'run/world' | 'run/personnel' | 'run/maintenance' | 'run/scheduler',
    change: unknown): SimulationSnapshot =>
    foldEntry(previous, { sequence: previous.revision + 1, value: { kind, runId: previous.spec.runId,
      expectedRevision: previous.revision, ...kind === 'run/change' ? { command: change } : { change } } }, previous.spec, 'json', runtime)
  const decisionId = simulationDecisionIdSchema.parse('original-decision')
  state = fold(state, 'run/business', { kind: 'decision/opened', id: decisionId, entityId: actor.id, epoch: actor.lease.epoch,
    slot: state.nextDecisionSlot, snapshotRevision: state.revision, entityRevision: state.entities[actor.id]!.revision })
  state = fold(state, 'run/business', { kind: 'decision/context', id: decisionId,
    request: { ...contextRequest(), world: { kind: 'goal' } } })
  const context = state.decisions[decisionId]!.context
  if (context?.status !== 'prepared') throw new Error('Original bounded personnel context was not prepared')
  state = fold(state, 'run/business', { kind: 'decision/consumed', id: decisionId, receipt: { sessionId: initial.entities[actor.id]!.binding!.sessionId,
    inputId: context.view.inputId, contextHash: simulationContextConsumptionHash(context.view), viewSequence: 0, consumedSequence: 1 } })
  const decision = state.decisions[decisionId]!
  const requestAction = (key = 'later-work', retire = false) => simulationWorldRequestOperationSchema.parse({ kind: 'world/request',
    domain: 'organization', operation: 'depart', version: '1', businessKey: key, expectedTime: null, evidence: [],
    payload: { organizationEntityId: 'organization', personId: actor.id, assignmentId, assignmentRevision: 1,
      requestedEffectiveAt: null, description: 'Original departure', retire } })
  const proposals = [
    simulationProposalSchema.parse({ after: [], action: { kind: 'interaction/request', id: 'new-interaction', assignee: director.id,
      description: 'New ordinary work', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } } }),
    simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', transaction: { commitmentId: null,
      reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
      transfers: [{ from: 'stock', to: 'received', quantity: '1' }] }, grants: [] } }),
    simulationProposalSchema.parse({ after: [], action: requestAction() }),
  ]
  const fenced = (previous = state, retire = false): SimulationSnapshot => {
    const action = requestAction('accepted-departure', retire), requestId = worldRequestIdSchema.parse('original-request')
    const { requestId: _requestId, ...parsed } = simulationWorldRoleIntentSchema.parse({
      id: 'original-intent', pin: WORLD_DEPART_PIN, businessKey: action.businessKey,
      requesterEntityId: actor.id, scopeEntityId: 'organization', targetEntityId: 'position', expectedTime: null, evidence: [],
      payload: action.payload, description: 'Original departure', sequence: previous.revision, requestId })
    const intent = { ...parsed, requestId }
    const request: SimulationWorldRequest = { id: requestId, intentId: intent.id, operationId: simulationOperationIdSchema.parse('request-op'),
      notificationOperationId: simulationOperationIdSchema.parse('notification-op'), requesterEntityId: actor.id, proposal: action,
      pin: intent.pin, source: { kind: 'decision', decisionId, epoch: decision.epoch, binding: initial.entities[actor.id]!.binding! },
      description: 'Original departure', payloadHash: businessFingerprint(action), sequence: previous.revision, plans: [], status: 'open' }
    const owned = { ...previous, world: { ...previous.world!, intents: { ...previous.world!.intents, [intent.id]: intent },
      requests: { ...previous.world!.requests, [request.id]: request } } }
    return { ...acceptDepartureFence(owned, intent, requestId, previous.revision + 1), revision: previous.revision + 1 }
  }
  const committed = (retire: boolean) => {
    let next = fenced(state, retire)
    const world = next.world!, intent = Object.values(world.intents)[0]!, request = Object.values(world.requests)[0]!
    const planId = worldPlanIdSchema.parse('original-plan'), proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve',
      requestId: request.id, supersedes: null, resolution: { kind: 'apply', payload: intent.payload, rationale: 'Original selected payload' } })
    const plan: SimulationWorldPlan = { id: planId, requestId: request.id, pin: intent.pin, operationId: simulationOperationIdSchema.parse('plan-op'),
      proposal, reads: [], baseRevision: next.revision, sequence: next.revision, hash: businessFingerprint(proposal), status: 'accepted' }
    // Only the post-domain finish/admission contract is under test. Real complete-cut and quiescence proofs belong to the Loader suite.
    const reservation = personnelReservationSchema.parse({ id: intent.id, requestId: request.id,
      request: { planId, maintenance: { id: 'original-maintenance', owner: 'original-owner' } }, personId: actor.id,
      binding: initial.entities[actor.id]!.binding!, assignmentId, assignmentRevision: 1, targetPositionId: null,
      authorityGeneration: 0, closedAuthorityRelationIds: [], revokedAuthorityRelationIds: [], status: 'ready', sequence: next.revision,
      updatedSequence: next.revision, evidence: null, actualEffectiveAt: null, terminalTasks: [] })
    next = { ...next, world: { ...world, plans: { [planId]: plan }, personnel: { ...world.personnel,
      reservations: { [reservation.id]: reservation } } } }
    next = fold(next, 'run/change', { kind: 'relation/update', id: assignmentId, relationRevision: 1, relation: 'assignment',
      subject: actor.id, object: 'position', scope: 'organization', validFrom: '0', validUntil: next.time })
    return finishPersonnelMutation(next, intent.id, next.revision + 1)
  }
  return { actor, state, decision, proposals, fenced, committed, fold, runtime }
}

it('captures employment generation at actual decision opening and rejects ordinary, resource and World work after the accepted fence', async () => {
  const h = await setup(), before = h.state, blocked = h.fenced()
  expect(h.decision.employmentGeneration).toBe(0)
  expect(blocked.world!.personnel.generations[h.actor.id]).toBe(1)
  for (const proposal of h.proposals) {
    expect(acceptanceRecords(before, h.decision, [proposal], h.runtime).length).toBeGreaterThan(1)
    expect(() => acceptanceRecords(blocked, h.decision, [proposal], h.runtime)).toThrow(/employment|world requests/)
  }
  expect(before.world!.personnel.fences).toEqual({})
  expect(before.resources[simulationResourceIdSchema.parse('stock')]!.quantity).toBe('10')
})

it('rejects old decision effects even after a fence closes and only a new decision captures the new generation', async () => {
  const h = await setup(), blocked = h.fenced(), fence = blocked.world!.personnel.fences[worldIntentIdSchema.parse('original-intent')]!
  const closed = { ...blocked, world: { ...blocked.world!, personnel: { ...blocked.world!.personnel,
    fences: { [fence.intentId]: { ...fence, status: 'closed' as const } } } } }
  expect(() => acceptanceRecords(closed, h.decision, [h.proposals[0]!], h.runtime)).toThrow(/employment generation/)
  const cancelled = h.fold(closed, 'run/business', { kind: 'decision/cancelled', id: h.decision.id })
  const freshId = simulationDecisionIdSchema.parse('current-generation')
  const fresh = h.fold(cancelled, 'run/business', { kind: 'decision/opened', id: freshId, entityId: h.actor.id,
    epoch: h.decision.epoch, slot: cancelled.nextDecisionSlot, snapshotRevision: cancelled.revision,
    entityRevision: cancelled.entities[h.actor.id]!.revision })
  expect(fresh.decisions[freshId]!.employmentGeneration).toBe(1)
  expect(acceptanceRecords(fresh, fresh.decisions[freshId]!, [h.proposals[0]!], h.runtime)).toHaveLength(2)
})

it('keeps original fenced duties visible by refusing inactive or terminated lifecycle shortcuts', async () => {
  const h = await setup(), state = h.fenced(), person = state.entities[h.actor.id]!
  for (const phase of ['inactive', 'terminated']) {
    expect(() => h.fold(state, 'run/change', { kind: 'entity/phase', id: person.id,
      entityRevision: person.revision, phase })).toThrow(/personnel duties/)
  }
  expect(state.entities[h.actor.id]!.phase).toBe('active')
  expect(state.world!.personnel.fences[worldIntentIdSchema.parse('original-intent')]!.status).toBe('active')
})

it('replays already accepted resource effects across later generations without re-admitting replacement work', async () => {
  const h = await setup(), records = acceptanceRecords(h.state, h.decision, [h.proposals[1]!], h.runtime)
  const accepted = records.reduce((state, change) => h.fold(state, 'run/business', change), h.state)
  const later = h.fenced(accepted), retained = later.decisions[h.decision.id]!
  expect(acceptanceRecords(later, retained, [h.proposals[1]!], h.runtime)).toEqual(records)
  const settled = h.fold(later, 'run/business', { kind: 'operation/settled', id: retained.operationIds[0], status: 'applied', code: 'SIM_APPLIED' })
  expect(settled.resources[simulationResourceIdSchema.parse('stock')]!.quantity).toBe('9')
  expect(settled.resources[simulationResourceIdSchema.parse('received')]!.quantity).toBe('1')
  expect(retained.employmentGeneration).toBe(0)
  expect(later.resources[simulationResourceIdSchema.parse('stock')]!.quantity).toBe('10')
})

it('rejects a precomputed serial acceptance batch appended after its original personnel fence', async () => {
  const h = await setup(), records = acceptanceRecords(h.state, h.decision, [h.proposals[1]!], h.runtime), blocked = h.fenced()
  expect(() => records.reduce((state, change) => h.fold(state, 'run/business', change), blocked)).toThrow(/employment|personnel/)
})

it('cancels the actual accepted departure before preparation without ending its assignment or losing accepted notification debt', async () => {
  const h = await setup(), records = acceptanceRecords(h.state, h.decision, [h.proposals[2]!], h.runtime)
  const accepted = records.reduce((state, change) => h.fold(state, 'run/business', change), h.state)
  const request = Object.values(accepted.world!.requests)[0]!, intent = accepted.world!.intents[request.intentId]!
  expect(accepted.world!.personnel.fences[intent.id]!.status).toBe('active')
  const command = simulationWorldCancelRequestSchema.parse({ id: 'actual-original-cancel', requestId: request.id })
  const cancelled = h.fold(accepted, 'run/world', { kind: 'world/cancelled', request: command })
  expect(cancelled.world!.personnel.fences[intent.id]!.status).toBe('cancelled')
  expect(cancelled.world!.cancellations[command.id]!.status).toBe('cancelled')
  expect(cancelled.world!.requests[request.id]!.status).toBe('cancelled')
  expect(cancelled.relations[assignmentId]).toBe(accepted.relations[assignmentId])
  expect(cancelled.entities[h.actor.id]).toBe(accepted.entities[h.actor.id])
  assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
  expect(cancelled.operations[request.notificationOperationId]).toBe(accepted.operations[request.notificationOperationId])
  expect(cancelled.world!.personnel.generations[h.actor.id]).toBe(2)
  expect(() => acceptanceRecords(cancelled, h.decision, [h.proposals[0]!], h.runtime)).toThrow(/employment generation/)
})

it('retains cancellation and its reservation until original maintenance confirms writer release, then settles the first command once', async () => {
  const h = await setup(), records = acceptanceRecords(h.state, h.decision, [h.proposals[2]!], h.runtime)
  let state = records.reduce((previous, change) => h.fold(previous, 'run/business', change), h.state)
  const request = Object.values(state.world!.requests)[0]!, intent = state.world!.intents[request.intentId]!
  const planId = worldPlanIdSchema.parse('cancel-plan')
  const maintenance = simulationMaintenanceRequestSchema.parse({ id: 'cancel-maintenance', owner: 'original-owner' })
  const proposal = simulationWorldResolveOperationSchema.parse({ kind: 'world/resolve', requestId: request.id,
    supersedes: null, resolution: { kind: 'apply', payload: intent.payload, rationale: 'Original exact disposition' } })
  const plan: SimulationWorldPlan = { id: planId, requestId: request.id, pin: intent.pin,
    operationId: simulationOperationIdSchema.parse('cancel-plan-op'), proposal, reads: [],
    baseRevision: state.revision, sequence: state.revision, hash: businessFingerprint(proposal), status: 'accepted' }
  // Reservation linkage is parsed here; this test covers cancellation folds, not plan acceptance or cross-owner commit authority.
  const reservation = personnelReservationSchema.parse({ id: intent.id, requestId: request.id, request: { planId, maintenance },
    personId: h.actor.id, binding: state.entities[h.actor.id]!.binding, assignmentId, assignmentRevision: 1,
    targetPositionId: null, authorityGeneration: 1, closedAuthorityRelationIds: [], revokedAuthorityRelationIds: [],
    status: 'fenced', sequence: state.revision, updatedSequence: state.revision, evidence: null, actualEffectiveAt: null, terminalTasks: [] })
  state = { ...state, world: { ...state.world!, plans: { [planId]: plan },
    personnel: { ...state.world!.personnel, reservations: { [intent.id]: reservation } } } }
  state = h.fold(state, 'run/maintenance', { request: maintenance, status: 'draining' })
  const command = simulationWorldCancelRequestSchema.parse({ id: 'first-retained-cancel', requestId: request.id })
  state = h.fold(state, 'run/world', { kind: 'world/cancelled', request: command })
  expect(state.world!.cancellations[command.id]!.status).toBe('cancel-requested')
  expect(state.world!.personnel.reservations[intent.id]!.status).toBe('cancel-requested')
  expect(state.world!.personnel.fences[intent.id]!.status).toBe('active')
  expect(state.world!.results).toEqual({})
  expect(() => h.fold(state, 'run/personnel', { kind: 'personnel/cancelled', id: intent.id })).toThrow(/cleanup/)
  state = { ...state, phase: 'paused' }
  for (const person of Object.values(state.entities).filter(value => value.writer !== undefined)) {
    state = h.fold(state, 'run/writer', { kind: 'writer/revoked', entityId: person.id, epoch: person.writer!.epoch })
    state = h.fold(state, 'run/writer', { kind: 'writer/released', entityId: person.id, epoch: person.writer!.epoch,
      activationId: person.writer!.activationId })
  }
  state = h.fold(state, 'run/maintenance', { request: maintenance, status: 'quiescent' })
  expect(() => h.fold(state, 'run/maintenance', { request: maintenance, status: 'completed' })).toThrow(/Personnel maintenance/)
  const second = simulationWorldCancelRequestSchema.parse({ id: 'second-retained-cancel', requestId: request.id })
  state = h.fold(state, 'run/world', { kind: 'world/cancelled', request: second })
  expect(state.world!.results).toEqual({})
  const cancelled = h.fold(state, 'run/personnel', { kind: 'personnel/cancelled', id: intent.id })
  const result = Object.values(cancelled.world!.results)[0]!
  expect(result.source).toEqual({ kind: 'cancel', commandId: command.id })
  expect(cancelled.world!.cancellations[command.id]!.status).toBe('cancelled')
  expect(cancelled.world!.cancellations[second.id]!.status).toBe('already-resolved')
  expect(cancelled.world!.personnel.reservations[intent.id]!.status).toBe('cancelled')
  expect(cancelled.world!.personnel.fences[intent.id]!.status).toBe('cancelled')
  expect(cancelled.relations[assignmentId]).toBe(state.relations[assignmentId])
  expect(h.fold(cancelled, 'run/maintenance', { request: maintenance, status: 'completed' }).maintenance![maintenance.id]!.status)
    .toBe('completed')
})

it.each([false, true])('committed retire=%s preserves the person and gates writer startup according to the original disposition', async (retire) => {
  const h = await setup(), committed = h.committed(retire), original = committed.entities[h.actor.id]!, binding = original.binding!
  expect(original.phase).toBe('active')
  expect(original.binding).toEqual(h.state.entities[h.actor.id]!.binding)
  expect(original.profile).toEqual(h.state.entities[h.actor.id]!.profile)
  expect(committed.world!.personnel.reservations[worldIntentIdSchema.parse('original-intent')]!.status).toBe('committed')
  let stopped = h.fold(committed, 'run/writer', { kind: 'writer/revoked', entityId: h.actor.id, epoch: h.decision.epoch })
  stopped = h.fold(stopped, 'run/writer', { kind: 'writer/released', entityId: h.actor.id, epoch: h.decision.epoch,
    activationId: original.writer!.activationId })
  const reservationId = activationReservationIdSchema.parse('later-writer'), epoch = simulationWriterEpochSchema.parse('2')
  const reserve = { kind: 'writer/reserved', entityId: h.actor.id, epoch, coordinatorId: original.writer!.coordinatorId,
    reservationId, provider: original.writer!.provider }
  const activation = { kind: 'writer/activated', entityId: h.actor.id, epoch, activation: { ...binding, reservationId,
    activationId: activationIdSchema.parse('later-activation'), provider: original.writer!.provider } }
  if (retire) {
    expect(() => h.fold(stopped, 'run/writer', reserve)).toThrow(/confirmed retirement/)
    // A reserved original startup that arrives late cannot evade the retirement gate either.
    const reservedPrefix = { ...stopped, entities: { ...stopped.entities, [h.actor.id]: { ...stopped.entities[h.actor.id]!,
      writer: { ...original.writer!, epoch, reservationId, phase: 'reserved' as const, activationId: undefined } } } }
    expect(() => h.fold(reservedPrefix, 'run/writer', activation)).toThrow(/confirmed retirement/)
  } else {
    const reserved = h.fold(stopped, 'run/writer', reserve)
    expect(h.fold(reserved, 'run/writer', activation).entities[h.actor.id]!.writer!.phase).toBe('active')
  }
  const laterAssignment = h.fold(stopped, 'run/change', { kind: 'relation/create', id: 'later-assignment', relation: 'assignment',
    subject: h.actor.id, object: 'later-position', scope: id('organization'), validFrom: committed.time, validUntil: null })
  const reserved = h.fold(laterAssignment, 'run/writer', reserve)
  expect(h.fold(reserved, 'run/writer', activation).entities[h.actor.id]!.writer!.phase).toBe('active')
})

it('retains an original retired wake and historical nomination while admitting other clock work until a newer assignment exists', async () => {
  const h = await setup()
  let state = h.committed(true)
  state = h.fold(state, 'run/business', { kind: 'decision/cancelled', id: h.decision.id })
  const eventId = simulationEventIdSchema.parse('retained-personal-notice')
  const action = { kind: 'wake' as const, entityId: h.actor.id, reason: 'Original notice retained during confirmed retirement' }
  state = h.fold(state, 'run/scheduler', { kind: 'event/queued', id: eventId, action,
    key: allocateEventKey(state, state.time, action) })
  state = h.fold(state, 'run/scheduler', { kind: 'event/consumed', id: eventId })
  const notice = state.wakes[eventId]!
  // Existing queue records retain their original responsibility; new nomination admission is tested through the actual Loader flow.
  const candidate = simulationDispatchCandidateSchema.parse({ id: 'historical-nomination', entityId: h.actor.id, wakeId: eventId, priority: 0 })
  state = h.fold(state, 'run/business', { kind: 'dispatch/queued', candidate })
  const request = simulationDispatchSelectionRequestSchema.parse({ id: 'future-original-window', limit: 1 })
  expect(selectDecisions(state, request)).toEqual([])
  const advanced = h.fold(state, 'run/scheduler', { kind: 'clock/advanced', time: String(BigInt(state.time) + 1n) })
  expect(advanced.wakes[eventId]).toEqual(notice)
  expect(advanced.decisionDispatch!.tickets[candidate.id]).toEqual(state.decisionDispatch!.tickets[candidate.id])
  const reassigned = h.fold(advanced, 'run/change', { kind: 'relation/create', id: 'new-employment', relation: 'assignment',
    subject: h.actor.id, object: 'later-position', scope: id('organization'), validFrom: advanced.time, validUntil: null })
  expect(selectDecisions(reassigned, request)).toEqual([candidate.id])
  expect(reassigned.wakes[eventId]).toEqual(notice)
})
