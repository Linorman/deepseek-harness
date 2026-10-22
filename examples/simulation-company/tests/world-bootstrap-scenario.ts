/** Trusted legacy topology supplies real canonical identities for Native initialization; this is not full v1 product admission. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_MEDIATED_PIN, simulationEntityIdSchema, simulationChangeSchema, simulationParticipantSpecSchema,
  simulationChannelSpecSchema, simulationWorldBootstrapRequestSchema, simulationDriveRequestSchema, simTimeSchema,
  isWorldFactAdjudicated, checkpointWorldState } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { LogStream, LogEntry } from '@clocky/clocky-storage'
import { compileWorldScenario } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { SimulationWorldDriver, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { mediatedModelRequests } from './world-external-mediated-model.ts'

const scenarioCase = process.env.WORLD_BOOTSTRAP_CASE!, recovering = process.env.WORLD_BOOTSTRAP_RECOVER === 'true'
const round = process.env.WORLD_BOOTSTRAP_ROUND!, root = resolve(process.env.SIMULATION_COMPANY_ROOT!)
assert.ok(['initial', 'goal', 'position'].includes(scenarioCase))
const mode = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
assert.ok(['src', 'lib'].includes(mode))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(mode === 'lib' ? '/lib/' : '/src/'), path)
if (mode === 'lib') {
  assert.deepEqual(process.execArgv, [])
  assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false)
}
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-mediated-scripted', name: 'scripted', version: '1', available: true }
const portable: unknown = JSON.parse(await readFile(resolve('examples/simulation-company/scenarios/world-company.json'), 'utf8'))
const compiled = await compileWorldScenario(portable, installed)
assert.ok(compiled.ok)
const original = compiled.resolved
assert.equal(original.definition.apiVersion, 'clocky.world/v0')
const requester = original.actors.find(value => value.role === 'member' && original.relations.some(relation =>
  relation.relation === 'assignment' && relation.subject === value.entityId))!
const replacement = original.actors.find(value => value.role === 'member' && value.entityId !== requester.entityId)!
const requesterId = simulationEntityIdSchema.parse(requester.entityId), replacementId = simulationEntityIdSchema.parse(replacement.entityId)
const scope = original.world.organizationEntityId, director = original.world.directorEntityId, subject = 'external-mediated-supplier'
const world = simulationWorldDefinitionSchema.parse({ ...original.world, limits: { ...original.world.limits, maxBytesPerPlan: 16384 },
  operations: [...original.world.operations, WORLD_EXTERNAL_MEDIATED_PIN],
  externalAdjudicationPolicy: { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
    conditionInstalls: ['weather', 'lead-time', 'meeting-status'], futureConditionInstalls: ['lead-time'],
    allowedOutcomeKinds: ['environmental-fact', 'unverified-report', 'failure', 'delayed-event'], maxDelay: '10',
    allowPublicDisclosure: false, allowScopeDisclosure: false, actorDisclosure: [] },
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId, domain: 'external', operation: 'interact',
    version: '3', scopeEntityId: scope, targetEntityId: subject, relationId: 'mediated-permission', relation: 'can-interact' }] })
const native = { ...original.native, ...scenarioCase === 'position' ? { maxDriveSteps: 1 } : {}, relationRules: [...original.native.relationRules,
  { relation: 'can-interact', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false },
  { relation: 'committee-member', subjectKinds: ['person'], objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] }
const resolved: ResolvedWorldScenario = { ...original, native, world, initialEvents: [],
  entities: [...original.entities, ...[subject, 'initial-committee'].map(id => ({ kind: 'entity/create' as const, id,
    entityKind: 'organization', cognition: 'none' as const, readiness: 'ready' as const, profile: { name: id, description: 'Authored original entity.' } }))],
  relations: [...original.relations, { kind: 'relation/create', id: 'mediated-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null },
  { kind: 'relation/create', id: 'original-committee-member', subject: requester.entityId, relation: 'committee-member',
    object: 'initial-committee', scope, validFrom: '0', validUntil: null }] }
const data = { resources: [
  { id: 'supplier-stock', owner: subject, kind: 'inventory', unit: 'widget', quantity: '7', controllers: [] },
  { id: 'supplier-money', owner: subject, kind: 'money', unit: 'credit', quantity: '999', controllers: [director] }],
facts: [{ id: 'director-only-canary', subjectId: scope, scopeId: scope, body: 'PRIVATE-MEDIATED-DIRECTOR-FLOOR-CANARY',
  effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'actors', entityIds: [director] } }],
knowledge: [{ id: 'original-private-belief', ownerId: requester.entityId, body: 'PRIVATE-AUTHORED-BELIEF', observedAt: '0', availableAt: '0',
  validFrom: '0', validUntil: null, readers: [] }],
norms: [{ id: 'original-advisory', scopeId: scope, body: 'An authored initial institution; no committee vote is claimed.',
  effectiveFrom: '0', effectiveUntil: null, availableAt: '10', audience: { kind: 'public' }, enforcement: { kind: 'advisory' } }],
committeePolicies: [{ id: 'initial-committee', name: 'Initial committee', description: 'Actual original independent membership.', scopeId: scope,
  members: [{ id: 'original-committee-member', personId: requester.entityId, validFrom: '0', validUntil: null }],
  rule: { kind: 'unanimity' }, quorum: 1 }],
externalIdentities: [{ scopeId: scope, externalKey: 'mediated-vendor', subjectId: subject, representation: 'director-mediated' }],
behavior: { initialGoals: scenarioCase === 'initial' ? [{ id: 'original-stock-goal', kind: 'goal', at: '1', body: 'stock',
  target: { kind: 'person', personId: requester.entityId } }] : [], directorEvents: [],
calendars: scenarioCase === 'initial' ? [] : [{ id: 'original-stock-calendar', body: 'stock', startsAt: '1', endsAt: '5',
  period: '2', maxOccurrences: 3, target: scenarioCase === 'goal' ? { kind: 'person', personId: requester.entityId }
    : { kind: 'position', positionId: original.world.positions[0]!.entityId } }] } }
const { definitionHash: _oldHash, ...body } = resolved
const hash = `sha256:${createHash('sha256').update(JSON.stringify({ body, data })).digest('hex')}`
Object.assign(resolved, { definitionHash: hash })
const request = simulationWorldBootstrapRequestSchema.parse({ definitionHash: hash, definition: world,
  actorIds: resolved.actors.map(value => value.entityId), data })
const ctx = await boot('world-bootstrap', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `world-bootstrap-${scenarioCase}`, ...native } })
const completeId = simulationCheckpointIdSchema.parse('world-bootstrap-complete')
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: completeId, implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
let connection = restored?.connection
const journal = async (): Promise<LogEntry[]> => {
  const stream = Reflect.get(run, 'stream') as LogStream, entries: LogEntry[] = []
  let after = -1
  while (after < stream.tailSequence) {
    const page = await stream.read(after, 128)
    assert.ok(page.length); entries.push(...page); after = page.at(-1)!.sequence
  }
  return entries
}
const actual = async (state: SimulationSnapshot = run.snapshot()) => {
  const team = await ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
  const channels = await Promise.all(team.channelIds.map(async channelId => ({ channelId,
    records: (await ctx.teams.readChannelPage({ channelId, afterCursor: -1, limit: 128 })).records })))
  const sessions = await Promise.all(Object.values(state.entities).flatMap(entity => entity.binding === undefined ? [] : [(async () => {
    const unmaterialized = await ctx.sessionPersistence.isUnmaterialized(entity.binding!.sessionId)
    return { entityId: entity.id, binding: entity.binding!, unmaterialized,
      events: unmaterialized ? [] : (await ctx.sessionPersistence.readFrom(entity.binding!.sessionId, 0)).events }
  })()]))
  return { team, channels, sessions }
}
try {
  const inputPath = resolve(root, 'world-bootstrap-input.json')
  if (!recovering) await writeFile(inputPath, JSON.stringify({ resolved, request }))
  else assert.deepEqual({ resolved, request }, JSON.parse(await readFile(inputPath, 'utf8')))
  if (!recovering) {
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Original paused Native initialization', budgets: {} },
      budgets: {}, limits: resolved.limits.team }, `world-bootstrap/${scenarioCase}/${hash}`)
    connection = await ctx.simulationTeams.attach(run, team.team.id, `world-bootstrap/${scenarioCase}/${hash}`)
    for (const command of resolved.entities) await run.change(simulationChangeSchema.parse(command), run.snapshot().revision)
    for (const actor of resolved.actors) await connection.ensureParticipant(simulationEntityIdSchema.parse(actor.entityId),
      simulationParticipantSpecSchema.parse({ displayName: actor.persona.name, role: actor.role, capabilities: actor.runtime.capabilities,
        provider: actor.runtime.provider, preset: actor.runtime.preset, model: `${actor.runtime.model.provider}/${actor.runtime.model.name}` }))
    for (const channel of resolved.channels) await connection.ensureChannel(simulationChannelSpecSchema.parse({ ...channel, limits: {} }))
    for (const relation of resolved.relations) await run.change(simulationChangeSchema.parse(relation), run.snapshot().revision)
    const before = run.snapshot(), invalid = structuredClone(request)
    const outside = simTimeSchema.parse(String(BigInt(native.maxTime) + 1n))
    if (scenarioCase === 'initial') invalid.data.behavior.initialGoals[0]!.at = outside
    else {
      invalid.data.behavior.calendars[0]!.startsAt = outside
      invalid.data.behavior.calendars[0]!.endsAt = outside
    }
    await assert.rejects(run.initializeWorld(invalid, before.revision))
    assert.deepEqual(run.snapshot(), before)
    await writeFile(resolve(root, 'world-bootstrap-horizon-rejection.json'), JSON.stringify({ invalid, before, after: run.snapshot() }))
    assert.ok(Object.values(before.entities).filter(value => value.cognition === 'agent').every(value => value.readiness === 'preparing'))
    const initialized = await run.initializeWorld(request, run.snapshot().revision)
    assert.equal(initialized.worldBootstrap?.sequence, before.revision + 1)
    assert.equal(initialized.worldBootstrap.appliedSequence, before.revision + 2)
    const revision = initialized.revision
    assert.deepEqual(await run.initializeWorld(request, before.revision), initialized)
    assert.equal(run.snapshot().revision, revision)
    assert.equal(initialized.phase, 'paused')
    assert.equal(initialized.worldBootstrap?.status, 'applied')
    assert.ok(Object.values(initialized.entities).filter(value => value.cognition === 'agent').every(value => value.readiness === 'ready'))
    assert.equal(initialized.world!.sequence, initialized.worldBootstrap.appliedSequence)
    assert.deepEqual(initialized.world!.intents, {})
    assert.deepEqual(initialized.decisions, {}); assert.deepEqual(initialized.operations, {})
    assert.equal(mediatedModelRequests.length, 0)
    for (const entity of Object.values(initialized.entities)) if (entity.binding !== undefined) {
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(entity.binding.sessionId), true)
      assert.equal(ctx.agents.get(entity.binding.sessionId), undefined)
    }
    const initialCheckpoint = await connection.checkpoint({ id: simulationCheckpointIdSchema.parse('world-bootstrap-initial'),
      implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(initialCheckpoint.status, 'completed')
    await writeFile(resolve(root, 'world-bootstrap-initial.json'), JSON.stringify({ state: run.snapshot(), initialCheckpoint,
      actual: await actual(), journal: await journal(), modelCalls: 0, before }))
    const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
    assert.ok(typeof ownerName === 'string')
    const anchor = { checkpointId: initialCheckpoint.request.id, ownerName, maxDrainRounds: 4, maxAttempts: 3 }
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
    const baseline = structuredClone({ resources: run.snapshot().resources, knowledge: run.snapshot().knowledge,
      norms: run.snapshot().world!.norms, initialFacts: run.snapshot().world!.facts })
    await run.setPhase('running', run.snapshot().revision)
    if (scenarioCase !== 'position') {
      let result = await driver.advance(simTimeSchema.parse('1'))
      for (let step = 0; step < 8 && result.reason === 'work-limit'; step++) result = await driver.advance(simTimeSchema.parse('1'))
      assert.ok(['until', 'idle'].includes(result.reason), JSON.stringify({ result, failures }))
      const state = run.snapshot(), owned = state.world!, worldRequest = Object.values(owned.requests)[0]!
      assert.equal(Object.keys(owned.requests).length, 1)
      assert.equal(worldRequest.requesterEntityId, requesterId)
      assert.equal(worldRequest.proposal.businessKey, 'stock')
      assert.equal(worldRequest.pin.version, '3')
      assert.equal(worldRequest.status, 'committed')
      const adjudication = Object.values(owned.external.adjudications)[0]!
      assert.ok(adjudication.actualPublication)
      const fact = Object.values(owned.facts).flat().find(value => isWorldFactAdjudicated(value))!
      assert.ok(fact && isWorldFactAdjudicated(fact))
      assert.deepEqual(fact.payload.claim, { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known', quantity: '7' } })
      const selected = Object.values(owned.external.identities)[0]!
      assert.equal(selected.source.kind, 'scenario')
      assert.equal(selected.representation, 'director-mediated')
      assert.equal(Object.values(state.operations).filter(value => value.action.kind === 'communication/post').length, 2)
      assert.equal(state.worldBootstrap!.occurrences.length, 1)
      assert.equal(state.worldBootstrap!.occurrences[0]!.source.kind, scenarioCase === 'initial' ? 'initial' : 'calendar')
    } else {
      for (const at of ['1', '3', '5']) {
        for (let step = 0; step < 8 && run.snapshot().worldBootstrap!.occurrences.length < (Number(at) + 1) / 2; step++)
          await run.drive(simulationDriveRequestSchema.parse({ until: at }))
        const state = run.snapshot(), occurrence = state.worldBootstrap!.occurrences.at(-1)!
        assert.equal(occurrence.time, at)
        assert.deepEqual(occurrence.recipients, [at === '1' ? requesterId : replacementId])
        const selectedWake = Object.values(state.scheduledEvents).find(value => value.action.kind === 'wake'
          && value.action.entityId === occurrence.recipients[0] && value.key.time === at && value.status === 'pending')!
        assert.ok(selectedWake)
        // Explicit management cancellation preserves the original selection without claiming productive work or accepting old debt.
        await run.cancelEvent(selectedWake.id, 'Management cancelled the original goal before productive cognition', run.snapshot().revision)
        if (at === '1') {
          const old = Object.values(run.snapshot().relations).find(value => value.relation === 'assignment' && value.subject === requesterId)!
          const { revision, ...fields } = old
          await run.change(simulationChangeSchema.parse({ kind: 'relation/update', ...fields, relationRevision: revision,
            validUntil: '2' }), run.snapshot().revision)
          await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'later-assignment', subject: replacementId,
            relation: 'assignment', object: old.object, scope: old.scope, validFrom: '2', validUntil: null }), run.snapshot().revision)
        }
        const pending = Object.values(run.snapshot().scheduledEvents).filter(value => value.action.kind === 'world-calendar' && value.status === 'pending')
        assert.equal(pending.length, at === '5' ? 0 : 1)
      }
      assert.deepEqual(run.snapshot().worldBootstrap!.occurrences[0]!.recipients, [requesterId])
      assert.equal(mediatedModelRequests.length, 0)
      assert.deepEqual(run.snapshot().world!.intents, {}); assert.deepEqual(run.snapshot().world!.requests, {})
    }
    assert.deepEqual(run.snapshot().resources, baseline.resources)
    assert.deepEqual(run.snapshot().knowledge, baseline.knowledge)
    assert.deepEqual(run.snapshot().world!.norms, baseline.norms)
    for (const [id, values] of Object.entries(baseline.initialFacts))
      assert.deepEqual(run.snapshot().world!.facts[id as keyof typeof baseline.initialFacts], values)
    assert.deepEqual(failures, [])
    const complete = await connection.checkpoint({ id: completeId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })
    assert.equal(complete.status, 'completed')
    await writeFile(resolve(root, 'world-bootstrap-original.json'), JSON.stringify({ state: run.snapshot(), actual: await actual(),
      journal: await journal(), complete, baseline, modelRequests: mediatedModelRequests }))
  }
  assert.ok(connection)
  const state = run.snapshot(), originalProof = JSON.parse(await readFile(resolve(root, 'world-bootstrap-original.json'), 'utf8')) as {
    state: SimulationSnapshot
    actual: Awaited<ReturnType<typeof actual>>
    journal: LogEntry[] }
  assert.equal(state.phase, 'paused')
  if (recovering) {
    for (const field of ['world', 'worldBootstrap', 'resources', 'knowledge', 'relations', 'decisions', 'operations', 'scheduledEvents', 'wakes'] as const)
      assert.deepEqual(state[field], originalProof.state[field])
    assert.deepEqual((await journal()).slice(0, originalProof.journal.length), originalProof.journal)
    const current = await actual()
    assert.deepEqual(current.channels, originalProof.actual.channels)
    for (const originalSession of originalProof.actual.sessions) {
      const session = current.sessions.find(value => value.entityId === originalSession.entityId)!
      assert.deepEqual(session.binding, originalSession.binding)
      assert.equal(session.unmaterialized, originalSession.unmaterialized)
      assert.deepEqual(session.events, originalSession.events)
    }
    assert.equal(mediatedModelRequests.length, 0)
  }
  const book = state.worldBootstrap!
  assert.equal(book.request.definitionHash, hash); assert.deepEqual(book.request.data, request.data)
  assert.equal(book.status, 'applied'); assert.ok(book.sequence < book.appliedSequence!)
  const initialNorm = Object.values(state.world!.norms.versions)[0]![0]!
  assert.equal(initialNorm.origin, 'scenario'); assert.equal(initialNorm.sequence, book.appliedSequence)
  assert.equal(state.world!.governance.proposals && Object.keys(state.world!.governance.proposals).length, 0)
  const records = await journal()
  assert.equal(records.filter(value => (value.value as { kind: string; change?: { kind: string } }).change?.kind === 'world-bootstrap/retained').length, 1)
  assert.equal(records.filter(value => (value.value as { kind: string; change?: { kind: string } }).change?.kind === 'world-bootstrap/applied').length, 1)
  const current = await actual(), canonicalPosts: unknown[] = []
  for (const operation of Object.values(state.operations)) {
    if (operation.action.kind !== 'communication/post') continue
    const receipt = operation.outbox?.receipt
    assert.ok(receipt && operation.delivery?.receipt)
    const accepted = current.channels.flatMap(value => value.records).find(value => value.type === 'channel/envelope' && value.envelope.id === receipt.envelopeId)!
    assert.ok(accepted.type === 'channel/envelope')
    assert.equal(accepted.envelope.senderId, state.entities[operation.entityId]!.binding!.participantId)
    const expected = renderDirectV4EnvelopeInput(accepted.envelope)
    const recipientId = operation.action.recipient
    const recipient = current.sessions.find(value => value.entityId === recipientId)!
    const inbox = recipient.events.flatMap(value => value.type === 'agent/inbox/spliced' ? value.data.inserted.filter(message => message.id === expected.id) : [])
    assert.equal(inbox.length, 1); assert.deepEqual(inbox[0], expected)
    const received = recipient.events.filter(value => value.type === 'user/message' && value.surfaceOp === 'append' && value.data.id === expected.id)
    assert.equal(received.length, 1); assert.deepEqual(received[0]!.data, expected)
    assert.equal(JSON.stringify(accepted.envelope).includes('PRIVATE-MEDIATED-DIRECTOR'), false)
    canonicalPosts.push({ operationId: operation.id, accepted, inbox, received })
  }
  assert.equal(current.sessions.find(value => value.entityId === requesterId)!.events.some(value => JSON.stringify(value).includes('PRIVATE-MEDIATED-DIRECTOR')), false)
  assert.equal(checkpointWorldState(state)!.records.filter(value => value.kind === 'bootstrap').length, 1)
  await writeFile(resolve(root, `world-bootstrap-evidence-${round}.json`), JSON.stringify({ state, actual: current, journal: records, canonicalPosts,
    runtimePaths, execArgv: process.execArgv, modelRequests: mediatedModelRequests }))
  console.log(JSON.stringify({ scenarioCase, phase: 'paused', initializedFromRealSource: true, originalDataRetained: true,
    horizonRejected: true, initialCheckpointInert: true, noPrebuiltIntent: true, originalCanonicalSources: true,
    modelCalls: mediatedModelRequests.length, runtimePaths, execArgv: process.execArgv }))
} catch (error) {
  await writeFile(resolve(root, `world-bootstrap-failure-${round}.json`), JSON.stringify({ failures, state: run.snapshot(), modelRequests: mediatedModelRequests }))
  throw error
} finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
