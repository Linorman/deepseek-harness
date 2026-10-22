/** Actual target Host process; the parent kills it after durable Product registration but before directory publication. */
import { createHash } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { simulationCheckpointIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { verifyWorldBackup } from '@clocky/clocky-simulation-team'
import { restoreProductWorldBackup, productWorldBackupDescriptor } from '../src/backup-import.ts'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'

const [bundleFile, destination, config, backend] = process.argv.slice(2)
if (bundleFile === undefined || destination === undefined || config === undefined || !['json', 'sqlite'].includes(backend ?? ''))
  throw new Error('Expected bundle file, destination, Loader config and backend')
const limits = { maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }
const text = await readFile(bundleFile, 'utf8'), bundle = verifyWorldBackup(text, limits), creation = productWorldBackupDescriptor(bundle)
const cwdMapping: Record<string, string> = {}
for (const session of bundle.body.sessions) {
  const header = session.header as { cwd?: string }
  if (header.cwd !== undefined) cwdMapping[header.cwd] = join(destination, 'workspace')
}
const call: AuthenticatedProductCall = { principal: { id: creation.record.ownerPrincipalId, issuer: 'test', subject: 'reader',
  assurance: 'test', credentialGeneration: 1 }, credentialGeneration: 1, signal: new AbortController().signal }
const selection = simulationRunSelectionSchema.parse({ provider: creation.record.provider, spec: creation.record.spec, mode: 'open' })
await restoreProductWorldBackup(text, destination, limits, cwdMapping, call, async (staging) => {
  process.env.SIMULATION_COMPANY_ROOT = staging; process.env.SIMULATION_COMPANY_BACKEND = backend
  const ctx = await boot('product-import-process', config)
  await mkdir(join(staging, 'workspace'), { recursive: true })
  const root = join(staging, 'simulation', createHash('sha256').update(creation.record.spec.runId).digest('hex'))
  await mkdir(root, { recursive: true })
  const native = backend === 'json' ? new JsonStorageBackend(join(root, 'journal'))
    : new SqliteStorageBackend({ path: join(root, 'journal.sqlite'), journalMode: 'wal' })
  const register = ctx.simulationAdministration.importPausedBackup.bind(ctx.simulationAdministration)
  ctx.simulationAdministration.importPausedBackup = async (...args) => {
    await register(...args)
    process.send?.({ stage: 'product-registered-before-publication' })
    await new Promise<void>(() => { setInterval(() => {}, 1000) })
  }
  return { ctx, native: native.log, owners: ctx.storage.backend.get(backend!).log!,
    async validate() {
      await native.close()
      const run = await ctx.simulations.open(selection)
      try {
        const team = run.snapshot().teamReservation!, owner = team.creation.rules['activationLifecycleOwner']
        if (typeof owner !== 'string') throw new Error('Original lifecycle owner missing')
        const connection = await ctx.simulationTeams.attach(run, team.teamId, owner)
        try {
          const id = simulationCheckpointIdSchema.parse('backup-import/product')
          const result = await connection.checkpoint({ id, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
          if (result.status !== 'completed') throw new Error('Import checkpoint did not complete')
          return { checkpointId: id, implementationVersion: 'world/1' }
        } finally { await connection.close() }
      } finally { await run.close() }
    }, async close() { await native.close(); await ctx.fiber.dispose() },
  }
})
