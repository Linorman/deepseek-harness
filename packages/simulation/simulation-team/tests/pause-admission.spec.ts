import BasicCompactionEngine from '@clocky/clocky-compaction-basic'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { LlmError, MessageId } from '@clocky/clocky-llm'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { contextRequest } from '../../simulation-local/tests/context-fixture.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { createContext } from './harness.ts'
import * as ToolSimulation from '@clocky/clocky-tool-simulation'
import { simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema,
  simulationDecisionIdSchema, simulationResourceSpecSchema, simulationWakeRequestSchema,
  simulationWindowIdSchema, simulationPhaseManagementRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(backend: 'json' | 'sqlite', bounded = false, decisionTimeoutMs = 60000) {
  const temp = join(process.cwd(), '.local/world-director-mvp/tmp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(join(temp, 'team-paused-'))
  const { ctx } = await createContext(root, backend, 65536, 16, 2, 16, bounded
    ? { maxOutputTokens: 512, safetyMarginTokens: 512, inputSafetyFactor: 1.5, compactionAttempts: 1 } : undefined)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
  } })
  const run = await ctx.simulations.open(selection)
  cleanups.push(async () => {
    await run.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Company', budgets: {} },
    rules: { activationLifecycleOwner: 'simulation/company', simulationRunId: 'company' }, budgets: {} })
  const teamId = team.team.id
  const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: team.team.cursor,
    kind: 'local-agent', displayName: 'Buyer', role: 'buyer', capabilities: [] })
  for (const phase of ['provisioning', 'active'] as const) {
    const state = await ctx.teams.getTeam({ teamId })
    await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, expectedCursor: state.team.cursor, phase })
  }
  const entityId = simulationEntityIdSchema.parse('buyer')
  await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: entityId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
  const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
  return { ctx, run, teamId, participant, entityId, connection }
}
it.each([
  ['json', true], ['json', false], ['sqlite', true], ['sqlite', false],
] as const)('settles between-stream pause and resumes the same wake without duplicate effects (%s, known usage=%s)', async (backend, knownUsage) => {
  const { ctx, run, connection, entityId, participant } = await setup(backend)
  await ctx.plugin(ToolSimulation)
  for (const [id, quantity] of [['wallet', '2'], ['spent', '0']]) {
    await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: entityId,
      kind: 'money', unit: 'cent', controllers: [entityId] }), run.snapshot().revision)
  }
  const proposals = [{ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
    commitmentId: null, reads: [{ resourceId: 'wallet', revision: 1 }, { resourceId: 'spent', revision: 1 }],
    transfers: [{ from: 'wallet', to: 'spent', quantity: '1' }],
  } } }]
  const observed = toolCallResponse('observe-paused', 'simulation_observe', {})
    .filter(chunk => knownUsage || chunk.type !== 'usage')
  const model = new MockAdapter([
    toolCallResponse('observe-first', 'simulation_observe', {}),
    toolCallResponse('stage-first', 'simulation_stage', { proposals }),
    toolCallResponse('submit-first', 'simulation_submit', {}), observed,
    toolCallResponse('observe-resumed', 'simulation_observe', {}),
    toolCallResponse('stage-resumed', 'simulation_stage', { proposals: [] }),
    toolCallResponse('submit-resumed', 'simulation_submit', {}),
  ])
  ctx.llm.registerAdapter(['pause-model'], model)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'pause-model', model: 'fixture' } }, signal: new AbortController().signal })
  const actor = lease.localAgent!
  await run.setPhase('running', run.snapshot().revision)
  const first = simulationDecisionIdSchema.parse('accepted-before-pause')
  expect((await connection.executeDecision(entityId, first, contextRequest())).status).toBe('accepted')
  await run.drive({ until: simTimeSchema.parse('0') })
  const originalOperations = run.snapshot().decisions[first]!.operationIds
  expect(originalOperations).toHaveLength(1)
  expect(run.snapshot().operations[originalOperations[0]!]!.result?.status).toBe('applied')
  expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['1', '1'])

  const wake = simulationWakeRequestSchema.parse({ id: 'paused-wake', entityId, time: '0', reason: 'Continue work' })
  await run.scheduleWake(wake, run.snapshot().revision)
  await run.drive({ until: simTimeSchema.parse('0') })
  const id = simulationDecisionIdSchema.parse('paused-decision')
  const windowId = simulationWindowIdSchema.parse('paused-window')
  await connection.openWindow({ id: windowId, decisions: [{ id, entityId, wakeId: wake.id, context: contextRequest() }] })
  let preserved: ReturnType<typeof run.snapshot>['tokenReservations']
  const removePause = ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.name === 'simulation_observe' && !result.isError && run.snapshot().decisions[id]?.status === 'open') {
      preserved = run.snapshot().tokenReservations
      await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'pause-between-streams', phase: 'paused' }))
    }
    return await next()
  })
  const cancelled = await connection.executeDecision(entityId, id, contextRequest(), wake.id)
  removePause()
  expect(cancelled).toMatchObject({ status: 'cancelled', cancellation: 'paused', operationIds: [] })
  expect(run.snapshot().phase).toBe('paused')
  expect(run.snapshot().wakes[wake.id]).toMatchObject({ status: 'pending' })
  expect(run.snapshot().wakes[wake.id]!.decisionId).toBeUndefined()
  expect(run.snapshot().windows?.[windowId]?.status).toBe('closed')
  expect(run.snapshot().activeWindowId).toBeUndefined()
  expect(run.snapshot().tokenReservations).toEqual(preserved!)
  expect(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status))
    .toEqual(['settled', 'settled', 'settled', knownUsage ? 'settled' : 'unknown'])
  expect(run.budgetUsage().tokens.used).toBe(knownUsage ? 60 : 10045)
  expect(model.requests).toHaveLength(4)
  expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
  const revision = run.snapshot().revision
  expect(await connection.executeDecision(entityId, id, contextRequest(), wake.id)).toEqual(cancelled)
  expect(run.snapshot().revision).toBe(revision)
  expect(model.requests).toHaveLength(4)
  if (cancelled.context?.status !== 'prepared') throw new Error('Paused fixture lost its prepared context')
  const inputId = MessageId(cancelled.context.view.inputId)
  const consumed = () => actor.session.events.filter(event => event.type === 'user/message' && event.surfaceOp === 'append'
    && event.data.id === inputId)
  expect(consumed()).toHaveLength(1)

  await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'resume-original-wake', phase: 'running' }))
  const resumedId = simulationDecisionIdSchema.parse('resumed-decision')
  const resumed = await connection.executeDecision(entityId, resumedId, contextRequest(), wake.id)
  expect(resumed.status).toBe('accepted')
  if (resumed.context?.status !== 'prepared') throw new Error('Resumed fixture lost its prepared context')
  expect(resumed.context.view.inputId).not.toBe(inputId)
  expect(run.snapshot().wakes[wake.id]).toMatchObject({ status: 'completed', decisionId: resumedId })
  expect(model.requests).toHaveLength(7)
  expect(consumed()).toHaveLength(1)
  expect(run.snapshot().decisions[first]!.operationIds).toEqual(originalOperations)
  expect(Object.keys(run.snapshot().operations)).toHaveLength(1)
  expect(Object.values(run.snapshot().resources).map(value => value.quantity)).toEqual(['1', '1'])
  expect(await ctx.sessions.flush(actor.session)).toBe(true)
})

