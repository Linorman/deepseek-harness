import { worldDecisionSource } from '@clocky/clocky-simulation'
/** Actual accepted requests, not technical decision identities, consume frozen actor/interval and history allowances. */
import { describe, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationWorldCancelRequestSchema, simulationWakeRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { worldRequestBudget, assertWorldRequestBudgetProjection } from '../src/world-request-budget.ts'

const quotaFailure = { code: 'SIM_WORLD_LIMIT', failure: { code: 'SIM_WORLD_LIMIT', limit: 'requests' } }
describe.each(['json', 'sqlite'] as const)('%s World request budgets', (backend) => {
  it('charges independent actual actors and never refunds accepted requests after cancellation or technical retry', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { actorRequests: 1, secondRequester: true })
    try {
      const plan = await h.plan('first-actor'), before = h.run.snapshot(), request = before.world!.requests[plan.requestId]!
      const second = h.secondRequester!
      expect(worldRequestBudget(before, h.requester, simTimeSchema.parse('0'), request.sequence - 1).used).toBe(0)
      const source = before.decisions[worldDecisionSource(request).decisionId]!
      expect(() => worldRequestBudget({ ...before, decisions: { ...before.decisions, [source.id]: { ...source, status: 'cancelled' } } },
        h.requester, simTimeSchema.parse('0'))).toThrow(/original accepted actor decision/)
      expect(worldRequestBudget(before, h.requester, simTimeSchema.parse('0'))).toMatchObject({ used: 1, limit: 1, interval: '0', period: '100' })
      expect(worldRequestBudget(before, second, simTimeSchema.parse('0')).used).toBe(0)
      await h.connection.ensureResident(second, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [h.director] })
      await h.propose(second, 'second-actor-first', { ...request.proposal, businessKey: 'second-actor' }, { kind: 'goal' })
      expect(worldRequestBudget(h.run.snapshot(), second, simTimeSchema.parse('0')).used).toBe(1)
      expect(worldRequestBudget(h.run.snapshot(), h.requester, simTimeSchema.parse('0')).used).toBe(1)
      await h.run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'cancel-first', requestId: request.id }))
      const cancelled = h.run.snapshot().world!
      await h.propose(h.requester, 'same-business-after-cancel', request.proposal, { kind: 'request', intentId: request.intentId })
      expect(h.run.snapshot().world).toEqual(cancelled)
      expect(worldRequestBudget(h.run.snapshot(), h.requester, simTimeSchema.parse('0')).used).toBe(1)
      await expect(h.propose(h.requester, 'third-new-id', { ...request.proposal, businessKey: 'third-new-id' }, { kind: 'goal' }))
        .rejects.toMatchObject(quotaFailure)
      expect(h.run.snapshot().world).toEqual(cancelled)
      await h.connection.cancelDecision(h.requester, simulationDecisionIdSchema.parse('third-new-id'))
      const state = h.run.snapshot()
      expect(() => { assertWorldRequestBudgetProjection({ ...state, world: { ...state.world!, definition: {
        ...state.world!.definition, limits: { ...state.world!.definition.limits,
          maxRequestsPerActorPerInterval: 0 } } } }) }).toThrow(/exceed/)
      await h.connection.close(); await h.run.close()
      const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.snapshot().world).toEqual(state.world)
        for (const actor of [h.requester, second]) expect(worldRequestBudget(reopened.snapshot(), actor, simTimeSchema.parse('0')).used).toBe(1)
        expect(h.requests).toHaveLength(0)
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('uses exact simulated boundaries and preserves the independent historical ceiling across periods', async () => {
    const h = await hiringResourceHarness(backend, 'hire-existing', { actorRequests: 1, requestHistory: 2 })
    try {
      const plan = await h.plan('period-zero'), original = h.run.snapshot().world!.requests[plan.requestId]!
      const at = async (time: string) => {
        const wake = simulationWakeRequestSchema.parse({ id: `boundary-${time}`,
          entityId: h.requester, time, reason: 'Explicit simulation budget boundary' })
        await h.run.scheduleWake(wake, h.run.snapshot().revision)
        await h.run.drive({ until: simTimeSchema.parse(time) })
        expect(h.run.snapshot().time).toBe(time)
        return wake.id
      }
      const beforeBoundary = await at('99')
      await expect(h.propose(h.requester, 'before-boundary', { ...original.proposal, businessKey: 'before-boundary' },
        { kind: 'goal' }, beforeBoundary)).rejects.toMatchObject(quotaFailure)
      await h.connection.cancelDecision(h.requester, simulationDecisionIdSchema.parse('before-boundary'))
      const pending = h.run.snapshot().wakes[beforeBoundary]
      if (pending?.status === 'pending') await h.propose(h.requester, 'finish-boundary-99', undefined, undefined, beforeBoundary)
      const boundary = await at('100')
      expect(worldRequestBudget(h.run.snapshot(), h.requester, simTimeSchema.parse('100'))).toMatchObject({ used: 0, interval: '100' })
      await h.propose(h.requester, 'period-one', { ...original.proposal, businessKey: 'period-one' }, { kind: 'goal' }, boundary)
      expect(worldRequestBudget(h.run.snapshot(), h.requester, simTimeSchema.parse('100')).used).toBe(1)
      expect(worldRequestBudget(h.run.snapshot(), h.requester, simTimeSchema.parse('0')).used).toBe(1)
      const nextRequest = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === 'period-one')!
      if (nextRequest.notificationOperationId === null) throw new Error('Ordinary request requires its private notification')
      await h.run.drive({ until: simTimeSchema.parse('100') })
      await h.connection.dispatchOperation(nextRequest.notificationOperationId, () => Date.now())
      const notification = await h.connection.receiveOperation(nextRequest.notificationOperationId)
      await h.run.drive({ until: simTimeSchema.parse('100') })
      await h.propose(h.director, 'read-period-one', undefined, undefined, notification)
      // Actual delivery is consumed without a plan; the accepted request remains charged across future periods.
      const next = await at('200')
      expect(worldRequestBudget(h.run.snapshot(), h.requester, simTimeSchema.parse('200')).used).toBe(0)
      const before = h.run.snapshot().world
      await expect(h.propose(h.requester, 'history-exhausted', { ...original.proposal, businessKey: 'period-two' }, { kind: 'goal' }, next))
        .rejects.toThrow(/history limit/)
      expect(h.run.snapshot().world).toEqual(before)
      await h.connection.cancelDecision(h.requester, simulationDecisionIdSchema.parse('history-exhausted'))
      expect(Object.keys(h.run.snapshot().world!.requests)).toHaveLength(2)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})
