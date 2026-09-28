import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  simTimeSchema, simulationDecisionIdSchema, simulationEventIdSchema, simulationWakeRequestSchema,
} from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { createBusinessHarness } from './business-harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(backend: 'json' | 'sqlite', options: Record<string, unknown> = {}) {
  const fixture = await createBusinessHarness(backend, options)
  cleanups.push(fixture.close)
  return fixture
}
const time = simTimeSchema.parse.bind(simTimeSchema)

describe.each(['json', 'sqlite'] as const)('%s durable simulation scheduling', (backend) => {
  it('orders numeric times, preserves cancelled history and hands each consumed wake to one decision', async () => {
    const { run, actor, provider, selection, leases } = await setup(backend)
    const buyer = await actor('buyer')
    const later = simulationWakeRequestSchema.parse({ id: 'later', time: '10', entityId: buyer.id, reason: 'Later work' })
    const earlier = simulationWakeRequestSchema.parse({ id: 'earlier', time: '9', entityId: buyer.id, reason: 'Earlier work' })
    await run.scheduleWake(later, run.snapshot().revision)
    await run.scheduleWake(earlier, run.snapshot().revision)
    expect((await run.drive({ until: time('8') })).reason).toBe('until')
    expect(Object.values(run.snapshot().wakes)).toEqual([])
    await expect(run.scheduleWake({ ...earlier, id: simulationEventIdSchema.parse('past'), time: time('7') }, run.snapshot().revision)).rejects.toThrow(/committed past/)
    await run.cancelEvent(later.id, 'Withdraw', run.snapshot().revision)
    expect((await run.drive({ until: time('20') })).reason).toBe('decision-required')
    expect(run.snapshot().time).toBe('9')
    const decision = await buyer.lease.openDecision(simulationDecisionIdSchema.parse('reply'), run.snapshot().revision, earlier.id)
    expect(run.snapshot().wakes[earlier.id]?.status).toBe('claimed')
    await buyer.lease.submitDecision(decision.id, [])
    expect(run.snapshot().wakes[earlier.id]?.status).toBe('completed')
    await run.drive({ until: time('20') })
    expect(run.snapshot().time).toBe('20')
    expect(run.snapshot().scheduledEvents[later.id]?.status).toBe('cancelled')
    const beforeRetry = run.snapshot()
    await run.scheduleWake(earlier, 0)
    expect(run.snapshot()).toEqual(beforeRetry)
    await buyer.lease.revoke(); await buyer.lease.release(); leases.splice(0)
    const final = run.snapshot()
    await run.close()
    const restored = await provider.open({ ...selection, mode: 'open' })
    expect(restored.snapshot()).toEqual(final)
    expect((await restored.drive({ until: time('20') })).steps).toBe(0)
  })

  it('persists deferred replies, releases a cancelled slot back to its wake, and records late fulfillment separately from breach', async () => {
    const { run, actor, apply } = await setup(backend)
    const requester = await actor('requester'); const assignee = await actor('assignee')
    await apply(requester.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: assignee.id,
      description: 'Review', replyBy: '10', completeBy: '20', fulfillment: { kind: 'explicit' } })
    await apply(assignee.lease, 'defer', { kind: 'interaction/defer', id: 'work', expectedRevision: 1, until: '5', reason: 'Busy' })
    expect(Object.values(run.snapshot().scheduledEvents)).toHaveLength(2)
    await run.drive({ until: time('4') })
    expect(Object.values(run.snapshot().wakes)).toHaveLength(0)
    await run.drive({ until: time('10') })
    const wake = Object.values(run.snapshot().wakes)[0]
    if (wake === undefined) throw new Error('fixture wake missing')
    expect(run.snapshot().time).toBe('5')
    const first = await assignee.lease.openDecision(simulationDecisionIdSchema.parse('cancelled-reply'), run.snapshot().revision, wake.eventId)
    await assignee.lease.cancelDecision(first.id)
    expect(run.snapshot().wakes[wake.eventId]?.status).toBe('pending')
    const next = await assignee.lease.openDecision(simulationDecisionIdSchema.parse('accept'), run.snapshot().revision, wake.eventId)
    const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
    await assignee.lease.submitDecision(next.id, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'interaction/accept', id: 'work', expectedRevision: 2,
    } })])
    await run.drive({ until: time('21') })
    expect(Object.values(run.snapshot().interactions)[0]).toMatchObject({ reply: 'accepted', revision: 3 })
    expect(Object.values(run.snapshot().commitments)[0]).toMatchObject({ phase: 'open', breachedAt: '20' })
    await apply(requester.lease, 'late-confirmation', { kind: 'interaction/confirm', id: 'work', expectedRevision: 3 })
    expect(Object.values(run.snapshot().commitments)[0]).toMatchObject({ phase: 'fulfilled', breachedAt: '20', fulfilledAt: '21' })
  })
})