it.each(['json', 'sqlite'] as const)('settles a pause queued after token reservation before downstream dispatch (%s)', async (backend) => {
  const { ctx, run, connection, entityId, participant } = await setup(backend)
  const originalReserveWriter = run.reserveWriter.bind(run)
  const reserveWriter = vi.spyOn(run, 'reserveWriter').mockImplementation(async (...request) => {
    const writer = await originalReserveWriter(...request)
    const reserveModelTokens = writer.reserveModelTokens.bind(writer)
    writer.reserveModelTokens = async (...args) => {
      const reserved = await reserveModelTokens(...args)
      await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'pause-after-reservation', phase: 'paused' }))
      return reserved
    }
    return writer
  })
  const model = new MockAdapter([toolCallResponse('unused', 'simulation_observe', {})])
  ctx.llm.registerAdapter(['paused-before-dispatch'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'paused-before-dispatch', model: 'fixture' } }, signal: new AbortController().signal })
  reserveWriter.mockRestore()
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('pre-dispatch-paused')
  expect(await connection.executeDecision(entityId, id, contextRequest())).toMatchObject({ status: 'cancelled', cancellation: 'paused' })
  expect(model.requests).toHaveLength(0)
  expect(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status)).toEqual(['not-dispatched'])
  expect(run.budgetUsage().tokens.used).toBe(0)
  expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
})

