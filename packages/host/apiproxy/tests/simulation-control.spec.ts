/** Scheduling controls use the authenticated fetch protocol and exact original result correlation. */
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { simulationProductManageInputSchema, simulationProductManagementInputSchema } from '@clocky/clocky-simulation-product/schema'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'

it('authenticates and correlates control, durable phase commands and original outcome queries', async () => {
  const h = await ownerFixture('json', { driverIntervalMs: 1000 })
  try {
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const runId = await h.create()
    expect((await api.simulations!.control({ rpcId: RpcId('unauthenticated'), payload: { runId } })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect((await client.simulations.control({ runId })).result).toMatchObject({ ok: true, value: { phase: 'paused', driver: 'idle' } })
    const input = simulationProductManageInputSchema.parse({ runId, managementId: 'start', phase: 'running' })
    const accepted = await client.simulations.manage(input)
    expect(accepted.result).toMatchObject({ ok: true, value: { operation: { managementId: 'start', status: 'completed' }, control: { phase: 'running' } } })
    await client.simulations.manage({ ...input, managementId: 'pause' as never, phase: 'paused' })
    expect((await client.simulations.manage(input)).result).toMatchObject({ ok: true,
      value: { operation: { phase: 'running' }, control: { phase: 'paused' } } })
    expect((await client.simulations.manage({ ...input, phase: 'paused' })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-invalid' } })
    const query = simulationProductManagementInputSchema.parse({ runId, managementId: 'start' })
    expect((await client.simulations.managementRequest(query)).result).toMatchObject({ ok: true, value: { status: 'found' } })
    expect((await client.simulations.managementRequest({ ...query, managementId: 'unknown' as never })).result)
      .toMatchObject({ ok: true, value: { status: 'not-found' } })
    const wrong = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(undefined, 'other') }))
    for (const request of [wrong.simulations.control({ runId }), wrong.simulations.manage(input),
      wrong.simulations.managementRequest(query)]) {
      expect((await request).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    }
    const control = await h.ctx.simulationAdministration.control({ runId }, call())
    vi.spyOn(h.ctx.simulationAdministration, 'control').mockResolvedValueOnce({ ...control, runId: 'foreign' as never })
    await expect(client.simulations.control({ runId })).rejects.toThrow('original selection')
    const result = await h.ctx.simulationAdministration.manage(input, call())
    for (const substitute of [{ ...result, runId: 'foreign' as never, control: { ...control, runId: 'foreign' as never } },
      { ...result, operation: { ...result.operation, managementId: 'foreign' as never } },
      { ...result, operation: { ...result.operation, phase: 'paused' as const } }]) {
      vi.spyOn(h.ctx.simulationAdministration, 'manage').mockResolvedValueOnce(substitute)
      await expect(client.simulations.manage(input)).rejects.toThrow('original selection')
    }
    for (const value of [{ runId: 'foreign' as never, managementId: query.managementId, status: 'not-found' as const },
      { runId, managementId: 'foreign' as never, status: 'not-found' as const }]) {
      vi.spyOn(h.ctx.simulationAdministration, 'managementRequest').mockResolvedValueOnce(value)
      await expect(client.simulations.managementRequest(query)).rejects.toThrow('original selection')
    }
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
