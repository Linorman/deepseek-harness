/** Two-process keyless branch initialization: first process exits after durable partial allocation, second resumes exact identities. */
import { z } from 'zod'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { verifyWorldArchive } from '@clocky/clocky-simulation-team'
import { boot } from '@clocky/clocky-app-boot'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createWorldExperimentBranch, worldExperimentBranchSchema, mergeWorldExperimentBranches } from '@clocky/clocky-simulation-team'
import { hiringResourceHarness } from '../../../packages/simulation/simulation-local/tests/hiring-resource-harness.ts'
const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const root = process.env.WORLD_EXPERIMENT_ROOT
assert.ok(root)
await mkdir(root, { recursive: true })
process.env.SIMULATION_COMPANY_ROOT = root
const ctx = await boot('world-experiment', resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))
const limits = { maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }
if (process.env.WORLD_EXPERIMENT_PHASE === 'prepare') {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: root, loadedContext: { ctx, serviceFiber: ctx.fiber } })
  const candidate = await h.connection.collectCheckpointCandidate(8, 3)
  const body = await candidate.exportArchive(limits); candidate.release()
  const commandId = randomUUID()
  const input = worldExperimentBranchSchema.parse({ commandId, memoryPolicy: 'authorized-memory', variables: { memoryPolicy: 'authorized-memory' },
    sourceHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), selection: { ...h.selection,
      spec: { ...h.selection.spec, runId: `experiment-${commandId}` } } })
  await writeFile(join(root, 'original-experiment.json'), JSON.stringify({ body, input }))
  let grants = 0
  await createWorldExperimentBranch(ctx, body, input, limits, () => {
    // Abrupt process exit leaves the original run/branch-init and identity reservation on disk.
    if (++grants === 12) process.exit(0)
  })
  throw new Error('Expected process exit during branch initialization')
} else {
  const original = z.strictObject({ body: z.json(), input: worldExperimentBranchSchema }).parse(JSON.parse(await readFile(join(root, 'original-experiment.json'), 'utf8')))
  const input = worldExperimentBranchSchema.parse(original.input)
  const branch = await createWorldExperimentBranch(ctx, verifyWorldArchive(JSON.stringify(original.body), limits), input, limits, () => {})
  try {
    const state = branch.run.snapshot()
    assert.equal(state.phase, 'paused')
    assert.equal(state.experiment?.sourceHash, input.sourceHash)
    const source = z.object({ teamReservation: z.object({ teamId: z.string() }), spec: simulationRunSpecSchema })
      .parse(z.object({ snapshot: z.json() }).parse(original.body).snapshot)
    assert.notEqual(state.teamReservation!.teamId, source.teamReservation.teamId)
    let inputs = 0
    for (const entity of Object.values(state.entities)) {
      if (entity.binding === undefined) continue
      const stored = await ctx.sessionPersistence.readFrom(entity.binding.sessionId, 0)
      assert.ok(JSON.stringify(stored.events).includes('experiment/initial-memory'))
      inputs++
    }
    assert.throws(() => mergeWorldExperimentBranches(), /unsupported/)
    console.log(JSON.stringify({ phase: state.phase, sourceProvenance: true, actualInheritedInputs: inputs,
      isolatedTeam: true, exactProcessRecovery: true, realEffects: state.experiment.realEffects, merge: 'unsupported' }))
  } finally { await branch.connection.close(); await branch.run.close(); await ctx.fiber.dispose() }
}
