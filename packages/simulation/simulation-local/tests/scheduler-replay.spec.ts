import { afterEach, expect, it } from 'vitest'
import {
  simTimeSchema, simulationDecisionIdSchema, simulationEventIdSchema,
  simulationEventSlotSchema, simulationWakeRequestSchema,
} from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { allocateEventKey, assertSchedulerProjection, compareEventKeys, foldSchedulerRecord, schedulerRecordSchema } from '../src/scheduler.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const h = await createBusinessHarness('sqlite')
  cleanups.push(h.close)
  const actor = await h.actor('actor')
  const request = simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '5', reason: 'Work' })
  await h.run.scheduleWake(request, h.run.snapshot().revision)
  return { ...h, createActor: h.actor, actor, request }
}
function fold(state: SimulationSnapshot, value: unknown): SimulationSnapshot {
  return foldSchedulerRecord(state, schedulerRecordSchema.parse(value), state.revision + 1)
}

it('requires the canonical next event and a running, settled clock', async () => {
  const h = await setup()
  const state = h.run.snapshot()
  const event = state.scheduledEvents[h.request.id]!
  expect(compareEventKeys(state, event.key, { ...event.key, slot: simulationEventSlotSchema.parse('9007199254740993') })).toBeLessThan(0)
  expect(() => fold(state, { kind: 'event/cancelled', id: 'toString', reason: 'Cancel' })).toThrow(/does not exist/)
  expect(() => fold({ ...state, phase: 'paused' }, { kind: 'clock/advanced', time: '1' })).toThrow(/not running/)
  const later = { ...h.request, id: simulationEventIdSchema.parse('later'), time: simTimeSchema.parse('6') }
  await h.run.scheduleWake(later, state.revision)
  expect(() => fold(h.run.snapshot(), { kind: 'event/consumed', id: later.id })).toThrow(/not next/)
  await h.actor.lease.openDecision(simulationDecisionIdSchema.parse('active'), h.run.snapshot().revision)
  expect(() => fold(h.run.snapshot(), { kind: 'clock/advanced', time: '1' })).toThrow(/settle current/)
  expect(() => fold(state, { kind: 'event/queued', ...event })).toThrow(/unrecognized|identity/)
  expect(() => fold(state, { kind: 'run/stalled', id: event.id })).toThrow(/overflowing/)
  const shifted = { ...state, time: simTimeSchema.parse('6') }
  expect(() => fold(shifted, { kind: 'event/consumed', id: event.id })).toThrow(/cannot advance/)
  const cancelled = fold(state, { kind: 'event/cancelled', id: event.id, reason: 'Withdraw' })
  expect(() => fold(cancelled, { kind: 'event/cancelled', id: event.id, reason: 'Again' })).toThrow(/Only a pending/)
  expect(() => fold(cancelled, { kind: 'wake/cancelled', id: event.id, reason: 'Missing' })).toThrow(/no pending responsibility/)
})

it('retains cancelled wake responsibility for unavailable entities and rejects a missing entity', async () => {
  const h = await setup()
  const state = h.run.snapshot()
  expect(() => fold({ ...state, entities: {} }, { kind: 'event/consumed', id: h.request.id })).toThrow(/entity is missing/)
  const entity = state.entities[h.actor.id]!
  const unavailable = fold({ ...state, entities: { [h.actor.id]: { ...entity, phase: 'terminated' } } },
    { kind: 'event/consumed', id: h.request.id })
  expect(unavailable.wakes[h.request.id]).toMatchObject({ status: 'cancelled', cancellation: 'Entity unavailable' })
  const consumed = fold(state, { kind: 'event/consumed', id: h.request.id })
  const cancelled = fold(consumed, { kind: 'wake/cancelled', id: h.request.id, reason: 'Withdraw' })
  expect(cancelled.wakes[h.request.id]!.status).toBe('cancelled')
  expect(() => fold(cancelled, { kind: 'wake/cancelled', id: h.request.id, reason: 'Again' })).toThrow(/no pending responsibility/)
})

