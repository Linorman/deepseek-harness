import { describe, expect, it, vi } from 'vitest'
import { simulationDecisionIdSchema, simulationEventIdSchema, simulationWakeRequestSchema,
  simulationDispatchCandidateSchema, simulationIngressRequestSchema, simulationWindowRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { createBusinessHarness } from './business-harness.ts'
import { foldSchedulerRecord } from '../src/scheduler.ts'
import { contextRequest } from './context-fixture.ts'

const horizon = { until: simTimeSchema.parse('10') }
describe.each(['json', 'sqlite'] as const)('%s decision event cohorts', (backend) => {
  it('keeps each collected ingress body in only its owning decision context', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actors = [await h.actor('a'), await h.actor('b')]
      const receipts = []
      for (const actor of actors) receipts.push(await h.run.ingest(simulationIngressRequestSchema.parse({
        id: actor.id, entityId: actor.id, source: 'operator', text: `private-input-${actor.id}`, availableAt: '5',
      })))
      expect(await h.run.collectDecisionWakes(horizon)).toMatchObject({ reason: 'decision-required', steps: 2 })
      const request = simulationWindowRequestSchema.parse({ id: 'inputs', decisions: receipts.map(receipt => ({
        id: receipt.request.entityId, entityId: receipt.request.entityId, wakeId: receipt.eventId, context: contextRequest(),
      })) })
      await h.run.openWindow(request, h.run.snapshot().revision)
      for (const decision of Object.values(h.run.snapshot().decisions)) {
        expect(JSON.stringify(decision.context)).toContain(`private-input-${decision.entityId}`)
        expect(JSON.stringify(decision.context)).not.toContain(`private-input-${decision.entityId === 'a' ? 'b' : 'a'}`)
      }
    } finally { await h.close() }
  })

  it('collects sibling wakes in key order without crossing a deadline, time or microstep', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      await h.apply(a.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: b.id,
        description: 'Review', replyBy: '5', completeBy: '10', fulfillment: { kind: 'explicit' } })
      for (const [id, entityId, time] of [['a', a.id, '5'], ['b', b.id, '5'], ['future', a.id, '6']]) {
        await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id, entityId, time, reason: 'Work' }), h.run.snapshot().revision)
      }
      expect((await h.run.drive(horizon)).reason).toBe('decision-required')
      expect(Object.keys(h.run.snapshot().wakes)).toEqual(['a'])
      await h.run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'next-microstep', entityId: a.id, time: '5', reason: 'Later' }),
        h.run.snapshot().revision)
      expect(await h.run.collectDecisionWakes(horizon)).toMatchObject({ reason: 'decision-required', steps: 1 })
      const state = h.run.snapshot()
      expect(Object.keys(state.wakes)).toEqual(['a', 'b'])
      expect(state.time).toBe('5')
      expect(Object.values(state.interactions)[0]?.replyExpiredAt).toBeUndefined()
      for (const id of ['future', 'next-microstep']) {
        expect(() => foldSchedulerRecord(state, { kind: 'event/cohort-consumed', id: simulationEventIdSchema.parse(id) }, state.revision + 1))
          .toThrow(/decision cohort/)
      }
      const deadline = Object.values(state.scheduledEvents).find(event => event.action.kind === 'reply-deadline')!
      expect(() => foldSchedulerRecord(state, { kind: 'event/cohort-consumed', id: deadline.id }, state.revision + 1))
        .toThrow(/decision cohort/)
    } finally { await h.close() }
  })

  it('retains a partial cohort through restart and stops collection after nomination or claim', async () => {
    const h = await createBusinessHarness(backend, { maxDriveSteps: 1 })
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      for (const actor of [a, b]) await h.run.scheduleWake(simulationWakeRequestSchema.parse({
        id: actor.id, entityId: actor.id, time: '5', reason: 'Work',
      }), h.run.snapshot().revision)
      expect(await h.run.collectDecisionWakes(horizon)).toMatchObject({ reason: 'work-limit', steps: 1 })
      const first = await a.lease.openDecision(simulationDecisionIdSchema.parse('first'), h.run.snapshot().revision,
        simulationEventIdSchema.parse('a'))
      expect(await h.run.collectDecisionWakes(horizon)).toMatchObject({ reason: 'decision-required', steps: 0 })
      await a.lease.cancelDecision(first.id)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        await reopened.queueDecision(simulationDispatchCandidateSchema.parse({ id: 'nomination', entityId: a.id, priority: 0, wakeId: 'a' }))
        expect(await reopened.collectDecisionWakes(horizon)).toMatchObject({ reason: 'decision-required', steps: 0 })
        await reopened.cancelQueuedDecision(simulationDecisionIdSchema.parse('nomination'), reopened.snapshot().revision)
        expect(await reopened.collectDecisionWakes(horizon)).toMatchObject({ reason: 'work-limit', steps: 1 })
        expect(Object.keys(reopened.snapshot().wakes)).toEqual(['a', 'b'])
        expect(await reopened.collectDecisionWakes(horizon)).toMatchObject({ reason: 'decision-required', steps: 0 })
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('does not publish a sibling wake when its cohort append fails', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a')
      for (const id of ['first', 'second']) await h.run.scheduleWake(simulationWakeRequestSchema.parse({
        id, entityId: a.id, time: '1', reason: 'Work',
      }), h.run.snapshot().revision)
      await h.run.drive(horizon)
      const before = h.run.snapshot()
      const stream = (h.run as unknown as { stream: LogStream }).stream
      vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('durability failed'))
      await expect(h.run.collectDecisionWakes(horizon)).rejects.toThrow('durability failed')
      expect(h.run.snapshot()).toEqual(before)
      expect((await h.run.collectDecisionWakes(horizon)).steps).toBe(1)
    } finally { await h.close() }
  })
})
