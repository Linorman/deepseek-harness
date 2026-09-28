import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import Simulations, { simulationRunSpecSchema } from '../src/index.ts'
import Invariants from '@clocky/clocky-invariants'
import * as invariant from '../src/invariant.ts'

it('rejects unknown/duplicate providers and revokes contributed registration on unload', async () => {
  const ctx = new Context()
  await ctx.plugin(Simulations)
  await ctx.plugin(Invariants)
  await ctx.plugin(invariant)
  const spec = simulationRunSpecSchema.parse({
    runId: 'run', maxTime: '100', tickUnit: 'minute', origin: '0', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
  })
  const request = { provider: 'test', spec, mode: 'create' as const }
  expect(() => ctx.simulations.resolve(request)).toThrow(/not registered/)
  const open = vi.fn().mockResolvedValue('run')
  const provider = { name: 'test', open }
  const fiber = ctx.inject(['simulations'], (child) => { child.simulations.registerProvider(provider) })
  await fiber
  expect(() => ctx.simulations.registerProvider(provider)).toThrow(/already registered/)
  await expect(ctx.simulations.open(ctx.simulations.resolve(request))).resolves.toBe('run')
  expect(open).toHaveBeenCalledWith(request)
  await fiber.dispose()
  expect(() => ctx.simulations.open(request)).toThrow(/not registered/)
  await ctx.fiber.dispose()
})
