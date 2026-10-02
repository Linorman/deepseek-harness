/** Original command metadata crosses authenticated fetch without exposing stored inputs or allocating replacement commands. */
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'

it.each(['json', 'sqlite'] as const)('lists original metadata and retries only retained exact commands through fetch (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    await h.ctx.plugin(UserQuestions)
    const runId = await h.create()
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear()
    expect((await api.simulations!.listRequests({ rpcId: RpcId('unauthenticated'), payload: { runId } })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    const listing = await client.simulations.listRequests({ runId, limit: 1 })
    expect(listing.result).toMatchObject({ ok: true, value: { runId, total: 1,
      items: [{ commandId: h.input.commandId, kind: 'create', status: 'completed' }] } })
    expect(JSON.stringify(listing)).not.toContain('buyerName')
    expect(JSON.stringify(listing)).not.toContain('supplierName')
    expect(JSON.stringify(listing)).not.toContain('parameters')
    const original = await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())
    if (original.status !== 'found') throw new Error('Creation must have an original receipt')
    expect((await client.simulations.retryRequest({ runId, commandId: h.input.commandId })).result)
      .toEqual({ ok: true, value: original.request })
    expect((await client.simulations.retryRequest({ runId, commandId: h.input.commandId, input: h.input } as never)).result)
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    const wrong = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(undefined, 'other') }))
    expect((await wrong.simulations.listRequests({ runId })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    expect((await wrong.simulations.retryRequest({ runId, commandId: h.input.commandId })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    const page = await h.ctx.simulationAdministration.listRequests({ runId }, call())
    for (const value of [{ ...page, runId: 'foreign' as never, items: page.items.map(item => ({ ...item, runId: 'foreign' as never })) },
      { ...page, snapshotRevision: page.snapshotRevision + 1 }]) {
      vi.spyOn(h.ctx.simulationAdministration, 'listRequests').mockResolvedValueOnce(value)
      await expect(client.simulations.listRequests({ runId, expectedRevision: page.snapshotRevision })).rejects.toThrow('original selection')
    }
    vi.spyOn(h.ctx.simulationAdministration, 'retryRequest').mockResolvedValueOnce({ ...original.request, commandId: 'foreign' as never })
    await expect(client.simulations.retryRequest({ runId, commandId: h.input.commandId })).rejects.toThrow('original selection')
    expect(open).not.toHaveBeenCalled(); expect(h.requests).toEqual([])
    delete api.simulations
    expect((await client.simulations.listRequests({ runId })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-unavailable' } })
    expect((await client.simulations.retryRequest({ runId, commandId: h.input.commandId })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-unavailable' } })
  } finally { vi.restoreAllMocks(); await h.close() }
})
