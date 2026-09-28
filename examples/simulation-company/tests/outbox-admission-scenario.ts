/** Durable outbox admission survives process death without bypassing windows or prerequisites. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { simTimeSchema, simulationChangeSchema, simulationDecisionIdSchema, simulationEntityIdSchema,
  simulationResourceSpecSchema, simulationProposalSchema, simulationRunSelectionSchema,
  simulationWindowRequestSchema, simulationContextRequestSchema } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-outbox-admission', process.argv[2]!)
const variant = process.env['SIMULATION_OUTBOX_ADMISSION']
assert.ok(variant === 'window' || variant === 'prerequisite')
const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'outbox-admission', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 2, maxResidentActors: 1, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8,
  maxDecisionsPerWindow: 2,
  maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [],
} })
if (process.env['SIMULATION_OUTBOX_RECOVER'] === 'true') {
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(ctx.simulations.open({ ...selection, mode: 'open' }),
        variant === 'window' ? /not admissible/ : /prerequisites/)
    }
    console.log(JSON.stringify({ variant, rejectedReopens: 2, dispatchedEffects: 0 }))
  } finally { await ctx.fiber.dispose() }
} else {
  const run = await ctx.simulations.open(selection)
  try {
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Respect outbox admission', budgets: {} }, budgets: {} },
      'simulation/outbox-admission')
    const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/outbox-admission')
    const sender = simulationEntityIdSchema.parse('sender'), recipient = simulationEntityIdSchema.parse('recipient')
    for (const id of [sender, recipient]) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', profile: {} }),
        run.snapshot().revision)
      await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [],
        provider: 'in-process', preset: 'simulation', model: 'unused' })
    }
    await connection.activate(sender, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
    for (const [id, quantity] of [['stock', '1'], ['received', '0']]) {
      await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: sender,
        controllers: [sender], kind: 'inventory', unit: 'item' }), run.snapshot().revision)
    }
    await run.setPhase('running', run.snapshot().revision)
    const message = { kind: 'communication/post', recipient, channelId: 'channel', text: 'Message', deliverAt: '5' }
    const proposals = variant === 'window' ? [{ after: [], action: message }] : [
      { after: [], action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
        reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: 'received', revision: 1 }],
        transfers: [{ from: 'stock', to: 'received', quantity: '2' }],
      } } },
      { after: [], action: { ...message, deliverAt: '10' } }, { after: [0, 1], action: message },
    ]
    const id = simulationDecisionIdSchema.parse('message')
    await connection.openDecision(sender, id)
    const accepted = await connection.submitDecision(sender, id, proposals.map(value => simulationProposalSchema.parse(value)))
    await run.drive({ until: simTimeSchema.parse('5') })
    if (variant === 'window') {
      const context = simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
        personaVersion: '1', modelVersion: '1', sources: [], sections: ['identity', 'authority', 'input', 'goals', 'commitments']
          .map(kind => ({ kind, required: true, blocks: [{ type: 'text', text: kind }] })) })
      await run.openWindow(simulationWindowRequestSchema.parse({ id: 'frozen', decisions: [{ id: 'next', entityId: sender, context }] }),
        run.snapshot().revision)
    }
    const state = run.snapshot()
    const change = variant === 'window'
      ? { kind: 'outbox/started', id: accepted.operationIds[0], number: 1, at: 100 }
      : { kind: 'outbox/blocked', id: accepted.operationIds[2], code: 'SIM_DEPENDENCY_FAILED' }
    // Fault injection bypasses the live dispatch gate but retains the durable record schema.
    const stream = (run as unknown as { stream: LogStream }).stream
    await stream.append(state.revision, [{ kind: 'run/outbox', runId: state.spec.runId, expectedRevision: state.revision, change }])
    process.send?.('durable')
    await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
  } finally { await run.close(); await ctx.fiber.dispose() }
}
