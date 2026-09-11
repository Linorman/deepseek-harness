import * as TeamTools from '@clocky/clocky-tool-team'
import WebServer from '@clocky/clocky-host-webserver'
import * as WebSocketHub from '@clocky/clocky-team-link-websocket-hub'
import * as WebSocketClient from '@clocky/clocky-team-link-websocket'
import { FixedBindingTeamAgentLinkDelivery } from '@clocky/clocky-team-agent-client'
import type {} from '@clocky/clocky-team-channel-admission'
/** Explicit deployment consumer exercises direct v4 through real tools, Links, Agents and Session receipts. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import type { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import { CallId, createUserMessage, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import { channelPostIdempotencyKeySchema, jsonObjectSchema } from '@clocky/clocky-team'
import type {
  ChannelId, ChannelRecord, EnvelopeId, ParticipantId, TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope,
  TeamSystemRootCreationProof, TeamSystemRootCreationScope, TeamSystemTopologyProof, TeamSystemTopologyScope,
} from '@clocky/clocky-team'
import { TeamLinkError } from '@clocky/clocky-team-link'
import type { TeamLinkBoundLinkBorrower } from '@clocky/clocky-team-link'
import type { TeamActivationLease } from '@clocky/clocky-team-activation-controller'
import type {} from '@clocky/clocky-team-agent-client'
import type {} from '@clocky/clocky-attachment'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')

class MessageModel extends LlmAdapter {
  requests = 0
  target: { channelId: ChannelId; recipientId: ParticipantId } | undefined
  expectedSubset: boolean | undefined

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, inputModalities: ['text', 'image'] }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== 'session-title') {
      this.requests += 1
      if (this.target !== undefined && this.requests <= 2) {
        const id = CallId(this.requests === 1 ? 'remote-subset' : 'remote-broadcast')
        const args = JSON.stringify({ channel_id: this.target.channelId,
          text: this.requests === 1 ? 'PRIVATE_SUBSET' : 'REMOTE_BROADCAST',
          ...this.requests === 1 ? { audience: [this.target.recipientId] } : {}, delivery: 'context' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'team_message', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'team_message', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      if (this.expectedSubset !== undefined) {
        const request = JSON.stringify(options.messages)
        assert.equal(request.includes('PRIVATE_SUBSET'), this.expectedSubset)
        assert(request.includes('BROADCAST_BEGIN') && request.includes('BROADCAST_END'))
        assert(request.includes('"type":"image"'), 'the actual model request retains the image block')
      }
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Observed without replying to the channel.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function token(): object {
  return Object.freeze({ toJSON(): never { throw new TypeError('Deployment authority is runtime-only') } })
}

/** The fixture owns initial topology; delivery and receipts belong to the shipped providers. */
function deployment(ctx: Context) {
  const roots = new WeakMap<TeamSystemRootCreationProof, TeamSystemRootCreationScope>()
  const topology = new WeakMap<TeamSystemTopologyProof, TeamSystemTopologyScope>()
  const channels = new WeakMap<TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope>()
  ctx.teams.registerSystemRootCreationProofSource({ name: 'team-run', resolveRootCreationProof: actor => roots.get(actor) })
  ctx.teams.registerSystemTopologyProofSource({ name: 'team-run', resolveTopologyProof: actor => topology.get(actor) })
  ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'team-channel-lifecycle', resolveChannelLifecycleProof: actor => channels.get(actor) })
  return {
    async create() {
      const scope: TeamSystemRootCreationScope = { kind: 'team-run-root-create',
        goal: { objective: 'Direct v4 subset and broadcast delivery.', budgets: {} }, rules: {}, budgets: {} }
      const actor = token() as TeamSystemRootCreationProof
      roots.set(actor, scope)
      try { return await ctx.teams.createTeam({ actor, goal: scope.goal, rules: scope.rules, budgets: scope.budgets }) }
      finally { roots.delete(actor) }
    },
    async topology<T>(scope: TeamSystemTopologyScope, operation: (actor: TeamSystemTopologyProof) => Promise<T>) {
      const actor = token() as TeamSystemTopologyProof
      topology.set(actor, scope)
      try { return await operation(actor) }
      finally { topology.delete(actor) }
    },
    async open(scope: Extract<TeamSystemChannelLifecycleScope, { kind: 'channel-open' }>) {
      const actor = token() as TeamSystemChannelLifecycleProof
      channels.set(actor, scope)
      const { kind: _kind, ...input } = scope
      try { return await ctx.teams.openChannel({ actor, authorityKind: 'channel-lifecycle', ...input }) }
      finally { channels.delete(actor) }
    },
  }
}

