/** Real normal representative effects and canonical receipts survive accepted IO and Native append crashes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_ACTOR_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldFactRequestSchema, WORLD_FACT_TEXT_SCHEMA_REF,
  simulationInspectionSelectionSchema, simulationOperationIdSchema, simulationOutboxRetryRequestSchema,
  activeSimulationMaintenance } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationOperationId, SimulationOperation } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution } from '@clocky/clocky-simulation-world'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-external-actor-faults-model.ts'

const stage = process.env.WORLD_ACTOR_FAULT!
assert.ok(['actor-reserve-before', 'actor-reserve-after', 'actor-preparing-after', 'actor-participant-unconfirmed',
  'actor-commit-before', 'actor-commit-after', 'director-channel-unconfirmed', 'requester-channel-unconfirmed',
  'result-notice-before-post', 'contact-post-lost', 'contact-session-before-ack', 'contact-ack-after',
  'reply-post-lost', 'reply-session-before-ack', 'reply-ack-after'].includes(stage))
const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
const finalCold = process.env.WORLD_FAULT_FINAL === 'true'
assert.ok(['company', 'laboratory'].includes(scene))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-actor-faults-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const requesterId = simulationEntityIdSchema.parse(requester.entityId)
const scope = original.world.organizationEntityId, subject = simulationEntityIdSchema.parse('external-supplier')
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_EXTERNAL_ACTOR_PIN],
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requesterId, domain: 'external', operation: 'interact',
    version: '2', scopeEntityId: scope, targetEntityId: subject, relationId: 'external-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready',
    profile: { name: 'Independent Supplier', description: 'An external simulated supplier represented by its own actor.' } }],
  native: { ...original.native, outboxMaxAttempts: 1, relationRules: [...original.native.relationRules,
    { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    { relation: 'represents', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'external-permission', subject: requesterId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
const ctx = await boot('world-external-actor-faults', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `external-actor-fault-${scene}-${stage}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('actor-fault-initial'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const core = (value: SimulationSnapshot = run.snapshot()) => ({ world: value.world, entities: value.entities,
  relations: value.relations, resources: value.resources, grants: value.grants, commitments: value.commitments,
  operations: value.operations, decisions: value.decisions, wakes: value.wakes, scheduledEvents: value.scheduledEvents,
  maintenance: value.maintenance ?? null })
const normalize = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
try {
  const inputPath = resolve(root, 'fault-input.json'), prefixPath = resolve(root, 'fault-prefix.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify({ selection, resolved }))
  else assert.deepEqual(JSON.parse(await readFile(inputPath, 'utf8')), { selection: { ...selection, mode: 'create' }, resolved })
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `external-actor-fault/${scene}/${stage}`, checkpoint: { id: simulationCheckpointIdSchema.parse('actor-fault-initial'),
      maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, owner = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof owner === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, owner)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id,
    ownerName: owner, maxDrainRounds: 4, maxAttempts: 3 }
  const lifetime = new AbortController().signal
  const adapter = new ExternalActorWorldExecution(run, connection, resolved, anchor, lifetime)
  const driver = new SimulationWorldDriver(run, connection, resolved, anchor, lifetime, ctx, ctx.simulationWorldExecutions.handlers({
    run: run,
    connection: connection,
    resolved: resolved,
    anchor: anchor,
    lifetime: lifetime,
  }, [adapter]))
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  const representative = () => Object.values(run.snapshot().world!.external.representatives)[0]
  const role = (operation: SimulationOperation | undefined): 'contact' | 'reply' | undefined => {
    if (operation?.action.kind !== 'communication/post') return
    const rep = representative()
    if (operation.entityId === requesterId && operation.action.recipient === rep?.identities.entityId) return 'contact'
    if (operation.entityId === rep?.identities.entityId && operation.action.recipient === requesterId) return 'reply'
  }
  const operationFor = (selected: 'contact' | 'reply') => Object.values(run.snapshot().operations).find(value => role(value) === selected)
  const journal = async () => {
    const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream, records = []
    let after = -1
    while (after < stream.tailSequence) {
      const entries = await stream.read(after, 128)
      assert.ok(entries.length)
      records.push(...entries); after = entries.at(-1)!.sequence
    }
    return records
  }
  const actual = async () => {
    const current = await ctx.teams.getTeam({ teamId: team.teamId }), channels = []
    for (const channelId of current.channelIds) {
      const channel = await ctx.teams.getChannelAdmission({ channelId })
      const page = await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })
      assert.equal(page.records.length, channel.channel.cursor + 1)
      channels.push({ channelId, channel, records: page.records })
    }
    const sessions = []
    for (const entity of Object.values(run.snapshot().entities)) {
      const binding = entity.binding ?? entity.participantReservation?.binding
      if (binding === undefined) continue
      sessions.push({ entityId: entity.id, binding, stored: await ctx.sessionPersistence.isUnmaterialized(binding.sessionId)
        ? null : await ctx.sessionPersistence.readFrom(binding.sessionId, 0) })
    }
    return { team: current, channels, sessions, population: run.population(), budgets: run.budgetUsage(),
      modelPool: ctx.simulationTeams.modelUsage() }
  }
  let selectedOperationId: SimulationOperationId | undefined
  const hold = async (witness: unknown = null) => {
    const inspected = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({ provider: selection.provider,
      spec: selection.spec, includeRecords: true }))
    assert.ok(inspected)
    await writeFile(prefixPath, JSON.stringify({ stage, scene, core: core(inspected.snapshot), actual: await actual(),
      journal: await journal(), selectedOperationId, witness, modelCalls: requests.length }))
    await writeFile(resolve(root, 'fault-model-inputs.json'), JSON.stringify(requests))
    process.send?.({ event: 'actor-fault-durable', stage, scene, modelCalls: requests.length })
    await new Promise<void>((done) => { process.once('message', () => { done() }) })
  }
  if (!recovering) {
    for (const [id, resourceOwner, kind, quantity] of [['supplier-stock', subject, 'inventory', '7'],
      ['supplier-money', subject, 'money', '999'], ['buyer-money', scope, 'money', '1000']] as const) {
      await run.createResource(simulationResourceSpecSchema.parse({ id, owner: resourceOwner, kind, unit: 'widget', quantity,
        controllers: [] }), run.snapshot().revision)
    }
    await run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'private-buyer-floor', version: '1',
      schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, subject: scope, scope, payload: { body: 'PRIVATE-BUYER-FLOOR' },
      effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'actors', entityIds: [requesterId] },
      supersedes: null, sources: [{ kind: 'run-event', runId: selection.spec.runId, sequence: run.snapshot().world!.sequence }] }))
    const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream, append = stream.append.bind(stream)
    const shape = (value: unknown): { kind: string; change?: Record<string, unknown> } => {
      assert.ok(value !== null && typeof value === 'object')
      const record = value as Record<string, unknown>
      assert.equal(typeof record.kind, 'string')
      if (record.change === undefined) return { kind: record.kind as string }
      assert.ok(record.change !== null && typeof record.change === 'object')
      return { kind: record.kind as string, change: record.change as Record<string, unknown> }
    }
    stream.append = async (...args) => {
      const entries = args[1].map(shape), rep = representative()
      const selectedKind = stage.includes('reserve') ? 'external/reserved' : stage.includes('preparing') ? 'external/preparing' : 'external/committed'
      const matches = stage.startsWith('actor-') && (stage === 'actor-participant-unconfirmed'
        ? entries.some(value => value.kind === 'run/writer' && value.change?.kind === 'entity/bound'
          && value.change.entityId === rep?.identities.entityId)
        : entries.some(value => value.kind === 'run/external-representative' && value.change?.kind === selectedKind))
      if (matches && (stage.endsWith('before') || stage.endsWith('unconfirmed'))) await hold({ proposedValues: args[1] })
      const receipt = await append(...args)
      if (matches && stage.endsWith('after')) await hold({ proposedValues: args[1], appendReceipt: receipt })
      return receipt
    }
    const confirm = run.confirmChannel.bind(run)
    run.confirmChannel = async (...args) => {
      const rep = representative(), index = stage.startsWith('director') ? 0 : 1
      if (stage.endsWith('channel-unconfirmed') && rep?.identities.channels[index]?.channelId === args[1]) await hold({ confirmRequest: args })
      return await confirm(...args)
    }
    const targetPost = ctx.teams.postChannelEnvelope.bind(ctx.teams)
    ctx.teams.postChannelEnvelope = async (...args) => {
      assert.ok(args[0].idempotencyKey)
      const selectedKey: unknown = JSON.parse(args[0].idempotencyKey)
      assert.ok(Array.isArray(selectedKey) && selectedKey.every(value => typeof value === 'string'))
      const [source, selectedRunId, id] = selectedKey
      assert.equal(source, 'simulation')
      assert.equal(selectedRunId, selection.spec.runId)
      const operationId = simulationOperationIdSchema.parse(id), operation = run.snapshot().operations[operationId]
      if (stage === 'result-notice-before-post' && role(operation) === 'contact') {
        selectedOperationId = operationId; await hold({ idempotencyKey: args[0].idempotencyKey, draft: args[0].draft })
      }
      const result = await targetPost(...args)
      if (stage === `${role(operation)}-post-lost`) {
        selectedOperationId = operationId
        throw new Error('Canonical Target accepted the original Envelope but its receipt was lost')
      }
      return result
    }
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    ctx.sessions.flush = async (...args) => {
      const flushed = await flush(...args)
      const selected = stage.startsWith('contact') ? 'contact' : 'reply', operation = operationFor(selected)
      if (stage.endsWith('session-before-ack') && operation?.action.kind === 'communication/post'
        && operation.result?.status === 'applied' && operation.delivery === undefined && operation.outbox?.receipt !== undefined
        && args[0].id === run.snapshot().entities[operation.action.recipient]?.binding?.sessionId) {
        const expected = renderDirectV4EnvelopeInput({ id: operation.outbox.receipt.envelopeId, teamId: team.teamId,
          channelId: operation.outbox.receipt.channelId, senderId: run.snapshot().entities[operation.entityId]!.binding!.participantId,
          delivery: 'context', payload: { content: [{ type: 'text', text: operation.action.text }] } })
        const stored = await ctx.sessionPersistence.readFrom(args[0].id, 0)
        if (stored.events.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(value => value.id === expected.id))) {
          assert.equal(flushed, true)
          selectedOperationId = operation.id; await hold({ expected, actualFlush: flushed })
        }
      }
      return flushed
    }
    const ack = ctx.teams.ackChannelEnvelope.bind(ctx.teams)
    ctx.teams.ackChannelEnvelope = async (...args) => {
      const receipt = await ack(...args), selected = stage.startsWith('contact') ? 'contact' : 'reply', operation = operationFor(selected)
      if (stage.endsWith('ack-after') && operation?.outbox?.receipt?.envelopeId === args[0].envelopeId) {
        selectedOperationId = operation.id; await hold({ actualReceipt: receipt })
      }
      return receipt
    }
    await run.setPhase('running', run.snapshot().revision)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'actor-fault-goal', entityId: requesterId, time: '1',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'first/vendor/widget' })) }), run.snapshot().revision)
    let driven = await driver.advance()
    for (let round = 0; round < 8 && driven.reason === 'work-limit'; round++) driven = await driver.advance()
    if (stage.endsWith('post-lost')) {
      assert.equal(driven.reason, 'outcome-unknown')
      assert.equal(run.snapshot().operations[selectedOperationId!]!.status, 'outcome-unknown')
      await hold({ actualAcceptedLostReceipt: true })
    }
    throw new Error(`Original fault boundary was not reached: ${stage}`)
  }
  const prefix = JSON.parse(await readFile(prefixPath, 'utf8')) as { core: ReturnType<typeof core>
    actual: Awaited<ReturnType<typeof actual>>
    selectedOperationId?: SimulationOperationId }
  for (const key of ['world', 'resources', 'grants', 'relations', 'commitments'] as const) assert.deepEqual(normalize(core()[key]), prefix.core[key])
  for (const entity of Object.values(run.snapshot().entities)) {
    const previous = prefix.core.entities[entity.id]!
    assert.deepEqual(entity.binding, previous.binding)
    assert.deepEqual(entity.profile, previous.profile)
    assert.equal(entity.readiness, previous.readiness)
    assert.ok(entity.writer === undefined || entity.writer.phase === 'released')
  }
  const before = { core: core(), actual: await actual(), journal: await journal() }
  const recoverySteps: unknown[] = []
  if (finalCold) {
    if (stage.startsWith('actor-') || stage.endsWith('channel-unconfirmed')) {
      const originalRep = representative()
      if (originalRep !== undefined) {
        await driver.reconcile()
        const completed = representative()!
        assert.equal(completed.status, 'committed')
        assert.deepEqual(completed.identities, originalRep.identities)
        assert.equal(activeSimulationMaintenance(run.snapshot()), undefined)
        const revision = run.snapshot().revision
        await run.commitExternalRepresentative(completed.id)
        assert.equal(run.snapshot().revision, revision)
      } else {
        assert.equal(stage, 'actor-reserve-before')
        assert.equal(Object.keys(run.snapshot().world!.results).length, 0)
        const accepted = Object.values(run.snapshot().world!.plans).filter(value => value.status === 'accepted')
        assert.equal(accepted.length, 1)
        const plan = accepted[0]!
        assert.equal(plan.proposal.resolution.kind, 'apply')
        assert.ok(run.snapshot().world!.executions[plan.id], 'The admitted callback was durable before reservation')
        const execute = adapter.execute.bind(adapter), reconcile = adapter.reconcile.bind(adapter)
        let callbacks = 0
        adapter.execute = async (...args) => { callbacks += 1; return execute(...args) }
        adapter.reconcile = async (...args) => { callbacks += 1; await reconcile(...args) }
        try {
          // Reconciliation settles the original admitted callback even though no representative IO began.
          const observed = await driver.reconcile()
          assert.equal(observed.reason, 'paused')
          assert.equal(observed.controlSteps, 1)
          assert.equal(run.snapshot().world!.executions[plan.id]?.phase, 'settled')
          assert.equal(Object.keys(run.snapshot().world!.results).length, 0)
          assert.equal(callbacks, 0)
          assert.equal(requests.length, 0)
        } finally { adapter.execute = execute; adapter.reconcile = reconcile }
        assert.equal(await adapter.execute(plan), undefined)
        const completed = representative()!
        assert.equal(completed.status, 'committed')
        assert.equal(completed.identityId, Object.keys(prefix.core.world!.external.identities)[0])
        assert.equal(Object.keys(run.snapshot().world!.external.representatives).length, 1)
        assert.equal(Object.keys(run.snapshot().world!.results).length, 1)
        assert.equal(activeSimulationMaintenance(run.snapshot()), undefined)
        const revision = run.snapshot().revision
        assert.deepEqual(await run.reserveExternalRepresentative(completed.request), completed)
        await run.commitExternalRepresentative(completed.id)
        assert.equal(await adapter.execute(plan), undefined)
        assert.equal(run.snapshot().revision, revision)
        recoverySteps.push({ kind: 'explicit-original-accepted-finite-plan-execution', planId: plan.id,
          provisionalUnappendedIdentitiesNotHistorical: true, canonicalIdentities: completed.identities })
      }
      recoverySteps.push({ kind: 'original-execution-reconcile', newInference: false })
    } else {
      const id = prefix.selectedOperationId!
      assert.ok(id)
      let operation = run.snapshot().operations[id]!
      if (stage.endsWith('post-lost') || stage === 'result-notice-before-post') {
        if (operation.status !== 'outcome-unknown') {
          await run.setPhase('running', run.snapshot().revision)
          recoverySteps.push({ kind: 'explicit-technical-running', automaticAdvance: false })
          assert.equal((await connection.dispatchOperation(id, Date.now)).status, 'outcome-unknown')
          operation = run.snapshot().operations[id]!
        }
        const grant = await run.retryOutbox(simulationOutboxRetryRequestSchema.parse({ id: 'exact-original-envelope-retry',
          operationId: id, expectedAttemptCount: operation.outbox!.attempts.length,
          authorizedAt: Date.now(), reason: 'Explicit recovery of the original exact canonical Envelope key' }))
        if (run.snapshot().phase !== 'running') {
          await run.setPhase('running', run.snapshot().revision)
          recoverySteps.push({ kind: 'explicit-technical-running', automaticAdvance: false })
        }
        assert.equal((await connection.dispatchOperation(id, Date.now)).status, 'settled')
        await run.setPhase('paused', run.snapshot().revision)
        recoverySteps.push({ kind: 'explicit-original-retry-allowance', grant, after: run.snapshot().operations[id] })
      } else if (stage.endsWith('ack-after')) {
        const receipt = operation.outbox!.receipt!
        const records = (await ctx.teams.readChannelPage({ channelId: receipt.channelId, afterCursor: -1, limit: 128 })).records
        const target = records.find(value => value.type === 'channel/receipt' && value.envelopeId === receipt.envelopeId
          && value.participantId === run.snapshot().entities[operation.action.kind === 'communication/post' ? operation.action.recipient : requesterId]!.binding!.participantId)
        assert.ok(target?.type === 'channel/receipt')
        await run.confirmDelivery(id, target, run.snapshot().revision)
        recoverySteps.push({ kind: 'actual-canonical-receipt-readback', target, noActivationRequired: true })
      } else {
        assert.equal(stage.endsWith('session-before-ack'), true)
        assert.equal(operation.action.kind, 'communication/post')
        if (operation.action.kind !== 'communication/post') throw new Error('Original Session input requires its published communication')
        const recipientId = operation.action.recipient, runtime = resolved.generatedActorRuntime
        const start = await actual()
        const resident = await connection.ensureResident(recipientId, { activation: { provider: runtime.provider,
          seed: { kind: 'resume' }, agent: { preset: runtime.preset, options: { provider: runtime.model.provider, model: runtime.model.name } },
          signal: lifetime }, evict: [] })
        assert.equal(resident.status, 'resident')
        const charged = await actual()
        await connection.receiveOperation(id)
        const received = await actual()
        await connection.hibernate(recipientId)
        const released = await actual()
        assert.equal(run.snapshot().entities[recipientId]!.writer?.phase, 'released')
        recoverySteps.push({ kind: 'real-resident-receive-and-confirmed-hibernate', recipientId, start, charged, received, released })
      }
    }
  }
  const final = { stage, scene, phase: run.snapshot().phase, core: core(), actual: await actual(), journal: await journal(),
    before, recoverySteps, modelCalls: requests.length }
  assert.equal(requests.length, 0)
  assert.equal(run.snapshot().phase, 'paused')
  assert.deepEqual(run.snapshot().resources, prefix.core.resources)
  assert.deepEqual(run.snapshot().commitments, prefix.core.commitments)
  const rep = representative()
  if (rep !== undefined) {
    for (const source of final.actual.sessions.filter(value => value.entityId === rep.identities.entityId)) {
      for (const privateText of ['PRIVATE-BUYER-FLOOR', 'PRIVATE-DIRECTOR-REPRESENTATIVE-RATIONALE'])
        assert.equal(JSON.stringify(source.stored).includes(privateText), false)
    }
  }
  for (const originalChannel of prefix.actual.channels) {
    const current = final.actual.channels.find(value => value.channelId === originalChannel.channelId)!
    assert.deepEqual(current.records.slice(0, originalChannel.records.length), originalChannel.records)
  }
  for (const originalSession of prefix.actual.sessions) {
    if (originalSession.stored === null) continue
    const current = final.actual.sessions.find(value => value.entityId === originalSession.entityId)!
    assert.ok(current.stored)
    assert.equal(current.stored.meta.id, originalSession.stored.meta.id)
    assert.deepEqual(current.stored.events.slice(0, originalSession.stored.events.length), originalSession.stored.events)
  }
  await writeFile(resolve(root, `fault-cold-${finalCold ? 2 : 1}.json`), JSON.stringify(final))
  console.log(JSON.stringify({ stage, scene, phase: 'paused', modelCalls: 0, originalIdentities: true,
    originalResources: true, originalCanonicalPrefixes: true, finalCold, recoverySteps: recoverySteps.length }))
} catch (cause) {
  await writeFile(resolve(root, 'fault-failure.json'), JSON.stringify({ core: core(), requests, failures }))
  throw cause
} finally { await run.close(); await ctx.fiber.dispose() }
