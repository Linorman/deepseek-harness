import { describe, expect, it } from 'vitest'
import { activationReservationIdSchema } from '@clocky/clocky-team'
import { simulationChangeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s population limits', (backend) => {
  it('counts inactive entities and frees only irreversible termination', async () => {
    const h = await createBusinessHarness(backend, { maxEntities: 1 })
    try {
      const id = simulationEntityIdSchema.parse('a')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'none', profile: {} }), h.run.snapshot().revision)
      const create = () => h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'b', entityKind: 'person', cognition: 'none', profile: {} }), h.run.snapshot().revision)
      await expect(create()).rejects.toThrow(/entity capacity/)
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id, entityRevision: h.run.snapshot().entities[id]!.revision, phase: 'inactive' }), h.run.snapshot().revision)
      await expect(create()).rejects.toThrow(/entity capacity/)
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id, entityRevision: h.run.snapshot().entities[id]!.revision, phase: 'terminated' }), h.run.snapshot().revision)
      await create()
      expect(h.run.population()).toEqual({ entities: 1, chargedActors: 0 })
      expect(Object.keys(h.run.snapshot().entities)).toHaveLength(2)
    } finally { await h.close() }
  })

  it('charges reservations and revoked writers until release', async () => {
    const h = await createBusinessHarness(backend, { maxResidentActors: 1 })
    try {
      const a = await h.actor('a')
      await expect(h.actor('b')).rejects.toThrow(/resident actor capacity/)
      const b = simulationEntityIdSchema.parse('b')
      const reserve = () => h.run.reserveWriter(b, 'local', activationReservationIdSchema.parse('b-next'), h.run.snapshot().revision)
      expect(h.run.population()).toEqual({ entities: 2, chargedActors: 1 })
      await a.lease.revoke()
      await expect(reserve()).rejects.toThrow(/resident actor capacity/)
      expect(h.run.population().chargedActors).toBe(1)
      await a.lease.release()
      const next = await reserve()
      h.leases.push(next)
      expect(h.run.snapshot().entities[b]?.writer?.phase).toBe('reserved')
      expect(h.run.population().chargedActors).toBe(1)
      await next.revoke()
      expect(h.run.population().chargedActors).toBe(1)
      await next.release()
      expect(h.run.population().chargedActors).toBe(0)
    } finally { await h.close() }
  })
})
