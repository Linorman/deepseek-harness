/** Actual Product commands retain separate branch provenance and run a fresh paused World through restore/start. */
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { worldScenarioSchema, scenarioCatalogSchema } from '@clocky/clocky-simulation-scenario'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import UserQuestions from '@clocky/clocky-user-questions'
import { createApiProxy, InProcessApiClient, toFetchHandler } from '@clocky/clocky-host-apiproxy'
import Products from '../src/index.ts'
import Administration from '../src/administration.ts'
import { companyFixture } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { simulationProductCommandIdSchema } from '../src/schema-common.ts'
import { verifyWorldBackup } from '@clocky/clocky-simulation-team'
import { productWorldBackupDescriptor } from '../src/backup-import.ts'
import { simulationProductWorldCreateInputSchema } from '../src/world-schema.ts'
import type { Config } from '../src/administration.ts'

async function setup(backend: 'json' | 'sqlite', normative = false) {
  const h = await companyFixture(backend, false)
  const installed = structuredClone(deployment)
  for (const runtime of installed.runtimeProfiles) runtime.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  const definition = structuredClone(sample); definition.behavior.initialGoals = []
  const person = definition.entities.find(entity => entity.kind === 'person' && entity.cognition === 'agent')
  if (!person) throw new Error('Fixture person absent')
  definition.knowledge = [{ id: 'parent-private-knowledge', ownerId: person.id, body: 'parent-only-private-canary', observedAt: '0',
    availableAt: '0', validFrom: '0', validUntil: null, readers: [] }]
  if (normative) definition.governance.norms = [{ id: 'unsupported-institution', scopeId: definition.organization.rootId,
    body: 'Authored advisory policy', effectiveFrom: '0', effectiveUntil: null, availableAt: '0',
    audience: { kind: 'public' }, enforcement: { kind: 'advisory' } }]
  await h.ctx.plugin(Products, { directoryStream: 'experiment-directory' })
  const revokeDisclosure = h.ctx.simulationProducts.recordReaderRegistrar()([{ principalId: 'reader' as never }])
  const config: Config = { journalStream: 'experiment-commands', templates: [], world: { provider: 'local', catalog: installed,
    checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }, maxBytes: 16777216 }
  const mount = async () => { const fiber = h.ctx.plugin(Administration, config); await fiber; return fiber }
  const fiber = await mount(), service = h.ctx.simulationAdministration
  const preview = await service.preflightWorld({ definition }, call())
  if (preview.status !== 'ready') throw new Error(JSON.stringify(preview.diagnostics))
  const creation = await service.createWorld(simulationProductWorldCreateInputSchema.parse({ commandId: 'experiment-source', name: 'Source', definition,
    preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }), call())
  await vi.waitFor(async () => { expect(await service.request({ commandId: creation.commandId }, call())).toMatchObject({ request: { status: 'completed' } }) }, { timeout: 10000 })
  const plan = await service.retentionPreview({ runId: creation.runId }, call())
  const archiveCommandId = simulationProductCommandIdSchema.parse('source-archive')
  await service.retentionExecute({ runId: creation.runId, commandId: archiveCommandId,
    expectedRevision: plan.snapshotRevision, planHash: plan.planHash }, call())
  return { ...h, fiber, mount, service, source: { runId: creation.runId, archiveCommandId }, revokeDisclosure }
}

