/** Actual mediated Agent/tool/driver effects and original canonical notifications survive an independent cold restore. */
import assert from 'node:assert/strict'
import { verifyCheckpointWorldCoverage } from './checkpoint-world-coverage.ts'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simulationWorldDefinitionSchema,
  WORLD_EXTERNAL_MEDIATED_PIN, simulationEntityIdSchema, simulationEventIdSchema, simulationWorldGoalSchema, simulationWakeRequestSchema,
  simulationResourceSpecSchema, simulationWorldFactRequestSchema, WORLD_FACT_TEXT_SCHEMA_REF,
  simulationWorldFactAdjudicatedRequestSchema, WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF, simulationWorldDomainRequestSchema,
  simulationExternalMediatedResultSchema, simulationExternalAdjudicationSchema, isWorldFactAdjudicated,
  simTimeSchema, checkpointWorldState } from '@clocky/clocky-simulation'
import { compileWorldScenario, worldScenarioSchema } from '@clocky/clocky-simulation-scenario'
import type { ResolvedWorldScenario } from '@clocky/clocky-simulation-scenario'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { SimulationWorldDriver, ExternalMediatedWorldExecution } from '@clocky/clocky-simulation-world'
import { renderDirectV4EnvelopeInput } from '@clocky/clocky-team-agent-client'
import { catalog } from '../../../packages/simulation/simulation-scenario/tests/fixtures.ts'
import { mediatedModelRequests } from './world-external-mediated-model.ts'

const scene = process.env.WORLD_SCENARIO ?? 'company', scenarioCase = process.env.WORLD_MEDIATED_CASE ?? 'facts'
const recovering = process.env.WORLD_MEDIATED_RECOVER === 'true'
const launchMode = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
assert.ok(['src', 'lib'].includes(launchMode))
const runtimePaths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world']
  .map(name => [name, import.meta.resolve(name)]))
for (const path of Object.values(runtimePaths)) assert.ok(path.includes(launchMode === 'lib' ? '/lib/' : '/src/'), path)
if (launchMode === 'lib') {
  assert.equal(process.execArgv.some(value => value === '--import' || value.startsWith('--import=')), false)
  assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false)
}

assert.ok(['company', 'laboratory'].includes(scene))
assert.ok(['facts', 'report', 'report-preflight', 'failure', 'delayed', 'fact-conflict', 'stock-conflict', 'money-private', 'bootstrap-private', 'delayed-blocked'].includes(scenarioCase))
const negative = ['fact-conflict', 'stock-conflict', 'money-private'].includes(scenarioCase)
const definition = worldScenarioSchema.parse(JSON.parse(await readFile(resolve(`examples/simulation-company/scenarios/world-${scene}.json`), 'utf8')))
const installed = catalog()
installed.runtimeProfiles[0]!.model = { provider: 'world-external-mediated-scripted', name: 'scripted', version: '1', available: true }
const compiled = await compileWorldScenario(definition, installed)
assert.ok(compiled.ok)
const original = compiled.resolved, requester = original.actors.find(value => value.role === 'member' && original.relations.some(
  relation => relation.relation === 'assignment' && relation.subject === value.entityId))!
assert.ok(requester)
const scope = original.world.organizationEntityId, subject = 'external-mediated-supplier'
const world = simulationWorldDefinitionSchema.parse({ ...original.world,
  limits: { ...original.world.limits, maxBytesPerPlan: Number(process.env.WORLD_MEDIATED_PLAN_BYTES ?? '16384') },
  operations: [...original.world.operations, WORLD_EXTERNAL_MEDIATED_PIN],
  externalAdjudicationPolicy: { ref: 'clocky.external.adjudication/1', version: '1', generation: 1,
    conditionInstalls: ['weather', 'lead-time', 'meeting-status'], futureConditionInstalls: ['lead-time'],
    allowedOutcomeKinds: ['environmental-fact', 'unverified-report', 'failure', 'delayed-event'], maxDelay: '10',
    allowPublicDisclosure: false, allowScopeDisclosure: false, actorDisclosure: [] },
  operationGrants: [...original.world.operationGrants, { requesterEntityId: requester.entityId,
    domain: 'external', operation: 'interact', version: '3', scopeEntityId: scope, targetEntityId: subject,
    relationId: 'mediated-permission', relation: 'can-interact' }] })
