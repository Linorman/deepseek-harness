/** Real Loader consumer for durable run startup and crash recovery. */
import { boot } from '@clocky/clocky-app-boot'
import { simulationChangeSchema, simulationRunSpecSchema } from '@clocky/clocky-simulation'
import type {} from '../../src/index.ts'

const ctx = await boot('simulation-test', process.argv[2]!)
try {
  const mode = process.argv[3] === 'create' ? 'create' : 'open'
  const spec = simulationRunSpecSchema.parse({
    runId: 'supply', tickUnit: 'minute', origin: '0', maxTime: '100000000000000000000',
    rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000000000000000000000000', relationRules: [{ relation: 'member-of', subjectKinds: ['person'], objectKinds: ['org'], scopeKinds: ['org'], acyclic: true }],
  })
  if (process.argv[3] === 'inspect') {
    console.log(JSON.stringify(await ctx.simulations.inspect(ctx.simulations.resolveInspection({ provider: 'local', spec }))))
  } else {
    const run = await ctx.simulations.open(ctx.simulations.resolve({ provider: 'local', spec, mode }))
    if (mode === 'create') {
      await run.setPhase('running', 0)
      for (const command of [
        { kind: 'entity/create', readiness: 'ready', id: 'warehouse', entityKind: 'org', cognition: 'none', profile: { name: 'Warehouse' } },
        { kind: 'entity/create', readiness: 'ready', id: 'buyer', entityKind: 'person', cognition: 'agent', profile: { name: 'Purchasing' } },
        { kind: 'relation/create', id: 'employment', subject: 'buyer', object: 'warehouse', scope: 'warehouse', relation: 'member-of', validFrom: '0', validUntil: null },
      ]) await run.change(simulationChangeSchema.parse(command), run.snapshot().revision)
    }
    console.log(JSON.stringify(run.snapshot()))
    if (process.argv[4] === 'hold') {
      process.send?.('durable')
      await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
    }
    await run.close()
  }
} finally {
  await ctx.fiber.dispose()
}