for (const backend of ['json', 'sqlite'] as const) {
  it(`${backend}: explicit branch retains original identities, runtime, disclosure and paused discovery across Product restart`, async () => {
    const h = await setup(backend)
    try {
      const input = { source: h.source, commandId: randomUUID(), name: 'Independent branch', memoryPolicy: 'public-facts' as const }
      const result = await h.service.branchWorld(input, call())
      expect(result).toMatchObject({ status: 'completed', memoryPolicy: 'public-facts', phase: 'paused', realEffects: false })
      if (result.status === 'not-found') throw new Error('Branch result absent')
      expect((await h.ctx.simulationProducts.inspect({ runId: result.runId }, call())).status).toBe('observed')
      expect(await h.service.branchWorld(input, call())).toEqual(result)
      await expect(h.service.branchWorld({ ...input, name: 'Changed original' }, call())).rejects.toThrow('original changed')
      expect(await h.service.readWorldBranch({ commandId: input.commandId }, call(undefined, 'stranger'))).toMatchObject({ status: 'not-found' })
      const plan = await h.service.retentionPreview({ runId: result.runId }, call())
      const branchArchive = simulationProductCommandIdSchema.parse('branch-archive')
      await h.service.retentionExecute({ runId: result.runId, commandId: branchArchive,
        expectedRevision: plan.snapshotRevision, planHash: plan.planHash }, call())
      const causal = await h.service.queryWorldCausal({ source: { runId: result.runId, archiveCommandId: branchArchive },
        root: 'absent-root', maxDepth: 1, maxNodes: 5, maxBytes: 4096 }, call())
      expect(causal).toMatchObject({ coverage: 'unknown', nodes: [], edges: [], source: { runId: result.runId } })
      await h.fiber.dispose()
      const reopened = await h.mount(), service = h.ctx.simulationAdministration
      expect(await service.readWorldBranch({ commandId: input.commandId }, call())).toEqual(result)
      expect(await service.branchWorld(input, call())).toEqual(result)
      const control = await service.control({ runId: result.runId }, call())
      expect(control.administration?.actions.restore.allowed).toBe(true)
      const checkpointId = control.administration?.recovery?.checkpointId
      if (!checkpointId) throw new Error('Branch recovery anchor absent')
      const restored = await service.restore({ runId: result.runId, commandId: simulationProductCommandIdSchema.parse('restore-branch'), checkpointId }, call())
      await vi.waitFor(async () => { expect(await service.request({ commandId: restored.commandId }, call())).toMatchObject({ request: { status: 'completed' } }) }, { timeout: 10000 })
      const managementId = randomUUID() as never
      const started = await service.manage({ runId: result.runId, managementId, phase: 'running' }, call())
      expect(started.operation.status).toBe('completed')
      await vi.waitFor(async () => {
        const current = await service.control({ runId: result.runId }, call())
        expect(current.stop).toBeDefined()
        expect(current.stop).not.toBe('recovery-required')
        expect(current.driver).not.toBe('failed')
      })
      await service.manage({ runId: result.runId, managementId: randomUUID() as never, phase: 'paused' }, call())
      expect(h.requests).toHaveLength(0)
      await reopened.dispose()
    } finally { await h.close() }
  }, 30000)
}


