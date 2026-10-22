/** Actual departure fences original role admission at acceptance, settles owners and preserves canonical personal history. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { WORLD_DEPART_PIN, simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWorldGoalSchema, simulationWakeRequestSchema, simulationEntityIdSchema,
  simulationWorldDepartPayloadSchema, simulationWorldDepartCommittedResultPayloadSchema,
  personnelObligationQuerySchema, personnelRetired, simulationChangeSchema, worldOperationGrants } from '@clocky/clocky-simulation'
import type { SimulationRelation, SimulationOperation } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, PersonnelWorldExecution } from '@clocky/clocky-simulation-world'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import type { TeamEnvelope } from '@clocky/clocky-team'
import type { TeamTaskSnapshot } from '@clocky/clocky-team'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-departure-model.ts'

const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const retire = process.env.WORLD_DEPARTURE_RETIRE === 'true'
const future = process.env.WORLD_DEPARTURE_FUTURE === 'true'
const handoff = process.env.WORLD_DEPARTURE_HANDOFF === 'true'
assert.ok(!future || scenario === 'company' && !retire && !handoff)
assert.ok(!handoff || scenario === 'company' && !retire && !future)
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
const [person, administrator] = definition.actors.filter(value => value.role === 'member')
assert.ok(person && administrator)
const source = definition.assignments.find(value => value.personId === person.id)
assert.ok(source)
definition.positions.push({ id: 'departure-admin', name: 'Departure administrator', capacity: 1 })
definition.assignments.push({ id: 'departure-admin-assignment', personId: administrator.id, positionId: 'departure-admin' })
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-departure-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
const original = compiled.resolved, organization = original.world.organizationEntityId
const world = simulationWorldDefinitionSchema.parse({ ...original.world, operations: [...original.world.operations, WORLD_DEPART_PIN],
  operationGrants: [...original.world.operationGrants, { requesterEntityId: administrator.id, domain: WORLD_DEPART_PIN.domain,
    operation: WORLD_DEPART_PIN.operation, version: WORLD_DEPART_PIN.version, targetEntityId: source.positionId,
    scopeEntityId: organization, relation: 'can-depart', relationId: 'departure-permission' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules, { relation: 'can-depart',
    subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'departure-permission', subject: administrator.id,
    relation: 'can-depart', object: source.positionId, scope: organization, validFrom: '0', validUntil: null }] }
const { definitionHash: _hash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const proofPath = resolve(root, 'departure-proof.json'), memoryCanary = 'ORIGINAL-DEPARTURE-PRIVATE-MEMORY-CANARY'
const ctx = await boot('world-departure', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `departure-${scenario}-${retire}-${future}-${handoff}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('departure-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
const released = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<TeamEnvelope>()
let driving: Promise<SimulationWorldDriveResult> | undefined
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-departure/${scenario}/${retire}`, checkpoint: {
      id: simulationCheckpointIdSchema.parse('departure-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
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
    }, [new PersonnelWorldExecution(run, connection, anchor, lifetime, 'depart')]))
  assert.equal((await driver.advance()).reason, 'paused')
  const advance = async (until = run.snapshot().time, allowHandoff = false): Promise<SimulationWorldDriveResult> => {
    let result = await driver.advance(until)
    for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(until)
    assert.ok(['idle', 'until', ...allowHandoff ? ['handoff-required'] : []].includes(result.reason), JSON.stringify({ result,
      reservations: run.snapshot().world!.personnel.reservations }))
    return result
  }
  const wake = async (entityId: string, wakeId: string, reason: string) => {
    const request = simulationWakeRequestSchema.parse({ id: wakeId, entityId,
      time: `${BigInt(run.snapshot().time) + BigInt(1)}`, reason })
    await run.scheduleWake(request, run.snapshot().revision)
    return advance(request.time)
  }
  const personId = simulationEntityIdSchema.parse(person.id)
  let originalIdentity: unknown, heldEvidence: unknown, memoryPrefix: unknown[] = []
  let futureRelation: SimulationRelation | null = null
  let taskEvidence: unknown = null
  if (!recovering) {
    if (future) {
      const originalGrant = world.operationGrants.find(value => value.requesterEntityId === personId && value.relation === 'can-hire')!
      assert.ok(originalGrant)
      const originalRelation = run.snapshot().relations[originalGrant.relationId]!
      await run.change(simulationChangeSchema.parse({ kind: 'relation/update', id: originalRelation.id,
        relationRevision: originalRelation.revision, subject: originalRelation.subject, relation: originalRelation.relation,
        object: originalRelation.object, scope: originalRelation.scope, validFrom: '10', validUntil: originalRelation.validUntil }),
      run.snapshot().revision)
      futureRelation = run.snapshot().relations[originalRelation.id]!
      assert.equal(futureRelation.validFrom, '10')
    }
    const initial = run.snapshot(), initialPerson = initial.entities[personId]!
    const assignment = Object.values(initial.relations).find(value => value.subject === personId && value.relation === 'assignment')!
    assert.ok(initialPerson.binding)
    originalIdentity = { personId, binding: initialPerson.binding, profile: initialPerson.profile,
      profileRevision: initialPerson.profileRevision, assignment, channelId: initial.world!.channels[personId],
      entityIds: Object.keys(initial.entities).sort() }
    await run.setPhase('running', initial.revision)
    await wake(person.id, 'original-departure-memory', JSON.stringify({ kind: 'private-person-memory', text: memoryCanary }))
    const session = ctx.sessions.get(initialPerson.binding.sessionId)
    assert.ok(session)
    assert.equal(await ctx.sessions.flush(session), true)
    memoryPrefix = [...(await ctx.sessionPersistence.readFrom(initialPerson.binding.sessionId, 0)).events]
    assert.ok(JSON.stringify(memoryPrefix).includes(memoryCanary))
    let originalTask: TeamTaskSnapshot | undefined
    let originalTaskOperation: SimulationOperation | undefined
    const createTask = async (entityId: string, wakeId: string, subject: string) => {
      const time = `${BigInt(run.snapshot().time) + BigInt(1)}`
      const reason = JSON.stringify({ kind: 'departure-create-task', wakeId, time,
        task: { subject, description: 'An independent pending task retains its original source and cancellation history.',
          blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
          reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 } })
      const request = simulationWakeRequestSchema.parse({ id: wakeId, entityId, time, reason })
      await run.scheduleWake(request, run.snapshot().revision)
      await advance(request.time)
      const operation = Object.values(run.snapshot().operations).find(value => value.entityId === entityId
        && value.action.kind === 'task/create' && value.action.task.subject === subject)!
      assert.ok(operation?.outbox?.taskReceipt)
      const task = await ctx.teams.getTask({ teamId: operation.outbox.taskReceipt.teamId, taskId: operation.outbox.taskReceipt.taskId })
      assert.equal(task.phase, 'pending')
      assert.equal(task.lease, undefined)
      assert.equal(task.attemptHistory.length, 0)
      return { task, operation }
    }
    if (handoff) {
      const created = await createTask(person.id, 'original-pending-task', 'ORIGINAL-DEPARTURE-PENDING-TASK')
      originalTask = created.task
      originalTaskOperation = created.operation
    }
    let captured = false
    ctx.teams.postChannelEnvelope = async (...args) => {
      const envelope = await post(...args), state = run.snapshot()
      const request = Object.values(state.world!.requests).find(value => value.pin.operation === 'depart' && value.status === 'open')
      const notificationId = request?.notificationOperationId
      if (notificationId !== undefined) assert.ok(notificationId !== null, 'Ordinary request requires its Channel notification')
      const notification = notificationId === undefined ? undefined : state.operations[notificationId]
      if (!captured && notification !== undefined && envelope.traceId === notification.fingerprint) {
        captured = true
        entered.resolve(envelope)
        await released.promise
      }
      return envelope
    }
    const request = simulationWakeRequestSchema.parse({ id: 'actual-departure-goal', entityId: administrator.id,
      time: `${BigInt(run.snapshot().time) + BigInt(1)}`,
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1,
        goal: retire ? 'depart-retire' : 'depart-keep-personal' })) })
    await run.scheduleWake(request, run.snapshot().revision)
    driving = advance(request.time, handoff)
    const envelope = await Promise.race([entered.promise, driving.then(() => { throw new Error('Actual accepted departure notification was not held') })])
    const accepted = run.snapshot(), caseRecord = Object.values(accepted.world!.requests).find(value => value.pin.operation === 'depart')!
    const intent = accepted.world!.intents[caseRecord.intentId]!, fence = accepted.world!.personnel.fences[intent.id]!
    assert.equal(caseRecord.status, 'open')
    assert.equal(caseRecord.plans.length, 0)
    assert.equal(fence.status, 'active')
    assert.equal(fence.requestId, caseRecord.id)
    assert.equal(fence.assignmentId, assignment.id)
    assert.equal(fence.personId, personId)
    assert.equal(accepted.relations[assignment.id]!.validUntil, null)
    assert.equal(accepted.entities[personId]!.phase, 'active')
    assert.equal(accepted.entities[personId]!.writer?.phase, 'active')
    assert.ok(run.population().chargedActors > 0)
    const inventory = await connection.inspectPersonnelObligations(personnelObligationQuerySchema.parse({
      selector: { kind: 'assignment', personId, personRevision: accepted.entities[personId]!.revision,
        assignmentId: assignment.id, assignmentRevision: assignment.revision }, limit: 1024, maxBytes: world.limits.maxBytesPerPlan }))
    assert.equal(inventory.complete, true)
    assert.ok(inventory.items.some(value => value.ref.kind === 'writer' && value.ref.entityId === personId && value.state === 'active'))
    assert.ok(inventory.items.some(value => value.ref.kind === 'team-activation'))
    assert.ok(inventory.items.some(value => value.ref.kind === 'world-case' && value.ref.intentId === intent.id))
    heldEvidence = { nativeRevision: accepted.revision, request: caseRecord, intent, fence,
      originalAssignment: accepted.relations[assignment.id],
      originalWriter: accepted.entities[personId]!.writer, population: run.population(), inventory, envelope }
    released.resolve(undefined)
    const disposition = await driving
    ctx.teams.postChannelEnvelope = post
    if (handoff) {
      assert.ok(originalTask && originalTaskOperation)
      assert.equal(disposition.reason, 'handoff-required')
      const blocked = run.snapshot(), retained = blocked.world!.personnel.reservations[intent.id]!
      assert.equal(blocked.phase, 'paused')
      assert.equal(blocked.entities[personId]!.phase, 'active')
      assert.equal(blocked.relations[assignment.id]!.validUntil, null)
      assert.equal(retained.status, 'fenced')
      assert.equal(blocked.world!.personnel.fences[intent.id]!.status, 'active')
      const pending = await ctx.teams.getTask({ teamId: team.teamId, taskId: originalTask.id })
      assert.equal(pending.phase, 'pending')
      const cancelled = await connection.cancelTask({ operationId: originalTaskOperation.id,
        expectedRevision: pending.revision, expectedAttemptId: null, reason: 'Explicitly cancel original pending work before departure.' })
      assert.equal(cancelled.phase, 'cancelled')
      assert.deepEqual(cancelled.createCommand, originalTask.createCommand)
      assert.equal((await driver.reconcile()).reason, 'paused')
      assert.equal(run.snapshot().world!.personnel.reservations[intent.id]!.status, 'committed')
      await run.setPhase('running', run.snapshot().revision)
      await advance()
      const replacement = await createTask(administrator.id, 'new-independent-task', 'NEW-INDEPENDENT-POST-DEPARTURE-TASK')
      assert.notEqual(replacement.task.id, originalTask.id)
      assert.notEqual(replacement.operation.id, originalTaskOperation.id)
      assert.equal(replacement.task.proposedOwnerId, undefined)
      assert.notEqual(replacement.task.createCommand.creator.participantId, originalTask.createCommand.creator.participantId)
      const stillOriginal = await ctx.teams.getTask({ teamId: team.teamId, taskId: originalTask.id })
      assert.deepEqual(stillOriginal, cancelled)
      taskEvidence = { originalTask, originalTaskOperation, blockedReservation: retained,
        blockedAssignment: blocked.relations[assignment.id],
        cancelledTask: cancelled, newTask: replacement.task, newTaskOperation: replacement.operation,
        nativeCancellation: Object.values(run.snapshot().taskCancellations ?? {})
          .find(value => value.request.operationId === originalTaskOperation.id) }
    }
    if (!retire) {
      const request = simulationWakeRequestSchema.parse({ id: 'post-departure-personal-activity', entityId: person.id,
        time: future ? '11' : `${BigInt(run.snapshot().time) + BigInt(1)}`,
        reason: JSON.stringify({ kind: 'independent-personal-activity',
          text: 'Continue personal activity in the original Session without the former organizational role.' }) })
      await run.scheduleWake(request, run.snapshot().revision)
      await advance(request.time)
    }
  } else {
    const saved: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
    assert.ok(saved !== null && typeof saved === 'object' && !Array.isArray(saved))
    const prior = saved as Record<string, unknown>
    originalIdentity = prior.originalIdentity
    heldEvidence = prior.heldEvidence
    assert.ok(Array.isArray(prior.memoryPrefix))
    memoryPrefix = prior.memoryPrefix
    taskEvidence = prior.taskEvidence ?? null
    if (future) {
      assert.ok(prior.futureRelation !== null && typeof prior.futureRelation === 'object' && !Array.isArray(prior.futureRelation))
      const futureRecord = prior.futureRelation as Record<string, unknown>
      const relation = Object.values(run.snapshot().relations).find(value => value.id === futureRecord.id)
      assert.ok(relation)
      assert.deepEqual(relation, prior.futureRelation)
      futureRelation = relation
    }
  }
  assert.ok(originalIdentity !== null && typeof originalIdentity === 'object' && !Array.isArray(originalIdentity))
  const identity = originalIdentity as Record<string, unknown>, state = run.snapshot(), owned = state.world!
  const current = state.entities[personId]!
  const request = Object.values(owned.requests).find(value => value.pin.operation === 'depart')!, intent = owned.intents[request.intentId]!
  const plan = owned.plans[request.plans.at(-1)!]!, result = Object.values(owned.results).find(value => value.intentId === intent.id)!
  assert.ok(result && result.outcome.kind === 'committed')
  const payload = simulationWorldDepartPayloadSchema.parse(intent.payload)
  const outcome = simulationWorldDepartCommittedResultPayloadSchema.parse(result.payload)
  assert.equal(payload.personId, personId)
  assert.equal(payload.retire, retire)
  assert.equal(plan.proposal.resolution.kind, 'apply')
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('Actual director must preserve the original departure apply payload')
  assert.deepEqual(plan.proposal.resolution.payload, payload)
  assert.deepEqual(current.binding, identity.binding)
  assert.deepEqual(current.profile, identity.profile)
  assert.equal(current.profileRevision, identity.profileRevision)
  assert.deepEqual(Object.keys(state.entities).sort(), identity.entityIds)
  assert.equal(owned.channels[personId], identity.channelId)
  assert.equal(current.phase, 'active')
  assert.equal(current.cognition, 'agent')
  assert.equal(outcome.entityId, personId)
  assert.equal(outcome.retire, retire)
  assert.equal(outcome.requestedEffectiveAt, null)
  assert.equal(outcome.actualEffectiveAt, result.time)
  const assignment = state.relations[outcome.closedAssignmentId]!
  assert.equal(assignment.subject, personId)
  assert.equal(assignment.validUntil, result.time)
  assert.equal(assignment.revision, payload.assignmentRevision + 1)
  assert.equal(Object.values(state.relations).filter(value => value.subject === personId && value.relation === 'assignment'
    && value.validUntil === null).length, 0)
  for (const relationId of outcome.closedAuthorityRelationIds) assert.equal(state.relations[relationId]!.validUntil, result.time)
  if (future) {
    assert.ok(futureRelation)
    assert.equal(outcome.closedAuthorityRelationIds.includes(futureRelation.id), false)
    assert.ok(outcome.revokedAuthorityRelationIds.includes(futureRelation.id))
    assert.deepEqual(state.relations[futureRelation.id], futureRelation)
    assert.ok(BigInt(state.time) > BigInt(futureRelation.validFrom))
    assert.equal(worldOperationGrants(state).some(value => value.requesterEntityId === personId), false)
  }
  const reservation = owned.personnel.reservations[intent.id]!
  assert.equal(reservation.status, 'committed')
  assert.equal(reservation.evidence?.complete, true)
  assert.equal(reservation.evidence?.coverage.team.kind, 'observed')
  assert.equal(owned.personnel.fences[intent.id]!.status, 'closed')
  assert.equal(owned.personnel.operationGrants.length, 0)
  assert.equal(personnelRetired(state, personId), retire)
  const actualTeam = await ctx.teams.getTeam({ teamId: team.teamId })
  if (handoff) {
    assert.ok(taskEvidence !== null && typeof taskEvidence === 'object' && !Array.isArray(taskEvidence))
    const evidence = taskEvidence as Record<string, unknown>
    assert.ok(evidence.cancelledTask !== null && typeof evidence.cancelledTask === 'object' && !Array.isArray(evidence.cancelledTask))
    assert.ok(evidence.newTask !== null && typeof evidence.newTask === 'object' && !Array.isArray(evidence.newTask))
    const oldTaskRecord = evidence.cancelledTask as Record<string, unknown>, newTaskRecord = evidence.newTask as Record<string, unknown>
    const oldTask = actualTeam.tasks.find(value => value.id === oldTaskRecord.id)
    const newTask = actualTeam.tasks.find(value => value.id === newTaskRecord.id)
    assert.ok(oldTask && newTask)
    assert.equal(oldTask.phase, 'cancelled')
    assert.equal(newTask.phase, 'pending')
    assert.equal(newTask.lease, undefined)
    assert.equal(newTask.attemptHistory.length, 0)
    assert.deepEqual(JSON.parse(JSON.stringify(oldTask)), evidence.cancelledTask)
    assert.deepEqual(JSON.parse(JSON.stringify(newTask)), evidence.newTask)
  }
  const activations = actualTeam.activations.filter(value => value.activation.participantId === current.binding!.participantId)
  assert.ok(activations.length > 0)
  if (retire) {
    assert.equal(current.writer?.phase, 'released')
    assert.ok(activations.every(value => value.quiescedAt !== undefined))
  }
  const session = await ctx.sessionPersistence.readFrom(current.binding!.sessionId, 0)
  assert.deepEqual(session.events.slice(0, memoryPrefix.length), memoryPrefix)
  assert.ok(JSON.stringify(session.events).includes(memoryCanary))
  assert.equal(JSON.stringify(session.events).includes('DIRECTOR-PRIVATE-DEPARTURE-CANARY'), false)
  if (!recovering) {
    assert.ok(modelInputs.filter(value => value.entityId !== person.id).every(value => !value.input.includes(memoryCanary)))
    if (!retire) {
      assert.ok(Object.values(state.decisions).some(value => value.entityId === personId && value.status === 'accepted'
        && value.wakeId === 'post-departure-personal-activity'))
      assert.ok(JSON.stringify(session.events).includes('post-departure-personal-activity'))
      assert.ok(modelInputs.some(value => value.entityId === person.id && value.purpose === 'message'
        && value.input.includes('post-departure-personal-activity')))
    }
    for (let index = 0; index < requests.length; index += 3) assert.deepEqual(requests.slice(index, index + 3).map(value => value.tool),
      ['simulation_observe', 'simulation_stage', 'simulation_submit'])
  }
  const before = run.snapshot().revision, calls = requests.length
  assert.deepEqual(await connection.commitPersonnel(intent.id), result)
  assert.equal(run.snapshot().revision, before)
  assert.equal(requests.length, calls)
  const proof = { originalIdentity, heldEvidence, memoryPrefix, futureRelation, taskEvidence,
    request, intent, plan, result, reservation, assignment,
    mutations: owned.mutations, personnel: owned.personnel, originalSessionPrefix: session.events.slice(0, memoryPrefix.length) }
  if (recovering) {
    assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
    assert.equal(requests.length, 0)
  } else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('departure-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
    await writeFile(proofPath, JSON.stringify(proof))
  }
  const evidenceRoot = process.env.WORLD_DEPARTURE_EVIDENCE_ROOT
  if (evidenceRoot !== undefined) {
    const directory = resolve(evidenceRoot)
    await mkdir(directory, { recursive: true })
    const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
    const raw = { scenario, backend: process.env.SIMULATION_COMPANY_BACKEND, retire, future, handoff,
      restored: recovering, modelCalls: requests.length,
      ...proof, originalCutCoverage: reservation.evidence?.coverage, actualTeamActivations: activations,
      prefixHash: hash(memoryPrefix), retainedPrefixHash: hash(session.events.slice(0, memoryPrefix.length)),
      unchangedBudgets: { native: resolved.native, world: resolved.world.limits } }
    assert.equal(raw.prefixHash, raw.retainedPrefixHash)
    await writeFile(resolve(directory,
      `${process.env.SIMULATION_COMPANY_BACKEND}-${scenario}-${retire ? 'retire' : 'personal'}-`
        + `${handoff ? 'handoff' : future ? 'future' : 'normal'}-`
        + `${recovering ? 'cold' : 'created'}.json`),
    JSON.stringify(raw, null, 2) + '\n')
  }
  console.log(JSON.stringify({ scenario, retire, future, handoff, immediateAcceptedFence: true, unreleasedWriterPreserved: true,
    originalIdentity: true, originalSession: true, originalProfile: true, originalMemory: true,
    assignmentClosed: true, oldRoleAuthorityClosed: true, activeNotTerminated: true,
    personalActivityContinues: !retire, actualRetirementConfirmed: retire, actualTeamCut: true, futurePermissionRevoked: future,
    originalTaskExplicitlyCancelled: handoff, newIndependentPendingTask: handoff,
    privateCanaryLeaks: 0, exactCommitRetryNoAppend: true, generatedPeople: 0, restored: recovering, modelCalls: requests.length }))
} finally {
  released.resolve(undefined)
  await Promise.allSettled(driving === undefined ? [] : [driving])
  ctx.teams.postChannelEnvelope = post
  await run.close()
  await ctx.fiber.dispose()
}
