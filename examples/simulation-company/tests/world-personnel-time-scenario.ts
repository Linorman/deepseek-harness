/** Actual scoped transfer preserves the original Person/Session while Native and canonical Team jointly prove the safe commit. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_GENERATE_AND_HIRE_PIN,
  simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWorldGoalSchema, simulationWakeRequestSchema, simulationEntityIdSchema, simulationEventIdSchema,
  simulationWorldTransferPayloadSchema, simulationWorldTransferCommittedResultPayloadSchema,
  worldOperationGrants, simTimeSchema, simulationDriveRequestSchema } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, PersonnelWorldExecution } from '@clocky/clocky-simulation-world'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-personnel-time-model.ts'

const timeCase = process.env.WORLD_PERSONNEL_TIME_CASE
assert.ok(timeCase === 'on-time' || timeCase === 'missed')
const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
const [person, administrator] = definition.actors.filter(value => value.role === 'member')
assert.ok(person && administrator)
const source = definition.assignments.find(value => value.personId === person.id)
assert.ok(source)
definition.positions.push({ id: 'personnel-admin', name: 'Personnel administrator', capacity: 1 },
  { id: 'new-responsibility', name: 'New declared responsibility', capacity: 1 })
definition.assignments.push({ id: 'personnel-admin-assignment', personId: administrator.id, positionId: 'personnel-admin' })
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-personnel-time-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
const original = compiled.resolved, organization = original.world.organizationEntityId
const permissions = [
  { pin: WORLD_TRANSFER_PIN, relation: 'can-transfer', target: source.positionId },
  { pin: WORLD_TRANSFER_PIN, relation: 'can-transfer-target', target: 'new-responsibility' },
  { pin: WORLD_DEPART_PIN, relation: 'can-depart', target: 'new-responsibility' },
]
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_TRANSFER_PIN, WORLD_DEPART_PIN],
  operationGrants: [...original.world.operationGrants, ...permissions.map(value => ({ requesterEntityId: administrator.id,
    domain: value.pin.domain, operation: value.pin.operation, version: value.pin.version, targetEntityId: value.target,
    scopeEntityId: organization, relation: value.relation, relationId: `personnel-permission:${value.relation}` }))],
  positionRolePermissions: [{ positionEntityId: 'new-responsibility', permissions: [{ domain: WORLD_GENERATE_AND_HIRE_PIN.domain,
    operation: WORLD_GENERATE_AND_HIRE_PIN.operation, version: WORLD_GENERATE_AND_HIRE_PIN.version,
    targetEntityId: source.positionId, scopeEntityId: organization, relation: 'can-hire' }] }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    ...permissions.map(value => ({ relation: value.relation, subjectKinds: ['person'], objectKinds: ['position'],
      scopeKinds: ['organization'], acyclic: false }))] },
  relations: [...original.relations, ...permissions.map(value => ({ kind: 'relation/create' as const,
    id: `personnel-permission:${value.relation}`, subject: administrator.id, relation: value.relation, object: value.target,
    scope: organization, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _hash, ...resolvedBody } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(resolvedBody)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const proofPath = resolve(root, 'personnel-time-proof.json'), memoryCanary = 'ORIGINAL-PERSONNEL-TIME-PRIVATE-MEMORY-CANARY'
const ctx = await boot('world-personnel-time', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `personnel-time-${scenario}-${timeCase}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('personnel-time-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-personnel-time/${scenario}/${timeCase}`, checkpoint: {
      id: simulationCheckpointIdSchema.parse('personnel-time-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const lifetime = new AbortController().signal
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: lifetime,
    }, [new PersonnelWorldExecution(run, connection, anchor, lifetime, 'transfer'),
      new PersonnelWorldExecution(run, connection, anchor, lifetime, 'depart')]))
  assert.equal((await driver.advance()).reason, 'paused')
  const advance = async (until?: import('@clocky/clocky-simulation').SimTime): Promise<SimulationWorldDriveResult> => {
    let result = await driver.advance(until)
    for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(until)
    return result
  }
  const personId = simulationEntityIdSchema.parse(person.id)
  let originalIdentity: unknown, waitingEvidence: unknown, memoryPrefix: unknown[] = []
  if (!recovering) {
    const initial = run.snapshot(), initialPerson = initial.entities[personId]!
    const assignment = Object.values(initial.relations).find(value => value.subject === personId && value.relation === 'assignment')!
    assert.ok(initialPerson.binding)
    originalIdentity = { binding: initialPerson.binding, profile: initialPerson.profile, profileRevision: initialPerson.profileRevision,
      assignment, channelId: initial.world!.channels[personId], entityIds: Object.keys(initial.entities).sort() }
    await run.setPhase('running', initial.revision)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'original-time-memory', entityId: person.id, time: '0',
      reason: JSON.stringify({ kind: 'private-person-memory', text: memoryCanary }) }), run.snapshot().revision)
    assert.ok(['idle', 'until'].includes((await advance(simTimeSchema.parse('0'))).reason))
    const session = ctx.sessions.get(initialPerson.binding.sessionId)
    assert.ok(session)
    assert.equal(await ctx.sessions.flush(session), true)
    memoryPrefix = [...(await ctx.sessionPersistence.readFrom(initialPerson.binding.sessionId, 0)).events]
    assert.ok(JSON.stringify(memoryPrefix).includes(memoryCanary))
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'actual-strict-transfer', entityId: administrator.id, time: '1',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'transfer-at-three' })) }), run.snapshot().revision)
    const waiting = await advance(simTimeSchema.parse('1'))
    assert.ok(['until', 'waiting-effective-time'].includes(waiting.reason), JSON.stringify(waiting))
    assert.equal(run.snapshot().time, '1')
    const state = run.snapshot(), owned = state.world!
    const request = Object.values(owned.requests).find(value => value.pin.operation === 'transfer')!
    assert.ok(request)
    const intent = owned.intents[request.intentId]!, plan = owned.plans[request.plans.at(-1)!]!
    assert.equal(request.proposal.expectedTime, '3')
    assert.equal(intent.expectedTime, '3')
    assert.equal(simulationWorldTransferPayloadSchema.parse(intent.payload).requestedEffectiveAt, '3')
    assert.equal(plan.status, 'accepted')
    assert.ok(request.operationId !== null && plan.operationId !== null)
    const sourceOperation = state.operations[request.operationId]!, planOperation = state.operations[plan.operationId]!
    const sourceDecision = state.decisions[sourceOperation.decisionId]!, directorDecision = state.decisions[planOperation.decisionId]!
    assert.equal(sourceDecision.time, '1')
    assert.equal(directorDecision.time, '1')
    assert.equal(sourceDecision.entityId, administrator.id)
    assert.equal(directorDecision.entityId, world.directorEntityId)
    assert.notEqual(sourceDecision.consumption?.sessionId, directorDecision.consumption?.sessionId)
    assert.equal(Object.keys(owned.personnel.reservations).length, 0)
    assert.equal(Object.keys(owned.mutations).length, 0)
    const boundary = Object.values(state.scheduledEvents).find(value => value.action.kind === 'world-execution-time')!
    assert.ok(boundary)
    assert.equal(boundary.key.time, '3')
    assert.equal(boundary.status, 'pending')
    waitingEvidence = { request, intent, plan, sourceDecision, directorDecision, boundary,
      decisionIds: Object.keys(state.decisions).sort(), wakeIds: Object.keys(state.wakes).sort(), modelCalls: requests.length }
    if (timeCase === 'on-time') {
      const completed = await advance()
      assert.ok(['idle', 'until'].includes(completed.reason), JSON.stringify(completed))
      assert.equal(run.snapshot().time, '3')
    } else {
      const calls = requests.length
      const driven = await run.drive(simulationDriveRequestSchema.parse({ until: '4' }))
      assert.equal(driven.reason, 'until')
      assert.equal(run.snapshot().time, '4')
      assert.equal(requests.length, calls)
      const before = run.snapshot().revision
      assert.equal((await driver.advance()).reason, 'stale-time')
      assert.equal(run.snapshot().revision, before)
      assert.equal(requests.length, calls)
      assert.deepEqual(Object.keys(run.snapshot().decisions).sort(), Object.keys(state.decisions).sort())
      assert.deepEqual(Object.keys(run.snapshot().wakes).sort(), Object.keys(state.wakes).sort())
    }
  } else {
    const stored: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
    assert.ok(stored !== null && typeof stored === 'object' && !Array.isArray(stored))
    const prior = stored as Record<string, unknown>
    originalIdentity = prior.originalIdentity
    waitingEvidence = prior.waitingEvidence
    assert.ok(Array.isArray(prior.memoryPrefix))
    memoryPrefix = prior.memoryPrefix
  }
  assert.ok(originalIdentity !== null && typeof originalIdentity === 'object' && !Array.isArray(originalIdentity))
  assert.ok(waitingEvidence !== null && typeof waitingEvidence === 'object' && !Array.isArray(waitingEvidence))
  const identity = originalIdentity as Record<string, unknown>, waiting = waitingEvidence as Record<string, unknown>
  const state = run.snapshot(), owned = state.world!, current = state.entities[personId]!
  const request = Object.values(owned.requests).find(value => value.pin.operation === 'transfer')!, intent = owned.intents[request.intentId]!
  const plan = owned.plans[request.plans.at(-1)!]!
  assert.deepEqual(plan, waiting.plan)
  assert.deepEqual(intent, waiting.intent)
  assert.ok(waiting.request !== null && typeof waiting.request === 'object' && !Array.isArray(waiting.request))
  const originalRequest = waiting.request as Record<string, unknown>
  for (const field of ['id', 'operationId', 'notificationOperationId', 'proposal', 'pin', 'payloadHash', 'source', 'sequence'] as const) {
    assert.deepEqual(request[field], originalRequest[field])
  }
  assert.ok(request.operationId !== null && plan.operationId !== null)
  const sourceOperation = state.operations[request.operationId]!, planOperation = state.operations[plan.operationId]!
  assert.deepEqual(state.decisions[sourceOperation.decisionId], waiting.sourceDecision)
  assert.deepEqual(state.decisions[planOperation.decisionId], waiting.directorDecision)
  assert.deepEqual(current.binding, identity.binding)
  assert.deepEqual(current.profile, identity.profile)
  assert.equal(current.profileRevision, identity.profileRevision)
  assert.deepEqual(Object.keys(state.entities).sort(), identity.entityIds)
  assert.equal(owned.channels[personId], identity.channelId)
  const boundary = Object.values(state.scheduledEvents).find(value => value.action.kind === 'world-execution-time')!
  assert.equal(boundary.status, 'consumed')
  assert.equal(boundary.key.time, '3')
  assert.equal(Object.hasOwn(state.wakes, boundary.id), false)
  const result = Object.values(owned.results).find(value => value.intentId === intent.id)
  if (timeCase === 'on-time') {
    assert.ok(result && result.outcome.kind === 'committed')
    const outcome = simulationWorldTransferCommittedResultPayloadSchema.parse(result.payload)
    assert.equal(outcome.requestedEffectiveAt, '3')
    assert.equal(outcome.actualEffectiveAt, '3')
    assert.equal(result.time, '3')
    assert.equal(state.relations[outcome.closedAssignmentId]!.validUntil, '3')
    assert.equal(state.relations[outcome.newAssignmentId]!.validFrom, '3')
    assert.equal(owned.personnel.reservations[intent.id]!.status, 'committed')
    const first = state.scheduledEvents[simulationEventIdSchema.parse(`simulation-world-first:${intent.id}`)]!
    assert.ok(first.action.kind === 'wake')
    if (first.action.kind !== 'wake') throw new Error('Strict on-time result requires its original independent first action')
    assert.equal(first.action.entityId, personId)
    assert.equal(first.key.time, '3')
    const decision = Object.values(state.decisions).find(value => value.wakeId === first.id)!
    assert.equal(decision.consumption?.sessionId, current.binding!.sessionId)
    assert.notEqual(decision.entityId, state.decisions[planOperation.decisionId]!.entityId)
    assert.ok(worldOperationGrants(state).some(value => value.requesterEntityId === personId && value.relationId.startsWith('world-role-authority:')))
    const before = run.snapshot().revision, calls = requests.length
    assert.deepEqual(await connection.commitPersonnel(intent.id), result)
    assert.equal(run.snapshot().revision, before)
    assert.equal(requests.length, calls)
  } else {
    assert.equal(result, undefined)
    assert.equal(Object.keys(owned.personnel.reservations).length, 0)
    assert.equal(Object.keys(owned.mutations).length, 0)
    assert.equal(Object.keys(owned.plans).length, 1)
    assert.deepEqual(Object.keys(state.decisions).sort(), waiting.decisionIds)
    assert.deepEqual(Object.keys(state.wakes).sort(), waiting.wakeIds)
    assert.deepEqual(Object.values(state.relations).find(value => value.subject === personId && value.relation === 'assignment'), identity.assignment)
  }
  const session = await ctx.sessionPersistence.readFrom(current.binding!.sessionId, 0)
  assert.deepEqual(session.events.slice(0, memoryPrefix.length), memoryPrefix)
  assert.ok(JSON.stringify(session.events).includes(memoryCanary))
  if (!recovering) assert.ok(modelInputs.filter(value => value.entityId !== person.id).every(value => !value.input.includes(memoryCanary)))
  const proof = { originalIdentity, waitingEvidence, memoryPrefix, request, intent, plan, result: result ?? null,
    mutations: owned.mutations, personnel: owned.personnel, boundary, sourceDecision: state.decisions[sourceOperation.decisionId],
    directorDecision: state.decisions[planOperation.decisionId], originalSessionPrefix: session.events.slice(0, memoryPrefix.length) }
  if (recovering) {
    assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('personnel-time-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
    await writeFile(proofPath, JSON.stringify(proof))
  }
  const evidenceRoot = process.env.WORLD_PERSONNEL_TIME_EVIDENCE_ROOT
  if (evidenceRoot !== undefined) {
    await mkdir(resolve(evidenceRoot), { recursive: true })
    const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
    const raw = { scenario, backend: process.env.SIMULATION_COMPANY_BACKEND, timeCase, restored: recovering, modelCalls: requests.length,
      ...proof, prefixHash: hash(memoryPrefix), retainedPrefixHash: hash(session.events.slice(0, memoryPrefix.length)),
      unchangedBudgets: { native: resolved.native, world: resolved.world.limits } }
    await writeFile(resolve(evidenceRoot,
      `${process.env.SIMULATION_COMPANY_BACKEND}-${scenario}-${timeCase}-${recovering ? 'cold' : 'created'}.json`),
    JSON.stringify(raw, null, 2) + '\n')
  }
  console.log(JSON.stringify({ scenario, timeCase, requestedTime: '3', actualTime: timeCase === 'on-time' ? '3' : null,
    staleTimeNoAppend: timeCase === 'missed', originalSlotsAndContextsUnchanged: true, originalRequestAndPlanUnchanged: true,
    originalIdentity: true, originalSession: true, originalMemory: true, nativeBoundaryNoActorWake: true,
    generatedPeople: 0, privateCanaryLeaks: 0, restored: recovering, modelCalls: requests.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
