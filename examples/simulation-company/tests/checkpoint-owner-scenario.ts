/** A checkpoint fixes execution-Team identity before the first cognition binding. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationRun } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { createTestRootTeam } from '../../../packages/core/team/tests/bootstrap-topology-authority.ts'

const ctx = await boot('simulation-checkpoint-owner', process.argv[2]!)
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
let run: SimulationRun | undefined
try {
  run = await ctx.simulations.open({ ...selection, mode: 'create' })
  const creation = { goal: { objective: 'Preserve execution identity', budgets: {} }, budgets: {} }
  const first = await createTestRootTeam(ctx, { ...creation,
    rules: { simulationRunId: selection.spec.runId, activationLifecycleOwner: 'simulation/first' } })
  const connection = await ctx.simulationTeams.attach(run, first.team.id, 'simulation/first')
  const command = simulationCheckpointRequestSchema.parse({ id: 'first-cut', implementationVersion: 'owner-1', maxDrainRounds: 4, maxAttempts: 3 })
  assert.equal((await connection.checkpoint(command)).status, 'completed')
  await connection.close()
  const foreign = await createTestRootTeam(ctx, { ...creation,
    rules: { simulationRunId: selection.spec.runId, activationLifecycleOwner: 'simulation/foreign' } })
  const before = run.snapshot()
  await assert.rejects(ctx.simulationTeams.attach(run, foreign.team.id, 'simulation/foreign'), /canonical Team/)
  await assert.rejects(run.reserveTeam({ ...creation,
    rules: { simulationRunId: selection.spec.runId, activationLifecycleOwner: 'simulation/foreign' } }, before.revision), /canonical Team/)
  assert.deepEqual(run.snapshot(), before)
  await run.close()
  const restored = await ctx.simulationTeams.restore(selection, { id: command.id, implementationVersion: 'owner-1', maxAttempts: 3 })
  run = restored.run
  assert.equal(restored.manifest.team.owner.teamId, first.team.id)
  const next = await restored.connection.checkpoint(simulationCheckpointRequestSchema.parse({ ...command, id: 'second-cut' }))
  assert.equal(next.status, 'completed')
  if (next.status !== 'completed') throw new Error('Checkpoint failed')
  assert.equal(next.manifest.team.owner.teamId, first.team.id)
  console.log(JSON.stringify({ canonicalTeamPreserved: true, rejectedWritesUnchanged: true,
    completedCheckpoints: Object.values(run.snapshot().checkpoints ?? {}).filter(value => value.status === 'completed').length }))
} finally { await run?.close(); await ctx.fiber.dispose() }
