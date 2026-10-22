/** Reauthenticated browsers discover receipt-only history and retry retained originals without authoring replacement bodies. */
import { afterEach, expect, it, vi } from 'vitest'
import { SimulationCreationStore } from '../src/creation-store.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'

afterEach(() => { vi.restoreAllMocks() })

function renewed(): AuthenticatedProductCall {
  const previous = call()
  return { ...previous, credentialGeneration: 2, principal: { ...previous.principal, credentialGeneration: 2 } }
}

it.each(['json', 'sqlite'] as const)('discovers ordered bounded originals after cold authentication replacement without native IO (%s)', async (backend) => {
  const h = await ownerFixture(backend, { maxRequestPageSize: 1, maxPendingRequests: 1 })
  try {
    const runId = await h.create()
    const input = { runId, commandId: 'later-prepare' as never }
    await h.ctx.simulationAdministration.prepare(input, call()); await h.finished(input.commandId)
    const service = h.ctx.simulationAdministration
    const first = await service.listRequests({ runId }, call())
    expect(first).toMatchObject({ runId, snapshotRevision: 4, total: 2,
      items: [{ commandId: h.input.commandId, kind: 'create', status: 'completed' }] })
    const next = await service.listRequests({ runId, cursor: first.nextCursor }, call())
    expect(next.items.map(item => item.commandId)).toEqual([input.commandId])
    expect(next.nextCursor).toBeUndefined()
    await expect(service.listRequests({ runId, limit: 2 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    await expect(service.listRequests({ runId, cursor: first.nextCursor }, renewed())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    await expect(service.listRequests({ runId }, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await h.fiber.dispose(); await h.mount()
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    const cold = h.ctx.simulationAdministration
    const page = await cold.listRequests({ runId }, renewed())
    expect(page.items).toEqual(first.items)
    expect(JSON.stringify(page)).not.toContain('parameters')
    expect(JSON.stringify(page)).not.toContain('buyerName')
    expect(JSON.stringify(page)).not.toContain('Owner company')
    expect(await cold.retryRequest({ runId, commandId: h.input.commandId }, renewed())).toEqual(first.items[0])
    expect(await cold.retryRequest(input, renewed())).toEqual(next.items[0])
    await expect(cold.listRequests({ runId, cursor: first.nextCursor }, renewed())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('binds each continuation to run, revision, bound and authority while unrelated runs do not change the observation', async () => {
  const h = await ownerFixture('json', { maxRequestPageSize: 2 })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.prepare({ runId, commandId: 'prepare-one' as never }, call()); await h.finished('prepare-one' as never)
    const page = await service.listRequests({ runId, limit: 1 }, call())
    const other = await service.create({ ...h.input, commandId: 'other-create' as never }, call())
    await h.finished('other-create' as never)
    expect((await service.listRequests({ runId, cursor: page.nextCursor, limit: 1 }, call())).snapshotRevision).toBe(page.snapshotRevision)
    for (const input of [{ runId, cursor: page.nextCursor, limit: 2 },
      { runId: other.runId, cursor: page.nextCursor, limit: 1 }, { runId, cursor: 'tampered' as never, limit: 1 }]) {
      await expect(service.listRequests(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    }
    const tail = h.ctx.storageLog.get('owner-commands')!.tailSequence
    for (const input of [{ runId, commandId: 'missing' as never }, { runId: other.runId, commandId: h.input.commandId }]) {
      await expect(service.retryRequest(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    }
    await expect(service.retryRequest({ runId, commandId: h.input.commandId }, call(undefined, 'other')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(h.ctx.storageLog.get('owner-commands')!.tailSequence).toBe(tail)
    await service.prepare({ runId, commandId: 'prepare-two' as never }, call()); await h.finished('prepare-two' as never)
    await expect(service.listRequests({ runId, cursor: page.nextCursor, limit: 1 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    await expect(service.listRequests({ runId, expectedRevision: page.snapshotRevision }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('discovers and resumes the accepted original allocation with a renewed caller after terminal publication loss (%s)', async (backend) => {
  const h = await ownerFixture(backend, { maxPendingRequests: 1 })
  try {
    const attempted = Promise.withResolvers<undefined>()
    const lost = vi.spyOn(SimulationCreationStore.prototype, 'finish').mockImplementationOnce(async () => {
      attempted.resolve(undefined)
      throw new Error('Terminal result lost')
    })
    const original = await h.ctx.simulationAdministration.create(h.input, call())
    await attempted.promise
    expect(lost).toHaveBeenCalledWith(h.input.commandId)
    await h.fiber.dispose(); lost.mockRestore(); await h.mount()
    const service = h.ctx.simulationAdministration
    expect(await service.listRequests({ runId: original.runId }, renewed()))
      .toMatchObject({ snapshotRevision: 1, total: 1, items: [original] })
    expect(h.requests).toEqual([])
    expect(await service.retryRequest({ runId: original.runId, commandId: original.commandId }, renewed())).toEqual(original)
    const result = await h.finished()
    expect(result).toMatchObject({ runId: original.runId, status: 'completed' })
    expect(await service.retryRequest({ runId: original.runId, commandId: original.commandId }, renewed())).toEqual(result)
    expect((await h.ctx.simulationProducts.list({}, renewed())).items).toHaveLength(1)
    expect((await service.listRequests({ runId: original.runId }, renewed())).snapshotRevision).toBe(2)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('bounds complete receipt pages while preserving exact outcome lookup', async () => {
  const options: { maxBytes?: number } = {}
  const h = await ownerFixture('json', options)
  try {
    const runId = await h.create()
    await h.ctx.simulationAdministration.prepare({ runId, commandId: 'prepare-page' as never }, call())
    await h.finished('prepare-page' as never)
    await h.fiber.dispose(); options.maxBytes = 256; await h.mount()
    await expect(h.ctx.simulationAdministration.listRequests({ runId }, call())).rejects.toThrow('complete byte allowance')
    expect(await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())).toMatchObject({ status: 'found' })
  } finally { await h.close() }
})

it('orders commands with equal acceptance times by their stable identities', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create()
    const service = h.ctx.simulationAdministration
    const acceptedAt = Date.now() + 1000
    for (const commandId of ['prepare-z', 'prepare-a', 'prepare-m']) {
      const now = vi.spyOn(Date, 'now').mockReturnValue(acceptedAt)
      try { await service.prepare({ runId, commandId: commandId as never }, call()) }
      finally { now.mockRestore() }
      await h.finished(commandId as never)
    }
    expect((await service.listRequests({ runId }, call())).items.map(item => item.commandId))
      .toEqual([h.input.commandId, 'prepare-a', 'prepare-m', 'prepare-z'])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'].flatMap(backend => ['prepare', 'restore'].map(kind => [backend, kind] as const)))
('resumes the accepted original %s %s command after cold discovery without a replacement identity', async (backend, kind) => {
  const h = await ownerFixture(backend as 'json' | 'sqlite')
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const attempted = Promise.withResolvers<undefined>()
    const lost = vi.spyOn(SimulationCreationStore.prototype, 'finish').mockImplementationOnce(async () => {
      attempted.resolve(undefined)
      throw new Error('Terminal result lost')
    })
    const commandId = 'interrupted-request' as never
    const original = kind === 'prepare' ? await service.prepare({ runId, commandId }, call())
      : await service.restore({ runId, commandId, checkpointId: `product-initial/${h.input.commandId}` as never }, call())
    await attempted.promise
    expect(lost.mock.calls[0]?.[0]).toBe(commandId)
    await h.fiber.dispose(); lost.mockRestore(); await h.mount()
    const current = h.ctx.simulationAdministration
    expect((await current.listRequests({ runId }, renewed())).items.find(item => item.commandId === commandId)).toEqual(original)
    await current.retryRequest({ runId, commandId }, renewed())
    const terminal = await h.finished(commandId)
    expect(terminal).toMatchObject({ commandId, kind, runId, status: 'completed' })
    expect(await current.retryRequest({ runId, commandId }, renewed())).toEqual(terminal)
    expect((await current.listRequests({ runId }, renewed())).total).toBe(2)
    expect(h.owned().snapshot().phase).toBe('paused')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
