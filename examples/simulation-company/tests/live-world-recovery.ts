/** Restore actual live-trial evidence without inference, preserving the original business and Session identities. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationEntityIdSchema, simulationCheckpointIdSchema } from '@clocky/clocky-simulation'
import { z } from 'zod'

const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const original = z.object({ state: z.object({ world: z.json(), relations: z.json(), resources: z.json(), decisions: z.json(),
  entities: z.record(z.string(), z.object({ binding: z.json().optional(), profile: z.json() })) }) }).parse(JSON.parse(await readFile(resolve(root, 'summary.json'), 'utf8'))).state
const selection = simulationRunSelectionSchema.parse(JSON.parse(await readFile(resolve(root, 'selection.json'), 'utf8')))
let networkCalls = 0, modelCalls = 0
const previous = globalThis.fetch
globalThis.fetch = () => { networkCalls++; throw new Error('Cold verification must not contact a model or external service') }
const ctx = await boot('live-world-cold-verification', process.argv[2]!)
ctx.on('llm/stream', () => { modelCalls++; throw new Error('Cold verification must not infer') })
try {
  const restored = await ctx.simulationTeams.restore(selection, { id: simulationCheckpointIdSchema.parse('live-final'),
    implementationVersion: 'live-world/1', maxAttempts: 3 })
  try {
    const state = restored.run.snapshot()
    assert.equal(state.phase, 'paused')
    assert.deepEqual(state.world, original.world)
    assert.deepEqual(state.relations, original.relations)
    assert.deepEqual(state.resources, original.resources)
    assert.deepEqual(state.decisions, original.decisions)
    assert.deepEqual(Object.keys(state.entities).sort(), Object.keys(original.entities).sort())
    for (const [rawId, entity] of Object.entries(original.entities)) {
      const id = simulationEntityIdSchema.parse(rawId)
      assert.deepEqual(state.entities[id]?.binding, entity.binding)
      assert.deepEqual(state.entities[id]?.profile, entity.profile)
    }
    assert.equal(modelCalls, 0); assert.equal(networkCalls, 0)
    const proof = { pid: process.pid, phase: state.phase, modelCalls, networkCalls, originalWorldEqual: true,
      originalRelationsEqual: true, originalResourcesEqual: true, originalDecisionsEqual: true, state }
    await writeFile(resolve(root, 'cold-proof.json'), JSON.stringify(proof, null, 2) + '\n')
    console.log(JSON.stringify({ pid: process.pid, phase: state.phase, modelCalls, networkCalls }))
  } finally { await restored.connection.close(); await restored.run.close() }
} finally { await ctx.fiber.dispose(); globalThis.fetch = previous }
