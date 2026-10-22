/** External input arriving during a frozen model window, with durable delivery recovery. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationChangeSchema, simulationContextRequestSchema, simulationDecisionIdSchema, simulationEntityIdSchema,
  simulationIngressRequestSchema, simulationRunSelectionSchema, simulationWindowIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-ingress', process.argv[2]!)
const recovering = process.env['SIMULATION_INGRESS_RECOVER'] === 'true'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'ingress', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [],
} }))
const release = Promise.withResolvers<undefined>()
const started = Promise.withResolvers<undefined>()
const hold = async (stage: string) => {
  if (process.env['SIMULATION_INGRESS_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const entityId = simulationEntityIdSchema.parse('receiver')
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Process ordered external inputs', budgets: {} }, budgets: {} }, 'simulation/ingress')
  if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: entityId,
    entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/ingress')
  await connection.ensureParticipant(entityId, { displayName: 'Receiver', role: 'receiver', capabilities: [],
    provider: 'in-process', preset: 'simulation', model: 'ingress/scripted' })
  let script = { id: 'initial', calls: 0, expected: '' }
  const modelViews: Array<{ decision: string; request: number; first: boolean; second: boolean }> = []
  ctx.llm.registerAdapter(['ingress'], new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      const index = script.calls++
      const input = JSON.stringify(options.messages)
      const first = input.includes('FIRST_INGRESS')
      const second = input.includes('SECOND_INGRESS')
      if (script.id === 'initial') { assert.equal(first, false); assert.equal(second, false) }
      if (script.expected === 'FIRST_INGRESS') { assert.equal(first, true); assert.equal(second, false) }
      if (script.expected === 'SECOND_INGRESS') assert.equal(second, true)
      modelViews.push({ decision: script.id, request: index, first, second })
      if (script.id === 'initial' && index === 0) { started.resolve(undefined); await release.promise }
      if (script.expected === 'FIRST_INGRESS' && index === 0) await hold('consumed')
      const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(name)
      const id = CallId(`${script.id}-${index}`)
      const args = JSON.stringify(index === 1 ? { proposals: [] } : {})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }())
  if (recovering) await connection.recover(entityId)
  const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
    agent: { preset: 'simulation', options: { provider: 'ingress', model: 'scripted' } }, signal: new AbortController().signal })
  assert.ok(lease.localAgent)
  const context = () => simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
    personaVersion: 'ingress-1', modelVersion: 'scripted-1', sources: [],
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
      blocks: [{ type: 'text', text: kind === 'input' ? 'Process the selected input.' : kind }] })),
  })
  const requests = ['FIRST_INGRESS', 'SECOND_INGRESS'].map((text, index) => simulationIngressRequestSchema.parse({
    id: String(index), entityId, source: index === 0 ? 'operator' : 'sensor', text, availableAt: '0',
  }))
  if (!recovering) {
    await run.setPhase('running', run.snapshot().revision)
    const initialId = simulationDecisionIdSchema.parse('initial')
    const window = await connection.openWindow({ id: simulationWindowIdSchema.parse('initial'),
      decisions: [{ id: initialId, entityId, context: context() }] })
    const pending = connection.executeDecision(entityId, initialId, context())
    await started.promise
    const before = run.snapshot().decisions[initialId]!.context
    await run.setPhase('paused', run.snapshot().revision)
    for (const request of requests) {
      const receipt = await run.ingest(request)
      assert.deepEqual(await run.ingest(request), receipt)
    }
    assert.deepEqual(run.snapshot().decisions[initialId]!.context, before)
    assert.ok(!JSON.stringify(lease.localAgent.session.events).includes('FIRST_INGRESS'))
    await hold('received')
    await run.setPhase('running', run.snapshot().revision)
    release.resolve(undefined)
    await pending
    await run.commitWindow(window.id)
  } else {
    const active = run.snapshot().activeWindowId
    if (active !== undefined) await run.commitWindow(active)
    await run.setPhase('running', run.snapshot().revision)
    for (const request of requests) {
      const prior = run.snapshot().ingresses?.[request.id]
      assert.deepEqual(await run.ingest(request), prior)
    }
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    const result = await next()
    const id = run.snapshot().activeDecisionId
    if (payload.agent.id === lease.localAgent?.id && id !== undefined && run.snapshot().decisions[id]?.ingressId === requests[0]!.id) {
      await hold('flushed')
    }
    return result
  }, { prepend: true })
  const observations: string[] = []
  while (true) {
    const result = await connection.drive({ until: simTimeSchema.parse('0') }, Date.now)
    if (result.reason === 'until') break
    assert.equal(result.reason, 'decision-required')
    const wake = Object.values(run.snapshot().wakes).find(value => value.status === 'pending')
    assert.ok(wake)
    const event = run.snapshot().scheduledEvents[wake.eventId]
    assert.ok(event?.action.kind === 'ingress')
    const ingress = run.snapshot().ingresses![event.action.ingressId]!
    const id = simulationDecisionIdSchema.parse(`input-${ingress.ordinal}-${run.snapshot().entities[entityId]?.writer?.epoch}`)
    await connection.openDecision(entityId, id, wake.eventId)
    await hold('claimed')
    script = { id, calls: 0, expected: ingress.request.text }
    const decision = await connection.executeDecision(entityId, id, context(), wake.eventId)
    assert.equal(decision.ingressId, ingress.request.id)
    assert.equal(script.calls, 3)
    assert.ok(decision.context?.status === 'prepared')
    const selected = JSON.stringify(decision.context.view.content)
    assert.ok(selected.includes(ingress.request.text))
    if (ingress.ordinal === '0') assert.ok(!selected.includes('SECOND_INGRESS'))
    observations.push(ingress.request.text)
    if (ingress.ordinal === '0') await hold('accepted')
  }
  const state = run.snapshot()
  console.log(JSON.stringify({ modelViews, observations,
    ingresses: Object.values(state.ingresses ?? {}).map(ingress => ({ id: ingress.request.id, ordinal: ingress.ordinal,
      time: ingress.key.time, microstep: ingress.key.microstep,
      acceptedDecisions: Object.values(state.decisions).filter(decision => decision.ingressId === ingress.request.id && decision.status === 'accepted').length })),
    cancelledDecisions: Object.values(state.decisions).filter(decision => decision.status === 'cancelled').map(decision => decision.id),
    wakes: Object.values(state.wakes).map(wake => wake.status), time: state.time }))
} finally { release.resolve(undefined); await run.close(); await ctx.fiber.dispose() }
