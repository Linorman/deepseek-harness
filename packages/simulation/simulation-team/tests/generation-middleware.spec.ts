/** The queued provider request cannot diverge from the already flushed canonical Session input. */
import { expect, it, vi } from 'vitest'
import { simulationChangeSchema, simulationEntityIdSchema, simulationGenerationJobSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { createContext } from './harness.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

it('refuses a middleware canary mutation while a helper waits for the shared pool, before provider admission', async () => {
  const fixture = await createBusinessHarness('json')
  const { ctx } = await createContext(`${fixture.root}/middleware`, 'json', 65536, 16, 1)
  const run = await ctx.simulations.open(fixture.selection)
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Input integrity', budgets: {} }, budgets: {} }, 'generation-input')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'generation-input')
  const firstAbort = new AbortController(), secondAbort = new AbortController()
  try {
    for (const name of ['occupant', 'waiting']) {
      const id = simulationEntityIdSchema.parse(name)
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'generation-assistant', cognition: 'agent',
        readiness: 'ready', profile: {} }), run.snapshot().revision)
      const binding = await connection.ensureParticipant(id, { displayName: name, role: 'member', capabilities: [], provider: 'in-process',
        preset: 'simulation', model: 'test/test' })
      await ctx.sessionPersistence.materializeHeader(ctx.sessions.create(binding.sessionId, {
        meta: { teamId: binding.teamId, participantId: binding.participantId } }))
      await run.transitionGeneration({ kind: 'accept', job: simulationGenerationJobSchema.parse({ id: name, assistantEntityId: id,
        purpose: 'dialogue', scope: 'public', audience: ['public'], inputs: [{ source: 'public', content: 'PUBLIC_ONLY', audience: ['public'] }],
        outputSchema: 'text/1', model: { provider: 'test', name: 'test', version: '1' }, promptVersion: '1', policyVersion: '1',
        deadline: '99', budget: { maxTokens: 100, maxOutputBytes: 512, maxAttempts: 1 } }) }, () => {})
    }
    await run.setPhase('running', run.snapshot().revision)
    const model = new MockAdapter(['hang', textResponse('MUST_NOT_REACH')]); ctx.llm.registerAdapter(['test'], model)
    const first = connection.generate('occupant', () => {}, firstAbort.signal)
    const firstStopped = expect(first).rejects.toThrow()
    await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
    const sessionId = run.snapshot().generationJobs?.waiting?.binding.sessionId
    const remove = ctx.on('llm/stream', (options, next) => {
      if (options.sessionId !== sessionId) return next()
      return (async function* () {
        const iterator = next()[Symbol.asyncIterator](), pending = iterator.next()
        await vi.waitFor(() => { expect(ctx.simulationTeams.modelUsage().queued).toBe(1) })
        try {
          const block = options.messages[0]?.content[0]
          expect(block?.type).toBe('text'); expect(Object.isFrozen(block)).toBe(true)
          Object.defineProperty(block, 'text', { value: 'MIDDLEWARE_PRIVATE_CANARY' })
        } finally {
          secondAbort.abort()
          try { await pending }
          catch (error) { if (!secondAbort.signal.aborted) throw error }
          await iterator.return?.()
        }
      })()
    }, { prepend: true })
    const waiting = connection.generate('waiting', () => {}, secondAbort.signal)
    await expect(waiting).rejects.toBeInstanceOf(TypeError)
    expect(model.requests).toHaveLength(1)
    expect(JSON.stringify(model.requests)).not.toContain('MIDDLEWARE_PRIVATE_CANARY')
    expect(run.snapshot().generationJobs?.waiting?.status).toBe('unknown')
    remove(); firstAbort.abort(); await firstStopped
    expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
  } finally {
    firstAbort.abort(); secondAbort.abort(); await connection.close(); await run.close()
    await ctx.fiber.dispose(); await fixture.close()
  }
})
