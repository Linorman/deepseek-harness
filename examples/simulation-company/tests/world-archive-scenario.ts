/** Keyless complete-owner archive preview over real Loader composition and accepted canonical planning history. */
import { boot } from '@clocky/clocky-app-boot'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { planWorldArchive, publishWorldArchive, readWorldArchive, createWorldBackup, publishWorldBackup, readWorldBackup,
  planWorldBackupMigration, migrateWorldBackup } from '@clocky/clocky-simulation-team'
import { hiringResourceHarness } from '../../../packages/simulation/simulation-local/tests/hiring-resource-harness.ts'
const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const parent = resolve('.tmp/world-post-mvp/b2/snapshot'); await mkdir(parent, { recursive: true })
const root = await mkdtemp(join(parent, `${backend}-`))
process.env.SIMULATION_COMPANY_ROOT = root
const ctx = await boot('world-archive', resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))
const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: root, loadedContext: { ctx, serviceFiber: ctx.fiber } })
try {
  await h.start(); await h.plan()
  const candidate = await h.connection.collectCheckpointCandidate(8, 3)
  try {
    const limits = { maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }
    const body = await candidate.exportArchive(limits), plan = planWorldArchive(body, limits)
    const hash = await publishWorldArchive(join(root, 'archive'), body, limits)
    assert.deepEqual(await readWorldArchive(join(root, 'archive'), hash, limits), body)
    const bundle = createWorldBackup(body, limits)
    const backupHash = await publishWorldBackup(join(root, 'backup'), bundle, limits)
    assert.deepEqual(await readWorldBackup(join(root, 'backup'), backupHash, limits), bundle)
    const original = JSON.stringify(body), migration = planWorldBackupMigration(original, limits)
    const migratedHash = await migrateWorldBackup(original, migration, join(root, 'migrated'), limits)
    assert.deepEqual(await readWorldBackup(join(root, 'migrated'), migratedHash, limits), bundle)
    assert.equal(JSON.stringify(body), original)
    console.log(JSON.stringify({ backupFormat: bundle.manifest.format, migrationConverter: migration.converter,
      backupReadback: true, migrationRetainsOriginal: true, version: plan.version, ownerStreams: plan.ownerStreams,
      materializedSessions: plan.materializedSessions, attachments: plan.attachments, destructive: plan.destructive,
      reclaimableBytes: plan.reclaimableBytes, originalPendingPlans: Object.values(candidate.snapshot.world!.plans).filter(value => value.status === 'accepted').length,
      unmaterializedSessions: candidate.sessions.filter(value => value.kind === 'unmaterialized').length, verifiedReadback: true }))
  } finally { candidate.release() }
} finally { await h.close() }
