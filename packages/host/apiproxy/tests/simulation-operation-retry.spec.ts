/** The authenticated fetch carrier validates original outbox grants without publishing or relaxing normal Team writes. */
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'

it('authenticates, strictly correlates retry grant family and selectors, and refuses malformed attempt counts before mutation', async () => {
  const h = await ownerFixture('json')
  try {
    await h.ctx.plugin(UserQuestions)
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const input = { runId, commandId: 'grant-original' as never, operationId: 'unobserved-operation' as never,
      expectedAttemptCount: 1, reason: 'Reconcile the original target' }
    expect((await api.simulations!.retryOperation({ rpcId: RpcId('unauthenticated'), payload: input })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const native = vi.spyOn(service, 'retryOperation')
    for (const expectedAttemptCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect((await client.simulations.retryOperation({ ...input, expectedAttemptCount })).result)
        .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
    expect(native).not.toHaveBeenCalled()
    const wrong = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(undefined, 'other') }))
    expect((await wrong.simulations.retryOperation(input)).result).toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
    for (const receipt of [{ runId, commandId: 'other' as never, kind: 'retry-operation' as const, acceptedAt: 1, status: 'accepted' as const },
      { runId: 'other' as never, commandId: input.commandId, kind: 'retry-operation' as const, acceptedAt: 1, status: 'accepted' as const },
      { runId, commandId: input.commandId, kind: 'review' as const, acceptedAt: 1, status: 'accepted' as const }]) {
      native.mockResolvedValueOnce(receipt)
      await expect(client.simulations.retryOperation(input)).rejects.toThrow('original selection')
    }
    expect(h.requests).toEqual([])
  } finally { vi.restoreAllMocks(); await h.close() }
})
