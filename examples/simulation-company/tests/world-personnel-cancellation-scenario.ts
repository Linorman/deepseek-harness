import { recordR06Cut } from './world-r06-observation.ts'
import { recoverR06PersonnelCancel } from './world-r06-personnel-cancel.ts'
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
  simulationWorldGoalSchema, simulationWakeRequestSchema, simulationEntityIdSchema,
  simulationWorldTransferPayloadSchema, simulationWorldTransferCommittedResultPayloadSchema,
  simulationWorldCancelRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, PersonnelWorldExecution } from '@clocky/clocky-simulation-world'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-personnel-cancellation-model.ts'

const cancellationCase = process.env.WORLD_PERSONNEL_CANCELLATION_CASE
assert.ok(cancellationCase === 'before-reserve' || cancellationCase === 'during-maintenance'
  || cancellationCase === 'commit-wins' || cancellationCase === 'before-native-commit')
const r06Cancellation = process.env.WORLD_R06_PERSONNEL_CANCEL === 'true'
if (r06Cancellation) assert.ok(cancellationCase === 'before-native-commit' || cancellationCase === 'commit-wins')
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
installed.runtimeProfiles[0]!.model = { provider: 'world-personnel-cancellation-scripted', name: 'scripted', version: '1', available: true }
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
const proofPath = resolve(root, 'personnel-cancellation-proof.json'), memoryCanary = 'ORIGINAL-CANCELLATION-PRIVATE-MEMORY-CANARY'
const ctx = await boot('world-personnel-cancellation', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `personnel-cancellation-${scenario}-${cancellationCase}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse(r06Cancellation ? 'personnel-cancellation-initial' : 'personnel-cancellation-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const released = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<unknown>()
const post = ctx.teams.postChannelEnvelope.bind(ctx.teams), begin = run.beginMaintenance.bind(run), commit = run.commitPersonnel.bind(run)
let driving: Promise<SimulationWorldDriveResult> | undefined
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-personnel-cancellation/${scenario}/${cancellationCase}`, checkpoint: {
      id: simulationCheckpointIdSchema.parse('personnel-cancellation-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
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
    return result
  }
  const personId = simulationEntityIdSchema.parse(person.id)
  if (r06Cancellation && recovering) {
    await recoverR06PersonnelCancel({ ctx, run, selection, connection, driver, person: personId,
      winner: cancellationCase === 'commit-wins' ? 'commit' : 'cancel', models: () => requests.length })
  } else {
    let originalIdentity: unknown, heldEvidence: unknown, memoryPrefix: unknown[] = []
    if (!recovering) {
      const initial = run.snapshot(), target = initial.entities[personId]!
      const assignment = Object.values(initial.relations).find(value => value.subject === personId && value.relation === 'assignment')!
      assert.ok(target.binding)
      originalIdentity = { binding: target.binding, profile: target.profile, profileRevision: target.profileRevision,
        assignment, channelId: initial.world!.channels[personId], entityIds: Object.keys(initial.entities).sort() }
      await run.setPhase('running', initial.revision)
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'original-cancellation-memory', entityId: person.id, time: '0',
        reason: JSON.stringify({ kind: 'private-person-memory', text: memoryCanary }) }), run.snapshot().revision)
      assert.ok(['idle', 'until'].includes((await advance()).reason))
      const session = ctx.sessions.get(target.binding.sessionId)
      assert.ok(session)
      assert.equal(await ctx.sessions.flush(session), true)
      memoryPrefix = [...(await ctx.sessionPersistence.readFrom(target.binding.sessionId, 0)).events]
      assert.ok(JSON.stringify(memoryPrefix).includes(memoryCanary))
      await recordR06Cut(ctx, run, selection, 'baseline')
      let captured = false
      if (cancellationCase === 'before-reserve') {
        ctx.teams.postChannelEnvelope = async (...args) => {
          const envelope = await post(...args), current = run.snapshot()
          const request = Object.values(current.world!.requests).find(value => value.pin.operation === 'transfer')
          const notificationId = request?.notificationOperationId
          if (notificationId !== undefined) assert.ok(notificationId !== null, 'Ordinary request requires its Channel notification')
          const notification = notificationId === undefined ? undefined : current.operations[notificationId]
          if (!captured && notification !== undefined && envelope.traceId === notification.fingerprint) {
            captured = true
            entered.resolve(envelope)
            await released.promise
          }
          return envelope
        }
      } else if (cancellationCase === 'during-maintenance') {
        run.beginMaintenance = async (...args) => {
          const operation = await begin(...args)
          if (!captured && args[0].id.startsWith('world/1/personnel/')) {
            captured = true
            assert.equal(operation.status, 'draining')
            entered.resolve(operation)
            await released.promise
          }
          return operation
        }
      } else if (cancellationCase === 'before-native-commit') {
        run.commitPersonnel = async (...args) => {
          if (!captured) {
            captured = true
            entered.resolve({ intentId: args[0], nativeRevision: run.snapshot().revision })
            await released.promise
          }
          return await commit(...args)
        }
      } else {
        run.commitPersonnel = async (...args) => {
          const result = await commit(...args)
          if (!captured) {
            captured = true
            assert.equal(result.outcome.kind, 'committed')
            entered.resolve(result)
            await released.promise
          }
          return result
        }
      }
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'actual-cancellable-transfer', entityId: administrator.id, time: '1',
        reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'transfer-original-person' })) }),
      run.snapshot().revision)
      driving = advance(simTimeSchema.parse('1'))
      const returned = await Promise.race([entered.promise, driving.then(() => { throw new Error('Original actual cancellation barrier was not reached') })])
      const gate = run.snapshot(), owned = gate.world!, request = Object.values(owned.requests).find(value => value.pin.operation === 'transfer')!
      assert.ok(request)
      const intent = owned.intents[request.intentId]!, reservation = owned.personnel.reservations[intent.id]
      const cancellation = simulationWorldCancelRequestSchema.parse({ id: 'original-personnel-cancellation', requestId: request.id })
      const writer = gate.entities[personId]!.writer, originalAssignment = gate.relations[assignment.id]
      if (cancellationCase === 'before-reserve') {
        assert.equal(reservation, undefined)
        assert.equal(request.plans.length, 0)
        assert.equal(writer?.phase, 'active')
      } else {
        assert.ok(reservation)
        assert.equal(reservation.targetPositionId, 'new-responsibility')
        assert.equal(reservation.status, cancellationCase === 'commit-wins' ? 'committed' : 'fenced')
        const maintenance = gate.maintenance![reservation.request.maintenance.id]!
        assert.equal(maintenance.status, cancellationCase === 'during-maintenance' ? 'draining' : 'quiescent')
        if (cancellationCase === 'before-native-commit') {
          assert.ok(Object.values(gate.entities).every(value => value.writer === undefined || value.writer.phase === 'released'))
        }
      }
      const calls = requests.length, receipt = cancellationCase === 'before-native-commit'
        ? await run.cancelWorldCase(cancellation) : await connection.cancelWorldCase(cancellation)
      assert.equal(requests.length, calls)
      const after = run.snapshot()
      if (cancellationCase === 'before-reserve') {
        assert.equal(receipt.status, 'cancelled')
        assert.deepEqual(after.entities[personId]!.writer, writer)
        assert.deepEqual(after.relations[assignment.id], originalAssignment)
        assert.equal(after.world!.personnel.reservations[intent.id], undefined)
        assert.equal(Object.keys(after.maintenance ?? {}).length, Object.keys(gate.maintenance ?? {}).length)
      } else if (cancellationCase === 'during-maintenance') {
        assert.equal(receipt.status, 'cancel-requested')
        assert.equal(after.world!.requests[request.id]!.status, 'cancel-requested')
        const retained = after.world!.personnel.reservations[intent.id]!
        assert.equal(retained.status, 'cancel-requested')
        assert.equal(retained.targetPositionId, 'new-responsibility')
        assert.equal(after.world!.personnel.fences[intent.id]!.status, 'active')
        assert.deepEqual(after.relations[assignment.id], originalAssignment)
        assert.deepEqual(after.entities[personId]!.binding, target.binding)
        assert.equal(after.maintenance![retained.request.maintenance.id]!.status, 'draining')
        assert.equal(Object.values(after.world!.results).some(value => value.intentId === intent.id), false)
      } else if (cancellationCase === 'before-native-commit') {
        assert.equal(receipt.status, 'cancelled')
        assert.equal(after.world!.personnel.reservations[intent.id]!.status, 'cancelled')
        assert.equal(after.world!.personnel.fences[intent.id]!.status, 'cancelled')
        assert.deepEqual(after.relations[assignment.id], originalAssignment)
        assert.equal(Object.keys(after.world!.mutations).length, 0)
      } else {
        assert.equal(receipt.status, 'already-committed')
        assert.equal(after.world!.personnel.reservations[intent.id]!.status, 'committed')
        assert.equal(after.relations[assignment.id]!.validUntil, '1')
        assert.equal(Object.values(after.world!.results).filter(value => value.intentId === intent.id).length, 1)
      }
      heldEvidence = { returned, request, intent, reservation: reservation ?? null, originalAssignment,
        originalWriter: writer, gateRevision: gate.revision, cancellation, receipt,
        retainedReservation: after.world!.personnel.reservations[intent.id] ?? null,
        retainedFence: after.world!.personnel.fences[intent.id] ?? null, retainedMaintenance: after.maintenance,
        unchangedIdentity: after.entities[personId]!.binding }
      if (r06Cancellation) {
        assert.ok(modelInputs.filter(value => value.entityId !== person.id).every(value => !value.input.includes(memoryCanary)))
        await writeFile(resolve(root, 'r06-personnel-cancel-source.json'), JSON.stringify({ originalIdentity, heldEvidence, memoryPrefix, memoryCanary }, null, 2) + '\n')
        await recordR06Cut(ctx, run, selection, 'barrier', { canonicalCut: 'held' })
        process.send?.('durable')
        await new Promise<void>((done) => { process.once('message', () => { done() }) })
      }
      released.resolve(undefined)
      const finished = await driving
      assert.ok(['idle', 'until', 'paused'].includes(finished.reason), JSON.stringify(finished))
      ctx.teams.postChannelEnvelope = post
      run.beginMaintenance = begin
      run.commitPersonnel = commit
      if (run.snapshot().phase === 'paused') await run.setPhase('running', run.snapshot().revision)
      assert.ok(['idle', 'until'].includes((await advance()).reason))
    } else {
      const saved: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
      assert.ok(saved !== null && typeof saved === 'object' && !Array.isArray(saved))
      const prior = saved as Record<string, unknown>
      originalIdentity = prior.originalIdentity
      heldEvidence = prior.heldEvidence
      assert.ok(Array.isArray(prior.memoryPrefix))
      memoryPrefix = prior.memoryPrefix
    }
    assert.ok(originalIdentity !== null && typeof originalIdentity === 'object' && !Array.isArray(originalIdentity))
    assert.ok(heldEvidence !== null && typeof heldEvidence === 'object' && !Array.isArray(heldEvidence))
    const identity = originalIdentity as Record<string, unknown>, held = heldEvidence as Record<string, unknown>
    const state = run.snapshot(), owned = state.world!, current = state.entities[personId]!
    const request = Object.values(owned.requests).find(value => value.pin.operation === 'transfer')!, intent = owned.intents[request.intentId]!
    const cancellation = simulationWorldCancelRequestSchema.parse(held.cancellation)
    const result = Object.values(owned.results).find(value => value.intentId === intent.id)!
    assert.ok(result)
    assert.equal(Object.values(owned.results).filter(value => value.intentId === intent.id).length, 1)
    assert.deepEqual(current.binding, identity.binding)
    assert.deepEqual(current.profile, identity.profile)
    assert.equal(current.profileRevision, identity.profileRevision)
    assert.deepEqual(Object.keys(state.entities).sort(), identity.entityIds)
    assert.equal(owned.channels[personId], identity.channelId)
    assert.equal(current.phase, 'active')
    const payload = simulationWorldTransferPayloadSchema.parse(intent.payload)
    const reservation = owned.personnel.reservations[intent.id]
    if (cancellationCase === 'commit-wins') {
      assert.equal(result.outcome.kind, 'committed')
      const outcome = simulationWorldTransferCommittedResultPayloadSchema.parse(result.payload)
      assert.equal(state.relations[outcome.closedAssignmentId]!.validUntil, result.time)
      assert.equal(state.relations[outcome.newAssignmentId]!.validFrom, result.time)
      assert.equal(reservation?.status, 'committed')
      assert.equal(owned.personnel.fences[intent.id]!.status, 'closed')
      assert.equal(Object.keys(owned.mutations).length, 1)
    } else {
      assert.equal(result.outcome.kind, 'cancelled')
      assert.equal(result.source.kind, 'cancel')
      if (result.source.kind !== 'cancel') throw new Error('Cancellation must retain its original command source')
      assert.equal(result.source.commandId, cancellation.id)
      assert.deepEqual(state.relations[payload.assignmentId], identity.assignment)
      assert.equal(Object.keys(owned.mutations).length, 0)
      assert.equal(Object.values(state.relations).filter(value => value.subject === personId
      && value.relation === 'assignment' && value.object === payload.targetPositionId).length, 0)
      if (cancellationCase === 'during-maintenance' || cancellationCase === 'before-native-commit') {
        assert.ok(reservation)
        assert.equal(reservation.status, 'cancelled')
        assert.equal(owned.personnel.fences[intent.id]!.status, 'cancelled')
        assert.equal(state.maintenance![reservation.request.maintenance.id]!.status, 'completed')
      } else assert.equal(reservation, undefined)
    }
    const before = run.snapshot().revision, calls = requests.length
    const receipt = await connection.cancelWorldCase(cancellation)
    assert.equal(receipt.status, cancellationCase === 'commit-wins' ? 'already-committed' : 'cancelled')
    assert.equal(receipt.resultId, result.id)
    assert.equal(run.snapshot().revision, before)
    assert.equal(requests.length, calls)
    const session = await ctx.sessionPersistence.readFrom(current.binding!.sessionId, 0)
    assert.deepEqual(session.events.slice(0, memoryPrefix.length), memoryPrefix)
    assert.ok(JSON.stringify(session.events).includes(memoryCanary))
    if (!recovering) {
      assert.ok(modelInputs.filter(value => value.entityId !== person.id).every(value => !value.input.includes(memoryCanary)))
    }
    const proof = { originalIdentity, heldEvidence, memoryPrefix, request, intent, result, reservation: reservation ?? null,
      cancellation: owned.cancellations[cancellation.id], maintenance: state.maintenance ?? null, personnel: owned.personnel,
      mutations: owned.mutations, targetAssignments: Object.values(state.relations).filter(value => value.subject === personId
      && value.relation === 'assignment'), originalSessionPrefix: session.events.slice(0, memoryPrefix.length) }
    if (recovering) {
      assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8')))
      assert.equal(requests.length, 0)
    } else {
      await run.setPhase('paused', run.snapshot().revision)
      await driver.drain()
      assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('personnel-cancellation-complete'),
        implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
      await writeFile(proofPath, JSON.stringify(proof))
    }
    const evidenceRoot = process.env.WORLD_PERSONNEL_CANCELLATION_EVIDENCE_ROOT
    if (evidenceRoot !== undefined) {
      await mkdir(resolve(evidenceRoot), { recursive: true })
      const hash = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
      const raw = { scenario, backend: process.env.SIMULATION_COMPANY_BACKEND, cancellationCase, restored: recovering,
        modelCalls: requests.length, ...proof, prefixHash: hash(memoryPrefix),
        retainedPrefixHash: hash(session.events.slice(0, memoryPrefix.length)),
        unchangedBudgets: { native: resolved.native, world: resolved.world.limits } }
      await writeFile(resolve(evidenceRoot,
        `${process.env.SIMULATION_COMPANY_BACKEND}-${scenario}-${cancellationCase}-${recovering ? 'cold' : 'created'}.json`),
      JSON.stringify(raw, null, 2) + '\n')
    }
    console.log(JSON.stringify({ scenario, cancellationCase, originalIdentity: true, originalSession: true, originalMemory: true,
      noPartialMutation: true, drainingReservationAndFencePreserved: cancellationCase === 'during-maintenance',
      actualQuiescenceBeforeSettlement: cancellationCase !== 'before-reserve',
      cancelledBeforeReserveNoRetirement: cancellationCase === 'before-reserve',
      originalAssignmentPreserved: cancellationCase !== 'commit-wins', commitWinsOriginalResult: cancellationCase === 'commit-wins',
      uniqueResult: true, exactRetryNoAppend: true, generatedPeople: 0, privateCanaryLeaks: 0,
      restored: recovering, modelCalls: requests.length }))
  }
} finally {
  released.resolve(undefined)
  await Promise.allSettled(driving === undefined ? [] : [driving])
  ctx.teams.postChannelEnvelope = post
  run.beginMaintenance = begin
  run.commitPersonnel = commit
  await run.close()
  await ctx.fiber.dispose()
}