it('checks source identity, references and allocation when replaying queued events', async () => {
  const h = await setup()
  const state = h.run.snapshot()
  const event = state.scheduledEvents[h.request.id]!
  const queue = { kind: 'event/queued', id: 'new', action: event.action,
    key: allocateEventKey(state, simTimeSchema.parse('7'), event.action) }
  expect(() => fold(state, { ...queue, id: event.id })).toThrow(/already retained/)
  expect(() => fold(state, { ...queue, key: { ...queue.key, slot: '99' } })).toThrow(/policy allocation/)
  expect(() => fold(state, { ...queue, action: { ...event.action, entityId: 'missing' } })).toThrow(/missing domain/)
  expect(() => fold(state, { ...queue, sourceOperationId: 'fake' })).toThrow(/impersonate/)
  expect(() => fold(state, { ...queue, action: { kind: 'reply-wake', interactionId: 'missing' } })).toThrow(/missing domain/)
})

it('rejects a published wake without its consumed source event', async () => {
  const h = await setup()
  const state = fold(h.run.snapshot(), { kind: 'event/consumed', id: h.request.id })
  expect(() => { assertSchedulerProjection({ ...state, scheduledEvents: {} }) }).toThrow(/consumed source/)
})

it('rejects missing ingress and outbox handoff owners instead of consuming their responsibility', async () => {
  const h = await setup()
  await h.run.cancelEvent(h.request.id, 'Use domain events', h.run.snapshot().revision)
  const { simulationIngressRequestSchema } = await import('@clocky/clocky-simulation')
  const ingress = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'input', entityId: h.actor.id,
    source: 'operator', text: 'Work', availableAt: '1' }))
  const state = h.run.snapshot()
  expect(() => fold({ ...state, ingresses: {} }, { kind: 'event/consumed', id: ingress.eventId })).toThrow(/lost its receipt/)
  await h.run.cancelEvent(ingress.eventId, 'Use outbox event', state.revision)
  await h.submit(h.actor.lease, 'message', [{ after: [], action: { kind: 'communication/post', recipient: h.actor.id,
    channelId: 'channel', text: 'Message', deliverAt: '2' } }])
  const message = h.run.snapshot()
  const event = Object.values(message.scheduledEvents).find(value => value.action.kind === 'outbox-ready')!
  expect(() => fold({ ...message, operations: {} }, { kind: 'event/consumed', id: event.id })).toThrow(/outbox intent is missing/)
  expect(() => fold({ ...message, operations: {} }, { kind: 'event/cancelled', id: event.id, reason: 'Withdraw' }))
    .toThrow(/unattempted outbox/)
})

it('validates internal reply sources and preserves obsolete deadline outcomes', async () => {
  const h = await setup()
  await h.run.cancelEvent(h.request.id, 'Use deadlines', h.run.snapshot().revision)
  const requester = h.actor, assignee = await h.createActor('assignee')
  await h.apply(requester.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: assignee.id,
    description: 'Work', replyBy: '5', completeBy: '7', fulfillment: { kind: 'explicit' } })
  const requested = h.run.snapshot()
  const deadline = Object.values(requested.scheduledEvents).find(value => value.action.kind === 'reply-deadline')!
  const queued = { kind: 'event/queued', id: deadline.id, key: deadline.key, action: deadline.action }
  const { [deadline.id]: _deadline, ...withoutDeadline } = requested.scheduledEvents
  expect(() => fold({ ...requested, scheduledEvents: withoutDeadline }, queued)).toThrow(/exact accepted operation/)
  const onlyDeadline = { ...requested, scheduledEvents: { [deadline.id]: deadline }, interactions: {} }
  expect(fold(onlyDeadline, { kind: 'event/consumed', id: deadline.id }).interactions).toEqual({})
  await h.apply(assignee.lease, 'defer', { kind: 'interaction/defer', id: 'work', expectedRevision: 1, until: '3', reason: 'Later' })
  const deferred = h.run.snapshot()
  const reply = Object.values(deferred.scheduledEvents).find(value => value.action.kind === 'reply-wake')!
  expect(() => fold({ ...deferred, interactions: {} }, { kind: 'event/consumed', id: reply.id })).toThrow(/reply interaction is missing/)
  await h.run.drive({ until: simTimeSchema.parse('3') })
  await h.apply(assignee.lease, 'accept', { kind: 'interaction/accept', id: 'work', expectedRevision: 2 })
  const accepted = h.run.snapshot()
  const due = Object.values(accepted.scheduledEvents).find(value => value.action.kind === 'commitment-deadline')!
  expect(fold({ ...accepted, commitments: {} }, { kind: 'event/consumed', id: due.id }).commitments).toEqual({})
})

