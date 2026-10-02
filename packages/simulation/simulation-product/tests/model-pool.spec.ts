/** Live shared model permits remain distinct from immutable run budget ceilings and native interval usage. */
import { expect, it, vi } from 'vitest'
import { ownerFixture } from './company-owner-fixture.ts'
import { call } from './fixtures.ts'
import { observeModelPool } from '../src/model-pool.ts'
import { simulationProductScenarioVersionSchema, simulationProductModelPoolObservationSchema } from '../src/control-schema.ts'

it('reports missing/failed pool observations as unavailable and rejects forged occupancy or private fields', () => {
  expect(observeModelPool()).toMatchObject({ status: 'unavailable', clock: 'real' })
  expect(observeModelPool(() => { throw new Error('Private provider failure') })).toMatchObject({ status: 'unavailable' })
  const pool = { status: 'observed', clock: 'real', observedAt: 1, active: 1, queued: 2, limit: 2, queueLimit: 3 }
  expect(simulationProductModelPoolObservationSchema.parse(pool)).toEqual(pool)
  expect(() => simulationProductModelPoolObservationSchema.parse({ ...pool, active: 3 })).toThrow()
  expect(() => simulationProductModelPoolObservationSchema.parse({ ...pool, queued: 4 })).toThrow()
  expect(() => simulationProductModelPoolObservationSchema.parse({ ...pool, participantId: 'private-actor' })).toThrow()
  expect(() => simulationProductModelPoolObservationSchema.parse({ status: 'unavailable', clock: 'real', observedAt: 1, active: 0 })).toThrow()
})

it.each(['json', 'sqlite'] as const)('observes real held and cold company metadata without acquiring owners or starting models (%s)', async (backend) => {
  const h = await ownerFixture(backend)
  const release = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<undefined>()
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const start = await service.control({ runId }, call())
    expect(start.modelPool).toMatchObject({ status: 'observed', clock: 'real', active: 0, queued: 0, limit: 2 })
    expect(start.versions).toMatchObject({ rulesVersion: { text: '1' }, policyVersion: { text: '1' }, tickUnit: { text: 'minute' },
      scenario: { status: 'observed', templateId: { text: 'company' }, version: '1', driverVersion: '1', execution: 'cognition-only' } })
    // oxlint-disable-next-line typescript/unbound-method -- The fixture's mock implementation is called with its adapter receiver below.
    const stream = vi.mocked(h.adapter.stream).getMockImplementation()
    if (stream === undefined) throw new Error('Fixture has no scripted model implementation')
    vi.spyOn(h.adapter, 'stream').mockImplementation(async function * (options) {
      entered.resolve(undefined); await release.promise; yield* stream.call(h.adapter, options)
    })
    await service.manage({ runId, managementId: 'observe-live-permit' as never, phase: 'running' }, call())
    await entered.promise
    const held = await service.runStatuses({ runIds: [runId] }, call())
    expect(held.modelPool).toMatchObject({ status: 'observed', active: 1, queued: 0, limit: 2 })
    expect(held.items[0]?.operational).toMatchObject({ status: 'observed', owner: 'held', driver: 'advancing', inFlight: true })
    const control = await service.control({ runId }, call())
    expect(control.modelPool).toMatchObject({ active: 1 }); expect(control.budget).toEqual(start.budget)
    await service.manage({ runId, managementId: 'pause-permit' as never, phase: 'paused' }, call())
    expect((await service.control({ runId }, call())).modelPool).toMatchObject({ active: 1 })
    release.resolve(undefined)
    await vi.waitFor(async () => {
      expect((await service.control({ runId }, call())).modelPool).toMatchObject({ active: 0 })
    })
    const requests = h.requests.length
    const native = await h.ctx.simulationProducts.runStatuses({ runIds: [runId] }, call())
    expect(native.items[0]?.operational).toMatchObject({ status: 'unavailable', scenario: { status: 'unavailable' } })
    await h.fiber.dispose(); const cold = h.mount(); await cold
    const open = vi.spyOn(h.ctx.simulations, 'open').mockClear(), attach = vi.spyOn(h.ctx.simulationTeams, 'attach').mockClear()
    const observed = await h.ctx.simulationAdministration.runStatuses({ runIds: [runId] }, call())
    expect(observed.items[0]?.operational).toMatchObject({ status: 'observed', owner: 'not-held', driver: 'idle', inFlight: false,
      scenario: { status: 'observed', templateId: { text: 'company' }, execution: 'cognition-only' } })
    expect(observed.modelPool).toMatchObject({ status: 'observed', active: 0, queued: 0 })
    expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(h.requests.length).toBe(requests)
    await expect(h.ctx.simulationAdministration.runStatuses({ runIds: [runId, 'private-or-missing' as never] }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  } finally { release.resolve(undefined); vi.restoreAllMocks(); await h.close() }
})

it('requires an explicit supported execution mode in observed scenario metadata', () => {
  const scenario = { status: 'observed', templateId: { text: 'company', truncated: false }, version: '1', driverVersion: '1' }
  for (const execution of ['cognition-only', 'automatic-tasks']) {
    expect(simulationProductScenarioVersionSchema.parse({ ...scenario, execution })).toMatchObject({ execution })
  }
  expect(simulationProductScenarioVersionSchema.safeParse(scenario).success).toBe(false)
  expect(simulationProductScenarioVersionSchema.safeParse({ ...scenario, execution: 'guessed-from-count' }).success).toBe(false)
})
