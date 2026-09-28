/** Real composition close drains admitted scheduling and committed message publication replies. @module */
import assert from 'node:assert/strict'
import { CallId, LlmAdapter, MessageId, createUserMessage } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'
import type { Agent } from '@clocky/clocky-agent'
import { boot } from '@clocky/clocky-app-boot'
import { simulationRunSelectionSchema, simTimeSchema, simulationChangeSchema, simulationEntityIdSchema,
  simulationChannelSpecSchema, simulationDecisionIdSchema, simulationProposalSchema, simulationContextRequestSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

const ctx = await boot('simulation-drive-close', process.argv[2]!)
const lifecycle = process.env['SIMULATION_CLOSE_LIFECYCLE'] ?? ''
assert.ok(['', 'receive', 'recover', 'service'].includes(lifecycle))
const inputMode = process.env['SIMULATION_CLOSE_INPUT'] ?? ''
const checkpointMode = process.env['SIMULATION_CLOSE_CHECKPOINT'] === 'true'
const requestDrift = process.env['SIMULATION_MODEL_DRIFT'] ?? 'conversation'
assert.ok(['conversation', 'config', 'system', 'tools'].includes(requestDrift))
assert.ok(['', 'queued', 'consumed', 'completed', 'drift'].includes(inputMode))
let modelCalls = 0
ctx.on('llm/stream', (_request, next) => {
  modelCalls += 1
  if (inputMode !== 'consumed' && inputMode !== 'completed') throw new Error('Teardown scenario attempted inference')
  return next()
})
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'drive-close', tickUnit: 'hour', origin: '0', maxTime: '1', rulesVersion: '1', policyVersion: '1',
  outboxMaxAttempts: 1, outboxRetryDelayMs: 0, maxDriveSteps: 1, maxMicrostepsPerTime: 2,
  phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 5000, maxConflictRetries: 0,
  maxIngressBytes: 4096, maxEntities: 2, maxResidentActors: 1, maxDecisionsPerWindow: 1,
  maxOperationsPerDecision: 1, maxResourceQuantity: '1', maxQueuedDecisions: 1, maxDispatchWaitRounds: 1,
  budgetInterval: '100', maxDecisionsPerInterval: 1, maxMessagesPerInterval: 1, maxTokensPerInterval: inputMode ? 100 : 0, tokensPerModelRequest: 10,
  maxPendingEvents: 2, maxPendingInteractions: 0, maxKnowledgeBytes: 4096, maxKnowledgePerQuery: 1, relationRules: [],
} }))
let other: import('@clocky/clocky-simulation').SimulationRun | undefined
let checkpoint: import('@clocky/clocky-simulation-team').SimulationCheckpointCollection | undefined
try {
  const service = ctx.simulationTeams
  const { default: SimulationTeams } = await import('@clocky/clocky-simulation-team')
  const runtime = ctx.registry.get(SimulationTeams)
  assert.ok(runtime)
  const [serviceFiber] = runtime.fibers
  assert.ok(serviceFiber)
  const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Drain admitted scheduling', budgets: {} }, budgets: {} },
    'simulation/drive-close')
  const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/drive-close')
  const outbound = process.env['SIMULATION_CLOSE_OUTBOX'] === 'true'
  const drive = run.drive.bind(run)
  const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  const fails = process.env['SIMULATION_DRIVE_FAILURE'] === 'true'
  let result: Promise<string>
  let messages = 0
  let channelId: import('@clocky/clocky-team').ChannelId | undefined
  let inputAgent: Agent | undefined
  let inputId: MessageId | undefined
  let protectedRevision: number | undefined
  if (lifecycle === 'service') {
    other = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
      spec: { ...run.snapshot().spec, runId: 'pending-bootstrap' } }))
    await run.setPhase('running', run.snapshot().revision)
    protectedRevision = run.snapshot().revision
    const reserve = other.reserveTeam.bind(other)
    other.reserveTeam = async (...args) => {
      const reserved = await reserve(...args)
      entered.resolve(undefined)
      await release.promise
      if (fails) throw new Error('Bootstrap reservation response lost')
      return reserved
    }
    result = service.ensureTeam(other, { goal: { objective: 'Pending bootstrap', budgets: {} }, budgets: {} },
      'simulation/pending-bootstrap').then(() => 'unexpected-bootstrap', (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, fails ? /Bootstrap reservation response lost/ : /retired before Team creation/)
      return fails ? 'bootstrap-response-lost' : 'closed-bootstrap'
    })
  } else if (inputMode) {
    ctx.llm.registerAdapter(['close-input'], new class extends LlmAdapter {
      async *stream(): AsyncGenerator<StreamChunk> {
        if (inputMode === 'completed') {
          assert.ok(modelCalls <= 2)
          const name = modelCalls === 1 ? 'simulation_stage' : 'simulation_submit'
          const args = JSON.stringify(modelCalls === 1 ? { proposals: [] } : {})
          const id = CallId(`close-${modelCalls}`)
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
          yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Observed' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Observed' } }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    const entity = simulationEntityIdSchema.parse('observer')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entity, entityKind: 'person', cognition: 'agent', profile: {} }),
      run.snapshot().revision)
    await connection.ensureParticipant(entity, { displayName: 'Observer', role: 'observer', capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'close-input/scripted' })
    if (inputMode === 'drift') {
      const reserve = run.reserveWriter.bind(run)
      run.reserveWriter = async (...args) => {
        const writer = await reserve(...args)
        const tokens = writer.reserveModelTokens.bind(writer)
        writer.reserveModelTokens = async (...request) => {
          const reservation = await tokens(...request)
          assert.ok(inputAgent)
          if (requestDrift === 'conversation') {
            inputAgent.session.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'concurrent-context' },
              content: [{ type: 'text', text: 'Concurrent recorded context' }] }), { surfaceOp: 'append' })
          } else {
            const header = inputAgent.session.requestHeader()
            assert.ok(header)
            const replacement = requestDrift === 'config'
              ? { ...header, config: { ...header.config, maxTokens: (header.config.maxTokens ?? 256) + 1 } }
              : requestDrift === 'system' ? { ...header, system: 'Changed after request assembly' }
                : { ...header, tools: [{ name: 'different_tool', description: 'Different capability', parameters: { type: 'object' } }] }
            inputAgent.session.append('request/header', { header: replacement, reason: 'change' })
          }
          return reservation
        }
        return writer
      }
    }
    const lease = await connection.activate(entity, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'close-input', model: 'scripted' } }, signal: new AbortController().signal })
    assert.ok(lease.localAgent)
    inputAgent = lease.localAgent
    await run.setPhase('running', run.snapshot().revision)
    const id = simulationDecisionIdSchema.parse('observe')
    await connection.openDecision(entity, id)
    const context = simulationContextRequestSchema.parse({ maxBytes: 4096, teamCursor: 0,
      personaVersion: 'observer-1', modelVersion: 'scripted', sources: [],
      sections: ['identity', 'authority', 'input', 'goals', 'commitments'].map(kind => ({ kind, required: true,
        blocks: [{ type: 'text', text: 'Observe only; no world changes.' }] })),
    })
    const prepared = await connection.prepareContext(entity, id, context)
    assert.equal(prepared.status, 'prepared')
    if (prepared.status !== 'prepared') throw new Error('Fixture input exceeds context budget')
    inputId = MessageId(prepared.view.inputId)
    if (inputMode === 'consumed' || inputMode === 'drift') {
      await connection.dispatchDecision(entity, id)
      await inputAgent.whenIdle()
      if (inputMode === 'consumed') {
        const tokens = run.budgetUsage().tokens.used
        const consume = async () => {
          for await (const _chunk of ctx.llm.stream({ provider: 'close-input', model: 'scripted', sessionId: inputAgent!.session.id,
            messages: inputAgent!.session.deriveMessages() })) { /* Drain an incorrectly admitted stream. */ }
        }
        await assert.rejects(consume(), /active Agent turn/)
        inputAgent.send(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Unrelated later turn' }] }), 'next-turn', true)
        await inputAgent.whenIdle()
        assert.equal(modelCalls, 1)
        assert.equal(run.budgetUsage().tokens.used, tokens)
      } else {
        assert.equal(modelCalls, 0)
        assert.deepEqual(Object.values(run.snapshot().tokenReservations ?? {}).map(value => value.status), ['not-dispatched'])
      }
    }
    if (inputMode === 'completed') assert.equal((await connection.executeDecision(entity, id, context)).status, 'accepted')
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    let calls = 0
    ctx.sessions.flush = async (session) => {
      if (++calls === (inputMode === 'completed' ? 2 : 1)) {
        entered.resolve(undefined)
        await release.promise
        if (fails) throw new Error('Input flush unavailable')
      }
      return await flush(session)
    }
    result = (inputMode === 'completed' ? connection.executeDecision(entity, id, context)
      : connection.dispatchDecision(entity, id)).then(value => value.status, (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, fails ? /Input flush unavailable/
        : checkpointMode ? /checkpoint collection blocks/ : /connection is closed/)
      return fails ? 'input-flush-failure' : checkpointMode ? 'checkpoint-input' : 'closed-input'
    })
  } else if (lifecycle === 'recover') {
    const entity = simulationEntityIdSchema.parse('recovering')
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entity, entityKind: 'person', cognition: 'agent', profile: {} }),
      run.snapshot().revision)
    await connection.ensureParticipant(entity, { displayName: 'Recovering', role: 'observer', capabilities: [],
      provider: 'in-process', preset: 'simulation', model: 'unused' })
    const read = ctx.teams.getTeam.bind(ctx.teams)
    let held = false
    ctx.teams.getTeam = async (request) => {
      if (!held) {
        held = true
        entered.resolve(undefined)
        await release.promise
        if (fails) throw new Error('Recovery discovery unavailable')
      }
      return await read(request)
    }
    result = connection.recover(entity).then(() => 'unexpected-recovery', (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, fails ? /Recovery discovery unavailable/ : /connection is closed/)
      return fails ? 'recovery-read-failure' : 'closed-recovery'
    })
  } else if (outbound || lifecycle === 'receive') {
    const sender = simulationEntityIdSchema.parse('sender'), recipient = simulationEntityIdSchema.parse('recipient')
    for (const id of [sender, recipient]) {
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', profile: {} }),
        run.snapshot().revision)
      await connection.ensureParticipant(id, { displayName: id, role: id, capabilities: [],
        provider: 'in-process', preset: 'simulation', model: 'unused' })
    }
    const channel = await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'message',
      members: [{ entityId: sender, role: 'sender' }, { entityId: recipient, role: 'recipient' }], limits: {} }))
    channelId = channel.manifest.id
    await connection.activate(sender, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
    await run.setPhase('running', run.snapshot().revision)
    const id = simulationDecisionIdSchema.parse('post')
    await connection.openDecision(sender, id)
    const decision = await connection.submitDecision(sender, id, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'communication/post', recipient, channelId, text: 'Retain this publication', deliverAt: '0',
    } })])
    await run.drive({ until: simTimeSchema.parse('1') })
    if (lifecycle === 'receive') {
      await connection.hibernate(sender)
      await connection.activate(recipient, { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { preset: 'simulation', options: {} }, signal: new AbortController().signal })
      await connection.dispatchOperation(decision.operationIds[0]!, () => 0)
      const read = ctx.teams.readChannelPage.bind(ctx.teams)
      let held = false
      ctx.teams.readChannelPage = async (request) => {
        if (!held) {
          held = true
          entered.resolve(undefined)
          await release.promise
          if (fails) throw new Error('Recipient discovery unavailable')
        }
        return await read(request)
      }
      result = connection.receiveOperation(decision.operationIds[0]!).then(() => 'unexpected-receipt', (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, fails ? /Recipient discovery unavailable/ : /authority is no longer current/)
        return fails ? 'recipient-read-failure' : 'closed-recipient'
      })
    } else {
      const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
      ctx.teams.postChannelEnvelope = async (request) => {
        const envelope = await post(request)
        entered.resolve(undefined)
        await release.promise
        if (fails) throw new Error('Post response lost')
        return envelope
      }
      result = connection.dispatchOperation(decision.operationIds[0]!, () => 0).then(value => value.status)
    }
  } else {
    await run.setPhase('running', run.snapshot().revision)
    run.drive = async (request) => {
      entered.resolve(undefined)
      await release.promise
      if (fails) throw new Error('Drive storage unavailable')
      return await drive(request)
    }
    result = connection.drive({ until: simTimeSchema.parse('1') }, () => 0).then(value => value.reason, (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Drive storage unavailable')
      return 'storage-failure'
    })
  }
  await entered.promise
  let closed = false
  const closing = (checkpointMode ? connection.collectCheckpointCandidate(4, 2).then((candidate) => { checkpoint = candidate })
    : lifecycle === 'service' ? serviceFiber.dispose() : connection.close()).then(() => { closed = true })
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(closed, false)
    if (lifecycle === 'service') {
      assert.throws(() => connection.drive({ until: simTimeSchema.parse('1') }, () => 0), /service is closed/)
      assert.equal(run.snapshot().revision, protectedRevision)
    }
  } finally { release.resolve(undefined); await closing }
  assert.equal(await result, lifecycle === 'service' ? fails ? 'bootstrap-response-lost' : 'closed-bootstrap'
    : lifecycle === 'receive' ? fails ? 'recipient-read-failure' : 'closed-recipient'
      : lifecycle === 'recover' ? fails ? 'recovery-read-failure' : 'closed-recovery' : inputMode ? fails ? 'input-flush-failure' : checkpointMode ? 'checkpoint-input' : 'closed-input' : outbound ? fails ? 'outcome-unknown' : 'settled' : fails ? 'storage-failure' : 'until')
  if (channelId !== undefined) {
    messages = (await ctx.teams.readChannel({ channelId, afterCursor: -1 })).records.filter(record => record.type === 'channel/envelope').length
    assert.equal(messages, 1)
  }
  assert.throws(() => connection.drive({ until: simTimeSchema.parse('1') }, () => 0), checkpointMode ? /checkpoint collection blocks/ : /closed/)
  if (checkpoint !== undefined) await checkpoint.validate()
  assert.equal(modelCalls, inputMode === 'completed' ? 2 : inputMode === 'consumed' ? 1 : 0)
  if (inputMode === 'completed') assert.equal(run.snapshot().decisions[simulationDecisionIdSchema.parse('observe')]?.status, 'accepted')
  if (inputAgent !== undefined) assert.equal(inputAgent.session.events
    .filter(event => event.type === 'user/message' && event.data.id === inputId).length, ['consumed', 'completed', 'drift'].includes(inputMode) ? 1 : 0)
  console.log(JSON.stringify({ closeWaited: true, driveResult: await result, closedAdmission: true, modelCalls, messages,
    ...inputMode === 'consumed' ? { unownedInferenceRejected: true } : {},
    ...inputMode === 'drift' ? { requestDriftRejected: requestDrift } : {},
  }))
} finally { checkpoint?.release(); await other?.close(); await run.close(); await ctx.fiber.dispose() }
