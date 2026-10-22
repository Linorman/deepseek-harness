/** Full private Harbor backup over actual Loader Native/Team/Session owners and the unchanged original judge. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationCheckpointRequestSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { createWorldBackup, verifyWorldBackup, restoreWorldBackup } from '@clocky/clocky-simulation-team'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { SimulationWorldExecutions } from '@clocky/clocky-simulation-world'
import * as Harbor from '@clocky/clocky-simulation-world/src/harbor.ts'
import { HarborCase, harborHash } from '@clocky/clocky-simulation-world/src/harbor-case.ts'
import { createContext } from '../../../packages/simulation/simulation-team/tests/harness.ts'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { deployment } from '../../../packages/simulation/simulation-scenario/tests/v1-fixtures.ts'

if (process.env.HARBOR_BACKUP_SOURCE_READY !== 'true') await import('./harbor-scenario.ts')
const sourceRoot = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const backend = process.env.SIMULATION_COMPANY_BACKEND === 'sqlite' ? 'sqlite' : 'json'
const configuration = process.argv[2]!
const ctx = await boot('harbor-full-backup-source', configuration)
const { catalog, definition } = Harbor.createHarborInstallation(deployment)
for (const profile of catalog.runtimeProfiles) profile.model = { provider: 'harbor-keyless', name: 'fixture', version: '1', available: true }
const compiled = await compileWorldScenarioV1(definition, catalog, 'json', null)
assert.ok(compiled.ok)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: { runId: 'harbor-loader-test', ...compiled.resolved.native } })
const run = await ctx.simulations.open(selection)
const ownerName = run.snapshot().teamReservation?.creation.rules.activationLifecycleOwner
assert.equal(typeof ownerName, 'string')
assert.ok(typeof ownerName === 'string')
const teamId = run.snapshot().teamReservation!.teamId
const connection = await ctx.simulationTeams.attach(run, teamId, ownerName)
const limits = { maxBytes: 128 * 1024 * 1024, maxEntries: 200000, pageSize: 64 }
const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'harbor-full-private-cut', implementationVersion: 'world/1',
  maxDrainRounds: 64, maxAttempts: 3 })
let body: Awaited<ReturnType<Awaited<ReturnType<typeof connection.collectCheckpointCandidate>>['exportArchive']>>
try {
  const reached = run.snapshot().runControl?.current
  assert.ok(reached?.target !== null && reached?.target !== undefined && reached.cut !== null)
  assert.equal(reached.state, 'paused')
  assert.equal(reached.cut.clockValue, '12')
  await run.updateRunControl({ commandId: 'backup-stop-save', target: { ...reached.target, checkpointPolicy: 'request' } }, run.snapshot().revision)
  assert.equal((await connection.checkpoint(checkpoint)).status, 'completed')
  await assert.rejects(run.recordRunControlCheckpoint('backup-stop-save', checkpoint.id, 'completed'), /complete provider backup/)
  await run.recordRunControlCheckpoint('backup-stop-save', checkpoint.id, 'external-state-required')
  assert.equal(run.snapshot().runControl?.current.checkpoint, 'external-state-required')
  const collection = await connection.collectCheckpointCandidate(64, 3)
  try { body = await collection.exportArchive(limits) } finally { collection.release() }
} finally { await connection.close(); await run.close(); await ctx.fiber.dispose() }
assert.equal(body.external?.length, 1)
// Pure provider verification is explicit; target paths are configured independently inside the invisible staging root.
const { harborArchiveProvider } = await import('@clocky/clocky-simulation-world/src/harbor-archive-provider.ts')
const provider = harborArchiveProvider(join(sourceRoot, 'harbor'))
const providers = new Map([[provider.id, provider]])
const bundle = createWorldBackup(body, limits, undefined, providers)
assert.equal(bundle.manifest.externalOwners?.[0]?.provider, provider.id)
assert.throws(() => verifyWorldBackup(JSON.stringify(bundle), limits), /exact installed provider/)
assert.deepEqual(verifyWorldBackup(JSON.stringify(bundle), limits, providers), bundle)
const before = JSON.stringify(body.snapshot)
const offlineRoot = `${sourceRoot}-offline`
await rename(sourceRoot, offlineRoot)
const destination = `${sourceRoot}-restored`
const imported = simulationCheckpointRequestSchema.parse({ ...checkpoint, id: 'harbor-restored-anchor' })
const cwdMapping = Object.fromEntries(body.sessions.flatMap((session) => {
  const header = session.header as { cwd?: string }
  return header.cwd === undefined ? [] : [[header.cwd, join(destination, 'workspace')]]
}))
const prepare = async (staging: string) => {
  const target = await createContext(staging, backend, 524288)
  await target.ctx.plugin(Direct)
  await target.ctx.plugin(SimulationWorldExecutions)
  await target.ctx.plugin(Harbor, { provider: 'local', root: join(staging, 'harbor'),
    sourceDirectory: resolve('test-cases/harbor-society-365') })
  await mkdir(join(staging, 'workspace'), { recursive: true })
  const nativeRoot = join(staging, 'simulation', createHash('sha256').update(selection.spec.runId).digest('hex'))
  await mkdir(nativeRoot, { recursive: true })
  const native = backend === 'json' ? new JsonStorageBackend(join(nativeRoot, 'journal'))
    : new SqliteStorageBackend({ path: join(nativeRoot, 'journal.sqlite'), journalMode: 'wal' })
  return { ctx: target.ctx, native: native.log, owners: target.ctx.storage.backend.get(backend).log!,
    async validate() {
      await native.close()
      const restored = await target.ctx.simulations.open(selection)
      try {
        const record = restored.snapshot()
        assert.equal(record.phase, 'paused')
        assert.equal(record.spec.runId, selection.spec.runId)
        assert.deepEqual(record.runControl, (body.snapshot as unknown as ReturnType<typeof run.snapshot>).runControl)
        assert.equal(record.runControl?.current.checkpoint, 'external-state-required')
        assert.equal(record.runControl?.current.cut?.clockValue, '12')
        assert.deepEqual(record.world?.requests, (body.snapshot as unknown as ReturnType<typeof run.snapshot>).world?.requests)
        const original = record.teamReservation!.teamId
        const attached = await target.ctx.simulationTeams.attach(restored, original, ownerName)
        try {
          const anchor = await attached.checkpoint(imported)
          assert.equal(anchor.status, 'completed', JSON.stringify(anchor))
        } finally { await attached.close() }
        return { checkpointId: imported.id, implementationVersion: imported.implementationVersion }
      } finally { await restored.close() }
    }, async close() { await native.close(); await target.ctx.fiber.dispose() } }
}
const receipt = await restoreWorldBackup(JSON.stringify(bundle), destination, limits, cwdMapping, prepare, providers)
assert.ok(receipt.startsWith(destination))
assert.equal(JSON.stringify(body.snapshot), before)
const restoredJudge = new HarborCase(resolve('test-cases/harbor-society-365'), join(destination, 'harbor'), selection.spec.runId,
  new AbortController().signal, true)
assert.equal((await restoredJudge.overview()).day, 12)
const sourceJudge = new HarborCase(resolve('test-cases/harbor-society-365'), join(offlineRoot, 'harbor'), selection.spec.runId,
  new AbortController().signal, true)
assert.deepEqual(await restoredJudge.overview(), await sourceJudge.overview())
assert.equal(harborHash(selection.spec.runId), createHash('sha256').update(selection.spec.runId).digest('hex'))
console.log(JSON.stringify({ backup: 'complete', sourceOffline: true, caseDay: 12, externalOwners: bundle.manifest.externalOwners?.length,
  nativeEntries: body.native.entries.length, sessions: body.sessions.length, stoppingPreserved: true, nativeOnlySave: 'external-state-required' }))
