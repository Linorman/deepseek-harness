import { describe, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationBudgetGrantRequestSchema, simulationCompactionTokenRequestSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

const request = { provider: 'fixture', model: 'scripted', sessionSequence: 1 }
describe.each(['json', 'sqlite'] as const)('%s model token reservations', (backend) => {
  it('charges each attempt, retains unknown usage and settles after writer revocation', async () => {
    const h = await createBusinessHarness(backend, { tokensPerModelRequest: 100, maxTokensPerInterval: 200 })
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      const id = simulationDecisionIdSchema.parse('decision')
      await a.lease.openDecision(id, h.run.snapshot().revision)
      await a.lease.prepareContext(id, contextRequest()); await a.lease.startDecision(id, 0)
      const first = await a.lease.reserveModelTokens(id, request)
      const second = await a.lease.reserveModelTokens(id, request)
      expect(first.id).not.toBe(second.id)
      expect(h.run.budgetUsage().tokens).toEqual({ used: 200, limit: 200 })
      await expect(h.run.reconcileTokenUsage(first.id, { inputTokens: 10, outputTokens: 5 })).rejects.toThrow(/live token/)
      await expect(b.lease.settleModelTokens(first.id, { kind: 'unknown' })).rejects.toThrow(/another writer/)
      await a.lease.settleModelTokens(first.id, { kind: 'unknown' })
      expect(h.run.budgetUsage().tokens.used).toBe(200)
      await expect(a.lease.reserveModelTokens(id, request)).rejects.toThrow(/tokens interval budget/)
      await a.lease.revoke()
      await a.lease.settleModelTokens(second.id, { kind: 'complete', usage: { inputTokens: 10, outputTokens: 20 } })
      expect(h.run.budgetUsage().tokens.used).toBe(130)
      const usage = { inputTokens: 5, outputTokens: 5 }
      await h.run.reconcileTokenUsage(first.id, usage)
      await h.run.reconcileTokenUsage(first.id, usage)
      expect(h.run.budgetUsage().tokens.used).toBe(40)
      await expect(h.run.reconcileTokenUsage(first.id, { inputTokens: 6, outputTokens: 5 })).rejects.toThrow(/changed its usage/)
      await h.run.setPhase('running', h.run.snapshot().revision)
    } finally { await h.close() }
  })

  it('preserves auxiliary reservations without world decisions through restart and reconciliation', async () => {
    const h = await createBusinessHarness(backend, { tokensPerModelRequest: 100 })
    try {
      const a = await h.actor('a')
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const reservation = await a.lease.reserveCompactionTokens(simulationCompactionTokenRequestSchema.parse({
        ...request, compactionId: 'compact-idle',
      }))
      expect(reservation.decisionId).toBeUndefined()
      expect(reservation.compactionId).toBe('compact-idle')
      expect(h.run.budgetUsage().tokens.used).toBe(100)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.snapshot().tokenReservations?.[reservation.id]).toEqual(reservation)
        expect(reopened.budgetUsage().tokens.used).toBe(100)
        await reopened.reconcileTokenUsage(reservation.id, { inputTokens: 10, outputTokens: 20 })
        expect(reopened.budgetUsage().tokens.used).toBe(30)
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('retains abandoned reservations across restart until explicit provider reconciliation', async () => {
    const h = await createBusinessHarness(backend, { tokensPerModelRequest: 100 })
    try {
      const a = await h.actor('a')
      const id = simulationDecisionIdSchema.parse('decision')
      await a.lease.openDecision(id, h.run.snapshot().revision)
      await a.lease.prepareContext(id, contextRequest()); await a.lease.startDecision(id, 0)
      const reservation = await a.lease.reserveModelTokens(id, request)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.budgetUsage().tokens.used).toBe(100)
        expect(reopened.snapshot().tokenReservations?.[reservation.id]?.status).toBe('reserved')
        await reopened.reconcileTokenUsage(reservation.id, { inputTokens: 10, outputTokens: 20 })
        expect(reopened.budgetUsage().tokens.used).toBe(30)
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('retains at least observed cached usage when a stream stops before its terminal finish', async () => {
    const h = await createBusinessHarness(backend, { tokensPerModelRequest: 100, maxTokensPerInterval: 200 })
    try {
      const a = await h.actor('a')
      const id = simulationDecisionIdSchema.parse('decision')
      await a.lease.openDecision(id, h.run.snapshot().revision)
      await a.lease.prepareContext(id, contextRequest()); await a.lease.startDecision(id, 0)
      const reservation = await a.lease.reserveModelTokens(id, request)
      const observed = { inputTokens: 90, outputTokens: 0, cacheReadTokens: 30, cacheWriteTokens: 10 }
      await a.lease.settleModelTokens(reservation.id, { kind: 'unknown', observedUsage: observed })
      expect(h.run.snapshot().tokenReservations?.[reservation.id]).toMatchObject({ status: 'unknown', observedUsage: observed })
      expect(h.run.budgetUsage().tokens.used).toBe(130)
      expect(h.run.snapshot().stall?.code).toBe('SIM_TOKEN_RESERVATION_EXCEEDED')
      await h.run.reconcileTokenUsage(reservation.id, { ...observed, outputTokens: 10 })
      expect(h.run.budgetUsage().tokens.used).toBe(140)
    } finally { await h.close() }
  })

  it('records actual overruns and requires acknowledgement plus sufficient interval capacity', async () => {
    const h = await createBusinessHarness(backend, { tokensPerModelRequest: 100, maxTokensPerInterval: 100 })
    try {
      const a = await h.actor('a')
      const id = simulationDecisionIdSchema.parse('decision')
      await a.lease.openDecision(id, h.run.snapshot().revision)
      await a.lease.prepareContext(id, contextRequest()); await a.lease.startDecision(id, 0)
      const reservation = await a.lease.reserveModelTokens(id, request)
      await a.lease.settleModelTokens(reservation.id, { kind: 'complete', usage: { inputTokens: 90, outputTokens: 30 } })
      expect(h.run.snapshot().stall).toMatchObject({ code: 'SIM_TOKEN_RESERVATION_EXCEEDED', reservationId: reservation.id })
      expect(h.run.budgetUsage().tokens.used).toBe(120)
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/acknowledgement/)
      await h.run.acknowledgeTokenOverrun(reservation.id, h.run.snapshot().revision)
      expect(await h.run.acknowledgeTokenOverrun(reservation.id, 0)).toEqual(h.run.snapshot())
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/additional interval budget/)
      await h.run.extendBudget(simulationBudgetGrantRequestSchema.parse({ id: 'cover', interval: '0', budget: 'tokens',
        amount: 20, reason: 'Cover reported usage' }), h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision)
      expect(h.run.budgetUsage().tokens).toEqual({ used: 120, limit: 120 })
    } finally { await h.close() }
  })
})
