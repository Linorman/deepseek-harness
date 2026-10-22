/** Real Loader fact publication, public tool reads, exact frozen Session views and fresh-process Native restore. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import { boot } from '@clocky/clocky-app-boot'
import {
  simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationChannelSpecSchema,
  simulationWorldDefinitionSchema, WORLD_GENERATE_AND_HIRE_PIN, simulationContextRequestSchema, simulationDecisionIdSchema,
  simulationCheckpointRequestSchema, simulationCheckpointRestoreRequestSchema, simulationWorldFactRequestSchema,
  simulationWorldFactQuerySchema, WORLD_FACT_TEXT_SCHEMA_REF, worldFactIdSchema, effectiveWorldFact,
  simulationWorldFactTextRequestSchema, isWorldFactText,
  simulationWorldFactAdjudicatedRequestSchema, WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF,
  simulationKnowledgeRequestSchema, simulationPolicyRefSchema, simTimeSchema,
} from '@clocky/clocky-simulation'
import type { SimulationWorldFactTextRequest, SimulationWorldFact, SimulationWorldFactProjection } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { factModelMessages, WorldFactsModel } from './world-facts-model.ts'

const ctx = await boot('world-facts', process.argv[2]!)
const failures: string[] = []
ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)) })
ctx.effect(() => ctx.llm.registerAdapter(['world-facts'], new WorldFactsModel()))
const recovering = process.env.WORLD_FACTS_RECOVER === 'true'
const scopeProbe = process.env.WORLD_SCOPE_ACCESS === 'true'
const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'facts-initial', implementationVersion: 'world-facts/1',
  maxDrainRounds: 4, maxAttempts: 3 })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'world-facts', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
  maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
  maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [
    { relation: 'can-hire', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
    { relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
  ],
} })
const restored = recovering ? await ctx.simulationTeams.restore(selection,
  simulationCheckpointRestoreRequestSchema.parse({ id: checkpoint.id, implementationVersion: checkpoint.implementationVersion,
    maxAttempts: 3 })) : undefined
const run = restored?.run ?? await ctx.simulations.open(selection)
let connection = restored?.connection
const requester = simulationEntityIdSchema.parse('requester'), director = simulationEntityIdSchema.parse('director')
const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-facts-proof.json')
const query = (viewer = requester, ids?: string[]) => simulationWorldFactQuerySchema.parse({ viewer,
  cursor: run.snapshot().revision, time: run.snapshot().time, limit: 32, ...ids === undefined ? {} : { ids } })
const factInput = (id: string, body: string, overrides: Record<string, unknown> = {}): SimulationWorldFactTextRequest =>
  simulationWorldFactTextRequestSchema.parse({ factId: id, version: '1', schemaRef: WORLD_FACT_TEXT_SCHEMA_REF,
    subject: 'organization', scope: 'organization', payload: { body }, effectiveFrom: '0', effectiveUntil: null,
    availableAt: '0', audience: { kind: 'public' }, supersedes: null,
    sources: [{ kind: 'run-event', runId: selection.spec.runId, sequence: run.snapshot().world!.sequence }], ...overrides })
function body(projection: SimulationWorldFactProjection, id: string) {
  return projection.items.flatMap(value => value.fact.factId === id && isWorldFactText(value.fact)
    ? [{ ...value, fact: value.fact }] : [])
}
function viewText(value: { content: readonly { blocks: readonly { type: string; text?: string }[] }[] }) {
  return value.content.flatMap(section => section.blocks.flatMap(block => block.type === 'text' ? [block.text ?? ''] : [])).join('\n')
}


async function rejectUnbackedExternalPublication() {
  const before = run.snapshot()
  const input = simulationWorldFactAdjudicatedRequestSchema.parse({ ...factInput('forged-adjudication', 'unused'),
    schemaRef: WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF, effectiveFrom: before.time, availableAt: before.time,
    payload: { claim: { kind: 'condition', predicate: 'weather', schemaRef: 'weather/1', value: { status: 'rain' } },
      asOf: before.time, provenance: { kind: 'external-adjudication', identityId: 'absent-identity', intentId: 'absent-intent',
        requestId: 'absent-request', planId: 'absent-plan', adjudicationSequence: before.revision + 1,
        policyFingerprint: `sha256:${'a'.repeat(64)}` } } })
  await assert.rejects(run.recordWorldFact(input), { code: 'SIM_WORLD_FACT_SOURCE' })
  assert.deepEqual(run.snapshot(), before)
}

try {
  if (!recovering) {
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Read attributed world facts', budgets: {} }, budgets: {} },
      'world-facts-owner')
    connection = await ctx.simulationTeams.attach(run, team.team.id, 'world-facts-owner')
    for (const [id, entityKind, cognition] of [[requester, 'person', 'agent'], [director, 'person', 'agent'],
      ['organization', 'organization', 'none'], ['position', 'position', 'none'], ['requester-role', 'position', 'none']]) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition, readiness: 'ready', profile: {} }),
        run.snapshot().revision)
    }
    for (const actor of [requester, director]) await connection.ensureParticipant(actor, { displayName: actor, role: actor,
      capabilities: [], provider: 'in-process', preset: 'simulation', model: 'world-facts/scripted' })
    await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'facts-private',
      members: [{ entityId: requester, role: 'requester' }, { entityId: director, role: 'director' }], limits: {} }))
    await run.changeMany([
      simulationChangeSchema.parse({ kind: 'relation/create', id: 'can-hire', subject: requester, relation: 'can-hire',
        object: 'position', scope: 'organization', validFrom: '0', validUntil: null }),
      simulationChangeSchema.parse({ kind: 'relation/create', id: 'employment', subject: requester, relation: 'assignment',
        object: 'requester-role', scope: 'organization', validFrom: '0', validUntil: null }),
    ], run.snapshot().revision)
    await run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], directorEntityId: director, organizationEntityId: 'organization',
      operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: [{ requesterEntityId: requester,
        domain: 'organization', operation: 'generate-and-hire', version: '1', scopeEntityId: 'organization', targetEntityId: 'position',
        relationId: 'can-hire', relation: 'can-hire' }], positions: [{ entityId: 'position', capacity: 1 }],
      authorizations: [{ requesterEntityId: requester, positionEntityId: 'position', relationId: 'can-hire' }],
      templates: [{ id: 'researcher', version: '1', names: ['Lin'], skills: ['analysis'], traits: ['patient'], goals: ['research'],
        description: 'A research colleague.' }], policyVersion: '1',
      limits: { maxRequests: 10,
        maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 10, maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096,
        maxBytesPerPlan: 4096 } }), run.snapshot().revision)
    await rejectUnbackedExternalPublication()
    const manifest = z.strictObject({ facts: z.array(simulationWorldFactTextRequestSchema) }).parse(JSON.parse(await readFile(
      resolve('examples/simulation-company/tests/fixtures/world-facts/input-manifest.json'), 'utf8')))
    const publications = manifest.facts.map(value => ({ ...value, sources: factInput(value.factId, value.payload.body).sources }))
    const firstInput = publications[0]!
    const first = await run.recordWorldFact(firstInput)
    const frozen = structuredClone(first), originalRevision = run.snapshot().revision
    assert.ok(first.recordedAt > 0)
    assert.equal(first.source.kind, 'owner'); assert.equal(first.source.owner, 'world-facts-owner')
    assert.deepEqual(await run.recordWorldFact(firstInput), first)
    assert.equal(run.snapshot().revision, originalRevision)
    await assert.rejects(async () => run.recordWorldFact({ ...firstInput, payload: { body: 'replacement' } }),
      { code: 'SIM_WORLD_FACT_VERSION' })
    for (const publication of publications.slice(1)) await run.recordWorldFact(publication)
    assert.equal(body(run.queryWorldFacts(query()), 'announced')[0]?.effective, 'scheduled')
    assert.deepEqual(run.queryWorldFacts(query(requester, ['unannounced', 'not-present'])).unknown, ['unannounced', 'not-present'])
    const unannounced = effectiveWorldFact(run.snapshot(), worldFactIdSchema.parse('unannounced'), simTimeSchema.parse('0'))
    assert.ok(unannounced !== undefined && isWorldFactText(unannounced))
    assert.equal(unannounced.payload.body, 'unannounced-sentinel')
    assert.equal(body(run.queryWorldFacts(query(director)), 'private').length, 0)
    assert.equal(body(run.queryWorldFacts(query(director)), 'members').length, 0)
    const belief = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'belief', owner: requester, expectedRevision: 0,
      statement: 'belief-is-not-authority', source: { kind: 'belief', profileRevision: 1, policyVersion: '1', confidence: 0.3 },
      observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers: [director] }))
    const summary = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'summary', owner: director, expectedRevision: 0,
      statement: 'director-summary-is-not-authority', source: { kind: 'summary', cursor: run.snapshot().revision,
        policy: simulationPolicyRefSchema.parse({ id: 'fixture-summary', version: '1' }), premises: [{ id: belief.id, revision: belief.revision }] },
      observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null, readers: [requester] }))
    assert.deepEqual(run.queryWorldFacts(query(requester, ['belief', 'summary'])).unknown, ['belief', 'summary'])
    assert.equal(run.queryKnowledge({ viewer: director, cursor: run.snapshot().revision, time: simTimeSchema.parse('0'), limit: 32 })
      .find(value => value.id === summary.id)?.source.kind, 'summary')
    for (const key of ['source', 'recordedAt']) {
      await assert.rejects(async () => run.recordWorldFact({ ...firstInput, [key]: { kind: 'summary', owner: 'director' } }))
    }
    const tooLarge = factInput('too-large', '世界'.repeat(65536))
    const beforeReject = run.snapshot().revision
    await assert.rejects(run.recordWorldFact(tooLarge), { code: 'SIM_WORLD_FACT_LIMIT' })
    await assert.rejects(run.recordWorldFact(factInput('bad-source', 'bad', {
      sources: [{ kind: 'run-event', runId: 'foreign', sequence: 1 }] })), { code: 'SIM_WORLD_FACT_SOURCE' })
    assert.equal(run.snapshot().revision, beforeReject)
    assert.throws(() => run.queryWorldFacts({ ...query(), limit: 1 }), { code: 'SIM_WORLD_FACT_LIMIT' })
    const collected = await connection.checkpoint(checkpoint)
    assert.equal(collected.status, 'completed')
    if (collected.status !== 'completed') throw new Error('Fact checkpoint did not complete')
    const references = collected.manifest.state.world!.records.filter(value => value.kind === 'fact')
    const expectedReferences = Object.values(run.snapshot().world!.facts).flat().map(value => ({ kind: 'fact',
      id: value.factId, version: value.version, sequence: value.sequence,
      fingerprint: `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}` }))
      .toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    assert.deepEqual(references, expectedReferences)
    assert.ok(!JSON.stringify(collected.manifest.state.world).includes('requester-only-sentinel'))
    assert.ok(!JSON.stringify(collected.manifest.state.world).includes('unannounced-sentinel'))
    const leases = []
    for (const actor of [requester, director]) leases.push(await connection.activate(actor, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { options: { provider: 'world-facts', model: 'scripted' } }, signal: new AbortController().signal }))
    const context = () => simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 4,
      personaVersion: 'facts/1', modelVersion: 'scripted/1', sources: [], knowledge: { ids: [belief.id, summary.id], required: true },
      sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
        blocks: [{ type: 'text', text: kind }] })) })
    const requestIntent = async (businessKey: string) => run.openWorldIntent(requester, { kind: 'world/request',
      domain: 'organization', operation: 'generate-and-hire', version: '1', businessKey, expectedTime: null, evidence: [],
      payload: { organizationEntityId: simulationEntityIdSchema.parse('organization'), positionEntityId: simulationEntityIdSchema.parse('position'),
        description: 'Read the actual fact projection.' } })
    const intent = await requestIntent('first')
    await run.setPhase('running', run.snapshot().revision)
    await connection.executeDecision(requester, simulationDecisionIdSchema.parse('first-reader'),
      { ...context(), world: { kind: 'request', intentId: intent.id } })
    const firstView = run.snapshot().decisions[simulationDecisionIdSchema.parse('first-reader')]!.context!
    assert.equal(firstView.status, 'prepared'); if (firstView.status !== 'prepared') throw new Error('Fact view overflowed')
    assert.ok(viewText(firstView.view).includes('original-authoritative'))
    assert.ok(viewText(firstView.view).includes('requester-only-sentinel'))
    assert.ok(!viewText(firstView.view).includes('unannounced-sentinel'))
    assert.ok(viewText(firstView.view).includes('"kind":"belief"'))
    assert.ok(viewText(firstView.view).includes('"kind":"summary"'))
    for (const item of run.queryWorldFacts(query()).items) assert.ok(firstView.view.sources.some(source => source.kind === 'run-event'
      && source.runId === run.snapshot().spec.runId && source.sequence === item.fact.sequence))
    assert.ok(leases[0]!.localAgent!.session.events.some(event => event.type === 'simulation/context-view'
      && JSON.stringify(event.data) === JSON.stringify(firstView.view)))
    assert.ok(factModelMessages.slice(0, 3).every(value => value.includes('original-authoritative') && !value.includes('unannounced-sentinel')))
    const request = Object.values(run.snapshot().world!.requests)[0]!
    await run.drive({ until: simTimeSchema.parse('0') })
    assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    await connection.dispatchOperation(request.notificationOperationId, () => 100)
    const wake = await connection.receiveOperation(request.notificationOperationId)
    await run.drive({ until: simTimeSchema.parse('0') })
    await connection.executeDecision(director, simulationDecisionIdSchema.parse('director-reader'),
      { ...context(), world: { kind: 'resolve', requestId: request.id } }, wake)
    const directorView = run.snapshot().decisions[simulationDecisionIdSchema.parse('director-reader')]!.context!
    assert.equal(directorView.status, 'prepared'); if (directorView.status !== 'prepared') throw new Error('Director facts overflowed')
    assert.ok(!viewText(directorView.view).includes('requester-only-sentinel'))
    assert.ok(!viewText(directorView.view).includes('membership-sentinel'))
    assert.ok(factModelMessages.slice(3, 7).every(value => !value.includes('requester-only-sentinel')))
    assert.equal(Object.keys(run.snapshot().world!.facts).length, 5)
    const oldView = structuredClone(firstView), oldQuery = query()
    await run.drive({ until: simTimeSchema.parse('5') })
    assert.equal(run.snapshot().time, '5')
    const next = await run.recordWorldFact({ ...firstInput, version: simulationWorldFactRequestSchema.parse({ ...firstInput, version: '2' }).version,
      supersedes: { factId: first.factId, version: first.version }, effectiveFrom: simTimeSchema.parse('5'), availableAt: simTimeSchema.parse('5'),
      payload: { body: 'revised-authoritative' } })
    assert.deepEqual(run.snapshot().world!.facts[first.factId]?.[0], frozen)
    assert.deepEqual(run.snapshot().decisions[simulationDecisionIdSchema.parse('first-reader')]?.context, oldView)
    assert.deepEqual(body(run.queryWorldFacts(oldQuery), 'background').map(value => value.fact.payload.body), ['original-authoritative'])
    assert.equal(body(run.queryWorldFacts(query()), 'announced')[0]?.effective, 'effective')
    assert.equal(body(run.queryWorldFacts(query()), 'unannounced')[0]?.effective, 'effective')
    const unchanged = run.snapshot().revision
    await assert.rejects(run.recordWorldFact(factInput('backdated', 'bad')), { code: 'SIM_WORLD_FACT_TIME' })
    await assert.rejects(run.recordWorldFact({ ...firstInput, version: next.version,
      supersedes: { factId: first.factId, version: first.version },
      effectiveFrom: simTimeSchema.parse('5'), availableAt: simTimeSchema.parse('5'), payload: { body: 'changed retry' } }),
    { code: 'SIM_WORLD_FACT_VERSION' })
    assert.equal(run.snapshot().revision, unchanged)
    const secondIntent = await requestIntent('second')
    await connection.executeDecision(requester, simulationDecisionIdSchema.parse('second-reader'),
      { ...context(), world: { kind: 'request', intentId: secondIntent.id } })
    const secondView = run.snapshot().decisions[simulationDecisionIdSchema.parse('second-reader')]!.context!
    assert.equal(secondView.status, 'prepared'); if (secondView.status !== 'prepared') throw new Error('Revised fact view overflowed')
    assert.ok(viewText(secondView.view).includes('revised-authoritative'))
    assert.ok(viewText(secondView.view).includes('unannounced-sentinel'))
    assert.ok(secondView.view.sources.some(source => source.kind === 'run-event' && source.sequence === next.sequence))
    const secondRequest = Object.values(run.snapshot().world!.requests).find(value => value.intentId === secondIntent.id)!
    await run.drive({ until: simTimeSchema.parse('5') })
    assert.ok(secondRequest.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    await connection.dispatchOperation(secondRequest.notificationOperationId, () => 100)
    const secondWake = await connection.receiveOperation(secondRequest.notificationOperationId)
    await run.drive({ until: simTimeSchema.parse('5') })
    const notification = run.snapshot().operations[secondRequest.notificationOperationId]!
    if (notification.action.kind !== 'communication/post') throw new Error('Report must originate in the exact private post')
    const report = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'report', owner: director, expectedRevision: 0,
      statement: notification.action.text, source: { kind: 'report', operationId: notification.id },
      observedAt: notification.delivery!.time, availableAt: '5', validFrom: '5', validUntil: null, readers: [] }))
    assert.equal(report.source.kind, 'report')
    assert.deepEqual(run.queryWorldFacts(query(director, ['report'])).unknown, ['report'])
    await connection.executeDecision(director, simulationDecisionIdSchema.parse('second-director'),
      { ...context(), world: { kind: 'resolve', requestId: secondRequest.id } }, secondWake)
    await run.drive({ until: simTimeSchema.parse('10') })
    assert.equal(run.snapshot().time, '10')
    assert.equal(body(run.queryWorldFacts(query()), 'announced')[0]?.effective, 'historical')
    assert.equal(effectiveWorldFact(run.snapshot(), worldFactIdSchema.parse('announced'), run.snapshot().time), undefined)
    const detached = run.queryWorldFacts(query())
    const visible = detached.items[0]!
    assert.ok(isWorldFactText(visible.fact))
    visible.fact.payload.body = 'caller mutation'
    assert.ok(!JSON.stringify(run.snapshot().world!.facts).includes('caller mutation'))
    if (scopeProbe) {
      const canary = 'UNCONSUMED-SCOPE-CANARY'
      await run.recordWorldFact(factInput('scope-canary', canary, { effectiveFrom: run.snapshot().time,
        availableAt: run.snapshot().time, audience: { kind: 'scope-members' } }))
      const id = simulationDecisionIdSchema.parse('scope-unconsumed'), actor = leases[0]!.localAgent!
      await connection.openDecision(requester, id)
      const prepared = await connection.prepareContext(requester, id, context())
      assert.equal(prepared.status, 'prepared')
      if (prepared.status !== 'prepared') throw new Error('Scope context unexpectedly overflowed')
      assert.deepEqual(prepared.worldScopeAccess, ['organization'])
      assert.ok(viewText(prepared.view).includes(canary))
      assert.equal(JSON.stringify(actor.session.events).includes(canary), false)
      const before = run.snapshot(), historical = query(requester, ['scope-canary'])
      await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'scope-before.json'),
        JSON.stringify({ state: before, events: actor.session.events }, null, 2))
      const position = before.entities[simulationEntityIdSchema.parse('requester-role')]!
      await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: position.id,
        entityRevision: position.revision, phase: 'inactive' }), before.revision)
      assert.equal(run.snapshot().entities[requester]!.revision, before.entities[requester]!.revision)
      await assert.rejects(connection.prepareContext(requester, id, context()), /World material is no longer authorized/)
      await assert.rejects(connection.executeDecision(requester, id, context()), /World material is no longer authorized/)
      assert.equal(factModelMessages.length, 14)
      assert.equal(JSON.stringify(actor.session.events).includes(canary), false)
      assert.deepEqual(run.snapshot().decisions[id]!.context, prepared)
      assert.deepEqual(run.queryWorldFacts(historical).unknown, ['scope-canary'])
      await connection.cancelDecision(requester, id)
      await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, 'scope-after.json'),
        JSON.stringify({ state: run.snapshot(), events: actor.session.events }, null, 2))
    }
    await writeFile(proofPath, JSON.stringify({ facts: run.snapshot().world!.facts,
      firstView: oldView, secondView, knowledge: run.snapshot().knowledge, revision: run.snapshot().revision }))
    console.log(JSON.stringify({ facts: scopeProbe ? 6 : 5, versions: scopeProbe ? 7 : 6, frozenViews: 2,
      ...scopeProbe ? { scopeRevocation: true } : {}, privateAudience: true, sourceFrozen: true,
      beliefSeparate: true, unauthorizedToolRejected: true, intervalBoundaries: true, modelCalls: factModelMessages.length }))
  } else {
    const proof = JSON.parse(await readFile(proofPath, 'utf8')) as {
      facts: Record<string, SimulationWorldFact[]>
      firstView: unknown
      secondView: unknown
      knowledge: unknown
      revision: number
    }
    const state = run.snapshot()
    assert.equal(state.phase, 'paused')
    assert.deepEqual(state.world!.facts, proof.facts)
    assert.deepEqual(state.knowledge, proof.knowledge)
    assert.deepEqual(state.decisions[simulationDecisionIdSchema.parse('first-reader')]?.context, proof.firstView)
    assert.deepEqual(state.decisions[simulationDecisionIdSchema.parse('second-reader')]?.context, proof.secondView)
    assert.equal(factModelMessages.length, 0)
    if (scopeProbe) assert.deepEqual(run.queryWorldFacts(query(requester, ['scope-canary'])).unknown, ['scope-canary'])
    await rejectUnbackedExternalPublication()
    assert.ok(!JSON.stringify(run.queryWorldFacts(query(director))).includes('requester-only-sentinel'))
    console.log(JSON.stringify({ facts: scopeProbe ? 6 : 5, versions: scopeProbe ? 7 : 6, frozenViews: 2,
      ...scopeProbe ? { scopeRevocation: true } : {}, privateAudience: true, sourceFrozen: true,
      beliefSeparate: true, unauthorizedToolRejected: true, intervalBoundaries: true, modelCalls: 0 }))
  }
} catch (cause) {
  const decisions = Object.values(run.snapshot().decisions).map(decision => ({ id: decision.id, status: decision.status,
    context: decision.context?.status, actor: decision.entityId }))
  const toolErrors = Object.values(run.snapshot().entities).flatMap((entity) => {
    const agent = entity.binding === undefined ? undefined : ctx.agents.get(entity.binding.sessionId)
    return agent?.session.events.filter(event => event.type === 'tool/result').flatMap(event => event.data.message.content)
      .filter(block => block.type === 'tool-result' && block.isError) ?? []
  })
  throw new Error(JSON.stringify({ decisions, failures, toolErrors, modelCalls: factModelMessages.length }), { cause })
} finally { await connection?.close(); await run.close(); await ctx.fiber.dispose() }
