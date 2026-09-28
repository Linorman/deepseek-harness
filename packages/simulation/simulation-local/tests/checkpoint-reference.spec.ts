import { describe, expect, it } from 'vitest'
import { createBusinessHarness } from './business-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s run checkpoint references', (backend) => {
  it('captures only the observed cursor and retains its state hash after replay', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const first = await h.run.getPersistenceReference(h.run.snapshot().revision)
      expect(first.backend).toBe(backend)
      expect(first.firstSequence).toBe(0)
      expect(first.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      await expect(h.run.getPersistenceReference(first.cursor)).rejects.toThrow(/revision conflict/)
      const paused = await h.run.getPersistenceReference(h.run.snapshot().revision)
      expect(paused.fingerprint).not.toBe(first.fingerprint)
      expect(paused.stream).toEqual(first.stream)
      await h.run.close()
      const restored = await h.provider.open({ ...h.selection, mode: 'open' })
      try { expect(await restored.getPersistenceReference(paused.cursor)).toEqual(paused) }
      finally { await restored.close() }
    } finally { await h.close() }
  })
})