it('diagnoses missing scheduled responsibilities and ingress allocation gaps', async () => {
  const h = await setup()
  const { simulationIngressRequestSchema } = await import('@clocky/clocky-simulation')
  const receipt = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'input', entityId: h.actor.id,
    source: 'operator', text: 'Work', availableAt: '2' }))
  const state = h.run.snapshot()
  expect(() => { assertSchedulerProjection({ ...state, nextIngressSlot: simulationEventSlotSchema.parse('0') }) }).toThrow(/order has a gap/)
  expect(() => { assertSchedulerProjection({ ...state, scheduledEvents: {} }) }).toThrow(/scheduled responsibility/)
  const queued = { kind: 'event/queued', id: receipt.eventId, key: receipt.key,
    action: { kind: 'ingress', ingressId: receipt.request.id } }
  const { [receipt.eventId]: _event, ...withoutIngress } = state.scheduledEvents
  expect(() => fold({ ...state, scheduledEvents: withoutIngress }, { ...queued, sourceOperationId: 'wrong' })).toThrow(/receipt assignment/)
  await h.apply(h.actor.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: h.actor.id,
    description: 'Work', replyBy: '5', completeBy: null, fulfillment: { kind: 'explicit' } })
  const requested = h.run.snapshot()
  const event = Object.values(requested.scheduledEvents).find(value => value.action.kind === 'reply-deadline')!
  const { [event.id]: _deadline, ...withoutDeadline } = requested.scheduledEvents
  expect(() => { assertSchedulerProjection({ ...requested, scheduledEvents: withoutDeadline }) })
    .toThrow(/missing its scheduled responsibility/)
})

