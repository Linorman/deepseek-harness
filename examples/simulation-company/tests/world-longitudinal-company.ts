import { LongitudinalMetrics } from '../../../packages/simulation/simulation-local/tests/longitudinal-metrics.ts'
/** Repeated independent existing-person offers grow one company's history through the unchanged driver. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1, worldScenarioV1Schema, scenarioV1CatalogSchema } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { WORLD_HIRING_MARKET_PIN, WORLD_HIRE_EXISTING_PIN, simulationResourceSpecSchema, simulationHiringFeePolicySchema,
  simulationQuantitySchema, simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWakeRequestSchema,
  simulationWorldGoalSchema,
  hiringMarket, simulationEntityIdSchema, projectPersonnelCounts, combinePersonnelCounts } from '@clocky/clocky-simulation'
import { worldV1Definition, worldV1Catalog } from './fixtures/world-v1-product/deployment.ts'
import { requests, modelInputs } from './world-longitudinal-company-model.ts'

const root = process.env.SIMULATION_COMPANY_ROOT
assert.ok(root)
const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const rounds = Number(process.env.WORLD_LONGITUDINAL_ROUNDS ?? '32')
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 64)
const recovering = process.env.WORLD_POST_MVP_RECOVER === 'true'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes('/src/'), path)
const definition = structuredClone(worldV1Definition), installed = structuredClone(worldV1Catalog)
const [hr, candidate] = definition.entities.filter(value => 'role' in value && value.role === 'member')
assert.ok(hr && candidate)
const organization = definition.organization.rootId
const position = definition.organization.grants.find(value => value.personId === hr.id && value.relation === 'can-hire')!.targetId
const pins = [WORLD_HIRE_EXISTING_PIN, WORLD_HIRING_MARKET_PIN]
definition.domains = pins.map(({ domain, operation, version }) => ({ domain, operation, version }))
definition.organization.assignments = definition.organization.assignments.filter(value => value.personId !== candidate.id)
definition.organization.grants = definition.organization.grants.filter(value => value.personId === hr.id && value.relation === 'can-hire')
  .map(value => ({ ...value, operation: WORLD_HIRE_EXISTING_PIN.operation }))
for (const actor of [hr, candidate]) definition.organization.grants.push({ id: `market-${actor.id}`, personId: actor.id,
  domain: 'organization', operation: 'hiring-market', version: '1', scopeId: organization, targetId: position,
  relation: 'can-market', validFrom: '0', validUntil: null })
definition.organization.grants.push({ id: 'candidate-eligibility', personId: candidate.id, domain: 'organization', operation: 'hiring-market',
  version: '1', scopeId: organization, targetId: organization, relation: 'eligible-for-hire', validFrom: '0', validUntil: null })
definition.behavior = { initialGoals: [], calendars: [], directorEvents: [] }
definition.governance = { committees: [], norms: [] }; definition.facts = []; definition.knowledge = []
definition.externalWorld = { mode: 'simulated-only', identities: [] }
definition.resources = [{ id: 'cash', owner: organization, controllers: [hr.id], kind: 'money', unit: 'credit', quantity: '10' },
  { id: 'payee', owner: candidate.id, controllers: [], kind: 'money', unit: 'credit', quantity: '0' }].map(value => simulationResourceSpecSchema.parse(value))
definition.organization.hiringFees = [simulationHiringFeePolicySchema.parse({ id: 'fee', version: '1', policyRef: 'clocky.organization.hiring-fee/1',
  operation: WORLD_HIRE_EXISTING_PIN.operation, positionEntityId: position, from: 'cash', to: 'payee', unit: 'credit', quantity: '3', grants: [], reservationPeriod: '10' })]
definition.limits.world = { maxRequests: 32, maxRequestsPerActorPerInterval: 32, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 }
installed.limits.defaults.native.maxResidentActors = 3
installed.limits.ceilings.native.maxResidentActors = 3
installed.limits.ceilings.world.maxRequests = 32
installed.limits.ceilings.world.maxRequestsPerActorPerInterval = 32
installed.limits.ceilings.world.maxBytesPerRequest = 65536
installed.limits.ceilings.world.maxBytesPerPlan = 65536
installed.domains = pins.map(pin => ({ pin, available: true }))
installed.runtimeProfiles = installed.runtimeProfiles.filter(value => value.version !== 'unavailable-model')
for (const runtime of installed.runtimeProfiles) runtime.model.provider = 'world-hiring-market-scripted'
const candidates = [candidate]
for (let index = 1; index < rounds; index++) {
  const person = { ...structuredClone(candidate), id: `long-candidate-${index}` }
  candidates.push(person); definition.entities.push(person)
  for (const relation of ['can-market', 'eligible-for-hire']) definition.organization.grants.push({
    id: `long-${index}-${relation}`, personId: person.id, domain: 'organization', operation: 'hiring-market', version: '1',
    scopeId: organization, targetId: relation === 'can-market' ? position : organization, relation, validFrom: '0', validUntil: null })
}
definition.organization.positions.find(value => value.id === position)!.capacity = rounds
  + definition.organization.assignments.filter(value => value.positionId === position).length
const cash = definition.resources.find(value => value.id === 'cash')!
cash.quantity = simulationQuantitySchema.parse(String(rounds * 3))
for (const limits of [installed.limits.defaults, installed.limits.ceilings]) {
  Object.assign(limits.native, { maxEntities: rounds + 16, maxResidentActors: 3, maxDecisionsPerInterval: rounds * 128,
    maxMessagesPerInterval: rounds * 128, maxPendingEvents: rounds * 128, maxMicrostepsPerTime: 256,
    maxTokensPerInterval: 10000000, maxResourceReservationHistory: rounds * 4 })
  Object.assign(limits.world, { maxRequests: rounds * 16, maxRequestsPerActorPerInterval: rounds * 16,
    maxBirthsPerInterval: rounds * 2, maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 })
  Object.assign(limits.team, { maxParticipants: rounds + 16, maxActivations: rounds * 32,
    maxWallTimeMsPerTeam: 7200000, maxTurnsPerTeam: rounds * 128, maxChannels: rounds * 8,
    maxPostIdempotencyEntriesPerChannel: rounds * 64, maxRatePerParticipantPerMinute: rounds * 128 })
}
definition.limits.world = { maxRequests: rounds * 16, maxRequestsPerActorPerInterval: rounds * 16,
  maxBytesPerRequest: 65536, maxBytesPerPlan: 65536 }
for (const runtime of installed.runtimeProfiles) runtime.model.provider = 'world-longitudinal-company'
const ctx = await boot('world-longitudinal-company', process.argv[2]!)
const metrics = new LongitudinalMetrics(ctx)
ctx.on('agent/error', ({ error }) => { console.error(error) })
try {
  const compiled = await compileWorldScenarioV1(worldScenarioV1Schema.parse(definition), scenarioV1CatalogSchema.parse(installed),
    'json', ctx.teams.getCreationLimits())
  assert.ok(compiled.ok, JSON.stringify(compiled))
  const resolved = compiled.resolved, checkpoint = simulationCheckpointIdSchema.parse('longitudinal-final')
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
    spec: { runId: 'company-longitudinal', ...resolved.native } })
  const start = performance.now()
  const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpoint, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
  const run = restored?.run ?? await ctx.simulations.open(selection)
  let connection = restored?.connection
  try {
    if (recovering) {
      const proof: unknown = JSON.parse(await readFile(resolve(root, 'company-proof.json'), 'utf8'))
      assert.deepEqual({ results: run.snapshot().world!.results, resources: run.snapshot().resources,
        relations: run.snapshot().relations, entities: Object.values(run.snapshot().entities)
          .map(value => ({ id: value.id, binding: value.binding ?? null })) }, proof)
      assert.equal(requests.length, 0)
      console.log(JSON.stringify({ backend, runtimePaths, scenario: 'company', rounds, recoveredProcess: true,
        processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        coldRestoreMs: performance.now() - start, modelCalls: requests.length, restored: true }))
    } else {
      await writeFile(resolve(root, 'company-input.json'), JSON.stringify({ definition, installed, resolved }) + '\n')
      const prepared = await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'company-longitudinal',
        checkpoint: { id: simulationCheckpointIdSchema.parse('longitudinal-initial'), maxDrainRounds: 8, maxAttempts: 3 } })
      const ownerName = run.snapshot().teamReservation!.creation.rules.activationLifecycleOwner
      assert.equal(typeof ownerName, 'string')
      connection = await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
      const anchor = { checkpointId: prepared.checkpoint.request.id, ownerName: ownerName as string, maxDrainRounds: 8, maxAttempts: 3 }
      const lifetime = new AbortController().signal
      const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx,
        ctx.simulationWorldExecutions.handlers({ run, connection, resolved, anchor, lifetime }))
      await run.setPhase('running', run.snapshot().revision)
      const samples = []
      for (let index = 0; index < rounds; index++) {
        const began = performance.now(), person = candidates[index]!
        const original = run.snapshot().entities[simulationEntityIdSchema.parse(person.id)]!.binding
        for (const step of ['vacancy', 'application', 'hire', 'offer', 'delivered', 'accepted']) {
          const goal = `${step}|${index}|${person.id}`, entityId = ['application', 'accepted'].includes(step) ? person.id : hr.id
          const wake = simulationWakeRequestSchema.parse({ id: `company-${step}-${index}`, entityId,
            time: String(BigInt(run.snapshot().time) + 1n), reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal })) })
          await run.scheduleWake(wake, run.snapshot().revision)
          let result = await driver.advance(wake.time)
          for (let attempt = 0; attempt < 128 && result.reason === 'work-limit'; attempt++) result = await driver.advance(wake.time)
          assert.ok(['idle', 'until', 'approval-required'].includes(result.reason), JSON.stringify(result))
        }
        const state = run.snapshot(), offer = hiringMarket(state).offers.get(`offer-${index}`)!
        assert.equal(offer.status, 'accepted')
        assert.deepEqual(state.entities[simulationEntityIdSchema.parse(person.id)]!.binding, original)
        assert.equal(Object.values(state.relations).filter(value => value.subject === person.id && value.relation === 'assignment').length, 1)
        assert.equal(Object.values(state.resources).find(value => value.id === 'cash')!.quantity, String((rounds - index - 1) * 3))
        const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
        const people = combinePersonnelCounts(state, projectPersonnelCounts(state), { kind: 'full', runId: state.spec.runId,
          nativeCursor: state.revision, teamCursor: team.team.cursor, team })
        samples.push({ ...metrics.sample(state), round: index + 1, time: state.time, elapsedMs: performance.now() - began,
          modelCalls: requests.length,
          offers: hiringMarket(state).offers.size, assignments: index + 1, rss: process.memoryUsage().rss, people,
          activeActors: Object.values(state.entities).filter(value => value.cognition === 'agent' && value.phase === 'active').length })
        console.error(JSON.stringify({ kind: 'f0-progress', scenario: 'company', ...samples.at(-1) }))
      }
      assert.ok(modelInputs.filter(value => candidates.some(person => person.id === value.entityId))
        .every(value => !value.privateCanary))
      await run.setPhase('paused', run.snapshot().revision); await driver.drain()
      assert.equal((await connection.checkpoint({ id: checkpoint, implementationVersion: 'world/1', maxDrainRounds: 8, maxAttempts: 3 })).status, 'completed')
      const state = run.snapshot()
      await writeFile(resolve(root, 'company-proof.json'), JSON.stringify({ results: state.world!.results, resources: state.resources,
        relations: state.relations, entities: Object.values(state.entities).map(value => ({ id: value.id, binding: value.binding ?? null })) }) + '\n')
      console.log(JSON.stringify({ backend, runtimePaths, scenario: 'company', rounds, samples, modelCalls: requests.length,
        tokens: { input: requests.length * 10, output: requests.length * 5, costUnits: 0, basis: 'scripted fixture usage' },
        recoveredProcess: false, restored: true }))
    }
  } finally { await connection?.close(); await run.close() }
} finally { await ctx.fiber.dispose() }
