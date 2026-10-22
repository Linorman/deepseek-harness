/** Two real model actors submit against one frozen resource snapshot in opposite completion orders. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationChannelSpecSchema, simulationChangeSchema, simulationContextRequestSchema,
  simulationDecisionIdSchema, simulationWindowIdSchema, simulationEntityIdSchema, simulationWakeRequestSchema, simulationEventIdSchema,
  simulationDispatchCandidateSchema, simulationDispatchSelectionRequestSchema, simulationBudgetGrantRequestSchema,
  simulationResourceSpecSchema, simulationRunSelectionSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-window', process.argv[2]!)
const recovering = process.env['SIMULATION_WINDOW_RECOVER'] === 'true'
const timeout = process.env['SIMULATION_WINDOW_TIMEOUT'] === 'true'
const expiryFailure = process.env['SIMULATION_EXPIRY_FAILURE'] === 'true'
const budgetLimited = process.env['SIMULATION_BUDGET_LIMIT'] === 'true'
const limited = process.env['SIMULATION_MODEL_LIMIT'] === '1'
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: recovering ? 'open' : 'create', spec: {
  runId: 'window', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: timeout ? 1000 : 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: budgetLimited ? 1 : 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceReservationHistory: 128,
  maxResourceQuantity: '10000', relationRules: [],
} }))
const release = Promise.withResolvers<undefined>()
if (expiryFailure) {
  const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
  const append = stream.append.bind(stream)
  stream.append = async (cursor, values, options) => {
    if (JSON.stringify(values).includes('decision/expired')) throw new Error('Expiry storage unavailable')
    return await append(cursor, values, options)
  }
  const warn = ctx.logger.warn.bind(ctx.logger)
  ctx.logger.warn = (...args) => {
    if (args[0] === 'Simulation deadline persistence failed') throw new Error('Logger unavailable')
    warn(...args)
  }
}
try {
  await (async () => {
    const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Allocate one unit', budgets: {} }, budgets: {} }, 'simulation/window')
    const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/window')
    const a = simulationEntityIdSchema.parse('a')
    const b = simulationEntityIdSchema.parse('b')
    const slow = process.env['SIMULATION_WINDOW_REVERSE'] === 'true' ? a : b
    const fast = slow === a ? b : a
    const started = Promise.withResolvers<undefined>()
    const calls = new Map<string, number>()
    let inFlight = 0
    let peak = 0
    ctx.llm.registerAdapter(['window'], new class extends LlmAdapter {
      async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
        const input = JSON.stringify(options.messages)
        const actor = input.includes('Actor a') ? a : b
        const index = calls.get(actor) ?? 0
        calls.set(actor, index + 1)
        inFlight += 1
        peak = Math.max(peak, inFlight)
        try {
          if (process.env['SIMULATION_WINDOW_CRASH'] === 'tokens' && actor === slow && index === 0) {
            process.send?.('durable')
            await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
          }
          if (actor === slow && index === 0) {
            started.resolve(undefined)
            if (timeout) {
              const signal = options.signal
              assert.ok(signal)
              await new Promise<void>((resolve, reject) => {
                if (signal.aborted) reject(new Error('Model request aborted', { cause: signal.reason }))
                else signal.addEventListener('abort', () => { reject(new Error('Model request aborted', { cause: signal.reason })) }, { once: true })
                void release.promise.then(resolve)
              })
            } else await release.promise
          }
          const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
          assert.ok(name)
          const args = JSON.stringify(index === 1 ? { proposals: [{ after: [], action: { kind: 'resource/transfer', grants: [],
            transaction: { commitmentId: null, reads: [{ resourceId: 'stock', revision: 1 }, { resourceId: `${actor}-stock`, revision: 1 }],
              transfers: [{ from: 'stock', to: `${actor}-stock`, quantity: '1' }] } } }] } : {})
          const id = CallId(`${actor}-${index}`)
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 1 } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
        } finally { inFlight -= 1 }
      }
    }())
    for (const entityId of [a, b]) {
      if (!recovering) await run.change(simulationChangeSchema.parse({ kind: 'entity/create', readiness: 'ready', id: entityId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
      await connection.ensureParticipant(entityId, { displayName: entityId, role: entityId, capabilities: [],
        provider: 'in-process', preset: 'simulation', model: 'window/scripted' })
      if (recovering) await connection.recover(entityId)
      await connection.activate(entityId, { provider: 'in-process', seed: { kind: recovering ? 'resume' : 'fresh' }, agent: {
        preset: 'simulation', options: { provider: 'window', model: 'scripted' } }, signal: new AbortController().signal })
      if (!recovering) await run.createResource(simulationResourceSpecSchema.parse({ id: `${entityId}-stock`, owner: entityId,
        kind: 'inventory', unit: 'item', quantity: '0', controllers: [entityId] }), run.snapshot().revision)
    }
    if (!recovering) await run.createResource(simulationResourceSpecSchema.parse({ id: 'stock', owner: a, kind: 'inventory', unit: 'item', quantity: '1', controllers: [a, b] }), run.snapshot().revision)
    const interrupted = run.snapshot().activeWindowId
    if (interrupted !== undefined) await run.commitWindow(interrupted)
    const budgetGrant = simulationBudgetGrantRequestSchema.parse({ id: 'window-budget', interval: '0',
      budget: 'decisions', amount: 1, reason: 'Allow the two-actor window' })
    if (run.snapshot().stall?.code === 'SIM_BUDGET_LIMIT') {
      await assert.rejects(run.setPhase('running', run.snapshot().revision), /explicit addition/)
      assert.equal(run.budgetUsage().decisions.used, 0)
      await run.extendBudget(budgetGrant, run.snapshot().revision)
      await run.extendBudget(budgetGrant, 0)
      assert.deepEqual(run.budgetUsage().decisions, { used: 0, limit: 2 })
    }
    await run.setPhase('running', run.snapshot().revision)
    const wakeId = (entityId: typeof a) => simulationEventIdSchema.parse(`wake/${entityId}`)
    if (!recovering) {
      for (const entityId of [a, b]) await run.scheduleWake(simulationWakeRequestSchema.parse({
        id: wakeId(entityId), entityId, time: '0', reason: 'Allocate one inventory unit',
      }), run.snapshot().revision)
      assert.equal((await run.drive({ until: simTimeSchema.parse('0') })).reason, 'decision-required')
      assert.equal(Object.values(run.snapshot().wakes).length, 1)
      if (process.env['SIMULATION_WINDOW_CRASH'] === 'cohort') {
        process.send?.('durable')
        await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
      }
    }
    assert.equal((await run.collectDecisionWakes({ until: simTimeSchema.parse('0') })).reason, 'decision-required')
    assert.equal(Object.values(run.snapshot().wakes).length, 2)
    const context = (entityId: typeof a) => simulationContextRequestSchema.parse({ maxBytes: 65536, teamCursor: 0,
      personaVersion: 'window-1', modelVersion: 'scripted-1',
      sources: [{ kind: 'run-event', runId: run.snapshot().spec.runId, sequence: run.snapshot().revision }],
      sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
        blocks: [{ type: 'text', text: kind === 'identity' ? `Actor ${entityId}` : kind === 'input'
          ? 'Stock quantity 1, revision 1; your destination quantity 0, revision 1.' : kind }] })),
    })
    const reserved = run.snapshot().decisionDispatch?.active
    const retry = recovering && reserved === undefined && Object.keys(run.snapshot().decisionDispatch?.selections ?? {}).length > 0
    const decisionId = (entityId: typeof a) => simulationDecisionIdSchema.parse(retry ? `${entityId}/retry` : entityId)
    for (const entityId of [b, a]) await run.queueDecision(simulationDispatchCandidateSchema.parse({
      id: decisionId(entityId), entityId, priority: entityId === a ? 10 : 0, wakeId: wakeId(entityId),
    }))
    if (run.snapshot().decisionDispatch?.active === undefined) {
      const beforeAllocation = run.snapshot()
      await assert.rejects(connection.openDecision(a, simulationDecisionIdSchema.parse('manual-bypass'), wakeId(a)), /reserved window/)
      await assert.rejects(connection.openWindow({ id: simulationWindowIdSchema.parse('manual-bypass-window'), decisions: [{
        id: simulationDecisionIdSchema.parse('manual-window-bypass'), entityId: a, wakeId: wakeId(a), context: context(a),
      }] }), /reserved window/)
      assert.deepEqual(run.snapshot(), beforeAllocation)
    }
    const allocationRequest = simulationDispatchSelectionRequestSchema.parse({ id: retry ? 'purchase/retry' : 'purchase', limit: 2 })
    const allocation = await run.reserveDecisionWindow(allocationRequest, run.snapshot().revision)
    assert.deepEqual(allocation?.decisions, [decisionId(a), decisionId(b)])
    assert.equal(allocation.round, retry ? '1' : '0')
    if (process.env['SIMULATION_WINDOW_CRASH'] === 'reserved') {
      process.send?.('durable')
      await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
    }
    const windowRequest = { id: allocationRequest.id, decisions: allocation.decisions.map((id) => {
      const entityId = run.snapshot().decisionDispatch!.tickets[id]!.candidate.entityId
      return { entityId, id, wakeId: wakeId(entityId), context: context(entityId) }
    }) }
    if (budgetLimited && !recovering) {
      await assert.rejects(connection.openWindow(windowRequest), /decisions interval budget/)
      assert.equal(run.snapshot().stall?.code, 'SIM_BUDGET_LIMIT')
      assert.equal(run.budgetUsage().decisions.used, 0)
      assert.equal(calls.size, 0)
      if (process.env['SIMULATION_WINDOW_CRASH'] === 'budget') {
        process.send?.('durable')
        await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
      }
      await run.extendBudget(budgetGrant, run.snapshot().revision)
      await run.setPhase('running', run.snapshot().revision)
    }
    const opened = await connection.openWindow(windowRequest)
    const delayed = connection.executeDecision(slow, decisionId(slow), context(slow), wakeId(slow))
    const rejectedExpiry = expiryFailure ? assert.rejects(delayed, /without submitting/) : undefined
    await started.promise
    const waiting = connection.executeDecision(fast, decisionId(fast), context(fast), wakeId(fast))
    if (limited) {
      const until = Date.now() + 5000
      while (ctx.simulationTeams.modelUsage().queued !== 1) {
        if (Date.now() >= until) throw new Error('Second model request did not enter the capacity queue')
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      assert.equal(ctx.simulationTeams.modelUsage().active, 1)
      if (process.env['SIMULATION_MODEL_CLOSE'] === 'true') {
        const outcomes = Promise.allSettled([delayed, waiting])
        let closed = false
        const closing = connection.close().then(() => { closed = true })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(closed, false)
        assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 1, queued: 0, limit: 1, queueLimit: 16 })
        release.resolve(undefined)
        await closing
        assert.ok((await outcomes).every(outcome => outcome.status === 'rejected'))
        assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 0, queued: 0, limit: 1, queueLimit: 16 })
        console.log(JSON.stringify({ closed: true, releasedAfterModelExit: true,
          modelCalls: [...calls.values()].reduce((sum, count) => sum + count, 0),
          capacity: ctx.simulationTeams.modelUsage() }))
        return
      }
      release.resolve(undefined)
    }
    const early = await waiting
    if (limited) await delayed
    assert.equal(early.status, 'submitted')
    const actor = ctx.agents.get(run.snapshot().entities[fast]!.binding!.sessionId)
    const result = actor?.session.events.findLast(event => event.type === 'tool/result')
    assert.ok(result?.type === 'tool/result')
    const text = result.data.message.content[0].content.find(block => block.type === 'text')
    assert.ok(text?.type === 'text')
    const submission: unknown = JSON.parse(text.text)
    assert.deepEqual(submission, { status: 'submitted', operationIds: [], effects: 'pending' })
    if (process.env['SIMULATION_WINDOW_CRASH'] === 'submitted') {
      process.send?.('durable')
      await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
    }
    assert.equal(early.operationIds.length, 0)
    if (!limited) {
      assert.equal((await run.commitWindow(opened.id)).status, 'collecting')
      assert.equal((await run.drive({ until: simTimeSchema.parse('1') })).reason, 'decision-required')
      const partial = Object.values(run.snapshot().operations)[0]
      if (partial !== undefined) await assert.rejects(run.executeOperation(partial.id), /window to close/)
      await run.setPhase('paused', run.snapshot().revision)
      await assert.rejects(connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'late-channel',
        members: [{ entityId: a, role: 'a' }, { entityId: b, role: 'b' }], limits: {} })), /reservation requires/)
      await run.setPhase('running', run.snapshot().revision)
    }
    if (!timeout) release.resolve(undefined)
    if (expiryFailure) {
      await rejectedExpiry
      const failed = run.snapshot().decisions[decisionId(slow)]!
      assert.equal(failed.status, 'open')
      assert.equal(failed.inference?.expiredAt, undefined)
    }
    const completed = expiryFailure ? await connection.cancelDecision(slow, decisionId(slow)) : await delayed
    assert.equal(completed.status, timeout ? 'cancelled' : 'submitted')
    if (timeout && !expiryFailure) {
      assert.equal(completed.cancellation, 'timeout')
      assert.ok(completed.inference?.expiredAt !== undefined && completed.inference.expiredAt >= completed.inference.deadline)
      if (process.env['SIMULATION_WINDOW_CRASH'] === 'expired') {
        process.send?.('durable')
        await new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
      }
    }
    assert.equal((await run.commitWindow(opened.id)).status, 'closed')
    await run.drive({ until: simTimeSchema.parse('0') })
    const state = run.snapshot()
    assert.equal(peak, limited ? 1 : 2)
    assert.deepEqual(ctx.simulationTeams.modelUsage(), { active: 0, queued: 0, limit: limited ? 1 : 2, queueLimit: 16 })
    assert.equal(new Set(Object.values(state.decisions).filter(decision => decision.windowId === opened.id)
      .map(decision => decision.snapshotRevision)).size, 1)
    const tokenAttempts = Object.values(state.tokenReservations ?? {})
    assert.equal(tokenAttempts.filter(value => value.status === 'settled').every(value => value.usage?.cacheReadTokens === 3), true)
    console.log(JSON.stringify({ ...expiryFailure ? { expiryWriteFailed: true } : {}, tokens: run.budgetUsage().tokens,
      tokenAttempts: Object.fromEntries(['reserved', 'unknown', 'settled', 'not-dispatched'].map(status => [status, tokenAttempts.filter(value => value.status === status).length])),
      peakModelConcurrency: peak, window: state.windows?.[opened.id]?.status, submission,
      modelRequests: [calls.get(a), calls.get(b)],
      decisions: Object.values(state.decisions).map(({ id, slot, status, cancellation }) => ({ id, slot, status,
        ...cancellation === undefined ? {} : { cancellation } })),
      operations: Object.values(state.operations).map(({ entityId, result }) => ({ entityId, status: result?.status, code: result?.code })),
      resources: Object.values(state.resources).map(({ id, quantity }) => ({ id, quantity })) }))
  })()
} finally { release.resolve(undefined); await run.close(); await ctx.fiber.dispose() }
