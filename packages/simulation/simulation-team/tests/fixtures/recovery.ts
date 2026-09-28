import { SessionId } from '@clocky/clocky-session'
import { channelIdSchema } from '@clocky/clocky-team'
import assert from 'node:assert/strict'
import type { GenerateOptions } from '@clocky/clocky-llm'
import { defineTool } from '@clocky/clocky-tools'
import { CallId } from '@clocky/clocky-llm'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { openTestChannel } from '../../../../core/team/tests/channel-lifecycle-authority.ts'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'
import { contextRequest } from '../../../simulation-local/tests/context-fixture.ts'
/** Real Loader process for epoch revocation and same-Session takeover after host death. */
import { boot } from '@clocky/clocky-app-boot'
import { openOutboxTarget } from './outbox-target.ts'
import { recoverScenario, recoveryCheckpoint } from './recovery-scenario.ts'
import { simulationChangeSchema, simulationDecisionIdSchema, simulationEntityIdSchema, simulationProposalSchema, simulationResourceSpecSchema, simulationRunSelectionSchema, simulationWakeRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../../core/team/tests/bootstrap-topology-authority.ts'

const ctx = await boot('simulation-writer-test', process.argv[2]!)
const mode = process.argv[3] === 'create' ? 'create' : 'open'
if (mode === 'open') {
  try { console.log(JSON.stringify(await recoverScenario(ctx, process.env['SIMULATION_TEST_ROOT']!, process.env['SIMULATION_TEST_CHECKPOINT_FIRST'] === 'true', process.env['SIMULATION_TEST_RESTORE_FIRST'] === 'true'))) }
  finally { await ctx.fiber.dispose() }
  process.exit(0)
}
const run = await ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode, spec: {
  runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
} }))
const entityId = simulationEntityIdSchema.parse('buyer')
const stage = process.argv[4] ?? 'bound'
const teamMessage = stage.startsWith('team-delivery-') || stage.startsWith('team-invitation-') || stage.startsWith('team-post-') || stage.startsWith('team-receive-')
let modelDispatched = false
function hold(): Promise<void> {
  process.send?.('durable')
  return new Promise<void>((resolve) => { process.once('message', () => { resolve() }) })
}
try {
  if (mode === 'create') {
    if (stage.startsWith('channel-')) {
      await ctx.plugin(Direct)
      const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Company bootstrap', budgets: {} }, budgets: {} }, 'simulation/company')
      const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/company')
      for (const id of ['buyer', 'supplier']) {
        const member = simulationEntityIdSchema.parse(id)
        await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: member, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
        await connection.ensureParticipant(member, { displayName: id, role: id, capabilities: [],
          provider: 'in-process', preset: 'simulation', model: 'mock/default' })
      }
      const open = ctx.teams.openChannel.bind(ctx.teams)
      ctx.teams.openChannel = async (request) => {
        if (stage === 'channel-reserved') await hold()
        const result = await open(request)
        if (stage === 'channel-attached') await hold()
        return result
      }
      if (stage === 'channel-wal') {
        const openStream = ctx.storageLog.open.bind(ctx.storageLog)
        ctx.storageLog.open = async (descriptor) => {
          const stream = await openStream(descriptor)
          if (descriptor.name.startsWith('channel/')) {
            const append = stream.append.bind(stream)
            stream.append = async (...args) => { const result = await append(...args); await hold(); return result }
          }
          return stream
        }
      }
      const acknowledge = ctx.teams.acknowledgeChannelInvitation.bind(ctx.teams)
      ctx.teams.acknowledgeChannelInvitation = async (request) => {
        const result = await acknowledge(request)
        if (stage === 'channel-consent' || stage === 'channel-admitted' && result.channel.phase === 'active') await hold()
        return result
      }
      const { simulationChannelSpecSchema } = await import('@clocky/clocky-simulation')
      await connection.ensureChannel(simulationChannelSpecSchema.parse({ key: 'purchase',
        members: [{ entityId: 'buyer', role: 'sender' }, { entityId: 'supplier', role: 'recipient' }], limits: {} }))
      await hold()
      throw new Error('Channel bootstrap crash barrier unexpectedly resumed')
    }
    if (stage.startsWith('participant-')) {
      const team = await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Company bootstrap', budgets: {} }, budgets: {} }, 'simulation/company')
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
      const connection = await ctx.simulationTeams.attach(run, team.team.id, 'simulation/company')
      const invite = ctx.teams.inviteParticipant.bind(ctx.teams)
      ctx.teams.inviteParticipant = async (request) => {
        if (stage === 'participant-reserved') await hold()
        const result = await invite(request)
        if (stage === 'participant-invited') await hold()
        return result
      }
      const transition = ctx.teams.transitionParticipantPhase.bind(ctx.teams)
      ctx.teams.transitionParticipantPhase = async (request) => {
        const result = await transition(request)
        if (stage === `participant-${request.phase}`) await hold()
        return result
      }
      await connection.ensureParticipant(entityId, { displayName: 'Buyer', role: 'buyer', capabilities: [],
        provider: 'in-process', preset: 'simulation', model: 'mock/default' })
      await hold()
      throw new Error('Participant bootstrap crash barrier unexpectedly resumed')
    }
    if (stage.startsWith('root-')) {
      const create = ctx.teams.createTeam.bind(ctx.teams)
      if (stage !== 'root-confirmed') ctx.teams.createTeam = async (request) => {
        if (stage === 'root-reserved') await hold()
        const result = await create(request)
        if (stage === 'root-created') await hold()
        return result
      }
      await ctx.simulationTeams.ensureTeam(run, { goal: { objective: 'Company bootstrap', budgets: {} }, budgets: {} }, 'simulation/company')
      await hold()
      throw new Error('Root bootstrap crash barrier unexpectedly resumed')
    }
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Company', budgets: {} },
      rules: { activationLifecycleOwner: 'simulation/company', simulationRunId: 'company' }, budgets: {} })
    const teamId = team.team.id
    const participant = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: team.team.cursor,
      kind: 'local-agent', displayName: 'Buyer', role: 'buyer', capabilities: [] })
    for (const phase of ['provisioning', 'active'] as const) {
      const state = await ctx.teams.getTeam({ teamId })
      await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id, expectedCursor: state.team.cursor, phase })
    }
    await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: entityId, entityKind: 'person', cognition: 'agent', profile: {} }), 0)
    const connection = await ctx.simulationTeams.attach(run, teamId, 'simulation/company')
    await connection.bind(entityId, participant.id)
    if (process.env['SIMULATION_TEST_RESTORE_FIRST'] === 'true') {
      assert.equal((await connection.checkpoint(recoveryCheckpoint)).status, 'completed')
    }
    if (stage === 'team-reserved') {
      const reserve = run.reserveWriter.bind(run)
      run.reserveWriter = async (...args) => { await hold(); return await reserve(...args) }
    } else if (stage === 'revoked') {
      const reserve = run.reserveWriter.bind(run)
      run.reserveWriter = async (...args) => {
        const writer = await reserve(...args)
        return { ...writer, revoke: async () => { await writer.revoke(); await hold() } }
      }
    } else if (stage === 'unpublished') {
      const provider = ctx.agentRuntimes.getProvider('in-process')
      if (provider === undefined) throw new Error('missing runtime provider')
      const activate = provider.activate.bind(provider)
      provider.activate = async (request) => {
        const handle = await activate(request)
        if (handle.localAgent === undefined) throw new Error('missing local Agent')
        await ctx.sessions.flush(handle.localAgent.session)
        await hold()
        return handle
      }
    }
    if (stage === 'context-consumed') ctx.llm.registerAdapter(['mock'], new class extends LlmAdapter {
      override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
      stream(): AsyncIterable<StreamChunk> {
        modelDispatched = true
        throw new Error('Model dispatched before the checkpoint crash barrier')
      }
    }())
    let modelRequestCount = 0
    if (stage.startsWith('model-')) ctx.llm.registerAdapter(['model-proposals'], new class extends LlmAdapter {
      override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (stage === 'model-role' && JSON.stringify(options.tools?.map(tool => tool.name).sort())
          !== JSON.stringify(['simulation_observe', 'simulation_stage', 'simulation_submit'])) {
          throw new Error(`Simulation preset tool set differs: ${JSON.stringify(options.tools?.map(tool => tool.name).sort())}`)
        }
        const index = modelRequestCount++
        if (index === 2 && stage === 'model-staged') await hold()
        const names = ['simulation_observe', 'simulation_stage', 'simulation_submit']
        const name = names[index]
        if (name === undefined) throw new Error('Simulation submit did not conclude its model turn')
        const args = index === 1 ? { proposals: [{ after: [], action: { kind: 'resource/transfer', grants: [], transaction: {
          commitmentId: null, reads: [{ resourceId: 'wallet', revision: 1 }, { resourceId: 'spent', revision: 1 }],
          transfers: [{ from: 'wallet', to: 'spent', quantity: '1' }],
        } } }] } : {}
        const id = CallId(`model-proposal-${index}`)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
    }())
    if (stage === 'model-role') ctx.tools.register(defineTool({ name: 'unrelated_probe', description: 'Must remain outside the role',
      parameters: {}, output: { schema: { type: 'boolean' }, render: () => [] },
      execute: () => Promise.reject(new Error('Simulation role invoked an unrelated tool')) }))
    const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { ...stage === 'model-role' ? { preset: 'simulation' } : {}, options: stage.startsWith('model-') ? { provider: 'model-proposals', model: 'fixture' }
        : stage === 'context-consumed' ? { provider: 'mock', model: 'mock' } : {} }, signal: new AbortController().signal })
    if (lease.localAgent === undefined) throw new Error('missing local Agent')
    await ctx.sessions.flush(lease.localAgent.session)
    if (stage.startsWith('model-')) {
      for (const [id, quantity] of [['wallet', '2'], ['spent', '0']]) {
        await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: entityId,
          kind: 'money', unit: 'cent', controllers: [entityId] }), run.snapshot().revision)
      }
      await run.setPhase('running', run.snapshot().revision)
      const id = simulationDecisionIdSchema.parse('model-decision')
      await connection.openDecision(entityId, id)
      await connection.prepareContext(entityId, id, contextRequest())
      await connection.dispatchDecision(entityId, id)
      await lease.localAgent.whenIdle()
      if (!['model-submitted', 'model-role'].includes(stage) || run.snapshot().decisions[id]?.status !== 'accepted') {
        console.error(JSON.stringify({ modelRequestCount, events: lease.localAgent.session.events.filter(event => event.type === 'turn/end' || event.type.includes('error')) }))
        throw new Error('Model proposals were not accepted')
      }
      await ctx.sessions.flush(lease.localAgent.session)
      await hold()
    }
    if (stage === 'context-prepared' || stage === 'context-queued' || stage === 'context-flushed' || stage === 'context-consumed') {
      await run.setPhase('running', run.snapshot().revision)
      const wake = simulationWakeRequestSchema.parse({ id: 'context-wake', entityId, time: '5', reason: 'Prepare a decision' })
      await run.scheduleWake(wake, run.snapshot().revision)
      await run.drive({ until: simTimeSchema.parse('5') })
      const id = simulationDecisionIdSchema.parse('context-decision')
      await connection.openDecision(entityId, id, wake.id)
      const prepared = await connection.prepareContext(entityId, id, contextRequest())
      if (prepared.status !== 'prepared') throw new Error('fixture context overflow')
      if (stage === 'context-queued' || stage === 'context-flushed' || stage === 'context-consumed') {
        if (stage === 'context-flushed') ctx.on('agent/pre-step', async (_payload, next) => {
          const decision = await next()
          await hold()
          return decision
        }, { prepend: true })
        if (stage === 'context-queued') {
          const flush = ctx.sessions.flush.bind(ctx.sessions)
          ctx.sessions.flush = async (session) => { const result = await flush(session); await hold(); return result }
        }
        if (stage === 'context-consumed') {
          const flush = ctx.sessions.flush.bind(ctx.sessions)
          ctx.sessions.flush = async (session) => {
            const result = await flush(session)
            if (session.events.some(event => event.type === 'request/header')) {
              if (modelDispatched || lease.localAgent?.status !== 'running') throw new Error('Request checkpoint missed its dispatch boundary')
              await hold()
            }
            return result
          }
        }
        await connection.dispatchDecision(entityId, id)
        await lease.localAgent.whenIdle()
        if (stage === 'context-consumed') throw new Error('Model turn ended without reaching the request checkpoint')
      }
    }
    if (stage === 'outbox-started' || stage === 'outbox-published' || stage === 'outbox-uncertain' || teamMessage) {
      const latest = await ctx.teams.getTeam({ teamId })
      const recipient = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: latest.team.cursor,
        kind: 'local-agent', displayName: 'Receiver', role: 'receiver', capabilities: [] })
      for (const phase of ['provisioning', 'active'] as const) {
        const current = await ctx.teams.getTeam({ teamId })
        await transitionBootstrapParticipant(ctx, { teamId, participantId: recipient.id, expectedCursor: current.team.cursor, phase })
      }
      const recipientId = simulationEntityIdSchema.parse('recipient')
      await run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: recipientId, entityKind: 'person', cognition: 'agent', profile: {} }), run.snapshot().revision)
      await connection.bind(recipientId, recipient.id)
      let targetChannel = 'fixture-channel'
      let recipientSession: string | undefined
      if (teamMessage) {
        await ctx.plugin(Direct)
        const state = await ctx.teams.getTeam({ teamId })
        const opened = await openTestChannel(ctx, { teamId, expectedCursor: state.team.cursor, adapter: Direct.DIRECT_CHANNEL_ADAPTER_V4,
          participants: [{ id: participant.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }], limits: {},
          invitations: [connection.invitation(entityId), connection.invitation(recipientId)] })
        await connection.acknowledgeInvitation(entityId, opened.manifest.id)
        if (stage === 'team-invitation-closing') {
          await lease.dispose()
          const entered = Promise.withResolvers<undefined>()
          ctx.teams.registerPolicy('channel-open', { name: 'hold-dormant-confirmation', async apply(_request, next) {
            entered.resolve(undefined)
            await new Promise<void>(() => {})
            return await next()
          } })
          const acknowledgement = connection.acknowledgeInvitation(recipientId, opened.manifest.id)
          void acknowledgement.catch((error: unknown) => { console.error(error); process.exit(1) })
          await entered.promise
          let closed = false
          const closing = run.close().then(() => { closed = true })
          void closing.catch((error: unknown) => { console.error(error); process.exit(1) })
          await new Promise(resolve => setImmediate(resolve))
          if (closed) throw new Error('Run released ownership before dormant invitation IO settled')
          await hold()
          throw new Error('Dormant shutdown crash barrier unexpectedly resumed')
        }
        targetChannel = (await connection.acknowledgeInvitation(recipientId, opened.manifest.id)).channel.manifest.id
        if (stage === 'team-invitation-acked') await hold()
        const receiver = await connection.activate(recipientId, { provider: 'in-process', seed: { kind: 'fresh' },
          agent: { options: {} }, signal: new AbortController().signal })

        recipientSession = receiver.binding.sessionId
        if (stage === 'team-post-published') await receiver.dispose()
      }
      await run.setPhase('running', run.snapshot().revision)
      const decisionId = simulationDecisionIdSchema.parse(teamMessage ? 'team-message' : 'message')
      await connection.openDecision(entityId, decisionId)
      const accepted = await connection.submitDecision(entityId, decisionId, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'communication/post', recipient: recipientId, channelId: targetChannel, text: 'Scheduled message', deliverAt: '5',
      } })])
      const id = accepted.operationIds[0]
      if (id === undefined) throw new Error('missing communication intent')
      if (stage === 'team-post-scheduled') {
        await assert.rejects(connection.dispatchOperation(id, () => 100), /not due/)
        const page = await ctx.teams.readChannel({ channelId: channelIdSchema.parse(targetChannel), afterCursor: -1 })
        assert.equal(page.records.some(record => record.type === 'channel/envelope'), false)
        const recipient = ctx.agents.get(SessionId(recipientSession!))
        assert.ok(recipient)
        assert.equal(JSON.stringify(recipient.session.events).includes('Scheduled message'), false)
        await hold()
      }
      await run.drive({ until: simTimeSchema.parse('5') })
      if (stage.startsWith('team-delivery-')) {
        await connection.dispatchOperation(id, () => 100)
        const { teamClosureIdempotencyKeySchema } = await import('@clocky/clocky-team')
        const actor = ctx.teams.openActivationActorProofIssuer().issue(lease.binding)
        const current = await ctx.teams.getTeam({ teamId })
        try {
          await ctx.teams.cancelTeam({ actor: actor.proof, teamId, expectedCursor: current.team.cursor,
            idempotencyKey: teamClosureIdempotencyKeySchema.parse('simulation-target-abandoned'),
            reason: { code: 'USER_CANCELLED', message: 'Cancel pending target delivery' } })
        } finally { actor.revoke() }
        if (stage === 'team-delivery-failed') await connection.drive({ until: simTimeSchema.parse('10') }, () => 100)
        await hold()
      }
      if (stage === 'team-post-published') {
        await lease.dispose()
        const post = ctx.teams.postChannelEnvelope.bind(ctx.teams)
        ctx.teams.postChannelEnvelope = async (request) => {
          const result = await post(request)
          await hold()
          return result
        }
        await connection.dispatchOperation(id, () => 100)
      }
      if (stage.startsWith('team-receive-')) {
        await lease.dispose()
        await connection.dispatchOperation(id, () => 100)
        let receiving = false
        if (stage === 'team-receive-claimed') {
          const claim = ctx.teams.claimChannelDelivery.bind(ctx.teams)
          ctx.teams.claimChannelDelivery = async (request) => {
            const result = await claim(request)
            if (receiving) await hold()
            return result
          }
        } else if (stage === 'team-receive-flushed') {
          const flush = ctx.sessions.flush.bind(ctx.sessions)
          ctx.sessions.flush = async (session) => {
            const result = await flush(session)
            if (receiving && session.id === recipientSession) await hold()
            return result
          }
        } else if (stage === 'team-receive-recorded') {
          const record = run.recordDelivery.bind(run)
          run.recordDelivery = async (...args) => { const result = await record(...args); if (receiving) await hold(); return result }
        } else if (stage === 'team-receive-acked') {
          const ack = ctx.teams.ackChannelEnvelope.bind(ctx.teams)
          ctx.teams.ackChannelEnvelope = async (request) => {
            const result = await ack(request)
            if (receiving) await hold()
            return result
          }
        }
        receiving = true
        try { await connection.receiveOperation(id) }
        finally { receiving = false }
        throw new Error('Recipient missed its crash barrier')
      }
      const target = await openOutboxTarget(process.env['SIMULATION_TEST_ROOT']!)
      try {
        await run.dispatchOperation(id, { post: async (message) => {
          if (stage === 'outbox-started') await hold()
          const outcome = await target.transport.post(message)
          if (stage === 'outbox-published') await hold()
          if (stage === 'outbox-uncertain') throw new Error('Lost response after target durability')
          return outcome
        } }, () => 100)
        if (stage === 'outbox-uncertain') await hold()
      } finally { await target.close() }
    }
    if (stage === 'scheduler-queued' || stage === 'scheduler-consumed' || stage === 'scheduler-claimed') {
      await run.setPhase('running', run.snapshot().revision)
      const wake = simulationWakeRequestSchema.parse({ id: 'wake-buyer', entityId, time: '5', reason: 'Scheduled work' })
      await run.scheduleWake(wake, run.snapshot().revision)
      if (stage !== 'scheduler-queued') await run.drive({ until: simTimeSchema.parse('5') })
      if (stage === 'scheduler-claimed') {
        await connection.openDecision(entityId, simulationDecisionIdSchema.parse('interrupted-decision'), wake.id)
      }
    }
    if (stage === 'business-accepted' || stage === 'business-applied' || stage === 'business-written') {
      for (const [id, quantity] of [['wallet', '100'], ['reserved', '0']]) {
        await run.createResource(simulationResourceSpecSchema.parse({ id, quantity, owner: entityId,
          kind: 'money', unit: 'cent', controllers: [entityId] }), run.snapshot().revision)
      }
      await run.setPhase('running', run.snapshot().revision)
      const decisionId = simulationDecisionIdSchema.parse('reserve-funds')
      await connection.openDecision(entityId, decisionId)
      if (stage === 'business-written') {
        const stream = (run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
        const append = stream.append.bind(stream)
        stream.append = async (...args) => {
          const result = await append(...args)
          if (args[1].some((value) => {
            const record = value as { kind?: string; change?: { kind?: string } }
            return record.kind === 'run/business' && record.change?.kind === 'decision/accepted'
          })) await hold()
          return result
        }
      }
      const decision = await connection.submitDecision(entityId, decisionId, [simulationProposalSchema.parse({ after: [], action: {
        kind: 'resource/transfer', grants: [], transaction: { commitmentId: null,
          reads: [{ resourceId: 'wallet', revision: 1 }, { resourceId: 'reserved', revision: 1 }],
          transfers: [{ from: 'wallet', to: 'reserved', quantity: '25' }],
        },
      } })])
      const operation = decision.operationIds[0]
      if (operation === undefined) throw new Error('missing accepted operation')
      if (stage === 'business-applied') await run.executeOperation(operation)
    }
    if (stage === 'revoked') await lease.dispose()
    else await hold()
  }
} catch (error: unknown) {
  console.error(error)
  throw error
} finally {
  await run.close()
  await ctx.fiber.dispose()
}
