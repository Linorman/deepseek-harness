/** A real Loader, canonical Agent and recorded three-tool inputs reserve, expire and settle conserved money. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationDecisionIdSchema,
  simulationEntityIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationOperationResult, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { resourceDefinition, resourceCatalog, resourceActorId } from './fixtures/resource-reservations/source.ts'
import { resourceModelRequests } from './fixtures/resource-reservations/model.ts'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_CALENDAR_TIME_RECOVER === 'true'
const round = process.env.WORLD_CALENDAR_TIME_ROUND!, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local'].map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
const ctx = await boot('resource-reservations', process.argv[2]!)
const compiled = await compileWorldScenarioV1(resourceDefinition, resourceCatalog, 'json', ctx.teams.getCreationLimits())
assert.ok(compiled.ok, JSON.stringify(compiled)); const resolved = compiled.resolved
const checkpointId = simulationCheckpointIdSchema.parse('resources-complete')
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: { runId: 'resource-world', ...resolved.native } })
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
async function sessions() {
  return await Promise.all(Object.values(run.snapshot().entities).flatMap(entity => entity.binding === undefined ? [] : [(async () => {
    const binding = entity.binding!, unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
    return { entityId: entity.id, binding, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
  })()]))
}
try {
  if (!recovering) await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'resource-world/original',
    checkpoint: { id: simulationCheckpointIdSchema.parse('resources-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']; assert.equal(typeof ownerName, 'string')
  connection ??= await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  if (!recovering) {
    await writeFile(resolve(root, 'input.json'), JSON.stringify({ resolved, resourceDefinition, resourceCatalog }, null, 2))
    assert.equal(run.snapshot().phase, 'paused'); assert.equal(resourceModelRequests.length, 0)
    await run.setPhase('running', run.snapshot().revision)
    const actorId = simulationEntityIdSchema.parse(resourceActorId)
    const runtime = resolved.actors.find(value => value.entityId === actorId)!.runtime
    await connection.ensureResident(actorId, { activation: { provider: runtime.provider, seed: { kind: 'fresh' },
      agent: { preset: runtime.preset, options: { provider: runtime.model.provider, model: runtime.model.name } },
      signal: new AbortController().signal }, evict: [] })
    const outcomes: Array<{ purpose: string; decisionId: string; operationId: string; result: SimulationOperationResult }> = []
    const execute = async (purpose: string, code: string) => {
      const state = run.snapshot()
      const id = simulationDecisionIdSchema.parse(`resource/${purpose}`)
      const decision = await connection!.executeDecision(actorId, id, { personaVersion: 'world/1', modelVersion: '1', sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: state.revision }],
        sections: [
          { kind: 'identity' as const, required: true, blocks: [{ type: 'text' as const, text: JSON.stringify({ actorId, profile: state.entities[actorId]!.profile }) }] },
          { kind: 'authority' as const, required: true, blocks: [{ type: 'text' as const, text: JSON.stringify({ controlledAccounts: Object.values(state.resources)
            .filter(value => value.controllers.includes(actorId)).map(value => value.id) }) }] },
          { kind: 'goals' as const, required: true, blocks: [{ type: 'text' as const, text: 'Exercise the original finite local resource workflow through the three tools.' }] },
          { kind: 'commitments' as const, required: true, blocks: [{ type: 'text' as const, text: JSON.stringify(state.commitments) }] },
          { kind: 'input' as const, required: true, blocks: [{ type: 'text' as const, text: JSON.stringify({ kind: 'resource-reservation-probe', purpose,
            resources: Object.values(state.resources), reservations: Object.values(state.resourceReservations), clock: state.time,
            historyLimit: state.spec.maxResourceReservationHistory }) }] }].toSorted((a, b) =>
          ['identity', 'authority', 'input', 'goals', 'commitments'].indexOf(a.kind)
              - ['identity', 'authority', 'input', 'goals', 'commitments'].indexOf(b.kind)) })
      assert.equal(decision.status, 'accepted'); assert.equal(decision.operationIds.length, 1)
      const operationId = decision.operationIds[0]!, result = await run.executeOperation(operationId)
      assert.equal(result.code, code); outcomes.push({ purpose, decisionId: id, operationId, result })
      await writeFile(resolve(root, `${purpose}.json`), JSON.stringify({ state: run.snapshot(), outcomes, journal: await journal(), sessions: await sessions() }, null, 2))
    }
    await execute('reserve', 'SIM_APPLIED')
    await execute('overbook', 'SIM_RESOURCE_INSUFFICIENT')
    await execute('spend-held', 'SIM_RESOURCE_INSUFFICIENT')
    await run.setPhase('paused', run.snapshot().revision)
    const paused = run.snapshot(); await new Promise(resolve => setTimeout(resolve, 50)); assert.deepEqual(run.snapshot(), paused)
    await run.setPhase('running', run.snapshot().revision)
    await run.drive({ until: simTimeSchema.parse('1') }); assert.equal(Object.values(run.snapshot().resourceReservations)[0]!.phase, 'active')
    await run.drive({ until: simTimeSchema.parse('2') }); assert.equal(Object.values(run.snapshot().resourceReservations)[0]!.phase, 'expired')
    await execute('commit-after-expiry', 'SIM_RESOURCE_RESERVATION_REVISION_CONFLICT')
    await execute('reserve-payment', 'SIM_APPLIED'); await execute('commit-payment', 'SIM_APPLIED')
    await execute('reserve-cancel', 'SIM_APPLIED'); await execute('cancel', 'SIM_APPLIED')
    await execute('history-limit', 'SIM_RESOURCE_RESERVATION_HISTORY_LIMIT')
    assert.deepEqual(Object.values(run.snapshot().resources).map(value => value.quantity), ['7', '3'])
    assert.deepEqual(Object.values(run.snapshot().resourceReservations).map(value => value.phase), ['expired', 'committed', 'cancelled'])
    await run.setPhase('paused', run.snapshot().revision)
    const done = await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(done.status, 'completed')
    await writeFile(resolve(root, 'original.json'), JSON.stringify({ state: run.snapshot(), sessions: await sessions(), journal: await journal(), modelRequests: resourceModelRequests }, null, 2))
  } else {
    const original = JSON.parse(await readFile(resolve(root, 'original.json'), 'utf8')) as {
      state: SimulationSnapshot
      sessions: Awaited<ReturnType<typeof sessions>>
      journal: Awaited<ReturnType<typeof journal>>
    }
    assert.deepEqual(run.snapshot(), original.state); assert.deepEqual(await sessions(), original.sessions)
    assert.deepEqual(await journal(), original.journal)
    assert.equal(run.snapshot().phase, 'paused'); assert.equal(resourceModelRequests.length, 0)
  }
  const output = { face, backend: process.env.SIMULATION_COMPANY_BACKEND, pid: process.pid, round, phase: run.snapshot().phase,
    modelCalls: resourceModelRequests.length, conserved: true, actualSimulatedExpiry: true, historyBounded: true, runtimePaths }
  await writeFile(resolve(root, `round-${round}.json`), JSON.stringify({ ...output, state: run.snapshot(), sessions: await sessions(), journal: await journal() }, null, 2))
  process.stdout.write(JSON.stringify(output) + '\n')
} catch (error) { await writeFile(resolve(root, `failed-${round}.json`), JSON.stringify({ error: String(error), state: run.snapshot(),
  sessions: await sessions(), journal: await journal(), modelRequests: resourceModelRequests }, null, 2)); throw error }
finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