it.each(['json', 'sqlite'] as const)('keeps a genuine downstream provider error visible when management concurrently pauses (%s)', async (backend) => {
  const { ctx, run, connection, entityId, participant } = await setup(backend)
  class FailingAdapter extends MockAdapter {
    override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      this.requests.push(options)
      await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'pause-during-provider-error', phase: 'paused' }))
      yield* []
      throw new Error('Actual downstream provider defect')
    }
  }
  const model = new FailingAdapter([])
  ctx.llm.registerAdapter(['paused-provider-error'], model)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'paused-provider-error', model: 'fixture' } }, signal: new AbortController().signal })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('real-error')
  await expect(connection.executeDecision(entityId, id, contextRequest())).rejects.toThrow('Actual downstream provider defect')
  expect(run.snapshot().decisions[id]).toMatchObject({ status: 'open' })
  expect(run.snapshot().decisions[id]!.cancellation).toBeUndefined()
  expect(run.snapshot().phase).toBe('paused')
  expect(lease.localAgent!.session.events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'error'
    && event.data.reason.error.message.includes('Actual downstream provider defect'))).toBe(true)
  expect(model.requests).toHaveLength(1)
  expect(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status)).toEqual(['unknown'])
  expect(run.budgetUsage().tokens.used).toBe(10000)
})

