import { simulationTemp } from './temp.ts'
import { simulationEventSlotSchema } from '@clocky/clocky-simulation'
import { simTimeSchema, simulationDecisionSlotSchema } from '@clocky/clocky-simulation'
import { rm } from 'node:fs/promises'
import { Context } from '@clocky/cordis'
import { expect, it, vi } from 'vitest'
import Simulations, { simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import Invariants from '@clocky/clocky-invariants'
import * as plugin from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

it('contains observers and drains run ownership when the provider is unloaded', async () => {
  const root = await simulationTemp('plugin')
  const ctx = new Context()
  try {
    await ctx.plugin(Simulations)
    await ctx.plugin(Invariants)
    await ctx.plugin(invariant)
    const observed = vi.fn()
    ctx.on('simulation/committed', () => { throw new Error('sync observer') })
    // oxlint-disable-next-line typescript/no-misused-promises -- Exercise a rejected observer that Cordis permits at runtime.
    ctx.on('simulation/committed', async () => { throw new Error('async observer') })
    ctx.on('simulation/committed', observed)
    const config = { name: 'local', root, backend: 'sqlite' as const, replayPageSize: 2 }
    const fiber = ctx.plugin(plugin, config)
    await fiber
    const selection = simulationRunSelectionSchema.parse({
      provider: 'local', mode: 'create',
      spec: { runId: 'test', tickUnit: 'minute', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000000000000000000000000', relationRules: [] },
    })
    const run = await ctx.simulations.open(selection)
    await run.setPhase('running', 0)
    expect(observed).toHaveBeenCalledTimes(2)
    expect(observed).toHaveBeenNthCalledWith(1, expect.objectContaining({ revision: 0, phase: 'paused' }), 0, undefined)
    expect(observed).toHaveBeenLastCalledWith(run.snapshot(), 1, 0)
    await fiber.dispose()
    expect(() => ctx.simulations.open(selection)).toThrow(/not registered/)
    await expect(run.setPhase('paused', 1)).rejects.toThrow(/closed/)
    const replacement = ctx.plugin(plugin, config)
    await replacement
    const reopened = await ctx.simulations.open({ ...selection, mode: 'open' })
    expect(reopened.snapshot().phase).toBe('running')
    await replacement.dispose()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('attributes a published revision mismatch to the journal provider', async () => {
  const ctx = new Context()
  await ctx.plugin(Invariants)
  await ctx.plugin(invariant)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'run', maxTime: '10', tickUnit: 'minute', origin: '0', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
  } })
  try {
    expect(() => { ctx.emit('simulation/committed', { spec: selection.spec, revision: 1, phase: 'paused', entities: {}, relations: {}, time: simTimeSchema.parse('0'), nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), decisions: {}, operations: {}, resources: {}, resourceReservations: {}, grants: {}, interactions: {}, commitments: {}, nextEventSlot: simulationEventSlotSchema.parse('0'), scheduledEvents: {}, wakes: {} }, 0) }).toThrow(/revision differs/)
  } finally {
    await ctx.fiber.dispose()
  }
})
