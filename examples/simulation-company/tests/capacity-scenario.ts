/** Real controller admission and crash recovery of capacity-blocked business effects. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simulationChangeSchema, simulationEntityIdSchema,
  simulationDecisionIdSchema, simulationProposalSchema, simulationCapacityGrantRequestSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-capacity', process.argv[2]!)
const recovering = process.env['SIMULATION_CAPACITY_RECOVER'] === 'true'
const capacity = process.env['SIMULATION_CAPACITY_KIND'] === 'events' ? 'events' : 'interactions'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'capacity', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 16, maxResidentActors: 2, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16,
  maxResourceReservationHistory: 128,
  maxResourceQuantity: '10000', relationRules: [], maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 16, maxDispatchWaitRounds: 8,
  budgetInterval: '100', maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100,
  maxTokensPerInterval: 10000, tokensPerModelRequest: 1000,
  maxPendingEvents: capacity === 'events' ? 0 : 16, maxPendingInteractions: capacity === 'interactions' ? 0 : 16,
} }))
const hold = async (stage: string) => {
  if (process.env['SIMULATION_CAPACITY_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Retain blocked responsibility', budgets: {} }, budgets: {} }, 'simulation/capacity')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/capacity')
  const a = simulationEntityIdSchema.parse('a'); const b = simulationEntityIdSchema.parse('b')
  for (const entityId of [a, b]) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: entityId,
      entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    await connection.ensureParticipant(entityId, { displayName: entityId, role: entityId, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'unused' })
  }
  if (recovering) await connection.recover(a)
  const actor = await connection.activate(a, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
  assert.ok(actor.localAgent)
  const decision = simulationDecisionIdSchema.parse('request')
  if (!recovering) {
    await run.setPhase('running', run.snapshot().revision)
    await connection.openDecision(a, decision)
    await connection.submitDecision(a, decision, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'interaction/request', id: 'work', assignee: b, description: 'Review', replyBy: '5', completeBy: '10',
      fulfillment: { kind: 'explicit' },
    } })])
    await ctx.sessions.flush(actor.localAgent.session)
    await assert.rejects(run.executeOperation(run.snapshot().decisions[decision]!.operationIds[0]!), /capacity exhausted/)
    await hold('exhausted')
  }
  const operation = run.snapshot().decisions[decision]!.operationIds[0]!
  assert.equal(run.snapshot().stall?.code, 'SIM_QUEUE_CAPACITY')
  assert.equal(run.snapshot().operations[operation]?.result, undefined)
  assert.deepEqual(run.snapshot().interactions, {})
  assert.deepEqual(run.snapshot().scheduledEvents, {})
  const addition = simulationCapacityGrantRequestSchema.parse({ id: 'allow-work', capacity, amount: 1,
    reason: 'Allow the retained operation to finish' })
  if (run.snapshot().capacityGrants?.[addition.id] === undefined) {
    await assert.rejects(run.setPhase('running', run.snapshot().revision), /freed or extended/)
  }
  await run.extendCapacity(addition, run.snapshot().revision)
  await run.extendCapacity(addition, 0)
  await hold('extended')
  await run.setPhase('running', run.snapshot().revision)
  const applied = await run.executeOperation(operation)
  assert.equal(applied.status, 'applied')
  assert.deepEqual(await run.executeOperation(operation), applied)
  const afterApply = run.queueUsage()
  const cancel = simulationDecisionIdSchema.parse('cancel')
  await connection.openDecision(a, cancel)
  const accepted = await connection.submitDecision(a, cancel, [simulationProposalSchema.parse({ after: [], action: {
    kind: 'interaction/cancel', id: 'work', expectedRevision: 1, reason: 'Work withdrawn',
  } })])
  await run.executeOperation(accepted.operationIds[0]!)
  console.log(JSON.stringify({ capacity, afterApply, afterCancel: run.queueUsage(),
    grants: Object.keys(run.snapshot().capacityGrants ?? {}).length,
    retainedInteractions: Object.keys(run.snapshot().interactions).length,
    retainedEvents: Object.keys(run.snapshot().scheduledEvents).length,
    tokenUsage: run.budgetUsage().tokens.used }))
} finally { await run.close(); await ctx.fiber.dispose() }
