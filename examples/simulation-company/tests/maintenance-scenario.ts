/** Loader process proving durable maintenance after forced host exit without model calls. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationChangeSchema, simulationEntityIdSchema, simulationMaintenanceRequestSchema,
  simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-world-maintenance', process.argv[2]!)
const recovering = process.env.MAINTENANCE_RECOVER === 'true'
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'maintenance', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 4, maxResidentActors: 2, maxTokensPerInterval: 1000000,
  tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxPendingEvents: 100, maxPendingInteractions: 100, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32,
  maxQueuedDecisions: 100, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 8,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '10000', relationRules: [],
} })
const id = simulationEntityIdSchema.parse('member')
const request = simulationMaintenanceRequestSchema.parse({ id: 'hire-preparation', owner: 'world-owner' })
const placement = { provider: 'in-process', seed: { kind: 'fresh' as const }, agent: { options: {} }, signal: new AbortController().signal }
let modelCalls = 0
ctx.on('llm/stream', (_options, next) => { modelCalls += 1; return next() })
const hold = async (stage: string) => {
  if (process.env.MAINTENANCE_CRASH !== stage) return
  process.send?.('durable')
  await new Promise<undefined>((resolve) => { process.once('message', () => { resolve(undefined) }) })
}
const run = await ctx.simulations.open(selection)
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Maintain canonical identities', budgets: {} }, budgets: {} }, 'simulation/maintenance')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/maintenance')
  if (!recovering) {
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent',
      readiness: 'preparing', profile: { name: 'Member' } }), run.snapshot().revision)
    await connection.ensureParticipant(id, { displayName: 'Member', role: 'member', capabilities: [], provider: 'in-process',
      preset: 'simulation', model: 'mock/default' })
    await run.change(simulationChangeSchema.parse({ kind: 'entity/readiness', id,
      entityRevision: run.snapshot().entities[id]!.revision, readiness: 'ready' }), run.snapshot().revision)
    await connection.activate(id, placement)
    await run.setPhase('running', run.snapshot().revision)
    await run.beginMaintenance(request)
    await hold('draining')
  }
  const identity = run.snapshot().entities[id]!.binding!
  const original = run.snapshot().maintenance![request.id]!
  const quiescent = await connection.quiesceForMaintenance(request, 4, 3)
  assert.equal(run.snapshot().phase, 'paused')
  assert.equal(run.population().chargedActors, 0)
  assert.equal(quiescent.startedSequence, original.startedSequence)
  assert.deepEqual(run.snapshot().entities[id]!.binding, identity)
  if (quiescent.status !== 'completed') {
    await assert.rejects(ctx.teamActivations.activate({ ...placement, ...identity,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor }), { code: 'SIM_MAINTENANCE_ACTIVE' })
    await hold('quiescent')
  }
  const completed = await run.finishMaintenance(request)
  await hold('completed')
  const revision = run.snapshot().revision
  assert.deepEqual(await run.beginMaintenance(request), completed)
  assert.equal(run.snapshot().revision, revision)
  assert.equal(run.snapshot().phase, 'paused')
  assert.equal(modelCalls, 0)
  console.log(JSON.stringify({ ownerPreserved: true, identityPreserved: true, maintenance: completed.status,
    phase: run.snapshot().phase, chargedActors: run.population().chargedActors, modelCalls }))
} finally { await run.close(); await ctx.fiber.dispose() }