it('expires an unanswered request and never treats a transport clock as its deadline', async () => {
  const { run, actor, apply } = await setup('sqlite')
  const requester = await actor('requester'); const assignee = await actor('assignee')
  await apply(requester.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: assignee.id,
    description: 'Review', replyBy: '3', completeBy: '10', fulfillment: { kind: 'explicit' } })
  await run.setPhase('paused', run.snapshot().revision)
  expect((await run.drive({ until: time('10') })).reason).toBe('paused')
  expect(run.snapshot().time).toBe('0')
  await run.setPhase('running', run.snapshot().revision)
  await run.drive({ until: time('3') })
  expect(Object.values(run.snapshot().interactions)[0]).toMatchObject({ reply: 'pending', replyExpiredAt: '3', revision: 2 })
  expect(await apply(assignee.lease, 'too-late', { kind: 'interaction/accept', id: 'work', expectedRevision: 2 }))
    .toMatchObject({ status: 'rejected', code: 'SIM_REPLY_EXPIRED' })
})

it('keeps consumption and its wake responsibility absent together when the append fails', async () => {
  const { run, actor } = await setup('sqlite')
  const buyer = await actor('buyer')
  const request = simulationWakeRequestSchema.parse({ id: 'wake', time: '2', entityId: buyer.id, reason: 'Work' })
  await run.scheduleWake(request, run.snapshot().revision)
  const before = run.snapshot()
  const stream = (run as unknown as { stream: LogStream }).stream
  vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('durability failed'))
  await expect(run.drive({ until: time('2') })).rejects.toThrow('durability failed')
  expect(run.snapshot()).toEqual(before)
  await run.drive({ until: time('2') })
  expect(run.snapshot().scheduledEvents[request.id]?.status).toBe('consumed')
  expect(run.snapshot().wakes[request.id]?.status).toBe('pending')
})

it('bounds drive work and stalls a zero-time chain until the overflowing event is explicitly cancelled', async () => {
  const { run, actor } = await setup('sqlite', { outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 1, maxMicrostepsPerTime: 2 })
  const buyer = await actor('buyer')
  for (let index = 0; index < 3; index += 1) {
    const request = simulationWakeRequestSchema.parse({ id: `wake-${index}`, time: '0', entityId: buyer.id, reason: 'Again' })
    await run.scheduleWake(request, run.snapshot().revision)
    const driven = await run.drive({ until: time('0') })
    if (index === 2) {
      expect(driven.reason).toBe('stalled')
      expect(run.snapshot().stall).toMatchObject({ code: 'SIM_MICROSTEP_LIMIT', eventId: request.id })
      await expect(run.setPhase('running', run.snapshot().revision)).rejects.toThrow(/must be resolved/)
      await run.cancelEvent(request.id, 'Stop zero-time loop', run.snapshot().revision)
      await run.setPhase('running', run.snapshot().revision)
      expect(run.snapshot().stall).toBeUndefined()
    } else {
      expect(driven.reason).toBe('work-limit')
      const decision = await buyer.lease.openDecision(simulationDecisionIdSchema.parse(`decision-${index}`), run.snapshot().revision, request.id)
      await buyer.lease.submitDecision(decision.id, [])
    }
  }
  await run.drive({ until: time('1') })
  expect(run.snapshot().time).toBe('1')
})

it('uses the persisted phase order for equal-time reply wakes and expiry', async () => {
  const { run, actor, apply } = await setup('sqlite', { phaseOrder: ['deadline', 'decision', 'delivery'] })
  const requester = await actor('requester'); const assignee = await actor('assignee')
  await apply(requester.lease, 'request', { kind: 'interaction/request', id: 'reply', assignee: assignee.id,
    description: 'Review', replyBy: '5', completeBy: '8', fulfillment: { kind: 'explicit' } })
  await apply(assignee.lease, 'defer', { kind: 'interaction/defer', id: 'reply', expectedRevision: 1, until: '5', reason: 'Busy' })
  await run.drive({ until: time('6') })
  expect(Object.values(run.snapshot().interactions)[0]?.replyExpiredAt).toBe('5')
  expect(Object.values(run.snapshot().wakes)[0]).toMatchObject({ status: 'cancelled', cancellation: 'Reply no longer pending' })
  expect(run.snapshot().time).toBe('6')
})

