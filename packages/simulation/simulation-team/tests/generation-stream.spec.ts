/** Protocol edge cases use the real Session and Native ledger, with only the external chunk stream supplied. */
import { expect, it } from 'vitest'
import { CallId } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'
import { simulationGenerationJobSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { createContext } from './harness.ts'
import { executeGeneration } from '../src/generation.ts'

it.each(['delta', 'block-end', 'oversized-stream'] as const)('retains known usage and denies %s helper responses', async (variant) => {
  const h = await createBusinessHarness('json')
  const { ctx } = await createContext(`${h.root}/sessions`, 'json')
  try {
    const actor = await h.actor('helper'), binding = h.run.snapshot().entities[actor.id]!.binding!
    const session = ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
    await ctx.sessionPersistence.materializeHeader(session)
    const job = simulationGenerationJobSchema.parse({ id: 'edge', assistantEntityId: actor.id, purpose: 'dialogue', scope: 'public',
      audience: ['public'], inputs: [], outputSchema: 'text/1', model: { provider: 'test', name: 'test', version: '1' },
      promptVersion: '1', policyVersion: '1', deadline: '99', budget: { maxTokens: 100, maxOutputBytes: 512, maxAttempts: 1 } })
    await h.run.transitionGeneration({ kind: 'accept', job }, () => {})
    const bad: StreamChunk = variant === 'delta' ? { type: 'tool-call-delta', index: 0, id: CallId('forbidden'), name: 'write', argumentsDelta: '{}' }
      : variant === 'block-end' ? { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('forbidden'), name: 'write', arguments: '{}' } }
        : { type: 'block-end', index: 0, block: { type: 'text', text: 'a'.repeat(1048576) } }
    await expect(executeGeneration(h.run, job.id, session, () => {}, () => ctx.sessions.flush(session), async function* () {
      yield { type: 'usage', usage: { inputTokens: 150, outputTokens: 20 } }
      yield bad
      yield { type: 'finish', reason: { kind: 'stop' } }
    }, new AbortController().signal)).rejects.toThrow(variant === 'oversized-stream' ? 'byte allowance' : 'cannot invoke tools')
    expect(h.run.snapshot().generationJobs?.edge).toMatchObject({ status: 'unknown', observedUsage: { inputTokens: 150, outputTokens: 20 } })
    expect(h.run.snapshot().generationJobs?.edge?.content).toBeUndefined()
    expect(h.run.budgetUsage().tokens.used).toBe(170)
  } finally { await ctx.fiber.dispose(); await h.close() }
})