it.each([
  ['json', 'prepared'], ['json', 'queued'], ['sqlite', 'prepared'], ['sqlite', 'queued'],
] as const)('settles pause before Agent dispatch and retires the old queued input on resume (%s, %s)', async (backend, boundary) => {
  const { ctx, run, connection, entityId, participant } = await setup(backend)
  await ctx.plugin(ToolSimulation)
  const model = new MockAdapter([
    toolCallResponse('observe-resume', 'simulation_observe', {}),
    toolCallResponse('stage-resume', 'simulation_stage', { proposals: [] }),
    toolCallResponse('submit-resume', 'simulation_submit', {}),
  ])
  ctx.llm.registerAdapter(['pause-dispatch'], model)
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'pause-dispatch', model: 'fixture' } }, signal: new AbortController().signal })
  const actor = lease.localAgent!
  await run.setPhase('running', run.snapshot().revision)
  const wake = simulationWakeRequestSchema.parse({ id: 'undispatched-wake', entityId, time: '0', reason: 'Do work' })
  await run.scheduleWake(wake, run.snapshot().revision)
  await run.drive({ until: simTimeSchema.parse('0') })
  const id = simulationDecisionIdSchema.parse('undispatched-decision')
  const pause = () => run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'pause-before-agent', phase: 'paused' }))
  const originalPrepare = connection.prepareContext.bind(connection)
  const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
  let paused = false
  const prepare = vi.spyOn(connection, 'prepareContext').mockImplementation(async (...args) => {
    const result = await originalPrepare(...args)
    if (boundary === 'prepared' && args[1] === id) { paused = true; await pause() }
    return result
  })
  const flush = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (...args) => {
    const result = await originalFlush(...args)
    const decision = run.snapshot().decisions[id]
    const preparedInputId = decision?.context?.status === 'prepared' ? MessageId(decision.context.view.inputId) : undefined
    if (!paused && boundary === 'queued' && args[0] === actor.session && preparedInputId !== undefined
      && actor.inbox.nextTurn.some(message => message.id === preparedInputId)) {
      paused = true
      await pause()
    }
    return result
  })
  const cancelled = await connection.executeDecision(entityId, id, contextRequest(), wake.id)
  prepare.mockRestore(); flush.mockRestore()
  expect(paused).toBe(true)
  expect(cancelled).toMatchObject({ status: 'cancelled', cancellation: 'paused' })
  if (cancelled.context?.status !== 'prepared') throw new Error('Undispatched fixture lost its prepared context')
  const inputId = MessageId(cancelled.context.view.inputId)
  const oldConsumed = () => actor.session.events.filter(event => event.type === 'user/message' && event.surfaceOp === 'append'
    && event.data.id === inputId)
  expect(oldConsumed()).toHaveLength(0)
  expect(actor.inbox.nextTurn.some(message => message.id === inputId)).toBe(boundary === 'queued')
  expect(model.requests).toHaveLength(0)
  expect(run.budgetUsage().tokens.used).toBe(0)
  expect(run.snapshot().tokenReservations).toBeUndefined()
  expect(run.snapshot().wakes[wake.id]).toMatchObject({ status: 'pending' })
  const revision = run.snapshot().revision
  expect(await connection.executeDecision(entityId, id, contextRequest(), wake.id)).toEqual(cancelled)
  expect(run.snapshot().revision).toBe(revision)
  expect(model.requests).toHaveLength(0)
  await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'continue-before-agent', phase: 'running' }))
  const resumedId = simulationDecisionIdSchema.parse('fresh-resume-decision')
  expect((await connection.executeDecision(entityId, resumedId, contextRequest(), wake.id)).status).toBe('accepted')
  expect(model.requests).toHaveLength(3)
  expect(oldConsumed()).toHaveLength(0)
  expect([...actor.inbox.nextTurn, ...actor.inbox.nextStep].some(message => message.id === inputId)).toBe(false)
  expect(run.snapshot().wakes[wake.id]).toMatchObject({ status: 'completed', decisionId: resumedId })
})


it.each(['json', 'sqlite'] as const)('finishes a %s overrun immediately with its real usage instead of waiting for the deadline', async (backend) => {
  const { ctx, run, participant, entityId, connection } = await setup(backend, true)
  await ctx.plugin(ToolSimulation)
  const chunks = toolCallResponse('overrun-observe', 'simulation_observe', {}).map(chunk => chunk.type === 'usage'
    ? { type: 'usage' as const, usage: { inputTokens: 11295, cacheReadTokens: 14848, outputTokens: 847 } } : chunk)
  const model = new MockAdapter([chunks])
  ctx.llm.registerAdapter(['bounded-model'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'bounded-model', model: 'fixture' } }, signal: new AbortController().signal })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('overrun')
  const decision = await connection.executeDecision(entityId, id, contextRequest())
  expect(decision.status).toBe('cancelled')
  expect(decision.inference?.expiredAt).toBeUndefined()
  expect(run.snapshot().stall?.code).toBe('SIM_TOKEN_RESERVATION_EXCEEDED')
  expect(run.budgetUsage().tokens.used).toBe(26990)
  expect(model.requests).toHaveLength(1)
  expect(model.requests[0]?.maxTokens).toBe(512)
  expect(ctx.simulationTeams.modelUsage()).toMatchObject({ active: 0, queued: 0 })
})

