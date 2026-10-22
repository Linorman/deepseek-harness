/** Scripted model, fair window and actor residency measurements through real Loader owners. @module */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationDecisionIdSchema,
  simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema, simulationContextRequestSchema,
  simulationCheckpointRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationEntityId, SimulationSnapshot, SimulationDispatchSelection, SimulationEntity, SimulationWindow } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { parseSimulationBenchmarkOptions } from '../../../scripts/simulation-benchmark-options.ts'
import { benchmarkLatencySummary, benchmarkDiskBytes, writeBenchmarkRecovery } from '../../../scripts/simulation-benchmark-metrics.ts'

const options = parseSimulationBenchmarkOptions(process.argv.slice(3))
if (options.workload !== 'actors' && options.workload !== 'actors-world') throw new Error('Cognition benchmark requires --workload actors or actors-world')
const root = process.env['SIMULATION_COMPANY_ROOT']
if (!root) throw new Error('SIMULATION_COMPANY_ROOT must name isolated benchmark data')
const ctx = await boot('simulation-actor-benchmark', process.argv[2]!)
let run: SimulationRun | undefined
let worldEvents = 0, worldMs = 0, boundParticipants = 0
const worldLatencies: number[] = []
let completed = 0, issued = 0, windows = 0, activeModels = 0, peakModels = 0, peakResidents = 0, peakQueuedObserved = 0
let peakRssBytes = 0, starts = 0, resumes = 0, maxSelectedWaitRounds = 0
const calls = new Map<string, number>()
const served = new Map<SimulationEntityId, number>()
const latencies: number[] = [], windowLatencies: number[] = [], placementLatencies: number[] = []
const emit = (value: unknown) => { console.log(JSON.stringify(value)) }
const sample = () => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024)
  peakQueuedObserved = Math.max(peakQueuedObserved, ctx.simulationTeams.modelUsage().queued)
  if (run !== undefined) peakResidents = Math.max(peakResidents, run.population().chargedActors)
}
const provider = ctx.agentRuntimes.getProvider('in-process')
assert.ok(provider)
const activate = provider.activate.bind(provider)
provider.activate = async (request) => {
  const result = await activate(request)
  starts += 1
  if (request.seed.kind === 'resume') resumes += 1
  return result
}
ctx.llm.registerAdapter(['benchmark-model'], new class extends LlmAdapter {
  async *stream(request: GenerateOptions): AsyncGenerator<StreamChunk> {
    const view = request.messages.find(message => message.source.kind === 'simulation-context-view')
    assert.ok(view)
    const marker = view.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      .map(text => /^Benchmark decision (decision-\d+) for (entity-\d+)$/.exec(text)).find(value => value !== null)
    assert.ok(marker)
    const decision = marker[1]!
    const index = calls.get(decision) ?? 0
    calls.set(decision, index + 1)
    assert.deepEqual(request.tools?.map(tool => tool.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
    const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
    assert.ok(name, 'A scripted decision must finish after submission')
    activeModels += 1
    const previousPeak = peakModels
    peakModels = Math.max(peakModels, activeModels)
    sample()
    if (peakModels > previousPeak) emit({ kind: 'progress', phase: 'model-peak', completed, peakModels, peakResidents, peakRssBytes })
    try {
      await delay(options.modelDelayMs, undefined, { signal: request.signal })
      sample()
      const id = CallId(`${decision}/${index}`)
      const args = JSON.stringify(index === 1 ? { proposals: [] } : {})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } finally { activeModels -= 1 }
  }
}())
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'actor-benchmark', tickUnit: 'hour', origin: '0', maxTime: '100', rulesVersion: 'benchmark-1', policyVersion: 'benchmark-1',
  outboxMaxAttempts: 1, outboxRetryDelayMs: 0, maxDriveSteps: options.sampleEvery, maxMicrostepsPerTime: options.operations + 1,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: options.timeoutMs, maxConflictRetries: 0,
  maxIngressBytes: 4096, maxEntities: options.entities, maxResidentActors: options.residents, maxDecisionsPerWindow: options.residents,
  maxOperationsPerDecision: 1, maxResourceReservationHistory: 128, maxResourceQuantity: '1', maxQueuedDecisions: options.entities,
  maxDispatchWaitRounds: Math.ceil(options.entities / options.residents), budgetInterval: '100',
  maxDecisionsPerInterval: options.operations, maxMessagesPerInterval: 0,
  maxTokensPerInterval: options.operations * 300, tokensPerModelRequest: 100,
  maxPendingEvents: options.operations + 1, maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
} })
try {
  const setupStarted = performance.now()
  run = await ctx.simulations.open(selection)
  const ownedRun = run
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Measure scripted cognition and residency', budgets: {} }, budgets: {} },
    'simulation/actor-benchmark')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/actor-benchmark')
  const entitiesStarted = performance.now()
  const ids = Array.from({ length: options.entities }, (_, i) => simulationEntityIdSchema.parse(`entity-${i}`))
  for (let start = 0; start < ids.length; start += options.entityBatchSize) {
    await run.changeMany(ids.slice(start, start + options.entityBatchSize).map(id => simulationChangeSchema.parse({
      kind: 'entity/create', readiness: 'ready', id, entityKind: 'benchmark-actor', cognition: 'agent', profile: {},
    })), run.snapshot().revision)
  }
  const entitySetupMs = performance.now() - entitiesStarted
  if (options.workload === 'actors-world') {
    const worldRevision = run.snapshot().revision
    const versions = ids.map(() => 1)
    const worldStarted = performance.now()
    while (worldEvents < options.worldEvents && performance.now() - worldStarted < options.durationMs) {
      const started = performance.now()
      const size = Math.min(options.worldBatchSize, options.worldEvents - worldEvents)
      const changes = Array.from({ length: size }, (_, offset) => {
        const sequence = worldEvents + offset, index = sequence % ids.length
        const change = simulationChangeSchema.parse({ kind: 'entity/profile', id: ids[index]!, entityRevision: versions[index]!,
          profile: { sequence: sequence + 1 } })
        versions[index]! += 1
        return change
      })
      await run.changeMany(changes, run.snapshot().revision)
      worldEvents += size
      worldLatencies.push(performance.now() - started)
      sample()
      if (Math.floor(worldEvents / options.sampleEvery) !== Math.floor((worldEvents - size) / options.sampleEvery)) {
        emit({ kind: 'progress', phase: 'world-history', worldEvents, requestedWorldEvents: options.worldEvents, peakRssBytes })
      }
    }
    worldMs = performance.now() - worldStarted
    const state = run.snapshot()
    assert.equal(state.revision, worldRevision + worldEvents)
    for (const [index, id] of ids.entries()) {
      assert.equal(state.entities[id]?.revision, versions[index])
      const last = index < worldEvents ? index + Math.floor((worldEvents - 1 - index) / ids.length) * ids.length + 1 : 0
      assert.deepEqual(state.entities[id]?.profile, last === 0 ? {} : { sequence: last })
    }
    emit({ kind: 'progress', phase: 'world-history-finished', worldEvents, requestedWorldEvents: options.worldEvents, peakRssBytes })
  }
  const participantsStarted = performance.now()
  for (const [index, id] of (options.workload === 'actors-world' ? [] : ids).entries()) {
    await connection.ensureParticipant(id, { displayName: id, role: 'benchmark-actor', capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'benchmark-model/scripted' })
    boundParticipants += 1
    if ((index + 1) % options.sampleEvery === 0) {
      sample()
      emit({ kind: 'progress', phase: 'participants', participants: index + 1, peakRssBytes })
    }
  }
  let participantSetupMs = performance.now() - participantsStarted
  const nominate = async (entityId: SimulationEntityId) => {
    if (issued >= options.operations) return
    if (options.workload === 'actors-world' && ownedRun.inspectEntity(entityId).entity?.binding === undefined) {
      const bindingStarted = performance.now()
      await connection.ensureParticipant(entityId, { displayName: entityId, role: 'benchmark-actor', capabilities: [],
        provider: 'in-process', preset: 'simulation', model: 'benchmark-model/scripted' })
      participantSetupMs += performance.now() - bindingStarted
      boundParticipants += 1
      sample()
      emit({ kind: 'progress', phase: 'binding', boundParticipants, queued: issued, worldEvents, peakRssBytes })
    }
    const id = simulationDecisionIdSchema.parse(`decision-${issued}`)
    await ownedRun.queueDecision(simulationDispatchCandidateSchema.parse({ id, entityId, priority: 0 }))
    issued += 1
  }
  const nominationsStarted = performance.now()
  for (const id of ids) {
    if (issued >= options.operations) break
    await nominate(id)
    if (issued % options.sampleEvery === 0) {
      sample()
      emit({ kind: 'progress', phase: 'nominations', queued: issued, peakRssBytes })
    }
  }
  const nominationSetupMs = performance.now() - nominationsStarted
  emit({ kind: 'progress', phase: 'nominations-finished', queued: issued, boundParticipants, worldEvents, peakRssBytes })
  await run.setPhase('running', run.snapshot().revision)
  const setupMs = performance.now() - setupStarted
  const started = performance.now()
  while (completed < options.operations && performance.now() - started < options.durationMs) {
    const windowStarted = performance.now()
    const allocationRequest = simulationDispatchSelectionRequestSchema.parse({ id: `window-${windows}`,
      limit: Math.min(options.residents, options.operations - completed) })
    const allocation: SimulationDispatchSelection | undefined = await run.reserveDecisionWindow(allocationRequest, run.snapshot().revision)
    assert.ok(allocation)
    const current = run.snapshot()
    const selected: SimulationEntityId[] = allocation.decisions.map(id => current.decisionDispatch!.tickets[id]!.candidate.entityId)
    for (const entityId of selected) {
      const before: SimulationSnapshot = run.snapshot()
      const entity: SimulationEntity = before.entities[entityId]!
      const placementStarted = performance.now()
      const placement = await connection.ensureResident(entityId, { activation: {
        provider: 'in-process', seed: { kind: entity.writer === undefined ? 'fresh' : 'resume' },
        agent: { preset: 'simulation', options: { provider: 'benchmark-model', model: 'scripted' } }, signal: new AbortController().signal,
      }, evict: Object.values(before.entities).filter(value => !selected.includes(value.id) && value.writer?.phase === 'active').map(value => value.id) })
      assert.equal(placement.status, 'resident')
      if (placement.status !== 'resident') throw new Error('Benchmark actor placement did not complete')
      assert.equal(placement.lease.binding.sessionId, entity.binding?.sessionId)
      placementLatencies.push(performance.now() - placementStarted)
      sample()
    }
    emit({ kind: 'progress', phase: 'placement-finished', windows, completed, boundParticipants, peakResidents, peakRssBytes })
    const source: SimulationSnapshot = run.snapshot()
    const decisions = allocation.decisions.map((id) => {
      const ticket = source.decisionDispatch!.tickets[id]!
      maxSelectedWaitRounds = Math.max(maxSelectedWaitRounds, Number(BigInt(allocation.round) - BigInt(ticket.queuedRound)))
      const entityId = ticket.candidate.entityId
      return { id, entityId, context: simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
        personaVersion: 'benchmark-1', modelVersion: 'scripted-1', sources: [{ kind: 'run-event', runId: source.spec.runId, sequence: source.revision }],
        sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
          blocks: [{ type: 'text', text: kind === 'input' ? `Benchmark decision ${id} for ${entityId}` : kind }] })),
      }) }
    })
    await connection.openWindow({ id: allocationRequest.id, decisions })
    await Promise.all(decisions.map(async (decision) => {
      const decisionStarted = performance.now()
      const result = await connection.executeDecision(decision.entityId, decision.id, decision.context)
      assert.equal(result.status, 'submitted')
      latencies.push(performance.now() - decisionStarted)
    }))
    const committed: SimulationWindow = await run.commitWindow(allocationRequest.id)
    assert.equal(committed.status, 'closed')
    for (const decision of decisions) {
      assert.equal(run.snapshot().decisions[decision.id]?.status, 'accepted')
      served.set(decision.entityId, (served.get(decision.entityId) ?? 0) + 1)
      completed += 1
      await nominate(decision.entityId)
    }
    windows += 1
    windowLatencies.push(performance.now() - windowStarted)
    sample()
    emit({ kind: 'progress', phase: 'windows', completed, windows, peakModels, peakResidents, peakQueuedObserved, peakRssBytes })
  }
  const workMs = performance.now() - started
  const modelCalls = [...calls.values()].reduce((sum, count) => sum + count, 0)
  assert.ok([...calls.values()].every(count => count === 3))
  assert.equal(modelCalls, completed * 3)
  assert.ok(peakModels <= options.models && peakResidents <= options.residents)
  assert.equal(activeModels, 0)
  assert.equal(ctx.simulationTeams.modelUsage().active, 0)
  assert.equal(ctx.simulationTeams.modelUsage().queued, 0)
  assert.equal(run.budgetUsage().tokens.used, modelCalls * 15)
  assert.equal(Object.values(run.snapshot().decisions).filter(value => value.status === 'accepted').length, completed)
  const checkpointStarted = performance.now()
  const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'actor-cut', implementationVersion: 'actor-benchmark-1', maxDrainRounds: 4, maxAttempts: 3 })
  assert.equal((await connection.checkpoint(checkpoint)).status, 'completed')
  const checkpointMs = performance.now() - checkpointStarted
  const before: SimulationSnapshot = run.snapshot()
  assert.equal(Object.values(before.entities).filter(entity => entity.binding !== undefined).length, boundParticipants)
  const digest = createHash('sha256').update(JSON.stringify(before)).digest('hex')
  const bytesBeforeClose = await benchmarkDiskBytes(root)
  await run.close()
  emit({ kind: 'progress', phase: 'restore-start', completed, windows, peakRssBytes })
  const restoreStarted = performance.now()
  const restored = await ctx.simulationTeams.restore({ ...selection, mode: 'open' }, {
    id: checkpoint.id, implementationVersion: checkpoint.implementationVersion, maxAttempts: 3,
  })
  run = restored.run
  const restoreMs = performance.now() - restoreStarted
  assert.equal(createHash('sha256').update(JSON.stringify(run.snapshot())).digest('hex'), digest)
  assert.equal([...calls.values()].reduce((sum, count) => sum + count, 0), modelCalls)
  assert.equal(run.population().chargedActors, 0)
  await run.close()
  sample()
  for (const [phase, milliseconds] of [['decision', latencies], ['window', windowLatencies], ['placement', placementLatencies]] as const) {
    emit({ kind: 'latencies', phase, milliseconds })
  }
  await writeBenchmarkRecovery(root, { ...selection, mode: 'open' }, {
    id: checkpoint.id, implementationVersion: 'actor-benchmark-1', maxAttempts: 3,
  }, digest)
  if (options.workload === 'actors-world') emit({ kind: 'latencies', phase: 'world-batch', milliseconds: worldLatencies })
  emit({ kind: 'result', recoveryMode: 'same-process-owner-services',
    layer: options.workload === 'actors-world' ? 'scripted-cognition-with-world-history' : 'scripted-cognition',
    completion: completed === options.operations && (options.workload !== 'actors-world' || worldEvents === options.worldEvents) ? 'target-complete' : 'time-budget',
    ...options.workload === 'actors-world' ? { worldEvents, requestedWorldEvents: options.worldEvents, worldBatchSize: options.worldBatchSize,
      worldMs, worldThroughputPerSecond: worldEvents * 1000 / worldMs, worldPhase: benchmarkLatencySummary(worldLatencies, worldMs),
      worldComplete: worldEvents === options.worldEvents, cognitionComplete: completed === options.operations } : {},
    setupMs, entitySetupMs, participantSetupMs, nominationSetupMs, workMs, completed, requested: options.operations,
    journalEntries: before.revision + 1,
    modelCalls, modelDelayMs: options.modelDelayMs,
    participantBinding: options.workload === 'actors-world' ? 'on-demand' : 'eager',
    boundParticipants,
    throughputPerSecond: completed * 1000 / workMs, peakModels, peakResidents, peakQueuedObserved, starts, resumes,
    uniqueServed: served.size, neverServed: options.entities - served.size, maxSelectedWaitRounds,
    queuedDecisions: Object.values(before.decisionDispatch?.tickets ?? {}).filter(ticket => ticket.status === 'queued').length,
    syntheticUsage: true, reportedTokens: modelCalls * 15, modelCost: 0, teamMessages: 0,
    phases: { decision: benchmarkLatencySummary(latencies, workMs), window: benchmarkLatencySummary(windowLatencies, workMs),
      placement: benchmarkLatencySummary(placementLatencies, placementLatencies.reduce((sum, value) => sum + value, 0)) },
    checkpointMs, restoreMs, peakRssBytes, diskBytes: await benchmarkDiskBytes(root), bytesBeforeClose, cpuMicros: process.cpuUsage(),
    replayEqual: true, canonicalSessionsPreserved: true, acceptedResponsibilitiesPreserved: true, stalled: before.stall ?? null })
} finally { await run?.close(); await ctx.fiber.dispose() }
