/** Company and laboratory prepare a real independent external actor and exchange canonical private Channel messages. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN, simulationExternalMediatedPlanSchema, simulationEntityIdSchema,
  simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldFactRequestSchema, WORLD_FACT_TEXT_SCHEMA_REF,
  simulationDecisionIdSchema, checkpointWorldState, simulationWorldHirePlanPayloadSchema,
  simulationWorldDomainRequestSchema, simulationExternalMediatedResultSchema, isWorldFactAdjudicated,
  worldFactIdSchema } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import type { ChannelEnvelopeRecord } from '@clocky/clocky-team'
import type { SessionId } from '@clocky/clocky-session'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-external-mediated-actor-model.ts'

const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
assert.ok(['company', 'laboratory'].includes(scene))
const mode = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
assert.ok(['src', 'lib'].includes(mode))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation','@clocky/clocky-simulation-local','@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(mode === 'lib' ? '/lib/' : '/src/'), path)
if (mode === 'lib') {
  assert.equal(process.execArgv.some(value => value === '--import' || value.startsWith('--import=')), false)
  assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false)
}
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-mediated-actor-scripted', name: 'scripted', version: '1',
  available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const requesterId = simulationEntityIdSchema.parse(requester.entityId)
const custodian = original.actors.find(value => value.role === 'member' && value.entityId !== requester.entityId)!
assert.ok(custodian)
const custodianId = simulationEntityIdSchema.parse(custodian.entityId)
const scope = original.world.organizationEntityId, subject = simulationEntityIdSchema.parse('external-supplier')
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  limits: { ...original.world.limits, maxBytesPerPlan: 16384 },
  externalAdjudicationPolicy: { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
    conditionInstalls: ['weather','lead-time','meeting-status'], futureConditionInstalls: ['weather'],
    allowedOutcomeKinds: ['environmental-fact','delayed-event','failure','representative-preparation-plan','unverified-report'],
    maxDelay: '20', allowPublicDisclosure: false, allowScopeDisclosure: false, actorDisclosure: [] },
  operations: [...original.world.operations, WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN],
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId,
    domain: 'external', operation: 'interact', version: '2', scopeEntityId: scope, targetEntityId: subject,
    relationId: 'external-permission', relation: 'can-interact' }, { requesterEntityId: requester.entityId, domain: 'external',
    operation: 'interact',
    version: '3', scopeEntityId: scope, targetEntityId: subject, relationId: 'external-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none', readiness: 'ready',
    profile: { name: 'Independent Supplier', description: 'An external simulated supplier represented by its own actor.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules,
    { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
    { relation: 'represents', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'external-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const ctx = await boot('world-external-mediated-actor', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `external-mediated-actor-${scene}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse('external-mediated-actor-complete'), implementationVersion: 'world/1',
  maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const root = process.env.SIMULATION_COMPANY_ROOT!, proofPath = resolve(root, 'external-mediated-actor-original.json')
try {
  const inputPath = resolve(root, 'external-mediated-actor-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(inputPath, 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `external-mediated-actor/${scene}`, checkpoint: { id: simulationCheckpointIdSchema.parse('external-mediated-actor-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
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
    }, [new ExternalActorWorldExecution(run, connection, resolved, anchor, lifetime),
      new ExternalMediatedWorldExecution(run, connection, resolved, anchor, lifetime)]))
  assert.equal((await driver.advance()).reason, 'paused')
  assert.equal(requests.length, 0)
  let preparingDenied = recovering
  if (!recovering) {
    for (const [id, owner, kind, quantity] of [['supplier-stock', subject, 'inventory', '7'],
      ['supplier-money', subject, 'money', '999'], ['buyer-money', scope, 'money', '1000'], ['buyer-stock', scope, 'inventory',
        '0']] as const) {
      await run.createResource(simulationResourceSpecSchema.parse({ id, owner, kind, unit: 'widget', quantity,
        controllers: id === 'supplier-stock' ? [custodian.entityId] : [] }), run.snapshot().revision)
    }
    await run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'private-buyer-floor', version: '1',
      schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, subject: scope, scope, payload: { body: 'PRIVATE-BUYER-FLOOR' },
      effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'actors', entityIds: [requester.entityId] },
      supersedes: null, sources: [{ kind: 'run-event', runId: selection.spec.runId, sequence: run.snapshot().world!.sequence }] }))
    const runtime = resolved.generatedActorRuntime
    const residency = (entityId: typeof requesterId) => ({ activation: { provider: runtime.provider,
      seed: { kind: run.snapshot().entities[entityId]?.writer === undefined ? 'fresh' as const : 'resume' as const },
      agent: { preset: runtime.preset, options: { provider: runtime.model.provider, model: runtime.model.name } }, signal: lifetime },
    evict: Object.values(run.snapshot().entities).filter(value => value.id !== entityId
      && value.cognition === 'agent').map(value => value.id) })
    const context = (entityId: typeof requesterId, key: string,
      purpose: 'goal' | 'resolve' | 'contract-propose' | 'contract-accept', goal?: string,
      requestId?: import('@clocky/clocky-simulation').WorldRequestId) => ({ personaVersion: 'world/1', modelVersion: runtime.model.version,
      sources: [], ...purpose === 'goal' ? { world: { kind: 'goal' as const } }
        : purpose === 'resolve' ? { world: { kind: 'resolve' as const, requestId: requestId! } } : {},
      sections: ['identity', 'authority', 'input', 'goals',
        'commitments'].map(kind => ({ kind: kind as 'identity' | 'authority' | 'input' | 'goals' | 'commitments',
        required: true, blocks: [{ type: 'text' as const, text: JSON.stringify(kind === 'goals'
          ? { kind: 'world-driver', entityId, contextKey: key, purpose }
          : kind === 'input' && goal !== undefined ? (purpose.startsWith('contract-') ? JSON.parse(goal) as unknown
            : { kind: 'world-goal', version: 1, goal }) : {}) }] })) })
    const terms = { kind: 'supplier-contract', id: 'original-supplier-stock-order', custodian: custodian.entityId,
      description: 'The original supplier-stock custodian undertakes to deliver two widgets from the external supplier account to the buyer account.',
      fulfillment: { kind: 'transfer', from: 'supplier-stock', to: 'buyer-stock', quantity: '2' } }
    assert.equal((await connection.ensureResident(requesterId, residency(requesterId))).status, 'resident')
    assert.equal((await connection.ensureResident(custodianId, residency(custodianId))).status, 'resident')
    await run.setPhase('running', run.snapshot().revision)
    await connection.executeDecision(requesterId, simulationDecisionIdSchema.parse('contract-proposal'),
      context(requesterId, 'contract-proposal', 'contract-propose', JSON.stringify(terms)))
    const proposal = run.snapshot().decisions[simulationDecisionIdSchema.parse('contract-proposal')]!
    assert.equal(proposal.status, 'accepted')
    const proposeOperation = proposal.operationIds[0]!
    assert.equal((await run.executeOperation(proposeOperation)).status, 'applied')
    const interaction = run.snapshot().interactions[terms.id as import('@clocky/clocky-simulation').SimulationInteractionId]!
    assert.equal(interaction.requester, requesterId)
    assert.equal(interaction.assignee, custodian.entityId)
    assert.equal(interaction.reply, 'pending')
    await connection.executeDecision(custodianId, simulationDecisionIdSchema.parse('contract-acceptance'),
      context(custodianId, 'contract-acceptance', 'contract-accept', JSON.stringify({ ...terms, revision: interaction.revision })))
    const acceptance = run.snapshot().decisions[simulationDecisionIdSchema.parse('contract-acceptance')]!
    assert.equal(acceptance.status, 'accepted')
    const acceptOperation = acceptance.operationIds[0]!
    assert.equal((await run.executeOperation(acceptOperation)).status, 'applied')
    const contractBaseline = { resources: run.snapshot().resources, commitments: run.snapshot().commitments,
      interactions: run.snapshot().interactions, operations: [run.snapshot().operations[proposeOperation],
        run.snapshot().operations[acceptOperation]],
      sessions: await Promise.all([requesterId, custodianId].map(async (entityId) => {
        const binding = run.snapshot().entities[entityId]!.binding!
        return { entityId, binding, events: (await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events }
      })) }
    assert.equal(Object.keys(contractBaseline.commitments).length, 1)
    await writeFile(resolve(root, 'external-mediated-actor-contract-baseline.json'), JSON.stringify(contractBaseline))
    const baseline = { resources: run.snapshot().resources, commitments: run.snapshot().commitments,
      assignments: Object.values(run.snapshot().relations).filter(value => value.relation === 'assignment'),
      subject: run.snapshot().entities[subject] }
    const ensure = connection.ensureParticipant.bind(connection)
    connection.ensureParticipant = async (...args) => {
      const binding = await ensure(...args)
      const representative = Object.values(run.snapshot().world!.external.representatives)
        .find(value => value.identities.entityId === args[0])
      if (representative !== undefined && representative.status === 'preparing') {
        const state = run.snapshot(), count = requests.length
        const placement = { provider: 'in-process', agent: { preset: resolved.generatedActorRuntime.preset,
          options: { provider: 'world-external-mediated-actor-scripted', model: 'scripted' } }, signal: lifetime }
        assert.equal(state.entities[args[0]]?.readiness, 'preparing')
        await assert.rejects(connection.activate(args[0], { ...placement, seed: { kind: 'fresh' } }), /ready entity/)
        await assert.rejects(ctx.teamActivations.activate({ ...placement, ...binding, seed: { kind: 'fresh' },
          expectedCursor: (await ctx.teams.getTeam({ teamId: binding.teamId })).team.cursor }), { code: 'SIM_MAINTENANCE_ACTIVE' })
        await assert.rejects(run.queueDecision({ id: simulationDecisionIdSchema.parse('preparing-never-decides'),
          entityId: args[0], priority: 0 }),
        /current|active|eligible|nomination|ready|maintenance/)
        assert.equal(requests.length, count)
        assert.equal(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId), true)
        assert.equal(ctx.agents.get(binding.sessionId), undefined)
        assert.deepEqual(run.snapshot(), state)
        preparingDenied = true
      }
      return binding
    }
    await run.setPhase('running', run.snapshot().revision)
    const wake = simulationWakeRequestSchema.parse({ id: 'external-mediated-actor-goal', entityId: requester.entityId, time: '1',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'mediated/vendor/widget' })) })
    await run.scheduleWake(wake, run.snapshot().revision)
    let driven = await driver.advance()
    for (let round = 0; round < 8 && driven.reason === 'work-limit'; round++) driven = await driver.advance()
    assert.equal(driven.reason, 'idle', JSON.stringify({ driven, failures }))
    assert.equal(failures.length, 0, failures.join('\n'))
    assert.equal(preparingDenied, true)
    const first = Object.values(run.snapshot().world!.external.representatives)[0]!
    const identities = structuredClone(first.identities), firstSource = structuredClone(first.adjudication)
    const firstChannels = (await ctx.teams.getTeam({ teamId: team.teamId })).channelIds
    for (const [index, goal] of ['reuse/vendor/widget', 'commitment/vendor/widget'].entries()) {
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: `mediated-next-${index}`, entityId: requester.entityId, time: String(2 + index),
        reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal })) }), run.snapshot().revision)
      driven = await driver.advance()
      for (let round = 0; round < 8 && driven.reason === 'work-limit'; round++) driven = await driver.advance()
      assert.equal(driven.reason, 'idle', JSON.stringify({ driven, failures }))
      const current = Object.values(run.snapshot().world!.external.representatives)[0]!
      assert.deepEqual(current.identities, identities)
      assert.deepEqual(current.adjudication, firstSource)
      assert.deepEqual((await ctx.teams.getTeam({ teamId: team.teamId })).channelIds, firstChannels)
    }
    assert.equal(Object.keys(run.snapshot().world!.external.contacts).length, 2)
    assert.equal(Object.keys(run.snapshot().world!.external.adjudications).length, 2)
    const commitmentFact = Object.values(run.snapshot().world!.facts).flat().find(value => isWorldFactAdjudicated(value)
      && value.payload.claim.kind === 'commitment-as-of')!
    assert.ok(commitmentFact && isWorldFactAdjudicated(commitmentFact))
    assert.equal(commitmentFact.payload.claim.kind, 'commitment-as-of')
    assert.deepEqual(run.snapshot().commitments, contractBaseline.commitments)
    assert.deepEqual(run.snapshot().interactions, contractBaseline.interactions)
    for (const stored of contractBaseline.sessions) {
      const current = (await ctx.sessionPersistence.readFrom(stored.binding.sessionId, 0)).events
      assert.deepEqual(current.slice(0, stored.events.length), stored.events)
    }

    assert.deepEqual(run.snapshot().resources, baseline.resources)
    assert.deepEqual(run.snapshot().commitments, baseline.commitments)
    assert.deepEqual(Object.values(run.snapshot().relations).filter(value => value.relation === 'assignment'), baseline.assignments)
    assert.deepEqual(run.snapshot().entities[subject], baseline.subject)
  }
  const state = run.snapshot(), owned = state.world!, representatives = Object.values(owned.external.representatives)
  const originalContract = JSON.parse(await readFile(resolve(root, 'external-mediated-actor-contract-baseline.json'), 'utf8')) as {
    resources: typeof state.resources
    commitments: typeof state.commitments
    interactions: typeof state.interactions
    sessions: Array<{ binding: { sessionId: SessionId }; events: unknown[] }>
  }
  assert.equal(Object.keys(originalContract.commitments).length, 1)
  assert.deepEqual(state.resources, originalContract.resources)
  assert.deepEqual(state.commitments, originalContract.commitments)
  assert.deepEqual(state.interactions, originalContract.interactions)
  const actualCustody = Object.values(originalContract.commitments)[0]!
  assert.equal(actualCustody.debtor, custodianId)
  assert.equal(actualCustody.creditor, requesterId)
  const custodyObservation = Object.values(owned.facts).flat().find(value => isWorldFactAdjudicated(value)
    && value.payload.claim.kind === 'commitment-as-of')
  assert.ok(custodyObservation && isWorldFactAdjudicated(custodyObservation))
  assert.deepEqual(custodyObservation.payload.claim, { kind: 'commitment-as-of', commitmentId: actualCustody.id,
    phase: actualCustody.phase })
  for (const session of originalContract.sessions) {
    const current = (await ctx.sessionPersistence.readFrom(session.binding.sessionId, 0)).events
    assert.deepEqual(current.slice(0, session.events.length), session.events)
  }
  assert.equal(representatives.length, 1)
  assert.equal(Object.keys(owned.external.identities).length, 1)
  const representative = representatives[0]!, entity = state.entities[representative.identities.entityId]!
  assert.equal(representative.status, 'committed')
  assert.equal(entity.cognition, 'agent'); assert.equal(entity.readiness, 'ready')
  assert.deepEqual(entity.binding, representative.identities.binding)
  assert.ok(entity.binding)
  const requesterBinding = state.entities[requesterId]?.binding
  assert.ok(requesterBinding)
  assert.notEqual(entity.binding.sessionId, requesterBinding.sessionId)
  assert.equal(state.relations[representative.identities.relationId]?.relation, 'represents')
  assert.equal(state.relations[representative.identities.relationId]?.object, subject)
  const plan = owned.plans[representative.request.planId]!
  assert.equal(plan.proposal.resolution.kind, 'apply')
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('External actor lost its original accepted Persona')
  const selected = simulationExternalMediatedPlanSchema.parse(plan.proposal.resolution.payload)
  assert.equal(selected.outcome.kind, 'representative-preparation-plan')
  if (selected.outcome.kind !== 'representative-preparation-plan') throw new Error('Original mediated Actor source changed')
  assert.deepEqual(entity.profile['persona'], simulationWorldHirePlanPayloadSchema.parse(selected.outcome.preparation).persona)
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
  assert.equal(channelMessages.length, 2)
  const receivedSource = channelMessages[0]!.source
  assert.equal(receivedSource?.kind, 'team-envelope')
  if (receivedSource?.kind !== 'team-envelope') throw new Error('Representative must receive its own new canonical Channel message')
  assert.equal(receivedSource.channelId, representative.identities.channels[1].channelId)
  assert.equal(receivedSource.senderId, requesterBinding.participantId)
  for (const privateText of ['PRIVATE-BUYER-FLOOR', 'PRIVATE-DIRECTOR-REPRESENTATIVE-RATIONALE']) {
    assert.equal(JSON.stringify(stored.events).includes(privateText), false)
    assert.equal(requests.some(value => value.entityId === entity.id && value.input.includes(privateText)), false)
    assert.equal(JSON.stringify(owned.results).includes(privateText), false)
  }
  const posts = Object.values(state.operations).filter(value => value.action.kind === 'communication/post')
  assert.equal(posts.length, 9)
  const replies = posts.filter(value => value.entityId === entity.id)
  assert.equal(replies.length, 2)
  const reply = replies[0]!
  assert.ok(reply)
  if (reply.action.kind !== 'communication/post') throw new Error('External reply must be its own communication')
  assert.equal(reply.action.recipient, requester.entityId)
  assert.equal(reply.action.channelId, representative.identities.channels[1].channelId)
  assert.equal(reply.action.text, 'I represent the supplier. I received your inquiry about widget.')
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
    const matches = received.events.filter(value => value.type === 'user/message' && value.surfaceOp === 'append'
      && value.data.id === expected.id)
    assert.equal(matches.length, 1)
    assert.deepEqual(matches[0]!.data, expected)
    assert.deepEqual(renderDirectV4EnvelopeInput(accepted.envelope), expected)
    canonicalPosts.push({ operationId: post.id, accepted, received: matches[0] })
  }
  const actualTeam = await ctx.teams.getTeam({ teamId: team.teamId })
  assert.equal(actualTeam.participants.length, original.actors.length + 1)
  assert.equal(actualTeam.channelIds.length, original.channels.length + 2)
  const revision = run.snapshot().revision
  assert.deepEqual(await run.reserveExternalRepresentative(representative.request), representative)
  assert.deepEqual(await run.commitExternalRepresentative(representative.id),
    Object.values(owned.results).find(value => value.intentId === representative.id))
  assert.equal(run.snapshot().revision, revision)
  const originalRequest = owned.requests[representative.requestId]!
  for (const sender of [subject, entity.id, world.directorEntityId]) {
    await assert.rejects(run.openWorldIntent(requesterId, simulationWorldDomainRequestSchema.parse({ ...originalRequest.proposal,
      businessKey: `forged-sender-${sender}`, payload: { ...originalRequest.proposal.payload as object, sender } })))
    assert.equal(run.snapshot().revision, revision)
  }
  const proof = () => ({ external: run.snapshot().world!.external, results: run.snapshot().world!.results,
    resources: run.snapshot().resources, commitments: run.snapshot().commitments, interactions: run.snapshot().interactions,
    assignments: Object.values(run.snapshot().relations).filter(value => value.relation === 'assignment'),
    originalSubject: run.snapshot().entities[subject], posts, canonicalPosts,
    representative: run.snapshot().entities[entity.id], represents: run.snapshot().relations[representative.identities.relationId] })
  if (!recovering) {
    assert.ok(requests.some(value => value.purpose === 'message' && value.entityId === entity.id))
    assert.ok(requests.some(value => value.entityId === requester.entityId && value.input.includes('PRIVATE-BUYER-FLOOR')))
    assert.equal((await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('external-mediated-actor-complete'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
    await writeFile(proofPath, JSON.stringify(proof()))
    await writeFile(resolve(root, 'external-mediated-actor-session.json'), JSON.stringify(stored.events))
    await writeFile(resolve(root, 'external-mediated-actor-model-inputs.json'), JSON.stringify(requests))
  } else {
    assert.equal(state.phase, 'paused')
    assert.equal(requests.length, 0)
    assert.deepEqual(proof(), JSON.parse(await readFile(proofPath, 'utf8')))
  }
  const manifest = checkpointWorldState(run.snapshot())!
  assert.equal(manifest.records.filter(value => value.kind === 'external-representative').length, 1)
  assert.equal(Object.values(owned.requests).length, 3)
  assert.equal(Object.keys(owned.external.contacts).length, 2)
  assert.equal(new Set(Object.values(owned.external.contacts).map(value => value.channel.channelId)).size, 1)
  assert.equal(owned.external.identities[representative.identityId]?.representation, 'director-mediated')
  const result = Object.values(owned.results).find(value => value.intentId === representative.id)!
  const safe = simulationExternalMediatedResultSchema.parse(result.payload)
  assert.ok('outcome' in safe && safe.outcome.kind === 'representative-prepared')
  assert.equal(safe.adjudicatorEntityId, world.directorEntityId)
  const observation = Object.values(owned.external.adjudications).find(value => value.proposal.outcome.kind === 'environmental-fact')!
  assert.ok(observation.actualPublication)
  assert.ok(owned.facts[worldFactIdSchema.parse(observation.actualPublication.factId)])
  console.log(JSON.stringify({ identities: 1, representatives: 1, independentSession: true, canonicalSenders: 9,
    preparingDenied, privateInputsExcluded: true, resourcesUnchanged: true, assignmentsUnchanged: true,
    originalSubjectPreserved: true, ordinaryReply: true, checkpointComplete: true, runtimePaths, process: { pid: process.pid,
      args: process.argv, execArgv: process.execArgv }, mediatedActual: true, sameCallerExplicitReuse: true,
    originalCustodyObserved: true, modelCalls: requests.length,
    phase: run.snapshot().phase }))
} catch (cause) {
  await writeFile(resolve(root, 'external-mediated-actor-failure.json'), JSON.stringify({ failures, requests,
    state: run.snapshot() }))
  throw cause
} finally { await run.close(); await ctx.fiber.dispose() }
