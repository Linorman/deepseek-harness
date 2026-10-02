/** Export requires complete ordered records, one revision and final disclosure validation. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import type { SimulationProductRecordsPage } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, err, deferred } from './fake-api.client.ts'
const runId = 'run' as never
const page: SimulationProductRecordsPage = { runId, mode: 'original', selection: {}, snapshotRevision: 3,
  observedAt: 1, readVersion: 'policy' as never, bodyAccess: 'allowed', totalRecords: 1,
  items: [{ sequence: 2, kind: { text: 'run/change', truncated: false }, body: { status: 'text', text: '{"private":"🙂"}', part: 0, parts: 1 } }] }
function setup(maxBytes = 4096, maxPages = 20) {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('scope' as never)
  const state = runtime.state.getSnapshot()
  runtime.state.set({ ...state, run: { loading: false, stale: false, scope: JSON.stringify(['run', runId]) },
    observation: { loading: false, stale: false, value: { runId, readVersion: 'policy' as never, cursor: 'watch' as never,
      status: 'changed', observedAt: 1, world: { status: 'observed', revision: 3 } } } })
  const exporter = runtime.recordExporter(ctx, { maxBytes, maxPages, pageSize: 2 })
  const read = vi.spyOn(api.simulations, 'records').mockResolvedValue(ok(page))
  const deliver = vi.fn()
  return { ctx, api, runtime, exporter, read, deliver }
}
it('reconstructs Unicode text across pages, pins the revision, and revalidates before download', async () => {
  const h = setup()
  try {
    h.read.mockResolvedValueOnce(ok({ ...page, nextCursor: 'next' as never,
      items: [{ ...page.items[0]!, body: { status: 'text', text: '{"private":', part: 0, parts: 2 } }] }))
      .mockResolvedValueOnce(ok({ ...page, items: [{ ...page.items[0]!, body: { status: 'text', text: '"🙂"}', part: 1, parts: 2 } }] }))
    await h.exporter.start({ runId, mode: 'original' }, h.deliver)
    expect(h.deliver).toHaveBeenCalledOnce()
    const file = h.deliver.mock.calls[0]![0] as { text: string }
    expect(JSON.parse(file.text)).toMatchObject({ snapshotRevision: 3, records: [{ sequence: 2, value: { private: '🙂' } }] })
    expect(h.exporter.state.getSnapshot()).toMatchObject({ status: 'completed', records: 1, bytes: new TextEncoder().encode(file.text).length })
    expect(h.read).toHaveBeenLastCalledWith({ runId, mode: 'original', expectedRevision: 3, limit: 1 }, expect.any(AbortSignal))
  } finally { await h.ctx.fiber.dispose() }
})
it.each(['policy', 'connection', 'selection', 'cancel'] as const)('discards all bytes and late responses after %s', async (change) => {
  const h = setup()
  try {
    const held = deferred<Awaited<ReturnType<typeof h.api.simulations.records>>>()
    h.read.mockReturnValueOnce(held.promise)
    const result = h.exporter.start({ runId, mode: 'original' }, h.deliver)
    const state = h.runtime.state.getSnapshot()
    if (change === 'policy') h.runtime.state.set({ ...state, observation: { ...state.observation,
      value: { ...state.observation.value!, readVersion: 'new' as never } } })
    else if (change === 'connection') h.runtime.disconnected()
    else if (change === 'selection') h.runtime.state.set({ ...state, run: { loading: false, stale: false, scope: 'another' } })
    else h.exporter.cancel()
    held.resolve(ok(page)); await result
    expect(h.deliver).not.toHaveBeenCalled()
    expect(h.exporter.state.getSnapshot()).toMatchObject({ pending: false, records: 0, bytes: 0, status: 'cancelled' })
  } finally { await h.ctx.fiber.dispose() }
})
it.each(['limit', 'denied', 'partial', 'stale', 'verification', 'verification-count', 'repeated-cursor'] as const)('never downloads a %s export', async (failure) => {
  const h = setup(failure === 'limit' ? 10 : 4096)
  try {
    if (failure === 'denied') h.read.mockResolvedValueOnce(ok({ ...page, bodyAccess: 'withheld', items: [] }))
    if (failure === 'partial') h.read.mockResolvedValueOnce(ok({ ...page, items: [{ ...page.items[0]!,
      body: { status: 'text', text: '{', part: 0, parts: 2 } }] }))
    if (failure === 'stale') h.read.mockResolvedValueOnce(ok({ ...page, readVersion: 'another' as never }))
    if (failure === 'verification-count') h.read.mockResolvedValueOnce(ok(page)).mockResolvedValueOnce(ok({ ...page, totalRecords: 2 }))
    if (failure === 'verification') h.read.mockResolvedValueOnce(ok(page)).mockResolvedValueOnce(err({ code: 'simulation-product-stale', message: 'Changed', details: {} }))
    if (failure === 'repeated-cursor') h.read.mockResolvedValue(ok({ ...page, nextCursor: 'again' as never }))
    await h.exporter.start({ runId, mode: 'original' }, h.deliver)
    expect(h.deliver).not.toHaveBeenCalled()
    expect(h.exporter.state.getSnapshot()).toMatchObject({ status: 'failed', bytes: 0, records: 0 })
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps metadata and original windows independent, retains ordinary failures and clears revoked content', async () => {
  const h = setup()
  try {
    await h.runtime.readRecords({ runId, mode: 'original', sequence: 2 })
    const original = h.runtime.state.getSnapshot().record.value
    h.read.mockResolvedValueOnce(ok({ ...page, mode: 'metadata', items: [{ ...page.items[0]!, body: { status: 'withheld' } }] }))
    await h.runtime.readRecords({ runId, mode: 'metadata' })
    expect(h.runtime.state.getSnapshot().record.value).toBe(original)
    h.read.mockRejectedValueOnce(new Error('Disconnected'))
    await h.runtime.readRecords({ runId, mode: 'original', sequence: 2 })
    expect(h.runtime.state.getSnapshot().record.value).toBe(original)
    const held = deferred<Awaited<ReturnType<typeof h.api.simulations.records>>>()
    h.read.mockReturnValueOnce(held.promise)
    const reading = h.runtime.readRecords({ runId, mode: 'original', sequence: 2 })
    h.runtime.closeRecords(true)
    held.resolve(ok(page)); await reading
    expect(h.runtime.state.getSnapshot().record.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().records.value?.mode).toBe('metadata')
    h.read.mockResolvedValueOnce(err({ code: 'simulation-product-forbidden', message: 'Revoked', details: {} }))
    await h.runtime.readRecords({ runId, mode: 'original', sequence: 2 })
    expect(h.runtime.state.getSnapshot().record.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().records.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})
