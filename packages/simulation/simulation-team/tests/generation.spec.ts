import { simulationGenerationJobIdSchema } from '@clocky/clocky-simulation'
/** Actual Team/Session/model-pool integration with a fake external provider only. */
import { expect, it, vi } from 'vitest'
import { rm, mkdir, writeFile } from 'node:fs/promises'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationChangeSchema, simulationEntityIdSchema, simulationGenerationJobSchema } from '@clocky/clocky-simulation'
import { createUserMessage } from '@clocky/clocky-llm'
import { createContext } from './harness.ts'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

for (const backend of ['json', 'sqlite'] as const) it(`isolates actual canary input and reconciles output without another model call on ${backend}`, async () => {
  const fixture = await createBusinessHarness(backend)
  const root = `${fixture.root}/team-generation`
  const { ctx } = await createContext(root, backend)
  const run = await ctx.simulations.open(fixture.selection)
  const owner = 'generation-test'
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Generate isolated text', budgets: {} }, budgets: {} }, owner)
  const connection = await ctx.simulationTeams.attach(run, team.team.id, owner)
  try {
    const id = simulationEntityIdSchema.parse('helper')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    const binding = await connection.ensureParticipant(id, { displayName: 'Helper', role: 'helper', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'test/test' })
    const session = ctx.sessions.create(binding.sessionId, { meta: { teamId: binding.teamId, participantId: binding.participantId } })
    await ctx.sessionPersistence.materializeHeader(session)
    const model = new MockAdapter([
      [{ type: 'block-end', index: 0, block: { type: 'text', text: 'PUBLIC_OUTPUT' } },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 13 } }, { type: 'finish', reason: { kind: 'stop' } }],
      [{ type: 'text-delta', index: 0, text: 'STALE_PREFIX' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'RETAINED_BEFORE_CRASH' } },
        { type: 'text-delta', index: 0, text: 'IGNORED_STRAGGLER' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 21 } }, { type: 'finish', reason: { kind: 'stop' } }],
    ])
    ctx.llm.registerAdapter(['test'], model)
    const job = simulationGenerationJobSchema.parse({ id: 'public-job', assistantEntityId: id, purpose: 'dialogue', scope: 'public', audience: ['public'],
      inputs: [{ source: 'public-note/1', content: 'PUBLIC_CANARY', audience: ['public'] }], outputSchema: 'text/1',
      model: { provider: 'test', name: 'test', version: '1' }, promptVersion: '1', policyVersion: '1',
      budget: { maxTokens: 100, maxOutputBytes: 1024, maxAttempts: 1 }, deadline: '99' })
    await run.transitionGeneration({ kind: 'accept', job }, () => {})
    await expect((async () => {
      for await (const _chunk of ctx.llm.stream({ provider: 'test', model: 'test', sessionId: session.id, messages: [], tools: [] })) { /* Unauthorized direct dispatch must stop before the provider. */ }
    })()).rejects.toThrow('exact isolated input')
    expect(model.requests).toHaveLength(0)
    await run.setPhase('running', run.snapshot().revision)
    const result = await connection.generate(job.id, () => {})
    expect(result).toMatchObject({ status: 'validated', content: 'PUBLIC_OUTPUT' })
    expect(model.requests).toHaveLength(1)
    expect(JSON.stringify(model.requests[0])).toContain('PUBLIC_CANARY')
    expect(JSON.stringify(model.requests[0])).not.toContain('DIRECTOR_SECRET')
    expect(model.requests[0]?.tools).toEqual([])
    expect(session.events.filter(value => value.type === 'simulation/generation-input')).toHaveLength(1)
    expect(session.events.filter(value => value.type === 'simulation/generation-output')).toHaveLength(1)
    expect(await connection.generate(job.id, () => {})).toEqual(result)
    expect(model.requests).toHaveLength(1)
    expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
    const recovery = simulationGenerationJobSchema.parse({ ...job, id: 'response-loss' })
    await run.transitionGeneration({ kind: 'accept', job: recovery }, () => {})
    const transition = run.transitionGeneration.bind(run)
    const fault = vi.spyOn(run, 'transitionGeneration').mockImplementation(async (change, authorize) => {
      if (change.kind === 'output') throw new Error('Native append interrupted after Session flush')
      return await transition(change, authorize)
    })
    await expect(connection.generate(recovery.id, () => {})).rejects.toThrow('Native append interrupted')
    expect(run.snapshot().generationJobs?.[recovery.id]?.status).toBe('unknown')
    expect(model.requests).toHaveLength(2)
    fault.mockRestore()
    expect(await connection.generate(recovery.id, () => {})).toMatchObject({ status: 'validated', content: 'RETAINED_BEFORE_CRASH' })
    expect(model.requests).toHaveLength(2)
    await run.setPhase('paused', run.snapshot().revision)
    const otherId = simulationEntityIdSchema.parse('other-helper')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: otherId, entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} }), run.snapshot().revision)
    const other = await connection.ensureParticipant(otherId, { displayName: 'Other helper', role: 'helper', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'parallel/test' })
    await ctx.sessionPersistence.materializeHeader(ctx.sessions.create(other.sessionId, {
      meta: { teamId: other.teamId, participantId: other.participantId } }))
    await run.setPhase('running', run.snapshot().revision)
    let active = 0, peak = 0
    const parallel = new class extends MockAdapter {
      override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        active++; peak = Math.max(peak, active)
        try { await new Promise(resolve => setTimeout(resolve, 40)); yield* super.stream(options) }
        finally { active-- }
      }
    }([textResponse('A'), textResponse('B'), textResponse('A'), textResponse('B')])
    ctx.llm.registerAdapter(['parallel'], parallel)
    const prepareJobs = async (prefix: string) => {
      for (const [suffix, assistantEntityId] of [['a', id], ['b', otherId]] as const)
        await run.transitionGeneration({ kind: 'accept', job: { ...job, id: simulationGenerationJobIdSchema.parse(`${prefix}-${suffix}`), assistantEntityId,
          model: { provider: 'parallel', name: 'test', version: '1' } } }, () => {})
    }
    await prepareJobs('parallel')
    const parallelStart = performance.now()
    await Promise.all(['a', 'b'].map(suffix => connection.generate(`parallel-${suffix}`, () => {})))
    const parallelMs = performance.now() - parallelStart
    expect(peak).toBe(2)
    peak = 0
    await prepareJobs('serial')
    const serialStart = performance.now()
    for (const suffix of ['a', 'b']) await connection.generate(`serial-${suffix}`, () => {})
    const serialMs = performance.now() - serialStart
    expect(peak).toBe(1)
    expect(parallel.requests).toHaveLength(4)
    await mkdir('.local/post-mvp-c', { recursive: true })
    await writeFile(`.local/post-mvp-c/parallel-${backend}.json`, JSON.stringify({ backend, fixture: '40ms external provider only',
      parallelMs, serialMs, parallelPeak: 2, serialPeak: 1, callsPerMode: 2, realProvider: false }) + '\n')
    const second = simulationGenerationJobSchema.parse({ ...job, id: 'second' })
    await run.transitionGeneration({ kind: 'accept', job: second }, () => {})
    session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'DIRECTOR_SECRET' }] }), { surfaceOp: 'append' })
    await expect(connection.generate(second.id, () => {})).rejects.toThrow('unrelated cognition')
    expect(model.requests).toHaveLength(2)
    const hanging = new MockAdapter(['hang-slow'])
    ctx.llm.registerAdapter(['hanging'], hanging)
    const outstanding = { ...job, id: simulationGenerationJobIdSchema.parse('unload-retained'), assistantEntityId: otherId, model: { provider: 'hanging', name: 'test', version: '1' } }
    await run.transitionGeneration({ kind: 'accept', job: outstanding }, () => {})
    const pending = connection.generate(outstanding.id, () => {})
    const interrupted = expect(pending).rejects.toThrow()
    await vi.waitFor(() =>{  expect(hanging.requests).toHaveLength(1) })
    expect(() => connection.generate(outstanding.id, () => { throw new Error('coalesced caller revoked') })).toThrow('coalesced caller revoked')
    await connection.close()
    await interrupted
    expect(run.snapshot().generationJobs?.[outstanding.id]?.status).toBe('unknown')
    expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
  } finally {
    await connection.close(); await run.close(); await ctx.fiber.dispose()
    await fixture.close(); await rm(root, { recursive: true, force: true })
  }
})
