/** Exact run-owned task cancellation crosses the public authenticated carrier without general Team authority. */
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'

it('authenticates task controls, retains the exact cancellation original and rejects substituted receipts and pages', async () => {
  const h = await ownerFixture('json')
  try {
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const query = { runId, limit: 1 }
    const input = { runId, commandId: 'original-cancel' as never, operationId: 'absent-source' as never,
      expectedRevision: 3, expectedAttemptId: null, reason: 'Cancel the exact original task' }
    for (const response of [await api.simulations!.listTasks({ rpcId: RpcId('unauthenticated-read'), payload: query }),
      await api.simulations!.cancelTask({ rpcId: RpcId('unauthenticated-cancel'), payload: input })]) {
      expect(response.result).toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    }
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    expect((await client.simulations.listTasks(query)).result).toMatchObject({ ok: true, value: { runId, total: 0, items: [] } })
    const wrong = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(undefined, 'other') }))
    expect((await wrong.simulations.listTasks(query)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    expect((await wrong.simulations.cancelTask(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    expect(await service.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'not-found' })
    // An unavailable source produces a terminal original failure, never a general
    // Team mutation or model activation; requests-get still reconstructs intent.
    expect((await client.simulations.cancelTask(input)).result).toMatchObject({ ok: true, value: { runId,
      commandId: input.commandId, kind: 'cancel-task' } })
    await vi.waitFor(async () => {
      expect(await service.request({ commandId: input.commandId }, call())).toMatchObject({ status: 'found',
        request: { kind: 'cancel-task', status: 'failed', failure: 'cancel-task-failed' }, cancellation: input })
    })
    const page = await service.listTasks(query, call())
    vi.spyOn(service, 'listTasks').mockResolvedValueOnce({ ...page, runId: 'foreign' as never })
    await expect(client.simulations.listTasks(query)).rejects.toThrow('original selection')
    vi.spyOn(service, 'cancelTask').mockResolvedValueOnce({ runId, commandId: 'foreign' as never,
      kind: 'cancel-task', status: 'accepted', acceptedAt: 1 })
    await expect(client.simulations.cancelTask(input)).rejects.toThrow('original selection')
    vi.spyOn(service, 'cancelTask').mockResolvedValueOnce({ runId, commandId: input.commandId,
      kind: 'review', status: 'accepted', acceptedAt: 1 })
    await expect(client.simulations.cancelTask(input)).rejects.toThrow('original selection')
    const cancellation = vi.spyOn(service, 'cancelTask')
    cancellation.mockClear()
    const forged = await toFetchHandler(api, { authenticatedProductCall: call() }).fetch(new Request('http://localhost/api/simulation.tasks.cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'forged', method: 'simulation.tasks.cancel',
        payload: { ...input, actor: {} } }),
    }))
    expect(await forged.json()).toMatchObject({ rpcId: 'forged', result: { ok: false,
      error: { code: 'bad-request', message: 'invalid payload for simulation.tasks.cancel' } } })
    expect(cancellation).not.toHaveBeenCalled()
    expect(h.requests).toEqual([])
  } finally { vi.restoreAllMocks(); await h.close() }
})
