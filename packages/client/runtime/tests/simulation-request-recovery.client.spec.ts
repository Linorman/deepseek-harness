/** Request journal revisions are independent of world progress, and recovery always selects the original identity. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import type { SimulationProductRequestsPage } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'

const page: SimulationProductRequestsPage = { runId: 'run' as never, snapshotRevision: 1, total: 1,
  items: [{ runId: 'run' as never, commandId: 'original' as never, kind: 'create', acceptedAt: 1, status: 'accepted' }] }
function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), source = new SimulationRuntime(ctx, api)
  source.connected('generation-one' as never)
  return { ctx, api, source, administration: source.administration(ctx, { maxCommands: 8, maxBytes: 65536 }) }
}

it('reads a fresh request journal independently of a later observed world revision', async () => {
  const h = fixture()
  try {
    h.source.state.set({ ...h.source.state.getSnapshot(), observation: { loading: false, stale: false,
      value: { world: { status: 'observed', revision: 100 } } as never } })
    const read = vi.spyOn(h.api.simulations, 'listRequests').mockResolvedValueOnce(ok(page))
    await h.source.listRequests({ runId: page.runId, limit: 1 })
    expect(read).toHaveBeenCalledWith({ runId: page.runId, limit: 1 }, expect.any(AbortSignal))
    expect(h.source.state.getSnapshot().persistentRequests).toMatchObject({ value: page, stale: false })
  } finally { await h.ctx.fiber.dispose() }
})

it('clears a refused administration page without changing independently authorized viewing or drafts', async () => {
  const h = fixture()
  try {
    const version = h.source.state.getSnapshot().authorizationVersion
    vi.spyOn(h.api.simulations, 'listRequests').mockResolvedValueOnce(ok(page)).mockResolvedValueOnce(err({
      code: 'simulation-product-forbidden', message: 'Administration refused', details: {},
    }))
    await h.source.listRequests({ runId: page.runId })
    await h.source.listRequests({ runId: page.runId })
    expect(h.source.state.getSnapshot().persistentRequests.error).toBe('forbidden')
    expect(h.source.state.getSnapshot().persistentRequests.value).toBeUndefined()
    expect(h.source.state.getSnapshot().authorizationVersion).toBe(version)
  } finally { await h.ctx.fiber.dispose() }
})

it('discovers and retries a cold original with no new command while rejecting another returned run', async () => {
  const h = fixture()
  try {
    const selector = { kind: 'retry-request' as const, input: { runId: page.runId, commandId: page.items[0]!.commandId } }
    const key = h.administration.retain(selector, h.source.state.getSnapshot().authorizationVersion)
    const send = vi.spyOn(h.api.simulations, 'retryRequest').mockResolvedValueOnce(ok(page.items[0]!))
      .mockResolvedValueOnce(ok({ ...page.items[0]!, runId: 'another' as never }))
    expect((await h.administration.submit(key))?.receipt).toMatchObject({ kind: 'request', value: page.items[0] })
    expect(send).toHaveBeenCalledWith(selector.input, expect.any(AbortSignal))
    expect(await h.administration.submit(key)).toMatchObject({ unknown: true, error: 'network' })
    expect(h.administration.state.getSnapshot().commands[key]?.command).toEqual(selector)
    expect(Object.keys(h.administration.state.getSnapshot().commands)).toEqual([key])
  } finally { await h.ctx.fiber.dispose() }
})

it('retires old original metadata when the selected run changes before its reply', async () => {
  const h = fixture()
  try {
    const pending = Promise.withResolvers<ReturnType<typeof ok<SimulationProductRequestsPage>>>()
    const read = vi.spyOn(h.api.simulations, 'listRequests').mockReturnValueOnce(pending.promise)
    vi.spyOn(h.api.simulations, 'inspect').mockResolvedValueOnce(err({ code: 'simulation-product-unavailable', message: 'Cold', details: {} }))
    const first = h.source.listRequests({ runId: page.runId })
    await h.source.inspect({ runId: 'other-run' as never })
    pending.resolve(ok(page)); await first
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(h.source.state.getSnapshot().persistentRequests.value).toBeUndefined()
  } finally { await h.ctx.fiber.dispose() }
})

it('reconciles terminal journal metadata with an older receipt without replacing it or sending another operation', async () => {
  const h = fixture()
  try {
    const selector = { kind: 'retry-request' as const, input: { runId: page.runId, commandId: page.items[0]!.commandId } }
    const key = h.administration.retain(selector, h.source.state.getSnapshot().authorizationVersion)
    const send = vi.spyOn(h.api.simulations, 'retryRequest').mockResolvedValue(ok(page.items[0]!))
    await h.administration.submit(key)
    const completed = { ...page, snapshotRevision: 2, items: [{ ...page.items[0]!, status: 'completed' as const }] }
    vi.spyOn(h.api.simulations, 'listRequests').mockResolvedValueOnce(ok(completed))
      .mockResolvedValueOnce(ok({ ...completed, items: [], total: 2 }))
    await h.source.listRequests({ runId: page.runId })
    expect(h.administration.state.getSnapshot().commands[key]).toMatchObject({
      receipt: { value: { status: 'accepted' } },
      requestObservation: { status: 'completed', journalRevision: 2, comparison: 'receipt-older', stale: false },
    })
    await h.administration.submit(key)
    expect(send).toHaveBeenCalledTimes(1)
    await h.source.listRequests({ runId: page.runId })
    expect(h.administration.state.getSnapshot().commands[key]?.requestObservation).toMatchObject({ status: 'completed', stale: true })
    await h.administration.submit(key)
    expect(send).toHaveBeenCalledTimes(1)
    h.source.clearAuthorization()
    expect(h.administration.state.getSnapshot().commands).toEqual({})
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps conflicting terminal observations queryable without releasing or resubmitting the original', async () => {
  const h = fixture()
  try {
    const selector = { kind: 'retry-request' as const, input: { runId: page.runId, commandId: page.items[0]!.commandId } }
    const key = h.administration.retain(selector, h.source.state.getSnapshot().authorizationVersion)
    const send = vi.spyOn(h.api.simulations, 'retryRequest').mockResolvedValue(ok({ ...page.items[0]!, status: 'completed' }))
    await h.administration.submit(key)
    vi.spyOn(h.api.simulations, 'listRequests').mockResolvedValue(ok({ ...page,
      items: [{ ...page.items[0]!, status: 'failed' }] }))
    await h.source.listRequests({ runId: page.runId })
    expect(h.administration.state.getSnapshot().commands[key]?.requestObservation?.comparison).toBe('conflict')
    expect(h.administration.release(key)).toBe(false)
    await h.administration.submit(key)
    expect(send).toHaveBeenCalledTimes(1)
    const lookup = vi.spyOn(h.api.simulations, 'request').mockResolvedValue(ok({ status: 'found',
      request: { ...page.items[0]!, status: 'failed' } }))
    await h.administration.query(key)
    expect(lookup).toHaveBeenCalledOnce()
    expect(h.administration.state.getSnapshot().commands[key]?.requestObservation?.comparison).toBe('consistent')
  } finally { await h.ctx.fiber.dispose() }
})

it('retains an explicit reconciliation failure at capacity and never silently restores retry off-page', async () => {
  const ctx = new Context(), api = new FakeApiClient(), source = new SimulationRuntime(ctx, api)
  source.connected('bounded-reader' as never)
  const administration = source.administration(ctx, { maxCommands: 8, maxBytes: 1024 })
  try {
    const key = administration.retain({ kind: 'create', input: { commandId: 'original' as never,
      templateId: 'company' as never, templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' }, name: 'Original',
      parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } } }, source.state.getSnapshot().authorizationVersion)
    const runId = 'large-run-identity-'.repeat(100) as SimulationProductRequestsPage['runId']
    const large = { ...page, runId, items: [{ ...page.items[0]!, runId, status: 'completed' as const }] }
    vi.spyOn(api.simulations, 'listRequests').mockResolvedValueOnce(ok(large))
      .mockResolvedValueOnce(ok({ ...large, items: [] }))
    const send = vi.spyOn(api.simulations, 'create')
    await source.listRequests({ runId })
    expect(administration.state.getSnapshot().commands[key]).toMatchObject({ requestObservationUnavailable: true })
    expect(new TextEncoder().encode(JSON.stringify(administration.state.getSnapshot().commands)).byteLength).toBeLessThanOrEqual(1024)
    await administration.submit(key)
    expect(send).not.toHaveBeenCalled()
    await source.listRequests({ runId })
    expect(administration.state.getSnapshot().commands[key]?.requestObservationUnavailable).toBe(true)
    await administration.submit(key)
    expect(send).not.toHaveBeenCalled()
    expect(administration.release(key)).toBe(false)
    source.clearAuthorization()
    expect(administration.state.getSnapshot().commands).toEqual({})
  } finally { await ctx.fiber.dispose() }
})