it('refuses an oversized full envelope before invoking the provider or reserving charged tokens', async () => {
  const { ctx, run, participant, entityId, connection } = await setup('sqlite', true)
  await ctx.plugin(ToolSimulation)
  const model = new MockAdapter([])
  ctx.llm.registerAdapter(['bounded-model'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'bounded-model', model: 'fixture' } }, signal: new AbortController().signal })
  await run.setPhase('running', run.snapshot().revision)
  const context = contextRequest()
  const request = { ...context, sections: context.sections.map(section => section.kind === 'input' ? { ...section,
    blocks: [{ type: 'text' as const, text: 'Large required fact. '.repeat(2000) }] } : section) }
  const decision = await connection.executeDecision(entityId, simulationDecisionIdSchema.parse('too-large'), request)
  expect(decision).toMatchObject({ status: 'cancelled', requestBudgetBlock: { limit: 10000 } })
  expect(run.snapshot().stall?.code).toBe('SIM_REQUEST_BUDGET_EXCEEDED')
  expect(model.requests).toHaveLength(0)
  expect(run.budgetUsage().tokens.used).toBe(0)
})


it('settles an auxiliary summary overrun and closes its owning decision window without a deadline wait', async () => {
  const { ctx, run, participant, entityId, connection } = await setup('sqlite', true)
  await ctx.plugin(ToolSimulation)
  await ctx.plugin(BasicCompactionEngine, { thresholdTokens: 1, retainTokens: 0, maxTokens: 512 })
  const model = new MockAdapter([toolCallResponse('observe-before-summary', 'simulation_observe', {}), [
    { type: 'usage', usage: { inputTokens: 26990, outputTokens: 0 } }, { type: 'finish', reason: { kind: 'stop' } },
  ]])
  vi.spyOn(model, 'resolveModel').mockImplementation(async (provider, name) => ({
    provider, id: name, name, context: { contextWindow: 100000 } }))
  ctx.llm.registerAdapter(['bounded-model'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'bounded-model', model: 'fixture' } }, signal: new AbortController().signal })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('auxiliary-overrun'), window = simulationWindowIdSchema.parse('auxiliary-window')
  await connection.openWindow({ id: window, decisions: [{ id, entityId, context: contextRequest() }] })
  const decision = await connection.executeDecision(entityId, id, contextRequest())
  expect(decision.status).toBe('cancelled')
  expect(decision.inference?.expiredAt).toBeUndefined()
  expect(run.snapshot().activeWindowId).toBeUndefined()
  expect(run.snapshot().stall?.code).toBe('SIM_TOKEN_RESERVATION_EXCEEDED')
  expect(model.requests).toHaveLength(2)
  expect(model.requests[1]?.purpose).toBe('compaction')
  expect(Object.values(run.snapshot().tokenReservations ?? {}).find(value => value.compactionId !== undefined))
    .toMatchObject({ status: 'settled', overrunAcknowledged: false, usage: { inputTokens: 26990, outputTokens: 0 } })
})