it('rejects forged conflict lineage, exhaustion and missing retry ownership', async () => {
  const h = await setup()
  await h.account('stock', h.actor.id, '2'); await h.account('received', h.actor.id, '0')
  const transfer = { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
    reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
    transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
  } }
  const success = await h.apply(h.actor.lease, 'first', transfer)
  const failure = await h.apply(h.actor.lease, 'stale', transfer)
  const state = h.run.snapshot()
  const operation = state.operations[failure.operationId]!
  const retry = Object.values(state.scheduledEvents).find(event => event.action.kind === 'conflict-retry')!
  expect(() => fold({ ...state, operations: {} }, { kind: 'event/consumed', id: retry.id })).toThrow(/lost its failed operation/)
  expect(() => fold(state, { kind: 'conflict/exhausted', id: success.operationId })).toThrow(/no unresolved resource conflict/)
  const { conflictRetry: _retry, ...withoutRetry } = operation
  const bare = { ...state, operations: { ...state.operations, [operation.id]: withoutRetry } }
  expect(() => fold(bare, { kind: 'conflict/exhausted', id: operation.id })).toThrow(/not exhausted/)
  expect(() => { assertSchedulerProjection(bare) }).toThrow(/no retry disposition/)
  expect(() => { assertSchedulerProjection({ ...state, scheduledEvents: {} }) }).toThrow(/scheduled responsibility/)
  const first = state.operations[success.operationId]!
  expect(() => { assertSchedulerProjection({ ...state, operations: { ...state.operations,
    [first.id]: { ...first, conflictRetry: operation.conflictRetry! },
  } }) }).toThrow(/duplicated or unsupported/)
  const { schedulerConsequences } = await import('../src/scheduler.ts')
  expect(() => schedulerConsequences({ ...bare, decisions: {} }, withoutRetry)).toThrow(/lost its decision/)
  const queue = { kind: 'event/queued', id: retry.id, key: retry.key, sourceOperationId: operation.id,
    action: { ...retry.action, attempt: 99 } }
  const { [retry.id]: _event, ...withoutEvent } = state.scheduledEvents
  expect(() => fold({ ...bare, scheduledEvents: withoutEvent, nextEventSlot: retry.key.slot }, queue)).toThrow(/source or budget/)
  const exhausted = fold({ ...bare, scheduledEvents: withoutEvent, spec: { ...state.spec, maxConflictRetries: 0 } },
    { kind: 'conflict/exhausted', id: operation.id })
  expect(() => { assertSchedulerProjection({ ...exhausted, phase: 'running' }) }).toThrow(/exhaustion contradicts/)
})

it('rejects ingress admitted during a checkpoint and missing ingress recipients', async () => {
  const h = await setup()
  const { simulationIngressRequestSchema, simulationCheckpointRequestSchema } = await import('@clocky/clocky-simulation')
  const { ingressEventId } = await import('../src/scheduler.ts')
  const request = simulationIngressRequestSchema.parse({ id: 'input', entityId: h.actor.id, source: 'operator', text: 'Work', availableAt: '1' })
  const state = h.run.snapshot()
  const record = { kind: 'ingress/received', request, ordinal: '0', eventId: ingressEventId(state, request.id),
    key: allocateEventKey(state, request.availableAt, { kind: 'ingress', ingressId: request.id }) }
  expect(() => fold({ ...state, entities: {} }, record)).toThrow(/identity, actor/)
  const { ingresses: _ingresses, ...withoutIngresses } = state
  expect(() => fold(withoutIngresses, { kind: 'event/queued', id: record.eventId, key: record.key,
    action: { kind: 'ingress', ingressId: request.id } })).toThrow(/missing domain/)
  await h.run.beginCheckpoint(simulationCheckpointRequestSchema.parse({ id: 'cut', implementationVersion: 'test', maxDrainRounds: 2, maxAttempts: 1 }))
  expect(() => fold(h.run.snapshot(), record)).toThrow(/blocks new external input/)
})

it('requires an applied business source before queuing its deadline', async () => {
  const h = await setup()
  await h.apply(h.actor.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: h.actor.id,
    description: 'Work', replyBy: '8', completeBy: null, fulfillment: { kind: 'explicit' } })
  const state = h.run.snapshot()
  const event = Object.values(state.scheduledEvents).find(value => value.action.kind === 'reply-deadline')!
  const operation = state.operations[event.sourceOperationId!]!
  const { result: _result, ...withoutResult } = operation
  const { [event.id]: _event, ...remaining } = state.scheduledEvents
  expect(() => fold({ ...state, scheduledEvents: remaining, nextEventSlot: event.key.slot,
    operations: { ...state.operations, [operation.id]: withoutResult } }, { kind: 'event/queued', id: event.id,
    key: event.key, action: event.action, sourceOperationId: operation.id })).toThrow(/source operation is not applied/)
  const { schedulerConsequences } = await import('../src/scheduler.ts')
  const { simulationOperationSchema } = await import('@clocky/clocky-simulation')
  expect(() => schedulerConsequences({ ...state, interactions: {} }, { ...operation,
    action: simulationOperationSchema.parse({ kind: 'interaction/accept', id: 'missing', expectedRevision: 1 }) }))
    .toThrow(/no commitment/)
})

