/** Fixed F0 longitudinal laboratory history over the real example Loader and canonical owners. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { runLongitudinalGovernance } from '../../../packages/simulation/simulation-local/tests/world-longitudinal-governance.ts'

const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes('/src/'), path)
const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const root = process.env.SIMULATION_COMPANY_ROOT
assert.ok(root)
const rounds = Number(process.env.WORLD_LONGITUDINAL_ROUNDS ?? '32')
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 64)
const ctx = await boot('world-longitudinal', process.argv[2]!)
try {
  const proofPath = resolve(root, 'longitudinal-proof.json')
  if (process.env.WORLD_POST_MVP_RECOVER === 'true') {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      recovery: { selection: unknown; governance: unknown; norms: unknown }
      result: Record<string, unknown> }
    const selected = simulationRunSelectionSchema.parse(proof.recovery.selection)
    const before = performance.now()
    const run = await ctx.simulations.open({ ...selected, mode: 'open' })
    try {
      assert.deepEqual(run.snapshot().world?.governance, proof.recovery.governance)
      assert.deepEqual(run.snapshot().world?.norms, proof.recovery.norms)
      console.log(JSON.stringify({ backend, runtimePaths, scenario: 'laboratory', ...proof.result,
        recoveredProcess: true, processPeakRssBytes: process.resourceUsage().maxRSS * 1024, coldRestoreMs: performance.now() - before }))
    } finally { await run.close() }
  } else {
    const { recovery, inputs, ...result } = await runLongitudinalGovernance(backend, {
      loadedContext: { ctx, serviceFiber: ctx.fiber }, evidenceRoot: root, rounds })
    await writeFile(resolve(root, 'longitudinal-input.json'), JSON.stringify(inputs) + '\n')
    await writeFile(proofPath, JSON.stringify({ recovery, result }) + '\n')
    console.log(JSON.stringify({ backend, runtimePaths, scenario: 'laboratory', ...result, recoveredProcess: false }))
  }
} finally { await ctx.fiber.dispose() }