const resolved: ResolvedWorldScenario = { ...original, world, initialEvents: [],
  entities: [...original.entities, { kind: 'entity/create', id: subject, entityKind: 'organization', cognition: 'none',
    readiness: 'ready', profile: { name: 'Mediated supplier', description: 'A finite simulated external subject.' } }],
  native: { ...original.native, relationRules: [...original.native.relationRules, { relation: 'can-interact', subjectKinds: ['person'],
    objectKinds: ['organization'], scopeKinds: ['organization'], acyclic: false }] },
  relations: [...original.relations, { kind: 'relation/create', id: 'mediated-permission', subject: requester.entityId,
    relation: 'can-interact', object: subject, scope, validFrom: '0', validUntil: null }] }
const { definitionHash: _oldHash, ...body } = resolved
Object.assign(resolved, { definitionHash: `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('hex')}` })
const ctx = await boot('world-external-mediated', process.argv[2]!), failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(String(error)) })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create',
  spec: { runId: `mediated-${scene}-${scenarioCase}`, ...resolved.native } })
const checkpointId = simulationCheckpointIdSchema.parse('mediated-complete')
const restored = recovering ? await ctx.simulationTeams.restore(selection, { id: checkpointId,
  implementationVersion: 'world/1', maxAttempts: 3 }) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
