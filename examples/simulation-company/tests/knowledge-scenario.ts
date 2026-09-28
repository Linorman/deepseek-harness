/** Real model observation of versioned knowledge across grants, revocation and coordinator recovery. */
import assert from 'node:assert/strict'
import { taskScenario } from './task-scenario.ts'
import { boot } from '@clocky/clocky-app-boot'
import { LlmAdapter, CallId, createUserMessage } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationCheckpointRequestSchema, simulationPhaseManagementRequestSchema, simulationRunSelectionSchema, simulationChangeSchema,
  simulationEntityIdSchema, simulationDecisionIdSchema,
  simulationContextRequestSchema, simulationKnowledgeRequestSchema, simulationSummaryRequestSchema, simulationPolicyRefSchema, simulationChannelSpecSchema, simulationProposalSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-knowledge', process.argv[2]!)
const recovering = process.env['KNOWLEDGE_RECOVER'] === 'true'
const compacting = process.env['KNOWLEDGE_COMPACTION'] === 'true'
const reportOnly = process.env['KNOWLEDGE_REPORT_ONLY'] === 'true'
const reportText = reportOnly ? `RECEIVED-REPORT${' source detail'.repeat(150)}` : 'RECEIVED-REPORT'
const managing = process.env['KNOWLEDGE_MANAGEMENT'] === 'true'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'knowledge', tickUnit: 'hour', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 64,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 3, maxDecisionsPerWindow: 3, maxOperationsPerDecision: 16,
  maxResourceQuantity: '10000', maxQueuedDecisions: 32, maxDispatchWaitRounds: 8,
  budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 16, relationRules: [],
} }))
const hold = async (stage: string) => {
  if (process.env['KNOWLEDGE_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Keep attributed knowledge scoped', budgets: {} }, budgets: {} }, 'simulation/knowledge')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/knowledge')
  const a = simulationEntityIdSchema.parse('a'), b = simulationEntityIdSchema.parse('b'), c = simulationEntityIdSchema.parse('c')
  const checkpointRequest = simulationCheckpointRequestSchema.parse({ id: 'scenario-checkpoint',
    implementationVersion: 'knowledge-fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
  if (run.snapshot().checkpoints?.[checkpointRequest.id]?.status === 'in-progress') {
    assert.equal((await connection.checkpoint(checkpointRequest)).status, 'completed')
  }
  const dormant = simulationEntityIdSchema.parse('dormant')
  if (run.snapshot().entities[dormant] === undefined) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: dormant, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  }
  const dormantBinding = await connection.ensureParticipant(dormant, { displayName: 'Dormant', role: 'observer', capabilities: [],
    provider: 'in-process', preset: 'simulation', model: 'knowledge/scripted' })
  assert.equal(await ctx.sessionPersistence.isUnmaterialized(dormantBinding.sessionId), true)
  for (const entityId of [a, b, c]) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person',
      cognition: 'agent', profile: { initialBelief: entityId === a ? 'SECRET-X' : 'No private belief' } }), run.snapshot().revision)
    await connection.ensureParticipant(entityId, { displayName: entityId, role: entityId === a ? 'coordinator' : entityId, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'knowledge/scripted' })
    if (recovering && run.snapshot().entities[entityId]!.writer?.phase !== 'released') await connection.recover(entityId)
    const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'knowledge', model: 'scripted' } }, signal: new AbortController().signal })
    assert.ok(lease.localAgent)
    await ctx.sessions.flush(lease.localAgent.session)
  }
  const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'reports',
    members: [{ entityId: a, role: 'sender' }, { entityId: b, role: 'recipient' }], limits: {} }))
  if (managing) {
    const pending = Object.values(run.snapshot().management ?? {}).find(operation => operation.status === 'in-progress')
    if (recovering) assert.ok(pending || Object.values(run.snapshot().management ?? {}).some(operation =>
      operation.request.id === 'pause-cut' && operation.status === 'completed'))
    if (pending !== undefined) assert.equal((await run.managePhase(pending.request)).status, 'completed')
    assert.equal((await run.managePhase(simulationPhaseManagementRequestSchema.parse({
      id: recovering ? 'resume-recovery' : 'initial-run', phase: 'running',
    }))).status, 'completed')
  } else await run.setPhase('running', run.snapshot().revision)
  const base = simulationKnowledgeRequestSchema.parse({ id: 'secret', owner: a, expectedRevision: 0, statement: 'SECRET-X',
    source: { kind: 'belief', profileRevision: 1, policyVersion: '1', confidence: 0.8 }, observedAt: '0', availableAt: '0',
    validFrom: '0', validUntil: null, readers: [] })
  const original = await run.recordKnowledge(base)
  await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...base, id: 'plan', statement: 'Delivery planned for time 5', readers: [b, c] }))
  await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...base, id: 'future', statement: 'FUTURE-OBSERVED',
    source: { kind: 'observation', worldRevision: original.sequence, visibilityPolicy: '1' },
    observedAt: '5', availableAt: '5', validFrom: '5' }))
  const postId = simulationDecisionIdSchema.parse('send-report')
  if (run.snapshot().decisions[postId] === undefined) {
    await connection.openDecision(a, postId)
    await connection.submitDecision(a, postId, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'communication/post', recipient: b, channelId: channel.manifest.id, text: reportText, deliverAt: '0',
    } })])
  }
  const operationId = run.snapshot().decisions[postId]!.operationIds[0]!
  if (run.snapshot().operations[operationId]?.delivery?.receipt === undefined) {
    await connection.drive({ until: simTimeSchema.parse('0') }, Date.now)
  }
  await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...base, id: 'report', owner: b,
    statement: reportText, source: { kind: 'report', operationId } }))
  await hold('recorded')
  let rejectedCompactionRoutes = 0
  if (compacting) {
    const { CompactionId, recordCompactionRequest } = await import('@clocky/clocky-compaction')
    const actor = ctx.agents.get(run.snapshot().entities[b]!.binding!.sessionId)!
    let probeCalls = 0
    ctx.llm.registerAdapter(['route-probe'], new class extends LlmAdapter {
      async *stream(): AsyncGenerator<StreamChunk> { probeCalls += 1; yield { type: 'finish', reason: { kind: 'stop' } } }
    }())
    for (const variant of ['unrouted', 'foreign-session', 'unclassified']) {
      const compactionId = CompactionId(`route/${recovering ? 'recovery' : 'initial'}/${variant}`)
      actor.session.append('compaction/start', { compactionId, turn: null })
      const options = recordCompactionRequest(actor.session, { sessionId: actor.session.id, purpose: 'compaction',
        provider: 'route-probe', model: 'scripted', messages: [createUserMessage({ source: { kind: 'user' },
          content: [{ type: 'text', text: 'Must remain under canonical compaction ownership' }] })] })
      if (variant === 'unrouted') delete options.sessionId
      if (variant === 'foreign-session') options.sessionId = ctx.sessions.create().id
      if (variant === 'unclassified') delete options.purpose
      await assert.rejects(async () => {
        for await (const _chunk of ctx.llm.stream(options)) { /* Admission runs during iteration. */ }
      }, /compaction ownership/)
      actor.session.append('compaction/end', { compactionId, turn: null, error: 'Rejected altered routing' })
      rejectedCompactionRoutes += 1
    }
    assert.equal(probeCalls, 0)
  }
  let script: { name: string; prefix: string; historical: boolean; future: boolean; index: number } | undefined
  let calls = 0
  ctx.llm.registerAdapter(['knowledge'], new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      assert.ok(script)
      const visible = JSON.stringify(options.messages)
      if (options.purpose !== 'compaction') {
        assert.equal(visible.includes('SECRET-X'), script.historical)
        assert.equal(visible.includes('FUTURE-OBSERVED'), script.future)
        if (script.name.endsWith('-b') && (!compacting || script.name === 'initial-b')) assert.equal(visible.split('RECEIVED-REPORT').length - 1, 1)
      }
      if (options.purpose === 'compaction') {
        assert.equal(options.messages.some(message => JSON.stringify(message).includes('SECRET-X')), !reportOnly)
        const summary = reportOnly ? 'The report was received.' : 'Owner remembers SECRET-X from prior authorized work.'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: summary }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: summary } }
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const index = script.index++
      const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(name)
      const id = CallId(`${script.prefix}-${index}`), args = JSON.stringify(index === 1 ? { proposals: [] } : {})
      calls += 1
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }())
  if (compacting) {
    const { BasicCompactionEngine } = await import('@clocky/clocky-compaction-basic')
    const { default: TokenMeter } = await import('@clocky/clocky-token-meter')
    await ctx.plugin(TokenMeter)
    await ctx.plugin(BasicCompactionEngine, { auto: false })
    let done = false
    ctx.on('agent/pre-step', async (event, next) => {
      const result = await next()
      if (!recovering && !done && script?.name === 'shared-b' && event.step === 2) {
        const nodes = event.agent.session.surface.nodes
        const report = nodes.find((seq) => {
          const value = event.agent.session.events[seq]
          return value?.type === 'user/message' && value.data.source.kind === 'team-envelope'
        })
        if (reportOnly) assert.ok(report !== undefined)
        await ctx.compaction.compactRegion(reportOnly ? report! : nodes[0]!,
          reportOnly ? report! : nodes.at(-1)!, event.agent, event.signal)
        if (reportOnly) assert.equal(event.agent.session.surface.nodes.filter(seq =>
          event.agent.session.events[seq]?.type === 'simulation/context-view').length, 1)
        done = true
        assert.ok(await ctx.sessions.flush(event.agent.session))
        await hold('compacted')
      }
      return result
    })
    const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
    const append = stream.append.bind(stream)
    stream.append = async (cursor, values) => {
      const result = await append(cursor, values)
      if (!recovering && JSON.stringify(values).includes('"kind":"decision/rebased"')) await hold('rebased')
      return result
    }
  }
  const observations: Record<string, { secret: boolean; future: boolean }> = {}
  const query = (viewer: typeof a) => run.queryKnowledge({ viewer, cursor: run.snapshot().revision, time: run.snapshot().time, limit: 16 })
  const material = (ids: typeof original.id[]) => simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
    personaVersion: 'knowledge-1', modelVersion: 'scripted-1',
    sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: run.snapshot().revision }],
    ...ids.length === 0 ? {} : { knowledge: { ids, required: true } },
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
      blocks: [{ type: 'text', text: 'Inspect only the authorized knowledge selected for this decision.' }] })),
  })
  const inspect = async (entityId: typeof a, name: string, secret: boolean, historical = secret, future = false) => {
    let id = simulationDecisionIdSchema.parse(name)
    if (run.snapshot().decisions[id]?.status === 'cancelled') id = simulationDecisionIdSchema.parse(`${name}/retry`)
    if (run.snapshot().decisions[id] === undefined) {
      script = { name, prefix: id, historical, future, index: 0 }
      const wakeId = Object.values(run.snapshot().wakes).find(wake => wake.entityId === entityId && wake.status === 'pending')?.eventId
      await connection.executeDecision(entityId, id, material(query(entityId).map(value => value.id)), wakeId)
      assert.equal(script.index, 3)
    }
    const actor = ctx.agents.get(run.snapshot().entities[entityId]!.binding!.sessionId)!
    const event = actor.session.events.find(value => value.type === 'tool/result' && value.data.message.content[0].toolCallId === CallId(`${id}-0`))
    assert.ok(event?.type === 'tool/result')
    const text = event.data.message.content[0].content.find(block => block.type === 'text')
    assert.ok(text?.type === 'text')
    observations[name] = { secret: text.text.includes('SECRET-X'), future: text.text.includes('FUTURE-OBSERVED') }
    assert.deepEqual(observations[name], { secret, future })
    return id
  }
  await inspect(a, 'initial-a', true)
  await inspect(b, 'initial-b', false)
  await inspect(c, 'initial-c', false)
  const shared = await run.recordKnowledge({ ...base, expectedRevision: 1, readers: [b] })
  await hold('shared')
  const derivedBy = await inspect(b, 'shared-b', true)
  await run.recordKnowledge(simulationKnowledgeRequestSchema.parse({ ...base, id: 'inference', owner: b, statement: 'Derived private conclusion',
    source: { kind: 'inference', decisionId: derivedBy, premises: [{ id: base.id, revision: 2 }] } }))
  const summaryPolicy = simulationPolicyRefSchema.parse({ id: 'public-plan', version: '1' })
  let summaryComputations = 0
  ctx.simulationTeams.registerSummaryPolicy({ ...summaryPolicy, summarize: (items) => {
    summaryComputations += 1
    assert.deepEqual(items.map(item => item.id), ['plan'])
    return items.map(item => `Plan summary: ${item.statement}`).join('; ')
  } })
  const summaryRequest = simulationSummaryRequestSchema.parse({ id: 'public-summary', expectedRevision: 0,
    inputs: ['plan'], readers: [c], availableAt: '0', validFrom: '0', validUntil: null })
  const modelCallsBeforeSummary = calls
  await assert.rejects(connection.summarizeKnowledge(b, summaryPolicy, { ...summaryRequest, id: simulationSummaryRequestSchema.parse({ ...summaryRequest, id: 'forbidden-summary' }).id, inputs: [base.id] }),
    /complete source subset|unauthorized inputs/)
  assert.equal(summaryComputations, 0)
  const summary = await connection.summarizeKnowledge(b, summaryPolicy, summaryRequest)
  assert.ok(!summary.statement.includes('SECRET-X'))
  const computed = summaryComputations
  assert.deepEqual(await connection.summarizeKnowledge(b, summaryPolicy, summaryRequest), summary)
  assert.equal(summaryComputations, computed)
  assert.equal(calls, modelCallsBeforeSummary)
  await hold('summarized')
  await run.recordKnowledge({ ...base, expectedRevision: 2, readers: [] })
  await hold('revoked')
  assert.deepEqual(query(b).map(value => value.id), ['plan', 'public-summary', 'report'])
  assert.deepEqual(run.queryKnowledge({ viewer: b, cursor: shared.sequence, time: simTimeSchema.parse('0'), limit: 16 }).map(value => value.id), ['plan', 'report'])
  const denied = simulationDecisionIdSchema.parse('denied')
  if (run.snapshot().decisions[denied]?.status !== 'cancelled') {
    await connection.openDecision(b, denied)
    const before = calls
    await assert.rejects(connection.prepareContext(b, denied, material([base.id])), /unauthorized/)
    assert.equal(calls, before)
    await connection.cancelDecision(b, denied)
  }
  await inspect(b, 'revoked-b', false, true)
  await inspect(c, 'still-private-c', false)
  await run.drive({ until: simTimeSchema.parse('5') })
  await inspect(a, 'future-a', true, true, true)
  if (compacting) {
    const auxiliary = Object.values(run.snapshot().tokenReservations ?? {}).filter(value => value.compactionId !== undefined)
    assert.equal(auxiliary.length, 1)
    assert.equal(auxiliary[0]!.status, 'settled')
    assert.deepEqual(auxiliary[0]!.usage, { inputTokens: 20, outputTokens: 10 })
  }
  const tasks = process.env['KNOWLEDGE_TASKS'] === 'true'
    ? await taskScenario(ctx, run, connection, a, b, hold) : undefined
  if (managing) {
    const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
    const append = stream.append.bind(stream)
    stream.append = async (cursor, values, options) => {
      const terminal = JSON.stringify(values).includes('management/completed')
      if (terminal) await hold('management-pending')
      const result = await append(cursor, values, options)
      if (terminal) await hold('management-completed')
      return result
    }
    const result = await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'pause-cut', phase: 'paused' }))
    assert.equal(result.status, 'completed')
    if (recovering) {
      assert.equal(run.snapshot().phase, 'running')
      assert.equal(Object.keys(run.snapshot().management ?? {}).length, 3)
    }
  }
  const runReference = await run.getPersistenceReference(run.snapshot().revision)
  assert.equal(runReference.runId, run.snapshot().spec.runId)
  const teamState = await ctx.teams.getTeam({ teamId: team.team.id })
  const teamReference = await ctx.teams.getPersistenceReference({ kind: 'team', teamId: team.team.id, expectedCursor: teamState.team.cursor })
  assert.equal(teamReference.firstSequence, 0)
  const channelState = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const channelReference = await ctx.teams.getPersistenceReference({ kind: 'channel', channelId: channel.manifest.id,
    expectedCursor: channelState.cursor })
  assert.equal(channelReference.firstSequence, 0)
  let sessionReferences = 0
  for (const entity of Object.values(run.snapshot().entities)) {
    if (entity.id === dormant) continue
    assert.ok(entity.binding)
    const session = ctx.sessions.get(entity.binding.sessionId)
    assert.ok(session)
    assert.ok(await ctx.sessions.flush(session))
    const reference = await ctx.sessionPersistence.getPersistenceReference(session.id, session.events.length - 1)
    assert.equal(reference.header.teamId, team.team.id)
    assert.equal(reference.header.participantId, entity.binding.participantId)
    sessionReferences += 1
  }
  assert.equal(sessionReferences, 3)
  const checkpointStream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const checkpointAppend = checkpointStream.append.bind(checkpointStream)
  checkpointStream.append = async (cursor, values, options) => {
    const text = JSON.stringify(values)
    if (text.includes('checkpoint/published')) await hold('checkpoint-before-publish')
    const result = await checkpointAppend(cursor, values, options)
    if (text.includes('checkpoint/requested')) await hold('checkpoint-requested')
    if (text.includes('checkpoint/published')) await hold('checkpoint-published')
    return result
  }
  const checkpoint = await connection.checkpoint(checkpointRequest)
  assert.equal(checkpoint.status, 'completed')
  if (checkpoint.status !== 'completed') throw new Error('Checkpoint failed')
  assert.deepEqual(checkpoint.manifest.sessions.filter(value => value.kind === 'unmaterialized'), [{ kind: 'unmaterialized', ...dormantBinding }])
  assert.deepEqual(await connection.checkpoint(checkpointRequest), checkpoint)
  assert.equal(run.snapshot().latestCheckpointId, checkpointRequest.id)
  const cut = await connection.collectCheckpointCandidate(4, 3)
  try {
    assert.equal(cut.snapshot.phase, 'paused')
    assert.equal(Object.values(cut.snapshot.entities).filter(entity => entity.writer?.phase === 'released').length, 3)
    assert.equal(cut.sessions.length, 4)
    assert.equal(cut.channels.length, 1)
    await cut.validate()
  } finally { cut.release() }
  console.log(JSON.stringify({ ...tasks === undefined ? {} : { tasks },
    ...compacting ? { rejectedCompactionRoutes } : {},
    ...reportOnly ? { retainedViewDuringCompaction: true } : {},
    referenceOwners: { run: 1, team: 1, channel: 1, sessions: sessionReferences },
    runCut: { phase: cut.snapshot.phase, writersReleased: 3 },
    checkpoint: { status: checkpoint.status, version: checkpoint.manifest.version, unmaterializedSessions: 1 },
    summary: { statement: summary.statement, source: summary.source.kind }, observations,
    versions: run.snapshot().knowledge?.[base.id]?.length,
    bVisible: query(b).map(value => value.id), cVisible: query(c).map(value => value.id), time: run.snapshot().time }))
} catch (error) { console.error(error); throw error } finally { await run.close(); await ctx.fiber.dispose() }
