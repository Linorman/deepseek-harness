/** Base Simulation attachment does not claim World-specific personnel authority or perform inference. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { teamIdSchema } from '@clocky/clocky-team'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import { createTestRootTeam } from '../../../packages/core/team/tests/bootstrap-topology-authority.ts'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'

const recovering = process.env.BASE_ATTACHMENT_RECOVER === 'true'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const scene = worldScenarioSchema.parse(JSON.parse(await readFile(resolve('examples/simulation-company/scenarios/world-company.json'), 'utf8')))
const compiled = await compileWorldScenario(scene, catalog())
assert.ok(compiled.ok)
const ctx = await boot('base-attachment', process.argv[2]!)
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: 'base-attachment', ...compiled.resolved.native } }))
try {
  const before = run.snapshot()
  assert.equal(before.teamReservation, undefined)
  assert.equal(before.world, undefined)
  const ownerName = 'simulation/base-attachment'
  const proofPath = resolve(root, 'base-attachment-team.json')
  const teamId = recovering ? teamIdSchema.parse(JSON.parse(await readFile(proofPath, 'utf8')))
    : (await createTestRootTeam(ctx, { goal: { objective: 'Base Simulation', budgets: {} }, budgets: {},
      rules: { activationLifecycleOwner: ownerName, simulationRunId: run.snapshot().spec.runId } })).team.id
  if (!recovering) await writeFile(proofPath, JSON.stringify(teamId))
  const connection = await ctx.simulationTeams.attach(run, teamId, ownerName)
  assert.deepEqual(run.snapshot(), before)
  assert.equal((await ctx.teams.getTeam({ teamId })).rules['activationLifecycleOwner'], ownerName)
  assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 0, queued: 0, limit: 1, queueLimit: 4 })
  await connection.close()
  assert.deepEqual(run.snapshot(), before)
  console.log(JSON.stringify({ attached: true, world: false, nativeTeamReservation: false, modelCalls: 0, appendCount: 0,
    phase: run.snapshot().phase, restored: recovering }))
} finally { await run.close(); await ctx.fiber.dispose() }