it('terminates a canonical consumption error after one submit without another model request', async () => {
  const { ctx, run, participant, entityId, connection } = await setup('sqlite')
  await ctx.plugin(ToolSimulation)
  const model = new MockAdapter([toolCallResponse('stage', 'simulation_stage', { proposals: [] }),
    toolCallResponse('submit', 'simulation_submit', {})])
  ctx.llm.registerAdapter(['broken-consumption'], model)
  let writer: import('@clocky/clocky-simulation').SimulationWriterLease | undefined
  const reserve = run.reserveWriter.bind(run)
  vi.spyOn(run, 'reserveWriter').mockImplementationOnce(async (...args) => { writer = await reserve(...args); return writer })
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'broken-consumption', model: 'fixture' } }, signal: new AbortController().signal })
  if (writer === undefined) throw new Error('writer missing')
  const { SimulationContextIntegrityError } = await import('../src/integrity.ts')
  vi.spyOn(writer, 'recordContextConsumption').mockRejectedValue(new SimulationContextIntegrityError('Canonical consumption mismatch'))
  // Invoke the real attestation path even for this minimal non-World fixture.
  const submit = writer.submitDecision.bind(writer)
  vi.spyOn(writer, 'submitDecision').mockImplementation(async (...args) => { await writer!.recordContextConsumption(args[0]); return submit(...args) })
  await run.setPhase('running', run.snapshot().revision)
  const id = simulationDecisionIdSchema.parse('integrity-stop'), window = simulationWindowIdSchema.parse('integrity-window')
  await connection.openWindow({ id: window, decisions: [{ id, entityId, context: contextRequest() }] })
  expect((await connection.executeDecision(entityId, id, contextRequest())).status).toBe('cancelled')
  await lease.localAgent!.whenIdle()
  expect(run.snapshot()).toMatchObject({ phase: 'stalled', stall: { code: 'SIM_CONTEXT_INTEGRITY', decisionId: id } })
  expect(run.snapshot().activeWindowId).toBeUndefined()
  expect(model.requests).toHaveLength(2)
  const revision = run.snapshot().revision
  await connection.executeDecision(entityId, id, contextRequest())
  expect(run.snapshot().revision).toBe(revision)
  expect(model.requests).toHaveLength(2)
})

it.each(['json', 'sqlite'] as const)('atomically stops and closes a %s timed-out window while returning its wake', async (backend) => {
  const { run, connection, ctx, entityId, participant } = await setup(backend, false, 500)
  const model = new MockAdapter(['hang'])
  ctx.llm.registerAdapter(['timeout'], model)
  await connection.bind(entityId, participant.id)
  await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'timeout', model: 'fixture' } }, signal: new AbortController().signal })
  await run.setPhase('running', run.snapshot().revision)
  const wake = simulationWakeRequestSchema.parse({ id: 'timeout-wake', entityId, time: '0', reason: 'timeout test' })
  await run.scheduleWake(wake, run.snapshot().revision); await run.drive({ until: simTimeSchema.parse('0') })
  const id = simulationDecisionIdSchema.parse('timeout'), window = simulationWindowIdSchema.parse('timeout-window')
  await connection.openWindow({ id: window, decisions: [{ id, entityId, wakeId: wake.id, context: contextRequest() }] })
  const execution = connection.executeDecision(entityId, id, contextRequest(), wake.id)
  expect((await execution).cancellation).toBe('timeout')
  expect(run.snapshot()).toMatchObject({ phase: 'stalled', stall: { code: 'SIM_DECISION_TIMEOUT', decisionId: id } })
  expect(run.snapshot().activeWindowId).toBeUndefined()
  expect(run.snapshot().wakes[wake.id]?.status).toBe('pending')
  expect(model.requests).toHaveLength(1)
})

// The public driver observes the exact typed terminal event of the consumed decision input.
it.each(['json', 'sqlite'] as const)('preserves typed terminal provider facts through the decision owner (%s)', async (backend) => {
  const { ctx, run, connection, entityId, participant } = await setup(backend)
  class PaymentAdapter extends MockAdapter {
    override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      this.requests.push(options)
      yield* []
      throw new LlmError('private account body token=secret', 'UNKNOWN', { status: 402, providerRetryAfterMs: 1200 })
    }
  }
  ctx.llm.registerAdapter(['payment-error'], new PaymentAdapter([]))
  await connection.bind(entityId, participant.id)
  const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
    agent: { options: { provider: 'payment-error', model: 'fixture' } }, signal: new AbortController().signal })
  await run.setPhase('running', run.snapshot().revision)
  await expect(connection.executeDecision(entityId, simulationDecisionIdSchema.parse('payment-failed'), contextRequest()))
    .rejects.toMatchObject({ failure: { code: 'UNKNOWN', status: 402, providerRetryAfterMs: 1200 } })
  expect(lease.localAgent!.session.events.some(event => event.type === 'turn/end'
    && event.data.reason.kind === 'error' && event.data.reason.error.status === 402)).toBe(true)
})
