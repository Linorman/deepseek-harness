import { LongitudinalMetrics } from '../../../packages/simulation/simulation-local/tests/longitudinal-metrics.ts'
/** Fixed recurring association history, with real calendar wakes, model tools and independent outside-party results. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1, worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { projectPersonnelCounts, combinePersonnelCounts, simulationRunSelectionSchema, simulationCheckpointIdSchema, simTimeSchema,
  WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_EXTERNAL_MEDIATED_PIN } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-longitudinal-association-model.ts'

const root = process.env.SIMULATION_COMPANY_ROOT
assert.ok(root)
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes('/src/'), path)
const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const rounds = Number(process.env.WORLD_LONGITUDINAL_ROUNDS ?? '32')
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 64)
const recovering = process.env.WORLD_POST_MVP_RECOVER === 'true'
const definition = worldScenarioV1Schema.parse(JSON.parse(await readFile('examples/simulation-company/scenarios/world-association-v1.json', 'utf8')))
definition.behavior.initialGoals = []
definition.behavior.calendars = [{ id: 'longitudinal-library-meetings', target: { kind: 'position', positionId: 'council-seat' },
  body: 'meeting/library/widget', startsAt: '1', period: '2', endsAt: String(rounds * 2 - 1), maxOccurrences: rounds }]
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-longitudinal-association', name: 'scripted', version: '1', available: true }
for (const limits of [installed.limits.defaults, installed.limits.ceilings]) {
  Object.assign(limits.native, { maxDecisionsPerInterval: rounds * 64, maxMessagesPerInterval: rounds * 32,
    maxPendingEvents: rounds * 64, maxMicrostepsPerTime: 256, maxTokensPerInterval: 10000000,
    maxKnowledgeBytes: 262144 })
  Object.assign(limits.world, { maxRequests: rounds * 4, maxRequestsPerActorPerInterval: rounds * 4,
    maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 })
  Object.assign(limits.team, { maxWallTimeMsPerTeam: 7200000, maxPostIdempotencyEntriesPerChannel: rounds * 32,
    maxActivations: rounds * 32, maxTurnsPerTeam: rounds * 32, maxRatePerParticipantPerMinute: rounds * 64 })
}
installed.native.maxTime = String(rounds * 2)
const deployment = scenarioV1CatalogSchema.parse({ ...installed,
  domains: [WORLD_HIRE_EXISTING_PIN, WORLD_GOVERNANCE_HIRE_APPROVAL_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_EXTERNAL_MEDIATED_PIN]
    .map(pin => ({ pin, available: true })), factSchemas: ['clocky.world-fact/text/1'], normPolicies: ['clocky.organization.hiring-approval/1'] })
const ctx = await boot('world-longitudinal-association', process.argv[2]!)
const metrics = new LongitudinalMetrics(ctx)
ctx.on('agent/error', ({ error }) => { console.error(error) })
try {
  const compiled = await compileWorldScenarioV1(definition, deployment, 'json', ctx.teams.getCreationLimits())
  assert.ok(compiled.ok, JSON.stringify(compiled))
  const resolved = compiled.resolved, checkpoint = simulationCheckpointIdSchema.parse('longitudinal-final')
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
    spec: { runId: 'association-longitudinal', ...resolved.native } })
  const beforeRestore = performance.now()
  const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpoint, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
  const run = restored?.run ?? await ctx.simulations.open(selection)
  let connection = restored?.connection
  try {
    if (recovering) {
      const prior = z.object({ external: z.unknown(), calendarOccurrences: z.unknown() }).parse(
        JSON.parse(await readFile(resolve(root, 'association-proof.json'), 'utf8')))
      assert.deepEqual(run.snapshot().world?.external, prior.external)
      assert.deepEqual(run.snapshot().worldBootstrap?.occurrences, prior.calendarOccurrences)
      assert.equal(requests.length, 0)
      console.log(JSON.stringify({ backend, runtimePaths, scenario: 'association', rounds, recoveredProcess: true,
        processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        coldRestoreMs: performance.now() - beforeRestore, modelCalls: requests.length, restored: true }))
    } else {
      await writeFile(resolve(root, 'association-input.json'), JSON.stringify({ definition, deployment, resolved }) + '\n')
      const prepared = await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'association-longitudinal',
        checkpoint: { id: simulationCheckpointIdSchema.parse('longitudinal-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
      const ownerName = run.snapshot().teamReservation!.creation.rules.activationLifecycleOwner
      assert.equal(typeof ownerName, 'string')
      connection = await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
      const anchor = { checkpointId: prepared.checkpoint.request.id, ownerName: ownerName as string, maxDrainRounds: 8, maxAttempts: 3 }
      const lifetime = new AbortController()
      const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime.signal, ctx,
        ctx.simulationWorldExecutions.handlers({ run, connection, resolved, anchor, lifetime: lifetime.signal },
          [new ExternalMediatedWorldExecution(run, connection, resolved, anchor, lifetime.signal)]))
      await run.setPhase('running', run.snapshot().revision)
      const samples = []
      for (let index = 0; index < rounds; index++) {
        const started = performance.now(), until = simTimeSchema.parse(String(index * 2 + 1))
        let result = await driver.advance(until)
        for (let step = 0; step < 128 && result.reason === 'work-limit'; step++) result = await driver.advance(until)
        assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify(result))
        const state = run.snapshot()
        const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
        const people = combinePersonnelCounts(state, projectPersonnelCounts(state), { kind: 'full', runId: state.spec.runId,
          nativeCursor: state.revision, teamCursor: team.team.cursor, team })
        assert.equal(Object.keys(state.world!.external.adjudications).length, index + 1)
        samples.push({ ...metrics.sample(state), round: index + 1, time: state.time, elapsedMs: performance.now() - started,
          adjudications: Object.keys(state.world!.external.adjudications).length,
          modelCalls: requests.length, rss: process.memoryUsage().rss, people,
          activeActors: Object.values(state.entities).filter(entity => entity.cognition === 'agent'
            && entity.phase === 'active' && entity.readiness === 'ready').length })
        console.error(JSON.stringify({ kind: 'f0-progress', scenario: 'association', ...samples.at(-1) }))
      }
      await run.setPhase('paused', run.snapshot().revision)
      const saved = await connection.checkpoint({ id: checkpoint, implementationVersion: 'world/1', maxDrainRounds: 8, maxAttempts: 3 })
      assert.equal(saved.status, 'completed')
      const state = run.snapshot()
      await writeFile(resolve(root, 'association-proof.json'), JSON.stringify({ external: state.world!.external,
        calendarOccurrences: state.worldBootstrap?.occurrences, samples }) + '\n')
      console.log(JSON.stringify({ backend, runtimePaths, scenario: 'association', rounds, samples, modelCalls: requests.length,
        tokens: { input: requests.length * 10, output: requests.length * 5, costUnits: 0, basis: 'scripted fixture usage' },
        recoveredProcess: false, restored: true }))
    }
  } finally { await connection?.close(); await run.close() }
} finally { await ctx.fiber.dispose() }
