/** Original v1 Norms reach three canonical roles only through their recorded authorized Session/model inputs. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution } from '@clocky/clocky-simulation-world'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationNormQuerySchema,
  simulationEntityIdSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import type { LogStream } from '@clocky/clocky-storage'
import { definition, deployment, originalBudgets, roles } from './fixtures/world-norm-role/source.ts'
import { requests } from './world-external-actor-model.ts'
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recover = process.env.WORLD_NORM_ROLE_RECOVER === 'true'
const round = process.env.WORLD_NORM_ROLE_ROUND!, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') { assert.deepEqual(process.execArgv, []); assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false) }
assert.deepEqual({ native: deployment.native, defaults: deployment.limits.defaults, ceilings: deployment.limits.ceilings,
  limits: definition.limits }, originalBudgets)
const ctx = await boot('world-norm-role', process.argv[2]!)
const compiled = await compileWorldScenarioV1(definition, deployment, 'json', ctx.teams.getCreationLimits())
assert.ok(compiled.ok, JSON.stringify(compiled)); const resolved = compiled.resolved
const checkpointId = simulationCheckpointIdSchema.parse('norm-role-final')
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recover ? 'open' : 'create',
  spec: { runId: 'norm-role-world', ...resolved.native } })
const restored = recover ? await ctx.simulationTeams.restore(selection, { id: checkpointId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection), lifetime = new AbortController()
let connection = restored?.connection, driver: SimulationWorldDriver | undefined
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
const canaries = ['NORM-PUBLIC-ROLE-CANARY', 'NORM-DIRECTOR-ROLE-CANARY', 'NORM-MEMBER-ROLE-CANARY']
function assertBody(text: string, visible: readonly string[]) {
  for (const canary of canaries) assert.equal(text.includes(canary), visible.includes(canary), canary)
}
try {
  if (!recover) await prepareSimulationWorld(ctx.simulationTeams, run, { resolved, ownerName: 'norm-role/original',
    checkpoint: { id: simulationCheckpointIdSchema.parse('norm-role-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']; assert.equal(typeof ownerName, 'string')
  connection ??= await ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName as string)
  if (!recover) {
    await writeFile(resolve(root, 'input.json'), JSON.stringify({ definition, deployment, resolved, originalBudgets }, null, 2) + '\n')
    const initial = run.snapshot()
    assert.equal(Object.values(initial.world!.norms.versions).flat().length, 3)
    assert.ok(Object.values(initial.world!.norms.versions).flat().every(value => value.origin === 'scenario'))
    for (const version of Object.values(initial.world!.norms.versions).flat()) {
      assert.ok(version.origin === 'scenario'); assert.equal(version.source.definitionHash, resolved.definitionHash)
    }
    assert.deepEqual(initial.world!.governance.proposals, {}); assert.deepEqual(initial.world!.governance.resolutions, {})
    const anchor = { checkpointId: simulationCheckpointIdSchema.parse('norm-role-initial'), ownerName: ownerName as string,
      maxDrainRounds: 4, maxAttempts: 3 }
    driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime.signal, ctx,
      ctx.simulationWorldExecutions.handlers({
        run: run,
        connection: connection,
        resolved: resolved,
        anchor: anchor,
        lifetime: lifetime.signal,
      }, [new ExternalActorWorldExecution(run, connection, resolved, anchor, lifetime.signal)]))
    await run.setPhase('running', run.snapshot().revision)
    const steps: SimulationWorldDriveResult[] = []
    for (let step = 0; step < 128; step++) {
      const result: SimulationWorldDriveResult = await driver.advance(); steps.push(result)
      await writeFile(resolve(root, 'progress.json'), JSON.stringify({ state: run.snapshot(), steps, requests }, null, 2) + '\n')
      if (result.reason === 'idle') break
      assert.equal(result.reason, 'work-limit', JSON.stringify(result))
    }
    assert.equal(steps.at(-1)?.reason, 'idle')
    const state = run.snapshot(), representative = Object.values(state.world!.external.representatives)[0]!
    assert.equal(representative.status, 'committed')
    assert.notEqual(state.entities[representative.identities.entityId]!.binding!.sessionId,
      state.entities[simulationEntityIdSchema.parse(roles.director)]!.binding!.sessionId)
    const actualSessions = await sessions()
    const matrix = [
      { role: 'member', id: simulationEntityIdSchema.parse(roles.member), visible: [canaries[0]!, canaries[2]!] },
      { role: 'director', id: simulationEntityIdSchema.parse(roles.director), visible: [canaries[0]!, canaries[1]!] },
      { role: 'external-representative', id: representative.identities.entityId, visible: [canaries[0]!] },
    ].map(({ role, id, visible }) => {
      const query = run.queryWorldNorms(simulationNormQuerySchema.parse({
        viewer: id, time: state.time, cursor: state.revision, limit: 10 }))
      assertBody(JSON.stringify(query), visible)
      const session = actualSessions.find(value => value.entityId === id)!; assert.ok(session && !session.unmaterialized)
      const views = session.events.filter(event => event.type === 'simulation/context-view')
      assert.ok(views.length > 0)
      for (const view of views) {
        assertBody(JSON.stringify(view.data), visible)
        for (const { norm } of query.items) for (const sequence of [
          norm.sequence, ...norm.source.references.map(value => value.sequence),
        ]) {
          assert.ok(view.data.sources.some(value => value.kind === 'run-event'
            && value.runId === state.spec.runId && value.sequence === sequence))
        }
      }
      const calls = requests.filter(value => value.entityId === id); assert.ok(calls.length > 0)
      for (const call of calls) assertBody(call.input, visible)
      assertBody(JSON.stringify(session.events), visible)
      return { role, entityId: id, query, contextViews: views.length, modelCalls: calls.length, visible }
    })
    await run.setPhase('paused', run.snapshot().revision)
    const checkpoint = await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    await writeFile(resolve(root, 'original.json'), JSON.stringify({ state: run.snapshot(), sessions: await sessions(), journal: await journal(),
      matrix, modelRequests: requests, steps }, null, 2) + '\n')
  } else {
    const original = JSON.parse(await readFile(resolve(root, 'original.json'), 'utf8')) as {
      state: SimulationSnapshot
      sessions: Awaited<ReturnType<typeof sessions>>
      journal: Awaited<ReturnType<typeof journal>>
    }
    assert.deepEqual(run.snapshot(), original.state); assert.deepEqual(await sessions(), original.sessions)
    assert.deepEqual(await journal(), original.journal); assert.equal(requests.length, 0)
  }
  const output = { face, backend: process.env.SIMULATION_COMPANY_BACKEND, pid: process.pid, round,
    phase: run.snapshot().phase, modelCalls: requests.length, actualNormRoleMatrix: true, runtimePaths }
  await writeFile(resolve(root, `round-${round}.json`), JSON.stringify({ ...output, state: run.snapshot(), sessions: await sessions(), journal: await journal() }, null, 2) + '\n')
  process.stdout.write(JSON.stringify(output) + '\n')
} catch (error) {
  await writeFile(resolve(root, `failed-${round}.json`), JSON.stringify({ error: String(error), state: run.snapshot(),
    sessions: await sessions(), journal: await journal(), modelRequests: requests }, null, 2) + '\n'); throw error
} finally { await driver?.drain(); await connection?.close(); await run.close(); await ctx.fiber.dispose() }
