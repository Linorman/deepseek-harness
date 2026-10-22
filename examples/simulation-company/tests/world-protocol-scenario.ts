import { simulationWorldHirePlanPayloadSchema } from '@clocky/clocky-simulation'
import { seedHiringIntent } from './world-domain-input.ts'
import { WORLD_GENERATE_AND_HIRE_PIN } from '@clocky/clocky-simulation'
/** Loader world protocol proof: accepted plans survive restart without hiring or replay inference. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { boot } from '@clocky/clocky-app-boot'
import {
  simulationChangeSchema, simulationChannelSpecSchema, simulationContextRequestSchema, simulationDecisionIdSchema,
  simulationEntityIdSchema, simulationHireIntentRequestSchema, simulationRunSelectionSchema,
  simulationWorldDefinitionSchema, simulationCheckpointRequestSchema, simulationCheckpointRestoreRequestSchema, simTimeSchema,
  simulationWorldCancelRequestSchema,
} from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { requests } from './world-protocol-model.ts'

const ctx = await boot('world-protocol', process.argv[2]!)
const recovering = process.env.WORLD_RECOVER === 'true'
const terminal = process.env.WORLD_TERMINAL ?? 'pending'
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'world-company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
  maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
  maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000',
  relationRules: [
    { relation: 'can-hire', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
    { relation: 'assignment', subjectKinds: ['person'], objectKinds: ['position'], scopeKinds: ['organization'], acyclic: true },
  ],
} })
const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'world-initial', implementationVersion: 'world-protocol/1',
  maxDrainRounds: 4, maxAttempts: 3 })
const run = recovering ? (await ctx.simulationTeams.restore(selection, simulationCheckpointRestoreRequestSchema.parse({
  id: checkpoint.id, implementationVersion: checkpoint.implementationVersion, maxAttempts: 3,
}))).run : await ctx.simulations.open(selection)
const requester = simulationEntityIdSchema.parse('requester')
const director = simulationEntityIdSchema.parse('director')
const proofPath = resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-plan.json')
const context = () => simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 4,
  personaVersion: '1', modelVersion: 'scripted-1', sources: [],
  sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
    blocks: [{ type: 'text', text: kind }] })),
})
try {
  if (!recovering) {
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Staff one company position', budgets: {} }, budgets: {} },
      'simulation/world-company')
    const teamId = team.team.id
    const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/world-company')
    for (const [id, entityKind, cognition] of [
      [requester, 'person', 'agent'], [director, 'person', 'agent'], ['organization', 'organization', 'none'], ['position', 'position', 'none'], ['requester-role', 'position', 'none'],
    ]) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind, cognition, readiness: 'ready', profile: {} }),
        run.snapshot().revision)
    }
    for (const id of [requester, director]) {
      await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [], provider: 'in-process',
        preset: 'simulation', model: 'world-scripted/scripted' })
    }
    await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'hiring-private',
      members: [{ entityId: requester, role: 'requester' }, { entityId: director, role: 'director' }], limits: {} }))
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'hiring-authority', subject: requester,
      relation: 'can-hire', object: 'position', scope: 'organization', validFrom: '0', validUntil: null }), run.snapshot().revision)
    await run.configureWorld(simulationWorldDefinitionSchema.parse({ positionRolePermissions: [], operations: [WORLD_GENERATE_AND_HIRE_PIN], operationGrants: ([{ requesterEntityId: requester, positionEntityId: 'position', relationId: 'hiring-authority' }]).map(value => ({ requesterEntityId: value.requesterEntityId, domain: WORLD_GENERATE_AND_HIRE_PIN.domain, operation: WORLD_GENERATE_AND_HIRE_PIN.operation, version: WORLD_GENERATE_AND_HIRE_PIN.version, scopeEntityId: 'organization', targetEntityId: value.positionEntityId, relationId: value.relationId, relation: 'can-hire' })),  directorEntityId: director, organizationEntityId: 'organization',
      positions: [{ entityId: 'position', capacity: 1 }],
      authorizations: [{ requesterEntityId: requester, positionEntityId: 'position', relationId: 'hiring-authority' }],
      templates: [{ id: 'researcher', version: '1', names: ['Lin'], skills: ['analysis'], traits: ['patient'], goals: ['research'],
        description: 'A research colleague.' }], policyVersion: '1',
      limits: { maxRequests: 10,
        maxBirthsPerInterval: 10, maxExternalExpansionsPerInterval: 10, maxPendingMutations: 1,
        maxRequestsPerActorPerInterval: 10,
        maxEvidenceAttemptsPerRequest: 3, maxPlansPerRequest: 3, maxBytesPerRequest: 4096, maxBytesPerPlan: 4096 },
    }), run.snapshot().revision)
    await run.change(simulationChangeSchema.parse({ kind: 'relation/create', id: 'requester-employment', subject: requester,
      relation: 'assignment', object: 'requester-role', scope: 'organization', validFrom: '0', validUntil: null }), run.snapshot().revision)
    const intent = await seedHiringIntent(run, simulationHireIntentRequestSchema.parse({ organizationEntityId: 'organization',
      positionEntityId: 'position', requesterEntityId: requester, applicationId: 'research-application' }), 'We need a research colleague.')
    assert.equal((await connection.checkpoint(checkpoint)).status, 'completed')
    const leases = []
    for (const id of [requester, director]) {
      leases.push(await connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { options: { provider: 'world-scripted', model: 'scripted' } }, signal: new AbortController().signal }))
    }
    await run.setPhase('running', run.snapshot().revision)
    await connection.executeDecision(requester, simulationDecisionIdSchema.parse('request'),
      { ...context(), world: { kind: 'request', intentId: intent.id } })
    const request = Object.values(run.snapshot().world!.requests)[0]!
    await run.drive({ until: simTimeSchema.parse('0') })
    assert.ok(request.notificationOperationId !== null, 'Ordinary request requires its original Channel notification')
    await connection.dispatchOperation(request.notificationOperationId, () => 100)
    const wake = await connection.receiveOperation(request.notificationOperationId)
    await run.drive({ until: simTimeSchema.parse('0') })
    await connection.executeDecision(director, simulationDecisionIdSchema.parse('resolve'),
      { ...context(), world: { kind: 'resolve', requestId: request.id } }, wake)
    const plan = Object.values(run.snapshot().world!.plans)[0]!
    const toolResults = leases[1]!.localAgent!.session.events.filter(event => event.type === 'tool/result')
    const result = toolResults.at(-1)?.data.message.content.find(block => block.type === 'tool-result')
    assert.equal(result?.isError, false)
    assert.deepEqual(result?.content, [{ type: 'text', text: JSON.stringify({ status: 'accepted',
      operationIds: run.snapshot().decisions[simulationDecisionIdSchema.parse('resolve')]?.operationIds, effects: 'pending' }) }])
    if (terminal === 'cancelled') {
      assert.equal((await run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'original-cancel', requestId: request.id }))).status, 'cancelled')
    } else if (terminal === 'rejected') {
      assert.equal(plan.proposal.resolution.kind, 'reject')
      assert.ok(plan.operationId !== null)
      await run.executeOperation(plan.operationId)
    }
    await writeFile(proofPath, JSON.stringify({ hash: plan.hash, proposal: plan.proposal,
      results: run.snapshot().world!.results, cancellations: run.snapshot().world!.cancellations }))
    if (process.env.WORLD_CRASH === 'accepted-plan') {
      process.send?.('durable')
      await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
    }
  }
  const state = run.snapshot(), world = state.world!
  const request = Object.values(world.requests)[0]!, plan = Object.values(world.plans)[0]!
  assert.equal(Object.keys(world.requests).length, 1)
  assert.equal(Object.keys(world.plans).length, 1)
  assert.equal(Object.values(state.entities).filter(value => value.cognition === 'agent').length, 2)
  assert.equal(Object.keys(state.entities).length, 5)
  assert.deepEqual(Object.values(state.relations).filter(value => value.relation === 'assignment'), [{
    id: 'requester-employment', subject: requester, relation: 'assignment', object: 'requester-role', scope: 'organization',
    validFrom: '0', validUntil: null, revision: 1,
  }])
  const original = JSON.parse(await readFile(proofPath, 'utf8')) as { hash: string; proposal: unknown; results: unknown; cancellations: unknown }
  assert.equal(plan.hash, original.hash)
  assert.deepEqual(plan.proposal, original.proposal)
  assert.deepEqual(world.results, original.results)
  assert.deepEqual(world.cancellations, original.cancellations)
  if (terminal === 'cancelled') {
    const revision = run.snapshot().revision
    assert.equal((await run.cancelWorldCase(simulationWorldCancelRequestSchema.parse({ id: 'original-cancel', requestId: request.id }))).status, 'cancelled')
    assert.equal(run.snapshot().revision, revision)
  }
  const results = Object.values(world.results)
  assert.equal(results.length, terminal === 'pending' ? 0 : 1)
  const wakes = Object.values(state.scheduledEvents).filter(event => event.id.startsWith('simulation-world-result:'))
  assert.equal(wakes.length, results.length)
  if (results.length === 1) {
    const result = results[0]!
    assert.equal(result.outcome.kind, terminal)
    assert.deepEqual(wakes[0]!.action, { kind: 'wake', entityId: requester, reason: JSON.stringify({ resultId: result.id }) })
    assert.ok(!JSON.stringify(result).includes(plan.proposal.resolution.rationale))
  }
  assert.equal(state.decisions[simulationDecisionIdSchema.parse('resolve')]?.consumption?.notification?.operationId,
    request.notificationOperationId)
  const records = await ctx.teams.readChannel({ channelId: world.channels[requester]!, afterCursor: -1 })
  assert.ok(records.records.some(record => record.type === 'channel/receipt'))
  if (recovering) { assert.equal(state.phase, 'paused'); assert.equal(requests.length, 0) }
  else assert.equal(requests.length, 6)
  const resolution = plan.proposal.resolution
  if (resolution.kind === 'awaiting-evidence') throw new Error('Protocol fixture requires a terminal business plan')
  console.log(JSON.stringify({ cases: 1, plans: 1, actors: 2, entities: 5, effects: terminal,
    results: results.length, notificationWakes: wakes.length,
    resolution: resolution.kind === 'apply' ? { kind: 'apply', persona: simulationWorldHirePlanPayloadSchema.parse(resolution.payload).persona }
      : { kind: 'reject', reason: resolution.reason },
    originalNotificationConsumed: true, privateReceipt: true, originalPlanPreserved: true,
    phase: state.phase, modelCalls: requests.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
