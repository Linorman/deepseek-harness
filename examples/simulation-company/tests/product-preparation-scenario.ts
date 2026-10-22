/** Production company preparation reconciles interrupted topology before any decision or model request. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationCheckpointRestoreRequestSchema } from '@clocky/clocky-simulation'
import { prepareSimulationCompany, simulationCompanyPreparationSchema } from '@clocky/clocky-simulation-product'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('company-product-preparation', process.argv[2]!)
const settings = simulationCompanyPreparationSchema.parse({ version: '1', ownerName: 'simulation/company-product',
  objective: 'Deliver one inventory unit', buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2',
  participant: { provider: 'in-process', preset: 'simulation', model: 'company/scripted' },
  checkpoint: { id: 'initial', maxDrainRounds: 4, maxAttempts: 3 } })
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: {
  runId: 'company-preparation', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
  maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
  maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
  maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [],
} })
const run = await ctx.simulations.open({ ...selection, mode: process.env.COMPANY_PREP_RECOVER === 'true' ? 'open' : 'create' })
const hold = async (stage: string): Promise<void> => {
  if (process.env.COMPANY_PREP_CRASH !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  let modelCalls = 0
  ctx.on('llm/stream', () => { modelCalls++; throw new Error('Preparation must not infer') })
  const team = ctx.teams.createTeam.bind(ctx.teams)
  ctx.teams.createTeam = async (request) => { const result = await team(request); await hold('team'); return result }
  const participant = ctx.teams.inviteParticipant.bind(ctx.teams)
  ctx.teams.inviteParticipant = async (request) => { const result = await participant(request); await hold('participant'); return result }
  const channel = ctx.teams.openChannel.bind(ctx.teams)
  ctx.teams.openChannel = async (request) => { const result = await channel(request); await hold('channel'); return result }
  const change = run.change.bind(run)
  run.change = async (...args) => { const result = await change(...args); await hold('entity'); return result }
  const resource = run.createResource.bind(run)
  run.createResource = async (...args) => { const result = await resource(...args); await hold('resource'); return result }
  const acquire = run.acquireCheckpointCut.bind(run)
  run.acquireCheckpointCut = async (...args) => {
    const cut = await acquire(...args)
    const publish = cut.publish.bind(cut)
    cut.publish = async (manifest) => { const result = await publish(manifest); await hold('checkpoint'); return result }
    return cut
  }
  const prior = run.snapshot()
  const result = await prepareSimulationCompany(ctx.simulationTeams, run, settings)
  assert.equal(result.checkpoint.status, 'completed')
  if (prior.teamReservation !== undefined) assert.equal(result.teamId, prior.teamReservation.teamId)
  for (const entity of Object.values(prior.entities)) {
    if (entity.participantReservation !== undefined) {
      assert.deepEqual(run.snapshot().entities[entity.id]?.binding, entity.participantReservation.binding)
    }
  }
  for (const retained of Object.values(prior.channelReservations ?? {})) assert.equal(result.channelId, retained.channelId)
  assert.equal((await ctx.teams.getTeam({ teamId: result.teamId })).participants.length, 2)
  const before = run.snapshot()
  assert.deepEqual(await prepareSimulationCompany(ctx.simulationTeams, run, settings), result)
  assert.deepEqual(run.snapshot(), before)
  assert.equal(modelCalls, 0)
  assert.deepEqual(await ctx.sessionPersistence.list(), [])
  assert.equal(run.population().chargedActors, 0)
  await run.close()
  const restored = await ctx.simulationTeams.restore(selection, simulationCheckpointRestoreRequestSchema.parse({
    id: settings.checkpoint.id, implementationVersion: 'company/1', maxAttempts: 3,
  }))
  try {
    assert.equal(restored.run.snapshot().phase, 'paused')
    assert.equal(restored.manifest.team.owner.teamId, result.teamId)
    console.log(JSON.stringify({ phase: restored.run.snapshot().phase, entities: Object.keys(restored.run.snapshot().entities),
      resourceQuantities: Object.values(restored.run.snapshot().resources).map(value => value.quantity),
      teamParticipants: 2, channels: result.checkpoint.manifest.channels.length,
      unmaterializedSessions: result.checkpoint.manifest.sessions.filter(value => value.kind === 'unmaterialized').length,
      modelCalls, preservedReservations: true, retriedWithoutWrites: true, restoredInitialCheckpoint: true }))
  } finally { await restored.run.close() }
} finally { await run.close(); await ctx.fiber.dispose() }