it('settles a cancelled task readiness event without dispatching its task', async () => {
  const h = await setup()
  const accepted = await h.submit(h.actor.lease, 'task', [{ after: [], action: { kind: 'task/create', deliverAt: '9',
    task: { subject: 'Work', description: 'Do work', blockedBy: [], requiredCapabilities: [], priority: 0,
      readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 },
  } }])
  const event = Object.values(h.run.snapshot().scheduledEvents).find(value => value.action.kind === 'outbox-ready')!
  await h.run.cancelEvent(event.id, 'Withdraw', h.run.snapshot().revision)
  expect(h.run.snapshot().operations[accepted.operationIds[0]!]!.result).toMatchObject({ status: 'rejected', code: 'SIM_TASK_CANCELLED' })
})

it('cancels a window wake without disturbing the window identity or unrelated terminal decisions', async () => {
  const h = await setup()
  const { simulationWindowRequestSchema } = await import('@clocky/clocky-simulation')
  const { contextRequest } = await import('./context-fixture.ts')
  await h.run.drive({ until: simTimeSchema.parse('5') })
  const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'window', decisions: [{ id: 'decision', entityId: h.actor.id,
    wakeId: h.request.id, context: contextRequest() }] }), h.run.snapshot().revision)
  const state = h.run.snapshot()
  const id = window.request.decisions[0]!.id
  const cancelled = fold(state, { kind: 'wake/cancelled', id: h.request.id, reason: 'Withdraw' })
  expect(cancelled.decisions[id]!.status).toBe('cancelled')
  expect(cancelled.activeWindowId).toBe(window.id)
  for (const decisions of [{}, { [id]: { ...state.decisions[id]!, status: 'cancelled' as const } }]) {
    expect(fold({ ...state, decisions }, { kind: 'wake/cancelled', id: h.request.id, reason: 'Withdraw' }).decisions).toEqual(decisions)
  }
})

it('retains expired reply history while scheduling subsequent business responsibility', async () => {
  const h = await setup()
  await h.run.cancelEvent(h.request.id, 'Use deadline', h.run.snapshot().revision)
  const request = { kind: 'interaction/request', id: 'old', assignee: h.actor.id,
    description: 'Work', replyBy: '1', completeBy: null, fulfillment: { kind: 'explicit' } }
  await h.apply(h.actor.lease, 'old-request', request)
  await h.run.drive({ until: simTimeSchema.parse('2') })
  await h.apply(h.actor.lease, 'new-request', { ...request, id: 'new', replyBy: '3' })
  expect(Object.values(h.run.snapshot().interactions).map(value => value.replyExpiredAt)).toEqual(['1', undefined])
})

it('replaces a consumed deferred-reply wake with the newly accepted deferral', async () => {
  const h = await setup()
  await h.run.cancelEvent(h.request.id, 'Use reply wakes', h.run.snapshot().revision)
  await h.apply(h.actor.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: h.actor.id,
    description: 'Work', replyBy: '8', completeBy: null, fulfillment: { kind: 'explicit' } })
  await h.apply(h.actor.lease, 'first-defer', { kind: 'interaction/defer', id: 'work', expectedRevision: 1, until: '3', reason: 'Later' })
  await h.run.drive({ until: simTimeSchema.parse('3') })
  const prior = Object.values(h.run.snapshot().wakes)[0]!
  await h.apply(h.actor.lease, 'defer-again', { kind: 'interaction/defer', id: 'work', expectedRevision: 2, until: '4', reason: 'Still busy' })
  expect(h.run.snapshot().wakes[prior.eventId]!.status).toBe('cancelled')
  await h.run.drive({ until: simTimeSchema.parse('4') })
  expect(Object.values(h.run.snapshot().wakes).map(wake => wake.status)).toEqual(['cancelled', 'pending'])
})
