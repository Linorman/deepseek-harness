/** Stop updates are authenticated original commands, independent of start and model-drain waits. */
import { expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import { simulationProductRunControlInputSchema, simulationProductRunControlResultSchema } from '../src/run-control-schema.ts'
import { SimulationCompanyDriver } from '../src/company-driver.ts'

const target = (targetId: string, boundary: string) => ({ targetId, clock: { kind: 'native' as const }, boundary,
  mode: 'at-boundary' as const, checkpointPolicy: 'none' as const,
  drainBudget: { maxSteps: 10, maxTokens: 1000, maxWallTimeMs: 10000 } })

it.each(['json', 'sqlite'] as const)('retains original stop receipts, rejects changed identities and keeps clear separate from start (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const install = simulationProductRunControlInputSchema.parse({ runId, commandId: 'stop-one', target: target('first', '0') })
    const first = await service.updateRunControl(install, call())
    expect(first).toMatchObject({ receipt: { commandId: 'stop-one', targetId: 'first', activation: 'effective' },
      control: { phase: 'paused', stopTarget: { state: 'paused', target: { targetId: 'first' } } } })
    expect(simulationProductRunControlResultSchema.parse(first)).toEqual(first)
    await expect(service.manage({ runId, managementId: 'bypass' as never, phase: 'running' }, call())).rejects.toThrow()
    const cleared = await service.updateRunControl({ runId, commandId: 'clear-one', target: null }, call())
    expect(cleared.control).toMatchObject({ phase: 'paused', stopTarget: { state: 'cleared', target: null } })
    const revision = h.owned().snapshot().revision
    const original = await service.updateRunControl(install, call())
    expect(original.receipt).toEqual(first.receipt)
    expect(original.control.stopTarget?.target).toBeNull()
    expect(h.owned().snapshot().revision).toBe(revision)
    await expect(service.updateRunControl({ ...install, target: target('changed', '1') as never }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    expect(h.requests).toHaveLength(0)
    const retired = new AbortController(); retired.abort()
    await expect(service.updateRunControl({ runId, commandId: 'revoked', target: null }, call(retired)))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(h.owned().snapshot().runControl?.commands).not.toHaveProperty('revoked')
    await h.fiber.dispose()
    await h.mount()
    const cold = await h.ctx.simulationAdministration.updateRunControl(install, call())
    expect(cold.receipt).toEqual(first.receipt)
    expect(cold.control).toMatchObject({ owner: 'not-held', driverSource: { status: 'owner-unavailable' },
      phase: 'paused', stopTarget: { state: 'cleared', target: null } })
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it('accepts stop metadata while an admitted model batch remains in flight', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  vi.spyOn(SimulationCompanyDriver.prototype, 'advance').mockImplementation(async function () {
    entered.resolve(undefined); await release.promise
    return { reason: 'paused', time: '0' as never, revision: 1, controlSteps: 0 }
  })
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.manage({ runId, managementId: 'start' as never, phase: 'running' }, call())
    await entered.promise
    const result = await service.updateRunControl(simulationProductRunControlInputSchema.parse({
      runId, commandId: 'during-model', target: target('current', '0'),
    }), call())
    expect(result.control).toMatchObject({ phase: 'paused', inFlight: true, stopTarget: { state: 'paused' } })
  } finally { release.resolve(undefined); vi.restoreAllMocks(); await h.close() }
})

it('rechecks authorization after queued stop metadata admission', async () => {
  const h = await ownerFixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create(), run = h.owned(), controller = new AbortController()
    const original = run.updateRunControl.bind(run)
    vi.spyOn(run, 'updateRunControl').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined); await release.promise; return await original(...args)
    })
    const work = h.ctx.simulationAdministration.updateRunControl({ runId, commandId: 'queued-revocation', target: null }, call(controller))
    const refusal = expect(work).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await entered.promise; controller.abort(); release.resolve(undefined)
    await refusal
    expect(run.snapshot().runControl?.commands ?? {}).not.toHaveProperty('queued-revocation')
  } finally { release.resolve(undefined); vi.restoreAllMocks(); await h.close() }
})

it.each(['json', 'sqlite'] as const)('keeps an accepted stop after the caller disconnects before its acknowledgement (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  const committed = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create(), run = h.owned(), controller = new AbortController()
    const input = simulationProductRunControlInputSchema.parse({ runId, commandId: 'lost-stop-ack', target: target('durable-stop', '0') })
    const original = run.updateRunControl.bind(run)
    vi.spyOn(run, 'updateRunControl').mockImplementationOnce(async (...args) => {
      const receipt = await original(...args)
      committed.resolve(undefined); await release.promise
      return receipt
    })
    const work = h.ctx.simulationAdministration.updateRunControl(input, call(controller))
    const refusal = expect(work).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await committed.promise
    controller.abort(); release.resolve(undefined)
    await refusal
    expect(run.controlObservation()).toMatchObject({ phase: 'paused', stopTarget: { commandId: 'lost-stop-ack', state: 'paused' } })
    await expect(h.ctx.simulationAdministration.manage({ runId, managementId: 'disconnected-bypass' as never, phase: 'running' }, call()))
      .rejects.toThrow()
    await h.fiber.dispose(); await h.mount()
    const replay = await h.ctx.simulationAdministration.updateRunControl(input, call())
    expect(replay).toMatchObject({ receipt: { commandId: 'lost-stop-ack', activation: 'effective' },
      control: { owner: 'not-held', phase: 'paused', stopTarget: { state: 'paused' } } })
    expect(h.requests).toHaveLength(0)
  } finally { release.resolve(undefined); vi.restoreAllMocks(); await h.close() }
})

it('separates a reached target from its original checkpoint completion', async () => {
  const h = await ownerFixture()
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    await service.updateRunControl(simulationProductRunControlInputSchema.parse({ runId, commandId: 'save-boundary',
      target: { ...target('saving', '0'), checkpointPolicy: 'request' },
    }), call())
    expect((await service.control({ runId }, call())).stopTarget?.checkpoint).toBe('pending')
    const commandId = 'save-boundary-checkpoint' as never
    await service.checkpoint({ runId, commandId }, call())
    expect(await h.finished(commandId)).toMatchObject({ status: 'completed' })
    expect((await service.control({ runId }, call())).stopTarget).toMatchObject({ state: 'paused', checkpoint: 'completed' })
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})

it('refuses a stop target whose bounded future control result cannot fit before accepting it', async () => {
  const h = await ownerFixture('json', { maxBytes: 2300 })
  try {
    const runId = await h.create(), run = h.owned()
    await expect(h.ctx.simulationAdministration.updateRunControl(simulationProductRunControlInputSchema.parse({ runId,
      commandId: 'too-small-control-budget', target: target('future-cut', '1'),
    }), call())).rejects.toThrow('complete byte allowance')
    expect(run.runControlCommandObservation('too-small-control-budget')).toBeUndefined()
    expect(run.controlObservation().stopTarget).toBeUndefined()
    await h.ctx.simulationAdministration.manage({ runId, managementId: 'pause-after-refusal' as never, phase: 'paused' }, call())
    expect(run.controlObservation().phase).toBe('paused')
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
