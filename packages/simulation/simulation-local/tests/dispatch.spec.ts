import { describe, expect, it } from 'vitest'
import { simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema, simulationWindowRequestSchema,
  simulationDecisionIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'
import { foldDispatch } from '../src/dispatch.ts'

const candidate = (id: string, entityId: string, priority: number, deadline?: string) =>
  simulationDispatchCandidateSchema.parse({ id, entityId, priority, ...deadline === undefined ? {} : { deadline } })
const selection = (id: string, limit = 1) => simulationDispatchSelectionRequestSchema.parse({ id, limit })

describe.each(['json', 'sqlite'] as const)('%s fair decision admission', (backend) => {
  it('reserves deadline, priority and FIFO order and rejects a reordered window', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actors = [await h.actor('a'), await h.actor('b'), await h.actor('c')]
      for (const item of [candidate('low', 'a', 0), candidate('high', 'b', 10), candidate('due', 'c', -10, '4')]) {
        const queued = await h.run.queueDecision(item)
        expect(await h.run.queueDecision(item)).toEqual(queued)
        await expect(h.run.queueDecision({ ...item, priority: 100 })).rejects.toThrow(/changed its payload/)
      }
      const request = selection('ordered', 3)
      expect(() => foldDispatch(h.run.snapshot(), { kind: 'dispatch/reserved', request,
        decisions: ['low', 'high', 'due'].map(id => simulationDecisionIdSchema.parse(id)) })).toThrow(/fair order/)
      const allocated = await h.run.reserveDecisionWindow(request, h.run.snapshot().revision)
      expect(allocated?.decisions).toEqual(['due', 'high', 'low'])
      expect(await h.run.reserveDecisionWindow(request, 0)).toEqual(allocated)
      await expect(h.run.reserveDecisionWindow({ ...request, limit: 2 }, 0)).rejects.toThrow(/changed its request/)
      expect((await h.run.drive({ until: simTimeSchema.parse('10') })).reason).toBe('decision-required')
      expect(h.run.snapshot().time).toBe('0')
      const window = simulationWindowRequestSchema.parse({ id: request.id, decisions: allocated!.decisions.map(id => ({
        id, entityId: h.run.snapshot().decisionDispatch!.tickets[id]!.candidate.entityId, context: contextRequest(),
      })) })
      await expect(h.run.openWindow({ ...window, decisions: [...window.decisions].reverse() }, h.run.snapshot().revision))
        .rejects.toThrow(/reserved decision order/)
      await expect(actors[0]!.lease.openDecision(simulationDecisionIdSchema.parse('bypass'), h.run.snapshot().revision))
        .rejects.toThrow(/reserved window/)
      await h.run.openWindow(window, h.run.snapshot().revision)
      for (const actor of actors) {
        const item = window.decisions.find(value => value.entityId === actor.id)!
        await actor.lease.submitDecision(item.id, [])
      }
      await h.run.commitWindow(window.id)
      expect(Object.values(h.run.snapshot().decisions).map(value => value.id)).toEqual(['due', 'high', 'low'])
      expect(h.run.snapshot().decisionDispatch?.selections[request.id]?.status).toBe('opened')
    } finally { await h.close() }
  })

  it('promotes a waiting actor ahead of newly urgent work after the configured admission rounds', async () => {
    const h = await createBusinessHarness(backend, { maxDispatchWaitRounds: 2 })
    try {
      const patient = await h.actor('patient'); const urgent = await h.actor('urgent')
      await h.run.queueDecision(candidate('patient', 'patient', -100))
      for (let round = 0; round < 3; round += 1) {
        await h.run.queueDecision(candidate(`urgent-${round}`, 'urgent', 100, '0'))
        const allocated = await h.run.reserveDecisionWindow(selection(`round-${round}`), h.run.snapshot().revision)
        expect(allocated?.decisions).toEqual([round === 2 ? 'patient' : `urgent-${round}`])
        const actor = round === 2 ? patient : urgent
        const id = allocated!.decisions[0]!
        const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: allocated!.request.id,
          decisions: [{ id, entityId: actor.id, context: contextRequest() }] }), h.run.snapshot().revision)
        await actor.lease.submitDecision(id, [])
        await h.run.commitWindow(window.id)
      }
      expect(h.run.snapshot().decisionDispatch?.round).toBe('3')
      const before = h.run.snapshot().decisionDispatch
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.snapshot().decisionDispatch).toEqual(before)
        const after = await reopened.reserveDecisionWindow(selection('after-restart'), reopened.snapshot().revision)
        expect(after?.decisions).toEqual(['urgent-2'])
        expect(after?.round).toBe('3')
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('bounds outstanding nominations, selects one slot per actor and releases only cancelled reservations', async () => {
    const h = await createBusinessHarness(backend, { maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 2 })
    try {
      const actor = await h.actor('a')
      await h.run.queueDecision(candidate('one', 'a', 0))
      await h.run.queueDecision(candidate('two', 'a', 0))
      await expect(h.run.queueDecision(candidate('three', 'a', 0))).rejects.toThrow(/queue capacity/)
      const allocated = await h.run.reserveDecisionWindow(selection('one-actor', 2), h.run.snapshot().revision)
      expect(allocated?.decisions).toEqual(['one'])
      await expect(h.run.reserveDecisionWindow(selection('overlap'), h.run.snapshot().revision)).rejects.toThrow(/idle running/)
      await h.run.cancelQueuedDecision(simulationDecisionIdSchema.parse('one'), h.run.snapshot().revision)
      const cancelled = h.run.snapshot()
      expect(await h.run.cancelQueuedDecision(simulationDecisionIdSchema.parse('one'), 0)).toEqual(cancelled)
      await expect(actor.lease.openDecision(simulationDecisionIdSchema.parse('one'), h.run.snapshot().revision))
        .rejects.toThrow(/reserved window/)
      await expect(h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'one-actor', decisions: [{
        id: 'replacement', entityId: actor.id, context: contextRequest(),
      }] }), h.run.snapshot().revision)).rejects.toThrow(/require allocation/)
      await h.run.queueDecision(candidate('three', 'a', 0))
      await expect(h.run.cancelQueuedDecision(simulationDecisionIdSchema.parse('__proto__'), h.run.snapshot().revision))
        .rejects.toThrow(/cancellable/)
      expect((await h.run.reserveDecisionWindow(selection('next'), h.run.snapshot().revision))?.decisions).toEqual(['two'])
    } finally { await h.close() }
  })
})