it('actual authenticated Host routes correlate source cuts, compare real observations and enforce complete query bytes and revocation', async () => {
  const h = await setup('json')
  try {
    await h.ctx.plugin(UserQuestions)
    const api = createApiProxy(h.ctx, { cwd: process.cwd(), defaultModelSelection: () => undefined })
    const client = new InProcessApiClient(toFetchHandler(api, { authenticatedProductCall: call() }))
    const archive = async (runId: typeof h.source.runId, commandId: string) => {
      const plan = await h.service.retentionPreview({ runId }, call())
      const archiveCommandId = simulationProductCommandIdSchema.parse(commandId)
      await h.service.retentionExecute({ runId, commandId: archiveCommandId,
        expectedRevision: plan.snapshotRevision, planHash: plan.planHash }, call())
      return { runId, archiveCommandId }
    }
    const leftInput = { source: h.source, commandId: randomUUID(), name: 'Left', memoryPolicy: 'public-facts' as const }
    const leftWire = await client.simulations.branchWorld(leftInput)
    expect(leftWire.result.ok).toBe(true)
    if (!leftWire.result.ok || leftWire.result.value.status === 'not-found') throw new Error('Actual branch carrier rejected source')
    const left = leftWire.result.value
    expect(await client.simulations.readWorldBranch({ commandId: leftInput.commandId }))
      .toMatchObject({ result: { ok: true, value: left } })
    const right = await h.service.branchWorld({ ...leftInput, commandId: randomUUID(), name: 'Right', memoryPolicy: 'authorized-memory' }, call())
    if (right.status === 'not-found') throw new Error('Right branch absent')
    const pair = { left: await archive(left.runId, 'left-observation'), right: await archive(right.runId, 'right-observation') }
    const backup = await h.service.backupExport({ runId: left.runId, commandId: pair.left.archiveCommandId }, call())
    const bundle = verifyWorldBackup(backup.bundle, { maxEntries: 100000, maxBytes: 16777216, pageSize: 64 })
    expect(productWorldBackupDescriptor(bundle)).toMatchObject({ kind: 'world-branch', input: leftInput,
      record: { id: left.runId }, sourceHash: left.sourceHash })
    const comparison = await client.simulations.compareWorlds(pair)
    expect(comparison).toMatchObject({ result: { ok: true, value: { observations: pair, causalConclusion: 'not-established',
      memoryPolicy: { left: 'public-facts', right: 'authorized-memory' }, quality: { status: 'unknown' }, cost: { status: 'unknown' } } } })
    const query = { source: pair.left, root: 'absent-root', maxDepth: 1, maxNodes: 5, maxBytes: 4096 }
    const causal = await client.simulations.queryWorldCausal(query)
    if (!causal.result.ok) throw new Error('Actual causal carrier rejected source')
    const exact = Buffer.byteLength(JSON.stringify(causal.result.value))
    expect(await h.service.queryWorldCausal({ ...query, maxBytes: exact }, call())).toEqual(causal.result.value)
    await expect(h.service.queryWorldCausal({ ...query, maxBytes: exact - 1 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    await expect(h.service.queryWorldCausal({ ...query, maxBytes: 1 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    h.revokeDisclosure()
    await expect(h.service.queryWorldCausal(query, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await expect(h.service.compareWorlds(pair, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await expect(h.service.branchWorld({ ...leftInput, commandId: randomUUID() }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    expect(await h.service.branchWorld(leftInput, call())).toEqual(left)
    const readers = h.ctx.simulationProducts.recordReaderRegistrar()
    expect(() => readers([{ principalId: 'reader' as never, includeProvenance: true }])).toThrow('exact run identity')
    const revokeBranch = readers([{ principalId: 'reader' as never, runId: left.runId }])
    const backupInput = { runId: left.runId, commandId: pair.left.archiveCommandId }
    await expect(h.service.backupExport(backupInput, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    const revokeClosure = readers([{ principalId: 'reader' as never, runId: left.runId, includeProvenance: true }])
    const full = await h.service.backupExport(backupInput, call())
    const privateBundle = verifyWorldBackup(full.bundle, { maxEntries: 100000, maxBytes: 16777216, pageSize: 64 })
    expect(JSON.stringify(privateBundle.body.snapshot)).not.toContain('parent-only-private-canary')
    expect(JSON.stringify(privateBundle.body.provenance)).toContain('parent-only-private-canary')
    revokeClosure()
    const revokeLate = readers([{ principalId: 'reader' as never, runId: left.runId, includeProvenance: true }])
    const allowed = h.ctx.simulationProducts.provenanceBodyAllowed.bind(h.ctx.simulationProducts)
    let retiring = false
    const barrier = vi.spyOn(h.ctx.simulationProducts, 'provenanceBodyAllowed').mockImplementation((...args) => {
      const result = allowed(...args)
      if (result && !retiring) { retiring = true; queueMicrotask(revokeLate) }
      return result
    })
    await expect(h.service.backupExport(backupInput, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    barrier.mockRestore(); revokeBranch()
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
}, 30000)

it.each(['accepted', 'completed'] as const)('lost %s append acknowledgement closes branch admission until durable replay', async (stage) => {
  const h = await setup('sqlite')
  try {
    const input = { source: h.source, commandId: randomUUID(), name: 'Original fault branch', memoryPolicy: 'public-facts' as const }
    const stream = h.ctx.storageLog.get('experiment-commands/experiments')!, append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const result = await append(...args)
      if ((args[1][0] as { kind: string }).kind === stage) throw new Error('lost original branch acknowledgement')
      return result
    }
    await expect(h.service.branchWorld(input, call())).rejects.toThrow('lost original branch acknowledgement')
    await expect(h.service.readWorldBranch({ commandId: input.commandId }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    await expect(h.service.branchWorld(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    await h.fiber.dispose(); await h.mount()
    const recovered = h.ctx.simulationAdministration
    expect(await recovered.readWorldBranch({ commandId: input.commandId }, call())).toMatchObject({ status: stage === 'accepted' ? 'accepted' : 'completed' })
    expect(await recovered.branchWorld(input, call())).toMatchObject({ status: 'completed' })
    expect(h.ctx.storageLog.get('experiment-commands/experiments')!.tailSequence).toBe(1)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
}, 30000)


it('unsupported progressed institution cuts reject before durable branch acceptance or target creation', async () => {
  const h = await setup('json', true)
  try {
    const { simTimeSchema } = await import('@clocky/clocky-simulation')
    const run = (h.service as unknown as { held: Map<string, { run: import('@clocky/clocky-simulation').SimulationRun }> }).held.get(h.source.runId)?.run
    if (!run) throw new Error('Actual source owner absent')
    await run.setPhase('running', run.snapshot().revision); await run.drive({ until: simTimeSchema.parse('1') })
    await run.setPhase('paused', run.snapshot().revision)
    const plan = await h.service.retentionPreview({ runId: h.source.runId }, call())
    const archiveCommandId = simulationProductCommandIdSchema.parse('unsupported-source-archive')
    await h.service.retentionExecute({ runId: h.source.runId, commandId: archiveCommandId,
      expectedRevision: plan.snapshotRevision, planHash: plan.planHash }, call())
    const input = { source: { ...h.source, archiveCommandId }, commandId: randomUUID(), name: 'Unsupported branch', memoryPolicy: 'public-facts' as const }
    await expect(h.service.branchWorld(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
    expect(await h.service.readWorldBranch({ commandId: input.commandId }, call())).toMatchObject({ status: 'not-found' })
    expect(h.ctx.storageLog.get('experiment-commands/experiments')!.tailSequence).toBe(-1)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
}, 30000)


async function setupLegacy(backend: 'json' | 'sqlite') {
  const h = await companyFixture(backend, false)
  const installed = catalog()
  for (const runtime of installed.runtimeProfiles) runtime.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  const definition = worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
  definition.initialEvents = []
  await h.ctx.plugin(Products, { directoryStream: 'legacy-experiment-directory', recordReaders: [{ principalId: 'reader' as never }] })
  const config: Config = { journalStream: 'legacy-experiment-commands', templates: [], world: { provider: 'local', catalog: installed,
    checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } }, maxBytes: 16777216 }
  const mount = async (next = config) => { const fiber = h.ctx.plugin(Administration, next); await fiber; return fiber }
  const fiber = await mount(), service = h.ctx.simulationAdministration
  const preview = await service.preflightWorld({ definition }, call())
  if (preview.status !== 'ready') throw new Error(JSON.stringify(preview.diagnostics))
  const created = await service.createWorld(simulationProductWorldCreateInputSchema.parse({ commandId: 'legacy-experiment-source',
    name: 'Legacy Source', definition, preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }), call())
  await vi.waitFor(async () => { expect(await service.request({ commandId: created.commandId }, call())).toMatchObject({ request: { status: 'completed' } }) }, { timeout: 10000 })
  const plan = await service.retentionPreview({ runId: created.runId }, call())
  const archiveCommandId = simulationProductCommandIdSchema.parse('legacy-source-archive')
  await service.retentionExecute({ runId: created.runId, commandId: archiveCommandId,
    expectedRevision: plan.snapshotRevision, planHash: plan.planHash }, call())
  return { ...h, fiber, mount, service, config, source: { runId: created.runId, archiveCommandId } }
}

it.each(['json', 'sqlite'] as const)('%s legacy branches freeze the matching catalog and actually restore/start their new owner', async (backend) => {
  const h = await setupLegacy(backend)
  try {
    const input = { source: h.source, commandId: randomUUID(), name: 'Legacy branch', memoryPolicy: 'public-facts' as const }
    const result = await h.service.branchWorld(input, call())
    if (result.status !== 'completed') throw new Error('Legacy branch did not complete')
    const stream = h.ctx.storageLog.get('legacy-experiment-commands/experiments')!
    expect((await stream.read(-1, 1))[0]?.value).toMatchObject({ legacyCatalog: { generation: h.config.world?.catalog.generation } })
    await h.fiber.dispose(); await h.mount()
    const service = h.ctx.simulationAdministration
    expect(await service.branchWorld(input, call())).toEqual(result)
    const control = await service.control({ runId: result.runId }, call()), checkpointId = control.administration?.recovery?.checkpointId
    if (!checkpointId) throw new Error('Legacy branch has no independent recovery anchor')
    const restored = await service.restore({ runId: result.runId, commandId: simulationProductCommandIdSchema.parse('legacy-restore'), checkpointId }, call())
    await vi.waitFor(async () => { expect(await service.request({ commandId: restored.commandId }, call())).toMatchObject({ request: { status: 'completed' } }) }, { timeout: 10000 })
    expect((await service.manage({ runId: result.runId, managementId: randomUUID() as never, phase: 'running' }, call())).operation.status).toBe('completed')
    await vi.waitFor(async () => {
      const current = await service.control({ runId: result.runId }, call())
      expect(current.stop).toBeDefined(); expect(current.stop).not.toBe('recovery-required'); expect(current.driver).not.toBe('failed')
    })
    await service.manage({ runId: result.runId, managementId: randomUUID() as never, phase: 'paused' }, call())
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
}, 30000)

it.each(['missing', 'drifted-generation', 'drifted-model'] as const)('legacy %s catalog refuses before branch acceptance or target allocation', async (state) => {
  const h = await setupLegacy('json')
  try {
    await h.fiber.dispose()
    const { world, ...base } = h.config
    if (!world) throw new Error('Legacy fixture catalog missing')
    const changedCatalog = scenarioCatalogSchema.parse(world.catalog)
    if (state === 'drifted-generation') changedCatalog.generation = 'drifted-generation'
    if (state === 'drifted-model') {
      const runtime = changedCatalog.runtimeProfiles[0]
      if (!runtime) throw new Error('Legacy runtime profile absent')
      runtime.model.version = 'changed-model-semantic-version'
    }
    const next = state === 'missing' ? base : Object.assign({}, h.config, { world: { ...world, catalog: changedCatalog } })
    await h.mount(next)
    const service = h.ctx.simulationAdministration
    const input = { source: h.source, commandId: randomUUID(), name: 'Rejected legacy branch', memoryPolicy: 'public-facts' as const }
    await expect(service.branchWorld(input, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
    expect(await service.readWorldBranch({ commandId: input.commandId }, call())).toMatchObject({ status: 'not-found' })
    expect(h.ctx.storageLog.get('legacy-experiment-commands/experiments')!.tailSequence).toBe(-1)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
}, 30000)

it('accepted legacy retry ignores a changed Host catalog and reuses only its original frozen resolution', async () => {
  const h = await setupLegacy('sqlite')
  try {
    const input = { source: h.source, commandId: randomUUID(), name: 'Retained legacy branch', memoryPolicy: 'public-facts' as const }
    const stream = h.ctx.storageLog.get('legacy-experiment-commands/experiments')!, append = stream.append.bind(stream)
    stream.append = async (...args) => { await append(...args); throw new Error('lost legacy acceptance acknowledgement') }
    await expect(h.service.branchWorld(input, call())).rejects.toThrow('lost legacy acceptance acknowledgement')
    await h.fiber.dispose()
    const world = h.config.world
    if (!world) throw new Error('Legacy fixture catalog missing')
    await h.mount(Object.assign({}, h.config, { world: { ...world, catalog: { ...world.catalog, generation: 'new-host-catalog' } } }))
    const result = await h.ctx.simulationAdministration.branchWorld(input, call())
    expect(result.status).toBe('completed')
    const records = await h.ctx.storageLog.get('legacy-experiment-commands/experiments')!.read(-1, 2)
    expect(records[0]?.value).toMatchObject({ legacyCatalog: { generation: world.catalog.generation } })
    expect(records[1]?.value).toMatchObject({ preparation: { resolved: { catalogGeneration: world.catalog.generation } } })
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
}, 30000)
