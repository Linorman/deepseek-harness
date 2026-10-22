/** Actual source-authorized environmental work and ordinary cases compete on the same bounded driver. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, ExternalWorldExecution, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import type { LogStream } from '@clocky/clocky-storage'
import { directorCatalog, directorDefinition, directorActors, directorVariant } from './fixtures/world-director-events/source.ts'
import { directorModelRequests } from './fixtures/world-director-events/model.ts'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_CALENDAR_TIME_RECOVER === 'true'
const round = process.env.WORLD_CALENDAR_TIME_ROUND!, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
const ctx = await boot('world-director-events', process.argv[2]!)
const compiled = await compileWorldScenarioV1(directorDefinition, directorCatalog, 'json', ctx.teams.getCreationLimits())
assert.ok(compiled.ok, JSON.stringify(compiled)); const resolved = compiled.resolved
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: 'director-events-world', ...resolved.native } })
const checkpointId = simulationCheckpointIdSchema.parse('director-events-complete')
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
let connection = restored?.connection
async function journal() {
  const stream = Reflect.get(run, 'stream') as LogStream, rows = []; let after = -1
  while (after < stream.tailSequence) {
    const page = await stream.read(after, 128); assert.ok(page.length); rows.push(...page); after = page.at(-1)!.sequence
  }
  return rows
}
async function actual() {
  const state = run.snapshot(), team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
  const channels = await Promise.all(team.channelIds.map(async channelId => ({ channelId,
    records: (await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })).records })))
  const sessions = await Promise.all(Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [(async () => {
    const binding = entity.binding!, unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
    return { entityId: entity.id, binding, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
  })()]))
  return { team, channels, sessions }
}
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: 'director-events/original', checkpoint: { id: simulationCheckpointIdSchema.parse('director-events-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']; assert.equal(typeof ownerName, 'string')
  connection ??= await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName: ownerName as string,
    maxDrainRounds: 4, maxAttempts: 3 }
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor,
    new AbortController().signal, ctx, ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: new AbortController().signal,
    }, directorVariant === 'mediated'
      ? [new ExternalMediatedWorldExecution(run, connection, resolved, anchor, new AbortController().signal)]
      : [new ExternalWorldExecution(run)]))
  if (!recovering) {
    await writeFile(resolve(root, 'input.json'), JSON.stringify({ resolved, directorDefinition, directorCatalog }, null, 2))
    assert.equal((await driver.advance()).reason, 'paused'); assert.equal(directorModelRequests.length, 0)
    await run.setPhase('running', run.snapshot().revision)
    const steps = []
    for (let time = 1; time <= 3; time++) {
      for (let batch = 0; batch < 64; batch++) {
        const result = await driver.advance(simTimeSchema.parse(String(time)))
        steps.push({ time, batch, result, revision: run.snapshot().revision, modelCalls: directorModelRequests.length })
        if (result.reason !== 'work-limit') { assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify(result)); break }
        assert.ok(batch < 63, 'Ordinary work must complete in finite bounded batches')
      }
      const state = run.snapshot(), requests = Object.values(state.world!.requests)
      const ordinary = requests.filter(value => value.requesterEntityId === directorActors.member)
      assert.equal(ordinary.length, time); assert.ok(ordinary.every(value => value.status === 'committed'))
      const scene = requests.filter(value => value.notificationOperationId === null)
      assert.equal(scene.length, Math.min(time, 2)); assert.ok(scene.every(value => value.status === 'committed'))
      assert.equal(state.resources[Object.keys(state.resources)[0] as keyof typeof state.resources]?.quantity, '7')
      await writeFile(resolve(root, `at-${time}.json`), JSON.stringify({ state, steps: structuredClone(steps), actual: await actual(), journal: await journal() }, null, 2))
    }
    await run.setPhase('paused', run.snapshot().revision)
    const checkpoint = await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    await writeFile(resolve(root, 'original.json'), JSON.stringify({ state: run.snapshot(), actual: await actual(), journal: await journal(), modelRequests: directorModelRequests }, null, 2))
  } else {
    const original = JSON.parse(await readFile(resolve(root, 'original.json'), 'utf8')) as { state: unknown; actual: unknown; journal: unknown }
    assert.deepEqual(run.snapshot(), original.state); assert.deepEqual(await actual(), original.actual)
    assert.deepEqual(await journal(), original.journal)
    assert.equal((await driver.advance()).reason, 'paused'); assert.equal(directorModelRequests.length, 0)
  }
  const state = run.snapshot(), requests = Object.values(state.world!.requests)
  const scene = requests.filter(value => value.notificationOperationId === null)
  assert.equal(scene.length, 2); assert.equal(requests.length, 5)
  for (const request of scene) {
    assert.ok(request.source.kind === 'decision')
    assert.ok(request.source.trigger); assert.equal(request.requesterEntityId, directorActors.director)
    const decision = state.decisions[request.source.decisionId]!; assert.equal(decision.context?.status, 'prepared')
    assert.ok(decision.context?.status === 'prepared' && decision.context.world?.kind === 'director-event')
    assert.deepEqual(decision.context.world.trigger, request.source.trigger)
    assert.equal(decision.operationIds.length, 1)
    assert.equal(Object.values(state.operations).filter(value => value.decisionId === decision.id && value.action.kind === 'communication/post').length, 0)
    const contexts = Object.values(state.decisions).flatMap(value => value.context?.status === 'prepared' ? [value.context.world] : [])
    assert.equal(contexts.filter(value => value?.kind === 'scenario-resolve' && value.requestId === request.id).length, 1)
    assert.equal(contexts.filter(value => value?.kind === 'scenario-result' && state.world!.results[value.resultId]?.requestId === request.id
      && value.externalEventId === undefined).length, 1)
  }
  const occurrences = state.worldBootstrap!.occurrences.filter(value => value.source.id === 'environment-calendar')
  assert.equal(occurrences.length, 3); assert.ok(occurrences.every(value => value.recipients.length === 0))
  assert.deepEqual(occurrences.map(value => value.directorEvents[0]!.status), ['eligible', 'eligible', 'budget-exhausted'])
  assert.equal(Object.values(state.scheduledEvents).filter(value => value.id.startsWith('simulation-world-director-event:')).length, 2)
  const output = { phase: state.phase, face, backend: process.env.SIMULATION_COMPANY_BACKEND, round, pid: process.pid,
    modelCalls: directorModelRequests.length, variant: directorVariant, scenarioRequests: 2, ordinaryRequests: 3, independentBudget: true,
    actualThreeContexts: true, noFakeNotification: true, boundedOrdinaryService: true, coldNoModel: recovering, runtimePaths }
  await writeFile(resolve(root, `round-${round}.json`), JSON.stringify({ ...output, state, actual: await actual(), journal: await journal() }, null, 2))
  process.stdout.write(JSON.stringify(output) + '\n')
} catch (error) {
  await writeFile(resolve(root, `failed-${round}.json`), JSON.stringify({ state: run.snapshot(), actual: await actual(), journal: await journal(), modelRequests: directorModelRequests, error: String(error) }, null, 2))
  throw error
} finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