async function connected(ctx: Context, agent: Agent): Promise<TeamLinkBoundLinkBorrower> {
  for (;;) {
    const borrower = ctx.teamLinks.getBoundLinkBorrower(agent)
    if (borrower !== undefined) {
      try {
        await borrower.withLink(async () => undefined)
        return borrower
      } catch (error: unknown) {
        if (!(error instanceof TeamLinkError) || error.code !== 'TEAM_LINK_BOUND_LINK_UNAVAILABLE') throw error
      }
    }
    await setImmediate()
  }
}

async function records(ctx: Context, channelId: ChannelId): Promise<readonly ChannelRecord[]> {
  return (await ctx.teams.readChannel({ channelId, afterCursor: -1 })).records
}

async function received(ctx: Context, channelId: ChannelId, envelopeId: EnvelopeId, participantId: ParticipantId) {
  for (;;) {
    const read = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
    if (read.records.some(record => record.type === 'channel/receipt' && record.envelopeId === envelopeId
      && record.participantId === participantId)) return
    await ctx.teams.watchChannel({ channelId, afterCursor: read.channel.cursor })
  }
}

function incoming(agent: Agent) {
  return agent.session.events.flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : [])
    .filter(message => message.source.kind === 'team-envelope')
}

async function run(ctx: Context) {
  const channelAdmission = ctx.get('teamChannelAdmission')
  assert(channelAdmission !== undefined)
  await ctx.get('loader')?.await()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const webServer = ctx.get('webServer')
  assert(webServer !== undefined)
  const websocketPort = webServer.port
  const toolEndpoint = ctx.isolate('teams')
  assert.equal(toolEndpoint.get('teams'), undefined)
  await toolEndpoint.plugin(TeamTools)
  const owner = deployment(ctx)
  const created = await owner.create()
  const teamId = created.team.id
  const members: { id: ParticipantId; role: string }[] = []
  for (const role of ['coordinator', 'worker', 'worker-2']) {
    const participant = { kind: 'local-agent' as const, displayName: role, role, capabilities: [] }
    const expectedCursor = (await ctx.teams.getTeam({ teamId })).team.cursor
    const invited = await owner.topology({ kind: 'team-run-bootstrap-participant-invite', teamId, expectedCursor, participant },
      async actor => await ctx.teams.inviteParticipant({ actor, teamId, expectedCursor, ...participant }))
    for (const [expectedPhase, phase] of [['invited', 'provisioning'], ['provisioning', 'active']] as const) {
      const cursor = (await ctx.teams.getTeam({ teamId })).team.cursor
      await owner.topology({ kind: 'team-run-bootstrap-participant-phase', teamId, participantId: invited.id,
        expectedCursor: cursor, expectedPhase, phase }, async actor => await ctx.teams.transitionParticipantPhase({
        actor, teamId, participantId: invited.id, expectedCursor: cursor, phase,
      }))
    }
    members.push({ id: invited.id, role })
  }
  const [sender, fast, slow] = members
  assert(sender !== undefined && fast !== undefined && slow !== undefined)
  const remoteParticipantId = sender.id
  const channel = await owner.open({ kind: 'channel-open', teamId,
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'direct', version: 4 }, participants: members, limits: {} })
  const channelId = channel.manifest.id
  const senderModel = new MessageModel()
  senderModel.target = { channelId, recipientId: fast.id }
  const fastModel = new MessageModel()
  fastModel.expectedSubset = true
  const slowModel = new MessageModel()
  slowModel.expectedSubset = false
  const leases: TeamActivationLease[] = []
  const deliveries: FixedBindingTeamAgentLinkDelivery[] = []
  async function activate(participantId: ParticipantId, provider: string, model: MessageModel) {
    ctx.llm.registerAdapter([provider], model)
    const lease = await ctx.teamActivations.activate({ teamId, participantId,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, provider: 'in-process',
      sessionId: SessionId(`direct-v4-${randomUUID()}`), seed: { kind: 'fresh' },
      agent: { cwd: process.cwd(), options: { provider, model: provider } }, signal: new AbortController().signal })
    leases.push(lease)
    assert(lease.localAgent !== undefined)
    const binding = (await ctx.teams.getTeam({ teamId })).activations.find(value => value.sessionId === lease.localAgent!.session.id)
    assert(binding !== undefined)
    const remote = participantId === remoteParticipantId
    if (remote) {
      process.env.CLOCKY_ADMISSION_WS_CAPABILITY = `admission-${randomUUID()}`
      const endpoint = `ws://127.0.0.1:${websocketPort}/admission-link`
      await ctx.plugin(WebSocketHub, { path: '/admission-link', endpoint, enrollmentProviderName: 'admission-websocket',
        pageSize: 32, maxFrameBytes: 16 * 1024, maxConnections: 8, maxPendingRequests: 16, maxQueuedBytes: 128 * 1024,
        maxOutstandingDeliveries: 16, requestWindowMs: 1000, maxRequestsPerWindow: 128, closeTimeoutMs: 1000,
        handshakeTimeoutMs: 5000, heartbeatIntervalMs: 1000, heartbeatTimeoutMs: 500,
        retryableNackDelayMs: 10, backpressureRetryAfterMs: 100,
        bindings: [{ capabilityEnv: 'CLOCKY_ADMISSION_WS_CAPABILITY', activationId: binding.activation.id,
          teamId, participantId, sessionId: binding.sessionId, provider: binding.provider }] })
      await ctx.plugin(WebSocketClient, { providerName: 'admission-websocket', endpoint, capabilityEnv: 'CLOCKY_ADMISSION_WS_CAPABILITY',
        connectTimeoutMs: 5000, responseTimeoutMs: 5000, maxFrameBytes: 16 * 1024, maxPendingRequests: 16, maxBufferedNotifications: 16 })
    }
    const delivery = new FixedBindingTeamAgentLinkDelivery(ctx, { agent: lease.localAgent, binding },
      { linkProvider: remote ? 'admission-websocket' : 'local' })
    deliveries.push(delivery)
    delivery.start()
    await connected(ctx, lease.localAgent)
    return lease.localAgent
  }
  try {
    const senderAgent = await activate(sender.id, 'direct-v4-sender', senderModel)
    assert.equal((await ctx.teams.getChannel({ channelId })).phase, 'pending')
    const senderBeforeAdmission = await connected(ctx, senderAgent)
    const pendingMetadata = await senderBeforeAdmission.withLink(async link => await link.getChannel(channelId))
    assert.equal(pendingMetadata.phase, 'pending')
    assert.deepEqual(Object.keys(pendingMetadata).sort(), ['cursor', 'manifest', 'phase', 'replayWatermark'])
    await assert.rejects(senderBeforeAdmission.withLink(async link => await link.post({
      idempotencyKey: channelPostIdempotencyKeySchema.parse('pending-dispatch'),
      draft: { channelId, audience: null, kind: 'message', payload: { content: [{ type: 'text', text: 'Must not dispatch.' }] }, delivery: 'turn' },
    })))
    const waitForAdmission = channelAdmission.waitUntilActive({ channelId, signal: new AbortController().signal })
    const fastAgent = await activate(fast.id, 'direct-v4-fast', fastModel)
    assert.equal((await ctx.teams.getChannel({ channelId })).phase, 'pending')
    assert.equal(senderModel.requests + fastModel.requests + slowModel.requests, 0)
    const slowAgent = await activate(slow.id, 'direct-v4-slow', slowModel)
    assert.equal((await waitForAdmission).phase, 'active')
    const admitted = await ctx.teams.getChannelAdmission({ channelId })
    assert.deepEqual(admitted.invitations.map(invitation => invitation.status), ['acknowledged', 'acknowledged', 'acknowledged'])
    const oldSenderDelivery = deliveries[0]
    assert(oldSenderDelivery !== undefined)
    await oldSenderDelivery.close()
    const senderBinding = (await ctx.teams.getTeam({ teamId })).activations.find(value => value.sessionId === senderAgent.session.id)
    assert(senderBinding !== undefined)
    const reconnectedSender = new FixedBindingTeamAgentLinkDelivery(ctx, { agent: senderAgent, binding: senderBinding },
      { linkProvider: 'admission-websocket' })
    deliveries.push(reconnectedSender)
    reconnectedSender.start()
    await connected(ctx, senderAgent)
    assert.equal((await ctx.teams.getChannelAdmission({ channelId })).invitations.filter(value => value.status === 'acknowledged').length, 3)
    senderAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'Send the explicit subset message once.' }], source: { kind: 'user' } }))
    await senderAgent.whenIdle()
    const subsetRows = (await records(ctx, channelId)).filter(record => record.type === 'channel/envelope')
    assert.equal(subsetRows.length, 2, 'the real remote tool must append a subset and a default broadcast')
    const subset = subsetRows[0]!.envelope
    assert.deepEqual(subset.audience, [fast.id])
    assert.deepEqual(subset.payload, { content: [{ type: 'text', text: 'PRIVATE_SUBSET' }] })
    await received(ctx, channelId, subset.id, fast.id)
    const toolBroadcast = subsetRows[1]!.envelope
    assert.equal(toolBroadcast.audience, null)
    assert.deepEqual(toolBroadcast.payload, { content: [{ type: 'text', text: 'REMOTE_BROADCAST' }] })
    await received(ctx, channelId, toolBroadcast.id, fast.id)
    await received(ctx, channelId, toolBroadcast.id, slow.id)
    const attachment = await ctx.attachments.saveImage({ data: PNG, mediaType: 'image/png', name: 'direct-v4.png' })
    const payload = jsonObjectSchema.parse({ content: [{ type: 'text', text: 'BROADCAST_BEGIN' },
      { type: 'image', attachment }, { type: 'text', text: 'BROADCAST_END' }] })
    const senderLink = await connected(ctx, senderAgent)
    const broadcast = await senderLink.withLink(async link => await link.post({
      idempotencyKey: channelPostIdempotencyKeySchema.parse('direct-v4-broadcast'),
      draft: { channelId, audience: null, kind: 'message', payload, delivery: 'context' },
    }))
    await received(ctx, channelId, broadcast.id, fast.id)
    assert.equal(fastModel.requests, 0, 'context delivery must not wake the receiver')
    await received(ctx, channelId, broadcast.id, slow.id)
    assert.equal(slowModel.requests, 0)
    assert.equal(incoming(fastAgent).length, 3)
    assert.equal(incoming(slowAgent).length, 2)
    for (const agent of [fastAgent, slowAgent]) {
      const message = incoming(agent).find(message => message.source.kind === 'team-envelope' && message.source.envelopeId === broadcast.id)
      assert(message !== undefined)
      assert.deepEqual(message.content.slice(1), payload.content)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect your received messages without sending any channel reply.' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
    }
    assert.equal(fastModel.requests, 1)
    assert.equal(slowModel.requests, 1)
    await assert.rejects(senderLink.withLink(async link => await link.postFinalResult({ channelId,
      idempotencyKey: channelPostIdempotencyKeySchema.parse('direct-v4-group-final'), text: 'Not a broadcast final.' })))
    const finalRecords = await records(ctx, channelId)
    assert.equal(finalRecords.filter(record => record.type === 'channel/envelope').length, 3)
    assert.equal(finalRecords.filter(record => record.type === 'channel/receipt').length, 5)
    return { remoteMessage: 'websocket-v7-after-reconnect', admission: ['pending', 'acknowledged', 'active'], pendingDispatch: 'rejected', adapter: 'direct-v4', members: 3, explicitToolMessages: 2, broadcastMessages: 2,
      fastSources: 3, delayedSources: 2, receipts: 5, orderedContent: ['text', 'image', 'text'],
      receiverModelRequests: [fastModel.requests, slowModel.requests], automaticChannelReplies: 0, groupFinal: 'rejected' }
  } finally {
    for (const delivery of deliveries.reverse()) await delivery.close()
    for (const lease of leases.reverse()) await lease.dispose()
  }
}

/** Test deployment plugin identity. */
export const name = 'channel-admission-driver'
/** Real message, attachment and activation owners required by this scenario. */
export const inject = ['agents', 'teams', 'llm', 'sessions', 'teamLinks', 'teamActivations', 'attachments']

/** Run the bounded keyless direct messaging scenario. @param ctx - actual Loader context. */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx).then((value) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
