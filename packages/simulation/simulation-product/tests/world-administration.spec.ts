import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import UserQuestions from '@clocky/clocky-user-questions'
import { createApiProxy, InProcessApiClient, toFetchHandler } from '@clocky/clocky-host-apiproxy'
/** Original World commands share the authenticated product journal and actual Native/Team bootstrap. */
import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import type { Config } from '../src/administration.ts'
import { simulationProductCommandIdSchema, simulationProductPrepareInputSchema } from '../src/administration-schema.ts'
import { simulationProductWorldCreateInputSchema } from '../src/world-schema.ts'
import { simulationProductRestoreInputSchema } from '../src/maintenance-schema.ts'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { simulationCreationEntrySchema, foldCreationEntry } from '../src/creation-book.ts'
import type { SimulationCreationBook } from '../src/creation-types.ts'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { sample as v1Definition } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'
import AgentDefaultModel from '@clocky/clocky-agent-default-model'

afterEach(() => { vi.restoreAllMocks() })

it('binds a default-model World to its reviewed route and retries its accepted original after settings change', async () => {
  const h = await fixture('json')
  try {
    await h.fiber.dispose()
    await h.ctx.plugin(AgentDefaultModel, { provider: 'company', model: 'scripted' })
    const selected = vi.spyOn(h.ctx.agentDefaultModel, 'currentSelection')
    const options: Config = Object.assign({}, h.options, { world: { ...h.options.world!, model: { source: 'agent-default' as const } } })
    await h.mount(options)
    const owner = h.ctx.simulationAdministration
    const preview = await owner.preflightWorld({ definition: h.input.definition }, call())
    if (preview.status !== 'ready') throw new Error(JSON.stringify(preview))
    const input = { ...h.input, preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }
    selected.mockReturnValue({ provider: 'company', model: 'different' })
    await expect(owner.createWorld(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_PREFLIGHT_CHANGED' })
    expect((await h.ctx.simulationProducts.list({}, call())).items).toEqual([])
    selected.mockReturnValue({ provider: 'company', model: 'scripted' })
    const created = await owner.createWorld(input, call())
    expect((await h.finished()).status).toBe('completed')
    selected.mockReturnValue(undefined)
    expect(await owner.createWorld(input, call())).toMatchObject({ runId: created.runId, status: 'completed' })
    const control = await owner.control({ runId: created.runId }, call())
    expect(control.budget.model).toEqual({ provider: 'company', name: 'scripted' })
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
async function fixture(backend: 'json' | 'sqlite', scenario = 'company', overrides: Partial<Config> = {}) {
  const h = await companyFixture(backend, false)
  let closing: Promise<void> | undefined
  const close = () => closing ??= h.close()
  onTestFinished(close)
  await h.ctx.plugin(Products, { directoryStream: 'world-products' })
  const installed = catalog()
  installed.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  const options: Config = { journalStream: 'world-original-commands', templates: [],
    world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }, ...overrides }
  const terminals = new Map<string, ReturnType<typeof Promise.withResolvers<undefined>>>()
  const terminal = (commandId: string) => {
    let completion = terminals.get(commandId)
    if (completion === undefined) { completion = Promise.withResolvers<undefined>(); terminals.set(commandId, completion) }
    return completion
  }
  const mount = async (config = options) => {
    const fiber = h.ctx.plugin(Administration, config)
    await fiber
    const stream = h.ctx.storageLog.get(config.journalStream)!
    const append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const result = await append(...args)
      for (const value of args[1]) {
        const entry = simulationCreationEntrySchema.parse(value)
        // The store folds the terminal after append returns; observe it on the next event-loop turn.
        if (entry.kind !== 'command/accepted') setImmediate(() => { terminal(entry.commandId).resolve(undefined) })
      }
      return result
    }
    return fiber
  }
  const fiber = await mount()
  const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
  const preview = await h.ctx.simulationAdministration.preflightWorld({ definition }, call())
  if (preview.status !== 'ready') throw new Error(JSON.stringify(preview.diagnostics))
  const input = simulationProductWorldCreateInputSchema.parse({ commandId: 'original-world', name: 'Portable World', definition,
    preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } })
  const finished = async (commandId = input.commandId) => {
    let outcome = await h.ctx.simulationAdministration.request({ commandId }, call())
    if (outcome.status === 'found' && outcome.request.status === 'accepted') {
      // Preparation has no one-second SLA; retain the test deadline and wait for this exact durable result.
      await terminal(commandId).promise
      outcome = await h.ctx.simulationAdministration.request({ commandId }, call())
    }
    expect(outcome.status).toBe('found')
    if (outcome.status !== 'found') throw new Error('Original command is absent')
    expect(outcome.request.status).not.toBe('accepted')
    return outcome.request
  }
  return { ...h, close, options, mount, fiber, input, finished, preview }
}

it.each(['json', 'sqlite'] as const)('records missing execution providers before retiring the held %s World owner', async (backend) => {
  const h = await fixture(backend)
  const publication = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    let owned: SimulationRun | undefined
    const originalOpen = h.ctx.simulations.open.bind(h.ctx.simulations)
    const open = vi.spyOn(h.ctx.simulations, 'open').mockImplementation(async (selection) => {
      const run = await originalOpen(selection); owned = run; return run
    })
    const created = await h.ctx.simulationAdministration.createWorld(h.input, call())
    expect((await h.finished()).status).toBe('completed')
    if (owned === undefined) throw new Error('Original World owner is absent')
    const before = owned.snapshot(), checkpoint = Object.values(before.checkpoints ?? {}).find(value => value.status === 'completed')
    if (checkpoint === undefined) throw new Error('Original complete checkpoint is absent')
    const close = vi.spyOn(owned, 'close'), attach = vi.spyOn(h.ctx.simulationTeams, 'attach'), models = vi.spyOn(h.ctx.llm, 'stream')
    await h.worldExecutionsFiber.dispose()
    open.mockClear()
    const request = simulationProductRestoreInputSchema.parse({ runId: created.runId, checkpointId: checkpoint.request.id,
      commandId: 'missing-execution-provider' })
    const stream = h.ctx.storageLog.get(h.options.journalStream)!
    const append = stream.append.bind(stream)
    vi.spyOn(stream, 'append').mockImplementation(async (...args) => {
      if (args[1].some((value) => {
        const entry = simulationCreationEntrySchema.parse(value)
        return entry.kind === 'command/failed' && entry.commandId === request.commandId
      })) { publication.resolve(undefined); await release.promise }
      return await append(...args)
    })
    await h.ctx.simulationAdministration.restore(request, call())
    await publication.promise
    let settled = false
    const completion = h.finished(request.commandId).then((receipt) => { settled = true; return receipt })
    // The earlier creation terminal and an attempted failure append cannot complete this restore.
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    expect(await h.ctx.simulationAdministration.request({ commandId: request.commandId }, call()))
      .toMatchObject({ status: 'found', request: { status: 'accepted' } })
    expect(owned.snapshot()).toEqual(before)
    release.resolve(undefined)
    const receipt = await completion
    expect(receipt).toMatchObject({ kind: 'restore', status: 'failed', failure: 'restore-failed' })
    expect(close).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled()
    expect(models).not.toHaveBeenCalled(); expect(owned.snapshot()).toEqual(before)
    expect(await h.ctx.simulationAdministration.restore(request, call())).toEqual(receipt)
    expect(owned.snapshot()).toEqual(before)
  } finally { release.resolve(undefined); await h.close() }
})

it.each([['json', 'company'], ['sqlite', 'company'], ['json', 'laboratory'], ['sqlite', 'laboratory']] as const)(
  'creates one inert %s %s from its accepted original command and returns exact retries and portable export', async (backend, scenario) => {
    const h = await fixture(backend, scenario)
    try {
      const administration = h.ctx.simulationAdministration
      const [first, duplicate] = await Promise.all([
        administration.createWorld(h.input, call()), administration.createWorld(h.input, call()),
      ])
      expect(first.runId).toBe(duplicate.runId)
      const completed = await h.finished()
      expect(completed).toMatchObject({ kind: 'world-create', runId: first.runId, status: 'completed' })
      expect(await administration.createWorld(h.input, call())).toEqual(completed)
      const directory = await h.ctx.simulationProducts.inspect({ runId: first.runId }, call())
      expect(directory).toMatchObject({ run: { id: first.runId }, world: { phase: 'paused' } })
      const exported = await administration.exportWorldDefinition({ runId: first.runId }, call())
      expect(exported).toEqual({ runId: first.runId, definition: h.input.definition })
      expect(JSON.stringify(exported.definition)).not.toMatch(/sessionId|participantId|channelId|runId|credential|world-original-commands/)
      const again = await administration.preflightWorld({ definition: exported.definition }, call())
      expect(again).toEqual(h.preview)
      const page = await administration.listRequests({ runId: first.runId }, call())
      expect(page.items).toEqual([completed])
      expect(await administration.retryRequest({ runId: first.runId, commandId: h.input.commandId }, call())).toEqual(completed)
      await expect(administration.createWorld({ ...h.input, name: 'Another intent' }, call())).rejects.toThrow(/another original payload/)
      await expect(administration.createWorld(h.input, call(new AbortController(), 'other'))).rejects.toThrow(/access is unavailable/)
      expect(await administration.request({ commandId: h.input.commandId }, call(new AbortController(), 'other')))
        .toEqual({ status: 'not-found', commandId: h.input.commandId })
      await expect(administration.exportWorldDefinition({ runId: first.runId }, call(new AbortController(), 'other'))).rejects.toThrow(/access is unavailable/)
      expect(h.requests).toEqual([])
      expect(await h.ctx.sessionPersistence.list()).toEqual([])
      expect((await h.ctx.simulationProducts.list({}, call())).items).toHaveLength(1)
    } finally { await h.close() }
  })

it.each(['json', 'sqlite'] as const)('rejects stale %s previews without any original command or Native identity allocation', async (backend) => {
  const h = await fixture(backend)
  try {
    const open = vi.spyOn(h.ctx.simulations, 'open'), create = vi.spyOn(h.ctx.teams, 'createTeam')
    for (const preflight of [{ ...h.input.preflight, hash: `sha256:${'a'.repeat(64)}` },
      { ...h.input.preflight, catalogGeneration: 'another-deployment' }]) {
      await expect(h.ctx.simulationAdministration.createWorld({ ...h.input, preflight }, call())).rejects.toThrow(/preview changed/)
    }
    expect(await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())).toMatchObject({ status: 'not-found' })
    expect(open).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('retains a %s failed original and reconciles a new preparation against the same frozen allocation', async (backend) => {
  const h = await fixture(backend)
  try {
    const bootstrap = vi.spyOn(h.ctx.simulationTeams, 'ensureTeam').mockRejectedValueOnce(new Error('Identity preparation interrupted'))
    const original = await h.ctx.simulationAdministration.createWorld(h.input, call())
    expect(await h.finished()).toMatchObject({ runId: original.runId, status: 'failed', failure: 'preparation-required' })
    bootstrap.mockRestore()
    const retry = simulationProductPrepareInputSchema.parse({ runId: original.runId, commandId: 'resume-original-allocation' })
    expect((await h.ctx.simulationAdministration.prepareWorld(retry, call())).runId).toBe(original.runId)
    expect(await h.finished(retry.commandId)).toMatchObject({ kind: 'world-prepare', status: 'completed' })
    const originalFact = await h.ctx.simulationAdministration.request({ commandId: h.input.commandId }, call())
    expect(originalFact).toMatchObject({ status: 'found', request: { status: 'failed' } })
    expect((await h.ctx.simulationProducts.list({}, call())).items).toHaveLength(1)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('replays the complete original World command after catalog removal without inferring or regenerating it', async () => {
  const h = await fixture('json')
  try {
    const original = await h.ctx.simulationAdministration.createWorld(h.input, call())
    const completed = await h.finished()
    const exported = await h.ctx.simulationAdministration.exportWorldDefinition({ runId: original.runId }, call())
    await h.fiber.dispose()
    await h.mount(Object.assign({}, h.options, { world: undefined }))
    const open = vi.spyOn(h.ctx.simulations, 'open')
    expect(await h.ctx.simulationAdministration.createWorld(h.input, call())).toEqual(completed)
    expect(await h.ctx.simulationAdministration.exportWorldDefinition({ runId: original.runId }, call())).toEqual(exported)
    expect(open).not.toHaveBeenCalled()
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('fails closed on foreign original-family preparation and carries original authenticated owner through journal replay', async () => {
  const h = await fixture('json')
  try {
    const receipt = await h.ctx.simulationAdministration.createWorld(h.input, call())
    await h.finished()
    await expect(h.ctx.simulationAdministration.prepare({ runId: receipt.runId,
      commandId: simulationProductCommandIdSchema.parse('wrong-family') }, call())).rejects.toThrow(/original company creation/)
    const stream = h.ctx.storageLog.get('world-original-commands')
    if (stream === undefined) throw new Error('Original product journal missing')
    const entries = await stream.read(-1, 100)
    let book: SimulationCreationBook = { commands: new Map(), creations: new Map() }
    for (const entry of entries) book = foldCreationEntry(book, entry.value)
    const creation = book.creations.get(receipt.runId)
    expect(creation).toMatchObject({ kind: 'world', record: { ownerPrincipalId: call().principal.id } })
    const accepted = entries.map(entry => simulationCreationEntrySchema.parse(entry.value)).find(entry => entry.kind === 'command/accepted')
    if (accepted?.kind !== 'command/accepted') throw new Error('Original command missing')
    const forged = { ...accepted, command: { ...accepted.command, ownerPrincipalId: 'another-principal' } }
    expect(() => { simulationCreationEntrySchema.parse(forged) }).toThrow()
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('returns an accepted %s original when a concurrent preflight later becomes unavailable', async (backend) => {
  const h = await fixture(backend)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  try {
    vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockImplementationOnce(async () => {
      entered.resolve(undefined); await release.promise
      throw new Error('Model metadata became unavailable')
    })
    const waiting = h.ctx.simulationAdministration.createWorld(h.input, call())
    await entered.promise
    const accepted = await h.ctx.simulationAdministration.createWorld(h.input, call())
    release.resolve(undefined)
    expect(await waiting).toMatchObject({ commandId: accepted.commandId, runId: accepted.runId, kind: 'world-create' })
    await h.finished()
    expect((await h.ctx.simulationProducts.list({}, call())).items).toHaveLength(1)
  } finally { release.resolve(undefined); await h.close() }
})

it('publishes only configured World authoring templates as detached complete definitions', async () => {
  const h = await fixture('json')
  try {
    expect(await h.ctx.simulationAdministration.catalog(call())).not.toHaveProperty('worldTemplates')
    await h.fiber.dispose()
    const published = { id: 'public-world', version: '1', name: 'Published World', definition: structuredClone(v1Definition) }
    const options = Object.assign({}, h.options, { world: { ...h.options.world!, authoringTemplates: [published] } })
    const fiber = await h.mount(options)
    const value = await h.ctx.simulationAdministration.catalog(call())
    expect(value.worldTemplates).toEqual([published])
    value.worldTemplates![0]!.definition.metadata.name = 'Changed response'
    expect((await h.ctx.simulationAdministration.catalog(call())).worldTemplates).toEqual([published])
    expect(await h.ctx.simulationProducts.list({}, call())).toMatchObject({ items: [] })
    expect(h.requests).toEqual([])
    await fiber.dispose()
    for (const world of [{ ...options.world, authoringTemplates: [published, published] },
      { ...options.world, authoringTemplates: [{ ...published, definition: { ...published.definition, secret: 'extra' } }] }]) {
      await expect(h.mount(Object.assign({}, options, { world }))).rejects.toThrow()
    }
    await expect(h.mount(Object.assign({}, options, { maxTemplates: 1 }))).rejects.toThrow(/capacity/)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('retains an authorized original archive across failed publication and restart on %s', async (backend) => {
  const h = await fixture(backend)
  await h.ctx.plugin(UserQuestions)
  const client = new InProcessApiClient(toFetchHandler(createApiProxy(h.ctx, { cwd: process.cwd(),
    defaultModelSelection: () => undefined }),
  { authenticatedProductCall: call() }))
  let owned: SimulationRun | undefined
  const originalOpen = h.ctx.simulations.open.bind(h.ctx.simulations)
  vi.spyOn(h.ctx.simulations, 'open').mockImplementation(async (selection) => { const run = await originalOpen(selection); owned = run; return run })
  try {
    const created = await h.ctx.simulationAdministration.createWorld(h.input, call())
    expect((await h.finished()).status).toBe('completed')
    if (owned === undefined) throw new Error('Original World owner is absent')
    const runId = created.runId, initialRevision = owned.snapshot().revision
    const preview = await client.simulations.retentionPreview({ runId })
    expect(preview.result.ok).toBe(true)
    if (!preview.result.ok) throw new Error('Retention preview carrier rejected the owner')
    const plan = preview.result.value
    expect(owned.snapshot().revision).toBe(initialRevision)
    expect(h.requests).toHaveLength(0)
    expect(plan).toMatchObject({ destructive: false, reclaimableBytes: 0, pinPolicy: 'complete-owner-history' })
    await owned.setPhase('running', initialRevision)
    const runningRevision = owned.snapshot().revision
    await expect(h.ctx.simulationAdministration.retentionPreview({ runId }, call())).rejects.toThrow(/paused/)
    expect(owned.snapshot().revision).toBe(runningRevision)
    await owned.setPhase('paused', runningRevision)
    const refreshed = await h.ctx.simulationAdministration.retentionPreview({ runId }, call())
    const input = { runId, commandId: simulationProductCommandIdSchema.parse('archive-original'),
      expectedRevision: refreshed.snapshotRevision, planHash: refreshed.planHash }
    const openLog = h.ctx.storageLog.open.bind(h.ctx.storageLog)
    let fail = true
    const capture = vi.spyOn(h.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
      const stream = await openLog(descriptor)
      if (descriptor.name.endsWith('/retention')) {
        const append = stream.append.bind(stream)
        stream.append = async (...args) => {
          if (fail && (args[1][0] as { kind?: string }).kind === 'completed') { fail = false; throw new Error('Injected archive publication failure') }
          return append(...args)
        }
      }
      return stream
    })
    await expect(h.ctx.simulationAdministration.retentionExecute(input, call())).rejects.toThrow(/Injected/)
    expect(await client.simulations.retentionRead({ runId, commandId: input.commandId })).toMatchObject({ result: { ok: true, value: { status: 'accepted', plan: refreshed } } })
    const completion = await client.simulations.retentionExecute(input)
    expect(completion.result.ok).toBe(true)
    if (!completion.result.ok) throw new Error('Retention execute carrier rejected the original')
    const completed = completion.result.value
    expect(completed).toMatchObject({ status: 'completed', archiveHash: refreshed.planHash })
    expect(await h.ctx.simulationAdministration.retentionExecute(input, call())).toEqual(completed)
    await expect(h.ctx.simulationAdministration.retentionExecute({ ...input, planHash: '0'.repeat(64) }, call())).rejects.toThrow(/another original/)
    const page = { runId, commandId: input.commandId, owner: 'native' as const, ownerId: runId, afterSequence: -1, limit: 2 }
    await expect(h.ctx.simulationAdministration.retentionRecords(page, call())).rejects.toThrow()
    await expect(h.ctx.simulationAdministration.backupExport({ runId, commandId: input.commandId }, call())).rejects.toThrow()
    const revoke = h.ctx.simulationProducts.recordReaderRegistrar()([{ principalId: call().principal.id, runId }])
    expect(await client.simulations.retentionRecords(page)).toMatchObject({ result: { ok: true, value: { archiveHash: refreshed.planHash,
      entries: [{ sequence: 0 }, { sequence: 1 }], hasMore: true } } })
    await h.ctx.simulationAdministration.backupExport({ runId, commandId: input.commandId }, call())
    const exported = await client.simulations.backupExport({ runId, commandId: input.commandId })
    expect(exported.result.ok).toBe(true)
    if (!exported.result.ok) throw new Error('Private backup export carrier rejected the original')
    const exportedBundle: unknown = JSON.parse(exported.result.value.bundle)
    expect(exportedBundle).toMatchObject({ manifest: { format: 'world-backup/1',
      bodyHash: refreshed.planHash, executionPolicy: { realEffects: 'disabled', activation: 'explicit-start' } } })
    expect(await h.ctx.simulationAdministration.backupExport({ runId, commandId: input.commandId }, call())).toEqual(exported.result.value)
    expect(h.requests).toHaveLength(0)
    revoke()
    await expect(h.ctx.simulationAdministration.backupExport({ runId, commandId: input.commandId }, call())).rejects.toThrow()
    await expect(h.ctx.simulationAdministration.retentionRecords(page, call())).rejects.toThrow()
    await expect(h.ctx.simulationAdministration.retentionRead({ runId, commandId: input.commandId }, call(new AbortController(), 'other'))).rejects.toThrow()
    capture.mockRestore()
    await h.fiber.dispose(); const restored = await h.mount()
    try {
      const releaseRead = h.ctx.simulationProducts.recordReaderRegistrar()([{ principalId: call().principal.id, runId }])
      try {
        const originalBackup = await h.ctx.simulationAdministration.backupExport({ runId, commandId: input.commandId }, call())
        expect(originalBackup).toEqual(exported.result.value)
      } finally { releaseRead() }
      expect(await h.ctx.simulationAdministration.retentionRead({ runId, commandId: input.commandId }, call())).toEqual(completed)
      expect(await h.ctx.simulationAdministration.retentionExecute(input, call())).toEqual(completed)
      expect(h.requests).toHaveLength(0)
    } finally { await restored.dispose() }
  } finally { await h.close() }
}, 60000)


it('discards the previous batch stop after a World driver failure without repeating inference', async () => {
  const h = await fixture('json', 'company', { driverIntervalMs: 1 })
  try {
    const service = h.ctx.simulationAdministration
    const created = await service.createWorld(h.input, call())
    expect((await h.finished()).status).toBe('completed')
    const before = await service.control({ runId: created.runId }, call())
    const advance = vi.spyOn(SimulationWorldDriver.prototype, 'advance')
      .mockResolvedValueOnce({ reason: 'work-limit', controlSteps: 1, time: '0' as never, revision: before.revision! })
      .mockRejectedValue(new Error('private provider diagnostic'))
    await service.manage({ runId: created.runId, managementId: 'start-failure-test' as never, phase: 'running' }, call())
    await vi.waitFor(async () => {
      expect((await service.control({ runId: created.runId }, call())).driver).toBe('failed')
    }, { timeout: 5000 })
    const failed = await service.control({ runId: created.runId }, call())
    expect(failed.stop).toBeUndefined()
    expect(failed.failure).toMatchObject({ category: 'unknown', retryDisposition: 'unknown', revision: failed.revision! - 1 })
    expect(failed.actions.start).toEqual({ allowed: false, reason: 'driver-failed' })
    expect(JSON.stringify(failed)).not.toContain('private provider')
    await service.manage({ runId: created.runId, managementId: 'pause-failure-test' as never, phase: 'paused' }, call())
    expect(advance).toHaveBeenCalledTimes(2)
  } finally { await h.close() }
})

it('reports World preflight capability dimensions and context-window violations without allocating a run', async () => {
  const h = await fixture('json')
  try {
    const capabilities = h.preview.status === 'ready' ? h.preview.capabilities : undefined
    if (capabilities === undefined || h.preview.status !== 'ready') throw new Error('Ready preflight lacks capabilities')
    expect(capabilities.tokensPerRequest).toBe(h.preview.limits.native.tokensPerModelRequest)
    expect(capabilities.clocks.native).toEqual({ unit: h.preview.tickUnit, maxTime: h.preview.maxTime })
    expect(['complete', 'external-state-required', 'unknown']).toContain(capabilities.backup)
    expect(capabilities).toMatchObject({ initialContext: 'unknown', longRunUsage: 'unknown' })
    expect(capabilities.models.length).toBeGreaterThan(0)
    // A route whose disclosed window cannot hold one allowed request is reported with both values.
    vi.spyOn(h.ctx.llm, 'resolveModelInfo').mockResolvedValue({ provider: 'company', id: 'scripted', name: 'scripted',
      context: { contextWindow: 1000 } })
    const narrow = await h.ctx.simulationAdministration.preflightWorld({ definition: h.input.definition }, call())
    if (narrow.status !== 'ready' || narrow.capabilities === undefined) throw new Error('Ready preflight lacks capabilities')
    expect(narrow.capabilities.violations[0]).toMatchObject({ dimension: 'context-window', actual: 1000,
      required: narrow.capabilities.tokensPerRequest })
    expect((await h.ctx.simulationProducts.list({}, call())).items).toEqual([])
  } finally { await h.close() }
})
