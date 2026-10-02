/** Product allocation with real journals, actors and tools; only the external model is scripted. */
import { vi } from 'vitest'
import type { SimulationRun } from '@clocky/clocky-simulation'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import type { Config } from '../src/administration.ts'
import { simulationCompanyTemplateSchema } from '../src/creation-schema.ts'
import { simulationProductCreateInputSchema } from '../src/administration-schema.ts'
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
  const mount = () => h.ctx.plugin(Administration, { journalStream: 'owner-commands', templates: [template],
    driverIntervalMs: 1, driverRetryMs: 5, ...options })
  const fiber = mount(); await fiber
  const input = simulationProductCreateInputSchema.parse({ commandId: 'owner-create', templateId: 'company', templateVersion: '1',
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
  const finished = async (commandId = input.commandId) => {
    return await vi.waitFor(async () => {
      const value = await h.ctx.simulationAdministration.request({ commandId }, call())
      if (value.status !== 'found' || value.request.status === 'accepted') throw new Error('Product preparation is pending')
      return value.request
    }, { timeout: 3000, interval: 5 })
  }
  const create = async () => {
    const receipt = await h.ctx.simulationAdministration.create(input, call())
    await finished()
    return receipt.runId
  }
  return { ...h, fiber, mount, input, finished, create,
    owned: () => { if (owned === undefined) throw new Error('Product did not acquire ownership'); return owned } }
}
