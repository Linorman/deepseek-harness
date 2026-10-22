import { spawn } from 'node:child_process'
import { once } from 'node:events'
/** Full Loader-created Product worlds migrate to empty roots before discovery; external models always fail if invoked. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, rename, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { boot } from '@clocky/clocky-app-boot'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { simulationCheckpointIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { productWorldBackupDescriptor, restoreProductWorldBackup } from '../src/backup-import.ts'
import { verifyWorldBackup } from '@clocky/clocky-simulation-team'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { simulationProductCommandIdSchema } from '../src/schema-common.ts'
import { catalog } from '../../simulation-scenario/tests/fixtures.ts'
import { call } from './fixtures.ts'

const limits = { maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }
const backupCases = [['json', false], ['sqlite', false], ['json', true], ['sqlite', true]] as const
it.each(backupCases)('%s backup restores paused Product, branch=%s', async (backend, branchMode) => {
  const parent = resolve('.tmp/world-post-mvp/d1'); await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, `product-${backend}-`)), sourceRoot = join(root, 'source')
  await mkdir(sourceRoot)
  const installed = branchMode ? structuredClone(deployment) : catalog()
  installed.runtimeProfiles[0]!.model = { provider: 'company', name: 'scripted', version: '1', available: true }
  await symlink(resolve('examples/node_modules'), join(root, 'node_modules'), 'dir')
  const config = join(root, 'cordis.json')
  await writeFile(config, JSON.stringify([
    { name: 'cordis:include', config: { path: resolve('examples/simulation-company/cordis.yml') } },
    { name: '@clocky/clocky-simulation-product', config: { directoryStream: 'world-products', recordReaders: [{ principalId: 'reader' }] } },
    { name: '@clocky/clocky-simulation-product/administration', config: { journalStream: 'world-commands', templates: [],
      world: { provider: 'local', catalog: installed, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } } } },
  ]))
  const previousRoot = process.env.SIMULATION_COMPANY_ROOT, previousBackend = process.env.SIMULATION_COMPANY_BACKEND
  process.env.SIMULATION_COMPANY_ROOT = sourceRoot; process.env.SIMULATION_COMPANY_BACKEND = backend
  const source = await boot('product-backup-source', config)
  let modelCalls = 0
  class NoInference extends LlmAdapter {
    async *stream(): AsyncGenerator<StreamChunk> { modelCalls++; throw new Error('Backup must never infer') }
  }
  source.llm.registerAdapter(['company'], new NoInference())
  let sourceClosed = false
  try {
    const definition = branchMode ? structuredClone(sample)
      : worldScenarioSchema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-company.json', 'utf8')))
    if (definition.apiVersion === 'clocky.world/v1') definition.behavior.initialGoals = []
    const preview = await source.simulationAdministration.preflightWorld({ definition }, call())
    if (preview.status !== 'ready') throw new Error(JSON.stringify(preview))
    const accepted = await source.simulationAdministration.createWorld({ commandId: 'product-backup-origin' as never,
      name: 'Portable original', definition, preflight: { hash: preview.preview.hash, catalogGeneration: preview.preview.catalogGeneration } }, call())
    // Observe the original journal's terminal frame, not a timing assumption about asynchronous preparation.
    await expect.poll(async () => (await source.simulationAdministration.request({ commandId: accepted.commandId }, call()))
      .status === 'found' && (await source.simulationAdministration.request({ commandId: accepted.commandId }, call()))).toMatchObject({ request: { status: 'completed' } })
    let selectedRunId = accepted.runId
    const branchInput = { source: { runId: accepted.runId, archiveCommandId: simulationProductCommandIdSchema.parse('parent-cut') },
      commandId: randomUUID(), name: 'Portable branch', memoryPolicy: 'public-facts' as const }
    if (branchMode) {
      const parentPlan = await source.simulationAdministration.retentionPreview({ runId: accepted.runId }, call())
      await source.simulationAdministration.retentionExecute({ runId: accepted.runId, commandId: branchInput.source.archiveCommandId,
        expectedRevision: parentPlan.snapshotRevision, planHash: parentPlan.planHash }, call())
      const branched = await source.simulationAdministration.branchWorld(branchInput, call())
      if (branched.status === 'not-found') throw new Error('Actual branch was not created')
      expect(branched.status).toBe('completed'); selectedRunId = branched.runId
    }
    const plan = await source.simulationAdministration.retentionPreview({ runId: selectedRunId }, call())
    await source.simulationAdministration.retentionExecute({ runId: selectedRunId, commandId: 'full-backup' as never,
      expectedRevision: plan.snapshotRevision, planHash: plan.planHash }, call())
    const exported = await source.simulationAdministration.backupExport({ runId: selectedRunId, commandId: 'full-backup' as never }, call())
    const bundle = verifyWorldBackup(exported.bundle, limits), creation = productWorldBackupDescriptor(bundle)
    await source.fiber.dispose(); sourceClosed = true
    await rename(sourceRoot, join(root, 'offline-source'))
    const destination = join(root, 'target'), selection = simulationRunSelectionSchema.parse({ provider: creation.record.provider,
      spec: creation.record.spec, mode: 'open' })
    const cwdMapping: Record<string, string> = {}
    for (const session of bundle.body.sessions) {
      const header = session.header as { cwd?: string }
      if (header.cwd !== undefined) cwdMapping[header.cwd] = join(destination, 'workspace')
    }
    let failRegistration = true
    const prepare = async (staging: string) => {
      process.env.SIMULATION_COMPANY_ROOT = staging
      const ctx = await boot('product-backup-target', config)
      await mkdir(join(staging, 'workspace'), { recursive: true })
      ctx.llm.registerAdapter(['company'], new NoInference())
      const nativeRoot = join(staging, 'simulation', createHash('sha256').update(creation.record.spec.runId).digest('hex'))
      await mkdir(nativeRoot, { recursive: true })
      const native = backend === 'json' ? new JsonStorageBackend(join(nativeRoot, 'journal'))
        : new SqliteStorageBackend({ path: join(nativeRoot, 'journal.sqlite'), journalMode: 'wal' })
      return { ctx, native: native.log, owners: ctx.storage.backend.get(backend).log!,
        async validate() {
          await native.close()
          const run = await ctx.simulations.open(selection)
          try {
            expect(run.snapshot().phase).toBe('paused')
            const teamId = run.snapshot().teamReservation!.teamId
            const owner = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
            if (typeof owner !== 'string') throw new Error('Original lifecycle owner missing')
            const connection = await ctx.simulationTeams.attach(run, teamId, owner)
            try {
              const id = simulationCheckpointIdSchema.parse('backup-import/product')
              if (run.snapshot().checkpoints?.[id]?.status !== 'completed')
                expect((await connection.checkpoint({ id, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status).toBe('completed')
              if (failRegistration) throw new Error('Injected exit before Product registration')
              return { checkpointId: id, implementationVersion: 'world/1' }
            } finally { await connection.close() }
          } finally { await run.close() }
        }, async close() { await native.close(); await ctx.fiber.dispose() },
      }
    }
    await expect(restoreProductWorldBackup(exported.bundle, destination, limits, cwdMapping,
      call(new AbortController(), 'other'), prepare))
      .rejects.toThrow(/another authenticated owner/)
    await expect(restoreProductWorldBackup(exported.bundle, destination, limits, cwdMapping, call(), prepare))
      .rejects.toThrow(/Injected exit/)
    await expect(readFile(join(destination, 'archive-restore.json'))).rejects.toThrow()
    failRegistration = false
    const bundleFile = join(root, 'source.backup.json'); await writeFile(bundleFile, exported.bundle)
    const child = spawn(process.execPath, ['--import', 'tsx/esm',
      resolve('packages/simulation/simulation-product/tests/backup-import-process.ts'), bundleFile, destination, config, backend],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, TMPDIR: resolve('.tmp') } })
    const exit = once(child, 'exit'); let stderr = ''
    child.stderr!.on('data', (bytes: Buffer) => { stderr += bytes.toString() })
    const deadline = setTimeout(() => child.kill('SIGKILL'), 20000)
    try {
      const message = await Promise.race([once(child, 'message'), exit.then(() => { throw new Error(stderr) })]) as unknown[]
      expect(message[0]).toEqual({ stage: 'product-registered-before-publication' })
      await expect(readFile(join(destination, 'archive-restore.json'))).rejects.toThrow()
      child.kill('SIGKILL')
      expect(await exit).toEqual([null, 'SIGKILL'])
    } finally { clearTimeout(deadline); child.kill('SIGKILL'); await exit }
    await restoreProductWorldBackup(exported.bundle, destination, limits, cwdMapping, call(), prepare)
    await restoreProductWorldBackup(exported.bundle, destination, limits, cwdMapping, call(), prepare)
    process.env.SIMULATION_COMPANY_ROOT = destination
    const restored = await boot('product-backup-discovery', config)
    try {
      const listed = await restored.simulationProducts.list({}, call())
      expect(listed.items).toHaveLength(1)
      expect(listed.items[0]).toMatchObject({ id: selectedRunId,
        name: { text: branchMode ? 'Portable branch' : 'Portable original', truncated: false } })
      if (branchMode) {
        const originalBranch = await restored.simulationAdministration.readWorldBranch({ commandId: branchInput.commandId }, call())
        expect(originalBranch).toMatchObject({ status: 'completed', runId: selectedRunId })
        expect(await restored.simulationAdministration.branchWorld(branchInput, call())).toEqual(originalBranch)
        expect(listed.items.some(item => item.id === accepted.runId)).toBe(false)
      } else expect(await restored.simulationAdministration.request({ commandId: accepted.commandId }, call()))
        .toMatchObject({ status: 'found', request: { status: 'completed', runId: selectedRunId } })
      const observed = await restored.simulations.inspect(restored.simulations.resolveInspection({
        provider: selection.provider, spec: selection.spec }))
      expect(observed?.snapshot.phase).toBe('paused')
      expect(observed?.owner).toBe('unowned')
      expect(modelCalls).toBe(0)
      restored.llm.registerAdapter(['company'], new NoInference())
      const recover = await restored.simulationAdministration.restore({ runId: selectedRunId,
        commandId: 'restore-imported-world' as never, checkpointId: simulationCheckpointIdSchema.parse('backup-import/product') }, call())
      await expect.poll(() => restored.simulationAdministration.request({ commandId: recover.commandId }, call()))
        .toMatchObject({ status: 'found', request: { status: 'completed' } })
      expect(modelCalls).toBe(0)
      const running = await restored.simulationAdministration.manage({ runId: selectedRunId,
        managementId: 'start-imported-world' as never, phase: 'running' }, call())
      expect(running.operation.status).toBe('completed')
      await restored.simulationAdministration.manage({ runId: selectedRunId,
        managementId: 'pause-imported-world' as never, phase: 'paused' }, call())
    } finally { await restored.fiber.dispose() }
  } finally {
    if (!sourceClosed) await source.fiber.dispose()
    if (previousRoot === undefined) delete process.env.SIMULATION_COMPANY_ROOT
    else process.env.SIMULATION_COMPANY_ROOT = previousRoot
    if (previousBackend === undefined) delete process.env.SIMULATION_COMPANY_BACKEND
    else process.env.SIMULATION_COMPANY_BACKEND = previousBackend
  }
}, 60000)