it.each(['json', 'sqlite'] as const)('%s prevents manual decisions and windows from taking a nominated wake', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const actor = await h.actor('actor')
    const { simulationWakeRequestSchema } = await import('@clocky/clocky-simulation')
    const wake = simulationWakeRequestSchema.parse({ id: 'wake', entityId: actor.id, time: '0', reason: 'Queued work' })
    await h.run.scheduleWake(wake, h.run.snapshot().revision)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    const nominated = simulationDispatchCandidateSchema.parse({ id: 'nominated', entityId: actor.id, priority: 0, wakeId: wake.id })
    await h.run.queueDecision(nominated)
    const before = h.run.snapshot()
    await expect(actor.lease.openDecision(simulationDecisionIdSchema.parse('manual'), before.revision, wake.id))
      .rejects.toThrow(/reserved window/)
    await expect(h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'manual-window', decisions: [{ id: 'manual-window-decision',
      entityId: actor.id, wakeId: wake.id, context: contextRequest() }] }), before.revision)).rejects.toThrow(/reserved window/)
    expect(h.run.snapshot()).toEqual(before)
    const allocation = await h.run.reserveDecisionWindow(selection('scheduled'), before.revision)
    expect(allocation!.decisions).toEqual([nominated.id])
    await h.run.openWindow(simulationWindowRequestSchema.parse({ id: allocation!.request.id, decisions: [{ id: nominated.id,
      entityId: actor.id, wakeId: wake.id, context: contextRequest() }] }), h.run.snapshot().revision)
    await actor.lease.submitDecision(nominated.id, [])
    await h.run.commitWindow(allocation!.request.id)
    expect(h.run.snapshot().wakes[wake.id]!.status).toBe('completed')
    expect((await h.run.drive({ until: simTimeSchema.parse('1') })).reason).toBe('until')
  } finally { await h.close() }
})
