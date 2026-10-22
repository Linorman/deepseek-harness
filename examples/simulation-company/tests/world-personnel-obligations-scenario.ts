/** Real task creation and post-IO response loss expose current obligations without consuming or disclosing them. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationEntityIdSchema,
  simulationWakeRequestSchema, simTimeSchema, personnelObligationQuerySchema, PersonnelObligationError,
  PERSONNEL_OBLIGATION_MAX_ITEMS, PERSONNEL_OBLIGATION_MAX_BYTES } from '@clocky/clocky-simulation'
import type { PersonnelObligationQuery, PersonnelObligationReport, SimulationEntityId } from '@clocky/clocky-simulation'
import type { TeamEnvelope } from '@clocky/clocky-team'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-personnel-obligations-model.ts'

const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
const sender = definition.actors.find(value => value.role === 'member')!
const senderId = simulationEntityIdSchema.parse(sender.id), receiver = definition.actors.find(value => value.role === 'director')!
const receiverId = simulationEntityIdSchema.parse(receiver.id)
const taskCanary = 'PRIVATE-PERSONNEL-TASK-CANARY', messageCanary = 'PRIVATE-PERSONNEL-MESSAGE-CANARY'
const personaCanary = 'PRIVATE-PERSONNEL-PERSONA-CANARY'
sender.persona = { ...sender.persona, name: personaCanary }
const installed = catalog()
const senderTemplate = installed.templates.find(value => value.template.id === sender.template.id
  && value.template.version === sender.template.version)
assert.ok(senderTemplate)
senderTemplate.template.names.push(personaCanary)
installed.runtimeProfiles[0]!.model = { provider: 'world-personnel-obligations-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok, compiled.ok ? undefined : JSON.stringify(compiled.diagnostics))
const original = compiled.resolved, organization = original.world.organizationEntityId
const resolved: ResolvedWorldScenario = { ...original, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules, { relation: '監督責任',
    subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: '責任:原担当者', subject: sender.id, relation: '監督責任',
    object: organization, scope: organization, validFrom: '0', validUntil: null }] }
const { definitionHash: _hash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const proofPath = resolve(root, 'personnel-obligations-proof.json')
const ctx = await boot('world-personnel-obligations', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `personnel-obligations-${scenario}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('personnel-obligations-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const released = Promise.withResolvers<undefined>(), entered = Promise.withResolvers<TeamEnvelope>()
const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
let driving: Promise<unknown> | undefined
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-personnel-obligations/${scenario}`, checkpoint: {
      id: simulationCheckpointIdSchema.parse('personnel-obligations-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const driver = new SimulationWorldDriver(run, connection, resolved, {
    checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 },
  new AbortController().signal, ctx, ctx.simulationWorldExecutions.handlers({
    run: run,
    connection: connection,
    resolved: resolved,
    anchor: {
      checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 },
    lifetime: new AbortController().signal,
  }, []))
  const query = (personId: SimulationEntityId): PersonnelObligationQuery => personnelObligationQuerySchema.parse({
    selector: { kind: 'person', personId, personRevision: run.snapshot().entities[personId]!.revision },
    limit: PERSONNEL_OBLIGATION_MAX_ITEMS, maxBytes: PERSONNEL_OBLIGATION_MAX_BYTES })
  const assertPrivate = (report: PersonnelObligationReport) => {
    const text = JSON.stringify(report)
    for (const canary of [taskCanary, messageCanary, personaCanary]) assert.equal(text.includes(canary), false)
    assert.doesNotMatch(text, /"(?:description|text|payload|persona|profile)":/)
  }
  const cursors = async () => {
    const current = run.snapshot(), actualTeam = await ctx.teams.getTeam({ teamId: team.teamId })
    const channels = await Promise.all([...actualTeam.channelIds].sort().map(async (channelId) => {
      const channel = await ctx.teams.getChannel({ channelId })
      return { channelId, cursor: channel.cursor }
    }))
    const sessions = await Promise.all(Object.values(current.entities).flatMap(value => value.binding === undefined ? [] : [value.binding])
      .map(async ({ sessionId }) => {
        const absent = await ctx.sessionPersistence.isUnmaterialized(sessionId)
        if (absent) return { sessionId, absent: true }
        const saved = await ctx.sessionPersistence.readFrom(sessionId, 0)
        const reference = await ctx.sessionPersistence.getPersistenceReference(sessionId, saved.events.length - 1)
        return { sessionId, absent: false, sequence: reference.sequence, revision: reference.revision, fingerprint: reference.fingerprint }
      }))
    return { native: current.revision, team: actualTeam.team.cursor, channels, sessions }
  }
  const channelId = run.snapshot().world!.channels[senderId]!
  const identity = { sender: run.snapshot().entities[senderId]!.binding, receiver: run.snapshot().entities[receiverId]!.binding,
    senderProfile: run.snapshot().entities[senderId]!.profile, channelId }
  assert.ok(identity.sender && identity.receiver && channelId)
  let heldEvidence: unknown
  if (!recovering) {
    await run.setPhase('running', run.snapshot().revision)
    const taskTime = simTimeSchema.parse(`${BigInt(run.snapshot().time) + BigInt(1)}`)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'personnel-real-task', entityId: senderId, time: taskTime,
      reason: JSON.stringify({ kind: 'personnel-obligation-task', time: taskTime, task: {
        subject: taskCanary, description: `${taskCanary}: confidential instructions stay in the actual Team task book.`,
        blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 } }) }), run.snapshot().revision)
    assert.equal((await driver.advance(taskTime)).reason, 'idle')
    const taskOperation = Object.values(run.snapshot().operations).find(value => value.action.kind === 'task/create')!
    const taskReceipt = taskOperation.outbox?.taskReceipt
    assert.ok(taskReceipt)
    const actualTask = await ctx.teams.getTask({ teamId: taskReceipt.teamId, taskId: taskReceipt.taskId })
    assert.equal(actualTask.createCommand.creator.participantId, identity.sender.participantId)
    assert.equal(actualTask.phase, 'pending')
    assert.equal(actualTask.proposedOwnerId, undefined)
    assert.equal(actualTask.lease, undefined)
    assert.equal(actualTask.attemptHistory.length, 0)
    ctx.teams.postChannelEnvelope = async (...args) => {
      const envelope = await post(...args)
      if (envelope.channelId === channelId && JSON.stringify(envelope.payload).includes(messageCanary)) {
        entered.resolve(envelope)
        await released.promise
      }
      return envelope
    }
    const messageTime = simTimeSchema.parse(`${BigInt(run.snapshot().time) + BigInt(1)}`)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'personnel-real-message', entityId: senderId, time: messageTime,
      reason: JSON.stringify({ kind: 'personnel-obligation-message', time: messageTime,
        recipient: receiverId, channelId, text: messageCanary }) }), run.snapshot().revision)
    driving = driver.advance(messageTime)
    const envelope = await Promise.race([entered.promise, driving.then(() => { throw new Error('Expected the actual post-IO barrier') })])
    await run.setPhase('paused', run.snapshot().revision)
    const message = Object.values(run.snapshot().operations).find(value => value.action.kind === 'communication/post'
      && value.action.text === messageCanary)!
    assert.ok(message)
    assert.equal(message.outbox?.receipt, undefined)
    for (const entity of Object.values(run.snapshot().entities)) {
      const session = entity.binding === undefined ? undefined : ctx.sessions.get(entity.binding.sessionId)
      if (session !== undefined) assert.equal(await ctx.sessions.flush(session), true)
    }
    const originalCursors = await cursors(), calls = requests.length
    const senderQuery = query(senderId), receiverQuery = query(receiverId)
    const native = run.inspectPersonnelObligations(senderQuery)
    assert.equal(native.complete, false)
    assert.equal(native.status, 'native-only')
    const outgoing = await connection.inspectPersonnelObligations(senderQuery)
    const incoming = await connection.inspectPersonnelObligations(receiverQuery)
    assert.equal(outgoing.status, 'covered')
    assert.equal(incoming.status, 'covered')
    assert.equal(outgoing.complete, true)
    assert.ok(outgoing.items.length > 0)
    assert.ok(outgoing.items.some(value => value.ref.kind === 'team-task' && value.ref.taskId === actualTask.id
      && value.ref.revision === actualTask.revision && value.ref.relation === 'creator' && value.state === 'pending'))
    assert.equal(outgoing.items.some(value => value.ref.kind === 'team-task' && value.ref.taskId === actualTask.id
      && value.ref.relation !== 'creator'), false)
    assert.equal(outgoing.items.some(value => value.ref.kind === 'team-attempt'), false)
    assert.ok(outgoing.items.some(value => value.ref.kind === 'outbox' && value.ref.operationId === message.id
      && value.certainty === 'outcome-unknown'))
    for (const [report, direction] of [[outgoing, 'outgoing'], [incoming, 'incoming']] as const) {
      assertPrivate(report)
      assert.ok(report.items.some(value => value.ref.kind === 'message' && value.ref.operationId === message.id
        && value.ref.direction === direction && value.certainty === 'outcome-unknown'))
      assert.ok(report.items.some(value => value.ref.kind === 'channel-delivery' && value.ref.channelId === channelId
        && value.ref.envelopeId === envelope.id && value.ref.recipientId === identity.receiver!.participantId
        && value.ref.sequence === envelope.sequence && value.ref.direction === direction))
    }
    const assignment = Object.values(run.snapshot().relations).find(value => value.subject === senderId && value.relation === 'assignment')!
    const assignmentReport = await connection.inspectPersonnelObligations(personnelObligationQuerySchema.parse({ ...senderQuery,
      selector: { ...senderQuery.selector, kind: 'assignment', assignmentId: assignment.id, assignmentRevision: assignment.revision } }))
    assert.ok(assignmentReport.items.some(value => value.ref.kind === 'team-task' && value.ref.taskId === actualTask.id))
    const exactItems = await connection.inspectPersonnelObligations({ ...senderQuery, limit: outgoing.totalCount })
    assert.equal(exactItems.complete, true)
    assert.equal((await connection.inspectPersonnelObligations({ ...senderQuery, limit: outgoing.totalCount + 1 })).complete, true)
    const lowerItems = await connection.inspectPersonnelObligations({ ...senderQuery, limit: outgoing.totalCount - 1 })
    assert.equal(lowerItems.complete, false)
    assert.equal(lowerItems.status, 'overflow')
    assert.ok(lowerItems.overflow)
    const bytes = Buffer.byteLength(JSON.stringify(outgoing), 'utf8'), characters = JSON.stringify(outgoing).length
    assert.ok(bytes > characters)
    assert.equal((await connection.inspectPersonnelObligations({ ...senderQuery, maxBytes: bytes })).complete, true)
    assert.equal((await connection.inspectPersonnelObligations({ ...senderQuery, maxBytes: bytes + 1 })).complete, true)
    for (const maxBytes of [bytes - 1, characters]) {
      const bounded = await connection.inspectPersonnelObligations({ ...senderQuery, maxBytes })
      assert.equal(bounded.complete, false)
      assert.equal(bounded.status, 'overflow')
      assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= maxBytes)
      assertPrivate(bounded)
    }
    assert.throws(() => run.inspectPersonnelObligations({ ...senderQuery, selector: {
      kind: 'person', personId: simulationEntityIdSchema.parse('unknown-person'), personRevision: 1 } }),
    (error: unknown) => error instanceof PersonnelObligationError && error.code === 'SIM_PERSONNEL_SELECTOR')
    assert.throws(() => run.inspectPersonnelObligations({ ...senderQuery, selector: {
      ...senderQuery.selector, personRevision: senderQuery.selector.personRevision + 1 } }),
    (error: unknown) => error instanceof PersonnelObligationError && error.code === 'SIM_PERSONNEL_STALE')
    assert.throws(() => personnelObligationQuerySchema.parse({ ...senderQuery, selector: { kind: 'unknown' } }))
    await assert.rejects(connection.inspectPersonnelObligations({ ...senderQuery, maxBytes: 1 }),
      (error: unknown) => error instanceof PersonnelObligationError && error.code === 'SIM_PERSONNEL_INVENTORY_LIMIT')
    assert.deepEqual(await cursors(), originalCursors)
    assert.equal(requests.length, calls)
    heldEvidence = { outgoing, incoming, envelopeId: envelope.id, messageOperationId: message.id, cursors: originalCursors }
    released.resolve(undefined)
    await driving
    ctx.teams.postChannelEnvelope = post
    assert.ok(run.snapshot().operations[message.id]!.outbox?.receipt)
    assert.equal(run.snapshot().phase, 'paused')
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('personnel-obligations-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
  }
  const before = await cursors(), beforeCalls = requests.length
  const finalSender = await connection.inspectPersonnelObligations(query(senderId))
  const finalReceiver = await connection.inspectPersonnelObligations(query(receiverId))
  assertPrivate(finalSender)
  assertPrivate(finalReceiver)
  assert.deepEqual(await cursors(), before)
  assert.equal(requests.length, beforeCalls)
  const actualTeam = await ctx.teams.getTeam({ teamId: team.teamId })
  const actualTask = actualTeam.tasks.find(value => value.subject === taskCanary)!
  assert.ok(actualTask)
  assert.equal(actualTask.phase, 'pending')
  assert.equal(actualTask.proposedOwnerId, undefined)
  assert.equal(actualTask.lease, undefined)
  assert.equal(actualTask.attemptHistory.length, 0)
  assert.ok(finalSender.items.some(value => value.ref.kind === 'team-task' && value.ref.taskId === actualTask.id
    && value.ref.revision === actualTask.revision && value.ref.relation === 'creator'))
  const message = Object.values(run.snapshot().operations).find(value => value.action.kind === 'communication/post'
    && value.action.text === messageCanary)!
  assert.ok(message.outbox?.receipt)
  const current = { identity, task: { id: actualTask.id, revision: actualTask.revision, phase: actualTask.phase,
    creatorId: actualTask.createCommand.creator.participantId }, message: { operationId: message.id,
    fingerprint: message.fingerprint, envelopeId: message.outbox.receipt.envelopeId },
  senderReferences: finalSender.items.filter(value => !['writer', 'team-activation', 'team-startup', 'team-workspace'].includes(value.category)),
  receiverReferences: finalReceiver.items.filter(value => !['writer', 'team-activation', 'team-startup', 'team-workspace'].includes(value.category)) }
  if (recovering) {
    const saved: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
    assert.ok(saved !== null && typeof saved === 'object' && !Array.isArray(saved))
    assert.deepEqual(current, (saved as Record<string, unknown>).current)
    assert.equal(run.snapshot().phase, 'paused')
    assert.equal(requests.length, 0)
  } else await writeFile(proofPath, JSON.stringify({ current, heldEvidence }))
  console.log(JSON.stringify({ scenario, actualPendingTask: true, actualCreator: true, inventedOwnerOrAttempt: false,
    afterIOBeforeReceiptObserved: true, incomingAndOutgoing: true, readonlyCursors: true, privateBodyLeaks: 0,
    exactLimits: true, utf8Bounds: true, selectorRejections: true, originalIdentity: true,
    restored: recovering, modelCalls: requests.length }))
} finally {
  released.resolve(undefined)
  const work = await Promise.allSettled(driving === undefined ? [] : [driving])
  ctx.teams.postChannelEnvelope = post
  const cleanup = await Promise.allSettled([run.close(), ctx.fiber.dispose()])
  const failures = [...work, ...cleanup].filter(value => value.status === 'rejected').map(value => value.reason as unknown)
  if (failures.length > 0) throw new AggregateError(failures, 'Personnel fixture owned work or cleanup did not settle')
}
