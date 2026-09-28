/** Real Loader replay rejects local settlements that skip retained operation order. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simulationChangeSchema, simulationDecisionIdSchema, simulationEntityIdSchema,
  simulationResourceSpecSchema, simulationProposalSchema, simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-settlement-order', process.argv[2]!)
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'settlement-order', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 2, maxResidentActors: 1, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2,
  maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [],
} })
const run = await ctx.simulations.open(selection)
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Settle in order', budgets: {} }, budgets: {} },
    'simulation/settlement-order')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/settlement-order')
  const entity = simulationEntityIdSchema.parse('actor')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entity, entityKind: 'person', cognition: 'agent', profile: {} }),
    run.snapshot().revision)
  await connection.ensureParticipant(entity, { displayName: 'Actor', role: 'actor', capabilities: [],
    provider: 'in-process', preset: 'simulation', model: 'unused' })
  await connection.activate(entity, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
  for (const [id, quantity] of [['stock', '10'], ['received', '0']]) {
    await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: entity,
      controllers: [entity], kind: 'inventory', unit: 'item' }), run.snapshot().revision)
  }
  await run.setPhase('running', run.snapshot().revision)
  const proposal = simulationProposalSchema.parse({ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
    commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
    transfers: [{ from: 'stock', to: 'received', quantity: '1' }],
  } } })
  const firstId = simulationDecisionIdSchema.parse('first')
  await connection.openDecision(entity, firstId)
  const first = await connection.submitDecision(entity, firstId, [proposal, proposal])
  const secondId = simulationDecisionIdSchema.parse('second')
  await connection.openDecision(entity, secondId)
  const second = await connection.submitDecision(entity, secondId, [proposal])
  await connection.hibernate(entity)
  const state = run.snapshot()
  const target = process.env['SIMULATION_SETTLEMENT_ORDER'] === 'across-decisions' ? second.operationIds[0]! : first.operationIds[1]!
  // Inject a schema-valid durable record that the normal execution API refuses.
  const stream = (run as unknown as { stream: LogStream }).stream
  await stream.append(state.revision, [{ kind: 'run/business', runId: state.spec.runId, expectedRevision: state.revision,
    change: { kind: 'operation/settled', id: target, status: 'applied', code: 'SIM_APPLIED' } }])
  await run.close()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(ctx.simulations.open({ ...selection, mode: 'open' }), /earlier simulation operation/)
  }
  console.log(JSON.stringify({ invalidOrder: process.env['SIMULATION_SETTLEMENT_ORDER'], rejectedReopens: 2,
    acceptedIntents: Object.keys(state.operations).length,
    balancesBeforeCorruption: Object.values(state.resources).map(value => value.quantity) }))
} finally { await run.close(); await ctx.fiber.dispose() }
