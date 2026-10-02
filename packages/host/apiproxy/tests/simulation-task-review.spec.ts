/** Authenticated scene review passes through the real fetch boundary, without ordinary Team mutation authority. */
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'

it('authenticates review metadata and original receipts, denies absent scene authority and detects substituted responses', async () => {
  const h = await ownerFixture('json')
  try {
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const query = { runId, limit: 1 }
    expect((await api.simulations!.listTaskReviews({ rpcId: RpcId('unauthenticated'), payload: query })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    expect((await client.simulations.listTaskReviews(query)).result).toMatchObject({ ok: true, value: { runId, total: 0, items: [] } })
    const input = { runId, commandId: 'original-review' as never, operationId: 'task-creation' as never, attemptId: 'attempt' as never,
      expectedRevision: 3, nextPhase: 'completed' as const, reason: 'Approved' }
    expect((await client.simulations.resolveTaskReview(input)).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-unavailable' } })
    const wrong = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(undefined, 'other') }))
    expect((await wrong.simulations.listTaskReviews(query)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    expect((await wrong.simulations.resolveTaskReview(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    const page = await service.listTaskReviews(query, call())
    vi.spyOn(service, 'listTaskReviews').mockResolvedValueOnce({ ...page, runId: 'foreign' as never })
    await expect(client.simulations.listTaskReviews(query)).rejects.toThrow('original selection')
    vi.spyOn(service, 'resolveTaskReview').mockResolvedValueOnce({ runId, commandId: 'foreign' as never,
      kind: 'review', status: 'accepted', acceptedAt: 1 })
    await expect(client.simulations.resolveTaskReview(input)).rejects.toThrow('original selection')
    expect(h.requests).toEqual([])
  } finally { vi.restoreAllMocks(); await h.close() }
})
