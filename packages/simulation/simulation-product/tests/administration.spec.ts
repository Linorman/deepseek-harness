/** Native creation starts only after a persistent original command allocation and never requests a model. */
import { expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import type { Config } from '../src/administration.ts'
import { simulationCompanyTemplateSchema } from '../src/creation-schema.ts'
import { simulationCreationEntrySchema } from '../src/creation-book.ts'
import { resolveCreation } from '../src/creation-preflight.ts'
import { simulationProductCreateInputSchema } from '../src/administration-schema.ts'
import { companyFixture, companyConfig } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'

async function fixture(backend: 'json' | 'sqlite' = 'json', options: Partial<Config> = {}) {
  const h = await companyFixture(backend, false)
  const { runId: _runId, ...spec } = h.selection.spec
  const template = simulationCompanyTemplateSchema.parse({ id: 'company', version: '1', name: 'Company procurement', provider: 'local', spec,
    preset: 'simulation', objective: 'Deliver one inventory unit', driver: companyConfig,
    checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })
  await h.ctx.plugin(Products, { directoryStream: 'products', imports: [] })
  const mount = (overrides: Partial<Config> = {}) => h.ctx.plugin(Administration,
    { journalStream: 'product-commands', templates: [template], recoveryPageSize: 1, ...options, ...overrides })
  const fiber = mount(); await fiber
  const input = simulationProductCreateInputSchema.parse({ commandId: 'create-one', templateId: 'company', templateVersion: '1',
    name: 'A company run', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
  return { ...h, template, fiber, mount, input, administration: h.ctx.simulationAdministration }
}

async function finished(h: Awaited<ReturnType<typeof fixture>>, commandId = h.input.commandId) {
  return await vi.waitFor(async () => {
    const value = await h.ctx.simulationAdministration.request({ commandId }, call())
    if (value.status !== 'found' || value.request.status === 'accepted') throw new Error('Preparation is pending')
    return value.request
  }, { timeout: 3000, interval: 5 })
}

it.each(['json', 'sqlite'] as const)('allocates one original run, prepares without inference, and discovers it after service restart (%s)', async (backend) => {
  const h = await fixture(backend)
  try {
    const receipt = await h.administration.create(h.input, call())
    expect(receipt.status).toBe('accepted')
    expect(receipt.commandId).toBe(h.input.commandId)
    const result = await finished(h)
    expect(result.status).toBe('completed')
    const retry = await h.administration.create(h.input, call())
    expect(retry).toEqual(result)
    const observed = await h.ctx.simulationProducts.inspect({ runId: receipt.runId }, call())
    expect(observed.world).toMatchObject({ phase: 'paused', owner: 'this-provider', entityCount: 2, decisionCount: 0 })
    expect(h.requests).toEqual([])
    await h.fiber.dispose()
    await h.mount()
    expect(await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call()))
      .toEqual({ status: 'found', request: result })
    const directory = await h.ctx.simulationProducts.list({}, call())
    expect(directory.items).toHaveLength(1)
    expect(directory.items[0]?.id).toBe(receipt.runId)
    expect((await h.ctx.simulationProducts.inspect({ runId: receipt.runId }, call())).world?.owner).toBe('unowned')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('preflights allowlisted budgets without writes and preserves the resolved immutable spec after restart (%s)', async (backend) => {
  const h = await fixture(backend)
  try {
    await h.fiber.dispose()
    const editable = h.mount({ templates: [{ ...h.template, spec: { ...h.template.spec, maxTime: '9007199254741993' as never },
      editableLimits: ['maxEntities', 'maxResidentActors', 'tokensPerModelRequest', 'maxTokensPerInterval', 'maxTime'] }] })
    await editable
    const { commandId: _commandId, ...preview } = h.input
    const limits = { maxEntities: 2, maxResidentActors: 1, tokensPerModelRequest: 8000, maxTokensPerInterval: 16000,
      maxTime: '9007199254741991' }
    const before = h.ctx.storageLog.get('product-commands')!.tailSequence
    const model = h.ctx.simulationTeams.modelUsage()
    const resolve = vi.spyOn(h.ctx.simulations, 'open')
    const team = vi.spyOn(h.ctx.simulationTeams, 'ensureTeam')
    const result = await h.ctx.simulationAdministration.preflight({ ...preview, limits }, call())
    expect(result).toMatchObject({ status: 'ready', configuration: { limits, budgetInterval: '100',
      tickUnit: { text: 'minute', truncated: false }, sharedModelLimit: model.limit } })
    expect(resolve).not.toHaveBeenCalled()
    expect(team).not.toHaveBeenCalled()
    expect(h.ctx.storageLog.get('product-commands')!.tailSequence).toBe(before)
    expect(h.ctx.simulationTeams.modelUsage()).toEqual(model)
    expect((await h.ctx.simulationProducts.list({}, call())).items).toEqual([])
    const receipt = await h.ctx.simulationAdministration.create({ ...h.input, limits }, call())
    await finished(h)
    const retained = simulationCreationEntrySchema.parse((await h.ctx.storageLog.get('product-commands')!.read(-1, 1))[0]?.value)
    expect(retained.kind).toBe('command/accepted')
    if (retained.kind === 'command/accepted' && retained.command.kind === 'create') {
      expect(retained.command.creation.record.spec.maxTime).toBe(limits.maxTime)
      expect(retained.command.input.limits).toEqual(limits)
    }
    expect((await h.ctx.simulationProducts.inspect({ runId: receipt.runId }, call())).world).toMatchObject({ entityCount: 2 })
    await h.ctx.simulationAdministration.create({ ...h.input, limits }, call())
    await expect(h.ctx.simulationAdministration.create({ ...h.input, limits: { ...limits, maxTime: '800' } }, call()))
      .rejects.toThrow('another original payload')
    await h.ctx.simulationAdministration.checkpoint({ runId: receipt.runId, commandId: 'preflight-checkpoint' as never }, call())
    await finished(h, 'preflight-checkpoint' as never)
    await h.ctx.simulationAdministration.control({ runId: receipt.runId }, call()).then((value) => {
      expect(value.budget).toMatchObject({ tokensPerRequest: 8000, tokensPerInterval: 16000, residentActors: 1 })
    })
    await editable.dispose()
    await h.mount({ templates: [{ ...h.template, spec: { ...h.template.spec, tokensPerModelRequest: 9999 } }] })
    expect(await h.ctx.simulationAdministration.create({ ...h.input, limits }, call())).toMatchObject({ runId: receipt.runId, status: 'completed' })
    expect((await h.ctx.simulationAdministration.control({ runId: receipt.runId }, call())).budget)
      .toMatchObject({ tokensPerRequest: 8000, tokensPerInterval: 16000, residentActors: 1 })
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('preflight reports unavailable deployment and occupied capacity without private diagnostics or capacity reservations', async () => {
  const h = await fixture('json', { maxHeldRuns: 1 })
  try {
    const { commandId: _commandId, ...preview } = h.input
    vi.spyOn(h.ctx.agentPresets, 'resolve').mockRejectedValueOnce(new Error('private-preset-path-and-credential'))
    const unavailable = await h.administration.preflight(preview, call())
    expect(unavailable).toMatchObject({ status: 'invalid', issues: [{ field: 'templateId', code: 'unavailable' }] })
    expect(JSON.stringify(unavailable)).not.toContain('private-preset')
    vi.spyOn(h.ctx.agentPresets, 'resolve').mockRejectedValueOnce(new Error('private-preset-path-and-credential'))
    await expect(h.administration.create(h.input, call())).rejects.toThrow('preset is unavailable')
    expect(h.ctx.storageLog.get('product-commands')!.tailSequence).toBe(-1)
    expect(await h.administration.preflight(preview, call())).toMatchObject({ status: 'ready' })
    await h.administration.create(h.input, call())
    await finished(h)
    expect(await h.administration.preflight(preview, call())).toMatchObject({ status: 'invalid',
      issues: [{ field: 'capacity', code: 'capacity-unavailable' }] })
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('preflight returns bounded field issues and create independently refuses invalid or non-allowlisted budgets', async () => {
  const h = await fixture()
  try {
    const { commandId: _commandId, ...preview } = h.input
    expect(await h.administration.preflight({ ...preview, limits: { maxEntities: 2 } }, call())).toMatchObject({ status: 'invalid',
      issues: [{ field: 'limits.maxEntities', code: 'not-allowed' }] })
    await expect(h.administration.create({ ...h.input, limits: { maxEntities: 2 } }, call())).rejects.toThrow('limits.maxEntities')
    expect(await h.administration.preflight({ ...preview, parameters: { ...preview.parameters, initialStock: '10001' } }, call()))
      .toMatchObject({ status: 'invalid', issues: [{ field: 'parameters.initialStock', code: 'invalid' }] })
    expect(await h.administration.preflight({ ...preview, limits: { sharedModelLimit: 10 } } as never, call()))
      .toMatchObject({ status: 'invalid', issues: [{ field: 'limits', code: 'invalid' }] })
    await h.fiber.dispose()
    await h.mount({ templates: [{ ...h.template, editableLimits: ['maxEntities', 'maxResidentActors', 'maxTime', 'maxTokensPerInterval'] }] })
    const rejected = await h.ctx.simulationAdministration.preflight({ ...preview,
      limits: { maxEntities: 1, maxResidentActors: 3, maxTime: '29', maxTokensPerInterval: 9999 } }, call())
    expect(rejected.status).toBe('invalid')
    if (rejected.status === 'invalid') expect(rejected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'limits.maxEntities' }), expect.objectContaining({ field: 'limits.maxResidentActors' }),
      expect.objectContaining({ field: 'limits.maxTime' }), expect.objectContaining({ field: 'limits.maxTokensPerInterval' }),
    ]))
    expect(h.ctx.storageLog.get('product-commands')!.tailSequence).toBe(-1)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('runs deterministic workflow with zero token budget while refusing zero for model procurement (%s)', async (backend) => {
  const h = await fixture(backend)
  try {
    await h.fiber.dispose()
    const workflow = simulationCompanyTemplateSchema.parse({ ...h.template, editableLimits: ['maxTokensPerInterval'],
      driver: { ...h.template.driver, scenario: { kind: 'task-workflow', version: '1', steps: [
        { id: 'report', sourceEntityId: 'buyer', entityId: 'supplier', recipientEntityId: 'buyer', channelKey: 'purchase',
          subject: 'Report', description: 'Publish the trusted report', text: 'Deterministic report', cognition: 'deterministic',
          leaseDurationMs: 60000, maxAttempts: 1, retry: 'never' },
      ] } } })
    await h.mount({ templates: [workflow] })
    const input = { ...h.input, limits: { maxTokensPerInterval: 0 } }
    const { commandId: _commandId, ...preview } = input
    expect(await h.ctx.simulationAdministration.preflight(preview, call())).toMatchObject({ status: 'ready',
      configuration: { limits: { maxTokensPerInterval: 0 } } })
    const receipt = await h.ctx.simulationAdministration.create(input, call())
    await finished(h)
    await h.ctx.simulationAdministration.manage({ runId: receipt.runId, managementId: 'zero-start' as never, phase: 'running' }, call())
    await vi.waitFor(async () => {
      expect((await h.ctx.simulationAdministration.control({ runId: receipt.runId }, call())).stop).toBe('completed')
    }, { timeout: 3000, interval: 5 })
    expect((await h.ctx.simulationAdministration.control({ runId: receipt.runId }, call())).budget.tokensPerInterval).toBe(0)
    expect(h.requests).toEqual([])
    const model = { ...h.template, id: 'model-company' as never, editableLimits: ['maxTokensPerInterval'] as const }
    expect(resolveCreation(model, { ...preview, templateId: model.id }, text => ({ text, truncated: false })).issues)
      .toMatchObject([{ field: 'limits.maxTokensPerInterval', code: 'invalid' }])
  } finally { await h.close() }
})

it('reserves concurrent durable acceptance and allows a new checkpoint on the one already-held run', async () => {
  const h = await fixture('json', { maxHeldRuns: 1, maxPendingPreparations: 1 })
  try {
    const [first, second] = await Promise.allSettled([h.administration.create(h.input, call()),
      h.administration.create({ ...h.input, commandId: 'other-create' as never }, call())])
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'SIMULATION_PRODUCT_UNAVAILABLE' } })
    const original = await finished(h)
    const attempt = { runId: original.runId, commandId: 'prepare-held' as never }
    await h.administration.prepare(attempt, call())
    expect((await finished(h, attempt.commandId)).status).toBe('completed')
    const inspected = await h.ctx.simulationProducts.browse({ runId: original.runId, collection: 'checkpoints' }, call())
    expect(inspected.items.map(value => value.id)).toContain('product-preparation/prepare-held')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('refuses new retained requests at capacity while keeping original outcome queries and retries available', async () => {
  const h = await fixture('json', { maxCommands: 1 })
  try {
    await h.administration.create(h.input, call())
    const original = await finished(h)
    await expect(h.administration.create({ ...h.input, commandId: 'second' as never }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    await expect(h.administration.prepare({ runId: original.runId, commandId: 'prepare' as never }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    expect(await h.administration.create(h.input, call())).toEqual(original)
    expect(await h.administration.request({ commandId: h.input.commandId }, call())).toEqual({ status: 'found', request: original })
  } finally { await h.close() }
})

it('keeps pending requests queryable while refusing concurrent preparation of the same run', async () => {
  const h = await fixture()
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  try {
    const ensure = h.ctx.simulationTeams.ensureTeam.bind(h.ctx.simulationTeams)
    vi.spyOn(h.ctx.simulationTeams, 'ensureTeam').mockImplementationOnce(async (...args) => { await wait; return ensure(...args) })
    const receipt = await h.administration.create(h.input, call())
    expect(await h.administration.create(h.input, call())).toEqual(receipt)
    expect(await h.administration.request({ commandId: h.input.commandId }, call())).toEqual({ status: 'found', request: receipt })
    await expect(h.administration.prepare({ runId: receipt.runId, commandId: 'parallel' as never }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    await expect(h.administration.prepare({ runId: receipt.runId, commandId: 'private' as never }, call(undefined, 'other')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(await h.administration.request({ commandId: h.input.commandId }, call(undefined, 'other')))
      .toEqual({ status: 'not-found', commandId: h.input.commandId })
  } finally { release(); await h.close() }
})

it('leaves terminal-write failure accepted and explicitly reconciles the same identities after restart', async () => {
  const h = await fixture()
  try {
    const stream = h.ctx.storageLog.get('product-commands')!
    const append = stream.append.bind(stream)
    vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      const entry = args[1][0] as { kind: string }
      if (entry.kind === 'command/completed') throw new Error('terminal-storage-unavailable')
      return append(...args)
    })
    const original = await h.administration.create(h.input, call())
    await h.fiber.dispose()
    await h.mount()
    expect(await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call()))
      .toEqual({ status: 'found', request: original })
    expect((await h.ctx.simulationProducts.inspect({ runId: original.runId }, call())).world?.owner).toBe('unowned')
    expect(await h.ctx.simulationAdministration.create(h.input, call())).toEqual(original)
    expect((await finished(h)).status).toBe('completed')
    expect((await h.ctx.simulationProducts.list({}, call())).items).toHaveLength(1)
  } finally { await h.close() }
})

it('rejects transport retirement, complete-byte excess and stock excess before durable acceptance', async () => {
  const h = await fixture('json', { maxBytes: 1000, maxTextBytes: 4 })
  try {
    const controller = new AbortController(); controller.abort()
    await expect(h.administration.catalog(call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect((await h.administration.catalog(call())).items[0]?.name).toEqual({ text: 'Comp', truncated: true })
    await expect(h.administration.create({ ...h.input, name: 'x'.repeat(1500) }, call())).rejects.toThrow('byte allowance')
    await expect(h.administration.create({ ...h.input, parameters: { ...h.input.parameters, initialStock: '10001' } }, call()))
      .rejects.toThrow('parameters.initialStock')
    expect(h.ctx.storageLog.get('product-commands')?.tailSequence).toBe(-1)
    const original = await h.administration.create(h.input, call())
    await finished(h)
    await expect(h.administration.prepare({ runId: original.runId, commandId: 'x'.repeat(1200) as never }, call()))
      .rejects.toThrow('byte allowance')
    expect(h.ctx.storageLog.get('product-commands')?.tailSequence).toBe(1)
    await h.fiber.dispose()
    await expect(h.administration.catalog(call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  } finally { await h.close() }
})

it('validates independent deployment bounds and installed model routes at activation', async () => {
  const h = await fixture('json', { maxCommands: 3, maxTemplates: 2, maxPendingRequests: 2, maxPendingPreparations: 2,
    maxHeldRuns: 2, maxBytes: 10000, maxEntryBytes: 10000, maxTextBytes: 40 })
  try {
    await h.fiber.dispose()
    for (const options of [{ journalStream: ' ' }, { maxCommands: Number.MAX_SAFE_INTEGER + 1 },
      { templates: [h.template, h.template] }, { maxTemplates: 1, templates: [h.template, { ...h.template, id: 'second' as never }] },
      { templates: [{ ...h.template, driver: { ...h.template.driver, model: { provider: 'not-installed', name: 'scripted' } } }] }]) {
      const fiber = h.mount(options)
      await expect(Promise.resolve(fiber)).rejects.toThrow()
      await fiber.dispose()
    }
    const replacement = h.mount()
    await replacement
    expect((await h.ctx.simulationAdministration.catalog(call())).items).toHaveLength(1)
  } finally { await h.close() }
})

it('resolves defaults for trusted direct construction before accepting a command', async () => {
  const h = await fixture()
  try {
    await h.fiber.dispose()
    await h.ctx.plugin({ inject: Administration.inject, async apply(ctx) {
      const owner = new Administration(ctx, { journalStream: 'product-commands', templates: [h.template] })
      expect((await owner.catalog(call())).items).toHaveLength(1)
    } })
    const receipt = await h.ctx.simulationAdministration.create(h.input, call())
    expect((await finished(h)).runId).toBe(receipt.runId)
  } finally { await h.close() }
})

it('bounds initialization waiters and rechecks authentication while waiting for provider IO', async () => {
  const h = await fixture('json', { maxPendingRequests: 1 })
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  try {
    await h.fiber.dispose()
    const resolve = h.ctx.agentPresets.resolve.bind(h.ctx.agentPresets)
    vi.spyOn(h.ctx.agentPresets, 'resolve').mockImplementationOnce(async (...args) => { entered(); await wait; return resolve(...args) })
    const mounting = h.mount()
    await started
    const pending = h.ctx.simulationAdministration.catalog(call())
    await expect(h.ctx.simulationAdministration.catalog(call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    release(); await mounting; await pending
  } finally { release(); await h.close() }
})

it('refuses takeover of a native owner and retains explicit recovery responsibility', async () => {
  const h = await fixture()
  let foreign: Awaited<ReturnType<typeof h.ctx.simulations.open>> | undefined
  try {
    const inspect = h.ctx.simulations.inspect.bind(h.ctx.simulations)
    vi.spyOn(h.ctx.simulations, 'inspect').mockImplementationOnce(async (selection) => {
      foreign = await h.ctx.simulations.open(h.ctx.simulations.resolve({ provider: selection.provider, spec: selection.spec, mode: 'create' }))
      return inspect(selection)
    })
    const original = await h.administration.create(h.input, call())
    expect(await finished(h)).toMatchObject({ runId: original.runId, status: 'failed', failure: 'recovery-required' })
    expect(h.requests).toEqual([])
  } finally { await foreign?.close(); await h.close() }
})

it('does not close its command stream when native retirement remains unconfirmed', async () => {
  const h = await fixture()
  try {
    await h.administration.create(h.input, call())
    await finished(h)
    const open = h.ctx.simulations.open.bind(h.ctx.simulations)
    await h.fiber.dispose()
    const remounted = h.mount()
    await remounted
    let owned: Awaited<ReturnType<typeof open>> | undefined
    vi.spyOn(h.ctx.simulations, 'open').mockImplementationOnce(async (...args) => { owned = await open(...args); return owned })
    const original = await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())
    if (original.status !== 'found') throw new Error('Original creation missing')
    const input = { runId: original.request.runId, commandId: 'prepare-retirement' as never }
    await h.ctx.simulationAdministration.prepare(input, call())
    await finished(h, input.commandId)
    if (owned === undefined) throw new Error('Preparation did not acquire native ownership')
    vi.spyOn(owned, 'close').mockRejectedValueOnce(new Error('retirement-unconfirmed'))
    const stream = h.ctx.storageLog.get('product-commands')!
    const close = vi.spyOn(stream, 'close')
    await remounted.dispose()
    expect(close).not.toHaveBeenCalled()
    await owned.close()
    await stream.close()
  } finally { await h.close() }
})

it('retains a partially prepared handle when failure cleanup cannot confirm retirement', async () => {
  const h = await fixture()
  try {
    const open = h.ctx.simulations.open.bind(h.ctx.simulations)
    let close: MockInstance<() => Promise<void>> | undefined
    vi.spyOn(h.ctx.simulations, 'open').mockImplementationOnce(async (...args) => {
      const run = await open(...args)
      close = vi.spyOn(run, 'close').mockRejectedValueOnce(new Error('cleanup-unconfirmed'))
      return run
    })
    vi.spyOn(h.ctx.simulationTeams, 'ensureTeam').mockRejectedValueOnce(new Error('partial-preparation-failed'))
    const original = await h.administration.create(h.input, call())
    await vi.waitFor(() => { expect(close).toHaveBeenCalledTimes(1) })
    expect(await h.administration.request({ commandId: h.input.commandId }, call())).toEqual({ status: 'found', request: original })
    await h.fiber.dispose()
    expect(close).toHaveBeenCalledTimes(2)
    await h.mount()
    await h.ctx.simulationAdministration.create(h.input, call())
    expect((await finished(h)).status).toBe('completed')
  } finally { await h.close() }
})

it('rejects changed original payloads, other principals and undeployed templates before another allocation', async () => {
  const h = await fixture()
  try {
    await h.administration.create(h.input, call())
    await expect(h.administration.create({ ...h.input, name: 'Different' }, call())).rejects.toThrow('another original payload')
    await expect(h.administration.create(h.input, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await expect(h.administration.create({ ...h.input, commandId: 'different' as never, templateId: 'missing' as never }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    expect((await h.ctx.simulationProducts.list({}, call())).items.length).toBeLessThanOrEqual(1)
  } finally { await h.close() }
})

it('retains an accepted allocation when the authenticated waiter retires after append', async () => {
  const h = await fixture()
  try {
    const append = h.ctx.storageLog.get('product-commands')!.append.bind(h.ctx.storageLog.get('product-commands')!)
    const controller = new AbortController()
    vi.spyOn(h.ctx.storageLog.get('product-commands')!, 'append').mockImplementationOnce(async (...args) => {
      const value = await append(...args); controller.abort(); return value
    })
    await expect(h.administration.create(h.input, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect((await finished(h)).status).toBe('completed')
    expect((await h.ctx.simulationProducts.list({}, call())).items).toHaveLength(1)
  } finally { await h.close() }
})

it('retains a failed preparation and accepts a new attempt on the original allocated run', async () => {
  const h = await fixture()
  try {
    vi.spyOn(h.ctx.simulationTeams, 'ensureTeam').mockRejectedValueOnce(new Error('temporary-bootstrap-failure'))
    const original = await h.administration.create(h.input, call())
    const failed = await finished(h)
    expect(failed).toMatchObject({ status: 'failed', failure: 'preparation-required', runId: original.runId })
    expect(await h.administration.create(h.input, call())).toEqual(failed)
    const attempt = { runId: original.runId, commandId: 'prepare-new' as never }
    const receipt = await h.administration.prepare(attempt, call())
    expect(receipt.runId).toBe(original.runId)
    expect((await finished(h, attempt.commandId)).status).toBe('completed')
    expect(await h.administration.prepare(attempt, call())).toMatchObject({ status: 'completed' })
    expect(await h.administration.request({ commandId: h.input.commandId }, call())).toEqual({ status: 'found', request: failed })
    expect((await h.ctx.simulationProducts.list({}, call())).items).toHaveLength(1)
  } finally { await h.close() }
})

it('exposes catalog/create/query through authenticated Host fetch and rejects substituted command replies', async () => {
  const h = await fixture()
  try {
    const { createApiProxy, toFetchHandler } = await import('@clocky/clocky-host-apiproxy')
    const { InProcessApiClient } = await import('@clocky/clocky-host-apiproxy/client')
    const { RpcId } = await import('@clocky/clocky-host-apiproxy/api/rpc')
    const { withAuthenticatedProductCall } = await import('../../../host/apiproxy/src/authenticated-product-call.ts')
    const { default: UserQuestions } = await import('@clocky/clocky-user-questions')
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    expect((await client.simulations.catalog({})).result).toMatchObject({ ok: true, value: { items: [{ id: 'company', execution: 'cognition-only' }] } })
    const receipt = await client.simulations.create(h.input)
    expect(receipt.result.ok).toBe(true)
    expect((await client.simulations.request({ commandId: h.input.commandId })).result).toMatchObject({ ok: true, value: { status: 'found' } })
    const completed = await finished(h)
    const preparation = { runId: completed.runId, commandId: 'fetch-prepare' as never }
    expect((await client.simulations.prepare(preparation)).result).toMatchObject({ ok: true, value: { kind: 'prepare', status: 'accepted' } })
    const prepared = await finished(h, preparation.commandId)
    for (const value of [{ ...prepared, runId: 'different' as never }, { ...prepared, kind: 'create' as const }]) {
      vi.spyOn(h.administration, 'prepare').mockResolvedValueOnce(value)
      await expect(client.simulations.prepare(preparation)).rejects.toThrow('original command')
    }
    vi.spyOn(h.administration, 'create').mockResolvedValueOnce({ ...completed, kind: 'prepare' })
    await expect(client.simulations.create(h.input)).rejects.toThrow('original command')
    for (const value of [{ status: 'not-found' as const, commandId: 'different' as never },
      { status: 'found' as const, request: { ...completed, commandId: 'different' as never } }]) {
      vi.spyOn(h.administration, 'request').mockResolvedValueOnce(value)
      await expect(client.simulations.request({ commandId: h.input.commandId })).rejects.toThrow('original command')
    }
    expect((await api.simulations!.create({ rpcId: RpcId('unauthenticated'), payload: h.input })).result)
      .toMatchObject({ ok: false, error: { code: 'PRODUCT_AUTH_REQUIRED' } })
    vi.spyOn(h.administration, 'create').mockResolvedValueOnce({ commandId: 'substituted' as never,
      kind: 'create', runId: 'foreign' as never, status: 'accepted', acceptedAt: 1 })
    await expect(client.simulations.create(h.input)).rejects.toThrow('original command')
    await withAuthenticatedProductCall(call(), async () => { await h.administration.request({ commandId: 'unknown' as never }, call()) })
  } finally { await h.close() }
})
