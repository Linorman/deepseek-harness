/** Repeated real Loader startup and teardown without opening a Simulation run. */
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { boot } from '@clocky/clocky-app-boot'
import type {} from '@clocky/clocky-simulation-team'

const root = process.env['SIMULATION_COMPANY_ROOT']
assert.ok(root)
let modelCalls = 0, commits = 0
for (let cycle = 0; cycle < 3; cycle += 1) {
  const ctx = await boot('simulation-idle', process.argv[2]!)
  try {
    ctx.on('llm/stream', () => { modelCalls += 1; throw new Error('Idle composition attempted inference') })
    ctx.on('simulation/committed', () => { commits += 1 })
    await setTimeout(50)
    assert.deepEqual(await ctx.sessionPersistence.list(), [])
    assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 0, queued: 0, limit: 2, queueLimit: 4 })
    await assert.rejects(access(join(root, 'simulation')), { code: 'ENOENT' })
    assert.equal(modelCalls, 0)
    assert.equal(commits, 0)
  } finally { await ctx.fiber.dispose() }
}
console.log(JSON.stringify({ cycles: 3, modelCalls, commits, sessions: 0, runStorageCreated: false }))
