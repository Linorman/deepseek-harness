/** Model replanning after resource conflict, including durable budget exhaustion and restart. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationChannelSpecSchema, simulationChangeSchema, simulationContextRequestSchema,
  simulationDecisionIdSchema, simulationEntityIdSchema,
  simulationResourceSpecSchema, simulationRunSelectionSchema, simulationWindowIdSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-conflict', process.argv[2]!)
const recovering = process.env['SIMULATION_RETRY_RECOVER'] === 'true'
const stale = process.env['SIMULATION_RETRY_STALE'] === 'true'
const blocked = process.env['SIMULATION_RETRY_BLOCKED'] === 'true'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'conflict', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 2, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2,
  maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '10000', relationRules: [],
} }))
const hold = async (stage: string) => {
  if (process.env['SIMULATION_RETRY_CRASH'] !== stage) return
  process.send?.('durable')
  await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Allocate one unit', budgets: {} }, budgets: {} }, 'simulation/conflict')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/conflict')
  const a = simulationEntityIdSchema.parse('a')
  const b = simulationEntityIdSchema.parse('b')
  let script: { entityId: typeof a; id: string; retry: boolean; calls: number } | undefined
  let modelRequests = 0
  let channelId: import('@clocky/clocky-team').ChannelId | undefined
  ctx.llm.registerAdapter(['conflict'], new class extends LlmAdapter {
    async *stream(_options: GenerateOptions): AsyncGenerator<StreamChunk> {
      assert.ok(script)
      modelRequests += 1
      const index = script.calls++
      const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(name)
      const transfer = { after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
        commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: `${script.entityId}-stock`, revision: 1 }],
        transfers: [{ from: 'stock', to: `${script.entityId}-stock`, quantity: '1' }],
      } } }
      const proposals: unknown[] = script.retry && !stale ? [] : [transfer]
      if (blocked && !script.retry && script.entityId === b) {
        assert.ok(channelId)
        proposals.push({ after: [], action: { kind: 'communication/post', recipient: a, channelId, text: 'Future dependency', deliverAt: '10' } })
        proposals.push({ ...transfer, after: [1] })
      }
      const args = JSON.stringify(index === 1 ? { proposals } : {})
      const id = CallId(`${script.id}-${index}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }())
  for (const entityId of [a, b]) {
    if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: entityId,
      entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
    await connection.ensureParticipant(entityId, { displayName: entityId, role: entityId, capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'conflict/scripted' })
    if (recovering) await connection.recover(entityId)
    await connection.activate(entityId, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'conflict', model: 'scripted' } }, signal: new AbortController().signal })
    if (!recovering) await run.createResource(simulationResourceSpecSchema.parse({ id: `${entityId}-stock`, owner: entityId,
      kind: 'inventory', unit: 'item', quantity: '0', controllers: [entityId] }), run.snapshot().revision)
  }
  if (blocked) channelId = (await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'future',
    members: [{ entityId: a, role: 'a' }, { entityId: b, role: 'b' }], limits: {} }))).manifest.id
  const context = (entityId: typeof a, input: unknown, sequence: number) => simulationContextRequestSchema.parse({
    maxBytes: 65536, teamCursor: 0, personaVersion: 'conflict-1', modelVersion: 'scripted-1',
    sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence }],
    sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true, blocks: [{
      type: 'text', text: kind === 'identity' ? `Actor ${entityId}` : kind === 'input' ? JSON.stringify(input) : kind,
    }] })),
  })
  if (!recovering) {
    await run.createResource(simulationResourceSpecSchema.parse({ id: 'stock', owner: a,
      kind: 'inventory', unit: 'item', quantity: '1', controllers: [a, b] }), run.snapshot().revision)
    await run.setPhase('running', run.snapshot().revision)
    const window = await connection.openWindow({ id: simulationWindowIdSchema.parse('initial'), decisions: [a, b].map(entityId => ({
      entityId, id: simulationDecisionIdSchema.parse(entityId),
      context: context(entityId, { stock: 1, revision: 1 }, run.snapshot().revision),
    })) })
    for (const entityId of [a, b]) {
      script = { entityId, id: entityId, retry: false, calls: 0 }
      await connection.executeDecision(entityId, simulationDecisionIdSchema.parse(entityId), context(entityId, {}, window.snapshotRevision))
      assert.equal(script.calls, 3)
    }
    await run.commitWindow(window.id)
  }
  const retryInputs: unknown[] = []
  while (true) {
    const result = await connection.drive({ until: simTimeSchema.parse('0') }, Date.now)
    const queued = Object.values(run.snapshot().scheduledEvents).find(event => event.action.kind === 'conflict-retry' && event.status === 'pending')
    if (queued !== undefined) await hold('queued')
    if (result.reason === 'work-limit' || result.reason === 'coordination-limit') continue
    if (result.reason === 'stalled') {
      await hold('exhausted')
      const failure = Object.values(run.snapshot().operations).find(operation => operation.conflictRetry?.kind === 'exhausted')
      assert.ok(failure)
      await assert.rejects(run.setPhase('running', run.snapshot().revision), /acknowledgement/)
      await run.acknowledgeConflict(failure.id, run.snapshot().revision)
      await run.setPhase('running', run.snapshot().revision)
      continue
    }
    if (result.reason === 'until') break
    assert.equal(result.reason, 'decision-required')
    const wake = Object.values(run.snapshot().wakes).find(value => value.status === 'pending')
    assert.ok(wake)
    const event = run.snapshot().scheduledEvents[wake.eventId]
    assert.ok(event?.action.kind === 'conflict-retry')
    const attempt = event.action.attempt
    assert.ok(attempt <= run.snapshot().spec.maxConflictRetries)
    const id = simulationDecisionIdSchema.parse(`retry-${attempt}-${run.snapshot().entities[b]?.writer?.epoch}`)
    const input = { reason: wake.reason, retry: event.action, resources: Object.values(run.snapshot().resources).filter(resource =>
      resource.owner === b || resource.controllers.includes(b)).map(({ id, quantity, revision }) => ({ id, quantity, revision })) }
    const retryWindow = blocked ? await connection.openWindow({ id: simulationWindowIdSchema.parse(`window-${id}`),
      decisions: [{ id, entityId: b, wakeId: wake.eventId, context: context(b, input, run.snapshot().revision) }] }) : undefined
    const opened = retryWindow === undefined ? await connection.openDecision(b, id, wake.eventId) : run.snapshot().decisions[id]!
    await hold('claimed')
    script = { entityId: b, id, retry: true, calls: 0 }
    const decision = await connection.executeDecision(b, id, context(b, input, opened.snapshotRevision), wake.eventId)
    assert.equal(decision.retry?.attempt, attempt)
    assert.equal(script.calls, 3)
    const actor = ctx.agents.get(run.snapshot().entities[b]!.binding!.sessionId)
    const observed = actor?.session.events.findLast(event => event.type === 'tool/result'
      && event.data.message.content[0].toolCallId === CallId(`${id}-0`))
    assert.ok(observed?.type === 'tool/result' && decision.context?.status === 'prepared')
    const text = observed.data.message.content[0].content.find(block => block.type === 'text')
    assert.ok(text?.type === 'text')
    assert.deepEqual(JSON.parse(text.text), { status: 'observed', time: decision.time, sections: decision.context.view.content })
    retryInputs.push(input)
    if (retryWindow !== undefined) await run.commitWindow(retryWindow.id)
  }
  const state = run.snapshot()
  assert.deepEqual(Object.values(state.resources).map(resource => resource.quantity), ['1', '0', '0'])
  console.log(JSON.stringify({ modelRequests, retryInputs, phase: state.phase,
    retries: Object.values(state.scheduledEvents).filter(event => event.action.kind === 'conflict-retry').map(event => ({
      microstep: event.key.microstep, status: event.status,
      attempt: event.action.kind === 'conflict-retry' ? event.action.attempt : undefined,
    })),
    decisions: Object.values(state.decisions).map(decision => ({
      id: decision.id, status: decision.status, attempt: decision.retry?.attempt,
    })),
    operations: Object.values(state.operations).map(operation => ({
      kind: operation.action.kind, status: operation.status, code: operation.result?.code,
      retry: operation.conflictRetry?.kind,
      acknowledged: operation.conflictRetry?.kind === 'exhausted' ? operation.conflictRetry.acknowledged : undefined })),
    resources: Object.values(state.resources).map(({ id, quantity }) => ({ id, quantity })) }))
} finally { await run.close(); await ctx.fiber.dispose() }
