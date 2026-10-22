/** Runnable keyless composite governance and proxy scenarios over the real example Loader composition. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { boot } from '@clocky/clocky-app-boot'
import { runPostMvpProxy, runPostMvpRoute } from '../../../packages/simulation/simulation-local/tests/world-post-mvp-flow.ts'
const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const kind = process.env.WORLD_POST_MVP_FLOW
assert.ok(kind === 'proxy' || kind === 'route')
const ctx = await boot('world-post-mvp', process.argv[2]!)
try {
  const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'recovery-proof.json')
  if (process.env.WORLD_POST_MVP_RECOVER === 'true') {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      recovery: { selection: unknown; governance: unknown; norms: unknown }
      result: Record<string, unknown> }
    const selected = simulationRunSelectionSchema.parse(proof.recovery.selection)
    const run = await ctx.simulations.open({ ...selected, mode: 'open' })
    try {
      assert.deepEqual(run.snapshot().world?.governance, proof.recovery.governance)
      assert.deepEqual(run.snapshot().world?.norms, proof.recovery.norms)
      console.log(JSON.stringify({ backend, kind, ...proof.result, modelCalls: 0, recoveredProcess: true }))
    } finally { await run.close() }
  } else {
    const run = kind === 'proxy' ? runPostMvpProxy : runPostMvpRoute
    const { recovery, ...result } = await run(backend, { loadedContext: { ctx, serviceFiber: ctx.fiber },
      evidenceRoot: process.env.SIMULATION_COMPANY_ROOT! })
    await writeFile(proofPath, JSON.stringify({ recovery, result }) + '\n')
    console.log(JSON.stringify({ backend, kind, ...result, recoveredProcess: false }))
  }
} finally { await ctx.fiber.dispose() }
