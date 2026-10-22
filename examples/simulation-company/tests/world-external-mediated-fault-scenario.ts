/** Genuine mediated SIGKILL barriers retain exact accepted Native/Channel/Session prefixes without resuming cold cognition. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_MEDIATED_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldFactRequestSchema, WORLD_FACT_TEXT_SCHEMA_REF,
  simulationInspectionSelectionSchema, simulationOperationIdSchema, isWorldFactAdjudicated,
  simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogEntry, LogStream } from '@clocky/clocky-storage'
import type { SessionId } from '@clocky/clocky-session'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { mediatedModelRequests } from './world-external-mediated-fault-model.ts'

const stage = process.env.WORLD_MEDIATED_FAULT_STAGE!, recovering = process.env.WORLD_MEDIATED_FAULT_RECOVER === 'true'
const round = process.env.WORLD_MEDIATED_FAULT_ROUND!, root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
assert.ok(['request-accepted-after', 'request-channel-before', 'request-notification-lost', 'plan-accepted-after',
  'adjudication-before', 'adjudication-after', 'leaf-before', 'leaf-after', 'delayed-notification-lost'].includes(stage))
const mode = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
assert.ok(['src', 'lib'].includes(mode))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(mode === 'lib' ? '/lib/' : '/src/'), path)
if (mode === 'lib') {
  assert.deepEqual(process.execArgv, [])
  assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false)
}
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve('examples/simulation-company/scenarios/world-company.json'), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-mediated-fault-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const requesterId = simulationEntityIdSchema.parse(requester.entityId)
const scope = original.world.organizationEntityId, subject = 'external-mediated-supplier'
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  limits: { ...original.world.limits, maxBytesPerPlan: 16384 },
  operations: [...original.world.operations, WORLD_EXTERNAL_MEDIATED_PIN],
  externalAdjudicationPolicy: { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
    conditionInstalls: ['weather', 'lead-time', 'meeting-status'], futureConditionInstalls: ['lead-time'],
    allowedOutcomeKinds: ['environmental-fact', 'unverified-report', 'failure', 'delayed-event'], maxDelay: '10',
    allowPublicDisclosure: false, allowScopeDisclosure: false, actorDisclosure: [] },
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId,
    domain: 'external', operation: 'interact', version: '3', scopeEntityId: scope, targetEntityId: subject,
    relationId: 'mediated-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready',
    profile: { name: 'Mediated supplier', description: 'A finite simulated external subject.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules, { relation: 'can-interact', subjectKinds: ['person'],
    objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'mediated-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const ctx = await boot('world-external-mediated-fault', process.argv[2]!)
const failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `mediated-fault-company-${stage}`, ...resolved.native } })
const checkpointId = simulationCheckpointIdSchema.parse('mediated-fault-initial')
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpointId,
  implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const proofPath = resolve(root, 'mediated-fault-prefix.json')
let connection = restored?.connection
const stream = Reflect.get(run, 'stream') as LogStream
const normal = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const shape = z.object({ kind: z.string(), change: z.object({ kind: z.string().optional(), id: z.string().optional(),
  action: z.object({ kind: z.string(), domain: z.string().optional() }).loose().optional(),
  externalAdjudication: z.unknown().optional(), externalConsumption: z.unknown().optional(),
  outcome: z.object({ status: z.string().optional() }).loose().optional() }).loose().optional() }).loose()
const privateCanaries = ['PRIVATE-MEDIATED-DIRECTOR-FLOOR-CANARY', 'PRIVATE-MEDIATED-DIRECTOR-RATIONALE']
async function journal(): Promise<LogEntry[]> {
  const result: LogEntry[] = []
  let after = -1
  while (after < stream.tailSequence) {
    const entries = await stream.read(after, 128)
    assert.ok(entries.length)
    result.push(...entries); after = entries.at(-1)!.sequence
  }
  return result
}
async function channels(state: SimulationSnapshot) {
  const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
  return Promise.all(team.channelIds.map(async channelId => ({ channelId,
    records: (await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 32 })).records })))
}
async function sessions(state: SimulationSnapshot) {
  return Promise.all(Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [(async () => {
    const binding = entity.binding!, unmaterialized = await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
    return { entityId: entity.id, binding, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
  })()]))
}
try {
  const inputPath = resolve(root, 'mediated-fault-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(inputPath, 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `mediated-fault/company/${stage}`, checkpoint: { id: checkpointId, maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  connection ??= await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
  const lifetime = new AbortController().signal
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx,
    ctx.simulationWorldExecutions.handlers({
      run: run,
      connection: connection,
      resolved: resolved,
      anchor: anchor,
      lifetime: lifetime,
    }, [new ExternalMediatedWorldExecution(run, connection, resolved, anchor, lifetime)]))
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(mediatedModelRequests.length, 0)
  if (recovering) {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      state: SimulationSnapshot
      journal: LogEntry[]
      channels: Awaited<ReturnType<typeof channels>>
      sessions: Array<{ entityId: string; binding: { sessionId: SessionId }; unmaterialized: boolean; events: unknown[] }> }
    const state = run.snapshot()
    assert.equal(state.phase, 'paused')
    for (const key of ['world', 'relations', 'resources', 'grants', 'commitments', 'interactions', 'decisions', 'operations',
      'wakes', 'scheduledEvents', 'maintenance'] as const) assert.deepEqual(normal(state[key]), proof.state[key])
    assert.deepEqual(Object.keys(state.entities), Object.keys(proof.state.entities))
    for (const entity of Object.values(state.entities)) {
      assert.deepEqual(entity.binding, proof.state.entities[entity.id]!.binding)
      assert.deepEqual(entity.profile, proof.state.entities[entity.id]!.profile)
      assert.equal(entity.readiness, proof.state.entities[entity.id]!.readiness)
      assert.ok(entity.writer === undefined || entity.writer.phase === 'released')
    }
    const entries = await journal()
    assert.deepEqual(entries.slice(0, proof.journal.length), proof.journal)
    const actualChannels = await channels(state)
    assert.deepEqual(actualChannels, proof.channels)
    for (const session of proof.sessions) {
      assert.equal(state.entities[simulationEntityIdSchema.parse(session.entityId)]!.binding!.sessionId, session.binding.sessionId)
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(session.binding.sessionId), session.unmaterialized)
      if (!session.unmaterialized) assert.deepEqual((await ctx.sessionPersistence.readFrom(session.binding.sessionId, 0)).events
        .slice(0, session.events.length), session.events)
    }
    const request = Object.values(state.world!.requests)[0]!
    assert.ok(request)
    const intent = state.world!.intents[request.intentId]!
    assert.equal(intent.requesterEntityId, requesterId)
    assert.equal(request.pin.version, '3')
    const adjudications = Object.values(state.world!.external.adjudications)
    const duties = Object.values(state.world!.external.events)
    if (['request-accepted-after', 'request-channel-before', 'request-notification-lost'].includes(stage)) {
      assert.equal(request.status, 'open')
      assert.equal(adjudications.length, 0)
      assert.equal(request.plans.length, 0)
    } else {
      assert.equal(request.plans.length, 1)
      assert.equal(state.world!.plans[request.plans[0]!]!.status, 'accepted')
      if (stage === 'plan-accepted-after' || stage === 'adjudication-before') {
        assert.equal(adjudications.length, 0); assert.equal(duties.length, 0)
        assert.equal(request.status, 'open')
      } else {
        assert.equal(adjudications.length, 1); assert.equal(duties.length, 1)
        const adjudication = adjudications[0]!, duty = duties[0]!
        assert.equal(request.status, 'committed')
        assert.equal(adjudication.planId, request.plans[0])
        assert.equal(adjudication.basis.actorId, world.directorEntityId)
        assert.equal(adjudication.basis.kind, 'model')
        assert.equal(duty.original.adjudicationSequence, adjudication.sequence)
        assert.equal(duty.original.leafHash, proof.state.world!.external.events[duty.original.eventId]!.original.leafHash)
        assert.deepEqual(duty.original, proof.state.world!.external.events[duty.original.eventId]!.original)
        const leafConsumed = ['leaf-after', 'delayed-notification-lost'].includes(stage)
        assert.equal(duty.status, leafConsumed ? 'consumed' : 'scheduled')
        assert.equal(state.scheduledEvents[duty.original.eventId]!.status, leafConsumed ? 'consumed' : 'pending')
        const facts = Object.values(state.world!.facts).flat().filter(isWorldFactAdjudicated)
        assert.equal(facts.length, leafConsumed ? 1 : 0)
        if (leafConsumed) {
          assert.equal(duty.consumption!.time, duty.original.deliverAt)
          assert.deepEqual(facts[0]!.payload.provenance.event, { eventId: duty.original.eventId,
            consumedSequence: duty.consumption!.sequence })
          const wakeId = `simulation-external-adjudication-result:${duty.original.eventId}`
          const wake = Object.values(state.scheduledEvents).find(value => value.id === wakeId)!
          assert.ok(wake && wake.action.kind === 'wake')
          assert.equal(wake.action.entityId, world.directorEntityId)
        }
      }
    }
    const posts = Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
    const canonicalProofs: unknown[] = []
    for (const post of posts) {
      if (post.action.kind !== 'communication/post') throw new Error('Canonical proof requires its actual communication')
      const expectedSender = state.entities[post.entityId]!.binding!.participantId
      const matched = actualChannels.flatMap(value => value.records).filter(value => value.type === 'channel/envelope'
        && value.envelope.correlationId === JSON.stringify([state.spec.runId, post.decisionId, post.id,
          state.decisions[post.decisionId]!.closedAt]))
      assert.ok(matched.length <= 1)
      for (const accepted of matched) {
        assert.ok(accepted.type === 'channel/envelope')
        assert.equal(accepted.envelope.senderId, expectedSender)
        const expected = renderDirectV4EnvelopeInput(accepted.envelope)
        const recipientSessionId: SessionId = state.entities[post.action.recipient]!.binding!.sessionId
        const materialized = !await ctx.sessionPersistence.isUnmaterialized(recipientSessionId)
        const events = materialized ? (await ctx.sessionPersistence.readFrom(recipientSessionId, 0)).events : []
        const received = events.filter(value => value.type === 'user/message' && value.surfaceOp === 'append' && value.data.id === expected.id)
        if (post.delivery?.receipt !== undefined) {
          assert.equal(received.length, 1); assert.deepEqual(received[0]!.data, expected)
        } else assert.equal(received.length, 0)
        for (const canary of privateCanaries) assert.equal(JSON.stringify(accepted.envelope).includes(canary), false)
        canonicalProofs.push({ operationId: post.id, accepted, received, pendingReceipt: post.outbox?.receipt === undefined })
      }
    }
    const notice = posts.find(value => value.id === request.notificationOperationId)!
    assert.ok(notice)
    const requestEnvelopes = canonicalProofs.filter(value =>
      z.object({ operationId: z.literal(notice.id) }).loose().safeParse(value).success)
    if (stage === 'request-accepted-after' || stage === 'request-channel-before') assert.equal(requestEnvelopes.length, 0)
    else assert.equal(requestEnvelopes.length, 1)
    if (stage.endsWith('notification-lost')) {
      const lost = posts.find((value) => {
        const context = state.decisions[value.decisionId]!.context
        return stage.startsWith('request-') ? value.id === request.notificationOperationId
          : context?.status === 'prepared' && context.world?.kind === 'result' && context.world.externalEventId !== undefined
      })
      assert.ok(lost?.outbox)
      assert.equal(lost.outbox.receipt, undefined)
      assert.equal(lost.outbox.attempts.at(-1)?.outcome, 'in-flight')
      assert.ok(canonicalProofs.some(value => z.object({ operationId: z.literal(lost.id),
        pendingReceipt: z.literal(true) }).loose().safeParse(value).success))
    }
    for (const canary of privateCanaries) {
      assert.equal(JSON.stringify(state.world!.results).includes(canary), false)
      const session = await ctx.sessionPersistence.readFrom(state.entities[requesterId]!.binding!.sessionId, 0)
      assert.equal(JSON.stringify(session.events).includes(canary), false)
    }
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(mediatedModelRequests.length, 0)
    await writeFile(resolve(root, `mediated-fault-cold-${round}.json`), JSON.stringify({ stage, state, journal: entries,
      canonicalProofs, sessions: await sessions(state), restoreManifest: restored?.manifest, anchor,
      runtimePaths, execArgv: process.execArgv, modelCalls: 0 }))
    console.log(JSON.stringify({ stage, phase: 'paused', modelCalls: 0, originalResponsibilityRetained: true,
      canonicalSourceRetained: true, privateInputsExcluded: true, runtimePaths, execArgv: process.execArgv }))
  } else {
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject, kind: 'inventory', unit: 'widget', quantity: '7',
      controllers: [] }), run.snapshot().revision)
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-money', owner: subject, kind: 'money', unit: 'credit', quantity: '999',
      controllers: [world.directorEntityId] }), run.snapshot().revision)
    await run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'director-only-canary', version: '1', schemaRef: WORLD_FACT_TEXT_SCHEMA_REF,
      subject: scope, scope, payload: { body: privateCanaries[0] }, effectiveFrom: '0', effectiveUntil: null, availableAt: '0',
      audience: { kind: 'actors', entityIds: [world.directorEntityId] }, supersedes: null,
      sources: [{ kind: 'run-event', runId: selection.spec.runId, sequence: run.snapshot().world!.sequence }] }))
    let reached = false
    const hold = async (entries: readonly unknown[]) => {
      assert.equal(reached, false)
      reached = true
      const inspected = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({ provider: selection.provider,
        spec: selection.spec, includeRecords: true }))
      assert.ok(inspected)
      const state = inspected.snapshot
      await writeFile(proofPath, JSON.stringify({ stage, state, journal: await journal(), entries,
        channels: await channels(state), sessions: await sessions(state), initialCheckpoint: prepared?.checkpoint,
        anchor, modelRequests: mediatedModelRequests }))
      process.send?.({ event: 'mediated-durable-boundary', stage })
      await new Promise<void>((done) => { process.once('message', () => { done() }) })
    }
    const append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const values = args[1].map(value => shape.parse(value))
      const acceptedRequest = values.some(value => value.kind === 'run/business' && value.change?.kind === 'operation/intent'
        && value.change.action?.kind === 'world/request' && value.change.action.domain === 'external')
      const acceptedPlan = values.some(value => value.kind === 'run/business' && value.change?.kind === 'operation/intent'
        && value.change.action?.kind === 'world/resolve')
      const adjudication = values.some(value => value.kind === 'run/world-mutation' && value.change?.externalAdjudication !== undefined)
      const consumption = values.some(value => value.kind === 'run/scheduler' && value.change?.externalConsumption !== undefined)
      const notification = values.some((value) => {
        if (value.kind !== 'run/outbox' || value.change?.kind !== 'outbox/finished' || value.change.outcome?.status !== 'applied') return false
        const operation = run.snapshot().operations[simulationOperationIdSchema.parse(value.change.id)]!
        if (operation.action.kind !== 'communication/post') return false
        const notice = JSON.parse(operation.action.text) as Record<string, unknown>
        const context = run.snapshot().decisions[operation.decisionId]!.context
        return stage === 'request-notification-lost' ? typeof notice.requestId === 'string'
          : context?.status === 'prepared' && context.world?.kind === 'result' && context.world.externalEventId !== undefined
      })
      const matches = stage === 'request-accepted-after' && acceptedRequest || stage === 'plan-accepted-after' && acceptedPlan
        || stage.startsWith('adjudication-') && adjudication || stage.startsWith('leaf-') && consumption
        || stage.endsWith('notification-lost') && notification
      if (matches && (stage.endsWith('-before') || stage.endsWith('notification-lost'))) await hold(args[1])
      const result = await append(...args)
      if (matches && stage.endsWith('-after')) await hold(args[1])
      return result
    }
    if (stage === 'request-channel-before') {
      const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
      ctx.teams.postChannelEnvelope = async (input) => {
        const { content } = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })) })
          .parse(input.draft.payload)
        const requestNotice = content.some(value => value.type === 'text' && value.text.includes('requestId'))
        if (requestNotice) await hold([{ kind: 'team/channel-publication-pending', draft: input.draft,
          idempotencyKey: input.idempotencyKey }])
        return post(input)
      }
    }
    await run.setPhase('running', run.snapshot().revision)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'mediated-fault-goal', entityId: requesterId, time: '1',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'delayed' })) }), run.snapshot().revision)
    let result = await driver.advance(simTimeSchema.parse('1'))
    for (let step = 0; step < 8 && result.reason === 'work-limit'; step++) result = await driver.advance(simTimeSchema.parse('1'))
    if (stage.startsWith('leaf-') || stage === 'delayed-notification-lost') {
      const duty = Object.values(run.snapshot().world!.external.events)[0]!
      assert.ok(duty)
      assert.equal(duty.status, 'scheduled')
      result = await driver.advance(duty.original.deliverAt)
      for (let step = 0; step < 8 && result.reason === 'work-limit'; step++) result = await driver.advance(duty.original.deliverAt)
    }
    throw new Error(`Real mediated power-loss boundary was not reached: ${stage}; ${JSON.stringify({ result, failures })}`)
  }
} catch (error) {
  await writeFile(resolve(root, `mediated-fault-failure-${round}.json`), JSON.stringify({ state: run.snapshot(), failures,
    modelRequests: mediatedModelRequests }))
  throw error
} finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
