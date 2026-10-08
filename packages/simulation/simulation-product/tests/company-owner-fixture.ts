/** Product allocation with real journals, actors and tools; only the external model is scripted. */
import { expect, vi } from 'vitest'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import type { Config } from '../src/administration.ts'
import { simulationCompanyTemplateSchema } from '../src/creation-schema.ts'
import { simulationProductCreateInputSchema } from '../src/administration-schema.ts'
import { simulationCreationEntrySchema } from '../src/creation-book.ts'
import { companyFixture, companyConfig } from './company-driver-fixture.ts'
import type { SimulationCompanyDriverConfig } from '../src/company-driver.ts'
import { companyModel } from './company-model.ts'
import { call } from './fixtures.ts'

export async function ownerFixture(backend: 'json' | 'sqlite' = 'json', options: Partial<Config> = {},
  driver: SimulationCompanyDriverConfig = companyConfig, nativeSpecOverrides: Record<string, unknown> = {}) {
  const h = await companyFixture(backend, false, nativeSpecOverrides)
  const { runId: _id, ...spec } = h.selection.spec
  const template = simulationCompanyTemplateSchema.parse({ id: 'company', version: '1', name: 'Company', provider: 'local', spec,
    preset: 'simulation', objective: 'Deliver one inventory unit', driver, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
  await h.ctx.plugin(Products, { directoryStream: 'owner-directory' })
  let observeCurrent = () => { /* Initial mount completes before the terminal observer is configured. */ }
  const mount = () => {
    const mounted = h.ctx.plugin(Administration, { journalStream: 'owner-commands', templates: [template],
      driverIntervalMs: 1, driverRetryMs: 5, ...options })
    void mounted.then(() => { observeCurrent() }, () => { /* The caller observes this same mount failure. */ })
    return mounted
  }
  const fiber = mount(); await fiber
  const input = simulationProductCreateInputSchema.parse({ commandId: 'owner-create', templateId: 'company', templateVersion: '1',
    expectedModel: driver.model,
    name: 'Owner company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
  const nativeOpen = h.ctx.simulations.open.bind(h.ctx.simulations)
  let owned: SimulationRun | undefined
  vi.spyOn(h.ctx.simulations, 'open').mockImplementation(async (...args) => {
    const run = await nativeOpen(...args)
    if (args[0].spec.runId !== h.run.snapshot().spec.runId) owned = run
    return run
  })
  const models = new WeakMap<SimulationRun, ReturnType<typeof companyModel>>()
  vi.spyOn(h.adapter, 'stream').mockImplementation((options) => {
    if (owned === undefined) throw new Error('Product model has no owned run')
    let model = models.get(owned)
    if (model === undefined) { model = companyModel(owned, h.requests); models.set(owned, model) }
    return model.stream(options)
  })
  const terminals = new Map<string, PromiseWithResolvers<undefined>>()
  const terminal = (commandId: string) => {
    let waiter = terminals.get(commandId)
    if (waiter === undefined) { waiter = Promise.withResolvers<undefined>(); terminals.set(commandId, waiter) }
    return waiter
  }
  const observed = new WeakMap<LogStream, LogStream['append']>()
  const observe = () => {
    const stream = h.ctx.storageLog.get('owner-commands')!
    if (observed.get(stream) === stream.append) return
    const append = stream.append.bind(stream)
    // A plain wrapper leaves the Vitest spy slot free for fault injection; each remount owns a new stream.
    const wrapper: LogStream['append'] = async (...args) => {
      const result = await append(...args)
      for (const value of args[1]) {
        const entry = simulationCreationEntrySchema.parse(value)
        if (entry.kind === 'command/accepted') continue
        // The next IO turn observes the durable append's store fold, under the test framework's existing deadline.
        setImmediate(() => { terminal(entry.commandId).resolve(undefined) })
      }
      return result
    }
    stream.append = wrapper
    observed.set(stream, wrapper)
  }
  observeCurrent = observe
  observe()
  const finished = async (commandId = input.commandId) => {
    observe()
    const waiter = terminal(commandId)
    let value = await h.ctx.simulationAdministration.request({ commandId }, call())
    if (value.status === 'found' && value.request.status === 'accepted') {
      await waiter.promise
      value = await h.ctx.simulationAdministration.request({ commandId }, call())
    }
    if (value.status !== 'found' || value.request.status === 'accepted') throw new Error(`Product terminal receipt missing: ${JSON.stringify(value)}`)
    return value.request
  }
  const create = async () => {
    const receipt = await h.ctx.simulationAdministration.create(input, call())
    const result = await finished()
    expect(result.status, JSON.stringify(result)).toBe('completed')
    return receipt.runId
  }
  return { ...h, fiber, mount, input, finished, create,
    owned: () => { if (owned === undefined) throw new Error('Product did not acquire ownership'); return owned } }
}
