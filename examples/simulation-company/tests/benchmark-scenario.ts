/** Zero-model storage and scheduler measurements through the real Simulation composition. @module */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { benchmarkLatencySummary, benchmarkDiskBytes, writeBenchmarkRecovery } from '../../../scripts/simulation-benchmark-metrics.ts'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationIngressRequestSchema,
  simulationCheckpointRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { parseSimulationBenchmarkOptions } from '../../../scripts/simulation-benchmark-options.ts'

const options = parseSimulationBenchmarkOptions(process.argv.slice(3))
if (options.workload !== 'ingress' && options.workload !== 'world') throw new Error('Storage benchmark requires ingress or world workload')
const root = process.env['SIMULATION_COMPANY_ROOT']
if (!root) throw new Error('SIMULATION_COMPANY_ROOT must name the isolated benchmark data directory')
const ctx = await boot('simulation-benchmark', process.argv[2]!)
let run: SimulationRun | undefined
let completed = 0, consumed = 0, peakRssBytes = 0
const phases: Record<string, { count: number; elapsedMs: number; p50Ms: number; p95Ms: number; p99Ms: number }> = {}
const stops: Record<string, number> = {}
const emit = (value: unknown) => { console.log(JSON.stringify(value)) }
const memory = () => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024) }
const progress = (phase: string) => { memory(); emit({ kind: 'progress', phase, completed, consumed, peakRssBytes }) }
const summarize = (name: string, latencies: number[], elapsedMs: number) => {
  emit({ kind: 'latencies', phase: name, milliseconds: latencies })
  phases[name] = benchmarkLatencySummary(latencies, elapsedMs)
}
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'benchmark', tickUnit: 'hour', origin: '0', maxTime: '100', rulesVersion: 'benchmark-1', policyVersion: 'benchmark-1',
  outboxMaxAttempts: 1, outboxRetryDelayMs: 0, maxDriveSteps: options.sampleEvery, maxMicrostepsPerTime: options.operations + 1,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 1000, maxConflictRetries: 0,
  maxIngressBytes: 4096, maxEntities: options.entities, maxResidentActors: 1, maxDecisionsPerWindow: 1, maxOperationsPerDecision: 1,
  maxResourceQuantity: '1', maxQueuedDecisions: options.operations + 1, maxDispatchWaitRounds: 1,
  budgetInterval: '100', maxDecisionsPerInterval: 0, maxMessagesPerInterval: 0, maxTokensPerInterval: 0, tokensPerModelRequest: 1,
  maxPendingEvents: options.operations + 1, maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
} })
let modelCalls = 0
ctx.on('llm/stream', () => { modelCalls += 1; throw new Error('The storage benchmark forbids model dispatch') })
try {
  const setupStarted = performance.now()
  run = await ctx.simulations.open(selection)
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Measure storage without inference', budgets: {} }, budgets: {} },
    'simulation/benchmark')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/benchmark')
  const ids = Array.from({ length: options.entities }, (_, i) => simulationEntityIdSchema.parse(`entity-${i}`))
  for (let start = 0; start < ids.length; start += options.entityBatchSize) {
    await run.changeMany(ids.slice(start, start + options.entityBatchSize).map(id => simulationChangeSchema.parse({
      kind: 'entity/create', id, entityKind: 'benchmark-actor', cognition: 'agent', profile: { sequence: 0 },
    })), run.snapshot().revision)
    progress('setup')
  }
  const setupMs = performance.now() - setupStarted
  const setupRevision = run.snapshot().revision
  const versions = Array.from({ length: options.entities }, () => 1)
  const writes: number[] = []
  const writesStarted = performance.now()
  for (let index = 0; index < options.operations && performance.now() - writesStarted < options.durationMs; index += options.workload === 'world' ? options.worldBatchSize : 1) {
    const started = performance.now(), actor = index % ids.length, id = ids[actor]!
    const batchSize = options.workload === 'world' ? Math.min(options.worldBatchSize, options.operations - index) : 1
    if (options.workload === 'ingress') {
      await run.ingest(simulationIngressRequestSchema.parse({ id: `input-${index}`, entityId: id,
        source: 'benchmark', text: `Input ${index}`, availableAt: '1' }))
    } else {
      const changes = Array.from({ length: batchSize }, (_, offset) => {
        const position = index + offset, entity = position % ids.length
        const change = simulationChangeSchema.parse({ kind: 'entity/profile', id: ids[entity]!, entityRevision: versions[entity]!,
          profile: { sequence: position + 1 } })
        versions[entity]! += 1
        return change
      })
      await run.changeMany(changes, run.snapshot().revision)
    }
    writes.push(performance.now() - started)
    completed += batchSize
    if (Math.floor(completed / options.sampleEvery) !== Math.floor((completed - batchSize) / options.sampleEvery)) progress('write')
  }
  const writePhase = options.workload === 'world' ? 'write-batch' : 'write'
  summarize(writePhase, writes, performance.now() - writesStarted)
  progress('write-finished')
  if (options.workload === 'ingress' && completed > 0) {
    await run.setPhase('running', run.snapshot().revision)
    const started = performance.now(), calls: number[] = []
    while (performance.now() - started < options.durationMs) {
      const callStarted = performance.now()
      const result = await run.collectDecisionWakes({ until: simTimeSchema.parse('1') })
      calls.push(performance.now() - callStarted)
      stops[result.reason] = (stops[result.reason] ?? 0) + 1
      consumed = Object.values(run.snapshot().scheduledEvents).filter(value => value.status === 'consumed').length
      progress('consume')
      if (result.reason !== 'work-limit') break
    }
    summarize('consume', calls, performance.now() - started)
  }
  const state = run.snapshot()
  assert.equal(Object.keys(state.entities).length, options.entities)
  assert.equal(run.population().chargedActors, 0)
  assert.equal(modelCalls, 0)
  assert.equal(Object.keys(state.operations).length, 0)
  if (options.workload === 'ingress') {
    const inputs = Object.values(state.ingresses ?? {})
    assert.equal(inputs.length, completed)
    assert.equal(new Set(inputs.map(value => value.eventId)).size, completed)
    assert.equal(Object.keys(state.scheduledEvents).length, completed)
    assert.equal(Object.keys(state.wakes).length, consumed)
  } else {
    assert.equal(state.revision, setupRevision + completed)
    for (const [index, id] of ids.entries()) {
      assert.equal(state.entities[id]?.revision, versions[index])
      const last = index < completed ? index + Math.floor((completed - 1 - index) / ids.length) * ids.length + 1 : 0
      assert.deepEqual(state.entities[id]?.profile, { sequence: last })
    }
  }
  progress('checkpoint-start')
  const checkpointStarted = performance.now()
  const request = simulationCheckpointRequestSchema.parse({ id: 'benchmark-cut', implementationVersion: 'benchmark-1', maxDrainRounds: 4, maxAttempts: 3 })
  const checkpoint = await connection.checkpoint(request)
  assert.equal(checkpoint.status, 'completed')
  const checkpointMs = performance.now() - checkpointStarted
  const before = createHash('sha256').update(JSON.stringify(run.snapshot())).digest('hex')
  const bytesBeforeClose = await benchmarkDiskBytes(root)
  await run.close()
  progress('restore-start')
  const restoreStarted = performance.now()
  const restored = await ctx.simulationTeams.restore({ ...selection, mode: 'open' }, {
    id: request.id, implementationVersion: request.implementationVersion, maxAttempts: 3,
  })
  run = restored.run
  const restoreMs = performance.now() - restoreStarted
  assert.equal(createHash('sha256').update(JSON.stringify(run.snapshot())).digest('hex'), before)
  assert.equal(modelCalls, 0)
  await run.close()
  memory()
  await writeBenchmarkRecovery(root, { ...selection, mode: 'open' }, {
    id: request.id, implementationVersion: 'benchmark-1', maxAttempts: 3,
  }, before)
  emit({ kind: 'result', recoveryMode: 'same-process-owner-services', completion: completed === options.operations
    && (options.workload !== 'ingress' || consumed === completed) ? 'target-complete' : 'time-budget',
  layer: 'zero-model-storage', writeBatchSize: options.workload === 'world' ? options.worldBatchSize : 1, setupMs, completed, consumed, requested: options.operations,
  throughputPerSecond: completed * 1000 / phases[writePhase]!.elapsedMs, phases, checkpointMs, restoreMs, peakRssBytes,
  diskBytes: await benchmarkDiskBytes(root), bytesBeforeClose, cpuMicros: process.cpuUsage(), journalEntries: run.snapshot().revision + 1,
  stops, residents: 0, modelCalls, teamMessages: 0, modelTokens: 0, modelCost: 0,
  replayEqual: true, acceptedResponsibilitiesPreserved: true, stalled: state.stall ?? null })
} finally { await run?.close(); await ctx.fiber.dispose() }
