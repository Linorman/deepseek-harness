/** Cost reporting follows Native's reservation rules, including observed overrun and proven non-dispatch. */
import { Context } from '@clocky/cordis'
import { expect, it } from 'vitest'
import { budgetUsage, simulationGenerationJobSchema, simulationEntityBindingSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'
import { LongitudinalMetrics } from './longitudinal-metrics.ts'

it('counts unknown observed generation above its reservation and releases proven undispatched cancellation', async () => {
  const h = await createBusinessHarness('json'), ctx = new Context()
  try {
    const job = simulationGenerationJobSchema.parse({ id: 'observed', purpose: 'dialogue', assistantEntityId: 'helper',
      scope: 'public', audience: ['public'], inputs: [], outputSchema: 'text/1',
      model: { provider: 'scripted', name: 'keyless', version: '1' }, promptVersion: '1', policyVersion: '1',
      budget: { maxTokens: 10, maxOutputBytes: 1000, maxAttempts: 1 }, deadline: '100' })
    const binding = simulationEntityBindingSchema.parse({ teamId: 'team', participantId: 'helper', sessionId: 'helper' })
    const state: SimulationSnapshot = { ...h.run.snapshot(), generationJobs: {
      observed: { job, binding, acceptedSequence: 1, interval: h.run.snapshot().time, status: 'unknown', sessionSequence: 1,
        observedUsage: { inputTokens: 12, outputTokens: 3 } },
      cancelled: { job: simulationGenerationJobSchema.parse({ ...job, id: 'cancelled' }), binding, acceptedSequence: 1,
        interval: h.run.snapshot().time, status: 'cancelled' },
    } }
    const metrics = new LongitudinalMetrics(ctx).sample(state)
    expect(metrics.modelAccounting.generation).toEqual({ calls: 1, knownTokens: 0, unknownCalls: 1, retainedTokens: 15 })
    expect(metrics.modelAccounting.generation.retainedTokens).toBe(budgetUsage(state).tokens.used)
    expect(metrics.monetaryCost.status).toBe('unknown')
    expect(metrics.processPeakRssBytes).toBeGreaterThan(0)
  } finally { await ctx.fiber.dispose(); await h.close() }
})
