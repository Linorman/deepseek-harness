/** Versioned ledger policies share the real controller and resource executor without model calls. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationPolicyRefSchema,
  simulationDecisionIdSchema, simulationWindowIdSchema, simulationResourceSpecSchema, simulationProposalSchema,
  simulationContextRequestSchema, simulationChannelSpecSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-deterministic', process.argv[2]!)
const recovering = process.env['SIMULATION_DETERMINISTIC_RECOVER'] === 'true'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'ledger', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 2, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '10000', relationRules: [], maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 16, maxDispatchWaitRounds: 8,
  budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxTokensPerInterval: 0, tokensPerModelRequest: 1000, maxPendingEvents: 16, maxPendingInteractions: 16,
} }))
try {
  let modelCalls = 0
  ctx.llm.registerAdapter(['unused'], new class extends LlmAdapter {
    async *stream(): AsyncGenerator<StreamChunk> { modelCalls += 1; yield { type: 'finish', reason: { kind: 'stop' } } }
  }())
  const policy = simulationPolicyRefSchema.parse({ id: 'ledger', version: '1' })
  let computations = 0
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: (view) => {
    computations += 1
    return [simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
      commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: `${view.entityId}-stock`, revision: 1 }],
      transfers: [{ from: 'stock', to: `${view.entityId}-stock`, quantity: '1' }],
    } } })]
  } })
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Allocate one ledger unit', budgets: {} }, budgets: {} }, 'simulation/ledger')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/ledger')
  const a = simulationEntityIdSchema.parse('a'); const b = simulationEntityIdSchema.parse('b')
  for (const entityId of [a, b]) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: entityId,
      entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    await connection.ensureParticipant(entityId, { displayName: entityId, role: entityId, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'unused' })
    if (recovering) await connection.recover(entityId)
    const actor = await connection.activate(entityId, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'unused', model: 'unused' } }, signal: new AbortController().signal })
    assert.ok(actor.localAgent)
    await ctx.sessions.flush(actor.localAgent.session)
    if (!recovering) await run.createResource(simulationResourceSpecSchema.parse({ id: `${entityId}-stock`, owner: entityId,
      kind: 'inventory', unit: 'item', quantity: '0', controllers: [entityId] }), run.snapshot().revision)
  }
  if (!recovering) await run.createResource(simulationResourceSpecSchema.parse({ id: 'stock', owner: a,
    kind: 'inventory', unit: 'item', quantity: '1', controllers: [a, b] }), run.snapshot().revision)
  const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'ledger-channel',
    members: [{ entityId: a, role: 'sender' }, { entityId: b, role: 'receiver' }], limits: {} }))
  const retainedPolicies = Object.values(run.snapshot().decisions).filter(decision => decision.deterministic !== undefined)
  const retainedResults = retainedPolicies.filter(decision => decision.deterministic?.proposals !== undefined).length
  if (recovering) assert.ok(retainedPolicies.length > 0)
  const priorWindow = run.snapshot().activeWindowId
  if (priorWindow !== undefined) await run.commitWindow(priorWindow)
  await run.setPhase('running', run.snapshot().revision)
  const postId = simulationDecisionIdSchema.parse('post')
  if (!recovering) {
    await connection.openDecision(a, postId)
    await connection.submitDecision(a, postId, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'communication/post', recipient: b, channelId: channel.manifest.id, text: 'Allocate one ledger unit.', deliverAt: '0',
    } })])
    await connection.drive({ until: simTimeSchema.parse('0') }, Date.now)
  }
  const post = run.snapshot().operations[run.snapshot().decisions[postId]!.operationIds[0]!]!
  assert.ok(post.delivery?.receipt)
  const wakeId = (entityId: typeof a) => entityId === b ? post.delivery!.wakeId : undefined
  const completed = run.snapshot().decisions[simulationDecisionIdSchema.parse('a')]?.status === 'accepted'
  const retry = recovering && !completed
  const id = (entityId: typeof a) => simulationDecisionIdSchema.parse(retry ? `${entityId}/retry` : entityId)
  const windowId = simulationWindowIdSchema.parse(retry ? 'ledger/retry' : 'ledger')
  const context = (entityId: typeof a) => simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
    personaVersion: 'ledger-1', modelVersion: 'no-model',
    sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: run.snapshot().revision }],
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
      blocks: [{ type: 'text', text: kind === 'identity' ? entityId : 'Allocate one stock unit from revision 1.' }] })),
  })
  if (!completed) await connection.openWindow({ id: windowId, decisions: [a, b].map(entityId => ({
    id: id(entityId), entityId, context: context(entityId), ...entityId === b ? { wakeId: post.delivery!.wakeId } : {},
  })) })
  const stream = (run as unknown as { stream: LogStream }).stream
  const append = stream.append.bind(stream)
  const crash = process.env['SIMULATION_DETERMINISTIC_CRASH']
  stream.append = async (cursor, values) => {
    const result = await append(cursor, values)
    if ((crash === 'selected' || crash === 'result') && JSON.stringify(values).includes(`"kind":"deterministic/${crash}"`)) {
      process.send?.('durable')
      await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
    }
    return result
  }
  await Promise.all([b, a].map(entityId =>
    connection.executeDeterministicDecision(entityId, id(entityId), context(entityId), policy, wakeId(entityId))))
  if (!completed) await run.commitWindow(windowId)
  await run.drive({ until: simTimeSchema.parse('0') })
  if (crash === 'applied') {
    process.send?.('durable')
    await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
  }
  if (process.env['SIMULATION_DETERMINISTIC_OPAQUE_IDS'] === 'true') {
    const opaquePolicy = simulationPolicyRefSchema.parse({ id: 'opaque', version: '1' })
    let opaqueComputations = 0
    ctx.simulationTeams.registerDeterministicPolicy({ ...opaquePolicy, decide: () => { opaqueComputations += 1; return [] } })
    for (const value of ['constructor', 'toString', '__proto__']) {
      const opaqueId = simulationDecisionIdSchema.parse(value)
      const accepted = await connection.executeDeterministicDecision(a, opaqueId, context(a), opaquePolicy)
      assert.equal(accepted.status, 'accepted')
      assert.deepEqual(await connection.executeDeterministicDecision(a, opaqueId, context(a), opaquePolicy), accepted)
    }
    assert.equal(opaqueComputations, 3)
  }
  const before = computations
  for (const entityId of [a, b]) {
    await connection.executeDeterministicDecision(entityId, id(entityId), context(entityId), policy, wakeId(entityId))
  }
  assert.equal(computations, before)
  await connection.hibernate(b)
  const resumed = await connection.resume(b, { provider: 'in-process',
    agent: { preset: 'simulation', options: { provider: 'unused', model: 'unused' } }, signal: new AbortController().signal })
  assert.equal(resumed.localAgent?.inbox.hasPending, false)
  assert.equal(resumed.localAgent?.session.events.some(event => event.type === 'user/message'), false)
  const state = run.snapshot()
  assert.equal(modelCalls, 0)
  assert.equal(run.budgetUsage().tokens.used, 0)
  assert.ok(Object.values(state.decisions).every(decision => decision.inference === undefined))
  console.log(JSON.stringify({ ...process.env['SIMULATION_DETERMINISTIC_OPAQUE_IDS'] === 'true' ? {
    opaqueDecisions: ['constructor', 'toString', '__proto__'].map(value => run.snapshot().decisions[simulationDecisionIdSchema.parse(value)]?.status),
  } : {}, computations, modelCalls, retainedResults,
  tokenReservations: Object.keys(state.tokenReservations ?? {}).length,
  cancellations: Object.values(state.decisions).filter(decision => decision.status === 'cancelled').length,
  resources: Object.values(state.resources).map(({ id, quantity }) => ({ id, quantity })),
  operations: Object.values(state.operations).map(({ entityId, result }) => ({
    entityId, status: result?.status, code: result?.code,
  })) }))
} finally { await run.close(); await ctx.fiber.dispose() }
