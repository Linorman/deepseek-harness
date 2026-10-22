/** Real v3 representative preparation, cancellation and accepted IO survive SIGKILL with their original frozen Persona and custody. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_ACTOR_PIN, WORLD_EXTERNAL_MEDIATED_PIN, simulationExternalMediatedPlanSchema, simulationEntityIdSchema,
  simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldFactRequestSchema, WORLD_FACT_TEXT_SCHEMA_REF,
  simulationDecisionIdSchema, simulationWorldHirePlanPayloadSchema, simulationExternalMediatedResultSchema,
  simulationWorldCancelRequestSchema, activeSimulationMaintenance, simulationCheckpointManifestSchema,
  simulationInspectionSelectionSchema, simulationOperationIdSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationOperation } from '@clocky/clocky-simulation'
import type { LogEntry, LogStream } from '@clocky/clocky-storage'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import { TeamError } from '@clocky/clocky-team'
import type { SessionId } from '@clocky/clocky-session'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { requests } from './world-external-mediated-actor-fault-model.ts'

const scene = 'company', recovering = process.env.WORLD_MEDIATED_ACTOR_FAULT_RECOVER === 'true'
const stage = process.env.WORLD_MEDIATED_ACTOR_FAULT_STAGE!, round = process.env.WORLD_MEDIATED_ACTOR_FAULT_ROUND!
assert.ok(stage)
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
installed.runtimeProfiles[0]!.model = { provider: 'world-external-mediated-actor-fault-scripted', name: 'scripted', version: '1',
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
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), proofPath = resolve(root, 'mediated-actor-fault-prefix.json')
const savedManifest = recovering ? simulationCheckpointManifestSchema.parse(JSON.parse(
  await readFile(resolve(root, 'mediated-actor-fault-restore-manifest.json'), 'utf8'))) : undefined
const ctx = await boot('world-external-mediated-actor-fault', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `mediated-actor-fault-${scene}-${stage}`, ...resolved.native } })
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: savedManifest!.id, implementationVersion: 'world/1',
  maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
if (recovering) assert.deepEqual(restored!.manifest, savedManifest)
try {
  const inputPath = resolve(root, 'mediated-actor-fault-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(inputPath, 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `mediated-actor-fault/${scene}/${stage}`, checkpoint: { id: simulationCheckpointIdSchema.parse('mediated-actor-fault-initial'),
      maxDrainRounds: 4, maxAttempts: 3 } })
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
    await writeFile(resolve(root, 'mediated-actor-fault-contract-baseline.json'), JSON.stringify(contractBaseline))
    const baseline = { resources: run.snapshot().resources, commitments: run.snapshot().commitments,
      assignments: Object.values(run.snapshot().relations).filter(value => value.relation === 'assignment'),
      subject: run.snapshot().entities[subject] }
    await writeFile(resolve(root, 'mediated-actor-fault-assets.json'), JSON.stringify(baseline))
  }
  const stream = Reflect.get(run, 'stream') as LogStream
  const representative = () => Object.values(run.snapshot().world!.external.representatives)[0]
  const normal = (value: unknown): unknown => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  const journal = async (): Promise<LogEntry[]> => {
    const entries: LogEntry[] = []
    let after = -1
    while (after < stream.tailSequence) {
      const page = await stream.read(after, 128)
      assert.ok(page.length); entries.push(...page); after = page.at(-1)!.sequence
    }
    return entries
  }
  const actual = async (state: SimulationSnapshot = run.snapshot()) => {
    const currentTeam = await ctx.teams.getTeam({ teamId: team.teamId })
    const channels = await Promise.all(currentTeam.channelIds.map(async channelId => ({ channelId,
      admission: await ctx.teams.getChannelAdmission({ channelId }),
      records: (await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })).records })))
    const participants = Object.values(state.entities).flatMap((entity) => {
      const binding = entity.binding ?? entity.participantReservation?.binding
      return binding === undefined ? [] : [{ entityId: entity.id, binding }]
    })
    const sessions = await Promise.all(participants.map(async (participant) => {
      const unmaterialized = await ctx.sessionPersistence.isUnmaterialized(participant.binding.sessionId)
      return { ...participant, unmaterialized,
        events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(participant.binding.sessionId, 0)).events }
    }))
    const reserved = Object.values(state.world!.external.representatives)[0]
    const originalChannels = await Promise.all((reserved?.identities.channels ?? []).map(async (channel) => {
      try { return { original: channel, observed: await ctx.teams.getChannelAdmission({ channelId: channel.channelId }) } }
      catch (error: unknown) {
        if (error instanceof TeamError && error.code === 'TEAM_CHANNEL_NOT_FOUND') return { original: channel, observed: null }
        throw error
      }
    }))
    return { team: currentTeam, channels, sessions, originalChannels, population: run.population(), budgetUsage: run.budgetUsage() }
  }
  const cancellation = () => simulationWorldCancelRequestSchema.parse({ id: 'withdraw-original-v3-representative',
    requestId: Object.values(run.snapshot().world!.requests)[0]!.id })
  const shape = z.object({ kind: z.string(), change: z.object({ kind: z.string().optional(), id: z.string().optional(),
    entityId: z.string().optional(), outcome: z.object({ status: z.string().optional() }).loose().optional() })
    .loose().optional() }).loose()
  let reached = false
  const hold = async (witness: unknown) => {
    assert.equal(reached, false); reached = true
    const inspected = await ctx.simulations.inspect(simulationInspectionSelectionSchema.parse({ provider: selection.provider,
      spec: selection.spec, includeRecords: true }))
    assert.ok(inspected)
    const state = inspected.snapshot
    const latest = Object.values(state.checkpoints ?? {}).filter(value => value.status === 'completed')
      .toSorted((a, b) => (b.finishedSequence ?? -1) - (a.finishedSequence ?? -1))[0]
    assert.ok(latest?.manifest)
    await writeFile(resolve(root, 'mediated-actor-fault-restore-manifest.json'), JSON.stringify(latest.manifest))
    await writeFile(proofPath, JSON.stringify({ stage, state, witness, actual: await actual(state), journal: await journal(),
      modelRequests: requests, manifest: latest.manifest, anchor, initialCheckpoint: prepared?.checkpoint }))
    process.send?.({ event: 'mediated-actor-durable-boundary', stage })
    await new Promise<void>((done) => { process.once('message', () => { done() }) })
  }
  if (!recovering) {
    const append = stream.append.bind(stream)
    stream.append = async (...args) => {
      const entries = args[1].map(value => shape.parse(value)), reserved = representative()
      const reservation = entries.some(value => value.kind === 'run/external-representative'
        && value.change?.kind === 'external/reserved')
      const binding = entries.some(value => value.kind === 'run/writer' && value.change?.kind === 'entity/bound'
        && value.change.entityId === reserved?.identities.entityId)
      const committing = entries.some(value => value.kind === 'run/external-representative'
        && value.change?.kind === 'external/committed')
      const abandoning = entries.some(value => value.kind === 'run/external-representative'
        && value.change?.kind === 'external/abandoned')
      const notice = entries.some((value) => {
        if (value.kind !== 'run/outbox' || value.change?.kind !== 'outbox/finished' || value.change.outcome?.status !== 'applied') return false
        const operation = run.snapshot().operations[simulationOperationIdSchema.parse(value.change.id)]!
        const context = run.snapshot().decisions[operation.decisionId]?.context
        return operation.action.kind === 'communication/post' && operation.entityId === world.directorEntityId
          && context?.status === 'prepared' && context.world?.kind === 'result'
      })
      const matches = stage === 'reserved-after' && reservation || stage.startsWith('participant-') && binding
        || stage.startsWith('commit-') && !stage.includes('cancel') && committing
        || stage.startsWith('cancel-abandon-') && abandoning || stage === 'notification-lost' && notice
      if (matches && (stage.endsWith('-before') || stage.endsWith('-unconfirmed') || stage === 'notification-lost'))
        await hold({ entries: args[1], boundary: 'before-native-append' })
      const receipt = await append(...args)
      if (matches && stage.endsWith('-after')) await hold({ entries: args[1], appendReceipt: receipt, boundary: 'after-native-append' })
      return receipt
    }
    if (stage === 'director-channel-unconfirmed') {
      const confirm = run.confirmChannel.bind(run)
      run.confirmChannel = async (...args) => {
        if (representative()?.identities.channels[0].channelId === args[1])
          await hold({ confirmRequest: args, boundary: 'actual-channel-before-native-confirmation' })
        return confirm(...args)
      }
    }
    if (stage === 'cancel-participant-unconfirmed') {
      const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
      ctx.teams.inviteParticipant = async (...args) => {
        const accepted = await invite(...args), reserved = representative()
        if (accepted.id === reserved?.identities.binding.participantId) {
          const cancelled = await run.cancelWorldCase(cancellation())
          assert.equal(cancelled.status, 'cancel-requested')
          await hold({ acceptedParticipant: accepted, cancellation: cancelled, boundary: 'actual-participant-before-native-binding' })
        }
        return accepted
      }
    }
    if (['cancel-before-commit', 'commit-wins-cancel', 'cancel-abandon-before', 'cancel-abandon-after',
      'cancel-close-receipt-lost'].includes(stage)) {
      const commit = run.commitExternalRepresentative.bind(run)
      run.commitExternalRepresentative = async (...args) => {
        if (stage === 'commit-wins-cancel') {
          const result = await commit(...args), cancelled = await run.cancelWorldCase(cancellation())
          assert.equal(cancelled.status, 'already-committed')
          await hold({ result, cancellation: cancelled, boundary: 'commit-won-before-cancellation' })
          return result
        }
        const cancelled = await run.cancelWorldCase(cancellation())
        assert.equal(cancelled.status, 'cancel-requested')
        if (stage === 'cancel-before-commit') await hold({ cancellation: cancelled, boundary: 'cancellation-won-before-commit' })
        return commit(...args)
      }
    }
    if (stage === 'cancel-close-receipt-lost') {
      const close = ctx.teams.closeChannel.bind(ctx.teams)
      ctx.teams.closeChannel = async (...args) => {
        const receipt = await close(...args), reserved = representative()
        if (reserved?.status === 'cancel-requested' && args[0].channelId === reserved.identities.channels[0].channelId)
          await hold({ actualCloseReceipt: receipt, closeRequest: { channelId: args[0].channelId,
            expectedCursor: args[0].expectedCursor, reason: args[0].reason }, boundary: 'actual-close-receipt-not-returned' })
        return receipt
      }
    }
    await run.setPhase('running', run.snapshot().revision)
    await run.scheduleWake(simulationWakeRequestSchema.parse({ id: 'mediated-actor-fault-goal', entityId: requesterId, time: '1',
      reason: JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: 'mediated/vendor/widget' })) }), run.snapshot().revision)
    let result = await driver.advance()
    for (let step = 0; step < 8 && result.reason === 'work-limit'; step++) result = await driver.advance()
    throw new Error(`Actual v3 representative fault barrier was not reached: ${stage}; ${JSON.stringify({ result, failures })}`)
  }
  const proof = JSON.parse(await readFile(proofPath, 'utf8')) as { state: SimulationSnapshot
    actual: Awaited<ReturnType<typeof actual>>
    journal: LogEntry[]
    manifest: NonNullable<typeof savedManifest> }
  const state = run.snapshot(), before = { state, actual: await actual(), journal: await journal() }
  assert.equal(state.phase, 'paused')
  for (const key of ['world', 'relations', 'resources', 'grants', 'commitments', 'interactions', 'decisions', 'operations',
    'wakes', 'scheduledEvents', 'maintenance'] as const) assert.deepEqual(normal(state[key]), proof.state[key])
  assert.deepEqual(before.journal.slice(0, proof.journal.length), proof.journal)
  assert.deepEqual(before.actual.channels, proof.actual.channels)
  const originalRep = Object.values(proof.state.world!.external.representatives)[0]!
  assert.ok(originalRep?.adjudication)
  assert.equal(proof.state.world!.plans[originalRep.request.planId]!.pin.version, '3')
  for (const entity of Object.values(state.entities)) {
    assert.deepEqual(entity.binding, proof.state.entities[entity.id]!.binding)
    assert.deepEqual(entity.profile, proof.state.entities[entity.id]!.profile)
    assert.equal(entity.readiness, proof.state.entities[entity.id]!.readiness)
    assert.ok(entity.writer === undefined || entity.writer.phase === 'released')
  }
  const recoverySteps: unknown[] = []
  if (round === '2') {
    const beforeReconcile = representative()!
    const revisionBeforeReconcile = run.snapshot().revision
    const pendingMaintenance = activeSimulationMaintenance(run.snapshot())
    const reconciled = await driver.reconcile()
    assert.equal(reconciled.reason, pendingMaintenance === undefined && beforeReconcile.status === 'committed' ? 'idle' : 'paused')
    if (reconciled.reason === 'idle') assert.equal(run.snapshot().revision, revisionBeforeReconcile)
    const completed = representative()!
    assert.deepEqual(completed.identities, originalRep.identities)
    assert.deepEqual(completed.adjudication, originalRep.adjudication)
    assert.equal(activeSimulationMaintenance(run.snapshot()), undefined)
    assert.equal(completed.status, stage.startsWith('cancel-') ? 'abandoned' : 'committed')
    recoverySteps.push({ originalStatus: beforeReconcile.status, finalStatus: completed.status,
      originalIdentities: completed.identities, originalAdjudication: completed.adjudication,
      productiveInference: false, reconciliationReason: reconciled.reason })
    const revision = run.snapshot().revision
    assert.equal((await driver.reconcile()).reason, 'idle')
    assert.equal(run.snapshot().revision, revision)
    if (completed.status === 'committed') {
      await run.commitExternalRepresentative(completed.id)
      assert.equal(run.snapshot().revision, revision)
    } else {
      await run.settleExternalRepresentativeCancellation(completed.id)
      assert.equal(run.snapshot().revision, revision)
      await assert.rejects(run.commitExternalRepresentative(completed.id))
      assert.equal(run.snapshot().revision, revision)
    }
  }
  const final = run.snapshot(), rep = representative()!, owned = final.world!, person = final.entities[rep.identities.entityId]
  const request = owned.requests[rep.requestId]!, plan = owned.plans[rep.request.planId]!
  assert.equal(Object.keys(owned.external.identities).length, 1)
  assert.equal(Object.keys(owned.external.representatives).length, 1)
  assert.equal(owned.external.identities[rep.identityId]?.representation, 'director-mediated')
  assert.deepEqual(rep.identities, originalRep.identities)
  assert.deepEqual(rep.adjudication, originalRep.adjudication)
  assert.equal(plan.proposal.resolution.kind, 'apply')
  if (plan.proposal.resolution.kind !== 'apply') throw new Error('Representative lost its original apply plan')
  const selected = simulationExternalMediatedPlanSchema.parse(plan.proposal.resolution.payload)
  assert.equal(selected.outcome.kind, 'representative-preparation-plan')
  if (selected.outcome.kind !== 'representative-preparation-plan') throw new Error('Original v3 Persona changed')
  if (person !== undefined) assert.deepEqual(person.profile['persona'], simulationWorldHirePlanPayloadSchema.parse(selected.outcome.preparation).persona)
  const result = Object.values(owned.results).find(value => value.intentId === rep.id)
  if (rep.status === 'committed') {
    assert.ok(person?.binding)
    assert.equal(person.cognition, 'agent'); assert.equal(person.readiness, 'ready')
    assert.deepEqual(person.binding, rep.identities.binding)
    assert.notEqual(person.binding.sessionId, final.entities[requesterId]!.binding!.sessionId)
    const represents = final.relations[rep.identities.relationId]!
    assert.equal(represents.relation, 'represents'); assert.equal(represents.subject, person.id); assert.equal(represents.object, subject)
    assert.ok(result?.outcome.kind === 'committed')
    assert.equal(request.status, 'committed')
    const adjudication = owned.external.adjudications[rep.id]!
    assert.ok(adjudication.actualActor)
    const parsed = simulationExternalMediatedResultSchema.parse(result.payload)
    assert.ok('outcome' in parsed && parsed.outcome.kind === 'representative-prepared')
    if (!('outcome' in parsed) || parsed.outcome.kind !== 'representative-prepared') throw new Error('V3 result lost actual Actor mapping')
    assert.deepEqual(parsed.outcome.actual, { identityId: adjudication.actualActor.identityId,
      generation: adjudication.actualActor.generation,
      entityId: adjudication.actualActor.entityId, relationId: adjudication.actualActor.relationId,
      requesterEntityId: adjudication.actualActor.requesterEntityId, contactUnit: adjudication.actualActor.contactUnit,
      channelId: adjudication.actualActor.channelId })
    assert.equal(adjudication.actualActor.committedSequence, result.sequence)
    assert.equal(adjudication.actualActor.identityId, rep.identityId)
    assert.equal(adjudication.actualActor.generation, rep.generation)
    assert.equal(adjudication.actualActor.entityId, rep.identities.entityId)
    assert.equal(adjudication.actualActor.relationId, rep.identities.relationId)
    assert.equal(adjudication.actualActor.channelId, rep.identities.channels[1].channelId)
    assert.equal(adjudication.actualActor.requesterEntityId, requesterId)
    assert.equal(adjudication.actualActor.contactUnit, 'widget')
    assert.equal(owned.external.contacts[rep.id]?.status, 'committed')
    const actualParticipant = (await ctx.teams.getTeam({ teamId: team.teamId })).participants
      .find(value => value.id === rep.identities.binding.participantId)!
    assert.equal(actualParticipant.kind, 'local-agent'); assert.equal(actualParticipant.phase, 'active')
    for (const [id, actor] of [[`simulation-world-first:${rep.id}`, requesterId],
      [`simulation-world-result:${result.id}`, world.directorEntityId]] as const) {
      const wake = Object.values(final.scheduledEvents).find(value => value.id === id)!
      assert.ok(wake?.action.kind === 'wake'); assert.equal(wake.action.entityId, actor)
      assert.equal(wake.key.time, result.time)
    }
    if (stage === 'commit-wins-cancel') {
      assert.equal(Object.values(owned.cancellations)[0]!.status, 'already-committed')
      const revision = final.revision
      assert.equal((await run.cancelWorldCase(cancellation())).status, 'already-committed')
      assert.equal(run.snapshot().revision, revision)
    }
  } else if (rep.status === 'abandoned') {
    assert.ok(person)
    assert.equal(person.phase, 'terminated'); assert.equal(person.readiness, 'abandoned')
    assert.equal(result?.outcome.kind, 'cancelled'); assert.equal(request.status, 'cancelled')
    assert.equal(owned.external.adjudications[rep.id], undefined)
    assert.equal(owned.external.contacts[rep.id], undefined)
    assert.equal(final.relations[rep.identities.relationId], undefined)
    assert.ok(rep.cleanup)
    assert.equal(rep.cleanup.sequence, result.sequence)
    assert.equal(rep.cleanup.evidence.session, 'unmaterialized')
    assert.ok(['left', 'failed'].includes(rep.cleanup.evidence.participant))
    const wake = Object.values(final.scheduledEvents).find(value => value.id === `simulation-world-result:${result.id}`)!
    assert.ok(wake?.action.kind === 'wake')
    assert.equal(wake.action.entityId, world.directorEntityId)
    assert.equal(Object.values(final.scheduledEvents).some(value => value.id === `simulation-world-first:${rep.id}`), false)
  } else {
    assert.equal(result, undefined)
    assert.equal(Object.keys(owned.external.adjudications).length, 0)
    assert.equal(Object.values(final.scheduledEvents).some(value => value.id === `simulation-world-first:${rep.id}`), false)
    if (rep.status === 'cancel-requested') {
      assert.equal(request.status, 'cancel-requested')
      assert.ok(activeSimulationMaintenance(final))
    }
  }
  const contract = JSON.parse(await readFile(resolve(root, 'mediated-actor-fault-contract-baseline.json'), 'utf8')) as {
    resources: typeof final.resources
    commitments: typeof final.commitments
    interactions: typeof final.interactions
    sessions: Array<{ binding: { sessionId: SessionId }; events: unknown[] }> }
  const assets = JSON.parse(await readFile(resolve(root, 'mediated-actor-fault-assets.json'), 'utf8')) as {
    resources: typeof final.resources
    commitments: typeof final.commitments
    assignments: unknown
    subject: unknown }
  assert.equal(Object.keys(contract.commitments).length, 1)
  assert.equal(Object.values(contract.commitments)[0]!.debtor, custodianId)
  assert.equal(Object.values(contract.commitments)[0]!.creditor, requesterId)
  assert.deepEqual(final.resources, contract.resources); assert.deepEqual(final.commitments, contract.commitments)
  assert.deepEqual(final.interactions, contract.interactions)
  assert.deepEqual(Object.values(final.relations).filter(value => value.relation === 'assignment'), assets.assignments)
  assert.deepEqual(final.entities[subject], assets.subject)
  for (const stored of contract.sessions) assert.deepEqual((await ctx.sessionPersistence.readFrom(stored.binding.sessionId, 0)).events
    .slice(0, stored.events.length), stored.events)
  const finalActual = await actual()
  for (const source of proof.actual.sessions) {
    const current = finalActual.sessions.find(value => value.entityId === source.entityId)!
    assert.ok(current); assert.deepEqual(current.binding, source.binding)
    assert.deepEqual(current.events.slice(0, source.events.length), source.events)
  }
  for (const channel of proof.actual.channels) {
    const current = finalActual.channels.find(value => value.channelId === channel.channelId)!
    assert.ok(current); assert.deepEqual(current.records.slice(0, channel.records.length), channel.records)
  }
  const actorSession = finalActual.sessions.find(value => value.entityId === rep.identities.entityId)
  for (const privateText of ['PRIVATE-BUYER-FLOOR', 'PRIVATE-DIRECTOR-REPRESENTATIVE-RATIONALE']) {
    assert.equal(JSON.stringify(actorSession?.events ?? []).includes(privateText), false)
    assert.equal(JSON.stringify(owned.results).includes(privateText), false)
  }
  if (stage !== 'notification-lost') {
    assert.equal(await ctx.sessionPersistence.isUnmaterialized(rep.identities.binding.sessionId), true)
    assert.equal(ctx.agents.get(rep.identities.binding.sessionId), undefined)
  }
  const canonicalPosts: unknown[] = []
  for (const operation of Object.values(final.operations)) {
    if (operation.action.kind !== 'communication/post') continue
    const envelopes = finalActual.channels.flatMap(value => value.records).filter(value => value.type === 'channel/envelope'
      && value.envelope.correlationId === JSON.stringify([final.spec.runId, operation.decisionId, operation.id,
        final.decisions[operation.decisionId]!.closedAt]))
    assert.ok(envelopes.length <= 1)
    for (const accepted of envelopes) {
      assert.ok(accepted.type === 'channel/envelope')
      assert.equal(accepted.envelope.senderId, final.entities[operation.entityId]!.binding!.participantId)
      const expected = renderDirectV4EnvelopeInput(accepted.envelope)
      const recipient = finalActual.sessions.find(value => value.entityId === (operation.action as
        Extract<SimulationOperation['action'], { kind: 'communication/post' }>).recipient)!
      const received = recipient.events.filter(value => value.type === 'user/message' && value.surfaceOp === 'append' && value.data.id === expected.id)
      const inbox = recipient.events.flatMap(value => value.type === 'agent/inbox/spliced'
        ? value.data.inserted.filter(message => message.id === expected.id) : [])
      if (operation.delivery?.receipt !== undefined) {
        assert.equal(inbox.length, 1); assert.deepEqual(inbox[0], expected)
        assert.ok(received.length <= 1)
        if (received.length === 1) assert.deepEqual(received[0]!.data, expected)
      } else { assert.equal(received.length, 0); assert.equal(inbox.length, 0) }
      canonicalPosts.push({ operationId: operation.id, accepted, received, inbox,
        pendingReceipt: operation.outbox?.receipt === undefined })
    }
  }
  assert.equal((await driver.advance()).reason, 'paused'); assert.equal(requests.length, 0)
  await writeFile(resolve(root, `mediated-actor-fault-cold-${round}.json`), JSON.stringify({ stage, before, state: final,
    actual: finalActual, journal: await journal(), canonicalPosts, recoverySteps, restoreManifest: restored!.manifest,
    anchor, runtimePaths, execArgv: process.execArgv, modelCalls: 0 }))
  console.log(JSON.stringify({ stage, phase: 'paused', modelCalls: 0, originalReservationRetained: true, v3OriginalSourceRetained: true,
    originalContractRetained: true, canonicalPrefixesRetained: true, representativeStatus: rep.status,
    recoverySteps: recoverySteps.length, runtimePaths, execArgv: process.execArgv }))
} catch (error) {
  await writeFile(resolve(root, `mediated-actor-fault-failure-${round}.json`), JSON.stringify({ stage, state: run.snapshot(), failures, modelRequests: requests }))
  throw error
} finally { await run.close(); await ctx.fiber.dispose() }
