/** Persisted summary ancestry, model observation and transitive revocation across process recovery. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationKnowledgeRequestSchema,
  simulationSummaryRequestSchema, simulationPolicyRefSchema, simulationDecisionIdSchema, simulationContextRequestSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-knowledge-depth', process.argv[2]!)
const recovering = process.env['KNOWLEDGE_DEPTH_RECOVER'] === 'true'
const depth = 256
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'knowledge-depth', tickUnit: 'hour', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 1, outboxRetryDelayMs: 0, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 0,
  maxIngressBytes: 4096, maxEntities: 2, maxResidentActors: 1, maxDecisionsPerWindow: 1, maxOperationsPerDecision: 1,
  maxResourceQuantity: '1', maxQueuedDecisions: 2, maxDispatchWaitRounds: 2, budgetInterval: '100',
  maxDecisionsPerInterval: 10, maxMessagesPerInterval: 0, maxTokensPerInterval: 10000, tokensPerModelRequest: 100,
  maxPendingEvents: 10, maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
} }))
const hold = async (stage: string) => {
  if (process.env['KNOWLEDGE_DEPTH_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const owner = simulationEntityIdSchema.parse('owner'), viewer = simulationEntityIdSchema.parse('viewer')
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Retain deep knowledge authority', budgets: {} }, budgets: {} },
    'simulation/knowledge-depth')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/knowledge-depth')
  for (const id of [owner, viewer]) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [], provider: 'in-process', preset: 'simulation', model: 'depth/scripted' })
  }
  if (recovering) await connection.recover(viewer)
  const actor = await connection.activate(viewer, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
    agent: { preset: 'simulation', options: { provider: 'depth', model: 'scripted' } }, signal: new AbortController().signal })
  assert.ok(actor.localAgent)
  assert.ok(await ctx.sessions.flush(actor.localAgent.session))
  await run.setPhase('running', run.snapshot().revision)
  const base = simulationKnowledgeRequestSchema.parse({ id: 'root', owner, expectedRevision: 0, statement: 'SECRET_ROOT',
    source: { kind: 'belief', profileRevision: 1, policyVersion: '1' }, observedAt: '0', availableAt: '0',
    validFrom: '0', validUntil: null, readers: [viewer] })
  const root = await run.recordKnowledge(base)
  const policy = simulationPolicyRefSchema.parse({ id: 'rollup', version: '1' })
  let computations = 0, modelCalls = 0
  ctx.simulationTeams.registerSummaryPolicy({ ...policy, summarize: (items) => {
    assert.equal(items.length, 1)
    computations += 1
    return 'SECRET_ROLLUP'
  } })
  const request = simulationSummaryRequestSchema.parse({ id: 'rollup', expectedRevision: 0, inputs: [root.id],
    readers: [viewer], availableAt: '0', validFrom: '0', validUntil: null })
  const retained = run.snapshot().knowledge?.[request.id]?.length ?? 0
  for (let revision = retained; revision < depth; revision += 1) {
    const next = { ...request, expectedRevision: revision, inputs: [revision === 0 ? root.id : request.id] }
    const summary = await connection.summarizeKnowledge(owner, policy, next)
    const before = computations
    assert.deepEqual(await connection.summarizeKnowledge(owner, policy, next), summary)
    assert.equal(computations, before)
  }
  await hold('linked')
  const query = { viewer, cursor: run.snapshot().revision, time: run.snapshot().time, limit: 1, ids: [request.id] }
  const context = simulationContextRequestSchema.parse({ maxBytes: 4096, teamCursor: 0,
    personaVersion: 'depth-1', modelVersion: 'scripted-1', sources: [], knowledge: { ids: [request.id], required: true },
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
      blocks: [{ type: 'text', text: 'Observe the authorized summary.' }] })),
  })
  ctx.llm.registerAdapter(['depth'], new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      assert.ok(JSON.stringify(options.messages).includes('SECRET_ROLLUP'))
      assert.ok(!JSON.stringify(options.messages).includes('SECRET_ROOT'))
      const index = modelCalls++
      const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(name)
      const id = CallId(`depth-${index}`), args = JSON.stringify(index === 1 ? { proposals: [] } : {})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }())
  const decisionId = simulationDecisionIdSchema.parse('read-rollup')
  if (run.snapshot().decisions[decisionId] === undefined) {
    assert.equal(run.queryKnowledge(query)[0]?.revision, depth)
    assert.equal((await connection.executeDecision(viewer, decisionId, context)).status, 'accepted')
  }
  const result = actor.localAgent.session.events.find(event => event.type === 'tool/result'
    && event.data.message.content[0].toolCallId === CallId('depth-0'))
  assert.ok(result && JSON.stringify(result).includes('SECRET_ROLLUP'))
  await run.recordKnowledge({ ...base, expectedRevision: 1, readers: [] })
  await hold('revoked')
  assert.deepEqual(run.queryKnowledge(query), [])
  assert.equal(run.queryKnowledge({ ...query, viewer: owner })[0]?.revision, depth)
  const denied = simulationDecisionIdSchema.parse('denied')
  await connection.openDecision(viewer, denied)
  const before = modelCalls
  await assert.rejects(connection.prepareContext(viewer, denied, context), /unauthorized/)
  assert.equal(modelCalls, before)
  await connection.cancelDecision(viewer, denied)
  assert.ok(JSON.stringify(actor.localAgent.session.events).includes('SECRET_ROLLUP'))
  console.log(JSON.stringify({ depth, retained, computations, modelCalls, observed: true, revoked: true,
    ownerReadable: true, historyPreserved: true, versions: run.snapshot().knowledge?.[request.id]?.length }))
} finally { await run.close(); await ctx.fiber.dispose() }
