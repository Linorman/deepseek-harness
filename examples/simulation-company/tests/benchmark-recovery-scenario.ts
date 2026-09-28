/** Fresh-process recovery measurement without inference or outbound publication. @module */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointRestoreRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const root = process.env['SIMULATION_COMPANY_ROOT']
if (!root) throw new Error('SIMULATION_COMPANY_ROOT must name recovery data')
const raw: unknown = JSON.parse(await readFile(join(root, '..', 'recovery.json'), 'utf8'))
assert.ok(typeof raw === 'object' && raw !== null && 'selection' in raw && 'request' in raw && 'fingerprint' in raw)
assert.equal(typeof raw.fingerprint, 'string')
const selection = simulationRunSelectionSchema.parse(raw.selection)
const request = simulationCheckpointRestoreRequestSchema.parse(raw.request)
const started = performance.now()
const ctx = await boot('simulation-benchmark-cold-recovery', process.argv[2]!)
let run: SimulationRun | undefined
let modelCalls = 0, publications = 0
ctx.on('llm/stream', () => { modelCalls += 1; throw new Error('Recovery attempted inference') })
ctx.teams.postChannelEnvelope = () => { publications += 1; return Promise.reject(new Error('Recovery attempted publication')) }
try {
  const restored = await ctx.simulationTeams.restore(selection, request)
  run = restored.run
  assert.equal(createHash('sha256').update(JSON.stringify(run.snapshot())).digest('hex'), raw.fingerprint)
  assert.equal(modelCalls, 0)
  assert.equal(publications, 0)
  console.log(JSON.stringify({ kind: 'cold-recovery', replayEqual: true, modelCalls, publications,
    restoreMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024, cpuMicros: process.cpuUsage() }))
} finally { await run?.close(); await ctx.fiber.dispose() }