it('cancels a claimed wake when an earlier accepted cancellation makes its business input obsolete', async () => {
  const { run, actor, apply, submit } = await setup('sqlite')
  const requester = await actor('requester'); const assignee = await actor('assignee')
  await apply(requester.lease, 'request', { kind: 'interaction/request', id: 'reply', assignee: assignee.id,
    description: 'Review', replyBy: '10', completeBy: '20', fulfillment: { kind: 'explicit' } })
  await apply(assignee.lease, 'defer', { kind: 'interaction/defer', id: 'reply', expectedRevision: 1, until: '5', reason: 'Busy' })
  await run.drive({ until: time('5') })
  const wake = Object.values(run.snapshot().wakes)[0]
  if (wake === undefined) throw new Error('fixture wake missing')
  const cancel = await submit(requester.lease, 'cancel', [{ after: [], action: {
    kind: 'interaction/cancel', id: 'reply', expectedRevision: 2, reason: 'No longer needed',
  } }])
  const old = await assignee.lease.openDecision(simulationDecisionIdSchema.parse('stale-reply'), run.snapshot().revision, wake.eventId)
  const id = cancel.operationIds[0]
  if (id === undefined) throw new Error('fixture cancellation missing')
  await run.executeOperation(id)
  expect(run.snapshot().wakes[wake.eventId]?.status).toBe('cancelled')
  expect(run.snapshot().decisions[old.id]).toMatchObject({ status: 'cancelled', cancellation: 'scheduled-wake-cancelled' })
  await expect(assignee.lease.submitDecision(old.id, [])).rejects.toThrow(/not current/)
  await run.drive({ until: time('20') })
  expect(run.snapshot().time).toBe('20')
})

it('compares large time strings numerically and rejects event id payload changes', async () => {
  const { run, actor } = await setup('sqlite', { maxTime: '100000000000000000000' })
  const buyer = await actor('buyer')
  const request = simulationWakeRequestSchema.parse({ id: 'far-future', entityId: buyer.id,
    time: '9007199254740993', reason: 'Future work' })
  await run.scheduleWake(request, run.snapshot().revision)
  await expect(run.scheduleWake({ ...request, reason: 'Changed' }, run.snapshot().revision)).rejects.toThrow(/different payload/)
  await run.drive({ until: time('9007199254740992') })
  expect(Object.values(run.snapshot().wakes)).toHaveLength(0)
  await run.drive({ until: request.time })
  expect(run.snapshot().wakes[request.id]?.status).toBe('pending')
  await expect(buyer.lease.openDecision(simulationDecisionIdSchema.parse('wrong-wake'), run.snapshot().revision,
    simulationEventIdSchema.parse('missing'))).rejects.toThrow(/pending scheduled wake/)
})

it('rejects malformed ordering and missing automatic responsibilities at the durable boundary', async () => {
  const { foldSchedulerRecord, assertSchedulerProjection, compareEventKeys, allocateEventKey } = await import('../src/scheduler.ts')
  const { run, actor, apply } = await setup('sqlite')
  const buyer = await actor('buyer'); const seller = await actor('seller')
  const request = simulationWakeRequestSchema.parse({ id: 'wake', entityId: buyer.id, time: '4', reason: 'Work' })
  const action = { kind: 'wake' as const, entityId: buyer.id, reason: request.reason }
  const key = allocateEventKey(run.snapshot(), request.time, action)
  expect(compareEventKeys(run.snapshot(), key, key)).toBe(0)
  await expect(run.scheduleWake({ ...request, id: simulationEventIdSchema.parse('simulation-event:reserved') }, run.snapshot().revision))
    .rejects.toThrow(/reserved/)
  expect(() => foldSchedulerRecord(run.snapshot(), { kind: 'event/queued', id: request.id,
    key: { ...key, phase: 'deadline' }, action }, run.snapshot().revision + 1)).toThrow(/next policy allocation/)
  await run.scheduleWake(request, run.snapshot().revision)
  expect(() => foldSchedulerRecord(run.snapshot(), { kind: 'clock/advanced', time: time('5') }, run.snapshot().revision + 1))
    .toThrow(/skip a pending event/)
  await run.cancelEvent(request.id, 'Withdraw', run.snapshot().revision)
  await apply(buyer.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: seller.id,
    description: 'Review', replyBy: '7', completeBy: '10', fulfillment: { kind: 'explicit' } })
  const broken = { ...run.snapshot(), scheduledEvents: {} }
  expect(() => { assertSchedulerProjection(broken) }).toThrow(/missing its scheduled responsibility/)
})
