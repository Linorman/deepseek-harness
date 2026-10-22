/** The real provider rejects obsolete streams and required unknown records without reconstructing missing evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { StorageError } from '@clocky/clocky-storage'
import type { LogStream, StorageBackend } from '@clocky/clocky-storage'
import { compileWorldScenarioV1, parseWorldScenarioV1, resolvedWorldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { simulationRunSelectionSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type { SimulationRunSpec } from '@clocky/clocky-simulation'
import { definition, deployment } from './fixtures/world-norm-role/source.ts'
import { requests } from './world-external-actor-model.ts'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation-local', '@clocky/clocky-simulation-scenario',
  '@clocky/clocky-storage-json', '@clocky/clocky-storage-sqlite'].map(name => [name, import.meta.resolve(name)]))
assert.ok(Object.values(runtimePaths).every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
if (face === 'lib') assert.deepEqual(process.execArgv, [])
const ctx = await boot('world-version-policy', process.argv[2]!)
const rejected: Array<{ runId: string; version: number; mode: string; code: string; error: string }> = []
try {
  const compiled = await compileWorldScenarioV1(definition, deployment)
  assert.ok(compiled.ok); const resolved = compiled.resolved
  const compilerRefusals = [], authorRefusals = []
  for (const unsupported of [...Array.from({ length: 9 }, (_, value) => String(value)), '10', 'future']) {
    const parsed = resolvedWorldScenarioV1Schema.safeParse({ ...resolved, compilerVersion: unsupported })
    assert.equal(parsed.success, false)
    if (parsed.success) throw new Error('Unsupported compiler unexpectedly parsed')
    assert.ok(parsed.error.issues.some(issue => issue.path.join('.') === 'compilerVersion'))
    compilerRefusals.push(unsupported)
  }
  assert.deepEqual(resolvedWorldScenarioV1Schema.parse(resolved), resolved)
  for (const apiVersion of ['clocky.world/v0', 'clocky.world/v2', 'unknown']) {
    const parsed = parseWorldScenarioV1({ ...definition, apiVersion })
    assert.equal(parsed.ok, false)
    authorRefusals.push(apiVersion)
  }
  const spec = simulationRunSpecSchema.parse({ runId: 'current-version', ...resolved.native })
  const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec }))
  const stream = Reflect.get(run, 'stream') as LogStream, version = stream.version
  assert.equal(stream.name, 'simulation'); assert.ok(Number.isSafeInteger(version) && version > 0)
  const initial = run.snapshot(); assert.equal(initial.phase, 'paused'); await run.close()
  const valid = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec }))
  assert.deepEqual(valid.snapshot(), initial); await valid.close()
  for (const unsupported of [...Array.from({ length: version }, (_, value) => value), version + 1, version + 8]) {
    const runId = `unsupported-version:${unsupported}`, foreignSpec = simulationRunSpecSchema.parse({ ...spec, runId })
    const directory = resolve(root, 'simulation', createHash('sha256').update(runId).digest('hex'))
    const medium = backend === 'json' ? new JsonStorageBackend(resolve(directory, 'journal'))
      : new SqliteStorageBackend({ path: resolve(directory, 'journal.sqlite') })
    const foreign = await medium.log.open({ name: 'simulation', version: unsupported })
    const record: { kind: string; spec: SimulationRunSpec; backend: 'json' | 'sqlite' } = {
      kind: 'run/created', spec: foreignSpec, backend,
    }
    await foreign.append(-1, [record]); await medium.close()
    for (const mode of ['inspect', 'open']) {
      const call = mode === 'open' ? () => ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode, spec: foreignSpec }))
        : () => ctx.simulations.inspect({ provider: 'local', spec: foreignSpec, includeRecords: true })
      await assert.rejects(call, (error: unknown) => {
        assert.ok(error instanceof StorageError && error.code === 'version-mismatch',
          JSON.stringify({ runId, unsupported, mode, error: String(error) }))
        rejected.push({ runId, version: unsupported, mode, code: error.code, error: error.message }); return true
      })
    }
    const check: StorageBackend = backend === 'json' ? new JsonStorageBackend(resolve(directory, 'journal'))
      : new SqliteStorageBackend({ path: resolve(directory, 'journal.sqlite') })
    try {
      assert.ok(check.log)
      const original: LogStream = await check.log.open({ name: 'simulation', version: unsupported })
      assert.equal(original.tailSequence, 0); assert.deepEqual(await original.read(-1, 2), [{ sequence: 0, value: record }])
    } finally { await check.close() }
  }
  const runId = 'unknown-required-record', unknownSpec = simulationRunSpecSchema.parse({ ...spec, runId })
  const unknownRun = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: unknownSpec }))
  const before = unknownRun.snapshot(); await unknownRun.close()
  const directory = resolve(root, 'simulation', createHash('sha256').update(runId).digest('hex'))
  const medium = backend === 'json' ? new JsonStorageBackend(resolve(directory, 'journal'))
    : new SqliteStorageBackend({ path: resolve(directory, 'journal.sqlite') })
  const unknown = await medium.log.open({ name: 'simulation', version })
  await unknown.append(0, [{ kind: 'run/required-future-domain', runId, expectedRevision: before.revision, payload: { required: true } }])
  const retained = await unknown.read(-1, 4); await medium.close()
  await assert.rejects(() => ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: unknownSpec })))
  await assert.rejects(() => ctx.simulations.inspect({ provider: 'local', spec: unknownSpec, includeRecords: true }))
  const unchanged = backend === 'json' ? new JsonStorageBackend(resolve(directory, 'journal'))
    : new SqliteStorageBackend({ path: resolve(directory, 'journal.sqlite') })
  try {
    const original = await unchanged.log.open({ name: 'simulation', version })
    assert.equal(original.tailSequence, 1); assert.deepEqual(await original.read(-1, 4), retained)
  } finally { await unchanged.close() }
  assert.equal(requests.length, 0); assert.equal(ctx.simulationTeams.modelUsage().active, 0)
  const proof = { face, backend, pid: process.pid, runtimePaths, version, initial, rejected,
    compilerRefusals, authorRefusals, unknownRequired: { rejected: true, retained }, modelCalls: requests.length }
  await writeFile(resolve(root, 'version-policy-proof.json'), JSON.stringify(proof, null, 2) + '\n')
  process.stdout.write(JSON.stringify({ face, backend, version, obsoleteStreams: version + 2,
    refusals: rejected.length, compilerRefusals: compilerRefusals.length, authorRefusals: authorRefusals.length,
    unknownRequiredRejected: true, modelCalls: 0 }) + '\n')
} finally { await ctx.fiber.dispose() }
