/** Real Native mutations between the original financial reserve and either hiring owner's commit. */
import { describe, expect, it } from 'vitest'
import { simulationChangeSchema, simulationResourceIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { hiringResourceReservationId } from '../src/world-hiring-resources.ts'
import { resourceAvailable } from '../src/resource-ledger.ts'
import { worldPositionUsage } from '../src/world-hire.ts'

describe.each(['json', 'sqlite'] as const)('%s original hiring payment plan', (backend) => {
  describe.each(['generate-and-hire', 'hire-existing'] as const)('%s', (mode) => {
    it('expires the retained financial hold at its original simulated deadline before identity IO', async () => {
      const h = await hiringResourceHarness(backend, mode, { period: '2' })
      try {
        const plan = await h.plan()
        await h.reserve(plan)
        const reserved = h.run.snapshot(), id = hiringResourceReservationId(plan.id)
        await h.run.drive({ until: simTimeSchema.parse('2') })
        const expired = h.run.snapshot(), hold = expired.resourceReservations[id]!
        expect(hold).toMatchObject({ phase: 'expired', expiresAt: '2', settlement: { kind: 'expiry', time: '2' } })
        expect(hold.world).toEqual(reserved.resourceReservations[id]!.world)
        expect(expired.resources).toEqual(reserved.resources)
        expect(resourceAvailable(expired, simulationResourceIdSchema.parse('fee-cash'))).toBe(10n)
        if (mode === 'generate-and-hire') {
          const reservation = Object.values(expired.world!.reservations)[0]
          if (reservation === undefined) throw new Error('Original generated reservation is missing')
          expect(reservation.status).toBe('reserved')
          await expect(h.run.prepareWorldHire(reservation.id)).rejects.toThrow()
          expect(h.run.snapshot().entities[reservation.identities.entityId]).toBeUndefined()
        } else {
          await expect(h.run.commitWorldMutation({ planId: plan.id,
            payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} }))
            .rejects.toMatchObject({ resourceFailure: 'expired' })
        }
        expect(h.run.snapshot().resourceReservations[id]).toEqual(hold)
        expect(h.requests).toHaveLength(0)
      } finally { await h.close() }
    })
    it.each(['resources', 'authority', 'future-position'] as const)('rejects a changed %s without replacing its frozen plan or releasing its hold', async (change) => {
      const h = await hiringResourceHarness(backend, mode, { capacity: 2 })
      try {
        const plan = await h.plan()
        await h.reserve(plan)
        const hold = h.run.snapshot().resourceReservations[hiringResourceReservationId(plan.id)]!
        if (change === 'resources') {
          await h.propose(h.requester, 'independent-spend', { kind: 'resource/transfer', grants: [],
            transaction: { commitmentId: null, reads: ['fee-cash', 'fee-payee'].map(resourceId => ({ resourceId, revision: 1 })),
              transfers: [{ from: 'fee-cash', to: 'fee-payee', quantity: '1' }] } })
        } else if (change === 'authority') {
          const permission = Object.values(h.run.snapshot().relations).find(value => value.relation === 'can-hire')
          if (permission === undefined) throw new Error('Actual original permission is missing')
          await h.run.change(simulationChangeSchema.parse({ kind: 'relation/update', id: permission.id,
            relationRevision: permission.revision, subject: permission.subject, relation: permission.relation,
            object: 'fee-role', scope: permission.scope, validFrom: permission.validFrom, validUntil: permission.validUntil }),
          h.run.snapshot().revision)
        } else {
          await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'future-occupant',
            subject: h.candidate, relation: 'assignment', object: 'fee-vacancy', scope: 'fee-org',
            validFrom: '5', validUntil: null }), h.run.snapshot().revision)
          expect(h.run.snapshot().time).toBe('0')
          // The promise occupies the future peak together with this original uncommitted hire.
          expect(worldPositionUsage(h.run.snapshot(), 'fee-vacancy')).toBe(2)
          const full = h.run.snapshot()
          await expect(h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'future-overflow',
            subject: h.director, relation: 'assignment', object: 'fee-vacancy', scope: 'fee-org',
            validFrom: '6', validUntil: null }), full.revision)).rejects.toThrow(/capacity/)
          expect(h.run.snapshot()).toEqual(full)
        }
        const before = h.run.snapshot()
        const reservation = Object.values(before.world!.reservations)[0]
        if (mode === 'generate-and-hire') {
          if (reservation === undefined) throw new Error('Actual original identity reservation is missing')
          await expect(h.run.commitWorldHire(reservation.id)).rejects.toThrow(/stale/)
        } else {
          await expect(h.run.commitWorldMutation({ planId: plan.id,
            payload: plan.proposal.resolution.kind === 'apply' ? plan.proposal.resolution.payload : {} })).rejects.toThrow(/stale/)
        }
        const after = h.run.snapshot(), retained = after.world!.plans[plan.id]!
        expect(retained).toMatchObject({ status: 'stale', proposal: plan.proposal, reads: plan.reads, hash: plan.hash })
        expect(after.world!.requests[plan.requestId]!.plans).toEqual([plan.id])
        expect(after.resourceReservations[hold.id]).toEqual(hold)
        expect(after.resources).toEqual(before.resources)
        expect(after.entities).toEqual(before.entities)
        expect(after.relations).toEqual(before.relations)
        expect(resourceAvailable(after, simulationResourceIdSchema.parse('fee-cash'))).toBe(change === 'resources' ? 3n : 4n)
        expect(h.requests).toHaveLength(0)
      } finally { await h.close() }
    })
  })
})
