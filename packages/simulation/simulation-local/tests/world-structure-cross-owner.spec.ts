/** Real accepted hiring plans share structural capacity across generated identities and existing-person financial holds. */
import { describe, expect, it } from 'vitest'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { pendingWorldMutations } from '../src/world-structure-budget.ts'

const occupied = { code: 'SIM_WORLD_LIMIT', failure: { code: 'SIM_WORLD_LIMIT', limit: 'mutations' } }
describe.each(['json', 'sqlite'] as const)('%s structural cross-owner admission', (backend) => {
  it.each(['generate-and-hire', 'hire-existing'] as const)('%s cannot allocate while the other hiring owner retains its actual reservation', async (blockedMode) => {
    const ownerMode = blockedMode === 'generate-and-hire' ? 'hire-existing' : 'generate-and-hire'
    const h = await hiringResourceHarness(backend, ownerMode, { dualHiring: true, capacity: 4, quantity: '1' })
    try {
      const first = await h.plan('occupied-owner', ownerMode)
      const original = await h.reserve(first)
      expect(original).toBeDefined()
      const ownerId = h.run.snapshot().world!.requests[first.requestId]!.intentId
      expect([...pendingWorldMutations(h.run.snapshot())]).toEqual([ownerId])
      // The competing plan consumes the actual held state, so a stale-read rejection cannot stand in for capacity enforcement.
      const competing = await h.plan('different-owner', blockedMode)
      const before = h.run.snapshot()
      const reserve = () => blockedMode === 'generate-and-hire'
        ? h.run.reserveWorldHire(h.generatedRequest(competing)) : h.run.reserveExistingHireResources(competing.id)
      await expect(reserve()).rejects.toMatchObject(occupied)
      expect(h.run.snapshot()).toEqual(before)
      expect(await h.reserve(first)).toEqual(original)
      expect(h.run.snapshot()).toEqual(before)
      expect([...pendingWorldMutations(before)]).toEqual([ownerId])
      expect(Object.values(before.resourceReservations).filter(value => value.phase === 'active')).toHaveLength(1)
      expect(Object.keys(before.world!.results)).toHaveLength(0)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})
