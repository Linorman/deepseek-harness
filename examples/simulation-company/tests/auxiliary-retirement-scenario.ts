/** Auxiliary inference must quiesce before its canonical Session and residency are released. @module */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { CompactionId, recordCompactionRequest } from '@clocky/clocky-compaction'
import { LlmAdapter, createUserMessage } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type { SimulationCheckpointCollection } from '@clocky/clocky-simulation-team'

const mode = process.env['SIMULATION_AUX_RETIREMENT']
assert.ok(mode === 'hibernate' || mode === 'close' || mode === 'checkpoint' || mode === 'lease' || mode === 'service-bootstrap')
const ctx = await boot('simulation-auxiliary-retirement', process.argv[2]!)
const service = ctx.simulationTeams
const cancellation = new AbortController()
const bootstrapRelease = Promise.withResolvers<undefined>()
const entered = Promise.withResolvers<undefined>()
const aborted = Promise.withResolvers<undefined>()
const cleanup = Promise.withResolvers<undefined>()
let run: SimulationRun | undefined
let extra: SimulationRun | undefined
let bootstrapRejected: Promise<void> | undefined
let candidate: SimulationCheckpointCollection | undefined
let work: Promise<void> | undefined
try {
  ctx.llm.registerAdapter(['auxiliary-retirement'], new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
      const signal = options.signal
      assert.ok(signal)
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { aborted.resolve(undefined); resolve() }, { once: true })
        entered.resolve(undefined)
      })
      await cleanup.promise
      signal.throwIfAborted()
    }
  }())
  run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'auxiliary-retirement', tickUnit: 'hour', origin: '0', maxTime: '1', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 1, outboxRetryDelayMs: 0, maxDriveSteps: 1, maxMicrostepsPerTime: 2,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 5000, maxConflictRetries: 0,
    maxIngressBytes: 4096, maxEntities: 1, maxResidentActors: 1, maxDecisionsPerWindow: 1,
    maxOperationsPerDecision: 1, maxResourceReservationHistory: 128, maxResourceQuantity: '1', maxQueuedDecisions: 1, maxDispatchWaitRounds: 1,
    budgetInterval: '100', maxDecisionsPerInterval: 1, maxMessagesPerInterval: 0, maxTokensPerInterval: 100, tokensPerModelRequest: 10,
    maxPendingEvents: 2, maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
  } }))
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Retire owned auxiliary inference', budgets: {} }, budgets: {} },
    'simulation/auxiliary-retirement')
  let bindingLease: import('@clocky/clocky-team-activation-controller').TeamActivationCoordinationLease | undefined
  const register = ctx.teamActivations.registerLifecycleOwner.bind(ctx.teamActivations)
  ctx.teamActivations.registerLifecycleOwner = owner => register({ ...owner, reserve: async (...args) => {
    bindingLease = await owner.reserve(...args)
    return bindingLease
  } })
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/auxiliary-retirement')
  ctx.teamActivations.registerLifecycleOwner = register
  const entity = simulationEntityIdSchema.parse('observer')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: entity, entityKind: 'person', cognition: 'agent', profile: {} }),
    run.snapshot().revision)
  await connection.ensureParticipant(entity, { displayName: 'Observer', role: 'observer', capabilities: [],
    provider: 'in-process', preset: 'simulation', model: 'unused' })
  const activation = await connection.activate(entity, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
  const actor = activation.localAgent
  assert.ok(actor)
  const established = bindingLease
  assert.ok(established)
  await assert.rejects(async () => { await established.bind(activation.binding, undefined) }, /exact controller-owned local Agent/)
  const compactionId = CompactionId('retirement')
  actor.session.append('compaction/start', { compactionId, turn: null })
  const options = recordCompactionRequest(actor.session, { sessionId: actor.session.id, purpose: 'compaction',
    signal: cancellation.signal, provider: 'auxiliary-retirement', model: 'scripted',
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Source to compact' }] })] })
  const consume = async () => {
    for await (const _chunk of ctx.llm.stream(options)) { /* Drain the owned auxiliary request. */ }
  }
  work = consume()
  await entered.promise
  let closeService: (() => Promise<void>) | undefined
  if (mode === 'service-bootstrap') {
    const { default: SimulationTeams } = await import('@clocky/clocky-simulation-team')
    const runtime = ctx.registry.get(SimulationTeams)
    assert.ok(runtime)
    const [fiber] = runtime.fibers
    assert.ok(fiber)
    closeService = () => fiber.dispose()
    extra = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
      spec: { ...run.snapshot().spec, runId: 'pending-bootstrap' } }))
    const reserve = extra.reserveTeam.bind(extra)
    const reserved = Promise.withResolvers<undefined>()
    extra.reserveTeam = async (...args) => {
      const result = await reserve(...args)
      reserved.resolve(undefined)
      await bootstrapRelease.promise
      return result
    }
    bootstrapRejected = assert.rejects(service.ensureTeam(extra, { goal: { objective: 'Pending bootstrap', budgets: {} }, budgets: {} },
      'simulation/pending-bootstrap'), /retired before Team creation/)
    await reserved.promise
  }
  let stopped = false
  const stopping = (closeService !== undefined ? closeService() : mode === 'checkpoint' ? connection.collectCheckpointCandidate(4, 2).then((value) => { candidate = value })
    : mode === 'hibernate' ? connection.hibernate(entity) : mode === 'lease' ? activation.dispose() : connection.close())
    .then(() => { stopped = true })
  try {
    await aborted.promise
    assert.equal(cancellation.signal.aborted, false)
    assert.equal(stopped, false)
    assert.equal(service.modelUsage().active, 1)
    assert.equal(run.population().chargedActors, 1)
    assert.equal(ctx.agents.get(actor.id), actor)
    await assert.rejects(consume(), /current canonical actor|connection is closed|service is closed|checkpoint collection blocks/)
  } finally {
    cleanup.resolve(undefined)
    try { if (extra !== undefined) { await work; assert.equal(stopped, false) } }
    finally { bootstrapRelease.resolve(undefined); await bootstrapRejected; await stopping }
  }
  await work
  if (candidate !== undefined) await candidate.validate()
  assert.equal(run.population().chargedActors, 0)
  assert.equal(service.modelUsage().active, 0)
  assert.equal(ctx.agents.get(actor.id), undefined)
  const reservation = Object.values(run.snapshot().tokenReservations ?? {})[0]
  assert.equal(reservation?.status, 'unknown')
  assert.deepEqual(reservation.observedUsage, { inputTokens: 3, outputTokens: 2 })
  console.log(JSON.stringify({ mode, cancelledByOwner: true, sessionRetainedThroughCleanup: true, rejectedBindRetainedAuthority: true,
    chargedActors: run.population().chargedActors, modelPermits: service.modelUsage().active,
    tokenStatus: reservation.status, observedUsage: reservation.observedUsage }))
} finally {
  cancellation.abort(new Error('Scenario cleanup'))
  cleanup.resolve(undefined)
  await Promise.allSettled(work === undefined ? [] : [work])
  candidate?.release()
  bootstrapRelease.resolve(undefined)
  await extra?.close()
  await run?.close()
  await ctx.fiber.dispose()
}
