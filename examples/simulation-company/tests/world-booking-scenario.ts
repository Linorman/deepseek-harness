/** A separately registered booking domain traverses the same real Loader, tools, Channel, driver and cold restore. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { boot } from '@clocky/clocky-app-boot'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { simulationWorldDefinitionSchema, simulationRunSelectionSchema, simulationCheckpointIdSchema,
  simulationWakeRequestSchema, simulationWorldGoalSchema, simulationDecisionIdSchema, simulationWorldDomainPinSchema, SimulationWorldDomainError } from '@clocky/clocky-simulation'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { BOOKING_PIN, BOOKING_DEFINITION, BookingNativeDomain, BookingExecution } from './world-booking-domain.ts'
import { requests, modelInputs } from './world-driver-model.ts'

const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = ['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => import.meta.resolve(name))
assert.ok(runtimePaths.every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
if (face === 'lib') assert.deepEqual(process.execArgv, [])
const actorQuota = process.env.WORLD_BOOKING_ACTOR_QUOTA === 'true'
const scenario = process.env.WORLD_SCENARIO
assert.ok(scenario === 'company' || scenario === 'laboratory')
const ctx = await boot('world-booking', process.argv[2]!)
const module = new BookingNativeDomain()
const installation = process.env.BOOKING_INSTALLATION ?? 'original'
const changedPin = simulationWorldDomainPinSchema.parse({ ...BOOKING_PIN,
  schemaRef: installation === 'schema' ? 'clocky.test.meeting-room/schema/other' : BOOKING_PIN.schemaRef,
  implementationRef: installation === 'implementation' ? 'clocky.test.meeting-room/native/other' : BOOKING_PIN.implementationRef,
  generation: installation === 'generation' ? 2 : BOOKING_PIN.generation })
if (installation !== 'original') {
  Object.defineProperty(module, 'ref', { value: changedPin.implementationRef })
  Object.defineProperty(module, 'generation', { value: changedPin.generation })
}
if (installation !== 'missing') ctx.effect(() => ctx.simulations.domains('local').register(
  { ...BOOKING_DEFINITION, schemaRef: changedPin.schemaRef }, module))
const executionInstallation = process.env.BOOKING_EXECUTION_INSTALLATION ?? 'original'
let executionBindings = 0
if (executionInstallation !== 'missing') {
  const executionPin = simulationWorldDomainPinSchema.parse({ ...BOOKING_PIN,
    schemaRef: executionInstallation === 'schema' ? 'clocky.test.meeting-room/schema/other' : BOOKING_PIN.schemaRef,
    implementationRef: executionInstallation === 'implementation' ? 'clocky.test.meeting-room/execution/other' : BOOKING_PIN.implementationRef,
    generation: executionInstallation === 'generation' ? 2 : BOOKING_PIN.generation })
  const executionDefinition = { ...BOOKING_DEFINITION, schemaRef: executionPin.schemaRef,
    schemas: executionInstallation === 'parser' ? { ...BOOKING_DEFINITION.schemas,
      request: BOOKING_DEFINITION.schemas.request.refine(() => true) } : BOOKING_DEFINITION.schemas }
  const close = ctx.simulationWorldExecutions.register({ definition: executionDefinition,
    ref: executionPin.implementationRef, generation: executionPin.generation,
    create: (binding) => { executionBindings++; return new BookingExecution(binding.run) } })
  ctx.effect(() => close)
  if (executionInstallation === 'closed') await close()
}
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(`examples/simulation-company/scenarios/world-${scenario}.json`, 'utf8')))
if (actorQuota) definition.limits = { ...definition.limits, world: { ...definition.limits?.world, maxRequestsPerActorPerInterval: 1 } }
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-driver-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member')!
const roomId = 'meeting-room', org = original.world.organizationEntityId
const world = simulationWorldDefinitionSchema.parse({ ...original.world, operations: [BOOKING_PIN], authorizations: [],
  operationGrants: [{ requesterEntityId: requester.entityId, domain: BOOKING_PIN.domain, operation: BOOKING_PIN.operation,
    version: BOOKING_PIN.version, scopeEntityId: org, targetEntityId: roomId, relationId: 'booking-permission', relation: 'can-book' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    { relation: 'can-book', subjectKinds: ['person'], objectKinds: ['room'], scopeKinds: ['organization'], acyclic: false },
    { relation: 'booking', subjectKinds: ['person'], objectKinds: ['room'], scopeKinds: ['organization'], acyclic: false }] },
  entities: [...original.entities, { kind: 'entity/create', id: roomId, entityKind: 'room', cognition: 'none', readiness: 'ready',
    profile: { name: 'Meeting room', description: 'One independently registered reservable room.' } }],
  relations: [...original.relations, { kind: 'relation/create', id: 'booking-permission', subject: requester.entityId,
    relation: 'can-book', object: roomId, scope: org, validFrom: '0', validUntil: null }] }
// This trusted fixture composition is retained independently of the v0 author compiler's hiring projection.
const body = JSON.stringify({ ...resolved, definitionHash: undefined })
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(body).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const sourcePath = resolve(root, 'booking-definition.json'), proofPath = resolve(root, 'booking-proof.json')
if (recovering) assert.deepEqual(resolved, JSON.parse(await readFile(sourcePath, 'utf8')))
else await writeFile(sourcePath, JSON.stringify(resolved))
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `booking-${scenario}`, ...resolved.native } })
if (recovering && executionInstallation !== 'original') {
  const inspection = { provider: selection.provider, spec: selection.spec, includeRecords: true }
  const before = await ctx.simulations.inspect(inspection)
  assert.ok(before)
  let writableOpenCalls = 0, attachmentCalls = 0, refusal: { name: string; code: string; message: string } | undefined
  const open = ctx.simulations.open.bind(ctx.simulations), attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
  ctx.simulations.open = (request) => { writableOpenCalls++; return open(request) }
  ctx.simulationTeams.attach = (...args) => { attachmentCalls++; return attach(...args) }
  await assert.rejects(ctx.simulationTeams.restore(selection, { id: simulationCheckpointIdSchema.parse('booking-complete'),
    implementationVersion: 'world/1', maxAttempts: 3 }), (error: unknown) => {
    if (!(error instanceof SimulationWorldDomainError)) return false
    refusal = { name: error.name, code: error.code, message: error.message }
    return error.code === (executionInstallation === 'missing' ? 'SIM_WORLD_DOMAIN_UNKNOWN'
      : executionInstallation === 'closed' ? 'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE' : 'SIM_WORLD_IMPLEMENTATION_MISMATCH')
  })
  const after = await ctx.simulations.inspect(inspection)
  assert.deepEqual(after, before)
  assert.equal(writableOpenCalls, 0); assert.equal(attachmentCalls, 0); assert.equal(executionBindings, 0); assert.equal(requests.length, 0)
  await writeFile(resolve(root, `execution-refusal-${executionInstallation}.json`), JSON.stringify({ face, runtimePaths,
    installation: executionInstallation, refusal, before, after, writableOpenCalls, attachmentCalls, executionBindings,
    modelCalls: requests.length }, null, 2))
  console.log(JSON.stringify({ scenario, executionUnavailable: true, installation: executionInstallation,
    writableOpenCalls, attachmentCalls, executionBindings, modelCalls: 0 }))
  await ctx.fiber.dispose()
  process.exit(0)
}
if (recovering && installation !== 'original') {
  await assert.rejects(ctx.simulationTeams.restore(selection, { id: simulationCheckpointIdSchema.parse('booking-complete'),
    implementationVersion: 'world/1', maxAttempts: 3 }), (error: unknown) => {
    let original: unknown = error
    while (original instanceof Error && original.cause !== undefined) original = original.cause
    return original instanceof SimulationWorldDomainError
        && original.code === (installation === 'missing' ? 'SIM_WORLD_DOMAIN_UNKNOWN' : 'SIM_WORLD_IMPLEMENTATION_MISMATCH')
  })
  assert.equal(requests.length, 0)
  console.log(JSON.stringify({ scenario, unavailable: true, installation, modelCalls: 0 }))
  await ctx.fiber.dispose()
  process.exit(0)
}
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: simulationCheckpointIdSchema.parse('booking-complete'),
  implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
try {
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `world-driver/${scenario}`, checkpoint: { id: simulationCheckpointIdSchema.parse('booking-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
  const reservation = run.snapshot().teamReservation!
  const ownerName = reservation.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, reservation.teamId, ownerName)
  const driver = new SimulationWorldDriver(run, connection, resolved,
    { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id,
      ownerName, maxDrainRounds: 4, maxAttempts: 3 }, new AbortController().signal, ctx, ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id,
        ownerName, maxDrainRounds: 4, maxAttempts: 3 },
      lifetime: new AbortController().signal,
    }, [new BookingExecution(run)]))
  assert.equal((await driver.advance()).reason, 'paused')
  if (!recovering) {
    assert.equal(Object.keys(run.snapshot().world!.intents).length, 0)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'booking-goal', entityId: requester.entityId, time: '0',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1,
        goal: 'Reserve the meeting room from 10 until 20.' })) }), run.snapshot().revision)
    await run.setPhase('running', run.snapshot().revision)
    let result = await driver.advance()
    for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance()
    assert.equal(result.reason, 'idle', JSON.stringify(result))
  }
  const state = run.snapshot(), owned = state.world!, request = Object.values(owned.requests)[0]!, accepted = Object.values(owned.plans)[0]!
  const result = Object.values(owned.results)[0]!, mutation = Object.values(owned.mutations)[0]!
  assert.equal(owned.definition.operations[0]?.domain, 'meeting-room')
  assert.equal(request.requesterEntityId, requester.entityId)
  assert.equal(request.source.kind, 'decision')
  assert.deepEqual(request.source.binding, state.entities[request.requesterEntityId]?.binding)
  assert.equal(result.outcome.kind, 'committed')
  assert.deepEqual(result.payload, { roomEntityId: roomId, from: '10', until: '20', relationId: `booking:${request.intentId}` })
  assert.deepEqual(mutation.pin, BOOKING_PIN)
  assert.equal(mutation.planId, accepted.id)
  assert.equal(Object.keys(owned.requests).length, 1)
  assert.equal(Object.keys(owned.plans).length, 1)
  assert.equal(Object.keys(owned.mutations).length, 1)
  assert.equal(Object.keys(owned.reservations).length, 0)
  const relation = Object.values(state.relations).find(value => value.relation === 'booking')!
  assert.equal(relation.subject, requester.entityId)
  assert.equal(relation.object, roomId)
  assert.equal(relation.validFrom, '10')
  assert.equal(relation.validUntil, '20')
  const posts = Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
  assert.equal(posts.length, 2)
  assert.ok(posts.every(value => value.delivery?.receipt !== undefined))
  const beforeRejected = run.snapshot().revision
  await assert.rejects(run.commitWorldMutation({ planId: accepted.id, payload: { forged: true } }))
  await assert.rejects(run.openWorldIntent(request.requesterEntityId, { ...request.proposal, version: 'uninstalled' }))
  await assert.rejects(run.openWorldIntent(request.requesterEntityId, { ...request.proposal, businessKey: 'forged-actor',
    payload: { organizationEntityId: org, roomEntityId: roomId, from: '10', until: '20', description: 'Invalid',
      requesterEntityId: 'director' } }))
  await assert.rejects(run.openWorldIntent(request.requesterEntityId, { ...request.proposal, businessKey: 'wrong-room',
    payload: { organizationEntityId: org, roomEntityId: 'position', from: '10', until: '20', description: 'Invalid' } }))
  const acceptedResolution = accepted.proposal.resolution
  assert.equal(acceptedResolution.kind, 'apply')
  if (acceptedResolution.kind !== 'apply') throw new Error('Booking lost its apply resolution')
  assert.throws(() => { module.validatePlan(state, owned.intents[request.intentId]!, acceptedResolution) }, /overlaps/)
  assert.equal(run.snapshot().revision, beforeRejected)
  const beforeRetry = run.snapshot().revision
  assert.deepEqual(await run.commitWorldMutation({ planId: accepted.id, payload: {} }), result)
  assert.equal(run.snapshot().revision, beforeRetry)
  assert.equal((await driver.advance()).reason, recovering ? 'paused' : 'idle')
  const retryId = simulationDecisionIdSchema.parse('booking-original-request-retry')
  if (!recovering) {
    const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
    const retry = await connection.executeDecision(request.requesterEntityId, retryId, {
      personaVersion: 'world/1', modelVersion: requester.runtime.model.version, sources: [],
      world: { kind: 'request', intentId: request.intentId }, sections: [
        { kind: 'identity', required: true, blocks: text({ entityId: requester.entityId }) },
        { kind: 'authority', required: true, blocks: text({ instruction: 'Repeat only the original accepted request.' }) },
        { kind: 'input', required: true, blocks: text({ instruction: 'Read the retained Native receipt.' }) },
        { kind: 'goals', required: true, blocks: text({ kind: 'world-driver', entityId: requester.entityId,
          contextKey: retryId, purpose: 'request' }) },
        { kind: 'commitments', required: true, blocks: text({ instruction: 'Do not create another booking.' }) },
      ],
    })
    assert.equal(retry.status, 'accepted'); assert.equal(retry.operationIds.length, 1)
    await run.executeOperation(retry.operationIds[0]!)
    assert.deepEqual(run.snapshot().world, owned)
    assert.deepEqual(run.snapshot().relations, state.relations)
    assert.equal(Object.values(run.snapshot().operations).filter(value => value.action.kind === 'communication/post').length, posts.length)
  }
  const retryDecision = run.snapshot().decisions[retryId]!
  assert.equal(retryDecision.context?.status, 'prepared')
  if (retryDecision.context?.status !== 'prepared') throw new Error('Original receipt context is missing')
  assert.deepEqual(retryDecision.context.world, { kind: 'request', pin: BOOKING_PIN, intentId: request.intentId,
    reads: [], baseRevision: retryDecision.context.world?.baseRevision })
  const receiptBlock = retryDecision.context.view.content.flatMap(section => section.blocks)
    .find(block => block.type === 'text' && block.text.includes('"receipt":'))
  assert.ok(receiptBlock?.type === 'text')
  const receiptMaterial = JSON.parse(receiptBlock.text) as { receipt: unknown }
  assert.deepEqual(receiptMaterial.receipt, { requestId: request.id, status: 'committed', proposal: request.proposal })
  const quotaId = simulationDecisionIdSchema.parse('booking-over-actor-quota')
  if (actorQuota && !recovering) {
    const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
    const denied = await connection.executeDecision(request.requesterEntityId, quotaId, {
      personaVersion: 'world/1', modelVersion: requester.runtime.model.version, sources: [], world: { kind: 'goal' }, sections: [
        { kind: 'identity', required: true, blocks: text({ entityId: request.requesterEntityId }) },
        { kind: 'authority', required: true, blocks: text({ instruction: 'Request another booking within the recorded limits.' }) },
        { kind: 'input', required: true, blocks: text({ instruction: 'Use the declared separate future interval.' }) },
        { kind: 'goals', required: true, blocks: text({ kind: 'world-driver', entityId: request.requesterEntityId,
          contextKey: quotaId, purpose: 'goal', bookingRequest: { businessKey: 'another-business-key', from: '30', until: '40' } }) },
        { kind: 'commitments', required: true, blocks: text({ instruction: 'Preserve the original booking.' }) },
      ],
    })
    assert.equal(denied.status, 'cancelled')
    assert.deepEqual(denied.worldSubmissionBlock?.failure, { code: 'SIM_WORLD_LIMIT', limit: 'requests' })
    assert.deepEqual(run.snapshot().world, owned)
    assert.equal(run.snapshot().phase, 'stalled')
    assert.equal(run.snapshot().stall?.code, 'SIM_WORLD_SUBMISSION_BLOCKED')
  }
  const quotaDecision = actorQuota ? run.snapshot().decisions[quotaId] : undefined
  if (actorQuota) {
    assert.ok(quotaDecision?.worldSubmissionBlock)
    assert.equal(owned.definition.limits.maxRequestsPerActorPerInterval, 1)
    assert.ok(owned.definition.limits.maxRequests > Object.keys(owned.requests).length)
    if (quotaDecision.context?.status !== 'prepared') throw new Error('Quota denial lost its original context')
    const budgetBlock = quotaDecision.context.view.content.flatMap(section => section.blocks)
      .find(block => block.type === 'text' && block.text.includes('"requestBudget":'))
    assert.ok(budgetBlock?.type === 'text')
    const observedBudget = JSON.parse(budgetBlock.text) as { requestBudget: unknown }
    assert.deepEqual(observedBudget.requestBudget, { actorId: request.requesterEntityId, interval: '0', period: '100', used: 1, limit: 1 })
  }
  const retryView = retryDecision.context.view
  const session = await ctx.sessionPersistence.readFrom(state.entities[request.requesterEntityId]!.binding!.sessionId, 0)
  const saved = session.events.filter(event => event.type === 'simulation/context-view' && event.data.inputId === retryView.inputId)
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0]!.data, retryDecision.context.view)
  const proof = { world: owned, relation, posts, retryDecision, receiptBlock, saved, runtimePaths,
    ...quotaDecision === undefined ? {} : { quotaDecision } }
  if (!recovering) await writeFile(resolve(root, 'booking-model-inputs.json'),
    JSON.stringify({ requests, modelInputs, sessionEvents: session.events }, null, 2) + '\n')
  if (recovering) { assert.deepEqual(proof, JSON.parse(await readFile(proofPath, 'utf8'))); assert.equal(requests.length, 0) }
  else {
    await run.setPhase('paused', run.snapshot().revision)
    await driver.drain()
    const checkpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('booking-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(checkpoint.status, 'completed')
    if (checkpoint.status !== 'completed') throw new Error('Original booking checkpoint did not complete')
    const checkpointWorld = checkpoint.manifest.state.world
    assert.ok(checkpointWorld)
    assert.deepEqual(checkpointWorld.domains, [BOOKING_PIN])
    for (const kind of ['intent', 'request', 'plan', 'result', 'mutation'])
      assert.equal(checkpointWorld.records.filter(value => value.kind === kind).length, 1)
    assert.equal(JSON.stringify(checkpointWorld).includes('Private appointment validation'), false)
    await writeFile(proofPath, JSON.stringify(proof))
    const observation = await ctx.simulations.inspect(ctx.simulations.resolveInspection({ provider: 'local',
      spec: selection.spec, includeRecords: true }))
    assert.ok(observation?.records)
    await writeFile(resolve(root, 'booking-journal.json'), JSON.stringify(observation, null, 2) + '\n')
  }
  console.log(JSON.stringify({ scenario, booking: true, genericDriver: true, noHireIntent: true,
    actualChannel: true, mutations: 1, restored: recovering, modelCalls: requests.length, ...actorQuota ? { actorQuota: true } : {} }))
} finally { await run.close(); await ctx.fiber.dispose() }
