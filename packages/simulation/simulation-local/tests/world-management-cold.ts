/** Plain-Node-compatible cold inspector over actual owner-produced user-command seeds; never opens a writer. */
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Context } from '@clocky/cordis'
import Simulations, { simulationRunSelectionSchema, simulationWorldManagementReceiptSchema,
  inspectWorldManagement } from '@clocky/clocky-simulation'
import * as Local from '@clocky/clocky-simulation-local'

const root = resolve('.local/world-completion/u07-native/cold-seeds')
const mode = process.env.WORLD_MANAGEMENT_COLD_MODE
assert.ok(mode === 'src' || mode === 'lib')
const nativeArtifact = import.meta.resolve('@clocky/clocky-simulation'),
  providerArtifact = import.meta.resolve('@clocky/clocky-simulation-local')
if (mode === 'lib') {
  assert.equal(process.execArgv.length, 0, 'Artifact cold proof must use plain Node without loader flags')
  assert.ok(!process.env.NODE_OPTIONS, 'Artifact cold proof must have no NODE_OPTIONS loader')
  assert.ok(!process.env.TSX_TSCONFIG_PATH, 'Artifact cold proof must not inherit source path aliases')
  assert.ok(nativeArtifact.endsWith('/lib/index.js'), nativeArtifact)
  assert.ok(providerArtifact.endsWith('/lib/index.js'), providerArtifact)
}
let openCalls = 0
Local.LocalSimulationProvider.prototype.open = () => { openCalls++; throw new Error('Cold inspection attempted writable open') }
const evidence = []
for (const seed of (await readdir(root)).sort()) {
  const directory = resolve(root, seed)
  const original = JSON.parse(await readFile(resolve(directory, 'original.json'), 'utf8')) as {
    backend: 'json' | 'sqlite'
    selection: unknown
    state: unknown
    receipt: unknown
    kind: string
  }
  const selection = simulationRunSelectionSchema.parse(original.selection),
    receipt = simulationWorldManagementReceiptSchema.parse(original.receipt)
  const ctx = new Context()
  try {
    await ctx.plugin(Simulations)
    await ctx.plugin(Local, { name: selection.provider, root: resolve(directory, 'simulation'), backend: original.backend,
      replayPageSize: 2 })
    const observed = await ctx.simulations.inspect({ provider: selection.provider, spec: selection.spec })
    assert.ok(observed)
    assert.equal(observed.owner, 'unowned')
    assert.deepEqual(JSON.parse(JSON.stringify(observed.snapshot)), original.state)
    assert.deepEqual(inspectWorldManagement(observed.snapshot, receipt.commandId, receipt.principalId), receipt)
    assert.equal(receipt.result?.outcome.kind, 'committed')
    assert.equal(receipt.execution?.phase, 'settled')
    evidence.push({ seed, revision: observed.snapshot.revision, commandId: receipt.commandId, requestId: receipt.requestId,
      planId: receipt.planId, resultId: receipt.result?.id, modelCalls: 0, owner: observed.owner })
  } finally { await ctx.fiber.dispose() }
}
assert.equal(evidence.length, 6)
assert.equal(openCalls, 0)
await writeFile(resolve('.local/world-completion/u07-native', `cold-${mode}-${process.pid}.json`),
  JSON.stringify({ mode, pid: process.pid, nativeArtifact, providerArtifact, evidence }, null, 2) + '\n')
console.log(JSON.stringify({ mode, pid: process.pid, cases: evidence.length, modelCalls: 0, nativeArtifact, providerArtifact }))
