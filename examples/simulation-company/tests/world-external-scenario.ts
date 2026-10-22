/** Company/laboratory use the same registered external rule through real goals, private Channels and independent restored processes. */
import assert from 'node:assert/strict'
import { verifyCheckpointWorldCoverage } from './checkpoint-world-coverage.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_INTERACT_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldDomainRequestSchema, simulationExternalInteractRequestSchema,
  simulationExternalInteractPlanSchema, simulationExternalInteractResultSchema, simulationExternalInteractionSchema, checkpointWorldState } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-external-model.ts'

const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
assert.ok(['company', 'laboratory'].includes(scene))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const scope = original.world.organizationEntityId, subject = 'external-supplier'
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_EXTERNAL_INTERACT_PIN],
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId,
    domain: 'external', operation: 'interact', version: '1', scopeEntityId: scope, targetEntityId: subject,
    relationId: 'external-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready', profile: { name: 'Shared display name', description: 'A simulated external subject.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules, { relation: 'can-interact', subjectKinds: ['person'],
    objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'external-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const ctx = await boot('world-external', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `external-${scene}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('external-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'external-original.json')
try {
  const inputPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'external-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(inputPath, 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `external/${scene}`, checkpoint: { id: simulationCheckpointIdSchema.parse('external-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, new AbortController().signal, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: new AbortController().signal,
    }, [new ExternalWorldExecution(run)]))
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  const requesterId = simulationEntityIdSchema.parse(requester.entityId)
  const proof = () => ({ external: run.snapshot().world!.external, results: run.snapshot().world!.results,
    mutations: run.snapshot().world!.mutations, resources: run.snapshot().resources })
  if (!recovering) {
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject, kind: 'inventory', unit: 'widget',
      quantity: '7', controllers: [] }), run.snapshot().revision)
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-money', owner: subject, kind: 'money', unit: 'widget',
      quantity: '999', controllers: [] }), run.snapshot().revision)
    const initialResources = run.snapshot().resources
    await run.setPhase('running', run.snapshot().revision)
    for (const [index, text] of ['first/vendor/widget', 'second/vendor/widget', 'third/another-vendor/unknown-unit'].entries()) {
      const wake = simulationWakeRequestSchema.parse({ id: `external-goal-${index}`, entityId: requesterId,
        time: `${BigInt(run.snapshot().time) + 1n}`, reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: text })) })
      await run.scheduleWake(wake, run.snapshot().revision)
      let result = await driver.advance(wake.time)
      for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(wake.time)
      assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify({ result, failures }))
    }
    assert.equal(failures.length, 0, failures.join('\n'))
    assert.deepEqual(run.snapshot().resources, initialResources)
    // These rejection probes traverse the real run owner and registered parser before any append or IO.
    const existing = Object.values(run.snapshot().world!.requests)[0]!
    for (const extra of [{ url: 'https://example.invalid' }, { credentials: 'not-a-secret' }, { sender: subject },
      { sourceKind: 'real-adapter' }, { sourceKind: 'simulated-actor' }, { source: { amount: '1' } }]) {
      const cursor = run.snapshot().revision
      await assert.rejects(run.openWorldIntent(requesterId, simulationWorldDomainRequestSchema.parse({ ...existing.proposal,
        businessKey: `invalid-${Object.keys(extra)[0]}`, payload: { ...simulationExternalInteractRequestSchema.parse(existing.proposal.payload), ...extra } })))
      assert.equal(run.snapshot().revision, cursor)
    }
    for (const plan of Object.values(run.snapshot().world!.plans)) {
      const cursor = run.snapshot().revision
      const result = await run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule' } })
      assert.equal(result.outcome.kind, 'committed')
      assert.equal(run.snapshot().revision, cursor)
      await assert.rejects(run.commitWorldMutation({ planId: plan.id, payload: { kind: 'evaluate-rule', quantity: '900' } }))
      assert.equal(run.snapshot().revision, cursor)
    }
    await writeFile(proofPath, JSON.stringify(proof()))
    assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('external-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
    if (process.env.WORLD_CHECKPOINT_COVERAGE === 'true') await verifyCheckpointWorldCoverage(run,
      resolve(process.env.SIMULATION_COMPANY_ROOT!))
  } else {
    assert.equal(run.snapshot().phase, 'paused')
    assert.deepEqual(proof(), JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(requests.length, 0)
  }
  const state = run.snapshot(), owned = state.world!, interactions = Object.values(owned.external.interactions)
  assert.equal(Object.keys(owned.external.identities).length, 2)
  assert.equal(interactions.length, 3)
  assert.equal(interactions[0]!.identityId, interactions[1]!.identityId)
  assert.notEqual(interactions[0]!.identityId, interactions[2]!.identityId)
  for (const item of interactions) {
    const resolution = owned.plans[item.planId]!.proposal.resolution
    assert.equal(resolution.kind, 'apply')
    assert.deepEqual(simulationExternalInteractPlanSchema.parse(resolution.kind === 'apply' ? resolution.payload : null), { kind: 'evaluate-rule' })
    const result = Object.values(owned.results).find(value => value.intentId === item.intentId)!
    assert.deepEqual(simulationExternalInteractResultSchema.parse(result.payload), item.result)
    assert.equal(item.input.sourceKind, 'simulated-rule')
  }
  assert.deepEqual(interactions[0]!.result.availability, { status: 'known', unit: 'widget', quantity: '7' })
  assert.deepEqual(interactions[2]!.result.availability, { status: 'unknown', unit: 'unknown-unit' })
  assert.equal(interactions[0]!.resources.length, 1)
  assert.equal(state.entities[simulationEntityIdSchema.parse(subject)]!.cognition, 'none')
  assert.ok(!JSON.stringify(owned.external).includes('PRIVATE-DIRECTOR'))
  const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
  const actualJournal = []
  let after = -1
  while (after < stream.tailSequence) {
    const entries = await stream.read(after, 128)
    assert.ok(entries.length)
    for (const entry of entries) {
      const parsed = z.object({ kind: z.literal('run/world-mutation'), change: z.object({
        externalEvaluation: simulationExternalInteractionSchema }) }).safeParse(entry.value)
      if (parsed.success) actualJournal.push({ sequence: entry.sequence, value: entry.value,
        evaluation: parsed.data.change.externalEvaluation })
    }
    after = entries.at(-1)!.sequence
  }
  assert.equal(actualJournal.length, 3)
  assert.deepEqual(actualJournal.map(value => value.evaluation), interactions)
  await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'external-journal.json'), JSON.stringify(actualJournal))
  const manifest = checkpointWorldState(state)!
  assert.equal(manifest.records.filter(value => value.kind === 'external-identity').length, 2)
  assert.equal(manifest.records.filter(value => value.kind === 'external-interaction').length, 3)
  console.log(JSON.stringify({ identities: 2, evaluations: 3, stableKey: true, unknownPreserved: true, resourcesUnchanged: true,
    unsafePayloadRejected: true, recordedOutcome: true, checkpointComplete: true, modelCalls: requests.length, phase: state.phase }))
} catch (error) { console.error(JSON.stringify({ failures, requests })); throw error }
finally { await run.close(); await ctx.fiber.dispose() }
