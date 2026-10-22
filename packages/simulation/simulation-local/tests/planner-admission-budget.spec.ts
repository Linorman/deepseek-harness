/** The dispatch guard and Native start both enforce the planner's complete subtree allocation. */
import { expect, it } from 'vitest'
import { activePlannerAncestors, simulationGenerationRecordSchema } from '@clocky/clocky-simulation'
import type { SimulationGenerationRecord } from '@clocky/clocky-simulation'
import { foldGeneration } from '../src/world-generation.ts'
import { createBusinessHarness } from './business-harness.ts'

it.each(['known', 'unknown'] as const)('refuses a root planner after its child reports %s over-budget usage', async (outcome) => {
  const h = await createBusinessHarness('json')
  try {
    const actor = await h.actor('root-helper')
    const binding = h.run.snapshot().entities[actor.id]!.binding!
    const parsedRoot = simulationGenerationRecordSchema.parse({
      job: { id: 'root', assistantEntityId: actor.id, purpose: 'domain-plan', scope: 'organization', audience: ['director'], inputs: [],
        outputSchema: 'domain-plan/1', model: { provider: 'test', name: 'test', version: '1' }, promptVersion: '1', policyVersion: '1',
        deadline: '99', budget: { maxTokens: 100, maxOutputBytes: 1024, maxAttempts: 1 },
        planner: { id: 'root-assignment', jobId: 'root', requestId: 'request', domain: 'organization', scope: 'organization',
          effects: ['hire-existing'], deadline: '99', maxAttempts: 1, maxDepth: 1, maxChildren: 1, maxTokens: 200 } },
      binding, acceptedSequence: 1, interval: '0', status: 'accepted',
    })
    const root: SimulationGenerationRecord = { job: parsedRoot.job, binding: parsedRoot.binding,
      acceptedSequence: parsedRoot.acceptedSequence, interval: parsedRoot.interval, status: 'accepted' }
    const parsedChild = simulationGenerationRecordSchema.parse({ ...root, acceptedSequence: 2, status: 'unknown',
      job: { ...root.job, id: 'child', planner: { ...root.job.planner!, id: 'child-assignment', jobId: 'child',
        parentId: 'root-assignment', maxDepth: 0, maxChildren: 0, maxTokens: 100 } },
      ...outcome === 'known' ? { usage: { inputTokens: 100, outputTokens: 1 } } : { observedUsage: { inputTokens: 100, outputTokens: 1 } },
    })
    const child: SimulationGenerationRecord = { job: parsedChild.job, binding: parsedChild.binding,
      acceptedSequence: parsedChild.acceptedSequence, interval: parsedChild.interval, status: 'unknown',
      ...outcome === 'known' ? { usage: parsedChild.usage! } : { observedUsage: parsedChild.observedUsage! } }
    const state = { ...h.run.snapshot(), generationJobs: { root, child } }
    expect(() => activePlannerAncestors(state, root.job.planner!)).toThrow(/budget/)
    expect(() => activePlannerAncestors(state, { ...root.job.planner!, maxTokens: 300 })).toThrow(/budget/)
    expect(() => foldGeneration(state, { kind: 'start', id: root.job.id, sessionSequence: 0 }, 3)).toThrow(/budget/)
    const exact = { ...state, generationJobs: { root, child: { ...child,
      ...outcome === 'known' ? { usage: { inputTokens: 99, outputTokens: 1 } } : { observedUsage: { inputTokens: 99, outputTokens: 1 } },
    } } }
    expect(() => activePlannerAncestors(exact, root.job.planner!)).not.toThrow()
    expect(foldGeneration(exact, { kind: 'start', id: root.job.id, sessionSequence: 0 }, 3).generationJobs?.root?.status).toBe('generating')
  } finally { await h.close() }
})
