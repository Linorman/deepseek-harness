import { recordR06Cut } from './world-r06-observation.ts'
/** Actual scoped transfer preserves the original Person/Session while Native and canonical Team jointly prove the safe commit. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { WORLD_TRANSFER_PIN, WORLD_DEPART_PIN, WORLD_GENERATE_AND_HIRE_PIN,
  simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWorldGoalSchema, simulationWakeRequestSchema, simulationEntityIdSchema,
  simulationWorldTransferCommittedResultPayloadSchema,
  simulationInspectionSelectionSchema, simulationOperationIdSchema, simulationDispatchOutcomeSchema,
  simulationWorldDepartCommittedResultPayloadSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { SimulationWorldDriver, PersonnelWorldExecution } from '@clocky/clocky-simulation-world'
import type { SimulationWorldDriveResult } from '@clocky/clocky-simulation-world'
import type { ActivationHandle } from '@clocky/clocky-agent-runtime'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, modelInputs } from './world-personnel-crash-model.ts'

const stage = process.env.WORLD_PERSONNEL_CRASH_STAGE
assert.ok(stage)
const departure = stage.startsWith('depart-')
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
installed.runtimeProfiles[0]!.model = { provider: departure ? 'world-departure-scripted' : 'world-personnel-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
const original = compiled.resolved, organization = original.world.organizationEntityId
const permissions = [
  { pin: WORLD_TRANSFER_PIN, relation: 'can-transfer', target: source.positionId },
  { pin: WORLD_TRANSFER_PIN, relation: 'can-transfer-target', target: 'new-responsibility' },
  { pin: WORLD_DEPART_PIN, relation: 'can-depart', target: source.positionId },
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
const proofPath = resolve(root, 'personnel-crash-proof.json'), memoryCanary = 'ORIGINAL-PERSONNEL-PRIVATE-MEMORY-CANARY'
const ctx = await boot('world-personnel-crash', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `personnel-crash-${scenario}-${stage}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('personnel-crash-initial'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-personnel-crash/${scenario}/${stage}`, checkpoint: {
      id: simulationCheckpointIdSchema.parse('personnel-crash-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
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
  const personId = simulationEntityIdSchema.parse(person.id)
  if (!recovering && stage === 'depart-retirement-unknown') {
    const ensure = connection.ensureResident.bind(connection)
    // Keep the target's real epoch until personnel maintenance; release the idle requester for the director within the same resident quota.
    connection.ensureResident = (entityId, choice) => ensure(entityId, { ...choice,
      evict: [...choice.evict.filter(value => value === administrator.id), ...choice.evict.filter(value => value !== administrator.id)] })
  }
  const appendShape = z.object({ kind: z.string(), change: z.object({ kind: z.string().optional(),
    action: z.object({ kind: z.string(), operation: z.string().optional() }).loose().optional(),
    mutation: z.object({ pin: z.object({ operation: z.string() }).loose() }).loose().optional(),
    id: z.string().optional(), outcome: z.object({ status: z.string().optional() }).loose().optional(),
  }).loose().optional() }).loose()
  if (recovering) {
    const raw: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
    assert.ok(raw !== null && typeof raw === 'object' && !Array.isArray(raw))
    const proof = raw as Record<string, unknown>
    assert.equal(proof.stage, stage)
    const durable = proof.durable
    assert.ok(durable !== null && typeof durable === 'object' && !Array.isArray(durable))
    const original = durable as Record<string, unknown>
    const state = run.snapshot(), owned = state.world!
    let dutyPrefix = original
    const notificationPrefixPath = resolve(root, 'notification-reconciled-prefix.json')
    if (stage === 'notification-lost' && process.env.WORLD_PERSONNEL_RESTORE_ROUND === '2') {
      const reconciled: unknown = JSON.parse(await readFile(notificationPrefixPath, 'utf8'))
      assert.ok(reconciled !== null && typeof reconciled === 'object' && !Array.isArray(reconciled))
      dutyPrefix = reconciled as Record<string, unknown>
      assert.ok(Array.isArray(proof.entries))
      const entry = proof.entries.map(value => appendShape.parse(value)).find(value => value.kind === 'run/outbox'
        && value.change?.kind === 'outbox/finished')
      assert.ok(entry?.change)
      const notificationId = simulationOperationIdSchema.parse(entry.change.id)
      assert.ok(original.operations !== null && typeof original.operations === 'object' && !Array.isArray(original.operations))
      const originalOperations = original.operations as Record<string, unknown>
      assert.deepEqual(Object.keys(state.operations).sort(), Object.keys(originalOperations).sort())
      for (const [id, operation] of Object.entries(state.operations)) {
        if (id !== notificationId) assert.deepEqual(operation, originalOperations[id])
        else {
          const prior = originalOperations[id]
          assert.ok(prior !== null && typeof prior === 'object' && !Array.isArray(prior))
          const originalOperation = prior as Record<string, unknown>
          for (const key of ['id', 'decisionId', 'entityId', 'index', 'dependencies', 'fingerprint', 'action', 'worldPin'] as const) {
            assert.deepEqual(operation[key], originalOperation[key])
          }
          assert.ok(originalOperation.outbox !== null && typeof originalOperation.outbox === 'object'
            && !Array.isArray(originalOperation.outbox))
          const originalOutbox = originalOperation.outbox as Record<string, unknown>
          assert.ok(Array.isArray(originalOutbox.attempts))
          assert.deepEqual(operation.outbox?.attempts.slice(0, originalOutbox.attempts.length), originalOutbox.attempts)
          const receipt = simulationDispatchOutcomeSchema.parse(entry.change.outcome)
          assert.ok(receipt.status === 'applied' && 'receipt' in receipt)
          assert.deepEqual(operation.outbox?.receipt, receipt.receipt)
        }
      }
    }
    assert.deepEqual(owned, original.world)
    assert.deepEqual(state.relations, original.relations)
    assert.deepEqual(state.resources, original.resources)
    assert.deepEqual(state.grants, original.grants)
    assert.deepEqual(state.interactions, original.interactions)
    assert.deepEqual(state.commitments, original.commitments)
    assert.deepEqual(state.maintenance ?? {}, original.maintenance ?? {})
    assert.deepEqual(state.decisions, dutyPrefix.decisions)
    assert.deepEqual(state.operations, dutyPrefix.operations)
    assert.deepEqual(state.scheduledEvents, dutyPrefix.scheduledEvents)
    assert.deepEqual(state.wakes, dutyPrefix.wakes)
    assert.deepEqual(state.taskExecutions ?? {}, original.taskExecutions ?? {})
    assert.deepEqual(state.taskCancellations ?? {}, original.taskCancellations ?? {})
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
    assert.ok(original.entities !== null && typeof original.entities === 'object' && !Array.isArray(original.entities))
    const entities = original.entities as Record<string, unknown>
    assert.deepEqual(Object.keys(state.entities).sort(), Object.keys(entities).sort())
    for (const current of Object.values(state.entities)) {
      const old = entities[current.id]
      assert.ok(old !== null && typeof old === 'object' && !Array.isArray(old))
      const entity = old as Record<string, unknown>
      assert.deepEqual(current.binding, entity.binding)
      assert.deepEqual(current.profile, entity.profile)
      assert.equal(current.profileRevision, entity.profileRevision)
      assert.ok(current.writer === undefined || current.writer.phase === 'released')
    }
    const request = Object.values(owned.requests).find(value => value.pin.operation === (departure ? 'depart' : 'transfer'))!
    assert.ok(request)
    const intent = owned.intents[request.intentId]!, reservation = owned.personnel.reservations[intent.id]
    const result = Object.values(owned.results).find(value => value.intentId === intent.id)
    const committed = stage.includes('commit-after') || stage === 'notification-lost'
    if (committed) {
      assert.ok(result && result.outcome.kind === 'committed')
      assert.equal(Object.values(owned.results).filter(value => value.intentId === intent.id).length, 1)
      assert.equal(reservation?.status, 'committed')
      assert.equal(owned.personnel.fences[intent.id]!.status, 'closed')
      const before = run.snapshot().revision
      assert.deepEqual(await connection.commitPersonnel(intent.id), result)
      assert.equal(run.snapshot().revision, before)
      if (departure) {
        const payload = simulationWorldDepartCommittedResultPayloadSchema.parse(result.payload)
        assert.equal(state.relations[payload.closedAssignmentId]!.validUntil, result.time)
      } else {
        const payload = simulationWorldTransferCommittedResultPayloadSchema.parse(result.payload)
        assert.equal(state.relations[payload.closedAssignmentId]!.validUntil, result.time)
        assert.equal(state.relations[payload.newAssignmentId]!.validFrom, result.time)
      }
    } else {
      assert.equal(result, undefined)
      assert.equal(Object.keys(owned.mutations).length, 0)
      assert.equal(Object.values(state.relations).filter(value => value.subject === personId && value.relation === 'assignment'
        && value.validUntil === null).length, 1)
      if (stage === 'transfer-reserve-before' || stage === 'depart-accepted-fence-after') assert.equal(reservation, undefined)
      else {
        assert.ok(reservation)
        assert.equal(reservation.status, 'fenced')
        assert.equal(reservation.targetPositionId, departure ? null : 'new-responsibility')
      }
      if (stage !== 'transfer-reserve-before') assert.equal(owned.personnel.fences[intent.id]!.status, 'active')
    }
    assert.ok(Array.isArray(proof.memoryPrefix))
    const session = await ctx.sessionPersistence.readFrom(state.entities[personId]!.binding!.sessionId, 0)
    assert.deepEqual(session.events.slice(0, proof.memoryPrefix.length), proof.memoryPrefix)
    assert.ok(JSON.stringify(session.events).includes(memoryCanary))
    let unknownRecovery: unknown = null
    if (stage === 'depart-retirement-unknown') {
      assert.ok(proof.unknownStop !== null && typeof proof.unknownStop === 'object' && !Array.isArray(proof.unknownStop))
      const stopped = proof.unknownStop as Record<string, unknown>
      assert.ok(stopped.writer !== null && typeof stopped.writer === 'object' && !Array.isArray(stopped.writer))
      const originalWriter = stopped.writer as Record<string, unknown>, current = state.entities[personId]!.writer
      assert.ok(current)
      assert.equal(current.epoch, originalWriter.epoch)
      assert.equal(current.activationId, originalWriter.activationId)
      assert.equal(current.reservationId, originalWriter.reservationId)
      assert.equal(current.phase, 'released')
      const actualTeam = await ctx.teams.getTeam({ teamId: team.teamId })
      const binding = state.entities[personId]!.binding!
      const epochs = actualTeam.activations.filter(value => value.activation.participantId === binding.participantId)
      assert.equal(epochs.length, 1)
      assert.equal(epochs[0]!.activation.id, originalWriter.activationId)
      assert.ok(epochs[0]!.quiescedAt !== undefined)
      assert.equal(reservation?.status, 'fenced')
      assert.equal(owned.personnel.fences[intent.id]!.status, 'active')
      assert.ok(reservation)
      const maintenance = state.maintenance![reservation.request.maintenance.id]!
      assert.equal(maintenance.status, 'draining')
      assert.deepEqual(maintenance.request, reservation.request.maintenance)
      assert.ok(stopped.population !== null && typeof stopped.population === 'object' && !Array.isArray(stopped.population))
      const oldPopulation = stopped.population as Record<string, unknown>
      assert.ok(typeof oldPopulation.chargedActors === 'number' && oldPopulation.chargedActors > 0)
      assert.equal(run.population().chargedActors, 0)
      unknownRecovery = { originalWriter, currentWriter: current, actualTeamEpoch: epochs[0], maintenance: state.maintenance,
        reservation, fence: owned.personnel.fences[intent.id], originalPopulation: stopped.population,
        recoveredPopulation: run.population() }
    }
    let notificationReceipt: unknown = null
    if (stage === 'notification-lost') {
      assert.ok(Array.isArray(proof.entries))
      const entry = proof.entries.map(value => appendShape.parse(value)).find(value => value.kind === 'run/outbox'
        && value.change?.kind === 'outbox/finished')
      assert.ok(entry?.change)
      const id = simulationOperationIdSchema.parse(entry.change.id), expected = simulationDispatchOutcomeSchema.parse(entry.change.outcome)
      assert.ok(expected.status === 'applied' && 'receipt' in expected)
      await run.setPhase('running', run.snapshot().revision)
      assert.equal((await connection.dispatchOperation(id, Date.now)).status, 'settled')
      notificationReceipt = run.snapshot().operations[id]!.outbox?.receipt
      assert.deepEqual(notificationReceipt, expected.receipt)
      await run.setPhase('paused', run.snapshot().revision)
      assert.deepEqual(run.snapshot().world, original.world)
      const actual = run.snapshot()
      await writeFile(notificationPrefixPath, JSON.stringify({ decisions: actual.decisions, operations: actual.operations,
        scheduledEvents: actual.scheduledEvents, wakes: actual.wakes }, null, 2) + '\n')
    }
    const restoredProof = { stage, world: run.snapshot().world, relations: run.snapshot().relations,
      resources: run.snapshot().resources, grants: run.snapshot().grants, modelCalls: requests.length,
      personBinding: state.entities[personId]!.binding,
      originalPrefix: session.events.slice(0, proof.memoryPrefix.length), notificationReceipt, unknownRecovery,
      decisions: run.snapshot().decisions, operations: run.snapshot().operations,
      scheduledEvents: run.snapshot().scheduledEvents, wakes: run.snapshot().wakes }
    const evidenceRoot = process.env.WORLD_PERSONNEL_CRASH_EVIDENCE_ROOT
    if (evidenceRoot !== undefined) {
      const restoredPath = `${process.env.SIMULATION_COMPANY_BACKEND}-${stage}-restore-${process.env.WORLD_PERSONNEL_RESTORE_ROUND}.json`
      await writeFile(resolve(evidenceRoot, restoredPath),
        JSON.stringify(restoredProof, null, 2) + '\n')
    }
    console.log(JSON.stringify({ scenario, stage, restored: true, committed,
      reservations: Object.keys(owned.personnel.reservations).length,
      fences: Object.keys(owned.personnel.fences).length,
      assignments: Object.values(state.relations).filter(value => value.subject === personId
        && value.relation === 'assignment' && value.validUntil === null).length,
      originalIdentity: true, originalMemory: true, originalDutiesRetained: true, noDuplicateEffect: true,
      exactNotificationReceipt: stage === 'notification-lost', modelCalls: requests.length }))
  } else {
    const advance = async (until = run.snapshot().time): Promise<SimulationWorldDriveResult> => {
      let result = await driver.advance(until)
      for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(until)
      assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify(result))
      return result
    }
    const targetHandles: ActivationHandle[] = []
    if (stage === 'depart-retirement-unknown') {
      const provider = ctx.agentRuntimes.getProvider('in-process')
      assert.ok(provider)
      const activate = provider.activate.bind(provider)
      provider.activate = async (...args) => {
        const actual = await activate(...args)
        if (args[0].participant.id === run.snapshot().entities[personId]!.binding!.participantId) targetHandles.push(actual)
        return actual
      }
    }
    await run.setPhase('running', run.snapshot().revision)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'original-personnel-crash-memory', entityId: person.id, time: '0',
      reason: JSON.stringify({ kind: 'private-person-memory', text: memoryCanary }) }), run.snapshot().revision)
    await advance()
    const session = ctx.sessions.get(run.snapshot().entities[personId]!.binding!.sessionId)
    assert.ok(session)
    assert.equal(await ctx.sessions.flush(session), true)
    const memoryPrefix = (await ctx.sessionPersistence.readFrom(session.id, 0)).events
    await recordR06Cut(ctx, run, selection, 'baseline')
    // Test-only access to the original private stream adds a barrier; no replacement append or invented record is permitted.
    const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
    assert.ok(stream && typeof stream.append === 'function')
    const append = stream.append.bind(stream)
    let captured = false
    const capture = async (before: ReturnType<typeof run.snapshot>, entries: readonly unknown[], unknownStop?: unknown) => {
      captured = true
      const durable = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({ provider: selection.provider,
        spec: selection.spec, includeRecords: true }))
      assert.ok(durable)
      await writeFile(proofPath, JSON.stringify({ stage, before, durable: durable.snapshot, entries, memoryPrefix,
        modelCalls: requests.length, actualModelInputs: modelInputs, unknownStop: unknownStop ?? null }, null, 2) + '\n')
      await recordR06Cut(ctx, run, selection, 'barrier', { canonicalCut: 'held' })
      process.send?.('durable')
      await new Promise<undefined>((done) => { process.once('message', () => { done(undefined) }) })
    }
    if (stage === 'depart-retirement-unknown') {
      assert.equal(targetHandles.length, 1)
      for (const actual of targetHandles) {
        const dispose = actual.dispose.bind(actual)
        let held: Promise<void> | undefined
        actual.dispose = () => held ??= (async () => {
          if (!captured) {
            const before = run.snapshot(), request = Object.values(before.world!.requests).find(value => value.pin.operation === 'depart')!
            const reservation = before.world!.personnel.reservations[request.intentId]!, writer = before.entities[personId]!.writer!
            assert.ok(reservation)
            assert.equal(reservation.status, 'fenced')
            assert.equal(before.world!.personnel.fences[request.intentId]!.status, 'active')
            assert.equal(writer.phase, 'revoked')
            assert.equal(writer.activationId, actual.activation.id)
            assert.ok(run.population().chargedActors > 0)
            const currentTeam = await ctx.teams.getTeam({ teamId: team.teamId })
            const epoch = currentTeam.activations.find(value => value.activation.id === actual.activation.id)!
            assert.ok(epoch && epoch.quiescedAt === undefined)
            await capture(before, [], { writer, population: run.population(), actualEpoch: epoch, reservation,
              maintenance: before.maintenance, request, fence: before.world!.personnel.fences[request.intentId] })
          }
          await dispose()
        })()
      }
    }
    stream.append = async (...args) => {
      const entries = args[1].map(value => appendShape.parse(value))
      const reserve = entries.some(value => value.kind === 'run/personnel' && value.change?.kind === 'personnel/reserved')
      const transferCommit = entries.some(value => value.kind === 'run/world-mutation' && value.change?.mutation?.pin.operation === 'transfer')
      const departCommit = entries.some(value => value.kind === 'run/world-mutation' && value.change?.mutation?.pin.operation === 'depart')
      const departAccepted = entries.some(value => value.kind === 'run/business' && value.change?.kind === 'operation/intent'
        && value.change.action?.kind === 'world/request' && value.change.action.operation === 'depart')
      const maintenance = entries.some(value => value.kind === 'run/maintenance' && value.change?.status === 'draining')
      const notice = entries.some((value) => {
        if (value.kind !== 'run/outbox' || value.change?.kind !== 'outbox/finished' || value.change.outcome?.status !== 'applied') return false
        const operation = run.snapshot().operations[simulationOperationIdSchema.parse(value.change.id)]
        if (operation?.action.kind !== 'communication/post') return false
        let content: unknown
        try { content = JSON.parse(operation.action.text) }
        catch { return false /* Other real Channel messages are not the original committed-result notification. */ }
        return z.object({ resultId: z.string() }).safeParse(content).success
      })
      const matches = stage.startsWith('transfer-reserve-') && reserve || stage.startsWith('transfer-commit-') && transferCommit
        || stage === 'depart-accepted-fence-after' && departAccepted || stage === 'depart-commit-after' && departCommit
        || stage === 'notification-lost' && notice || stage === 'transfer-maintenance-after' && maintenance
      const before = run.snapshot()
      const hold = async () => {
        if (!matches || captured) return
        await capture(before, args[1])
      }
      if (stage.endsWith('-before') || stage === 'notification-lost') await hold()
      const receipt = await append(...args)
      if (stage.endsWith('-after')) await hold()
      return receipt
    }
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'actual-personnel-crash-goal', entityId: administrator.id, time: '1',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1,
        goal: departure ? 'depart-retire' : 'transfer-original-person' })) }), run.snapshot().revision)
    await advance(simTimeSchema.parse('1'))
    throw new Error('The real requested personnel crash barrier was not reached')
  }
  await recordR06Cut(ctx, run, selection, 'final')
} finally { await run.close(); await ctx.fiber.dispose() }
