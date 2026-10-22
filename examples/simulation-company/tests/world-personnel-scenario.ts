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
  worldOperationGrants } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, PersonnelWorldExecution } from '@clocky/clocky-simulation-world'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-personnel-model.ts'

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
installed.runtimeProfiles[0]!.model = { provider: 'world-personnel-scripted', name: 'scripted', version: '1', available: true }
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
const proofPath = resolve(root, 'personnel-transfer-proof.json'), memoryCanary = 'ORIGINAL-PERSONNEL-PRIVATE-MEMORY-CANARY'
const ctx = await boot('world-personnel', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `personnel-${scenario}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('personnel-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-personnel/${scenario}`, checkpoint: {
      id: simulationCheckpointIdSchema.parse('personnel-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
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
  const advance = async (until = run.snapshot().time): Promise<SimulationWorldDriveResult> => {
    let result = await driver.advance(until)
    for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(until)
    assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify({ result,
      reservations: run.snapshot().world!.personnel.reservations }))
    return result
  }
  const wake = async (entityId: string, wakeId: string, reason: string) => {
    const request = simulationWakeRequestSchema.parse({ id: wakeId, entityId,
      time: `${BigInt(run.snapshot().time) + BigInt(1)}`, reason })
    await run.scheduleWake(request, run.snapshot().revision)
    return advance(request.time)
  }
  const goal = (entityId: string, wakeId: string, text: string) => wake(entityId, wakeId,
    JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: text })))
  const personId = simulationEntityIdSchema.parse(person.id)
  let originalIdentity: unknown, memoryPrefix: unknown[] = []
  if (!recovering) {
    const initial = run.snapshot(), initialPerson = initial.entities[personId]!
    const assignment = Object.values(initial.relations).find(value => value.subject === personId && value.relation === 'assignment')!
    originalIdentity = { personId, binding: initialPerson.binding, profile: initialPerson.profile,
      profileRevision: initialPerson.profileRevision, assignment, channelId: initial.world!.channels[personId],
      entityIds: Object.keys(initial.entities).sort() }
    assert.ok(initialPerson.binding && initial.world!.channels[personId])
    await run.setPhase('running', initial.revision)
    await wake(person.id, 'original-person-memory', JSON.stringify({ kind: 'private-person-memory', text: memoryCanary }))
    const session = ctx.sessions.get(initialPerson.binding.sessionId)
    assert.ok(session)
    assert.equal(await ctx.sessions.flush(session), true)
    memoryPrefix = [...(await ctx.sessionPersistence.readFrom(initialPerson.binding.sessionId, 0)).events]
    assert.ok(JSON.stringify(memoryPrefix).includes(memoryCanary))
    await goal(administrator.id, 'actual-person-transfer', 'transfer-original-person')
    await goal(person.id, 'actual-new-role-context', 'inspect-new-role')
  } else {
    const saved: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
    assert.ok(saved !== null && typeof saved === 'object' && !Array.isArray(saved))
    const prior = saved as Record<string, unknown>
    originalIdentity = prior.originalIdentity
    assert.ok(Array.isArray(prior.memoryPrefix))
    memoryPrefix = prior.memoryPrefix
  }
  assert.ok(originalIdentity !== null && typeof originalIdentity === 'object' && !Array.isArray(originalIdentity))
  const identity = originalIdentity as Record<string, unknown>
  const state = run.snapshot(), owned = state.world!, current = state.entities[personId]!
  const request = Object.values(owned.requests).find(value => value.pin.operation === 'transfer')!
  assert.ok(request)
  const intent = owned.intents[request.intentId]!, plan = owned.plans[request.plans.at(-1)!]!
  const result = Object.values(owned.results).find(value => value.intentId === intent.id)!
  assert.ok(result && result.outcome.kind === 'committed')
  const payload = simulationWorldTransferPayloadSchema.parse(intent.payload)
  const outcome = simulationWorldTransferCommittedResultPayloadSchema.parse(result.payload)
  assert.equal(payload.personId, personId)
  assert.equal(payload.targetPositionId, 'new-responsibility')
  assert.equal(plan.proposal.resolution.kind, 'apply')
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('Transfer must retain its original actual director apply plan')
  assert.deepEqual(plan.proposal.resolution.payload, intent.payload)
  assert.ok(plan.reads.some(value => value.kind === 'relation' && value.id === 'personnel-permission:can-transfer'))
  assert.ok(plan.reads.some(value => value.kind === 'relation' && value.id === 'personnel-permission:can-transfer-target'))
  assert.deepEqual(current.binding, identity.binding)
  assert.deepEqual(current.profile, identity.profile)
  assert.equal(current.profileRevision, identity.profileRevision)
  assert.deepEqual(Object.keys(state.entities).sort(), identity.entityIds)
  assert.equal(owned.channels[personId], identity.channelId)
  const previous = state.relations[outcome.closedAssignmentId]!, replacement = state.relations[outcome.newAssignmentId]!
  assert.equal(previous.subject, personId)
  assert.equal(previous.validUntil, result.time)
  assert.equal(previous.revision, payload.assignmentRevision + 1)
  assert.equal(replacement.subject, personId)
  assert.equal(replacement.object, payload.targetPositionId)
  assert.equal(replacement.validFrom, result.time)
  assert.equal(outcome.requestedEffectiveAt, null)
  assert.equal(outcome.actualEffectiveAt, result.time)
  assert.equal(Object.values(state.relations).filter(value => value.subject === personId && value.relation === 'assignment'
    && value.validUntil === null).length, 1)
  const reservation = owned.personnel.reservations[intent.id]!
  assert.equal(reservation.status, 'committed')
  assert.equal(reservation.evidence?.complete, true)
  assert.equal(reservation.evidence?.coverage.team.kind, 'observed')
  assert.equal(owned.personnel.fences[intent.id]!.status, 'closed')
  assert.deepEqual(owned.personnel.operationGrants.map(value => ({ domain: value.domain, operation: value.operation,
    version: value.version, targetEntityId: value.targetEntityId, scopeEntityId: value.scopeEntityId, relation: value.relation })),
  world.positionRolePermissions[0]!.permissions)
  assert.ok(worldOperationGrants(state).some(value => value.requesterEntityId === personId
    && value.relationId === `world-role-authority:${intent.id}:0`))
  const authority = state.relations[owned.personnel.operationGrants[0]!.relationId]!
  assert.equal(authority.subject, personId)
  assert.equal(authority.validFrom, result.time)
  for (const relationId of outcome.closedAuthorityRelationIds) assert.equal(state.relations[relationId]!.validUntil, result.time)
  const first = state.scheduledEvents[simulationEventIdSchema.parse(`simulation-world-first:${intent.id}`)]!
  assert.ok(first && first.action.kind === 'wake')
  if (first.action.kind !== 'wake') throw new Error('Transfer must preserve its actual first-action consequence')
  assert.equal(first.action.entityId, personId)
  const firstDecision = Object.values(state.decisions).find(value => value.wakeId === first.id)!
  assert.equal(firstDecision.entityId, personId)
  assert.equal(firstDecision.status, 'accepted')
  assert.equal(firstDecision.consumption?.sessionId, current.binding!.sessionId)
  const firstPost = Object.values(state.operations).find(value => value.decisionId === firstDecision.id
    && value.action.kind === 'communication/post')!
  assert.ok(firstPost && firstPost.action.kind === 'communication/post')
  if (firstPost.action.kind !== 'communication/post') throw new Error('Transfer first action must use the original private Channel')
  assert.equal(firstPost.action.channelId, identity.channelId)
  const session = await ctx.sessionPersistence.readFrom(current.binding!.sessionId, 0)
  assert.deepEqual(session.events.slice(0, memoryPrefix.length), memoryPrefix)
  assert.ok(JSON.stringify(session.events).includes(memoryCanary))
  assert.ok(JSON.stringify(session.events).includes(`world-role-authority:${intent.id}:0`))
  assert.equal(JSON.stringify(session.events).includes('DIRECTOR-PRIVATE-PERSONNEL-CANARY'), false)
  if (!recovering) {
    const newRole = modelInputs.filter(value => value.entityId === person.id && value.purpose === 'goal')
    assert.ok(newRole.some(value => value.input.includes(`world-role-authority:${intent.id}:0`)))
    assert.ok(modelInputs.filter(value => value.entityId !== person.id).every(value => !value.input.includes(memoryCanary)))
    for (let index = 0; index < requests.length; index += 3) {
      assert.deepEqual(requests.slice(index, index + 3).map(value => value.tool),
        ['simulation_observe', 'simulation_stage', 'simulation_submit'])
    }
  }
  const beforeRetry = run.snapshot().revision, beforeCalls = requests.length
  assert.deepEqual(await connection.commitPersonnel(intent.id), result)
  assert.equal(run.snapshot().revision, beforeRetry)
  assert.equal(requests.length, beforeCalls)
  const proof = { originalIdentity, memoryPrefix, payload, plan, result, previous, replacement,
    personnel: owned.personnel, mutations: owned.mutations, operationGrants: worldOperationGrants(state),
    firstPost, personSessionPrefix: session.events.slice(0, memoryPrefix.length) }
  if (recovering) {
    assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('personnel-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    await writeFile(proofPath, JSON.stringify(proof))
  }
  const evidenceRoot = process.env.WORLD_PERSONNEL_EVIDENCE_ROOT
  if (evidenceRoot !== undefined) {
    const directory = resolve(evidenceRoot)
    await mkdir(directory, { recursive: true })
    const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
    assert.ok(request.operationId !== null && plan.operationId !== null)
    const sourceOperation = state.operations[request.operationId]!, planOperation = state.operations[plan.operationId]!
    const raw = { scenario, backend: process.env.SIMULATION_COMPANY_BACKEND, restored: recovering, modelCalls: requests.length,
      originalIdentity, originalRequest: request, originalIntent: intent, originalPlan: plan, originalReservation: reservation,
      originalCutCoverage: reservation.evidence?.coverage,
      originalMutation: Object.values(owned.mutations).find(value => value.planId === plan.id),
      originalResult: result, originalSourceOperation: sourceOperation, originalPlanOperation: planOperation,
      originalSourceDecision: state.decisions[sourceOperation.decisionId], originalPlanDecision: state.decisions[planOperation.decisionId],
      oldAssignment: previous, newAssignment: replacement, originalFirstAction: firstPost,
      derivedPermissions: owned.personnel.operationGrants, originalSessionPrefix: memoryPrefix,
      sessionPrefixHash: hash(memoryPrefix), retainedPrefixHash: hash(session.events.slice(0, memoryPrefix.length)),
      fullSessionHash: hash(session.events), fullSessionEventCount: session.events.length,
      unchangedBudgets: { native: resolved.native, world: resolved.world.limits }, checkpointId: 'personnel-complete' }
    assert.equal(raw.sessionPrefixHash, raw.retainedPrefixHash)
    await writeFile(resolve(directory, `${process.env.SIMULATION_COMPANY_BACKEND}-${scenario}-${recovering ? 'cold' : 'created'}.json`),
      JSON.stringify(raw, null, 2) + '\n')
  }
  console.log(JSON.stringify({ scenario, originalIdentity: true, originalSession: true, originalProfile: true,
    originalMemory: true, dualPositionAuthority: true, sourceAssignmentClosed: true, targetAssignmentUnique: true,
    declaredNewRolePermission: true, newRoleRecordedContext: true, actualTeamCut: true,
    independentFirstAction: true, privateCanaryLeaks: 0, exactCommitRetryNoAppend: true,
    generatedPeople: 0, restored: recovering, modelCalls: requests.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
