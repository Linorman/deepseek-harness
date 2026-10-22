/** Actual mediated Agent/tool/driver effects and original canonical notifications survive an independent cold restore. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import type {} from '@clocky/clocky-tools'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_MEDIATED_PIN, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema,
  simulationExternalMediatedRequestSchema, checkpointWorldState } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { boundaryModelRequests } from './world-external-boundary-model.ts'
import { negativeCases } from './world-external-boundary-cases.ts'
import type { BoundaryCase } from './world-external-boundary-cases.ts'

const scene = process.env.WORLD_SCENARIO ?? 'company'
const scenarioCase = process.env.WORLD_BOUNDARY_CASE as BoundaryCase
const recovering = process.env.WORLD_BOUNDARY_RECOVER === 'true'
assert.ok(negativeCases.includes(scenarioCase))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-boundary-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const scope = original.world.organizationEntityId, subject = 'external-boundary-supplier'
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  limits: { ...original.world.limits, maxBytesPerPlan: Number(process.env.WORLD_BOUNDARY_PLAN_BYTES ?? '16384') },
  operations: [...original.world.operations, WORLD_EXTERNAL_MEDIATED_PIN],
  externalAdjudicationPolicy: { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
    conditionInstalls: [], futureConditionInstalls: [],
    allowedOutcomeKinds: ['failure'], maxDelay: '0',
    allowPublicDisclosure: false, allowScopeDisclosure: false, actorDisclosure: [] },
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId,
    domain: 'external', operation: 'interact', version: '3', scopeEntityId: scope, targetEntityId: subject,
    relationId: 'mediated-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none',
    readiness: 'ready', profile: { name: 'Mediated supplier', description: 'A finite simulated external subject.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules, { relation: 'can-interact', subjectKinds: ['person'],
    objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'mediated-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const ctx = await boot('world-external-mediated', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `boundary-${scene}-${scenarioCase}`, ...resolved.native } })
const checkpointId = simulationCheckpointIdSchema.parse('boundary-complete')
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpointId,
  implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), proofPath = resolve(root, 'boundary-original.json')
let connection = restored?.connection
const errors: unknown[] = []
function owned() {
  const state = run.snapshot()
  return { world: state.world, resources: state.resources, commitments: state.commitments, interactions: state.interactions,
    relations: state.relations, people: Object.values(state.entities).map(value => ({ id: value.id, kind: value.kind,
      cognition: value.cognition, readiness: value.readiness, phase: value.phase, profile: value.profile,
      ...value.binding === undefined ? {} : { binding: value.binding } })) }
}
let beforeFirst: ReturnType<typeof owned> | undefined
ctx.on('tools/pre-execute', (exec, next) => {
  if (exec.name === 'simulation_submit' && beforeFirst === undefined && exec.agent !== undefined) {
    const state = run.snapshot(), current = Object.values(state.decisions).find(value => value.status === 'open'
      && state.entities[value.entityId]?.binding?.sessionId === exec.agent!.session.id)
    const context = current?.context?.status === 'prepared' ? current.context.world : undefined
    const probe = context?.kind === 'goal' ? current?.wakeId === 'boundary-goal-probe'
      : context?.kind === 'resolve' && state.world !== undefined
        ? simulationExternalMediatedRequestSchema.parse(state.world.requests[context.requestId]!.proposal.payload).input.question === 'probe' : false
    const attack = probe && (scenarioCase.startsWith('request-') ? context?.kind === 'goal' : context?.kind === 'resolve')
    if (attack) beforeFirst = owned()
  }
  return next()
})
ctx.on('tools/result', (exec, result) => {
  if (!result.isError || !['simulation_submit', 'simulation_stage'].includes(exec.name)) return
  const current = owned()
  assert.ok(beforeFirst, 'Rejected submit must have its actual pre-execute owned snapshot')
  assert.deepEqual(current, beforeFirst, 'Exact repeated rejected proposal cannot change original owned business state')
  errors.push({ callId: exec.callId, tool: exec.name, result, owned: current })
})
try {
  if (!recovering) await writeFile(resolve(root, 'boundary-input.json'), JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(resolve(root, 'boundary-input.json'), 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `boundary/${scene}/${scenarioCase}`, checkpoint: { id: simulationCheckpointIdSchema.parse('boundary-initial'),
      maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.equal(typeof ownerName, 'string')
  if (typeof ownerName !== 'string') throw new Error('Boundary fixture lacks its original lifecycle owner')
  connection ??= await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const signal = new AbortController().signal
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, signal, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: signal,
    }, [new ExternalMediatedWorldExecution(run, connection, resolved, anchor, signal)]))
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(boundaryModelRequests.length, 0)
  if (!recovering) {
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject, kind: 'inventory', unit: 'widget',
      quantity: '7', controllers: [] }), run.snapshot().revision)
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-money', owner: subject, kind: 'money', unit: 'credit',
      quantity: '999', controllers: [] }), run.snapshot().revision)
    const baselineLedger = run.snapshot().resources, baselinePeople = owned().people
    await run.setPhase('running', run.snapshot().revision)
    for (const goal of ['baseline', 'probe']) {
      const wake = simulationWakeRequestSchema.parse({ id: `boundary-goal-${goal}`, entityId: requester.entityId,
        time: String(BigInt(run.snapshot().time) + 1n), reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal })) })
      await run.scheduleWake(wake, run.snapshot().revision)
      let result = await driver.advance(wake.time)
      for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(wake.time)
      assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify({ result, failures }))
    }
    assert.equal(errors.length, 2, 'Both the first forbidden submit and its exact retry must reject')
    assert.deepEqual(run.snapshot().resources, baselineLedger)
    assert.deepEqual(owned().people, baselinePeople)
    assert.equal(Object.keys(run.snapshot().world!.external.identities).length, 1)
    assert.equal(Object.keys(run.snapshot().world!.external.representatives).length, 0)
    assert.equal(Object.keys(run.snapshot().world!.external.contacts).length, 0)
    assert.equal(Object.keys(run.snapshot().world!.facts).length, 0)
    const expected = scenarioCase.startsWith('request-') ? 1 : 2
    assert.equal(Object.keys(run.snapshot().world!.external.adjudications).length, expected)
    assert.equal(Object.keys(run.snapshot().world!.results).length, expected)
    assert.deepEqual(failures, [])
    assert.equal((await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status,
      'completed')
    const sessions = await Promise.all(Object.values(run.snapshot().entities).flatMap(value => value.binding === undefined ? [] : [
      (async () => {
        const unmaterialized = await ctx.sessionPersistence.isUnmaterialized(value.binding!.sessionId)
        return { binding: value.binding, unmaterialized,
          ...unmaterialized ? {} : { events: (await ctx.sessionPersistence.readFrom(value.binding!.sessionId, 0)).events } }
      })() ]))
    await writeFile(proofPath, JSON.stringify({ owned: owned(), errors, sessions, modelRequests: boundaryModelRequests,
      checkpointWorld: checkpointWorldState(run.snapshot()) }))
  } else {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { owned: unknown
      sessions: Array<{ binding: { sessionId: string }; unmaterialized: boolean; events?: unknown[] }> }
    assert.deepEqual(owned(), proof.owned)
    for (const value of proof.sessions) {
      const sessionId = Object.values(run.snapshot().entities).find(entity =>
        entity.binding?.sessionId === value.binding.sessionId)?.binding!.sessionId
      assert.ok(sessionId)
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(sessionId), value.unmaterialized)
      if (!value.unmaterialized) assert.deepEqual((await ctx.sessionPersistence.readFrom(sessionId, 0)).events, value.events)
    }
    assert.equal(boundaryModelRequests.length, 0)
  }
  assert.equal(run.snapshot().phase, 'paused')
  console.log(JSON.stringify({ scene, scenarioCase, phase: 'paused', rejectedOriginalAndExactRetry: true,
    originalBusinessState: true, resourcesUnchanged: true, simulatedOnly: true, modelCalls: boundaryModelRequests.length }))
} finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
