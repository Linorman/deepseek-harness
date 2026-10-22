import { holdR06Retirement, recoverR06Retirement } from './world-r06-retirement.ts'
import { simulationWorldHireCommittedResultPayloadSchema } from '@clocky/clocky-simulation'
/** Both portable scenes use the same real Loader/Native/Team/World driver with independent newborn cognition. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { Context } from '@clocky/cordis'
import { boot } from '@clocky/clocky-app-boot'
import { simulationCheckpointIdSchema, simulationRunSelectionSchema, simulationChangeSchema,
  simulationPhaseManagementRequestSchema, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema, scenarioCatalogSchema } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, OrganizationWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-driver-model.ts'
import { verifyWorldReplanning, verifyWorldResubmission } from './world-replanning-scenario.ts'
import { applyWorldLimitScenario, verifyWorldLimits } from './world-limits-scenario.ts'
import { verifyWorldModelPool } from './world-model-pool-scenario.ts'
import { verifyWorldFairness } from './world-fairness-scenario.ts'

const scenario = z.enum(['company', 'laboratory']).parse(process.env.WORLD_SCENARIO)
const ctx = await boot('world-driver', process.argv[2]!)
const failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const maintenanceFailure = process.env.WORLD_DRIVER_MAINTENANCE_FAILURE === 'true'
const r06Retirement = process.env.WORLD_R06_RETIRED_EXECUTOR === 'true'
const acceptedPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-driver-original.json')
const retainedSchema = z.strictObject({ definition: worldScenarioSchema, catalog: scenarioCatalogSchema, resolved: z.json() })
let original
if (recovering) original = retainedSchema.parse(JSON.parse(await readFile(acceptedPath, 'utf8')))
else {
  const definition = worldScenarioSchema.parse(JSON.parse(await readFile(
    resolve(`examples/simulation-company/scenarios/world-${scenario}.json`), 'utf8')))
  applyWorldLimitScenario(definition)
  const installed = catalog()
  installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
  const accepted = await compileWorldScenario(definition, installed)
  assert.ok(accepted.ok)
  original = retainedSchema.parse({ definition, catalog: installed, resolved: accepted.resolved })
  await writeFile(acceptedPath, JSON.stringify(original))
}
const compiled = await compileWorldScenario(original.definition, original.catalog)
assert.ok(compiled.ok)
assert.deepEqual(compiled.resolved, original.resolved)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `world-driver-${scenario}`, ...compiled.resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse(r06Retirement ? 'world-initial' : 'world-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined

const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved: compiled.resolved,
    ownerName: `world-driver/${scenario}`, checkpoint: { id: simulationCheckpointIdSchema.parse('world-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  if (!recovering) {
    const observer = compiled.resolved.actors.find(value => value.persona.name === 'Observer')
    assert.ok(observer)
    const observed = run.snapshot().entities[observer.entityId as import('@clocky/clocky-simulation').SimulationEntityId]!
    await run.change(simulationChangeSchema.parse({ kind: 'entity/profile', id: observed.id, entityRevision: observed.revision,
      profile: { ...observed.profile, privateBelief: 'observer-private-sentinel-never-visible' } }), run.snapshot().revision)
  }
  const stateBefore = run.snapshot(), team = stateBefore.teamReservation
  assert.ok(team)
  const ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const checkpointId = restored?.manifest.id ?? prepared?.checkpoint.request.id
  assert.ok(checkpointId)
  const executionScope = maintenanceFailure ? new Context() : ctx
  const disposalErrors: unknown[] = []
  if (maintenanceFailure) executionScope.logger.error = (error: unknown) => { disposalErrors.push(error) }
  const lifetime = new AbortController().signal
  const anchor = { checkpointId, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const driver = new SimulationWorldDriver(run, connection, compiled.resolved, anchor, lifetime, executionScope,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: compiled.resolved,
      anchor: anchor,
      lifetime: lifetime,
    }, [new OrganizationWorldExecution(run, connection, compiled.resolved, anchor, lifetime)]))
  if (r06Retirement && recovering) {
    await recoverR06Retirement({ ctx, run, selection, connection, resolved: compiled.resolved, anchor, driver,
      models: () => requests.length, scope: executionScope })
  } else if (process.env.WORLD_DRIVER_FAIRNESS === 'true') {
    await verifyWorldFairness(run, connection, driver, recovering, scenario)
  } else if (process.env.WORLD_DRIVER_POOL !== undefined) {
    await verifyWorldModelPool(ctx, run, connection, driver, compiled.resolved, recovering)
  } else if (process.env.WORLD_DRIVER_REPLAN === 'true') {
    await verifyWorldReplanning(run, connection, driver, recovering, scenario)
  } else if (process.env.WORLD_DRIVER_RESUBMIT === 'true') {
    await verifyWorldResubmission(run, connection, driver, recovering, scenario)
  } else if (process.env.WORLD_DRIVER_LIMIT !== undefined) {
    await verifyWorldLimits(run, connection, driver, recovering, scenario)
  } else {
    if (!recovering && process.env.WORLD_DRIVER_PAUSE === 'true') {
      const participant = connection.ensureParticipant.bind(connection)
      connection.ensureParticipant = async (...args) => {
        const binding = await participant(...args)
        await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'user-pause-during-maintenance', phase: 'paused' }))
        return binding
      }
    }
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(requests.length, 0)
    let final
    if (recovering) {
      final = { reason: 'idle' as const }
      assert.equal(run.snapshot().phase, 'paused')
    } else {
      await run.setPhase('running', run.snapshot().revision)
      if (maintenanceFailure) {
        const finish = run.finishMaintenance.bind(run)
        run.finishMaintenance = async () => { throw new Error('Injected failure after hire commit before maintenance completion') }
        await assert.rejects(driver.advance(), /Injected failure after hire commit/)
        assert.equal(Object.values(run.snapshot().world!.reservations)[0]?.status, 'committed')
        assert.ok(activeSimulationMaintenance(run.snapshot()))
        await executionScope.fiber.dispose()
        assert.equal(disposalErrors.length, 1)
        assert.equal((disposalErrors[0] as { code?: unknown }).code, 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE')
        if (r06Retirement) await holdR06Retirement(ctx, run, selection)
        run.finishMaintenance = finish
        const callsBeforeReconciliation = requests.length
        assert.equal((await driver.reconcile()).reason, 'paused')
        assert.equal(requests.length, callsBeforeReconciliation)
        assert.equal(activeSimulationMaintenance(run.snapshot()), undefined)
        assert.equal(Object.values(run.snapshot().world!.reservations).length, 1)
        await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'explicit-continue-after-failed-finish', phase: 'running' }))
      }
      final = await driver.advance()
      if (process.env.WORLD_DRIVER_PAUSE === 'true') {
        assert.equal(final.reason, 'paused')
        assert.equal(run.snapshot().phase, 'paused')
        assert.equal(requests.length, 6)
        const result = Object.values(run.snapshot().world!.results)[0]
        assert.equal(result?.outcome.kind, 'committed')
        await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'explicit-continue-after-maintenance', phase: 'running' }))
        final = await driver.advance()
      }
      for (let round = 0; round < 8 && final.reason === 'work-limit'; round++) final = await driver.advance()
      assert.equal(final.reason, 'idle', JSON.stringify(final))
    }
    const state = run.snapshot(), world = state.world!
    const result = Object.values(world.results)[0]!
    assert.equal(result.outcome.kind, 'committed')
    if (result.outcome.kind !== 'committed') throw new Error('World driver must produce the actual committed result')
    const outcome = simulationWorldHireCommittedResultPayloadSchema.parse(result.payload), newborn = state.entities[outcome.entityId]!
    assert.equal(newborn.readiness, 'ready')
    assert.equal(newborn.phase, 'active')
    assert.equal(Object.values(state.relations).filter(value => value.id === outcome.relationId).length, 1)
    assert.equal(Object.values(world.reservations).length, 1)
    assert.equal(Object.values(world.requests).length, 1)
    assert.equal(Object.values(world.plans).length, 1)
    if (!recovering) {
      assert.ok(requests.some(value => value.purpose === 'first-action' && value.entityId === newborn.id))
      assert.ok(requests.some(value => value.purpose === 'result'))
    }
    assert.ok(newborn.binding)
    const stored = await ctx.sessionPersistence.readFrom(newborn.binding.sessionId, 0)
    const context = stored.events.filter(value => value.type === 'simulation/context-view')
    assert.ok(context.length > 0)
    assert.equal(JSON.stringify(stored.events).includes('Director-private rationale'), false)
    assert.equal(modelInputs.some(value => value.includes('observer-private-sentinel-never-visible')), false)
    const posts = Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
    assert.equal(posts.length, 3)
    assert.ok(posts.every(value => value.delivery?.receipt !== undefined))
    const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-driver-completion.json')
    const proof = { world, newborn, assignment: state.relations[outcome.relationId], posts }
    if (recovering) assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    const revision = state.revision, calls = requests.length
    assert.equal((await driver.advance()).reason, recovering ? 'paused' : 'idle')
    assert.equal(run.snapshot().revision, revision)
    assert.equal(requests.length, calls)
    if (!recovering) {
      await run.setPhase('paused', run.snapshot().revision)
      await driver.drain()
      const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-complete'),
        implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
      assert.equal(checkpoint.status, 'completed')
      await writeFile(proofPath, JSON.stringify({ ...proof, newborn: run.snapshot().entities[newborn.id] }))
    }
    await driver.drain()
    console.log(JSON.stringify({ scenario, result: result.outcome.kind, requests: 1, plans: 1, hires: 1,
      newborn: newborn.profile['name'], independentSession: true, firstAction: true, notified: true, privateInputsExcluded: true,
      stop: final.reason, modelCalls: calls }))
  }
} catch (cause: unknown) {
  const decisions = Object.values(run.snapshot().decisions).filter(value => value.status === 'open' || value.status === 'submitted')
  const details = decisions.map((decision) => {
    const binding = run.snapshot().entities[decision.entityId]?.binding
    const session = binding === undefined ? undefined : ctx.sessions.get(binding.sessionId)
    return { id: decision.id, actor: decision.entityId, scope: decision.context?.status === 'prepared' ? decision.context.world?.kind : undefined,
      errors: session?.events.filter(value => value.type === 'tool/result').flatMap(value => value.data.message.content)
        .filter(value => value.type === 'tool-result' && value.isError) }
  })
  throw new Error(JSON.stringify({ requests, details, failures }), { cause })
} finally { await run.close(); await ctx.fiber.dispose() }
