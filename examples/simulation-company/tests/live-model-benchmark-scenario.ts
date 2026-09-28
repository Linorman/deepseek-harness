/** Explicitly budgeted single-actor sample through a real OpenAI-compatible provider and Simulation tools. @module */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { boot } from '@clocky/clocky-app-boot'
import * as PiAi from '@clocky/clocky-llm-pi-ai'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationDecisionIdSchema,
  simulationContextRequestSchema, simulationCheckpointRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { StreamChunk, TokenUsage } from '@clocky/clocky-llm'
import type {} from '@clocky/clocky-simulation-team'
import { parseSimulationBenchmarkOptions } from '../../../scripts/simulation-benchmark-options.ts'
import { benchmarkDiskBytes, benchmarkLatencySummary, writeBenchmarkRecovery } from '../../../scripts/simulation-benchmark-metrics.ts'

const options = parseSimulationBenchmarkOptions(process.argv.slice(3))
if (options.workload !== 'live-model') throw new Error('Live sample requires --workload live-model')
const root = process.env['SIMULATION_COMPANY_ROOT']
if (!root) throw new Error('SIMULATION_COMPANY_ROOT must name isolated sample data')
if (!process.env['SIMULATION_MODEL_API_KEY']) throw new Error('SIMULATION_MODEL_API_KEY is required; no requests sent')
const ctx = await boot('simulation-live-model-sample', process.argv[2]!)
let run: SimulationRun | undefined
let modelCalls = 0, inputTokens = 0, outputTokens = 0, unknownUsage = false
const latencies: number[] = []
const started = performance.now()
try {
  await ctx.plugin(PiAi, { providers: { 'simulation-live': { apiKeyEnv: 'SIMULATION_MODEL_API_KEY',
    api: 'openai-completions', baseURL: options.endpoint, retryPolicy: { mode: 'normal', maxRetries: 0 },
    compat: { thinkingFormat: options.thinkingFormat }, reasoning: options.reasoningEffort,
    models: [{ id: options.model, contextWindow: options.contextWindow, maxTokens: options.maxOutputTokens,
      reasoningEfforts: options.reasoningEffort === 'off' ? false : { [options.reasoningEffort]: options.reasoningEffort } }],
  } } })
  ctx.on('llm/stream', (request, next) => {
    if (request.provider !== 'simulation-live') return next()
    return (async function* (): AsyncIterable<StreamChunk> {
      if (unknownUsage || modelCalls >= options.maxModelCalls) throw new Error('Live model call budget exhausted or prior usage unknown')
      modelCalls += 1
      const began = performance.now()
      let usage: TokenUsage | undefined
      try {
        for await (const chunk of next()) {
          if (chunk.type === 'usage') usage = chunk.usage
          yield chunk
        }
      } finally {
        const billedInput = (usage?.inputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0)
        unknownUsage = usage === undefined || billedInput === 0 || usage.outputTokens === 0
        inputTokens += billedInput
        outputTokens += usage?.outputTokens ?? 0
        latencies.push(performance.now() - began)
        console.log(JSON.stringify({ kind: 'progress', phase: 'model', modelCalls, inputTokens, outputTokens, unknownUsage }))
      }
    }())
  })
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'live-model-sample', tickUnit: 'hour', origin: '0', maxTime: '1', rulesVersion: 'sample-1', policyVersion: 'sample-1',
    outboxMaxAttempts: 1, outboxRetryDelayMs: 0, maxDriveSteps: 1, maxMicrostepsPerTime: 2,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: options.durationMs, maxConflictRetries: 0,
    maxIngressBytes: 4096, maxEntities: 1, maxResidentActors: 1, maxDecisionsPerWindow: 1,
    maxOperationsPerDecision: 1, maxResourceQuantity: '1', maxQueuedDecisions: 1, maxDispatchWaitRounds: 1,
    budgetInterval: '100', maxDecisionsPerInterval: 1, maxMessagesPerInterval: 0,
    maxTokensPerInterval: options.tokenBudget, tokensPerModelRequest: options.tokensPerRequest,
    maxPendingEvents: 2, maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
  } })
  run = await ctx.simulations.open(selection)
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Observe and submit an empty simulation decision', budgets: {} },
    budgets: {} }, 'simulation/live-sample')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/live-sample')
  const entity = simulationEntityIdSchema.parse('observer')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entity, entityKind: 'observer', cognition: 'agent', profile: {} }),
    run.snapshot().revision)
  await connection.ensureParticipant(entity, { displayName: 'Observer', role: 'observer', capabilities: [],
    provider: 'in-process', preset: 'simulation', model: options.model })
  await connection.activate(entity, { provider: 'in-process', seed: { kind: 'fresh' }, signal: new AbortController().signal,
    agent: { preset: 'simulation', options: { provider: 'simulation-live', model: options.model, maxTokens: options.maxOutputTokens } } })
  await run.setPhase('running', run.snapshot().revision)
  const setupMs = performance.now() - started
  const context = simulationContextRequestSchema.parse({ maxBytes: 4096, teamCursor: 0, personaVersion: 'observer-1',
    modelVersion: options.model, sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: run.snapshot().revision }],
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
      blocks: [{ type: 'text', text: kind === 'input'
        ? 'Call simulation_observe, then simulation_stage with proposals: [], then simulation_submit. Do not propose world changes.'
        : kind === 'identity' ? 'You are the observer.' : 'Observe only; no resources, commitments or messages are authorized.' }] })),
  })
  const began = performance.now()
  const decision = await connection.executeDecision(entity, simulationDecisionIdSchema.parse('observe'), context)
  assert.equal(decision.status, 'accepted')
  assert.equal(decision.operationIds.length, 0)
  assert.equal(unknownUsage, false, 'Provider did not report token usage')
  assert.ok(modelCalls > 0)
  assert.ok(inputTokens + outputTokens <= options.tokenBudget, 'Provider usage exceeded the declared token budget')
  const workMs = performance.now() - began
  const calls = modelCalls
  assert.deepEqual(await connection.executeDecision(entity, decision.id, context), decision)
  assert.equal(modelCalls, calls)
  const budget = run.budgetUsage()
  const checkpoint = simulationCheckpointRequestSchema.parse({ id: 'live-cut', implementationVersion: 'live-sample-1',
    maxDrainRounds: 4, maxAttempts: 3 })
  const checkpointStarted = performance.now()
  assert.equal((await connection.checkpoint(checkpoint)).status, 'completed')
  const checkpointMs = performance.now() - checkpointStarted
  const fingerprint = createHash('sha256').update(JSON.stringify(run.snapshot())).digest('hex')
  await run.close()
  await writeBenchmarkRecovery(root, { ...selection, mode: 'open' },
    { id: checkpoint.id, implementationVersion: checkpoint.implementationVersion, maxAttempts: 3 }, fingerprint)
  console.log(JSON.stringify({ kind: 'latencies', phase: 'model', milliseconds: latencies }))
  console.log(JSON.stringify({ kind: 'result', layer: 'real-model-sample', completion: 'target-complete', completed: 1,
    requested: 1, model: options.model, endpoint: options.endpoint, reasoningEffort: options.reasoningEffort,
    thinkingFormat: options.thinkingFormat, modelCalls, syntheticUsage: false,
    inputTokens, outputTokens, reportedTokens: inputTokens + outputTokens, unknownUsage, budget,
    maxModelCalls: options.maxModelCalls, tokenBudget: options.tokenBudget, tokensPerRequest: options.tokensPerRequest,
    setupMs, workMs, checkpointMs, throughputPerSecond: 1000 / workMs, phases: { model: benchmarkLatencySummary(latencies, workMs) },
    peakResidents: 1, peakModels: 1, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    diskBytes: await benchmarkDiskBytes(root), cpuMicros: process.cpuUsage(), teamMessages: 0 }))
} finally { await run?.close(); await ctx.fiber.dispose() }
