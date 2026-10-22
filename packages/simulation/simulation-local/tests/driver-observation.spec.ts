/** Native replay preserves safe failure identity while stale owner callbacks cannot clear a newer batch. */
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { createBusinessHarness } from './business-harness.ts'
import { LocalSimulationProvider } from '../src/index.ts'

it.each(['json', 'sqlite'] as const)('persists exact batch failures and rejects stale callbacks (%s)', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const initialPhase = h.run.snapshot().phase
    const ownerId = randomUUID(), batchId = randomUUID(), occurredAt = Date.now()
    const revision = await h.run.recordDriverObservation({ status: 'advancing', ownerId, batchId, observedAt: occurredAt })
    const failure = { failureId: randomUUID(), ownerId, batchId, occurredAt, revision,
      category: 'payment-required' as const, retryDisposition: 'account-action' as const, actionCode: 'check-account' as const }
    await h.run.recordDriverObservation({ status: 'failed', ownerId, batchId, observedAt: occurredAt, failure })
    const state = h.run.snapshot()
    expect(state.phase).toBe(initialPhase)
    expect(state.driverObservation).toMatchObject({ status: 'failed', failure })
    await h.run.close()
    const provider = new LocalSimulationProvider({ name: 'local', root: h.root, backend, replayPageSize: 1 }, () => {})
    try {
      const cold = await provider.open({ ...h.selection, mode: 'open' })
      expect(cold.snapshot().driverObservation).toEqual(state.driverObservation)
      const next = { ownerId: randomUUID(), batchId: randomUUID(), observedAt: Date.now() }
      await cold.recordDriverObservation({ ...next, status: 'advancing' })
      await expect(cold.recordDriverObservation({ ownerId, batchId, observedAt: Date.now(), status: 'settled' }))
        .rejects.toThrow('matching active owner batch')
      expect(cold.snapshot().driverObservation).toMatchObject({ ...next, status: 'advancing' })
      await cold.recordDriverObservation({ ...next, status: 'settled' })
      expect(cold.snapshot().driverObservation).toMatchObject({ status: 'settled' })
      expect(() => cold.recordDriverObservation({ ...next, status: 'failed', failure: { ...failure, batchId: next.batchId } }))
        .toThrow('another owner batch')
      await cold.close()
    } finally { await provider.close() }
  } finally { await h.close() }
})

it('reads detached control facts without requesting a detached full snapshot', async () => {
  const h = await createBusinessHarness('json')
  try {
    const ownerId = randomUUID(), batchId = randomUUID()
    await h.run.recordDriverObservation({ ownerId, batchId, observedAt: Date.now(), status: 'advancing' })
    const snapshot = vi.spyOn(h.run, 'snapshot').mockImplementation(() => { throw new Error('Full history copy is unavailable') })
    const observed = h.run.controlObservation()
    expect(observed).toMatchObject({ phase: 'running', activeDecisions: 0, checkpointInProgress: false,
      driverObservation: { ownerId, batchId } })
    expect(snapshot).not.toHaveBeenCalled()
    expect(observed).not.toHaveProperty('decisions')
    expect(observed).not.toHaveProperty('world')
    Object.assign(observed.driverObservation!, { status: 'failed' })
    expect(h.run.controlObservation().driverObservation?.status).toBe('advancing')
    snapshot.mockRestore()
  } finally { await h.close() }
})
