/** One real authenticated fetch status batch composes native observations and administrative metadata without taking ownership. */
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'

it('correlates an exact status batch, keeps imported scenario identity unavailable and denies hidden identities before inspection', async () => {
  const h = await ownerFixture('json')
  try {
    await h.ctx.plugin(UserQuestions)
    const runId = await h.create()
    const client = new InProcessApiClient(toFetchHandler(createApiProxy(h.ctx, {
      cwd: process.cwd(), defaultModelSelection: () => undefined,
    }), { authenticatedProductCall: call() }))
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    const statuses = await client.simulations.runStatuses({ runIds: [runId] })
    expect(statuses.result).toMatchObject({ ok: true, value: { modelPool: { status: 'observed', clock: 'real', active: 0 },
      items: [{ status: 'observed', world: { metrics: { residentSlots: { used: 0, limit: 2 } } }, operational: {
        status: 'observed', owner: 'held', driver: 'idle', scenario: { status: 'observed', templateId: { text: 'company' } },
      } }] } })
    const registrar = h.ctx.simulationProducts.creationRegistrar()
    const imported = 'imported-metadata' as never
    await registrar({ id: imported, name: 'Company sounding display name', provider: 'local', ownerPrincipalId: call().principal.id,
      registeredAt: 1, spec: { ...h.selection.spec, runId: imported } })
    const mixed = await client.simulations.runStatuses({ runIds: [runId, imported] })
    expect(mixed.result).toMatchObject({ ok: true, value: { items: [{ run: { id: runId } }, {
      run: { id: imported }, status: 'missing', operational: { status: 'unavailable', scenario: { status: 'unavailable' } },
    }] } })
    const inspect = vi.spyOn(h.ctx.simulations, 'inspect').mockClear()
    expect((await client.simulations.runStatuses({ runIds: [runId, 'hidden-or-missing' as never] })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    expect(inspect).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
    const page = await h.ctx.simulationAdministration.runStatuses({ runIds: [runId] }, call())
    vi.spyOn(h.ctx.simulationAdministration, 'runStatuses').mockResolvedValueOnce({ ...page, items: [] })
    await expect(client.simulations.runStatuses({ runIds: [runId] })).rejects.toThrow('exact run batch')
  } finally { vi.restoreAllMocks(); await h.close() }
})
