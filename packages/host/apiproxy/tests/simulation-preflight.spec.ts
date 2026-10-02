/** Creation preflight crosses authenticated fetch without native ownership or durable creation effects. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'

it('returns resolved allowances over fetch without allocating a run or accepting a command', async () => {
  const h = await ownerFixture()
  try {
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const { commandId: _commandId, ...draft } = h.input
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear()
    const attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    expect((await api.simulations!.preflight({ rpcId: RpcId('unauthenticated'), payload: draft })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect((await client.simulations.preflight(draft)).result).toMatchObject({ ok: true, value: {
      status: 'ready', configuration: { limits: { maxResidentActors: 2 }, sharedModelLimit: 2 },
    } })
    expect((await client.simulations.preflight({ ...draft, limits: { maxResidentActors: 1 } })).result)
      .toMatchObject({ ok: true, value: { status: 'invalid', issues: [{ field: 'limits.maxResidentActors', code: 'not-allowed' }] } })
    expect((await client.simulations.preflight({ ...draft, commandId: 'unsafe' } as never)).result)
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect((await client.simulations.preflight({ ...draft, limits: { sharedModelLimit: 20 } } as never)).result)
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect((await h.ctx.simulationProducts.list({}, call())).items).toEqual([])
    expect((await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())).status).toBe('not-found')
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(h.requests).toEqual([])
    delete api.simulations
    expect((await client.simulations.preflight(draft)).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-unavailable' } })
  } finally { vi.restoreAllMocks(); await h.close() }
})

it('reports an undeployed owner through the same typed fetch endpoint', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(UserQuestions)
    const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, {
      cwd: process.cwd(), defaultModelSelection: () => undefined,
    }), { authenticatedProductCall: call() }))
    expect((await client.simulations.preflight({ templateId: 'company' as never, templateVersion: '1', name: 'Company',
      parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-unavailable' } })
  } finally { await ctx.fiber.dispose() }
})
