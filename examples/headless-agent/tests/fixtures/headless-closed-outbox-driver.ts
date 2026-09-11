/** Closed consult/discussion outboxes reach real Agent Sessions and the principal inbox through the Loader. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import type { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { channelPostIdempotencyKeySchema, channelInvitationIdempotencyKeySchema, jsonObjectSchema, teamWorkflowPlanSchema, teamWorkflowPlanIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ParticipantSnapshot, TeamEnvelope, TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope,
  ActivationBindingSnapshot, TeamSystemWorkflowProof, TeamSystemWorkflowScope,
  TeamSystemRootCreationProof, TeamSystemRootCreationScope, TeamSystemTopologyProof, TeamSystemTopologyScope } from '@clocky/clocky-team'
import type { TeamActivationLease } from '@clocky/clocky-team-activation-controller'
import type {} from '@clocky/clocky-team-human-actor'
import type {} from '@clocky/clocky-team-channel-admission'

class OutboxModel extends LlmAdapter {
  agent: Agent | undefined
  failure: Error | undefined
  requests = 0
  private readonly respond: boolean
  constructor(respond: boolean) { super(); this.respond = respond }
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> { return { provider, id: model, name: model } }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose !== 'session-title') {
      this.requests++
      if (!this.respond) {
        const content = JSON.stringify(options.messages)
        assert(content.includes(this.requests === 1 ? 'ORDINARY_CONSULT_ANSWER' : this.requests === 2 ? 'DISCUSSION_LAST_TURN' : 'WORKFLOW_LAST_TURN'))
      }
      if (this.respond) {
        const source = this.agent?.session.events.findLast(event => event.type === 'team/channel-view')
        assert(source?.type === 'team/channel-view')
        const id = CallId(`response-${source.data.triggeringEnvelopeId}`)
        const prior = options.messages.flatMap(message => message.content).find(block => block.type === 'tool-result' && block.toolCallId === id)
        if (prior?.type === 'tool-result' && prior.isError) { this.failure = new Error(JSON.stringify(prior)); throw this.failure }
        if (prior === undefined) {
          const args = JSON.stringify({ channel_id: source.data.channelId, text: 'ORDINARY_CONSULT_ANSWER', delivery: 'turn' })
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: 0, id, name: 'team_message', argumentsDelta: args }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'team_message', arguments: args } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
        }
      }
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Observed the durable channel input.' } }
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
  const workflows = new WeakMap<TeamSystemWorkflowProof, TeamSystemWorkflowScope>()
  ctx.teams.registerSystemRootCreationProofSource({ name: 'team-run', resolveRootCreationProof: actor => roots.get(actor) })
  ctx.teams.registerSystemTopologyProofSource({ name: 'team-run', resolveTopologyProof: actor => topology.get(actor) })
  ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'team-channel-lifecycle', resolveChannelLifecycleProof: actor => channels.get(actor) })
  ctx.effect(() => ctx.teams.registerSystemWorkflowProofSource({ name: 'team-run', resolveWorkflowProof: actor => workflows.get(actor) }))
  return {
    async workflow(binding: ActivationBindingSnapshot, members: readonly ParticipantSnapshot[]) {
      const teamId = binding.activation.teamId
      const issuer = ctx.teams.openActivationActorProofIssuer()
      const lease = issuer.issue(binding)
      issuer.close()
      try {
        const plan = await ctx.teams.admitWorkflowPlan({ actor: lease.proof, teamId,
          expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
          idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('terminal-outbox-plan'),
          plan: teamWorkflowPlanSchema.parse({ version: 1, name: 'Terminal workflow outbox',
            tasks: [{ id: 'result', subject: 'Result', description: 'Retain workflow result', blockedBy: [], requiredCapabilities: [],
              priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
            bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
            channel: { participantRoles: members.map(member => member.role), graph: { initial: { kind: 'participant', role: 'coordinator' },
              transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 2 } },
            result: { kind: 'task-results', taskTemplateIds: ['result'] } }) })
        assert(plan.actor)
        const input = { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
          workflowPlanId: plan.id, expectedPlanRevision: plan.revision, adapter: { type: 'workflow', version: 1 },
          viewPolicy: { type: 'full-transcript', version: 1 }, participants: members.map(member => ({ id: member.id, role: member.role })),
          limits: { graph: { initial: { kind: 'participant', participantId: binding.activation.participantId },
            transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 2 } } }
        const actor = token() as TeamSystemWorkflowProof
        workflows.set(actor, { kind: 'team-run-workflow-channel-open', teamId, coordinator: plan.actor, planId: plan.id,
          expectedRevision: plan.revision, expectedCursor: input.expectedCursor, adapter: input.adapter,
          viewPolicy: input.viewPolicy, participants: input.participants, limits: input.limits })
        try { return await ctx.teams.openChannel({ actor, ...input }) }
        finally { workflows.delete(actor) }
      } finally { lease.revoke() }
    },
    async create() {
      const scope: TeamSystemRootCreationScope = { kind: 'team-run-root-create',
        goal: { objective: 'Closed channel delivery.', budgets: {} }, rules: {}, budgets: {} }
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


async function run(ctx: Context) {
  await ctx.get('loader')?.await()
  const owner = deployment(ctx)
  const created = await owner.create()
  const teamId = created.team.id
  const principalId = productPrincipalId('closed-outbox-owner')
  ctx.productPrincipals.registerProvider({ name: 'closed-outbox-auth', async authenticate(request) {
    assert.equal(request.credential, 'closed-outbox-test')
    const abort = new AbortController()
    return { principal: { id: principalId, issuer: 'closed-outbox-auth', subject: 'owner', assurance: 'test', credentialGeneration: 1 },
      signal: abort.signal, revoke() { abort.abort() } }
  } })
  const members: ParticipantSnapshot[] = []
  for (const role of ['reader', 'coordinator', 'human'] as const) {
    const participant = { kind: role === 'human' ? 'human' as const : 'local-agent' as const, displayName: role, role, capabilities: [],
      ...role === 'human' ? { owner: { kind: 'product-principal' as const, principalId } } : {} }
    const expectedCursor = (await ctx.teams.getTeam({ teamId })).team.cursor
    const member = await owner.topology({ kind: 'team-run-bootstrap-participant-invite', teamId, expectedCursor, participant },
      actor => ctx.teams.inviteParticipant({ actor, teamId, expectedCursor, ...participant }))
    for (const [expectedPhase, phase] of [['invited', 'provisioning'], ['provisioning', 'active']] as const) {
      const cursor = (await ctx.teams.getTeam({ teamId })).team.cursor
      await owner.topology({ kind: 'team-run-bootstrap-participant-phase', teamId, participantId: member.id, expectedCursor: cursor, expectedPhase, phase },
        actor => ctx.teams.transitionParticipantPhase({ actor, teamId, participantId: member.id, expectedCursor: cursor, phase }))
    }
    members.push(member)
  }
  const [reader, responder, human] = members
  assert(reader && responder && human)
  const readerModel = new OutboxModel(false); const responderModel = new OutboxModel(true)
  const leases: TeamActivationLease[] = []
  const auth = await ctx.productPrincipals.authenticate({ provider: 'closed-outbox-auth', credential: 'closed-outbox-test' })
  const signal = AbortSignal.timeout(15000)
  async function until(predicate: () => Promise<boolean>) {
    while (!await predicate()) { if (responderModel.failure) throw responderModel.failure; signal.throwIfAborted(); await setImmediate() }
  }
  async function activate(member: ParticipantSnapshot, provider: string, model: OutboxModel) {
    ctx.llm.registerAdapter([provider], model)
    const lease = await ctx.teamActivations.activate({ teamId, participantId: member.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, provider: 'in-process', sessionId: SessionId(`outbox-${randomUUID()}`),
      seed: { kind: 'fresh' }, agent: { cwd: process.cwd(), options: { provider, model: provider } }, signal })
    leases.push(lease); assert(lease.localAgent); model.agent = lease.localAgent
    await until(async () => ctx.teamLinks.getBoundLinkBorrower(lease.localAgent!) !== undefined)
    return lease
  }
  try {
    const a = await activate(reader, 'outbox-reader', readerModel)
    const b = await activate(responder, 'outbox-responder', responderModel)
    const agentChannel = await owner.open({ kind: 'channel-open', teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'full-transcript', version: 1 },
      participants: [{ id: reader.id, role: 'initiator' }, { id: responder.id, role: 'respondent' }], limits: {} })
    await ctx.teamChannelAdmission.waitUntilActive({ channelId: agentChannel.manifest.id, signal })
    const aLink = await ctx.teamLinks.connect({ provider: 'local', binding: a.binding })
    let first: TeamEnvelope
    try { first = await aLink.post({ idempotencyKey: channelPostIdempotencyKeySchema.parse('agent-consult-question'), expectedCursor: (await ctx.teams.getChannel({ channelId: agentChannel.manifest.id })).cursor,
      draft: { channelId: agentChannel.manifest.id, audience: [responder.id], kind: 'request', payload: { text: 'Answer the Agent consult.' }, delivery: 'turn' } }) }
    finally { await aLink.close() }
    await until(async () => readerModel.requests === 1 && responderModel.agent?.status === 'idle')
    const firstRecords = await ctx.teams.readChannel({ channelId: agentChannel.manifest.id, afterCursor: -1 })
    assert.equal(firstRecords.channel.phase, 'closed')
    const answer = firstRecords.records.find(record => record.type === 'channel/envelope' && record.envelope.causationId === first.id)
    assert(answer?.type === 'channel/envelope' && answer.envelope.kind === 'response')
    assert.equal(answer.envelope.payload.text, 'ORDINARY_CONSULT_ANSWER')
    await until(async () => (await ctx.teams.readChannel({ channelId: agentChannel.manifest.id, afterCursor: -1 })).records.some(record => record.type === 'channel/receipt' && record.envelopeId === answer.envelope.id && record.participantId === reader.id))
    const humanChannel = await owner.open({ kind: 'channel-open', teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'full-transcript', version: 1 },
      participants: [{ id: human.id, role: 'initiator' }, { id: responder.id, role: 'respondent' }], limits: {} })
    await auth.withCall(async (call) => {
      const own = (await ctx.teams.getChannelAdmission({ channelId: humanChannel.manifest.id })).invitations.find(invitation => invitation.participantId === human.id)
      assert(own)
      const input = { channelId: humanChannel.manifest.id, revision: own.revision, manifestFingerprint: own.manifestFingerprint,
        idempotencyKey: channelInvitationIdempotencyKeySchema.parse('human-consult-consent') }
      await ctx.teamHumanActors.withProof(call, { teamId, operation: 'channel-open', fence: { kind: 'revision', revision: own.revision }, payload: jsonObjectSchema.parse(input) },
        actor => ctx.teams.acknowledgeChannelInvitation({ actor, ...input }))
      await ctx.teamChannelAdmission.waitUntilActive({ channelId: humanChannel.manifest.id, signal })
      const post = { expectedCursor: (await ctx.teams.getChannel({ channelId: humanChannel.manifest.id })).cursor,
        draft: { channelId: humanChannel.manifest.id, audience: [responder.id], kind: 'request', payload: { text: 'Answer the human consult.' }, delivery: 'turn' as const } }
      await ctx.teamHumanActors.withProof(call, { teamId, operation: 'send', fence: { kind: 'cursor', cursor: post.expectedCursor }, payload: jsonObjectSchema.parse(post) },
        actor => ctx.teams.postChannelEnvelope({ actor, ...post }))
      await until(async () => (await ctx.teamHumanDelivery.read(call, {})).items.some(item => item.kind === 'message' && item.channelId === humanChannel.manifest.id))
      assert.equal((await ctx.teams.getChannel({ channelId: humanChannel.manifest.id })).phase, 'closed')
      const discussion = await owner.open({ kind: 'channel-open', teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
        adapter: { type: 'discussion', version: 1 }, viewPolicy: { type: 'full-transcript', version: 1 },
        participants: members.map(member => ({ id: member.id, role: 'speaker' })), limits: { maxTurns: 1, speakerPolicy: 'free-form' } })
      const invite = (await ctx.teams.getChannelAdmission({ channelId: discussion.manifest.id })).invitations.find(value => value.participantId === human.id)
      assert(invite)
      const consent = { channelId: discussion.manifest.id, revision: invite.revision, manifestFingerprint: invite.manifestFingerprint,
        idempotencyKey: channelInvitationIdempotencyKeySchema.parse('human-discussion-consent') }
      await ctx.teamHumanActors.withProof(call, { teamId, operation: 'channel-open', fence: { kind: 'revision', revision: invite.revision }, payload: jsonObjectSchema.parse(consent) },
        actor => ctx.teams.acknowledgeChannelInvitation({ actor, ...consent }))
      await ctx.teamChannelAdmission.waitUntilActive({ channelId: discussion.manifest.id, signal })
      const link = await ctx.teamLinks.connect({ provider: 'local', binding: b.binding })
      let last: TeamEnvelope
      try { last = await link.post({ idempotencyKey: channelPostIdempotencyKeySchema.parse('discussion-final-turn'), expectedCursor: (await ctx.teams.getChannel({ channelId: discussion.manifest.id })).cursor,
        draft: { channelId: discussion.manifest.id, audience: [reader.id, human.id], kind: 'message', payload: { text: 'DISCUSSION_LAST_TURN' }, delivery: 'turn' } }) }
      finally { await link.close() }
      assert.equal((await ctx.teams.getChannel({ channelId: discussion.manifest.id })).phase, 'closed')
      await until(async () => readerModel.requests === 2 && (await ctx.teamHumanDelivery.read(call, {})).items.some(item => item.kind === 'message' && item.envelopeId === last.id))
      const entries = (await ctx.teams.readChannel({ channelId: discussion.manifest.id, afterCursor: -1 })).records
      assert.equal(entries.filter(record => record.type === 'channel/receipt' && record.envelopeId === last.id).length, 2)
      await until(async () => readerModel.agent?.status === 'idle')
      const workflow = await owner.workflow(b.binding, members)
      const workflowInvite = (await ctx.teams.getChannelAdmission({ channelId: workflow.manifest.id })).invitations.find(value => value.participantId === human.id)
      assert(workflowInvite)
      const workflowConsent = { channelId: workflow.manifest.id, revision: workflowInvite.revision, manifestFingerprint: workflowInvite.manifestFingerprint,
        idempotencyKey: channelInvitationIdempotencyKeySchema.parse('human-workflow-consent') }
      await ctx.teamHumanActors.withProof(call, { teamId, operation: 'channel-open', fence: { kind: 'revision', revision: workflowInvite.revision }, payload: jsonObjectSchema.parse(workflowConsent) },
        actor => ctx.teams.acknowledgeChannelInvitation({ actor, ...workflowConsent }))
      await ctx.teamChannelAdmission.waitUntilActive({ channelId: workflow.manifest.id, signal })
      const workflowLink = await ctx.teamLinks.connect({ provider: 'local', binding: b.binding })
      let terminal: TeamEnvelope
      try { terminal = await workflowLink.post({ idempotencyKey: channelPostIdempotencyKeySchema.parse('workflow-final-turn'),
        expectedCursor: (await ctx.teams.getChannel({ channelId: workflow.manifest.id })).cursor,
        draft: { channelId: workflow.manifest.id, audience: [reader.id, human.id], kind: 'handoff', payload: { text: 'WORKFLOW_LAST_TURN' }, delivery: 'turn' } }) }
      finally { await workflowLink.close() }
      assert.equal((await ctx.teams.getChannel({ channelId: workflow.manifest.id })).phase, 'closed')
      await until(async () => readerModel.requests === 3 && (await ctx.teamHumanDelivery.read(call, {})).items.some(item => item.kind === 'message' && item.envelopeId === terminal.id))
      await until(async () => (await ctx.teams.readChannel({ channelId: workflow.manifest.id, afterCursor: -1 })).records
        .filter(record => record.type === 'channel/receipt' && record.envelopeId === terminal.id).length === 2)
    })
    assert.equal(readerModel.agent?.session.events.filter(event => event.type === 'team/channel-view').length, 3)
    return { consultAgent: 'response-received-after-close', consultHuman: 'response-receipted-after-close',
      discussionFinalTurn: ['Agent', 'human'], workflowFinalTurn: ['Agent', 'human'], consultText: answer.envelope.payload.text, modelReplies: 2, agentViews: 3, syntheticHumanParticipants: 0 }
  } finally { await auth.revoke(); for (const lease of leases.reverse()) await lease.dispose() }
}

export const name = 'closed-channel-outbox-driver'
export const inject = ['teams', 'llm', 'sessions', 'teamLinks', 'teamActivations', 'teamHumanActors', 'teamHumanDelivery', 'productPrincipals', 'teamChannelAdmission']
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit'); assert(exit)
  void run(ctx).then((value) => { process.stdout.write(`${JSON.stringify(value)}\n`); exit(0) },
    (error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); exit(1) })
}
