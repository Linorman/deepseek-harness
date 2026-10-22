/** Reserved payment is evidence only after the original Native commit, with all effects rolled back on refusal. */
import { describe, expect, it } from 'vitest'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { contractBelongsToSubject } from '../src/world-external-mediated.ts'

describe.each(['json', 'sqlite'] as const)('%s reserved interaction evidence', (backend) => {
  it.each([false, true])('preserves the original obligation across payment (cancel first: %s)', async (cancelFirst) => {
    const h = await createBusinessHarness(backend)
    try {
      const buyer = await h.actor('buyer'), seller = await h.actor('seller')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: 'external',
        entityKind: 'organization', cognition: 'none', profile: {} }), h.run.snapshot().revision)
      const external = Object.values(h.run.snapshot().entities).find(value => value.id === 'external')!
      await h.account('stock', external.id, '10', [seller.id])
      await h.account('received', buyer.id, '0')
      expect((await h.apply(buyer.lease, 'request', { kind: 'interaction/request', id: 'order', assignee: seller.id,
        description: 'Deliver two original units', replyBy: '10', completeBy: '20',
        fulfillment: { kind: 'transfer', from: 'stock', to: 'received', quantity: '2' } })).status).toBe('applied')
      await h.apply(seller.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
      const commitment = Object.values(h.run.snapshot().commitments)[0]!
      await h.apply(seller.lease, 'reserve', { kind: 'resource/reserve', id: 'delivery-hold', expiresAt: '5', grants: [],
        transaction: { commitmentId: commitment.id, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
          transfers: [{ from: 'stock', to: 'received', quantity: '2' }] } })
      expect(h.run.snapshot().commitments[commitment.id]!.evidence).toEqual([])
      expect(h.run.snapshot().commitments[commitment.id]!.phase).toBe('open')
      if (cancelFirst) await h.apply(buyer.lease, 'cancel-order', { kind: 'interaction/cancel', id: 'order',
        expectedRevision: 2, reason: 'Withdraw the original order' })
      const before = h.run.snapshot()
      const payment = await h.apply(seller.lease, 'pay', { kind: 'resource/commit-reservation', id: 'delivery-hold', expectedRevision: 1 })
      const after = h.run.snapshot(), hold = Object.values(after.resourceReservations)[0]!
      if (cancelFirst) {
        expect(payment).toMatchObject({ status: 'rejected', code: 'SIM_COMMITMENT_CLOSED' })
        expect(after.resources).toEqual(before.resources)
        expect(after.resourceReservations).toEqual(before.resourceReservations)
        expect(after.commitments).toEqual(before.commitments)
        expect(hold.phase).toBe('active')
      } else {
        expect(payment.status).toBe('applied')
        expect(hold.phase).toBe('committed')
        expect(after.commitments[commitment.id]).toMatchObject({ phase: 'fulfilled', evidence: [payment.operationId] })
        expect(Object.values(after.resources).map(value => value.quantity)).toEqual(['8', '2'])
        // The external account owner is neither party; association must come from actual committed transfer evidence.
        expect(contractBelongsToSubject(after, commitment.id, external.id)).toBe(true)
        expect(await h.run.executeOperation(payment.operationId)).toEqual(payment)
        expect(h.run.snapshot()).toEqual(after)
      }
    } finally { await h.close() }
  })
})
