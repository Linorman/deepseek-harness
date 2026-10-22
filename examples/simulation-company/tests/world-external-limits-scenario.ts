/** Company and laboratory prepare a real independent external actor and exchange canonical private Channel messages. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_ACTOR_PIN, simulationEntityIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema,
  simulationDecisionIdSchema, budgetUsage, simulationTokenCount, activeSimulationMaintenance } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalActorWorldExecution } from '@clocky/clocky-simulation-world'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { assertBlockedExecuteOnly } from './world-reconcile-observation-proof.ts'
import { requests } from './world-external-limits-model.ts'

const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local'].map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(face === 'lib' ? '/lib/' : '/src/'), path)
if (face === 'lib') assert.deepEqual(process.execArgv, [])

const mode = process.env.WORLD_EXTERNAL_LIMIT ?? 'entities'
const modes = ['births', 'expansions', 'entities', 'participants', 'channels', 'reuse-channels', 'bytes-reserve', 'bytes-commit',
  'director-tokens', 'representative-tokens', 'director-pool', 'representative-pool', 'director-history',
  'representative-history', 'resident-owner']
assert.ok(modes.includes(mode))
const scene = process.env.WORLD_SCENARIO ?? 'company', recovering = process.env.WORLD_DRIVER_RECOVER === 'true'
process.env.SIMULATION_MODEL_LIMIT = '1'
process.env.SIMULATION_MODEL_QUEUE_LIMIT = '0'
assert.ok(['company', 'laboratory'].includes(scene))
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
definition.initialEvents = []
const limits = { ...definition.limits, native: { ...definition.limits?.native }, team: { ...definition.limits?.team },
  world: { ...definition.limits?.world } }
if (mode === 'births') limits.world.maxBirthsPerInterval = 0
if (mode === 'expansions') limits.world.maxExternalExpansionsPerInterval = 0
if (mode === 'entities') limits.native.maxEntities = definition.actors.length + definition.positions.length + 2
if (mode === 'participants') limits.team.maxParticipants = definition.actors.length
if (mode === 'channels') limits.team.maxChannels = definition.actors.length
if (mode === 'reuse-channels') limits.team.maxChannels = definition.actors.length + 1
if (mode === 'bytes-reserve') limits.world.maxBytesPerPlan = 1400
if (mode === 'director-tokens') limits.native.maxTokensPerInterval = 10044
if (mode === 'representative-tokens') limits.native.maxTokensPerInterval = 10134
if (mode === 'director-history') limits.team.maxActivations = 3
if (mode === 'representative-history') limits.team.maxActivations = 5
if (mode === 'resident-owner') limits.native.maxResidentActors = 1
definition.limits = limits
installed.runtimeProfiles[0]!.model = { provider: 'world-external-limits-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
// Keep the commit-byte fault after preparation: only its result wake carries this long canonical recipient.
// This trusted Native composition does not claim that the portable author schema accepts long symbolic keys.
const originalRequester = compiled.resolved.actors.find(value => value.role === 'member' && compiled.resolved.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
const longRecipient = simulationEntityIdSchema.parse(`requester-${'x'.repeat(3500)}`)
const original: ResolvedWorldScenario = mode === 'bytes-commit'
  ? JSON.parse(JSON.stringify(compiled.resolved,
    (_key, value: unknown) => value === originalRequester.entityId ? longRecipient : value)) as ResolvedWorldScenario
  : compiled.resolved
const requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const requesterId = simulationEntityIdSchema.parse(requester.entityId)
const scope = original.world.organizationEntityId, subject = simulationEntityIdSchema.parse('external-supplier')
const second = original.actors.find(value => value.role === 'member' && value.entityId !== requesterId)!
assert.ok(second)
const secondId = simulationEntityIdSchema.parse(second.entityId)
const buyerIds = [requesterId, secondId]
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
  relations: [...original.relations, { kind: 'relation/create', id: 'second-buyer-assignment', subject: secondId,
    relation: 'assignment', object: original.relations.find(value => value.relation === 'assignment' && value.subject === requesterId)!.object,
    scope, validFrom: '0', validUntil: null }, ...buyerIds.map((buyer, index) => ({ kind: 'relation/create' as const,
    id: `external-permission-${index}`, subject: buyer, relation: 'can-interact', object: subject,
    scope, validFrom: '0' as const, validUntil: null }))] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })

const ctx = await boot('world-external-limits', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), proofPath = resolve(root, 'limits-original.json')
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: mode === 'bytes-reserve' ? 'bytes' : `external-limits-${scene}-${mode}`, ...resolved.native } })
const restoredProof = recovering ? JSON.parse(await readFile(proofPath, 'utf8')) as {
  checkpointId: string
  settled: unknown
  stop: string
  before: unknown
  stopped: unknown
  residentProbe: unknown
  holderEvidence: unknown
} : undefined
const restored = recovering ? await ctx.simulationTeams.restore(selection, {
  id: simulationCheckpointIdSchema.parse(restoredProof!.checkpointId), implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const calls = () => requests.filter(value => value.purpose !== 'holder')
const stops: Record<string, string> = { births: 'world-birth-limit', expansions: 'world-expansion-limit', entities: 'entity-capacity', participants: 'identity-capacity', channels: 'channel-capacity',
  'reuse-channels': 'channel-capacity', 'bytes-reserve': 'world-byte-limit', 'bytes-commit': 'world-byte-limit',
  'director-tokens': 'budget-limit', 'representative-tokens': 'budget-limit', 'director-pool': 'model-pool-capacity',
  'representative-pool': 'model-pool-capacity', 'director-history': 'activation-history-limit',
  'representative-history': 'activation-history-limit', 'resident-owner': 'owner-resident-capacity' }
const expectedCalls: Record<string, number> = { births: 6, expansions: 6, entities: 6, participants: 6, channels: 6, 'reuse-channels': 21,
  'bytes-reserve': 6, 'bytes-commit': 6, 'director-tokens': 3, 'representative-tokens': 9,
  'director-pool': 3, 'representative-pool': 9, 'director-history': 3, 'representative-history': 9, 'resident-owner': 15 }
const core = () => {
  const state = run.snapshot()
  return { spec: state.spec, world: state.world, resources: state.resources, commitments: state.commitments,
    decisions: state.decisions, tokens: state.tokenReservations ?? {}, dispatch: state.decisionDispatch ?? null,
    activationBlocks: state.activationAdmissionBlocks ?? null, stall: state.stall ?? null, maintenance: state.maintenance ?? null }
}
let finishHolder: (() => Promise<void>) | undefined
let holderEvidence: unknown
try {
  const inputPath = resolve(root, 'limits-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify({ selection, resolved }))
  else assert.deepEqual(JSON.parse(await readFile(inputPath, 'utf8')), { selection: { ...selection, mode: 'create' }, resolved })
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `external-limits/${scene}/${mode}`, checkpoint: { id: simulationCheckpointIdSchema.parse('limits-initial'),
      maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.ok(typeof ownerName === 'string')
  const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, team.teamId, ownerName)
  const anchor = { checkpointId: restored?.manifest.id ?? prepared!.checkpoint.request.id,
    ownerName, maxDrainRounds: 4, maxAttempts: 3 }
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
  assert.equal(calls().length, 0)
  const runtime = resolved.generatedActorRuntime
  const placement = (id: typeof requesterId) => ({ activation: { provider: runtime.provider,
    seed: { kind: run.snapshot().entities[id]?.writer === undefined ? 'fresh' as const : 'resume' as const },
    agent: { preset: runtime.preset, options: { provider: runtime.model.provider, model: runtime.model.name } },
    signal: lifetime }, evict: [] })
  const observe = async () => {
    const state = run.snapshot(), actual = await ctx.teams.getTeam({ teamId: team.teamId })
    return { core: core(), revision: state.revision, population: run.population(), budget: budgetUsage(state),
      participants: actual.participants, activations: actual.activations, channels: actual.channelIds,
      modelPool: ctx.simulationTeams.modelUsage(), calls: calls(),
      admittedTokens: Object.values(state.tokenReservations ?? {}).map(value => ({ id: value.id, entityId: value.entityId,
        status: value.status, sessionId: value.sessionId, reserved: value.reserved,
        actual: value.usage === undefined ? null : simulationTokenCount(value.usage) })) }
  }
  const occupy = async () => {
    const holder = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
      spec: { runId: `limits-holder-${scene}-${mode}`, ...resolved.native } }))
    await prepareSimulationWorld(ctx.simulationTeams, holder, { resolved, ownerName: 'external-limits/holder',
      checkpoint: { id: simulationCheckpointIdSchema.parse('holder-initial'), maxDrainRounds: 4, maxAttempts: 3 } })
    const holderTeam = holder.snapshot().teamReservation!
    const holderOwner = holderTeam.creation.rules['activationLifecycleOwner']
    assert.ok(typeof holderOwner === 'string')
    const attached = await ctx.simulationTeams.attach(holder, holderTeam.teamId, holderOwner)
    const held = ctx.externalLimitsProbe.holdNextRequest()
    await attached.activate(requesterId, { ...placement(requesterId).activation, seed: { kind: 'fresh' } })
    await holder.setPhase('running', holder.snapshot().revision)
    const work = attached.executeDecision(requesterId, simulationDecisionIdSchema.parse('held-provider'),
      { personaVersion: 'world/1', modelVersion: runtime.model.version, sources: [],
        sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({
          kind: kind as 'identity' | 'authority' | 'input' | 'goals' | 'commitments', required: true,
          blocks: [{ type: 'text' as const, text: JSON.stringify(kind === 'goals'
            ? { kind: 'world-driver', entityId: requesterId, contextKey: 'held-provider', purpose: 'holder' } : {}) }] })) })
    const settled = Promise.allSettled([work])
    await held.entered
    assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 1, queued: 0, limit: 1, queueLimit: 0 })
    const activeTokens = holder.snapshot().tokenReservations ?? {}
    assert.equal(Object.values(activeTokens).filter(value => value.status === 'reserved').length, 1)
    const before = { runId: holder.snapshot().spec.runId, owner: holderOwner, tokenReservations: activeTokens,
      budget: budgetUsage(holder.snapshot()), modelPool: ctx.simulationTeams.modelUsage() }
    holderEvidence = { before }
    return async () => {
      held.finish(); await settled
      holderEvidence = { before, after: { tokenReservations: holder.snapshot().tokenReservations,
        budget: budgetUsage(holder.snapshot()), modelPool: ctx.simulationTeams.modelUsage() } }
      await attached.close(); await holder.close()
    }
  }
  let before: unknown, stopped: unknown, residentProbe: unknown, stop = stops[mode]!
  if (!recovering) {
    if (mode.endsWith('history')) {
      for (let round = 0; round < 2; round++) {
        await connection.activate(requesterId, { ...placement(requesterId).activation,
          seed: { kind: round === 0 ? 'fresh' : 'resume' } })
        await connection.hibernate(requesterId)
      }
      assert.equal(calls().length, 0)
    }
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject, kind: 'inventory',
      unit: 'widget', quantity: '7', controllers: [] }), run.snapshot().revision)
    before = await observe()
    const execute = connection.executeDecision.bind(connection)
    connection.executeDecision = async (...args) => {
      const representative = Object.values(run.snapshot().world!.external.representatives)
        .find(value => value.identities.entityId === args[0])
      if (finishHolder === undefined && (mode === 'director-pool' && args[0] === world.directorEntityId
        || mode === 'representative-pool' && representative !== undefined)) finishHolder = await occupy()
      return await execute(...args)
    }
    if (mode === 'resident-owner') {
      const ensure = connection.ensureResident.bind(connection)
      connection.ensureResident = async (...args) => {
        if (residentProbe === undefined && Object.values(run.snapshot().world!.external.representatives)
          .some(value => value.identities.entityId === args[0])) {
          const revision = run.snapshot().revision, models = calls().length, current = await observe()
          assert.equal(run.population().chargedActors, 1)
          for (let round = 0; round < 3; round++) {
            assert.equal((await ensure(args[0], { ...args[1], evict: [] })).status, 'capacity')
            assert.equal(run.snapshot().revision, revision)
            assert.equal(calls().length, models)
          }
          residentProbe = { before: current, after: await observe(), status: 'capacity', repeatsWithoutAppend: 3,
            note: 'The explicit owner eviction policy refuses capacity; ordinary driver eviction may then proceed.' }
        }
        return await ensure(...args)
      }
    }
    await run.setPhase('running', run.snapshot().revision)
    const advance = async () => {
      let result = await driver.advance()
      for (let round = 0; round < 12 && ['work-limit', 'plan-stale'].includes(result.reason); round++) result = await driver.advance()
      return result
    }
    const goal = async (buyer: typeof requesterId, businessKey: string) => {
      await run.scheduleWake(simulationWakeRequestSchema.parse({ id: `limits-goal-${businessKey}`, entityId: buyer,
        time: String(BigInt(run.snapshot().time) + 1n), reason: JSON.stringify(simulationWorldGoalSchema.parse({
          kind: 'world-goal', version: 1, goal: `${businessKey}/vendor/widget` })) }), run.snapshot().revision)
      return await advance()
    }
    let result = await goal(requesterId, 'first')
    if (mode === 'reuse-channels') {
      assert.equal(result.reason, 'idle')
      assert.equal(calls().length, 15)
      assert.equal(Object.keys(run.snapshot().world!.external.representatives).length, 1)
      before = await observe()
      result = await goal(secondId, 'second')
    }
    assert.equal(result.reason, mode === 'resident-owner' ? 'idle' : stop, JSON.stringify({ mode, result, failures }))
    assert.equal(calls().length, expectedCalls[mode], JSON.stringify({ mode, failures, calls: calls() }))
    const state = run.snapshot(), originalRevision = state.revision, models = calls().length
    const settledTokens = Object.values(state.tokenReservations ?? {}).filter(value => value.status === 'settled')
    assert.equal(settledTokens.length, models)
    assert.ok(settledTokens.every(value => value.usage !== undefined && simulationTokenCount(value.usage) === 15))
    assert.equal(budgetUsage(state).tokens.used, models * 15)
    const directorCalls = calls().filter(value => value.entityId === world.directorEntityId).length
    assert.equal(directorCalls, mode.startsWith('director-') ? 0 : mode === 'reuse-channels' ? 6 : 3)
    assert.equal(settledTokens.filter(value => value.entityId === world.directorEntityId).length, directorCalls)
    if (mode === 'reuse-channels') {
      const current = state.world!, representative = Object.values(current.external.representatives)[0]!
      assert.equal(representative.status, 'committed')
      assert.equal(Object.keys(current.external.contacts).length, 1)
      assert.equal(Object.values(current.requests).filter(value => value.status === 'open').length, 1)
      assert.equal(Object.values(current.plans).filter(value => value.proposal.resolution.kind === 'apply'
        && value.proposal.resolution.payload !== null && typeof value.proposal.resolution.payload === 'object'
        && !Array.isArray(value.proposal.resolution.payload) && 'kind' in value.proposal.resolution.payload).length, 1)
    }
    if (mode === 'bytes-commit') {
      assert.equal(Object.values(state.world!.external.representatives)[0]?.status, 'preparing')
      assert.equal(Object.keys(state.world!.results).length, 0)
      assert.ok(activeSimulationMaintenance(state))
    }
    const recordsAttempts = ['births', 'expansions', 'entities', 'participants', 'channels', 'reuse-channels', 'bytes-reserve'].includes(mode)
    const sessionsBeforeRetry = async () => await Promise.all(Object.values(run.snapshot().entities).map(async (entity) => {
      if (entity.binding === undefined) return null
      const id = entity.binding.sessionId
      return { id, stored: await ctx.sessionPersistence.isUnmaterialized(id) ? null : await ctx.sessionPersistence.readFrom(id, 0) }
    }))
    for (let round = 0; round < 3; round++) {
      const previous = await observe(), sessions = await sessionsBeforeRetry()
      if (mode === 'bytes-commit') {
        const plan = Object.values(state.world!.plans)[0]!
        assert.equal(await adapter.execute(plan), stop)
      } else assert.equal((await driver.advance()).reason, mode === 'resident-owner' ? 'idle' : stop)
      if (recordsAttempts) {
        // Each explicit advance is an auditable attempt, even when the same capacity gate still refuses it.
        assert.equal(run.snapshot().revision, previous.revision + 2)
        const pending = Object.values(previous.core.world!.plans).filter(value => value.status === 'accepted'
          && previous.core.world!.requests[value.requestId]?.status === 'open')
        assert.equal(pending.length, 1)
        const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
        const afterAttempt = await observe()
        assertBlockedExecuteOnly(previous.core, afterAttempt.core, await stream.read(previous.revision, 3),
          previous.revision, pending[0]!.id, stop)
        assert.deepEqual({ ...afterAttempt, core: previous.core, revision: previous.revision }, previous)
        assert.deepEqual(await sessionsBeforeRetry(), sessions)
      } else assert.equal(run.snapshot().revision, originalRevision)
      assert.equal(calls().length, models)
    }
    stopped = await observe()
    if (finishHolder !== undefined) { await finishHolder(); finishHolder = undefined }
    await run.setPhase('paused', run.snapshot().revision)
    const checkpointId = activeSimulationMaintenance(run.snapshot()) === undefined ? 'limits-complete' : 'limits-initial'
    if (checkpointId === 'limits-complete') assert.equal((await connection.checkpoint({
      id: simulationCheckpointIdSchema.parse(checkpointId), implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status, 'completed')
    const sessions = []
    for (const entity of Object.values(run.snapshot().entities)) {
      if (entity.binding !== undefined) {
        const unmaterialized = await ctx.sessionPersistence.isUnmaterialized(entity.binding.sessionId)
        sessions.push({ entityId: entity.id, sessionId: entity.binding.sessionId, unmaterialized,
          stored: unmaterialized ? null : await ctx.sessionPersistence.readFrom(entity.binding.sessionId, 0) })
      }
    }
    await writeFile(resolve(root, 'limits-sessions.json'), JSON.stringify(sessions))
    await writeFile(resolve(root, 'limits-model-inputs.json'), JSON.stringify(requests))
    const stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
    const records = []
    let after = -1
    while (after < stream.tailSequence) {
      const entries = await stream.read(after, 128)
      assert.ok(entries.length)
      records.push(...entries)
      after = entries.at(-1)!.sequence
    }
    await writeFile(resolve(root, 'limits-journal.json'), JSON.stringify(records))
    await writeFile(proofPath, JSON.stringify({ before, stopped, settled: core(), checkpointId, stop, residentProbe, holderEvidence }))
  } else {
    assert.equal(run.snapshot().phase, 'paused')
    assert.deepEqual(core(), restoredProof!.settled)
    before = restoredProof!.before; stopped = restoredProof!.stopped
    residentProbe = restoredProof!.residentProbe; stop = restoredProof!.stop
    const revision = run.snapshot().revision
    if (['births', 'expansions', 'entities', 'participants', 'channels', 'reuse-channels', 'bytes-reserve', 'bytes-commit'].includes(mode)) {
      const pending = Object.values(run.snapshot().world!.plans).find(value => value.status === 'accepted'
        && run.snapshot().world!.requests[value.requestId]?.status === 'open')!
      assert.ok(pending)
      assert.equal(await adapter.execute(pending), stop)
    }
    assert.equal((await driver.advance()).reason, 'paused')
    assert.equal(run.snapshot().revision, revision)
    assert.equal(calls().length, 0)
    assert.deepEqual(core(), restoredProof!.settled)
  }
  console.log(JSON.stringify({ scene, mode, stop, runtimePaths, finiteTemplateDirectorSelection: true,
    stableStop: true, restored: recovering, phase: run.snapshot().phase, modelCalls: calls().length,
    heldProviderCalls: requests.filter(value => value.purpose === 'holder').length,
    chargedTokens: budgetUsage(run.snapshot()).tokens.used, originalResponsibility: true,
    residentCoverage: mode === 'resident-owner' ? 'historical-owner-boundary' : null }))
} catch (cause) {
  await writeFile(resolve(root, 'limits-failure.json'), JSON.stringify({ failures, requests, state: run.snapshot() }))
  throw cause
} finally { if (finishHolder !== undefined) await finishHolder(); await run.close(); await ctx.fiber.dispose() }
