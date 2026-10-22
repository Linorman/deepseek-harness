/** Actual copied durable owners are validated against an initial checkpoint before any restored scheduling admission. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { boot } from '@clocky/clocky-app-boot'
import { resolvedWorldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { simulationCheckpointIdSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { requests } from './fixtures/complete-world/model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src', fault = process.env.WORLD_RESTORE_CONTRACT_FAULT ?? 'none'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-team']
  .map(name => [name, import.meta.resolve(name)]))
assert.ok(Object.values(runtimePaths).every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
if (face === 'lib') assert.deepEqual(process.execArgv, [])
const source = JSON.parse(await readFile(join(root, 'input.json'), 'utf8')) as { resolved: unknown }
const resolved = resolvedWorldScenarioV1Schema.parse(source.resolved)
const original = JSON.parse(await readFile(join(root, 'original.json'), 'utf8')) as { state: { revision: number } }
const nativeRoot = join(root, 'simulation', createHash('sha256').update('complete-world').digest('hex'))
async function journal(): Promise<unknown> {
  if (backend === 'json') {
    const document = JSON.parse(await readFile(join(nativeRoot, 'journal', 'logs', Buffer.from('simulation').toString('base64url') + '.json'),
      'utf8')) as { entries: unknown }
    assert.ok(Array.isArray(document.entries))
    return document.entries
  }
  const db = new DatabaseSync(join(nativeRoot, 'journal.sqlite'), { readOnly: true })
  try { return db.prepare('SELECT sequence, value FROM log_entries WHERE stream=? ORDER BY sequence').all('simulation') }
  finally { db.close() }
}
const before = await journal(), ctx = await boot('world-restore-contract', process.argv[2]!)
const counters = { model: 0, activation: 0, publication: 0, attachment: 0, writableOpen: 0 }
const stream = ctx.llm.stream.bind(ctx.llm), activate = ctx.agentRuntimes.activate.bind(ctx.agentRuntimes)
const post = ctx.teams.postChannelEnvelope.bind(ctx.teams), attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
const open = ctx.simulations.open.bind(ctx.simulations)
ctx.llm.stream = (...args) => { counters.model++; return stream(...args) }
ctx.agentRuntimes.activate = (...args) => { counters.activation++; return activate(...args) }
ctx.teams.postChannelEnvelope = (...args) => { counters.publication++; return post(...args) }
ctx.simulationTeams.attach = (...args) => { counters.attachment++; return attach(...args) }
ctx.simulations.open = (...args) => { counters.writableOpen++; return open(...args) }
let refusal: { name: string; message: string; code?: unknown; diagnostic?: unknown } | undefined
try {
  const work = ctx.simulationTeams.restore(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open',
    spec: { runId: 'complete-world', ...resolved.native } }), { id: simulationCheckpointIdSchema.parse('complete-world-initial'),
    implementationVersion: 'world/1', maxAttempts: 3 })
  if (fault === 'none') {
    const restored = await work
    assert.equal(restored.run.snapshot().phase, 'paused')
    assert.equal(restored.run.snapshot().revision, original.state.revision)
    assert.equal(restored.manifest.id, 'complete-world-initial')
    await restored.run.close()
  } else {
    await assert.rejects(work, (error: unknown) => {
      assert.ok(error instanceof Error)
      refusal = { name: error.name, message: error.message,
        code: Reflect.get(error, 'code'), diagnostic: Reflect.get(error, 'diagnostic') }
      return true
    })
    assert.equal(counters.attachment, 0)
  }
  assert.equal(counters.model, 0); assert.equal(counters.activation, 0); assert.equal(counters.publication, 0)
  assert.equal(requests.length, 0)
  const after = await journal(); assert.deepEqual(after, before)
  const result = { face, backend, fault, initialCheckpoint: 'complete-world-initial', refused: fault !== 'none',
    phase: fault === 'none' ? 'paused' : undefined, originalJournalUnchanged: true, counters, refusal, runtimePaths }
  await writeFile(join(root, 'restore-contract-proof.json'), JSON.stringify({ ...result, before, after }, null, 2))
  console.log(JSON.stringify(result))
} finally { await ctx.fiber.dispose() }
