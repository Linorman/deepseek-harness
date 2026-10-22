/** Two real concurrent callers retain one external actor and separate private buyer Channels across cold processes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_ACTOR_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldFactRequestSchema, WORLD_FACT_TEXT_SCHEMA_REF,
  simulationDecisionIdSchema, checkpointWorldState, simulationWorldHirePlanPayloadSchema,
  simulationWorldDomainRequestSchema, simulationWindowIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution } from '@clocky/clocky-simulation-world'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import type { ChannelEnvelopeRecord } from '@clocky/clocky-team'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests, concurrency } from './world-external-shared-model.ts'

const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
assert.ok(['company', 'laboratory'].includes(scene))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-shared-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const requesterId = simulationEntityIdSchema.parse(requester.entityId)
const secondBuyer = original.actors.find(value => value.role === 'member' && value.entityId !== requesterId)!
assert.ok(secondBuyer)
const buyerIds = [requesterId, simulationEntityIdSchema.parse(secondBuyer.entityId)]
const scope = original.world.organizationEntityId, subject = simulationEntityIdSchema.parse('external-supplier')
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  operations: [...original.world.operations, WORLD_EXTERNAL_ACTOR_PIN],
  operationGrants: [...original.world.operationGrants, ...buyerIds.map((buyer, index) => ({ requesterEntityId: buyer,
    domain: 'external', operation: 'interact', version: '2', scopeEntityId: scope, targetEntityId: subject,
    relationId: `external-permission-${index}`, relation: 'can-interact' }))] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready',
    profile: { name: 'Independent Supplier', description: 'An external simulated supplier represented by its own actor.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    { relation: 'represents', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'second-buyer-assignment', subject: secondBuyer.entityId,
    relation: 'assignment', object: original.relations.find(value => value.relation === 'assignment' && value.subject === requesterId)!.object,
    scope, validFrom: '0', validUntil: null }, ...buyerIds.map((buyer, index) => ({ kind: 'relation/create' as const, id: `external-permission-${index}`, subject: buyer,
    relation: 'can-interact', object: subject, scope, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const ctx = await boot('world-external-shared', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `external-shared-${scene}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('external-shared-complete'), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const root = process.env.SIMULATION_COMPANY_ROOT!, proofPath = resolve(root, 'external-shared-original.json')
try {
  const inputPath = resolve(root, 'external-shared-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(inputPath, 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `external-shared/${scene}`, checkpoint: { id: simulationCheckpointIdSchema.parse('external-shared-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
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
    }, [new ExternalActorWorldExecution(run, connection, resolved, anchor, lifetime)]))
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  let concurrentReservationHeld = recovering
  if (!recovering) {
    for (const [id, owner, kind, quantity] of [['supplier-stock', subject, 'inventory', '7'],
      ['supplier-money', subject, 'money', '999'], ['buyer-money', scope, 'money', '1000']] as const) {
      await run.createResource(simulationResourceSpecSchema.parse({ id, owner, kind, unit: 'widget', quantity, controllers: [] }), run.snapshot().revision)
    }
    await run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'private-buyer-floor', version: '1',
      schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, subject: scope, scope, payload: { body: 'PRIVATE-BUYER-FLOOR' },
      effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'actors', entityIds: [requester.entityId] },
      supersedes: null, sources: [{ kind: 'run-event', runId: selection.spec.runId, sequence: run.snapshot().world!.sequence }] }))
    const baseline = { resources: run.snapshot().resources, commitments: run.snapshot().commitments,
      assignments: Object.values(run.snapshot().relations).filter(value => value.relation === 'assignment'),
      subject: run.snapshot().entities[subject] }
    const runtime = resolved.generatedActorRuntime
    const residency = (entityId: typeof requesterId) => ({ activation: { provider: runtime.provider,
      seed: { kind: run.snapshot().entities[entityId]?.writer === undefined ? 'fresh' as const : 'resume' as const },
      agent: { preset: runtime.preset, options: { provider: runtime.model.provider, model: runtime.model.name } }, signal: lifetime },
    evict: Object.values(run.snapshot().entities).filter(value => value.id !== entityId && value.cognition === 'agent').map(value => value.id) })
    const context = (entityId: typeof requesterId, key: string, purpose: 'goal' | 'resolve', goal?: string,
      requestId?: import('@clocky/clocky-simulation').WorldRequestId) => ({ personaVersion: 'world/1', modelVersion: runtime.model.version,
      sources: [], world: purpose === 'goal' ? { kind: 'goal' as const } : { kind: 'resolve' as const, requestId: requestId! },
      sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind: kind as 'identity' | 'authority' | 'input' | 'goals' | 'commitments',
        required: true, blocks: [{ type: 'text' as const, text: JSON.stringify(kind === 'goals'
          ? { kind: 'world-driver', entityId, contextKey: key, purpose }
          : kind === 'input' && goal !== undefined ? { kind: 'world-goal', version: 1, goal } : {}) }] })) })
    for (const buyer of buyerIds) assert.equal((await connection.ensureResident(buyer, residency(buyer))).status, 'resident')
    await run.setPhase('running', run.snapshot().revision)
    const decisions = buyerIds.map((buyer, index) => ({ id: simulationDecisionIdSchema.parse(`shared-goal-${index}`), entityId: buyer,
      context: context(buyer, `shared-goal-${index}`, 'goal', `buyer-${index}/vendor/BUYER-${index}-WIDGET`) }))
    const windowId = simulationWindowIdSchema.parse('shared-concurrent-callers')
    await connection.openWindow({ id: windowId, decisions })
    await Promise.all(decisions.map(value => connection.executeDecision(value.entityId, value.id, value.context)))
    await run.commitWindow(windowId)
    assert.equal(concurrency.maximum, 2)
    const firstRequests = Object.values(run.snapshot().world!.requests)
    assert.equal(firstRequests.length, 2)
    assert.equal((await connection.ensureResident(world.directorEntityId, residency(world.directorEntityId))).status, 'resident')
    const receivedWakes = []
    for (const request of firstRequests) {
      await run.drive({ until: simTimeSchema.parse(run.snapshot().time) })
      assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
      await connection.dispatchOperation(request.notificationOperationId, Date.now)
      receivedWakes.push(await connection.receiveOperation(request.notificationOperationId))
    }
    for (const [index, request] of firstRequests.entries()) {
      await run.drive({ until: simTimeSchema.parse(run.snapshot().time) })
      await connection.executeDecision(world.directorEntityId, simulationDecisionIdSchema.parse(`shared-plan-${index}`),
        context(world.directorEntityId, `shared-plan-${index}`, 'resolve', undefined, request.id), receivedWakes[index])
    }
    const createPlans = Object.values(run.snapshot().world!.plans)
    assert.equal(createPlans.length, 2)
    assert.ok(createPlans.every(value => value.status === 'accepted'))
    const originalReserve = run.reserveExternalRepresentative.bind(run)
    let firstReserved: (() => void) | undefined, releaseReserved: (() => void) | undefined
    const reservationObserved = new Promise<void>((resolve) => { firstReserved = resolve })
    const reservationBarrier = new Promise<void>((resolve) => { releaseReserved = resolve })
    run.reserveExternalRepresentative = async (...args) => {
      const reserved = await originalReserve(...args)
      firstReserved!()
      await reservationBarrier
      return reserved
    }
    const running = driver.advance()
    await Promise.race([reservationObserved, running.then(() => { throw new Error('Shared Driver ended before the actual reservation barrier') })])
    try {
      const held = Object.values(run.snapshot().world!.external.representatives)[0]!
      assert.equal(held.status, 'reserved')
      assert.equal(run.snapshot().phase, 'running')
      assert.equal(run.snapshot().entities[held.identities.entityId], undefined)
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(held.identities.binding.sessionId), true)
      assert.equal(ctx.agents.get(held.identities.binding.sessionId), undefined)
      const stale = createPlans.find(value => value.id !== held.request.planId)!
      const adapter = new ExternalActorWorldExecution(run, connection, resolved, anchor, lifetime)
      assert.equal(await adapter.execute(stale), 'plan-stale')
      assert.equal(run.snapshot().world!.plans[stale.id]?.status, 'stale')
      await connection.executeDecision(world.directorEntityId, simulationDecisionIdSchema.parse('shared-replan'),
        context(world.directorEntityId, 'shared-replan', 'resolve', undefined, stale.requestId))
      const reuse = run.snapshot().world!.plans[run.snapshot().world!.requests[stale.requestId]!.plans.at(-1)!]!
      assert.equal(reuse.status, 'accepted')
      assert.equal(reuse.proposal.supersedes, stale.id)
      assert.equal(reuse.proposal.resolution.kind, 'apply')
      if (reuse.proposal.resolution.kind !== 'apply') throw new Error('Pending reuse lost its actual accepted plan')
      assert.deepEqual(reuse.proposal.resolution.payload, { kind: 'reuse', identityId: held.identityId, generation: 1 })
      assert.equal(run.snapshot().world!.external.representatives[held.id]?.status, 'reserved')
      const pendingPrefix = run.snapshot(), pendingCalls = requests.length
      assert.equal(adapter.readiness(reuse), 'maintenance-blocked')
      await assert.rejects(run.reserveExternalContact(reuse.id), { code: 'SIM_WORLD_LIMIT', failure: { code: 'SIM_WORLD_LIMIT', limit: 'mutations' } })
      assert.deepEqual(run.snapshot(), pendingPrefix)
      assert.equal(requests.length, pendingCalls)
      assert.equal(run.snapshot().world!.external.contacts[run.snapshot().world!.requests[reuse.requestId]!.intentId], undefined)
      await writeFile(resolve(root, 'external-shared-held.json'), JSON.stringify({ phase: run.snapshot().phase,
        pendingReuseReadiness: adapter.readiness(reuse), concurrency, callers: decisions, window: run.snapshot().windows?.[windowId],
        acceptedDecisions: run.snapshot().decisions, external: run.snapshot().world!.external,
        plans: run.snapshot().world!.plans, requests: run.snapshot().world!.requests, modelInputs: requests }))
      concurrentReservationHeld = true
    } finally { releaseReserved!(); run.reserveExternalRepresentative = originalReserve; await driver.drain() }
    let driven = await running
    for (let round = 0; round < 16 && ['work-limit', 'plan-stale'].includes(driven.reason); round++) driven = await driver.advance()
    assert.equal(driven.reason, 'idle', JSON.stringify({ driven, failures }))
    assert.equal(Object.keys(run.snapshot().world!.results).length, 2)
    const wake = simulationWakeRequestSchema.parse({ id: 'external-shared-repeat', entityId: requesterId,
      time: String(BigInt(run.snapshot().time) + 1n),
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'buyer-repeat/vendor/BUYER-0-REPEAT' })) })
    await run.scheduleWake(wake, run.snapshot().revision)
    driven = await driver.advance()
    for (let round = 0; round < 16 && ['work-limit', 'plan-stale'].includes(driven.reason); round++) driven = await driver.advance()
    assert.equal(driven.reason, 'idle', JSON.stringify({ driven, failures }))
    assert.equal(failures.length, 0, failures.join('\n'))
    assert.equal(concurrentReservationHeld, true)
    assert.deepEqual(run.snapshot().resources, baseline.resources)
    assert.deepEqual(run.snapshot().commitments, baseline.commitments)
    assert.deepEqual(Object.values(run.snapshot().relations).filter(value => value.relation === 'assignment'), baseline.assignments)
    assert.deepEqual(run.snapshot().entities[subject], baseline.subject)
  }
  const state = run.snapshot(), owned = state.world!, representatives = Object.values(owned.external.representatives)
  assert.equal(representatives.length, 1)
  assert.equal(Object.keys(owned.external.identities).length, 1)
  const representative = representatives[0]!, entity = state.entities[representative.identities.entityId]!
  assert.equal(representative.status, 'committed')
  const identity = owned.external.identities[representative.identityId]!
  assert.equal(identity.subjectRef, subject)
  assert.equal(identity.source.kind, 'request')
  if (identity.source.kind !== 'request') throw new Error('Original shared external identity lost its actual request source')
  assert.equal(identity.source.requestId, representative.requestId)
  assert.equal(identity.representation, 'simulated-actor')
  assert.equal(identity.revision, 1)
  assert.equal(entity.cognition, 'agent'); assert.equal(entity.readiness, 'ready')
  assert.deepEqual(entity.binding, representative.identities.binding)
  assert.ok(entity.binding)
  const requesterBinding = state.entities[requesterId]?.binding
  assert.ok(requesterBinding)
  for (const buyer of buyerIds) assert.notEqual(entity.binding.sessionId, state.entities[buyer]!.binding!.sessionId)
  assert.equal(state.relations[representative.identities.relationId]?.relation, 'represents')
  assert.equal(state.relations[representative.identities.relationId]?.object, subject)
  const plan = owned.plans[representative.request.planId]!
  assert.equal(plan.proposal.resolution.kind, 'apply')
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('External actor lost its original accepted Persona')
  assert.deepEqual(entity.profile['persona'], simulationWorldHirePlanPayloadSchema.parse(plan.proposal.resolution.payload).persona)
  const stored = await ctx.sessionPersistence.readFrom(entity.binding.sessionId, 0)
  const contexts = stored.events.filter(event => event.type === 'simulation/context-view')
  assert.ok(contexts.length > 0)
  for (const event of contexts) {
    assert.equal(event.data.entityId, entity.id)
    const identity = event.data.content.find(value => value.kind === 'identity')?.blocks[0]
    assert.ok(identity?.type === 'text')
    assert.deepEqual(JSON.parse(identity.text), { entityId: entity.id, persona: entity.profile,
      organization: { name: state.entities[subject]!.profile['name'], description: state.entities[subject]!.profile['description'] } })
    const background = event.data.content.find(value => value.kind === 'input')?.blocks
      .find(value => value.type === 'text' && value.text.includes('world-background'))
    assert.ok(background?.type === 'text')
    const facts = JSON.parse(background.text) as { worldFacts: { viewer: string; items: unknown[] } }
    assert.equal(facts.worldFacts.viewer, entity.id)
    assert.deepEqual(facts.worldFacts.items, [])
  }
  const channelMessages = stored.events.flatMap(event => event.type === 'user/message' && event.data.source?.kind === 'team-envelope'
    ? [event.data] : [])
  assert.equal(channelMessages.length, 3)
  const contacts = Object.values(owned.external.contacts)
  assert.equal(contacts.length, 3)
  assert.ok(contacts.every(value => value.status === 'committed' && value.identityId === representative.identityId
    && value.representativeIntentId === representative.id && value.generation === 1))
  assert.equal(new Set(contacts.map(value => value.channel.channelId)).size, 2)
  const repeated = contacts.filter(value => value.requesterEntityId === requesterId)
  assert.equal(repeated.length, 2)
  assert.deepEqual(repeated[0]!.channel, repeated[1]!.channel)
  for (const contact of contacts) {
    const channel = await ctx.teams.getChannel({ channelId: contact.channel.channelId })
    assert.deepEqual(channel.manifest.participants.map(value => value.id).sort(),
      [entity.binding.participantId, state.entities[contact.requesterEntityId]!.binding!.participantId].sort())
    const result = Object.values(owned.results).find(value => value.intentId === contact.id)!
    const payload = result.payload as { entityId: string; requesterEntityId: string; channelId: string; unit: string }
    assert.equal(payload.entityId, entity.id)
    assert.equal(payload.requesterEntityId, contact.requesterEntityId)
    assert.equal(payload.channelId, contact.channel.channelId)
    const source = channelMessages.find(value => value.source?.kind === 'team-envelope'
      && value.source.channelId === contact.channel.channelId && JSON.stringify(value).includes(payload.unit))?.source
    assert.equal(source?.kind, 'team-envelope')
    if (source?.kind !== 'team-envelope') throw new Error('Shared contact lacks actual canonical input')
    assert.equal(source.senderId, state.entities[contact.requesterEntityId]!.binding!.participantId)
  }
  for (const [index, buyer] of buyerIds.entries()) {
    const buyerSession = await ctx.sessionPersistence.readFrom(state.entities[buyer]!.binding!.sessionId, 0)
    assert.equal(JSON.stringify(buyerSession.events).includes(`BUYER-${1 - index}-WIDGET`), false)
    assert.equal(requests.some(value => value.entityId === buyer && value.input.includes(`BUYER-${1 - index}-WIDGET`)), false)
  }
  for (const privateText of ['PRIVATE-BUYER-FLOOR', 'PRIVATE-DIRECTOR-REPRESENTATIVE-RATIONALE']) {
    assert.equal(JSON.stringify(stored.events).includes(privateText), false)
    assert.equal(requests.some(value => value.entityId === entity.id && value.input.includes(privateText)), false)
    assert.equal(JSON.stringify(owned.results).includes(privateText), false)
  }
  const posts = Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
  assert.equal(posts.length, 9)
  const replies = posts.filter(value => value.entityId === entity.id)
  assert.equal(replies.length, 3)
  for (const contact of contacts) assert.ok(replies.some(value => value.action.kind === 'communication/post'
    && value.action.channelId === contact.channel.channelId && value.action.recipient === contact.requesterEntityId))
  const canonicalPosts: Array<{ operationId: string; accepted: ChannelEnvelopeRecord; received: unknown }> = []
  for (const post of posts) {
    assert.ok(post.delivery?.receipt)
    assert.ok(post.outbox?.receipt)
    if (post.action.kind !== 'communication/post') throw new Error('Canonical proof requires a communication operation')
    const envelope = post.outbox.receipt, sender = state.entities[post.entityId]!, recipient = state.entities[post.action.recipient]!
    const page = await ctx.teams.readChannelPage({ channelId: envelope.channelId, afterCursor: -1, limit: 32 })
    const accepted = page.records.find(value => value.type === 'channel/envelope' && value.envelope.id === envelope.envelopeId)
    assert.ok(accepted)
    if (accepted.type !== 'channel/envelope') throw new Error('Canonical sender proof requires its actual accepted Channel envelope')
    assert.equal(accepted.envelope.senderId, sender.binding!.participantId)
    assert.equal(accepted.envelope.sequence, envelope.sequence)
    const expected = renderDirectV4EnvelopeInput({ id: envelope.envelopeId, teamId: envelope.teamId, channelId: envelope.channelId,
      senderId: sender.binding!.participantId, delivery: 'context', payload: { content: [{ type: 'text', text: post.action.text }] } })
    assert.ok(recipient.binding)
    const received = await ctx.sessionPersistence.readFrom(recipient.binding.sessionId, 0)
    const matches = received.events.filter(value => value.type === 'user/message' && value.surfaceOp === 'append' && value.data.id === expected.id)
    assert.equal(matches.length, 1)
    assert.deepEqual(matches[0]!.data, expected)
    assert.deepEqual(renderDirectV4EnvelopeInput(accepted.envelope), expected)
    canonicalPosts.push({ operationId: post.id, accepted, received: matches[0] })
  }
  const actualTeam = await ctx.teams.getTeam({ teamId: team.teamId })
  assert.equal(actualTeam.participants.length, original.actors.length + 1)
  assert.equal(actualTeam.channelIds.length, original.channels.length + 3)
  const revision = run.snapshot().revision
  assert.deepEqual(await run.reserveExternalRepresentative(representative.request), representative)
  assert.deepEqual(await run.commitExternalRepresentative(representative.id),
    Object.values(owned.results).find(value => value.intentId === representative.id))
  for (const contact of contacts) {
    assert.deepEqual(await run.reserveExternalContact(contact.planId), contact)
    assert.deepEqual(await run.commitExternalContact(contact.id), Object.values(owned.results).find(value => value.intentId === contact.id))
    assert.equal(run.snapshot().revision, revision)
  }
  assert.equal(run.snapshot().revision, revision)
  const originalRequest = owned.requests[representative.requestId]!
  for (const sender of [subject, entity.id, world.directorEntityId]) {
    await assert.rejects(run.openWorldIntent(requesterId, simulationWorldDomainRequestSchema.parse({ ...originalRequest.proposal,
      businessKey: `forged-sender-${sender}`, payload: { ...originalRequest.proposal.payload as object, sender } })))
    assert.equal(run.snapshot().revision, revision)
  }
  const proof = () => ({ external: run.snapshot().world!.external, results: run.snapshot().world!.results,
    resources: run.snapshot().resources, commitments: run.snapshot().commitments, posts, canonicalPosts,
    plans: run.snapshot().world!.plans, decisions: run.snapshot().decisions, windows: run.snapshot().windows,
    contacts: run.snapshot().world!.external.contacts, representative: run.snapshot().entities[entity.id],
    represents: run.snapshot().relations[representative.identities.relationId] })
  if (!recovering) {
    assert.ok(requests.some(value => value.purpose === 'message' && value.entityId === entity.id))
    assert.ok(requests.some(value => value.entityId === requester.entityId && value.input.includes('PRIVATE-BUYER-FLOOR')))
    assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('external-shared-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
    await writeFile(proofPath, JSON.stringify(proof()))
    await writeFile(resolve(root, 'external-shared-session.json'), JSON.stringify(stored.events))
    await writeFile(resolve(root, 'external-shared-model-inputs.json'), JSON.stringify(requests))
  } else {
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
    assert.deepEqual(proof(), JSON.parse(await readFile(proofPath, 'utf8')))
  }
  const manifest = checkpointWorldState(run.snapshot())!
  assert.equal(manifest.records.filter(value => value.kind === 'external-representative').length, 1)
  assert.equal(manifest.records.filter(value => value.kind === 'external-contact').length, 3)
  console.log(JSON.stringify({ identities: 1, representatives: 1, independentSession: true, canonicalSenders: 9, contacts: 3,
    privateBuyerChannels: 2, concurrentReservationHeld, pendingReuseAccepted: true,
    staleSuperseded: true, sharedSession: true, sameBuyerChannelReused: true, privateInputsExcluded: true,
    resourcesUnchanged: true, assignmentsUnchanged: true,
    originalSubjectPreserved: true, ordinaryReply: true, checkpointComplete: true, modelCalls: requests.length,
    phase: run.snapshot().phase }))
} catch (cause) {
  await writeFile(resolve(root, 'external-shared-failure.json'), JSON.stringify({ failures, requests,
    state: run.snapshot() }))
  throw cause
} finally { await run.close(); await ctx.fiber.dispose() }
