/** Product scheduling retains explicit intent, original case identity and bounded planning after Native read conflicts. */
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { activeSimulationMaintenance, simulationChangeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import { simulationProductWorldCreateInputSchema } from '../src/world-schema.ts'
import { simulationProductManageInputSchema } from '../src/control-schema.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { simulationCreationEntrySchema } from '../src/creation-book.ts'
import { call } from './fixtures.ts'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import * as Model from '../../../../examples/simulation-company/tests/world-driver-model.ts'

afterEach(() => { vi.restoreAllMocks() })

async function fixture(backend: 'json' | 'sqlite', conflict: 'once' | 'always' | 'prepared') {
  const h = await companyFixture(backend, false)
  let closing: Promise<void> | undefined
  const close = () => closing ??= h.close()
  onTestFinished(close)
  let owned: SimulationRun | undefined
  await h.ctx.plugin(Model)
  await h.ctx.plugin(Products, { directoryStream: 'world-replanning-products' })
  const installed = catalog()
  installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
  await h.ctx.plugin(Administration, { journalStream: 'world-replanning-commands', templates: [], driverIntervalMs: 10,
    world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } })
  const open = h.ctx.simulations.open.bind(h.ctx.simulations)
  vi.spyOn(h.ctx.simulations, 'open').mockImplementation(async (selection) => {
    const run = await open(selection)
    owned = run
    const reserve = run.reserveWorldHire.bind(run), commit = run.commitWorldHire.bind(run)
    let changes = 0
    const changeReads = async () => {
      changes += 1
      const grant = Object.values(run.snapshot().relations).find(value => value.relation === 'can-hire')!
      const { revision, ...fields } = grant
      await run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields,
        relationRevision: revision, validUntil: String(100 + changes) }), run.snapshot().revision)
    }
    run.reserveWorldHire = async (input) => {
      if (conflict === 'always' || conflict === 'once' && changes === 0) await changeReads()
      return await reserve(input)
    }
    run.commitWorldHire = async (id) => {
      if (conflict === 'prepared') await changeReads()
      return await commit(id)
    }
    return run
  })
  const definition = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
  const administration = h.ctx.simulationAdministration
  const preview = await administration.preflightWorld({ definition }, call())
  if (preview.status !== 'ready') throw new Error('World planning fixture requires a valid preview')
  const input = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-world', name: 'World replanning', definition,
    preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } })
  const completed = Promise.withResolvers<undefined>()
  const stream = h.ctx.storageLog.get('world-replanning-commands')!
  const append = stream.append.bind(stream)
  stream.append = async (...args) => {
    const result = await append(...args)
    if (args[1].some((value) => {
      const entry = simulationCreationEntrySchema.parse(value)
      return entry.kind !== 'command/accepted' && entry.commandId === input.commandId
    })) setImmediate(() => { completed.resolve(undefined) })
    return result
  }
  const created = await administration.createWorld(input, call())
  // Observe the exact durable terminal and its store fold, under the unchanged test deadline.
  await completed.promise
  expect(await administration.request({ commandId: input.commandId }, call()))
    .toMatchObject({ status: 'found', request: { status: 'completed' } })
  const control = () => administration.control({ runId: created.runId }, call())
  const manage = (managementId: string, phase: 'paused' | 'running' = 'running') => administration.manage(
    simulationProductManageInputSchema.parse({ runId: created.runId, managementId, phase }), call())
  const stopped = async (stop: string) => vi.waitFor(async () => {
    const value = await control()
    expect(value.stop).toBe(stop)
    expect(value.inFlight).toBe(false)
    return value
  }, { timeout: 10000 })
  const snapshot = () => {
    if (owned === undefined) throw new Error('Product did not retain its Native run')
    return owned.snapshot()
  }
  return { ...h, close, control, manage, stopped, snapshot }
}

it.each(['json', 'sqlite'] as const)('continues a %s stale case only with a new scheduling intent and commits one successor plan', async (backend) => {
  const h = await fixture(backend, 'once')
  try {
    await h.manage('start')
    const control = await h.stopped('plan-stale'), before = h.snapshot()
    const first = Object.values(before.world!.plans)[0]!
    expect(first.status).toBe('stale')
    expect(before.world!.reservations).toEqual({})
    expect(before.maintenance ?? {}).toEqual({})
    expect(control.actions.start).toEqual({ allowed: true, reason: 'ready' })
    const calls = h.ctx.worldDriverProbe.requests.length
    await h.manage('start')
    expect((await h.control()).driver).toBe('waiting')
    expect(h.snapshot()).toEqual(before)
    expect(h.ctx.worldDriverProbe.requests).toHaveLength(calls)
    await h.manage('pause', 'paused')
    await h.manage('continue')
    await h.stopped('idle')
    const state = h.snapshot(), plans = Object.values(state.world!.plans)
    expect(plans).toHaveLength(2)
    expect(plans[0]).toEqual(first)
    expect(plans[1]).toMatchObject({ status: 'accepted', requestId: first.requestId, proposal: { supersedes: first.id } })
    expect(Object.values(state.world!.requests)).toHaveLength(1)
    expect(Object.values(state.world!.results).map(result => result.outcome.kind)).toEqual(['committed'])
    expect(Object.values(state.world!.reservations).map(reservation => reservation.status)).toEqual(['committed'])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('retains the %s planning limit across explicit continuations and refuses another start after exhaustion', async (backend) => {
  const h = await fixture(backend, 'always')
  try {
    const limit = h.snapshot().world!.definition.limits.maxPlansPerRequest
    for (let attempt = 0; attempt < limit; attempt++) {
      await h.manage(`attempt-${attempt}`)
      await h.stopped('plan-stale')
      expect(Object.values(h.snapshot().world!.plans)).toHaveLength(attempt + 1)
    }
    const calls = h.ctx.worldDriverProbe.requests.length
    await h.manage('observe-exhaustion')
    expect((await h.stopped('plan-budget')).actions.start).toEqual({ allowed: false, reason: 'scenario-blocked' })
    const before = h.snapshot()
    await expect(h.manage('over-budget')).rejects.toThrow('scenario-blocked')
    expect(h.snapshot()).toEqual(before)
    expect(h.ctx.worldDriverProbe.requests).toHaveLength(calls)
    expect(before.world!.reservations).toEqual({})
    expect(Object.values(before.world!.requests)).toHaveLength(1)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('keeps %s stale prepared identity responsibility blocked behind maintenance', async (backend) => {
  const h = await fixture(backend, 'prepared')
  try {
    await h.manage('start')
    const control = await h.stopped('plan-stale'), before = h.snapshot()
    expect(activeSimulationMaintenance(before)?.status).toBe('quiescent')
    expect(Object.values(before.world!.reservations).map(reservation => reservation.status)).toEqual(['preparing'])
    expect(control.actions.start).toEqual({ allowed: false, reason: 'recovery-required' })
    const calls = h.ctx.worldDriverProbe.requests.length
    await expect(h.manage('cannot-bypass-preparation')).rejects.toThrow('recovery-required')
    expect(h.snapshot()).toEqual(before)
    expect(h.ctx.worldDriverProbe.requests).toHaveLength(calls)
  } finally { await h.close() }
})
