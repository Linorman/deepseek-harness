import { simulationGenerationJobIdSchema } from '@clocky/clocky-simulation'
/** Real Native journals retain helper responsibility and shared costs on both storage backends. */
import { describe, expect, it } from 'vitest'
import { budgetUsage, simulationGenerationJobSchema, simulationPlannerAssignmentSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

const authorize = () => {}
function job(id: string, assistantEntityId: string) {
  return simulationGenerationJobSchema.parse({ id, assistantEntityId, purpose: 'dialogue', scope: 'public', audience: ['public'],
    inputs: [{ source: 'public-brief/1', content: 'PUBLIC_CANARY_ONLY', audience: ['public'] }], outputSchema: 'text/1',
    model: { provider: 'test', name: 'test', version: '1' }, promptVersion: '1', policyVersion: '1',
    budget: { maxTokens: 100, maxOutputBytes: 1024, maxAttempts: 1 }, deadline: '99' })
}
for (const backend of ['json', 'sqlite'] as const) describe(`generation ${backend}`, () => {
  it('persists actual disclosure, original output, cancellation responsibility and exact retry', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('helper'), request = job('one', actor.id)
      const accepted = await h.run.transitionGeneration({ kind: 'accept', job: request }, authorize)
      const revision = h.run.snapshot().revision
      expect(await h.run.transitionGeneration({ kind: 'accept', job: request }, authorize)).toEqual(accepted)
      expect(h.run.snapshot().revision).toBe(revision)
      expect(budgetUsage(h.run.snapshot()).tokens.used).toBe(100)
      await h.run.transitionGeneration({ kind: 'start', id: request.id, sessionSequence: 2 }, authorize)
      await h.run.transitionGeneration({ kind: 'cancel', id: request.id, reason: 'revoked' }, authorize)
      expect(h.run.snapshot().generationJobs?.one?.status).toBe('unknown')
      await expect(h.run.transitionGeneration({ kind: 'start', id: request.id, sessionSequence: 2 }, authorize)).rejects.toThrow()
      await h.run.transitionGeneration({ kind: 'output', id: request.id, content: 'public reply', usage: { inputTokens: 8, outputTokens: 2 } }, authorize)
      expect((await h.run.transitionGeneration({ kind: 'validate', id: request.id }, authorize)).status).toBe('rejected')
      expect(h.run.snapshot().generationJobs?.one?.content).toBe('public reply')
      expect(budgetUsage(h.run.snapshot()).tokens.used).toBe(10)
      await expect(h.run.transitionGeneration({ kind: 'output', id: request.id, content: 'replacement' }, authorize)).rejects.toThrow()
      await expect(h.run.transitionGeneration({ kind: 'accept', job: { ...request, id: simulationGenerationJobIdSchema.parse('scope-change'), scope: 'private' } }, authorize)).rejects.toThrow(/scope/)
      const malformed = simulationGenerationJobSchema.parse({ ...request, id: 'malformed-persona', purpose: 'persona', outputSchema: 'persona/1' })
      await h.run.transitionGeneration({ kind: 'accept', job: malformed }, authorize)
      await h.run.transitionGeneration({ kind: 'start', id: malformed.id, sessionSequence: 3 }, authorize)
      await h.run.transitionGeneration({ kind: 'output', id: malformed.id, content: 'not valid JSON', usage: { inputTokens: 1, outputTokens: 1 } }, authorize)
      expect((await h.run.transitionGeneration({ kind: 'validate', id: malformed.id }, authorize)).status).toBe('rejected')
      expect(h.run.snapshot().generationJobs?.[malformed.id]?.content).toBe('not valid JSON')
      const retainedRevision = h.run.snapshot().revision
      await h.run.transitionGeneration({ kind: 'validate', id: malformed.id }, authorize)
      expect(h.run.snapshot().revision).toBe(retainedRevision)
      const unknown = { ...request, id: simulationGenerationJobIdSchema.parse('unknown-usage') }
      await h.run.transitionGeneration({ kind: 'accept', job: unknown }, authorize)
      await h.run.transitionGeneration({ kind: 'start', id: unknown.id, sessionSequence: 4 }, authorize)
      await h.run.transitionGeneration({ kind: 'unknown', id: unknown.id, reason: 'lost-finish', observedUsage: { inputTokens: 150, outputTokens: 20 } }, authorize)
      await h.run.transitionGeneration({ kind: 'unknown', id: unknown.id, reason: 'lost-finish', observedUsage: { inputTokens: 1, outputTokens: 1 } }, authorize)
      expect(h.run.snapshot().generationJobs?.[unknown.id]?.observedUsage).toEqual({ inputTokens: 150, outputTokens: 20 })
      expect(budgetUsage(h.run.snapshot()).tokens.used).toBe(182)
      await h.run.transitionGeneration({ kind: 'output', id: unknown.id, content: 'Original final output', usage: { inputTokens: 151, outputTokens: 20 } }, authorize)
      await h.run.transitionGeneration({ kind: 'validate', id: unknown.id }, authorize)
      const undispatched = { ...request, id: simulationGenerationJobIdSchema.parse('cancel-before-start') }
      await h.run.transitionGeneration({ kind: 'accept', job: undispatched }, authorize)
      await h.run.transitionGeneration({ kind: 'cancel', id: undispatched.id, reason: 'withdrawn' }, authorize)
      expect(budgetUsage(h.run.snapshot()).tokens.used).toBe(183)
      await actor.lease.revoke(); await actor.lease.release()
      await h.run.close()
      const restored = await h.provider.open({ ...h.selection, mode: 'open' })
      expect(restored.snapshot().generationJobs?.one).toMatchObject({ status: 'rejected', content: 'public reply', cancellation: 'revoked' })
      await restored.close()
    } finally { await h.close() }
  })
  it('rejects budget, disclosure revocation and helper effects through the Native executor', async () => {
    const h = await createBusinessHarness(backend, { maxTokensPerInterval: 100 })
    try {
      const actor = await h.actor('helper'), request = job('one', actor.id)
      await expect(h.run.transitionGeneration({ kind: 'accept', job: request }, () => { throw new Error('revoked') })).rejects.toThrow('revoked')
      expect(h.run.snapshot().generationJobs).toBeUndefined()
      await h.run.transitionGeneration({ kind: 'accept', job: request }, authorize)
      const second = await h.actor('second')
      await expect(h.submit(actor.lease, 'helper-effect', [{ after: [], action: { kind: 'communication/post', recipient: second.id, channelId: 'forbidden', text: 'write', deliverAt: '1' } }])).rejects.toThrow('no world or tool effect authority')
      await h.run.transitionGeneration({ kind: 'start', id: request.id, sessionSequence: 1 }, authorize)
      await h.run.transitionGeneration({ kind: 'output', id: request.id, content: 'ok' }, authorize)
      expect((await h.run.transitionGeneration({ kind: 'validate', id: request.id }, authorize)).status).toBe('validated')
      expect(budgetUsage(h.run.snapshot()).tokens.used).toBe(100)
      await expect(h.run.transitionGeneration({ kind: 'accept', job: job('two', second.id) }, authorize)).rejects.toThrow(/budget/i)
    } finally { await h.close() }
  })
})
it('strictly rejects leaked audiences, extra privileges and unbounded delegation', () => {
  const original = job('one', 'helper')
  expect(simulationGenerationJobSchema.safeParse({ ...original, tools: ['world-write'] }).success).toBe(false)
  expect(simulationGenerationJobSchema.safeParse({ ...original, audience: ['public', 'private'] }).success).toBe(false)
  expect(simulationPlannerAssignmentSchema.safeParse({ id: 'planner', jobId: 'one', domain: 'governance', scope: 'public',
    effects: ['vote'], deadline: '99', maxAttempts: 1, maxDepth: 5, maxChildren: 1, maxTokens: 10 }).success).toBe(false)
})