const root = resolve(process.env.SIMULATION_COMPANY_ROOT!), proofPath = resolve(root, 'mediated-original.json')
const privateCanaries = ['PRIVATE-MEDIATED-DIRECTOR-FLOOR-CANARY', 'PRIVATE-MEDIATED-DIRECTOR-RATIONALE']
let connection = restored?.connection
try {
  if (!recovering) await writeFile(resolve(root, 'mediated-input.json'), JSON.stringify(resolved))
  else assert.deepEqual(resolved, JSON.parse(await readFile(resolve(root, 'mediated-input.json'), 'utf8')))
  const prepared = recovering ? undefined : await prepareSimulationWorld(ctx.simulationTeams, run, { resolved,
    ownerName: `mediated/${scene}/${scenarioCase}`, checkpoint: { id: simulationCheckpointIdSchema.parse('mediated-initial'),
      maxDrainRounds: 4, maxAttempts: 3 } })
  const team = run.snapshot().teamReservation!, ownerName = team.creation.rules['activationLifecycleOwner']
  assert.equal(typeof ownerName, 'string')
  if (typeof ownerName !== 'string') throw new Error('Mediation lost its original Native Team owner')
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
  const requesterId = simulationEntityIdSchema.parse(requester.entityId), director = world.directorEntityId
  const material = () => ({ external: run.snapshot().world!.external, facts: run.snapshot().world!.facts,
    intents: run.snapshot().world!.intents, requests: run.snapshot().world!.requests, plans: run.snapshot().world!.plans,
    results: run.snapshot().world!.results, mutations: run.snapshot().world!.mutations, resources: run.snapshot().resources,
    commitments: run.snapshot().commitments, interactions: run.snapshot().interactions,
    contexts: Object.values(run.snapshot().decisions).filter(value => value.context?.status === 'prepared')
      .map(value => ({ id: value.id, context: value.context })) })
  async function rejectForgedPublication() {
    const before = run.snapshot()
    const actual = Object.values(before.world!.external.adjudications)
      .find(value => value.actualPublication !== undefined)?.actualPublication
    const input = simulationWorldFactAdjudicatedRequestSchema.parse(actual === undefined ? {
      factId: 'forged-origin', version: '1', schemaRef: WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF, subject, scope,
      effectiveFrom: before.time, effectiveUntil: null, availableAt: before.time, supersedes: null,
      audience: { kind: 'actors', entityIds: [requesterId] },
      sources: [{ kind: 'run-event', runId: before.spec.runId, sequence: before.world!.sequence }], payload: {
        claim: { kind: 'condition', predicate: 'weather', schemaRef: 'weather/1', value: { status: 'rain' } }, asOf: before.time,
        provenance: { kind: 'external-adjudication', identityId: 'absent-identity', intentId: 'absent-intent', requestId: 'absent-request',
          planId: 'absent-plan', adjudicationSequence: before.revision, policyFingerprint: `sha256:${'a'.repeat(64)}` } },
    } : { ...actual, factId: 'borrowed-origin-forgery', effectiveFrom: before.time, availableAt: before.time })
    await assert.rejects(run.recordWorldFact(input), { code: 'SIM_WORLD_FACT_SOURCE' })
    assert.deepEqual(run.snapshot(), before)
  }
  if (!recovering) {
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-stock', owner: subject, kind: 'inventory', unit: 'widget',
      quantity: '7', controllers: [] }), run.snapshot().revision)
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'supplier-money', owner: subject, kind: 'money', unit: 'credit',
      quantity: '999', controllers: scenarioCase === 'money-private' ? [] : [director] }), run.snapshot().revision)
    await run.recordWorldFact(simulationWorldFactRequestSchema.parse({ factId: 'director-only-canary', version: '1',
      schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, subject: scope, scope, payload: { body: privateCanaries[0] }, effectiveFrom: '0',
      effectiveUntil: null, availableAt: '0', audience: { kind: 'actors', entityIds: [director] }, supersedes: null,
      sources: [{ kind: 'run-event', runId: selection.spec.runId, sequence: run.snapshot().world!.sequence }] }))
    const baseline = { resources: run.snapshot().resources, commitments: run.snapshot().commitments,
      interactions: run.snapshot().interactions }
    await run.setPhase('running', run.snapshot().revision)
    const modes = scenarioCase === 'report-preflight' ? ['report'] : scenarioCase === 'bootstrap-private' ? ['failure']
      : scenarioCase === 'delayed-blocked' ? ['delayed-blocked', 'lead-current']
        : scenarioCase === 'facts' ? ['weather-first', 'weather-second', 'stock', 'money-control']
          : scenarioCase === 'fact-conflict' ? ['weather-first', 'weather-second', 'lead-current', 'fact-conflict']
            : scenarioCase === 'stock-conflict' ? ['stock', 'stock-conflict'] : [scenarioCase]
    const stops: unknown[] = []
    for (const mode of modes) {
      const bootstrap = scenarioCase === 'bootstrap-private' ? await run.openWorldIntent(requesterId, simulationWorldDomainRequestSchema.parse({
        kind: 'world/request', domain: 'external', operation: 'interact', version: '3', businessKey: mode, expectedTime: null, evidence: [],
        payload: { scope, subjectRef: subject, externalKey: 'mediated-vendor', sourceKind: 'director-mediated',
          policyRef: 'clocky.external.adjudication/1', input: { kind: 'adjudicate', question: mode },
          responseScope: { allowed: ['environmental-fact', 'unverified-report', 'failure', 'delayed-event'], disclosure: { kind: 'requester' } } },
      })) : undefined
      const wake = simulationWakeRequestSchema.parse({ id: bootstrap === undefined ? `mediated-goal-${mode}` : `world-initial:${bootstrap.id}`,
        entityId: requesterId, time: String(BigInt(run.snapshot().time) + 1n), reason: bootstrap === undefined
          ? JSON.stringify(simulationWorldGoalSchema.parse({ kind: 'world-goal', version: 1, goal: mode })) : 'Open the original bounded mediation request.' })
      await run.scheduleWake(wake, run.snapshot().revision)
      try {
        let result = await driver.advance(wake.time)
        for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(wake.time)
        stops.push({ mode, result })
        if (!negative || mode !== scenarioCase) assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify({ result, failures }))
      } catch (error: unknown) {
        const rawCode: unknown = error !== null && typeof error === 'object' ? Reflect.get(error, 'code') : undefined
        stops.push({ mode, error: { name: error instanceof Error ? error.name : 'unknown', message: String(error),
          code: typeof rawCode === 'string' ? rawCode : undefined } })
        if (!negative || mode !== scenarioCase) throw error
      }
    }
    if (scenarioCase === 'delayed' || scenarioCase === 'delayed-blocked') {
      const duty = Object.values(run.snapshot().world!.external.events)[0]
      assert.ok(duty)
      assert.equal(duty.status, 'scheduled')
      assert.equal(Object.values(run.snapshot().world!.facts).flat().filter(isWorldFactAdjudicated).length, scenarioCase === 'delayed' ? 0 : 1)
      const beforeTime = String(BigInt(duty.original.deliverAt) - 1n)
      const before = await driver.advance(simTimeSchema.parse(beforeTime))
      assert.ok(['idle', 'until'].includes(before.reason), JSON.stringify(before))
      assert.equal(run.snapshot().world!.external.events[duty.original.eventId]!.status, 'scheduled')
      assert.equal(Object.values(run.snapshot().world!.facts).flat().filter(isWorldFactAdjudicated).length, scenarioCase === 'delayed' ? 0 : 1)
      await writeFile(resolve(root, 'mediated-pending-event.json'), JSON.stringify(run.snapshot()))
      let result = await driver.advance(duty.original.deliverAt)
      for (let round = 0; round < 8 && result.reason === 'work-limit'; round++) result = await driver.advance(duty.original.deliverAt)
      if (scenarioCase === 'delayed') {
        assert.ok(['idle', 'until'].includes(result.reason), JSON.stringify({ result, failures }))
        assert.equal(run.snapshot().world!.external.events[duty.original.eventId]!.status, 'consumed')
      } else {
        assert.equal(run.snapshot().stall?.code, 'SIM_EXTERNAL_ADJUDICATION_BLOCKED')
        const blocked = run.snapshot().world!.external.events[duty.original.eventId]!
        assert.equal(blocked.status, 'blocked')
        assert.equal(blocked.blocks.at(-1)?.code, 'fact-conflict')
        assert.equal(blocked.consumption, undefined)
        assert.equal(run.snapshot().scheduledEvents[duty.original.eventId]!.status, 'pending')
        assert.equal(Object.values(run.snapshot().world!.facts).flat().filter(isWorldFactAdjudicated).length, 1)
        await writeFile(resolve(root, 'mediated-blocked-event.json'), JSON.stringify(run.snapshot()))
      }
    }
    assert.deepEqual(run.snapshot().resources, baseline.resources)
    assert.deepEqual(run.snapshot().commitments, baseline.commitments)
    assert.deepEqual(run.snapshot().interactions, baseline.interactions)
    await rejectForgedPublication()
    if (negative) {
      const rejected = Object.values(run.snapshot().world!.requests).find(value => value.proposal.businessKey === scenarioCase)
      assert.ok(rejected)
      const actual = Object.values(run.snapshot().world!.external.adjudications).find(value => value.intentId === rejected.intentId)
      if (scenarioCase === 'money-private') {
        assert.equal(actual, undefined)
        assert.equal(Object.values(run.snapshot().world!.results).some(value => value.intentId === rejected.intentId), false)
      } else {
        assert.equal(actual?.proposal.outcome.kind, 'failure')
        const directorSession = await ctx.sessionPersistence.readFrom(run.snapshot().entities[director]!.binding!.sessionId, 0)
        const errors = directorSession.events.filter(value => value.type === 'tool/result').flatMap(value => value.data.message.content)
          .filter(value => value.type === 'tool-result' && value.isError)
        assert.ok(errors.length > 0, 'The actual rejected proposal must retain its original error tool receipt')
        assert.equal(Object.values(run.snapshot().world!.facts).flat().filter(isWorldFactAdjudicated).some(value =>
          value.payload.claim.kind === 'inventory-as-of' && value.payload.claim.availability.status === 'known'
            && value.payload.claim.availability.quantity === '8'), false)
      }
      await writeFile(resolve(root, 'mediated-rejection.json'), JSON.stringify({ stops, failures, request: rejected,
        decisions: run.snapshot().decisions, operations: run.snapshot().operations }))
    } else assert.deepEqual(failures, [])
    assert.equal((await connection.checkpoint({ id: checkpointId, implementationVersion: 'world/1', maxDrainRounds: 4, maxAttempts: 3 })).status,
      'completed')
    if (process.env.WORLD_CHECKPOINT_COVERAGE === 'true') await verifyCheckpointWorldCoverage(run, root)
    const sessions = await Promise.all(Object.values(run.snapshot().entities).flatMap(value => value.binding === undefined ? [] : [
      (async () => {
        const unmaterialized = await ctx.sessionPersistence.isUnmaterialized(value.binding!.sessionId)
        return { entityId: value.id, binding: value.binding, unmaterialized,
          ...unmaterialized ? {} : { events: (await ctx.sessionPersistence.readFrom(value.binding!.sessionId, 0)).events } }
      })() ]))
    await writeFile(proofPath, JSON.stringify({ material: material(), sessions }))
  } else {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      material: unknown
      sessions: Array<{ entityId: string; binding: { sessionId: string }; unmaterialized: boolean; events?: unknown[] }> }
    assert.deepEqual(material(), proof.material)
    for (const stored of proof.sessions) {
      const binding = run.snapshot().entities[simulationEntityIdSchema.parse(stored.entityId)]!.binding!
      assert.equal(binding.sessionId, stored.binding.sessionId)
      assert.equal(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId), stored.unmaterialized)
      if (!stored.unmaterialized) assert.deepEqual((await ctx.sessionPersistence.readFrom(binding.sessionId, 0)).events, stored.events)
    }
    await rejectForgedPublication()
    assert.equal(mediatedModelRequests.length, 0)
  }
  const state = run.snapshot(), owned = state.world!, adjudications = Object.values(owned.external.adjudications)
  const facts = Object.values(owned.facts).flat().filter(isWorldFactAdjudicated)
  assert.ok(Object.values(state.decisions).some(value => value.entityId === director && value.context?.status === 'prepared'
    && value.context.world?.kind === 'resolve' && JSON.stringify(value.context.view).includes(privateCanaries[0]!)))
  assert.equal(state.phase, 'paused')
  assert.equal(Object.keys(owned.external.identities).length, 1)
  assert.equal(state.entities[simulationEntityIdSchema.parse(subject)]!.cognition, 'none')
  assert.equal(Object.keys(owned.external.representatives).length, 0)
  assert.equal(Object.keys(owned.external.contacts).length, 0)
  for (const record of adjudications) {
    assert.equal(record.basis.actorId, director)
    assert.equal(record.basis.kind, 'model')
    const plan = owned.plans[record.planId]!
    assert.ok(plan.operationId !== null)
    const operation = state.operations[plan.operationId]!
    const decision = state.decisions[operation.decisionId]!
    assert.equal(record.basis.decisionId, decision.id)
    assert.equal(record.basis.contextFingerprint, decision.context!.fingerprint)
    const result = Object.values(owned.results).find(value => value.intentId === record.intentId)!
    assert.equal(result.sequence, record.sequence)
    const parsedResult = simulationExternalMediatedResultSchema.parse(result.payload)
    assert.ok('identityId' in parsedResult)
    assert.equal(parsedResult.identityId, record.identityId)
    if (record.actualPublication !== undefined) assert.deepEqual(owned.facts[record.actualPublication.factId]!.at(-1)?.payload,
      record.actualPublication.payload)
  }
  if (scenarioCase === 'facts') {
    assert.equal(facts.length, 4)
    assert.equal(adjudications.length, 4)
    assert.equal(facts.filter(value => value.payload.claim.kind === 'condition').length, 2)
    const stock = facts.find(value => value.payload.claim.kind === 'inventory-as-of')!
    assert.deepEqual(stock.payload.claim, { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known', quantity: '7' } })
    assert.ok(facts.some(value => value.payload.claim.kind === 'balance-as-of' && value.payload.claim.quantity === '999'))
  } else if (scenarioCase === 'report' || scenarioCase === 'report-preflight') {
    assert.equal(facts.length, 0)
    assert.equal(adjudications[0]!.proposal.outcome.kind, 'unverified-report')
    assert.equal(adjudications[0]!.actualPublication, undefined)
    const raw = adjudications[0]!.proposal.outcome
    assert.ok(raw.kind === 'unverified-report')
    assert.equal(raw.statement, privateCanaries[0])
  } else if (scenarioCase === 'failure' || scenarioCase === 'bootstrap-private') {
    assert.equal(facts.length, 0)
    const raw = adjudications[0]!.proposal.outcome
    assert.ok(raw.kind === 'failure')
    assert.equal(raw.description, privateCanaries[0])
  }
  else if (scenarioCase === 'delayed') {
    assert.equal(adjudications.length, 1)
    assert.equal(adjudications[0]!.actualPublication, undefined)
    assert.equal(facts.length, 1)
    const duty = Object.values(owned.external.events)[0]!
    assert.equal(duty.status, 'consumed')
    assert.ok(duty.original.key.includes(privateCanaries[0]!))
    assert.equal(duty.original.eventId.includes(privateCanaries[0]!), false)
    assert.equal(duty.consumption!.time, duty.original.deliverAt)
    assert.equal(state.scheduledEvents[duty.original.eventId]!.status, 'consumed')
    const followup = state.scheduledEvents[simulationEventIdSchema.parse(`simulation-external-adjudication-result:${duty.original.eventId}`)]!
    assert.equal(followup.action.kind, 'wake')
    if (followup.action.kind !== 'wake') throw new Error('Delayed leaf lost its canonical notification wake')
    assert.equal(followup.action.entityId, director)
    assert.equal(followup.key.time, duty.consumption!.time)
    assert.equal(facts[0]!.payload.provenance.adjudicationSequence, adjudications[0]!.sequence)
    assert.deepEqual(facts[0]!.payload.provenance.event, { eventId: duty.original.eventId, consumedSequence: duty.consumption!.sequence })
  }
  if (scenarioCase === 'fact-conflict') {
    assert.equal(facts.length, 3)
    assert.equal(facts.filter(value => value.payload.claim.kind === 'condition' && value.payload.claim.predicate === 'weather').length, 2)
    assert.equal(facts.some(value => value.payload.claim.kind === 'condition' && value.payload.claim.predicate === 'weather'
      && value.payload.claim.value.status === 'clear'), false)
  }
  if (scenarioCase === 'delayed-blocked') {
    const blocked = Object.values(owned.external.events)[0]!
    assert.equal(blocked.status, 'blocked')
    assert.ok(blocked.original.key.includes(privateCanaries[0]!))
    assert.equal(blocked.original.eventId.includes(privateCanaries[0]!), false)
    assert.equal(blocked.consumption, undefined)
    assert.equal(blocked.blocks.at(-1)?.code, 'fact-conflict')
    assert.equal(state.scheduledEvents[blocked.original.eventId]!.status, 'pending')
    assert.equal(state.scheduledEvents[simulationEventIdSchema.parse(`simulation-external-adjudication-result:${blocked.original.eventId}`)], undefined)
    assert.equal(facts.length, 1)
  }
  if (scenarioCase === 'bootstrap-private') {
    const requestDecision = Object.values(state.decisions).find(value => value.entityId === requesterId
      && value.context?.status === 'prepared' && value.context.world?.kind === 'request')
    const directorDecision = Object.values(state.decisions).find(value => value.entityId === director
      && value.context?.status === 'prepared' && value.context.world?.kind === 'resolve')
    assert.ok(requestDecision?.context?.status === 'prepared' && directorDecision?.context?.status === 'prepared')
    const frames = (view: import('@clocky/clocky-session/types').SimulationContextViewEventData) => view.content.flatMap(section =>
      section.blocks.flatMap(block => block.type === 'text' && block.text.trimStart().startsWith('{')
        ? [JSON.parse(block.text) as Record<string, unknown>] : [])).filter(value => value.kind === 'world-context')
    const requesterFrame = frames(requestDecision.context.view)[0]!, directorFrame = frames(directorDecision.context.view)[0]!
    const balances = z.array(z.object({ id: z.string(), quantity: z.string() }))
    assert.equal(balances.parse(requesterFrame.balances).some(value => value.id === 'supplier-money'), false)
    assert.deepEqual(balances.parse(directorFrame.balances).find(value => value.id === 'supplier-money'),
      { id: 'supplier-money', quantity: '999' })
    const requesterView = requestDecision.context.view
    const stored = await ctx.sessionPersistence.readFrom(state.entities[requesterId]!.binding!.sessionId, 0)
    const consumed = stored.events.find(value => value.type === 'simulation/context-view'
      && value.data.inputId === requesterView.inputId)
    assert.ok(consumed?.type === 'simulation/context-view')
    assert.deepEqual(consumed.data, requestDecision.context.view)
    assert.equal(JSON.stringify(consumed.data).includes(privateCanaries[0]!), false)
    await writeFile(resolve(root, recovering ? 'bootstrap-cold-view.json' : 'bootstrap-create-view.json'), JSON.stringify({
      requestDecision, directorDecision, actualRequesterViewEvent: consumed }))
  }
  const canonicalPosts: unknown[] = []
  for (const post of Object.values(state.operations).filter(value => value.action.kind === 'communication/post')) {
    if (post.action.kind !== 'communication/post') throw new Error('Canonical proof requires a communication operation')
    assert.ok(post.delivery?.receipt && post.outbox?.receipt)
    const receipt = post.outbox.receipt, sender = state.entities[post.entityId]!, recipient = state.entities[post.action.recipient]!
    const page = await ctx.teams.readChannelPage({ channelId: receipt.channelId, afterCursor: -1, limit: 32 })
    const accepted = page.records.find(value => value.type === 'channel/envelope' && value.envelope.id === receipt.envelopeId)
    assert.ok(accepted?.type === 'channel/envelope')
    assert.equal(accepted.envelope.senderId, sender.binding!.participantId)
    const expected = renderDirectV4EnvelopeInput(accepted.envelope)
    const stored = await ctx.sessionPersistence.readFrom(recipient.binding!.sessionId, 0)
    const received = stored.events.filter(value => value.type === 'user/message' && value.surfaceOp === 'append' && value.data.id === expected.id)
    assert.equal(received.length, 1)
    assert.deepEqual(received[0]!.data, expected)
    if (post.entityId === director) assert.equal(post.action.recipient, requesterId)
    for (const canary of privateCanaries) assert.equal(JSON.stringify(accepted.envelope).includes(canary), false)
    canonicalPosts.push({ operationId: post.id, actor: post.entityId, accepted, received: received[0] })
  }
  const requesterEvents = (await ctx.sessionPersistence.readFrom(state.entities[requesterId]!.binding!.sessionId, 0)).events
  for (const canary of privateCanaries) {
    assert.equal(JSON.stringify(owned.results).includes(canary), false)
    assert.equal(JSON.stringify(requesterEvents).includes(canary), false)
  }
  const journal: unknown[] = [], stream = Reflect.get(run, 'stream') as import('@clocky/clocky-storage').LogStream
  let after = -1
  while (after < stream.tailSequence) {
    const entries = await stream.read(after, 128)
    assert.ok(entries.length)
    journal.push(...entries)
    after = entries.at(-1)!.sequence
  }
  const actual = journal.flatMap((value) => {
    const parsed = z.object({ sequence: z.number(), value: z.object({ kind: z.literal('run/world-mutation'),
      change: z.object({ externalAdjudication: simulationExternalAdjudicationSchema }) }) }).safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
  assert.deepEqual(actual.map(value => value.value.change.externalAdjudication), adjudications)
  await writeFile(resolve(root, recovering ? 'mediated-cold-evidence.json' : 'mediated-create-evidence.json'), JSON.stringify({
    state, journal, canonicalPosts, requesterEvents, runtime: { launchMode, runtimePaths, execArgv: process.execArgv,
      nodeVersion: process.version, fixtureSourceNativeTypeStripping: launchMode === 'lib' }, modelRequests: mediatedModelRequests, checkpointWorld: checkpointWorldState(state) }))
  console.log(JSON.stringify({ scene, scenarioCase, phase: state.phase, identities: 1, adjudications: adjudications.length,
    facts: facts.length, events: Object.keys(owned.external.events).length, canonicalPosts: canonicalPosts.length,
    resourcesUnchanged: true, forgedSourceRejected: true, privateCanariesExcluded: true, originalPrefix: true,
    negativeRetained: scenarioCase === 'money-private' || scenarioCase === 'delayed-blocked', invalidClaimRejected: negative, modelCalls: mediatedModelRequests.length }))
} catch (error) {
  await writeFile(resolve(root, 'mediated-failure-state.json'), JSON.stringify({ state: run.snapshot(), failures, modelRequests: mediatedModelRequests }))
  console.error(JSON.stringify({ failures, name: error instanceof Error ? error.name : 'unknown', message: String(error) }))
  throw error
}
finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
