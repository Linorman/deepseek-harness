/** Deterministic consumers receive report bodies regardless of caller-supplied model visibility hints. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationChannelSpecSchema,
  simulationDecisionIdSchema, simulationProposalSchema, simulationKnowledgeRequestSchema, simulationPolicyRefSchema,
  simulationContextRequestSchema, simulationWindowIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-policy-knowledge', process.argv[2]!)
const windowed = process.env['POLICY_KNOWLEDGE_WINDOW'] === 'true'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'policy-knowledge', tickUnit: 'hour', origin: '0', maxTime: '10', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 1, outboxRetryDelayMs: 0, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 0,
  maxIngressBytes: 4096, maxEntities: 2, maxResidentActors: 2, maxDecisionsPerWindow: 1, maxOperationsPerDecision: 1,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '1', maxQueuedDecisions: 2, maxDispatchWaitRounds: 2, budgetInterval: '10',
  maxDecisionsPerInterval: 10, maxMessagesPerInterval: 1, maxTokensPerInterval: 0, tokensPerModelRequest: 1,
  maxPendingEvents: 16, maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
} }))
try {
  const sender = simulationEntityIdSchema.parse('sender'), reader = simulationEntityIdSchema.parse('reader')
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Read the complete authorized report', budgets: {} }, budgets: {} }, 'simulation/policy-knowledge')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/policy-knowledge')
  for (const id of [sender, reader]) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [], provider: 'in-process', preset: 'simulation', model: 'unused' })
    await connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' }, agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
  }
  const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'reports', limits: {},
    members: [{ entityId: sender, role: 'sender' }, { entityId: reader, role: 'reader' }] }))
  await run.setPhase('running', run.snapshot().revision)
  const postId = simulationDecisionIdSchema.parse('post')
  await connection.openDecision(sender, postId)
  const posted = await connection.submitDecision(sender, postId, [simulationProposalSchema.parse({ after: [], action: {
    kind: 'communication/post', recipient: reader, channelId: channel.manifest.id, text: 'Complete report body', deliverAt: '0',
  } })])
  await connection.drive({ until: simTimeSchema.parse('0') }, Date.now)
  const operation = run.snapshot().operations[posted.operationIds[0]!]!
  assert.ok(operation.delivery?.receipt)
  const report = await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ id: 'report', owner: reader, expectedRevision: 0,
    statement: 'Complete report body', source: { kind: 'report', operationId: operation.id }, readers: [],
    observedAt: '0', availableAt: '0', validFrom: '0', validUntil: null }))
  const policy = simulationPolicyRefSchema.parse({ id: 'read', version: '1' })
  let computations = 0, modelCalls = 0
  const stream = ctx.llm.stream.bind(ctx.llm)
  ctx.llm.stream = (...args) => { modelCalls += 1; return stream(...args) }
  ctx.simulationTeams.registerDeterministicPolicy({ ...policy, decide: (view) => {
    computations += 1
    assert.ok(JSON.stringify(view.content).includes(report.statement))
    return []
  } })
  const context = simulationContextRequestSchema.parse({ maxBytes: 4096, teamCursor: 0, personaVersion: '1', modelVersion: 'none', sources: [],
    knowledge: { ids: [report.id], required: true, visibleReports: [operation.id] },
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
      blocks: [{ type: 'text', text: 'Read the report.' }] })),
  })
  const id = simulationDecisionIdSchema.parse('read-report'), windowId = simulationWindowIdSchema.parse('read-window')
  if (windowed) await connection.openWindow({ id: windowId, decisions: [{ id, entityId: reader, policy,
    context, wakeId: operation.delivery.wakeId }] })
  await connection.executeDeterministicDecision(reader, id, context, policy, operation.delivery.wakeId)
  if (windowed) await run.commitWindow(windowId)
  const decision = run.snapshot().decisions[id]!
  assert.equal(decision.status, 'accepted')
  assert.ok(decision.context?.status === 'prepared')
  assert.equal(decision.context.referencedReports, undefined)
  assert.equal(modelCalls, 0)
  assert.equal(run.budgetUsage().tokens.used, 0)
  assert.equal(computations, 1)
  assert.equal(run.snapshot().wakes[operation.delivery.wakeId]?.status, 'completed')
  console.log(JSON.stringify({ windowed, reportBodyVisible: true, ignoredCallerHints: true,
    computations, modelCalls, tokens: 0, wakeCompleted: true, status: decision.status }))
} finally { await run.close(); await ctx.fiber.dispose() }
