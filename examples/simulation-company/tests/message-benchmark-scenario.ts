/** Serial and windowed Team delivery, model-visible receipt and exact retry measurements. @module */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationDecisionIdSchema,
  simulationProposalSchema, simulationChannelSpecSchema, simulationContextRequestSchema,
  simulationCheckpointRequestSchema, simulationWindowIdSchema,
  simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationEntityId, SimulationProposal, SimulationEventId, SimulationDecision } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { parseSimulationBenchmarkOptions } from '../../../scripts/simulation-benchmark-options.ts'
import { benchmarkLatencySummary, benchmarkDiskBytes, writeBenchmarkRecovery } from '../../../scripts/simulation-benchmark-metrics.ts'

const options = parseSimulationBenchmarkOptions(process.argv.slice(3))
if (options.workload !== 'messages' && options.workload !== 'parallel-messages') throw new Error('Delivery benchmark requires --workload messages')
const parallel = options.workload === 'parallel-messages'
const batchLimit = parallel ? Math.floor(options.residents / 2) : 1
const root = process.env['SIMULATION_COMPANY_ROOT']
if (!root) throw new Error('SIMULATION_COMPANY_ROOT must name isolated benchmark data')
const ctx = await boot('simulation-message-benchmark', process.argv[2]!)
let run: SimulationRun | undefined
let activeModels = 0, peakModels = 0, maxRecipientCohort = 0
let completed = 0, rounds = 0, modelCalls = 0, peakResidents = 0, peakRssBytes = 0, resumes = 0
const scripts = new Map<string, {
  id: string
  sessionId: string
  proposals: SimulationProposal[]
  request: number
  expectedText?: string
}>()
const seenTexts = new Set<string>(), envelopes = new Set<string>()
const latencies: number[] = [], transportLatencies: number[] = []
const emit = (value: unknown) => { console.log(JSON.stringify(value)) }
const sample = () => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024)
  if (run !== undefined) peakResidents = Math.max(peakResidents, run.population().chargedActors)
}
ctx.llm.registerAdapter(['message-benchmark'], new class extends LlmAdapter {
  async *stream(request: GenerateOptions): AsyncGenerator<StreamChunk> {
    const view = request.messages.find(message => message.source.kind === 'simulation-context-view')
    assert.ok(view)
    const marker = view.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      .map(text => /^Benchmark decision (\S+)$/.exec(text)).find(value => value !== null)
    assert.ok(marker)
    const current = scripts.get(marker[1]!)
    assert.ok(current)
    assert.equal(request.sessionId, current.sessionId)
    assert.deepEqual(request.tools?.map(tool => tool.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
    const expectedText = current.expectedText
    if (expectedText !== undefined) {
      assert.ok(request.messages.some(message => message.source.kind === 'team-envelope'
        && JSON.stringify(message.content).includes(expectedText)))
      seenTexts.add(expectedText)
    }
    const index = current.request++
    const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
    assert.ok(name)
    modelCalls += 1
    activeModels += 1
    peakModels = Math.max(peakModels, activeModels)
    try {
      await delay(options.modelDelayMs, undefined, { signal: request.signal })
      const id = CallId(`${current.id}/${index}`)
      const args = JSON.stringify(index === 1 ? { proposals: current.proposals } : {})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } finally { activeModels -= 1 }
  }
}())
let responseLossInjected = false
const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
ctx.teams.postChannelEnvelope = async (...args) => {
  const envelope = await post(...args)
  if (process.env['SIMULATION_BENCHMARK_LOST_POST'] === 'true' && !responseLossInjected) {
    responseLossInjected = true
    throw new Error('Injected response loss after durable Team publication')
  }
  return envelope
}
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'message-benchmark', tickUnit: 'hour', origin: '0', maxTime: String(options.operations + 1),
  rulesVersion: 'benchmark-1', policyVersion: 'benchmark-1', outboxMaxAttempts: 2, outboxRetryDelayMs: 0,
  maxDriveSteps: options.sampleEvery, maxMicrostepsPerTime: options.operations + 1, phaseOrder: ['delivery', 'decision', 'deadline'],
  decisionTimeoutMs: options.timeoutMs, maxConflictRetries: 0, maxIngressBytes: 4096, maxEntities: options.entities,
  maxResidentActors: options.residents, maxDecisionsPerWindow: batchLimit, maxOperationsPerDecision: 1, maxResourceReservationHistory: 128, maxResourceQuantity: '1',
  maxQueuedDecisions: options.entities, maxDispatchWaitRounds: options.entities, budgetInterval: String(options.operations + 1),
  maxDecisionsPerInterval: options.operations * 2, maxMessagesPerInterval: options.operations,
  maxTokensPerInterval: options.operations * 600, tokensPerModelRequest: 100, maxPendingEvents: options.operations * 2 + options.entities,
  maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
} })
try {
  const setupStarted = performance.now()
  run = await ctx.simulations.open(selection)
  const ownedRun = run
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Measure exactly-once Team delivery', budgets: {} }, budgets: {} },
    'simulation/message-benchmark')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/message-benchmark')
  const ids = Array.from({ length: options.entities }, (_, i) => simulationEntityIdSchema.parse(`entity-${i}`))
  const rootSetupMs = performance.now() - setupStarted
  const entityStarted = performance.now()
  for (let start = 0; start < ids.length; start += options.entityBatchSize) {
    await run.changeMany(ids.slice(start, start + options.entityBatchSize).map(id => simulationChangeSchema.parse({
      kind: 'entity/create', readiness: 'ready', id, entityKind: 'benchmark-actor', cognition: 'agent', profile: {},
    })), run.snapshot().revision)
    sample()
    emit({ kind: 'progress', phase: 'entities', entities: Math.min(start + options.entityBatchSize, ids.length), peakRssBytes })
  }
  const entitySetupMs = performance.now() - entityStarted
  const participantStarted = performance.now()
  for (const [index, id] of ids.entries()) {
    await connection.ensureParticipant(id, { displayName: id, role: 'benchmark-actor', capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'message-benchmark/scripted' })
    if ((index + 1) % options.sampleEvery === 0 || index + 1 === ids.length) {
      sample(); emit({ kind: 'progress', phase: 'participants', participants: index + 1, peakRssBytes })
    }
  }
  const participantSetupMs = performance.now() - participantStarted
  const channelStarted = performance.now()
  const channels: Awaited<ReturnType<typeof connection.ensureChannel>>[] = []
  for (const [index, id] of ids.entries()) {
    channels.push(await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: `route-${index}`,
      members: [{ entityId: id, role: 'sender' }, { entityId: ids[(index + 1) % ids.length]!, role: 'recipient' }], limits: {} })))
    if ((index + 1) % options.sampleEvery === 0) { sample(); emit({ kind: 'progress', phase: 'routes', channels: index + 1, peakRssBytes }) }
  }
  const channelSetupMs = performance.now() - channelStarted
  const ensurePair = async (pair: SimulationEntityId[]) => {
    for (const id of pair) {
      const state = ownedRun.snapshot(), entity = state.entities[id]!
      const wasResident = entity.writer?.phase === 'active'
      const placement = await connection.ensureResident(id, { activation: { provider: 'in-process',
        seed: { kind: entity.writer === undefined ? 'fresh' : 'resume' },
        agent: { preset: 'simulation', options: { provider: 'message-benchmark', model: 'scripted' } }, signal: new AbortController().signal },
      evict: Object.values(state.entities).filter(value => value.writer?.phase === 'active' && !pair.includes(value.id)).map(value => value.id) })
      assert.equal(placement.status, 'resident')
      if (placement.status !== 'resident') throw new Error('Message pair is not resident')
      assert.equal(placement.lease.binding.sessionId, entity.binding!.sessionId)
      if (!wasResident && entity.writer !== undefined) resumes += 1
      sample()
    }
  }
  const decideBatch = async (tasks: readonly {
    entityId: SimulationEntityId
    name: string
    proposals: SimulationProposal[]
    wakeId?: SimulationEventId
    expectedText?: string
  }[], windowName: string): Promise<SimulationDecision[]> => {
    const state = ownedRun.snapshot()
    const decisions = tasks.map((task) => {
      const id = simulationDecisionIdSchema.parse(task.name)
      scripts.set(id, { id, sessionId: state.entities[task.entityId]!.binding!.sessionId, proposals: task.proposals, request: 0,
        ...task.expectedText === undefined ? {} : { expectedText: task.expectedText } })
      return { id, entityId: task.entityId, ...task.wakeId === undefined ? {} : { wakeId: task.wakeId },
        context: simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
          personaVersion: 'message-benchmark-1', modelVersion: 'scripted-1',
          sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: state.revision }],
          sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
            blocks: [{ type: 'text', text: kind === 'input' ? `Benchmark decision ${id}` : kind }] })),
        }) }
    })
    const windowId = simulationWindowIdSchema.parse(windowName)
    if (parallel) await connection.openWindow({ id: windowId, decisions })
    await Promise.all(decisions.map(async (decision) => {
      const result = await connection.executeDecision(decision.entityId, decision.id, decision.context, decision.wakeId)
      assert.equal(result.status, parallel ? 'submitted' : 'accepted')
      assert.equal(scripts.get(decision.id)!.request, 3)
    }))
    if (parallel) assert.equal((await ownedRun.commitWindow(windowId)).status, 'closed')
    const accepted = ownedRun.snapshot()
    return decisions.map((decision) => {
      const result = accepted.decisions[decision.id]!
      assert.equal(result.status, 'accepted')
      return result
    })
  }
  await run.setPhase('running', run.snapshot().revision)
  const setupMs = performance.now() - setupStarted
  const started = performance.now()
  while (completed < options.operations && performance.now() - started < options.durationMs) {
    const iterationStarted = performance.now()
    const batch: Array<{
      number: number
      sender: SimulationEntityId
      recipient: SimulationEntityId
      channel: Awaited<ReturnType<typeof connection.ensureChannel>>
      text: string
    }> = Array.from({ length: Math.min(batchLimit, options.operations - completed) }, (_, offset) => {
      const index = (completed + offset * 2) % ids.length
      return { number: completed + offset, sender: ids[index]!, recipient: ids[(index + 1) % ids.length]!,
        channel: channels[index]!, text: `BENCHMARK_PAYLOAD_${completed + offset}_END` }
    })
    await ensurePair(batch.flatMap(item => [item.sender, item.recipient]))
    const until = simTimeSchema.parse(String(rounds + 1))
    const sent = await decideBatch(batch.map(item => ({ entityId: item.sender, name: `send-${item.number}`,
      proposals: [simulationProposalSchema.parse({ after: [], action: { kind: 'communication/post', recipient: item.recipient,
        channelId: item.channel.manifest.id, text: item.text, deliverAt: until } })] })), `send-window-${rounds}`)
    for (const item of batch) {
      const actor = ctx.agents.get(ownedRun.snapshot().entities[item.recipient]!.binding!.sessionId)
      assert.ok(actor)
      assert.ok(!actor.session.deriveMessages().some(message => message.source.kind === 'team-envelope'
        && JSON.stringify(message.content).includes(item.text)))
    }
    const transportStarted = performance.now()
    let driven = await connection.drive({ until }, Date.now)
    while (driven.reason === 'coordination-limit' || driven.reason === 'work-limit' || driven.reason === 'retry') {
      driven = await connection.drive({ until }, Date.now)
    }
    assert.equal(driven.reason, 'decision-required')
    if (parallel) {
      let collected = await ownedRun.collectDecisionWakes({ until })
      while (collected.reason === 'work-limit') collected = await ownedRun.collectDecisionWakes({ until })
      assert.equal(collected.reason, 'decision-required')
    }
    const deliveryState = ownedRun.snapshot()
    const activeWakes = Object.values(deliveryState.wakes).filter(wake => wake.status === 'pending')
    assert.equal(activeWakes.length, batch.length)
    maxRecipientCohort = Math.max(maxRecipientCohort, activeWakes.length)
    const causalKeys = activeWakes.map(wake => deliveryState.scheduledEvents[wake.eventId]!.key)
    assert.equal(new Set(causalKeys.map(key => `${key.time}/${key.microstep}/${key.phase}`)).size, 1)
    const delivered = sent.map(decision => deliveryState.operations[decision.operationIds[0]!]!)
    for (const operation of delivered) {
      assert.ok(operation.delivery?.receipt)
      assert.ok(operation.outbox?.receipt)
      assert.ok(!envelopes.has(operation.outbox.receipt.envelopeId))
      envelopes.add(operation.outbox.receipt.envelopeId)
      assert.equal(deliveryState.wakes[operation.delivery.wakeId]?.status, 'pending')
    }
    transportLatencies.push(performance.now() - transportStarted)
    await decideBatch(batch.map((item, index) => ({ entityId: item.recipient, name: `read-${item.number}`,
      proposals: [], wakeId: delivered[index]!.delivery!.wakeId, expectedText: item.text })), `read-window-${rounds}`)
    for (const [index, item] of batch.entries()) {
      const beforeRetry = await ctx.teams.getChannel({ channelId: item.channel.manifest.id })
      const operationId = sent[index]!.operationIds[0]!
      await connection.dispatchOperation(operationId, Date.now)
      await connection.receiveOperation(operationId)
      const actor = ctx.agents.get(ownedRun.snapshot().entities[item.recipient]!.binding!.sessionId)
      assert.ok(actor)
      assert.equal([...actor.inbox.nextTurn, ...actor.inbox.nextStep]
        .filter(message => message.source.kind === 'team-envelope').length, 0)
      assert.equal((await ctx.teams.getChannel({ channelId: item.channel.manifest.id })).cursor, beforeRetry.cursor)
      latencies.push(performance.now() - iterationStarted)
    }
    completed += batch.length
    rounds += 1
    sample()
    if (completed % options.sampleEvery === 0) emit({ kind: 'progress', phase: 'delivery', completed, modelCalls, peakResidents, peakRssBytes })
  }
  const workMs = performance.now() - started
  assert.equal(modelCalls, completed * 6)
  assert.equal(seenTexts.size, completed)
  assert.equal(run.budgetUsage().tokens.used, modelCalls * 15)
  assert.ok(peakResidents <= options.residents)
  assert.ok(Object.values(run.snapshot().wakes).every(wake => wake.status === 'completed'))
  assert.equal(activeModels, 0)
  assert.ok(peakModels <= options.models)
  const checkpointStarted = performance.now()
  const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'delivery-cut', implementationVersion: 'message-benchmark-1', maxDrainRounds: 4, maxAttempts: 3 })
  assert.equal((await connection.checkpoint(checkpoint)).status, 'completed')
  const checkpointMs = performance.now() - checkpointStarted
  const before = run.snapshot(), inputIds = new Set<string>()
  let durableInputs = 0
  for (const entity of Object.values(before.entities)) {
    const id = entity.binding!.sessionId
    if (await ctx.sessionPersistence.isUnmaterialized(id)) continue
    for (const event of (await ctx.sessionPersistence.readFrom(id, 0)).events) {
      if (event.type !== 'user/message' || event.data.source.kind !== 'team-envelope') continue
      durableInputs += 1
      inputIds.add(event.data.id)
    }
  }
  assert.equal(durableInputs, completed)
  assert.equal(inputIds.size, completed)
  let walEnvelopes = 0, walReceipts = 0
  const retainedEnvelopes = new Set<string>(), retainedReceipts = new Set<string>()
  for (const channel of channels) {
    let afterCursor = -1
    while (true) {
      const page = await ctx.teams.readChannelPage({ channelId: channel.manifest.id, afterCursor, limit: options.sampleEvery })
      for (const record of page.records) {
        if (record.type === 'channel/envelope') { walEnvelopes += 1; retainedEnvelopes.add(record.envelope.id) }
        if (record.type === 'channel/receipt') { walReceipts += 1; retainedReceipts.add(record.envelopeId) }
      }
      if (page.nextCursor === undefined) break
      afterCursor = page.nextCursor
    }
  }
  assert.equal(walEnvelopes, completed)
  assert.equal(walReceipts, completed)
  assert.deepEqual(retainedEnvelopes, envelopes)
  assert.deepEqual(retainedReceipts, envelopes)
  const digest = createHash('sha256').update(JSON.stringify(before)).digest('hex')
  await run.close()
  emit({ kind: 'progress', phase: 'restore-start', completed, peakRssBytes })
  const restoreStarted = performance.now()
  const restored = await ctx.simulationTeams.restore({ ...selection, mode: 'open' }, {
    id: checkpoint.id, implementationVersion: checkpoint.implementationVersion, maxAttempts: 3,
  })
  run = restored.run
  const restoreMs = performance.now() - restoreStarted
  assert.equal(createHash('sha256').update(JSON.stringify(run.snapshot())).digest('hex'), digest)
  assert.equal(modelCalls, completed * 6)
  await run.close()
  sample()
  emit({ kind: 'latencies', phase: 'message', milliseconds: latencies })
  emit({ kind: 'latencies', phase: 'transport', milliseconds: transportLatencies })
  await writeBenchmarkRecovery(root, { ...selection, mode: 'open' }, {
    id: checkpoint.id, implementationVersion: 'message-benchmark-1', maxAttempts: 3,
  }, digest)
  emit({ kind: 'result', recoveryMode: 'same-process-owner-services', layer: 'team-delivery', completion: completed === options.operations ? 'target-complete' : 'time-budget',
    setupMs,
    setupPhases: { rootMs: rootSetupMs, entitiesMs: entitySetupMs, participantsMs: participantSetupMs, channelsMs: channelSetupMs },
    workMs, completed, parallelWindows: parallel, decisionWindows: parallel ? rounds * 2 : 0,
    transportBatchLimit: batchLimit, maxRecipientCohort, requested: options.operations, throughputPerSecond: completed * 1000 / workMs,
    modelCalls, syntheticUsage: true, reportedTokens: modelCalls * 15, modelCost: 0, peakModels,
    peakResidents, resumes, teamMessages: completed, uniqueEnvelopes: envelopes.size, durableInputs, modelReadMessages: seenTexts.size,
    walEnvelopes, walReceipts, responseLossInjected, duplicateRetriesVerified: completed,
    replayEqual: true, canonicalSessionsPreserved: true,
    phaseUnits: { message: 'message', transport: 'delivery-batch' },
    phases: { message: benchmarkLatencySummary(latencies, workMs), transport: benchmarkLatencySummary(transportLatencies,
      transportLatencies.reduce((sum, value) => sum + value, 0)) }, checkpointMs, restoreMs, peakRssBytes,
    diskBytes: await benchmarkDiskBytes(root), cpuMicros: process.cpuUsage(), stalled: before.stall ?? null })
} finally { await run?.close(); await ctx.fiber.dispose() }
