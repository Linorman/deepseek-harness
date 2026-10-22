/** Keyless actual canonical generation with an independently reopened journal and Session. */
import { boot } from '@clocky/clocky-app-boot'
import { simulationChangeSchema, simulationEntityIdSchema, simulationGenerationJobSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../../packages/simulation/simulation-local/tests/business-harness.ts'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'

const backend = process.env.SIMULATION_COMPANY_BACKEND === 'sqlite' ? 'sqlite' : 'json'
const restored = process.env.WORLD_DRIVER_RECOVER === 'true'
const fixture = await createBusinessHarness(backend)
const selection = fixture.selection
await fixture.close()
const ctx = await boot('world-generation', process.argv[2]!)
const run = await ctx.simulations.open({ ...selection, mode: restored ? 'open' : 'create' })
const model = new MockAdapter([textResponse('PUBLIC_OUTPUT')])
ctx.llm.registerAdapter(['generation-fixture'], model)
try {
  if (!restored) {
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Isolated generation', budgets: {} }, budgets: {} }, 'generation-example')
    const connection = await ctx.simulationTeams.attach(run, team.team.id, 'generation-example')
    const entityId = simulationEntityIdSchema.parse('helper')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person', cognition: 'agent', readiness: 'ready', profile: {} }), run.snapshot().revision)
    const binding = await connection.ensureParticipant(entityId, { displayName: 'Helper', role: 'helper', capabilities: [], provider: 'in-process', preset: 'simulation', model: 'generation-fixture/test' })
    await ctx.sessionPersistence.materializeHeader(ctx.sessions.create(binding.sessionId, {
      meta: { teamId: binding.teamId, participantId: binding.participantId } }))
    const job = simulationGenerationJobSchema.parse({ id: 'original', assistantEntityId: entityId, purpose: 'dialogue', scope: 'public', audience: ['public'],
      inputs: [{ source: 'public-brief/1', content: 'PUBLIC_CANARY', audience: ['public'] }], outputSchema: 'text/1',
      model: { provider: 'generation-fixture', name: 'test', version: '1' }, promptVersion: '1', policyVersion: '1',
      deadline: '99', budget: { maxTokens: 100, maxOutputBytes: 1024, maxAttempts: 1 } })
    await run.transitionGeneration({ kind: 'accept', job }, () => {})
    await run.setPhase('running', run.snapshot().revision)
    await connection.generate(job.id, () => {})
    await connection.generate(job.id, () => {})
    await connection.close()
  }
  const original = run.snapshot().generationJobs?.original
  if (original?.status !== 'validated' || original.content !== 'PUBLIC_OUTPUT') throw new Error('Original generation result was not retained')
  const session = await ctx.sessionPersistence.readFrom(original.binding.sessionId, 0)
  const input = session.events.filter(event => event.type === 'simulation/generation-input')
  const output = session.events.filter(event => event.type === 'simulation/generation-output')
  if (input.length !== 1 || output.length !== 1 || !JSON.stringify(input).includes('PUBLIC_CANARY')) throw new Error('Generation Session source was not retained')
  process.stdout.write(JSON.stringify({ restored, modelCalls: model.requests.length, output: original.content,
    inputEvents: input.length, outputEvents: output.length, tokens: run.budgetUsage().tokens.used }) + '\n')
} finally { await run.close(); await ctx.fiber.dispose() }
