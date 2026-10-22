/** Actual Team/Session/model-pool integration with a fake external provider only. */
import { expect, it } from 'vitest'
import { rm, readFile, writeFile } from 'node:fs/promises'
import { simulationChangeSchema, simulationEntityIdSchema, simulationGenerationJobSchema, simulationCheckpointRequestSchema } from '@clocky/clocky-simulation'
import { validateCheckpointOwners } from '../src/restore.ts'
import { createContext } from './harness.ts'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'

for (const backend of ['json', 'sqlite'] as const) it(`refuses missing or tampered generation evidence at checkpoint, restore and archive on ${backend}`, async () => {
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
    await run.setPhase('running', run.snapshot().revision)
    await connection.generate(job.id, () => {})
    const request = simulationCheckpointRequestSchema.parse({ id: 'generation-evidence', implementationVersion: 'test/1', maxDrainRounds: 8, maxAttempts: 3 })
    const receipt = await connection.checkpoint(request)
    expect(receipt, JSON.stringify(receipt)).toMatchObject({ status: 'completed' })
    if (receipt.status !== 'completed') throw new Error('Expected completed checkpoint')
    const manifest = receipt.manifest
    const location = ctx.sessionPersistence.locate(session.header)
    if (location?.kind !== 'jsonl') throw new Error('Expected real JSONL persistence')
    const bytes = await readFile(location.path, 'utf8')
    const rejectOwners = async () => {
      await expect(connection.collectCheckpointCandidate(8, 3)).rejects.toThrow()
      await expect(validateCheckpointOwners(ctx, run, manifest, 3, () => {})).rejects.toThrow()
      // Archive publication obtains this same real owner cut before exporting any bytes.
      await expect((async () => {
        const cut = await connection.collectCheckpointCandidate(8, 3, undefined, 'quiescent')
        try { return await cut.exportArchive({ maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }) }
        finally { cut.release() }
      })()).rejects.toThrow()
    }
    for (const [before, after] of [['PUBLIC_CANARY', 'TAMPERED_INPUT'], ['PUBLIC_OUTPUT', 'TAMPERED_OUTPUT']] as const) {
      expect(bytes).toContain(before)
      await writeFile(location.path, bytes.replace(before, after))
      await rejectOwners()
      await writeFile(location.path, bytes)
    }
    await rm(location.path)
    await rejectOwners()
    await writeFile(location.path, bytes)
    const healthy = await connection.collectCheckpointCandidate(8, 3)
    healthy.release()
    expect(model.requests).toHaveLength(1)
  } finally {
    await connection.close(); await run.close(); await ctx.fiber.dispose()
    await fixture.close(); await rm(root, { recursive: true, force: true })
  }
})
