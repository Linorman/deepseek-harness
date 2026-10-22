/** Checkpoint an interrupted, not-yet-admitted Team startup without inventing a Session. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema, simulationCheckpointRequestSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-checkpoint-startup', process.argv[2]!)
const recovering = process.env['STARTUP_RECOVER'] === 'true'
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: {
  runId: 'checkpoint-restore', tickUnit: 'hour', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 64,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 3, maxDecisionsPerWindow: 3, maxOperationsPerDecision: 16,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '10000', maxQueuedDecisions: 32, maxDispatchWaitRounds: 8,
  budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 16, relationRules: [],
} })
const run = await ctx.simulations.open({ ...selection, mode: recovering ? 'open' : 'create' })
const hold = async (stage: string) => {
  if (process.env['STARTUP_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Checkpoint startup ownership', budgets: {} }, budgets: {} }, 'simulation/startup')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/startup')
  const id = simulationEntityIdSchema.parse('actor')
  if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  const binding = await connection.ensureParticipant(id, { displayName: 'Actor', role: 'actor', capabilities: [],
    provider: 'in-process', preset: 'simulation', model: 'unused/model' })
  const activate = () => connection.activate(id, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
  if (!recovering) {
    const reserve = run.reserveWriter.bind(run)
    run.reserveWriter = async (...args) => { await hold('reserved'); return await reserve(...args) }
    await activate()
  }
  assert.equal(run.snapshot().entities[id]?.writer, undefined)
  const recover = ctx.teamActivations.recoverCoordinatedReservation.bind(ctx.teamActivations)
  ctx.teamActivations.recoverCoordinatedReservation = async (...args) => { await recover(...args); await hold('released') }
  const command = simulationCheckpointRequestSchema.parse({ id: 'startup-cut', implementationVersion: 'startup-1', maxDrainRounds: 4, maxAttempts: 3 })
  const result = await connection.checkpoint(command)
  assert.equal(result.status, 'completed')
  if (result.status !== 'completed') throw new Error('Checkpoint did not complete')
  const state = await ctx.teams.getTeam({ teamId: team.team.id })
  assert.ok(state.participants.find(value => value.id === binding.participantId)?.activationReservation?.releasedAt !== undefined)
  assert.deepEqual(result.manifest.sessions, [{ kind: 'unmaterialized', ...binding }])
  assert.equal(await ctx.sessionPersistence.isUnmaterialized(binding.sessionId), true)
  const actor = await activate()
  assert.equal(actor.binding.sessionId, binding.sessionId)
  await connection.hibernate(id)
  console.log(JSON.stringify({ startupReleased: true, unmaterializedAtCut: true, canonicalSessionPreserved: true,
    chargedActors: run.population().chargedActors }))
} finally { await run.close(); await ctx.fiber.dispose() }
