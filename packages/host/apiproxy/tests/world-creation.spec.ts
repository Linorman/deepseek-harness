/** World creation traverses actual authenticated fetch, original command persistence and Native/Team owners. */
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import UserQuestions from '@clocky/clocky-user-questions'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { simulationProductWorldCreateInputSchema } from '@clocky/clocky-simulation-product/schema'
import { catalog } from '../../../simulation/simulation-scenario/tests/fixtures.ts'
import { ownerFixture } from '../../../simulation/simulation-product/tests/company-owner-fixture.ts'
import { call } from '../../../simulation/simulation-product/tests/fixtures.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { RpcId } from '../src/api/rpc.ts'

it.each(['json', 'sqlite'] as const)('preflights, creates, queries and exports a paused %s World over authenticated fetch without models', async (backend) => {
  const installed = catalog()
  installed.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  const h = await ownerFixture(backend, { world: { provider: 'local', catalog: installed,
    checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } })
  try {
    await h.ctx.plugin(UserQuestions)
    const definition = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const before = h.run.snapshot()
    const open = vi.spyOn(h.ctx.simulations, 'open'), create = vi.spyOn(h.ctx.teams, 'createTeam')
    expect((await api.simulations!.preflightWorld({ rpcId: RpcId('unauthenticated'), payload: { definition } })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    const preview = await client.simulations.preflightWorld({ definition })
    expect(preview.result).toMatchObject({ ok: true, value: { status: 'ready', scope: { payroll: false, committeeApproval: false } } })
    if (!preview.result.ok || preview.result.value.status !== 'ready') throw new Error('World preview not ready')
    expect(JSON.stringify(preview.result.value)).not.toMatch(/sessionId|participantId|channelId|resolved|preset/)
    expect(open).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(h.run.snapshot()).toEqual(before)
    const input = simulationProductWorldCreateInputSchema.parse({ commandId: 'world-through-fetch', name: 'World via fetch', definition,
      preflight: { hash: preview.result.value.preview.hash, catalogGeneration: preview.result.value.preview.catalogGeneration } })
    const staleInput = { ...input, preflight: { ...input.preflight, catalogGeneration: 'expired' } }
    expect((await client.simulations.createWorld(staleInput)).result).toMatchObject({ ok: false,
      error: { code: 'simulation-product-preflight-changed' } })
    expect((await client.simulations.request({ commandId: input.commandId })).result)
      .toMatchObject({ ok: true, value: { status: 'not-found' } })
    expect(open).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled()
    const [first, duplicate] = await Promise.all([client.simulations.createWorld(input), client.simulations.createWorld(input)])
    expect(first.result.ok && duplicate.result.ok).toBe(true)
    if (!first.result.ok || !duplicate.result.ok) throw new Error('World creation was refused')
    expect(first.result.value.runId).toBe(duplicate.result.value.runId)
    const runId = first.result.value.runId
    const terminal = await h.finished(input.commandId)
    expect(terminal).toMatchObject({ status: 'completed', kind: 'world-create', runId })
    expect((await client.simulations.request({ commandId: input.commandId })).result).toEqual({ ok: true,
      value: { status: 'found', request: terminal } })
    const exported = await client.simulations.exportWorldDefinition({ runId })
    expect(exported.result).toEqual({ ok: true, value: { runId, definition } })
    expect((await client.simulations.inspect({ runId })).result).toMatchObject({ ok: true, value: { world: { phase: 'paused' } } })
    expect((await client.simulations.listRequests({ runId })).result).toMatchObject({ ok: true, value: { items: [terminal] } })
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(Object.keys(h.owned().snapshot().entities)).toHaveLength(5)
    expect(h.requests).toEqual([])
    expect(await h.ctx.sessionPersistence.list()).toEqual([])
    expect((await client.simulations.createWorld({ ...input, name: 'Another original payload' })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-invalid' } })
    const revoked = new AbortController()
    revoked.abort()
    const expired = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(revoked) }))
    expect((await expired.simulations.exportWorldDefinition({ runId })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_INVALID' } })
    const foreign = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call(new AbortController(), 'foreign') }))
    expect((await foreign.simulations.exportWorldDefinition({ runId })).result)
      .toMatchObject({ ok: false, error: { code: 'simulation-product-forbidden' } })
  } finally { vi.restoreAllMocks(); await h.close() }
})
