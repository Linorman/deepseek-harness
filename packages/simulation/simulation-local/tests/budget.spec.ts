import { describe, expect, it } from 'vitest'
import { simulationBudgetGrantRequestSchema, simulationDecisionIdSchema, simulationProposalSchema,
  simulationWindowRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

const id = simulationDecisionIdSchema.parse.bind(simulationDecisionIdSchema)
const grant = (key: string, budget: 'decisions' | 'messages', amount: number) =>
  simulationBudgetGrantRequestSchema.parse({ id: key, interval: '0', budget, amount, reason: 'Approved additional work' })

describe.each(['json', 'sqlite'] as const)('%s interval budgets', (backend) => {
  it('retains cancelled decision charges and exhaustion through restart without duplicating an addition', async () => {
    const h = await createBusinessHarness(backend, { maxDecisionsPerInterval: 1, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '10' })
    try {
      const a = await h.actor('a')
      await a.lease.openDecision(id('first'), h.run.snapshot().revision)
      await a.lease.cancelDecision(id('first'))
      await expect(a.lease.openDecision(id('second'), h.run.snapshot().revision)).rejects.toThrow(/decisions interval budget/)
      expect(h.run.snapshot().stall).toMatchObject({ code: 'SIM_BUDGET_LIMIT', budget: 'decisions', used: 1, limit: 1, requested: 1 })
      expect(h.run.snapshot().decisions[id('second')]).toBeUndefined()
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        await expect(reopened.setPhase('running', reopened.snapshot().revision)).rejects.toThrow(/explicit addition/)
        const request = grant('allow-one', 'decisions', 1)
        await reopened.extendBudget(request, reopened.snapshot().revision)
        await reopened.extendBudget(request, 0)
        await expect(reopened.extendBudget({ ...request, amount: 2 }, 0)).rejects.toThrow(/changed its payload/)
        expect(reopened.budgetUsage().decisions).toEqual({ used: 1, limit: 2 })
        expect(reopened.snapshot().phase).toBe('stalled')
        await reopened.setPhase('running', reopened.snapshot().revision)
        await reopened.drive({ until: simTimeSchema.parse('10') })
        expect(reopened.budgetUsage()).toMatchObject({ interval: '10', decisions: { used: 0, limit: 1 } })
      } finally { await reopened.close() }
    } finally { await h.close() }
  })

  it('rejects an entire oversized window before charging or opening any slot', async () => {
    const h = await createBusinessHarness(backend, { maxDecisionsPerInterval: 1 })
    try {
      const actors = [await h.actor('a'), await h.actor('b')]
      const request = simulationWindowRequestSchema.parse({ id: 'window', decisions: actors.map(actor => ({
        id: actor.id, entityId: actor.id, context: contextRequest(),
      })) })
      await expect(h.run.openWindow(request, h.run.snapshot().revision)).rejects.toThrow(/decisions interval budget/)
      expect(h.run.budgetUsage().decisions.used).toBe(0)
      expect(h.run.snapshot().decisions).toEqual({})
      await h.run.extendBudget(grant('window-extra', 'decisions', 1), h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision)
      await h.run.openWindow(request, h.run.snapshot().revision)
      expect(h.run.budgetUsage().decisions.used).toBe(2)
    } finally { await h.close() }
  })

  it('continues ordered window acceptance after a later slot exhausts message capacity', async () => {
    const h = await createBusinessHarness(backend, { maxMessagesPerInterval: 1 })
    try {
      const actors = [await h.actor('a'), await h.actor('b')]
      const request = simulationWindowRequestSchema.parse({ id: 'messages', decisions: actors.map(actor => ({
        id: actor.id, entityId: actor.id, context: contextRequest(),
      })) })
      await h.run.openWindow(request, h.run.snapshot().revision)
      for (const [index, actor] of actors.entries()) await actor.lease.submitDecision(id(actor.id), [simulationProposalSchema.parse({
        after: [], action: { kind: 'communication/post', recipient: actors[1 - index]!.id,
          channelId: 'channel', text: actor.id, deliverAt: '5' },
      })])
      await expect(h.run.commitWindow(request.id)).rejects.toThrow(/messages interval budget/)
      expect(Object.values(h.run.snapshot().decisions).map(decision => decision.status)).toEqual(['accepted', 'submitted'])
      expect(h.run.budgetUsage().messages).toEqual({ used: 1, limit: 1 })
      await h.run.extendBudget(grant('second-slot', 'messages', 1), h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision)
      expect((await h.run.commitWindow(request.id)).status).toBe('closed')
      expect((await h.run.commitWindow(request.id)).status).toBe('closed')
      expect(h.run.budgetUsage().messages).toEqual({ used: 2, limit: 2 })
    } finally { await h.close() }
  })

  it('rejects a whole message proposal and charges accepted intents once despite retries', async () => {
    const h = await createBusinessHarness(backend, { maxMessagesPerInterval: 1 })
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      const decision = id('post')
      await a.lease.openDecision(decision, h.run.snapshot().revision)
      const proposals = [0, 1].map(index => simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post',
        recipient: b.id, channelId: 'channel', text: `Message ${index}`, deliverAt: '5',
      } }))
      await expect(a.lease.submitDecision(decision, proposals)).rejects.toThrow(/messages interval budget/)
      expect(h.run.snapshot().decisions[decision]?.status).toBe('open')
      expect(h.run.snapshot().operations).toEqual({})
      expect(h.run.budgetUsage().messages.used).toBe(0)
      await h.run.extendBudget(grant('message-extra', 'messages', 1), h.run.snapshot().revision)
      await h.run.setPhase('running', h.run.snapshot().revision)
      const accepted = await a.lease.submitDecision(decision, proposals)
      expect(await a.lease.submitDecision(decision, proposals)).toEqual(accepted)
      expect(h.run.budgetUsage().messages).toEqual({ used: 2, limit: 2 })
      expect(h.run.budgetUsage().decisions.used).toBe(1)
      await expect(h.run.extendBudget({ ...grant('bad-interval', 'messages', 1), interval: simTimeSchema.parse('1') },
        h.run.snapshot().revision)).rejects.toThrow(/interval/)
    } finally { await h.close() }
  })
})
