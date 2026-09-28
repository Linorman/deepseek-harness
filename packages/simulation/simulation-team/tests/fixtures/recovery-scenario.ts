import assert from 'node:assert/strict'
import { TeamError } from '@clocky/clocky-team'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, Message, StreamChunk } from '@clocky/clocky-llm'
import { contextRequest } from '../../../simulation-local/tests/context-fixture.ts'
import { MessageId } from '@clocky/clocky-llm'
/** Shared recovery assertions for instrumented source and real artifact processes. */
import { openOutboxTarget } from './outbox-target.ts'
import type { Context } from '@clocky/cordis'
import { simulationChangeSchema, simulationEntityIdSchema, simulationRunSelectionSchema, simulationDecisionIdSchema, simulationEventIdSchema, simulationProposalSchema, simTimeSchema, simulationCheckpointRequestSchema } from '@clocky/clocky-simulation'
import type {} from '@clocky/clocky-simulation-team'

/** Stable manifest retained before the child activation starts. */
export const recoveryCheckpoint = simulationCheckpointRequestSchema.parse({ id: 'before-activation', implementationVersion: 'recovery-1',
  maxDrainRounds: 4, maxAttempts: 3 })

/** Execute the same recovery commands in the parent test or a fresh Loader process. */
export async function recoverScenario(ctx: Context, root: string, checkpointFirst = false, restoreFirst = false) {
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'open', spec: {
    runId: 'company', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
  } })
  let restoreCalls = 0
  const stopObserving = ctx.on('llm/stream', (_options, next) => { restoreCalls += 1; return next() })
  let restored: import('@clocky/clocky-simulation-team').SimulationCheckpointRestoration | undefined
  try {
    if (restoreFirst) restored = await ctx.simulationTeams.restore(selection, { id: recoveryCheckpoint.id,
      implementationVersion: recoveryCheckpoint.implementationVersion, maxAttempts: recoveryCheckpoint.maxAttempts })
  } finally { stopObserving() }
  const run = restored?.run ?? await ctx.simulations.open(selection)
  const entityId = simulationEntityIdSchema.parse('buyer')
  try {
    if (restored !== undefined) {
      assert.equal(restoreCalls, 0)
      assert.equal(run.snapshot().phase, 'paused')
      assert.equal(run.population().chargedActors, 0)
      const team = await ctx.teams.getTeam({ teamId: restored.manifest.team.owner.teamId })
      assert.ok(team.activations.every(binding => binding.quiescedAt !== undefined))
      assert.ok(team.participants.every(participant => participant.activationReservation === undefined
        || participant.activationReservation.releasedAt !== undefined
        || team.activations.some(binding => binding.reservationId === participant.activationReservation?.id)))
    }
    const reserved = run.snapshot().teamReservation
    if (reserved !== undefined && Object.keys(run.snapshot().entities).length === 0) {
      const { rules: _rules, ...creation } = reserved.creation
      const team = await ctx.simulationTeams.ensureTeam(run, creation, 'simulation/company')
      return { bootstrap: { identityPreserved: team.team.id === reserved.teamId,
        confirmed: run.snapshot().teamReservation?.confirmed, objective: team.goal.objective,
        creator: team.team.createdBy, teamCount: (await ctx.teams.listTeamsPage({ afterCursor: -1, limit: 10 })).items.length } }
    }
    const old = run.snapshot().entities[entityId]
    const channelReservation = Object.values(run.snapshot().channelReservations ?? {})[0]
    if (channelReservation !== undefined) {
      await ctx.plugin(Direct)
      if (reserved === undefined) throw new Error('Channel bootstrap lost its canonical Team')
      const connection = await ctx.simulationTeams.attach(run, reserved.teamId, 'simulation/company')
      const channel = await connection.ensureChannel(channelReservation.spec)
      const repeated = await connection.ensureChannel(channelReservation.spec)
      const team = await ctx.teams.getTeam({ teamId: reserved.teamId })
      const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
      return { channelBootstrap: { identityPreserved: channel.manifest.id === channelReservation.channelId,
        retryPreserved: repeated.manifest.id === channel.manifest.id, phase: channel.phase,
        channelCount: team.channelIds.length, activationCount: team.activations.length,
        confirmed: run.snapshot().channelReservations?.[channelReservation.spec.key]?.confirmed,
        invitations: admission.invitations.map(invitation => ({ status: invitation.status, required: invitation.required,
          canonicalSession: Object.values(run.snapshot().entities)
            .some(entity => invitation.endpoint.kind === 'activation' && entity.binding?.participantId === invitation.participantId
              && entity.binding.sessionId === invitation.endpoint.sessionId) })) } }
    }
    if (old?.participantReservation !== undefined && old.writer === undefined) {
      const reservation = old.participantReservation
      const connection = await ctx.simulationTeams.attach(run, reservation.binding.teamId, 'simulation/company')
      const binding = await connection.ensureParticipant(entityId, reservation.participant)
      const repeated = await connection.ensureParticipant(entityId, reservation.participant)
      const state = await ctx.teams.getTeam({ teamId: binding.teamId })
      return { participantBootstrap: { participantPreserved: binding.participantId === reservation.binding.participantId,
        sessionPreserved: binding.sessionId === reservation.binding.sessionId, retryPreserved: repeated.sessionId === binding.sessionId,
        participantCount: state.participants.length, phase: state.participants[0]?.phase,
        preset: state.participants[0]?.preset, activationCount: state.activations.length,
        bound: run.snapshot().entities[entityId]?.binding?.sessionId === binding.sessionId } }
    }
    if (old?.binding === undefined) throw new Error('missing durable cognition binding')
    const connection = restored?.connection ?? await ctx.simulationTeams.attach(run, old.binding.teamId, 'simulation/company')
    let checkpointRecovery: { released: boolean; paused: boolean; modelCalls: number } | undefined
    if (checkpointFirst) {
      let modelCalls = 0
      const remove = ctx.on('llm/stream', (_options, next) => { modelCalls += 1; return next() })
      const candidate = await connection.collectCheckpointCandidate(4, 3)
      try {
        await candidate.validate()
        assert.equal(run.population().chargedActors, 0)
        assert.equal(modelCalls, 0)
        checkpointRecovery = { released: true, paused: run.snapshot().phase === 'paused', modelCalls }
      } finally { candidate.release(); remove() }
    }
    await connection.recover(entityId)
    const stoppedState = await ctx.teams.getTeam({ teamId: old.binding.teamId })
    const stopped = old.writer?.activationId === undefined ? undefined
      : await ctx.teams.getActivation({ teamId: old.binding.teamId, activationId: old.writer.activationId })
    const stoppedReservation = stoppedState.participants.find(value => value.id === old.binding?.participantId)?.activationReservation
    const previousExecutionStopped = stopped === undefined ? stoppedReservation?.releasedAt !== undefined
      : stopped.quiescedAt !== undefined && stopped.activation.status === 'offline'
    const operation = Object.values(run.snapshot().operations)[0]
    if (operation?.action.kind === 'communication/post' && stoppedState.team.cancellation !== undefined) {
      await ctx.plugin(Direct)
      const stopped = await connection.drive({ until: simTimeSchema.parse('10') }, () => 200)
      const failure = run.snapshot().operations[operation.id]?.deliveryFailure
      if (stopped.reason !== 'stalled' || failure === undefined) throw new Error('Target abandonment did not survive recovery')
      await connection.recover(operation.action.recipient)
      const recipient = run.snapshot().entities[operation.action.recipient]!
      await run.change(simulationChangeSchema.parse({ kind: 'entity/phase', id: recipient.id,
        entityRevision: recipient.revision, phase: 'terminated' }), run.snapshot().revision)
      const resolution = await connection.reconcileDeliveryFailure(operation.id)
      await run.setPhase('running', run.snapshot().revision)
      const resumed = await connection.drive({ until: simTimeSchema.parse('10') }, () => 200)
      return { terminalDelivery: { failureReason: failure.record.reason, resolution,
        publicationApplied: run.snapshot().operations[operation.id]?.result?.status === 'applied',
        recipientReceipt: run.snapshot().operations[operation.id]?.delivery?.receipt !== undefined,
        resumed: resumed.reason, time: run.snapshot().time } }
    }
    let dormantInvitation: {
      neverActivatedBeforeRecovery: boolean
      canonicalSessionPreserved: boolean
      invitationCount: number
    } | undefined
    const dormantRecipient = run.snapshot().entities[simulationEntityIdSchema.parse('recipient')]
    if (operation === undefined && dormantRecipient?.binding !== undefined) {
      await ctx.plugin(Direct)
      const channelId = stoppedState.channelIds[0]
      if (channelId === undefined) throw new Error('Dormant recipient lost its admitted channel')
      const confirmed = await connection.acknowledgeInvitation(dormantRecipient.id, channelId)
      const neverActivatedBeforeRecovery = !stoppedState.activations.some(value =>
        value.activation.participantId === dormantRecipient.binding?.participantId)
      const activated = await connection.activate(dormantRecipient.id, { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { options: {} }, signal: new AbortController().signal })
      dormantInvitation = { neverActivatedBeforeRecovery,
        canonicalSessionPreserved: activated.binding.sessionId === dormantRecipient.binding.sessionId,
        invitationCount: confirmed.invitations.filter(value => value.status === 'acknowledged').length }
      if (!neverActivatedBeforeRecovery || confirmed.channel.phase !== 'active') throw new Error('Dormant consent required prior residency')
    }
    let outbox: { targetRecords: number; sameReceipt: boolean } | undefined
    let business: { quantities: string[]; idempotentResult: boolean } | undefined
    let teamPost: {
      envelopeCount: number
      receiptMatches: boolean
      payload: unknown
      defaultClaimRejected: boolean
      receiptCount: number
      wakeRecorded: boolean
      queuedBeforeInference: number
      modelCalls: number
      receivedPayloads: Message['content'][]
      wakeCompleted: boolean
      coordinatorStop: string
      canonicalInvitationEndpoints: boolean
    } | undefined
    if (operation?.action.kind === 'communication/post' && operation.decisionId === simulationDecisionIdSchema.parse('team-message')) {
      await ctx.plugin(Direct)
      if (BigInt(run.snapshot().time) < BigInt(operation.action.deliverAt)) {
        const before = await ctx.teams.readChannel({ channelId: operation.action.channelId, afterCursor: -1 })
        assert.equal(before.records.some(record => record.type === 'channel/envelope'), false)
        await run.drive({ until: operation.action.deliverAt })
      }
      const first = await connection.dispatchOperation(operation.id, () => 200)
      const repeated = await connection.dispatchOperation(operation.id, () => 200)
      const page = await ctx.teams.readChannel({ channelId: operation.action.channelId, afterCursor: -1 })
      const envelopes = page.records.filter(record => record.type === 'channel/envelope')
      const receipt = run.snapshot().operations[operation.id]?.outbox?.receipt
      if (receipt === undefined) throw new Error('missing reconciled target receipt')
      if (run.snapshot().entities[operation.action.recipient]?.writer?.phase !== 'released') await connection.recover(operation.action.recipient)
      let receivedModelCalls = 0
      let receivedPayloads: Message['content'][] = []
      ctx.llm.registerAdapter(['simulation-delivery'], new class extends LlmAdapter {
        override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
        async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
          receivedModelCalls += 1
          receivedPayloads = options.messages.filter(message => message.source.kind === 'team-envelope').map(message => message.content.slice(1))
          yield { type: 'block-start', index: 0, blockType: 'text' }
          yield { type: 'text-delta', index: 0, text: 'Received message' }
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Received message' } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }())
      const receiver = await connection.activate(operation.action.recipient, { provider: 'in-process', seed: { kind: 'resume' },
        agent: { options: { provider: 'simulation-delivery', model: 'fixture' } }, signal: new AbortController().signal })
      const actor = ctx.teams.openActivationActorProofIssuer().issue(receiver.binding)
      const claimInput = { actor: actor.proof, channelId: receipt.channelId, envelopeId: receipt.envelopeId }
      let defaultClaimRejected = false
      try { await ctx.teams.claimChannelDelivery(claimInput) }
      catch (error: unknown) {
        if (!(error instanceof TeamError) || error.code !== 'TEAM_ACTOR_PROOF_INVALID') throw error
        defaultClaimRejected = true
      }
      if (!defaultClaimRejected) throw new Error('Generic consumer claimed a Simulation delivery')
      actor.revoke()
      const coordinated = await connection.drive({ until: run.snapshot().time }, () => 200)
      if (coordinated.reason !== 'decision-required') throw new Error('Coordinator did not retain the recipient decision requirement')
      const wakeId = await connection.receiveOperation(operation.id)
      if (await connection.receiveOperation(operation.id) !== wakeId) throw new Error('Delivery retry replaced its wake identity')
      const delivered = await ctx.teams.readChannel({ channelId: receipt.channelId, afterCursor: -1 })
      if (receiver.localAgent === undefined) throw new Error('missing recipient Agent')
      const receiptCount = delivered.records.filter(record => record.type === 'channel/receipt').length
      const queuedBeforeInference = receiver.localAgent.inbox.nextStep.filter(message => message.source.kind === 'team-envelope'
        && message.source.envelopeId === receipt.envelopeId).length
      const wakeRecorded = run.snapshot().scheduledEvents[wakeId] !== undefined
      await run.drive({ until: run.snapshot().time })
      const receivedDecision = await connection.openDecision(operation.action.recipient, simulationDecisionIdSchema.parse('team-received'), wakeId)
      await connection.prepareContext(operation.action.recipient, receivedDecision.id, contextRequest())
      await connection.dispatchDecision(operation.action.recipient, receivedDecision.id)
      await receiver.localAgent.whenIdle()
      if (receivedModelCalls !== 1 || receivedPayloads.length !== 1) throw new Error('Recipient did not infer from exactly one delivered message')
      await connection.submitDecision(operation.action.recipient, receivedDecision.id, [])
      const wakeCompleted = run.snapshot().wakes[wakeId]?.status === 'completed'
      const admission = await ctx.teams.getChannelAdmission({ channelId: receipt.channelId })
      const canonicalInvitationEndpoints = admission.invitations.every(invitation => invitation.status === 'acknowledged'
        && invitation.endpoint.kind === 'activation' && invitation.endpoint.activationId === undefined
        && Object.values(run.snapshot().entities).some(entity => entity.binding?.participantId === invitation.participantId
          && invitation.endpoint.kind === 'activation' && entity.binding.sessionId === invitation.endpoint.sessionId))
      if (!canonicalInvitationEndpoints) throw new Error('Recovered channel lost its canonical invitation endpoints')
      teamPost = { canonicalInvitationEndpoints, coordinatorStop: coordinated.reason, defaultClaimRejected, receiptCount, queuedBeforeInference, modelCalls: receivedModelCalls, receivedPayloads, wakeCompleted, wakeRecorded, envelopeCount: envelopes.length, receiptMatches: first.status === 'settled' && repeated.status === 'settled'
        && first.result.status === 'applied' && first.result.sequence === repeated.result.sequence
        && receipt?.envelopeId === envelopes[0]?.envelope.id, payload: envelopes[0]?.envelope.payload }
    } else if (operation?.action.kind === 'communication/post') {
      const target = await openOutboxTarget(root)
      try {
        const first = await run.dispatchOperation(operation.id, target.transport, () => 200)
        const repeated = await run.dispatchOperation(operation.id, target.transport, () => 200)
        outbox = { targetRecords: await target.count(), sameReceipt: first.status === 'settled' && repeated.status === 'settled'
          && first.result.sequence === repeated.result.sequence && first.result.status === 'applied' }
      } finally { await target.close() }
    } else if (operation !== undefined) {
      const first = await run.executeOperation(operation.id)
      const repeated = await run.executeOperation(operation.id)
      business = { quantities: Object.values(run.snapshot().resources).map(resource => resource.quantity),
        idempotentResult: first.sequence === repeated.sequence && first.status === 'applied' && repeated.status === 'applied' }
    }
    const originalContext = run.snapshot().decisions[simulationDecisionIdSchema.parse('context-decision')]?.context
    let modelCalls = 0
    let messages: Pick<Message, 'role' | 'content'>[] = []
    if (originalContext?.status === 'prepared') ctx.llm.registerAdapter(['simulation-recovery'], new class extends LlmAdapter {
      override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        modelCalls += 1
        messages = options.messages.map(({ role, content }) => ({ role, content }))
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Recovered decision' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Recovered decision' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }())
    const preset = old.writer === undefined ? undefined : (await ctx.sessionPersistence.inspect(old.binding.sessionId)).meta.agentPreset
    const lease = await connection.activate(entityId, { provider: 'in-process', seed: { kind: old.writer === undefined ? 'fresh' : 'resume' },
      agent: { ...preset === undefined ? {} : { preset }, options: originalContext === undefined ? {} : { provider: 'simulation-recovery', model: 'fixture' } }, signal: new AbortController().signal })
    const context = originalContext?.status !== 'prepared' ? undefined : {
      contextRetained: originalContext.view.content.map(section => section.kind),
      decisionCancelled: run.snapshot().decisions[simulationDecisionIdSchema.parse('context-decision')]?.status === 'cancelled',
      wakeBeforeResumption: run.snapshot().wakes[simulationEventIdSchema.parse('context-wake')]?.status,
      viewPersisted: lease.localAgent?.session.events.some(event => event.type === 'simulation/context-view'
        && event.data.inputId === originalContext.view.inputId),
      inputConsumed: lease.localAgent?.session.events.some(event => event.type === 'user/message'
        && event.data.id === MessageId(originalContext.view.inputId)),
    }
    let resumed: { modelCalls: number; wake: string | undefined; inputEntries: number; retryStatus: string; messages: Pick<Message, 'role' | 'content'>[] } | undefined
    if (originalContext?.status === 'prepared') {
      const agent = lease.localAgent
      if (agent === undefined) throw new Error('missing recovered cognition')
      await agent.whenIdle()
      const wakeId = simulationEventIdSchema.parse('context-wake')
      const decision = await connection.openDecision(entityId, simulationDecisionIdSchema.parse('context-recovered'), wakeId)
      const prepared = await connection.prepareContext(entityId, decision.id, contextRequest())
      if (prepared.status !== 'prepared') throw new Error('recovery context overflow')
      await connection.dispatchDecision(entityId, decision.id)
      await agent.whenIdle()
      if (modelCalls !== 1) throw new Error('Recovered input did not produce exactly one model request')
      await connection.submitDecision(entityId, decision.id, [])
      const repeated = await connection.dispatchDecision(entityId, decision.id)
      resumed = { modelCalls, messages, wake: run.snapshot().wakes[wakeId]?.status,
        inputEntries: agent.session.events.filter(event => event.type === 'user/message'
          && event.surfaceOp === 'append' && event.data.id === MessageId(prepared.view.inputId)).length,
        retryStatus: repeated.status }
    }
    const scheduled = run.snapshot().scheduledEvents[simulationEventIdSchema.parse('wake-buyer')]
    let scheduler: { time: string; event: string | undefined; wake: string | undefined } | undefined
    if (scheduled !== undefined) {
      await run.drive({ until: simTimeSchema.parse('5') })
      const decision = await connection.openDecision(entityId, simulationDecisionIdSchema.parse('recovered-decision'), scheduled.id)
      await connection.submitDecision(entityId, decision.id, [])
      await run.drive({ until: simTimeSchema.parse('20') })
      scheduler = { time: run.snapshot().time, event: run.snapshot().scheduledEvents[scheduled.id]?.status,
        wake: run.snapshot().wakes[scheduled.id]?.status }
    }
    const modelDecision = run.snapshot().decisions[simulationDecisionIdSchema.parse('model-decision')]
    if (modelDecision !== undefined) {
      assert.ok(lease.localAgent)
      const stagedCall = lease.localAgent.session.events.flatMap(event => event.type === 'assistant/message' ? event.data.message.content : [])
        .find(block => block.type === 'tool-call' && block.name === 'simulation_stage')
      assert.ok(stagedCall?.type === 'tool-call')
      const args = JSON.parse(stagedCall.arguments) as { proposals: unknown[] }
      const proposals = args.proposals.map(value => simulationProposalSchema.parse(value))
      await assert.rejects(connection.submitDecision(entityId, modelDecision.id, proposals), /another writer/)
      await assert.rejects(ctx.simulationTeams.modelRequest(lease.localAgent,
        { kind: 'stage', proposals },
        new AbortController().signal), /current prepared decision input/)
    }
    const modelProposals = modelDecision === undefined ? undefined : {
      staleResultRejected: true,
      ...preset === undefined ? {} : { preset, visibleTools: ctx.tools.schemas(lease.localAgent).map(tool => tool.name).sort() },
      decisionStatus: modelDecision.status, operationCount: modelDecision.operationIds.length,
      toolResults: lease.localAgent?.session.events.filter(event => event.type === 'tool/result').map(event => event.data.message.content),
      quantities: Object.values(run.snapshot().resources).map(resource => resource.quantity),
    }
    return {
      ...modelProposals === undefined ? {} : { modelProposals },
      ...checkpointRecovery === undefined ? {} : { checkpointRecovery },
      ...restored === undefined ? {} : { manifestRestored: restored.manifest.id === recoveryCheckpoint.id },
      epoch: run.snapshot().entities[entityId]?.writer?.epoch,
      sessionPreserved: lease.binding.sessionId === old.binding.sessionId,
      previousExecutionStopped,
      newActivationCreated: lease.binding.activation.id !== old.writer?.activationId,
      ...dormantInvitation === undefined ? {} : { dormantInvitation },
      ...business === undefined ? {} : { business },
      ...outbox === undefined ? {} : { outbox },
      ...teamPost === undefined ? {} : { teamPost },
      ...scheduler === undefined ? {} : { scheduler },
      ...context === undefined ? {} : { context },
      ...resumed === undefined ? {} : { resumed },
    }
  } finally { await run.close() }
}
