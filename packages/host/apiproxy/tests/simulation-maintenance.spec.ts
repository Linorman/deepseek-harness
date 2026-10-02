/** Original maintenance and input selection traverse the authenticated Host fetch carrier. */
import { afterEach, expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema, simulationProductIngressInputSchema }
  from '@clocky/clocky-simulation-product/schema'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'

afterEach(() => { vi.restoreAllMocks() })
it('routes authenticated checkpoint/recovery/input operations and rejects substituted original results', async () => {
  const h = await ownerFixture()
  try {
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const runId = await h.create()
    const checkpoint = simulationProductCheckpointInputSchema.parse({ runId, commandId: 'host-cut' })
    expect((await client.simulations.checkpoint(checkpoint)).result).toMatchObject({ ok: true, value: { kind: 'checkpoint', status: 'accepted' } })
    const completed = await h.finished(checkpoint.commandId)
    const restore = simulationProductRestoreInputSchema.parse({ runId, commandId: 'host-restore', checkpointId: completed.checkpointId })
    expect((await client.simulations.restore(restore)).result).toMatchObject({ ok: true, value: { kind: 'restore', status: 'accepted' } })
    const restored = await h.finished(restore.commandId)
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'host-input', entityId: 'buyer', text: 'Private text', availableAt: '5' })
    const sent = await client.simulations.ingress(input)
    expect(sent.result).toMatchObject({ ok: true, value: { status: 'pending', assignedAt: '5' } })
    const query = { runId, ingressId: input.ingressId }
    expect((await client.simulations.ingressRequest(query)).result).toMatchObject({ ok: true, value: { status: 'found' } })
    const receipt = await h.ctx.simulationAdministration.ingress(input, call())
    for (const value of [{ ...receipt, runId: 'foreign' as never }, { ...receipt, ingressId: 'foreign' as never },
      { ...receipt, entityId: 'supplier' as never }, { ...receipt, availableAt: '6' as never }]) {
      vi.spyOn(h.ctx.simulationAdministration, 'ingress').mockResolvedValueOnce(value)
      await expect(client.simulations.ingress(input)).rejects.toThrow('original selection')
    }
    for (const value of [{ ...completed, commandId: 'foreign' as never }, { ...completed, runId: 'foreign' as never },
      { ...completed, kind: 'restore' as const }]) {
      vi.spyOn(h.ctx.simulationAdministration, 'checkpoint').mockResolvedValueOnce(value)
      await expect(client.simulations.checkpoint(checkpoint)).rejects.toThrow('original selection')
    }
    vi.spyOn(h.ctx.simulationAdministration, 'restore').mockResolvedValueOnce({ ...restored, checkpointId: 'foreign' as never })
    await expect(client.simulations.restore(restore)).rejects.toThrow('original selection')
    for (const value of [{ status: 'not-found' as const, runId: 'foreign' as never, ingressId: input.ingressId },
      { status: 'not-found' as const, runId, ingressId: 'foreign' as never }]) {
      vi.spyOn(h.ctx.simulationAdministration, 'ingressRequest').mockResolvedValueOnce(value)
      await expect(client.simulations.ingressRequest(query)).rejects.toThrow('original selection')
    }
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
