import { describe, expect, it, vi } from 'vitest'
import { simulationChangeSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { createBusinessHarness } from './business-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s administrative batches', (backend) => {
  it('hands off a temporal role atomically and rejects an invalid or stale batch without partial changes', async () => {
    const h = await createBusinessHarness(backend, { relationRules: [
      { relation: 'manager', subjectKinds: ['org'], objectKinds: ['person'], acyclic: true },
    ] })
    try {
      const old = await h.actor('old'); const next = await h.actor('next')
      await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'department', entityKind: 'org',
        cognition: 'none', profile: {} }), h.run.snapshot().revision)
      await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'old-role', relation: 'manager',
        subject: 'department', object: old.id, validFrom: '0', validUntil: null }), h.run.snapshot().revision)
      const before = h.run.snapshot()
      const ending = simulationChangeSchema.parse({ kind: 'relation/update', id: 'old-role', relation: 'manager',
        subject: 'department', object: old.id, validFrom: '0', validUntil: '5', relationRevision: 1 })
      const starting = simulationChangeSchema.parse({ kind: 'relation/create', id: 'new-role', relation: 'manager',
        subject: 'department', object: next.id, validFrom: '5', validUntil: null })
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const append = vi.spyOn(stream, 'append')
      expect(() => h.run.changeMany([], before.revision)).toThrow()
      await expect(h.run.changeMany([ending, simulationChangeSchema.parse({ ...starting, object: 'missing' })], before.revision))
        .rejects.toThrow()
      expect(h.run.snapshot()).toEqual(before)
      expect(append).not.toHaveBeenCalled()
      append.mockRejectedValueOnce(new Error('append failed'))
      await expect(h.run.changeMany([ending, starting], before.revision)).rejects.toThrow('append failed')
      expect(h.run.snapshot()).toEqual(before)
      await h.run.changeMany([ending, starting], before.revision)
      expect(append.mock.calls.at(-1)?.[1]).toHaveLength(2)
      expect(h.run.snapshot().revision).toBe(before.revision + 2)
      expect(h.run.relationsAt(simTimeSchema.parse('4')).map(value => value.object)).toEqual([old.id])
      expect(h.run.relationsAt(simTimeSchema.parse('5')).map(value => value.object)).toEqual([next.id])
      await expect(h.run.changeMany([ending, starting], before.revision)).rejects.toThrow(/revision conflict/)
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const reopened = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(reopened.relationsAt(simTimeSchema.parse('4')).map(value => value.object)).toEqual([old.id])
        expect(reopened.relationsAt(simTimeSchema.parse('5')).map(value => value.object)).toEqual([next.id])
      } finally { await reopened.close() }
    } finally { await h.close() }
  })
})
