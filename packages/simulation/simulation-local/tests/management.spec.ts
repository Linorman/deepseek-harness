import { describe, expect, it, vi } from 'vitest'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationPhaseManagementRequestSchema, simulationDecisionIdSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

const request = (id: string, phase: 'paused' | 'running') => simulationPhaseManagementRequestSchema.parse({ id, phase })

describe.each(['json', 'sqlite'] as const)('%s durable management', (backend) => {
  it('retains terminal results without replaying their phase effect after a later command', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const paused = await h.run.managePhase(request('pause', 'paused'))
      expect(paused.status).toBe('completed')
      expect(h.run.snapshot().phase).toBe('paused')
      const resumed = await h.run.managePhase(request('resume', 'running'))
      expect(resumed.status).toBe('completed')
      const revision = h.run.snapshot().revision
      expect(await h.run.managePhase(request('pause', 'paused'))).toEqual(paused)
      expect(h.run.snapshot().phase).toBe('running')
      expect(h.run.snapshot().revision).toBe(revision)
      await expect(h.run.managePhase(request('pause', 'running'))).rejects.toThrow(/changed its request/)
    } finally { await h.close() }
  })

  it('publishes neither the pause nor its request when the initial batch fails', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const before = h.run.snapshot()
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const failure = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Initial storage failure'))
      await expect(h.run.managePhase(request('pause', 'paused'))).rejects.toThrow(/Initial storage failure/)
      failure.mockRestore()
      expect(h.run.snapshot()).toEqual(before)
      expect((await h.run.managePhase(request('pause', 'paused'))).status).toBe('completed')
      expect(h.run.snapshot().phase).toBe('paused')
    } finally { await h.close() }
  })

  it('recovers an interrupted pause and prevents another phase command from bypassing it', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const append = stream.append.bind(stream)
      const failure = vi.spyOn(stream, 'append').mockImplementation(async (cursor, values, options) => {
        if (JSON.stringify(values).includes('management/completed')) throw new Error('Disk unavailable before terminal batch')
        return await append(cursor, values, options)
      })
      await expect(h.run.managePhase(request('pause', 'paused'))).rejects.toThrow(/Disk unavailable/)
      failure.mockRestore()
      const pending = h.run.snapshot().management?.[request('pause', 'paused').id]
      expect(pending?.status).toBe('in-progress')
      expect(h.run.snapshot().phase).toBe('paused')
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/pending management request/)
      await expect(h.run.managePhase(request('other', 'running'))).rejects.toThrow(/another request is pending/)
      await h.run.close()
      const restored = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(restored.snapshot().management?.[request('pause', 'paused').id]).toEqual(pending)
        const result = await restored.managePhase(request('pause', 'paused'))
        expect(result).toMatchObject({ status: 'completed', startedSequence: pending?.startedSequence })
        expect(restored.snapshot().phase).toBe('paused')
        expect(await restored.managePhase(request('pause', 'paused'))).toEqual(result)
      } finally { await restored.close() }
    } finally { await h.close() }
  })

  it('records a refused resume as a stable failed result instead of clearing its stall', async () => {
    const h = await createBusinessHarness(backend, { maxDecisionsPerInterval: 0 })
    try {
      const actor = await h.actor('a')
      await expect(actor.lease.openDecision(simulationDecisionIdSchema.parse('limited'), h.run.snapshot().revision)).rejects.toThrow(/budget/)
      const stall = h.run.snapshot().stall
      const failed = await h.run.managePhase(request('resume', 'running'))
      expect(failed.status).toBe('failed')
      if (failed.status !== 'failed') throw new Error('fixture resume unexpectedly succeeded')
      expect(failed.error).toMatch(/budget/)
      expect(h.run.snapshot().phase).toBe('stalled')
      expect(h.run.snapshot().stall).toEqual(stall)
      const revision = h.run.snapshot().revision
      expect(await h.run.managePhase(request('resume', 'running'))).toEqual(failed)
      expect(h.run.snapshot().revision).toBe(revision)
    } finally { await h.close() }
  })
})

it('rejects terminal management records without a pending request or matching phase', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const { foldManagement } = await import('../src/management.ts')
    const before = h.run.snapshot(), command = request('pause', 'paused')
    for (const kind of ['management/completed', 'management/failed'] as const) {
      const record = kind === 'management/completed' ? { kind, id: command.id } : { kind, id: command.id, error: 'Failed' }
      expect(() => foldManagement(before, record, before.revision + 1)).toThrow(/no pending request/)
    }
    const pending = foldManagement(before, { kind: 'management/started', request: command }, before.revision + 1)
    expect(() => foldManagement(pending, { kind: 'management/completed', id: command.id }, before.revision + 2)).toThrow(/does not match/)
    const completed = foldManagement({ ...pending, phase: 'paused' }, { kind: 'management/completed', id: command.id }, before.revision + 2)
    expect(() => foldManagement(completed, { kind: 'management/completed', id: command.id }, before.revision + 3)).toThrow(/no pending request/)
    expect(h.run.snapshot()).toEqual(before)
  } finally { await h.close() }
})
