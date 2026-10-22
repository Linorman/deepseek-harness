/** Product obligations retain real cross-owner evidence, required nulls and canonical source cursor fences. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { WORLD_GENERATE_AND_HIRE_PIN, simTimeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import Products from '../src/index.ts'
import { call, registration } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('reads %s actual personnel duties and rejects a cursor after only the canonical Channel changes', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire', { evidenceRoot: '.local/world-completion/u05-obligations' })
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const ackEntered = Promise.withResolvers<undefined>(), allowAck = Promise.withResolvers<undefined>()
  let receiving: Promise<unknown> | undefined
  try {
    const { schemaRef: _schema, implementationRef: _implementation, generation: _generation, ...pin } = WORLD_GENERATE_AND_HIRE_PIN
    await h.propose(h.requester, 'inventory-request', { kind: 'world/request', ...pin, businessKey: 'Original inventory case',
      expectedTime: null, evidence: [], payload: { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy',
        description: 'PRIVATE-INVENTORY-REQUEST-CANARY' } }, { kind: 'goal' })
    const request = Object.values(h.run.snapshot().world!.requests)[0]!
    const registered = { ...registration('personnel-inventory'), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'personnel-inventory-directory', imports: [registered] })
    const products = h.ctx.simulationProducts, input = { runId: registered.id, kind: 'person', personId: h.requester,
      section: 'obligations' } as const
    const before = h.run.snapshot(), open = vi.spyOn(h.ctx.simulations, 'open'), attach = vi.spyOn(h.ctx.simulationTeams, 'attach')
    const inventory = await products.readWorldDomain(input, call())
    if (inventory.kind !== 'person' || inventory.value === undefined) throw new Error('Original person inventory absent')
    expect(inventory.coverage.complete).toBe(true)
    expect(inventory.value.obligations.length).toBeGreaterThan(0)
    expect(inventory.value.obligations.every(item => item.kind === 'owner-duty' && item.original !== undefined
      && item.certainty !== undefined && item.ownerState !== undefined && item.dispositions.join() === 'wait')).toBe(true)
    expect(inventory.value.obligations.some(item => item.original?.ref.kind === 'message' && item.original.ref.envelopeId === null)).toBe(true)
    expect(JSON.stringify(inventory)).not.toContain('PRIVATE-INVENTORY-REQUEST-CANARY')
    expect(h.run.snapshot()).toEqual(before); expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
    await mkdir('.local/world-completion/u05-obligations', { recursive: true })
    await writeFile(resolve('.local/world-completion/u05-obligations', `${backend}-product-original.json`), JSON.stringify(inventory, null, 2) + '\n')
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.dispatchOperation(request.notificationOperationId!, Date.now)
    const confirmDelivery = h.run.confirmDelivery.bind(h.run), ack = h.ctx.teams.ackChannelEnvelope.bind(h.ctx.teams)
    vi.spyOn(h.ctx.teams, 'ackChannelEnvelope').mockImplementationOnce(async (...args) => {
      ackEntered.resolve(undefined); await allowAck.promise; return await ack(...args)
    })
    vi.spyOn(h.run, 'confirmDelivery').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await release.promise; return await confirmDelivery(...args)
    })
    receiving = h.connection.receiveOperation(request.notificationOperationId!)
    await ackEntered.promise
    const first = await products.readWorldDomain({ ...input, limit: 1 }, call())
    expect(first.coverage.nextCursor).toBeDefined()
    const stable = h.run.snapshot()
    allowAck.resolve(undefined); await entered.promise
    // Canonical receipt committed after the first read; its Native confirmation remains held by the real receiver.
    expect(h.run.snapshot()).toEqual(stable)
    await expect(products.readWorldDomain({ ...input, limit: 1, cursor: first.coverage.nextCursor,
      expectedRevision: first.snapshotRevision, readVersion: first.readVersion }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    expect(h.run.snapshot()).toEqual(stable)
    release.resolve(undefined); await receiving
    expect(h.requests).toHaveLength(0)
  } finally { allowAck.resolve(undefined); release.resolve(undefined); await receiving; vi.restoreAllMocks(); await h.close() }
})

it.each(['json', 'sqlite'] as const)('keeps %s actual Native-only duties explicitly unavailable after the Team inventory service unloads', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire', { evidenceRoot: '.local/world-completion/u05-obligations' })
  try {
    const registered = { ...registration('personnel-without-team'), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'personnel-without-team-directory', imports: [registered] })
    const products = h.ctx.simulationProducts, input = { runId: registered.id, kind: 'person', personId: h.requester,
      section: 'obligations' } as const
    expect((await products.readWorldDomain(input, call())).coverage.complete).toBe(true)
    await h.serviceFiber.dispose()
    expect(h.ctx.get('simulationTeams')).toBeUndefined()
    const before = h.run.snapshot(), result = await products.readWorldDomain(input, call())
    expect(result.coverage).toMatchObject({ complete: false, reason: 'unavailable' })
    expect(result.coverage.total).toBeUndefined()
    if (result.kind !== 'person' || result.value === undefined) throw new Error('Original Native person inventory is absent')
    expect(result.value.obligations.every(item => item.original !== undefined)).toBe(true)
    expect(h.run.snapshot()).toEqual(before); expect(h.requests).toHaveLength(0)
  } finally { vi.restoreAllMocks(); await h.close() }
})
