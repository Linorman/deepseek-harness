import { describe, expect, it } from 'vitest'
import { simulationDecisionIdSchema, simulationPolicyRefSchema, simulationProposalSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contextRequest } from './context-fixture.ts'

const policy = simulationPolicyRefSchema.parse({ id: 'ledger', version: '1' })
describe.each(['json', 'sqlite'] as const)('%s deterministic decision records', (backend) => {
  it('freezes policy/output, forbids inference and applies the ordinary resource authority checks', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a'); const b = await h.actor('b')
      await h.account('stock', b.id, '1')
      await h.account('target', a.id, '0')
      const id = simulationDecisionIdSchema.parse('ledger')
      await a.lease.openDecision(id, h.run.snapshot().revision)
      await a.lease.prepareContext(id, contextRequest())
      await a.lease.selectDeterministicPolicy(id, policy)
      await expect(a.lease.startDecision(id, 0)).rejects.toThrow(/inference cannot start/)
      await expect(a.lease.selectDeterministicPolicy(id, { ...policy, version: '2' })).rejects.toThrow(/policy changed/)
      const proposals = [simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [],
        transaction: { commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'target', revision: 1 }],
          transfers: [{ from: 'stock', to: 'target', quantity: '1' }] },
      } })]
      await expect(a.lease.submitDecision(id, proposals)).rejects.toThrow(/recorded output/)
      const result = await a.lease.recordDeterministicResult(id, proposals)
      expect(await a.lease.recordDeterministicResult(id, proposals)).toEqual(result)
      await expect(a.lease.recordDeterministicResult(id, [])).rejects.toThrow(/output changed/)
      await expect(a.lease.submitDecision(id, [])).rejects.toThrow(/recorded output/)
      const accepted = await a.lease.submitDecision(id, proposals)
      const outcome = await h.run.executeOperation(accepted.operationIds[0]!)
      expect(outcome.status).toBe('blocked-authority')
      expect(Object.values(h.run.snapshot().resources).map(resource => resource.quantity)).toEqual(['1', '0'])
      expect(h.run.budgetUsage().tokens.used).toBe(0)
      expect(h.run.snapshot().decisions[id]?.inference).toBeUndefined()
    } finally { await h.close() }
  })
})
