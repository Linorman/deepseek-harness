/** Creation validation shares read authority and cancellation, without retaining a durable command. */
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import { SimulationRuntime } from '../src/client/simulations/service.ts'
import type { SimulationProductPreflightInput, SimulationProductPreflightResult } from '../src/client/simulations/service.ts'
import { FakeApiClient, ok, err } from './fake-api.client.ts'

const input: SimulationProductPreflightInput = { templateId: 'company' as never, templateVersion: '1', name: 'Original',
  parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' }, limits: { maxTime: '9007199254740993' } }
const result: SimulationProductPreflightResult = { status: 'invalid', issues: [{ field: 'limits.maxTime', code: 'invalid',
  message: { text: 'Tick exceeds installed maximum', truncated: false } }] }
function fixture() {
  const ctx = new Context(), api = new FakeApiClient(), runtime = new SimulationRuntime(ctx, api)
  runtime.connected('principal-one' as never)
  return { ctx, api, runtime }
}

it('retains only the latest draft observation and returns no late authorization for a replaced read', async () => {
  const h = fixture()
  try {
    const pending = Promise.withResolvers<ReturnType<typeof ok<SimulationProductPreflightResult>>>()
    const check = vi.spyOn(h.api.simulations, 'preflight').mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok(result))
    const create = vi.spyOn(h.api.simulations, 'create')
    const first = h.runtime.preflight(input)
    const second = { ...input, name: 'Replacement' }
    expect((await h.runtime.preflight(second))?.value).toEqual(result)
    pending.resolve(ok(result)); expect(await first).toBeUndefined()
    expect(check.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(h.runtime.state.getSnapshot().preflight.scope).toBe(JSON.stringify(second))
    expect(create).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('clears retired draft reads and treats creation permission refusal independently of readable runs', async () => {
  const h = fixture()
  try {
    const pending = Promise.withResolvers<ReturnType<typeof ok<SimulationProductPreflightResult>>>()
    const check = vi.spyOn(h.api.simulations, 'preflight').mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(err({ code: 'simulation-product-forbidden', message: 'Creation denied', details: {} }))
    const read = h.runtime.preflight(input)
    h.runtime.closePreflight(); pending.resolve(ok(result))
    expect(await read).toBeUndefined(); expect(h.runtime.state.getSnapshot().preflight.value).toBeUndefined()
    const version = h.runtime.state.getSnapshot().authorizationVersion
    expect((await h.runtime.preflight(input))?.error).toBe('forbidden')
    expect(h.runtime.state.getSnapshot().authorizationVersion).toBe(version)
    expect(check.mock.calls[0]?.[1]?.aborted).toBe(true)
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['disconnect', 'replacement', 'pause'] as const)('retires validation before a late success after %s', async (reason) => {
  const h = fixture()
  try {
    const pending = Promise.withResolvers<ReturnType<typeof ok<SimulationProductPreflightResult>>>()
    vi.spyOn(h.api.simulations, 'preflight').mockReturnValueOnce(pending.promise)
    const read = h.runtime.preflight(input)
    if (reason === 'disconnect') h.runtime.disconnected()
    else if (reason === 'replacement') h.runtime.connected('principal-two' as never)
    else h.runtime.pause()
    pending.resolve(ok(result)); expect(await read).toBeUndefined()
    expect(h.runtime.state.getSnapshot().preflight.value).toBeUndefined()
    expect(h.runtime.state.getSnapshot().preflight.loading).toBe(false)
  } finally { await h.ctx.fiber.dispose() }
})

it('marks retained ready configuration stale when the same draft refresh loses its result', async () => {
  const h = fixture()
  try {
    const ready: SimulationProductPreflightResult = { status: 'ready', configuration: {
      limits: { maxEntities: 2, maxResidentActors: 2, tokensPerModelRequest: 100, maxTokensPerInterval: 1000, maxTime: '1000' },
      budgetInterval: '100', sharedModelLimit: 1, tickUnit: { text: 'tick', truncated: false },
      rulesVersion: { text: '1', truncated: false }, policyVersion: { text: '1', truncated: false },
    } }
    vi.spyOn(h.api.simulations, 'preflight').mockResolvedValueOnce(ok(ready)).mockRejectedValueOnce(new Error('Response lost'))
    await h.runtime.preflight(input)
    expect(await h.runtime.preflight(input)).toMatchObject({ value: ready, stale: true, error: 'network', loading: false })
  } finally { await h.ctx.fiber.dispose() }
})
