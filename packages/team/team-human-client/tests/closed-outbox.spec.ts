/** Human principal sinks drain completed protocols without reopening cancelled or expired work. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as Json from '@clocky/clocky-storage-json'
import * as Log from '@clocky/clocky-storage-log'
import ProductPrincipals, { productPrincipalId } from '@clocky/clocky-product-principal'
import TeamHub from '@clocky/clocky-team-hub'
import * as Basic from '@clocky/clocky-team-channel-basic'
import * as Direct from '@clocky/clocky-team-channel-direct'
import * as Workflow from '@clocky/clocky-team-channel-workflow'
import { teamWorkflowPlanSchema, teamWorkflowPlanIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamSystemWorkflowProof, TeamSystemWorkflowScope } from '@clocky/clocky-team'
import { channelInvitationIdempotencyKeySchema, fingerprintTeamHumanActorPayload, jsonObjectSchema, teamClosureIdempotencyKeySchema,
  type ChannelSnapshot, type TeamHumanActorProof, type TeamHumanActorScope, type TeamHumanActorProofInput,
  type TeamSystemClosureProof, type TeamSystemClosureScope, type TeamSystemHumanDeliveryProof, type TeamSystemHumanDeliveryScope } from '@clocky/clocky-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel, closeTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { provisionTestCoordinator } from '../../team-hub/tests/fixtures.ts'
import * as HumanClient from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(ackRequest = true) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp/human-closed-outbox-')); roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(Storage); await ctx.plugin(Json, { root }); await ctx.plugin(Log, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub, { maxEnvelopeBytes: 4096, maxChannelViewBytes: 262144 }); await ctx.plugin(Basic); await ctx.plugin(Direct); await ctx.plugin(Workflow); await ctx.plugin(ProductPrincipals)
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Drain completed protocols', budgets: {} }, rules: {}, budgets: {} })
  const teamId = created.team.id
  const coordinatorActor = await provisionTestCoordinator(ctx, teamId)
  const coordinator = (await ctx.teams.getTeam({ teamId })).participants.find(member => member.role === 'coordinator')!
  const human = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    kind: 'human', role: 'human', displayName: 'Owner', capabilities: [], owner: { kind: 'product-principal', principalId: productPrincipalId('closed-human') } })
  for (const phase of ['provisioning', 'active'] as const) await transitionBootstrapParticipant(ctx, { teamId, participantId: human.id,
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
  const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'team-human-actor', resolveHumanActorProof: proof => proofs.get(proof) })
  function issue(input: TeamHumanActorProofInput) {
    const actor = Object.freeze({}) as TeamHumanActorProof
    proofs.set(actor, { teamId, participantId: human.id, operation: input.operation, fence: input.fence, payloadFingerprint: fingerprintTeamHumanActorPayload(input) })
    return actor
  }
  async function consent(channel: ChannelSnapshot) {
    for (const member of [human, coordinator]) {
      const invitation = (await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })).invitations.find(value => value.participantId === member.id)!
      const input = { channelId: channel.manifest.id, revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
        idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`consent:${channel.manifest.id}:${member.id}`) }
      const actor = member.id === human.id ? issue({ teamId, operation: 'channel-open', fence: { kind: 'revision', revision: input.revision }, payload: jsonObjectSchema.parse(input) }) : coordinatorActor
      await ctx.teams.acknowledgeChannelInvitation({ actor, ...input })
    }
  }
  const channel = await openTestChannel(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'full-transcript', version: 1 },
    participants: [{ id: human.id, role: 'initiator' }, { id: coordinator.id, role: 'respondent' }], limits: {} })
  await consent(channel)
  const question = { expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
    draft: { channelId: channel.manifest.id, audience: [coordinator.id], kind: 'request', payload: { text: 'Question' }, delivery: 'turn' as const } }
  const request = await ctx.teams.postChannelEnvelope({ ...question, actor: issue({ teamId, operation: 'send',
    fence: { kind: 'cursor', cursor: question.expectedCursor }, payload: jsonObjectSchema.parse(question) }) })
  if (ackRequest) await ctx.teams.ackChannelEnvelope({ actor: coordinatorActor, channelId: channel.manifest.id, envelopeId: request.id,
    expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor })
  async function respond(ttlMs?: number) {
    return await ctx.teams.postChannelEnvelope({ actor: coordinatorActor, expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      draft: { channelId: channel.manifest.id, audience: [human.id], kind: 'response', payload: { text: 'Retained answer' }, delivery: 'turn', causationId: request.id,
        ...ttlMs === undefined ? {} : { ttlMs } } })
  }
  return { ctx, teamId, coordinator, coordinatorActor, human, channel, request, respond, consent }
}

describe('closed human outboxes', () => {
  it.each(['terminal', 'extension-terminal', 'turn-cap', 'manual-close', 'expired', 'cancelled'] as const)('admits only live terminal workflow outboxes to the human endpoint: %s', async (mode) => {
    const f = await setup()
    const extensionTarget = { kind: 'extension' as const, name: 'outbox-terminal-target', version: 2, config: null }
    const extension: Workflow.WorkflowExtension = {
      kind: 'target', name: extensionTarget.name, version: extensionTarget.version, validate() {}, resolve() { return { kind: 'terminate' } },
    }
    const retireExtension = mode === 'extension-terminal' ? f.ctx.workflowExtensions.register(extension) : undefined
    const terminal = mode !== 'turn-cap' && mode !== 'manual-close'
    const maxTurns = mode === 'turn-cap' ? 1 : 2
    const target = mode === 'extension-terminal' ? extensionTarget : terminal ? { kind: 'terminate' as const } : { kind: 'participant' as const, role: 'coordinator' }
    const plan = await f.ctx.teams.admitWorkflowPlan({ actor: f.coordinatorActor, teamId: f.teamId,
      expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
      idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse(`outbox-${mode}`),
      plan: teamWorkflowPlanSchema.parse({ version: 1, name: 'Deliver terminal handoff',
        tasks: [{ id: 'result', subject: 'Result', description: 'Retain the workflow result', blockedBy: [], requiredCapabilities: [],
          priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }],
        bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
        channel: { participantRoles: ['coordinator', 'human'], graph: { initial: { kind: 'participant', role: 'coordinator' },
          transitions: [{ condition: { kind: 'always' }, target }], maxTurns } },
        result: { kind: 'task-results', taskTemplateIds: ['result'] } }) })
    if (plan.actor === undefined) throw new Error('Workflow compiler requires its admitted coordinator')
    const input = { teamId: f.teamId, expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
      workflowPlanId: plan.id, expectedPlanRevision: plan.revision, adapter: { type: 'workflow', version: 1 },
      viewPolicy: { type: 'full-transcript', version: 1 },
      participants: [{ id: f.coordinator.id, role: 'coordinator' }, { id: f.human.id, role: 'human' }],
      limits: { graph: { initial: { kind: 'participant', participantId: f.coordinator.id },
        transitions: [{ condition: { kind: 'always' }, target: mode === 'extension-terminal' ? extensionTarget : terminal ? { kind: 'terminate' } : { kind: 'participant', participantId: f.coordinator.id } }], maxTurns } } }
    const actor = Object.freeze({}) as TeamSystemWorkflowProof
    const scope: TeamSystemWorkflowScope = { kind: 'team-run-workflow-channel-open', teamId: f.teamId, coordinator: plan.actor,
      planId: plan.id, expectedRevision: plan.revision, expectedCursor: input.expectedCursor,
      adapter: input.adapter, viewPolicy: input.viewPolicy, participants: input.participants, limits: input.limits }
    const unregister = f.ctx.teams.registerSystemWorkflowProofSource({ name: 'team-run', resolveWorkflowProof: proof => proof === actor ? scope : undefined })
    let channel: ChannelSnapshot
    try { channel = await f.ctx.teams.openChannel({ actor, ...input }) } finally { unregister() }
    await f.consent(channel)
    retireExtension?.()
    const last = await f.ctx.teams.postChannelEnvelope({ actor: f.coordinatorActor,
      expectedCursor: (await f.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      draft: { channelId: channel.manifest.id, audience: [f.human.id], kind: 'handoff', delivery: 'turn', payload: { text: 'WORKFLOW_LAST_TURN' },
        ...mode === 'expired' ? { ttlMs: 1 } : {} } })
    if (mode === 'manual-close') {
      const closeInput = { teamId: f.teamId, planId: plan.id, expectedRevision: plan.revision,
        expectedTeamCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor, channelId: channel.manifest.id,
        expectedCursor: (await f.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor }
      const closeActor = Object.freeze({}) as TeamSystemWorkflowProof
      const closeScope: TeamSystemWorkflowScope = { kind: 'team-run-workflow-channel-close', coordinator: plan.actor, ...closeInput }
      const remove = f.ctx.teams.registerSystemWorkflowProofSource({ name: 'team-run', resolveWorkflowProof: proof => proof === closeActor ? closeScope : undefined })
      try { await f.ctx.teams.closeWorkflowChannel({ actor: closeActor, ...closeInput }) } finally { remove() }
    }
    expect((await f.ctx.teams.getChannel({ channelId: channel.manifest.id })).phase).toBe('closed')
    if (mode === 'extension-terminal') {
      expect(f.ctx.workflowExtensions.get('target', extension.name, extension.version)).toBeUndefined()
      expect(f.ctx.workflowExtensions.getLeaseMetrics().activeExtensionLeases).toBeGreaterThan(0)
      f.ctx.workflowExtensions.register(extension)
    }
    if (mode === 'expired') vi.spyOn(Date, 'now').mockReturnValue(last.createdAt + 2)
    if (mode === 'cancelled') await f.ctx.teams.cancelTeam({ actor: f.coordinatorActor, teamId: f.teamId,
      expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('cancel-workflow-outbox'), reason: { code: 'CANCEL', message: 'Cancel before endpoint delivery' } })
    if (mode === 'manual-close' || mode === 'expired' || mode === 'cancelled') {
      const delivery = { teamId: f.teamId, channelId: channel.manifest.id, envelopeId: last.id, recipientId: f.human.id,
        principalId: productPrincipalId('closed-human'), expectedCursor: (await f.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor }
      const proof = Object.freeze({}) as TeamSystemHumanDeliveryProof
      f.ctx.teams.registerSystemHumanDeliveryProofSource({ name: 'team-human-client', resolveHumanDeliveryProof: candidate => candidate === proof ? delivery : undefined })
      await expect(f.ctx.teams.admitHumanChannelDelivery({ actor: proof, ...delivery })).rejects.toThrow(mode === 'expired' ? 'expired' : mode === 'cancelled' ? 'not pending' : 'closed')
      const records = (await f.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
      expect(records.some(record => record.type === 'channel/receipt' && record.envelopeId === last.id)).toBe(false)
      return
    }
    await f.ctx.plugin(HumanClient, { storagePageSize: 16, maxPageSize: 16, maxDeliveryBytes: 262144, maxPendingOperations: 64, watchTimeoutMs: 1000, pollIntervalMs: 10 })
    await vi.waitFor(async () => {
      const records = (await f.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).records
      expect(records.filter(record => record.type === 'channel/receipt' && record.envelopeId === last.id && record.participantId === f.human.id)).toHaveLength(1)
    })
    await expect(f.ctx.teams.postChannelEnvelope({ actor: f.coordinatorActor,
      expectedCursor: (await f.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      draft: { channelId: channel.manifest.id, audience: [f.human.id], kind: 'handoff', delivery: 'turn', payload: { text: 'Too late' } } })).rejects.toThrow('not active')
  })
  it('drains an ordinary closed response while its Team is quiescing for completion', async () => {
    const f = await setup(); const response = await f.respond()
    const finalChannel = await openTestChannel(f.ctx, { teamId: f.teamId, expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
      adapter: { type: 'direct', version: 4 }, participants: [{ id: f.human.id, role: 'human' }, { id: f.coordinator.id, role: 'coordinator' }], limits: {} })
    await f.consent(finalChannel)
    const final = await f.ctx.teams.postChannelEnvelope({ actor: f.coordinatorActor, expectedCursor: (await f.ctx.teams.getChannel({ channelId: finalChannel.manifest.id })).cursor,
      draft: { channelId: finalChannel.manifest.id, audience: [f.human.id], kind: 'final', payload: { text: 'Complete' }, delivery: 'turn' } })
    const actor = Object.freeze({}) as TeamSystemClosureProof
    const scope: TeamSystemClosureScope = { kind: 'team-run-complete', teamId: f.teamId, channelId: final.channelId,
      humanId: f.human.id, coordinatorId: f.coordinator.id, finalEnvelopeId: final.id }
    f.ctx.teams.registerSystemClosureProofSource({ name: 'team-run', resolveClosureProof: proof => proof === actor ? scope : undefined })
    await f.ctx.teams.completeTeam({ actor, teamId: f.teamId, expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('complete-outbox'), reason: { code: 'COMPLETE', message: 'Complete after drainage' }, finalChannelId: final.channelId, finalEnvelopeId: final.id })
    expect((await f.ctx.teams.getTeam({ teamId: f.teamId })).team.phase).toBe('quiescing')
    await f.ctx.plugin(HumanClient, { storagePageSize: 16, maxPageSize: 16, maxDeliveryBytes: 262144, maxPendingOperations: 64, watchTimeoutMs: 1000, pollIntervalMs: 10 })
    await vi.waitFor(async () => {
      const records = (await f.ctx.teams.readChannel({ channelId: f.channel.manifest.id, afterCursor: -1 })).records
      expect(records.filter(record => record.type === 'channel/receipt' && record.envelopeId === response.id && record.participantId === f.human.id)).toHaveLength(1)
    })
    expect(await f.ctx.teams.claimChannelDelivery({ actor: f.coordinatorActor, channelId: f.channel.manifest.id, envelopeId: f.request.id })).toBeUndefined()
  })
  it.each(['expired', 'cancelled'] as const)('refuses a %s closed human delivery before sink admission', async (mode) => {
    const f = await setup(); const response = await f.respond(mode === 'expired' ? 1 : undefined)
    if (mode === 'expired') vi.spyOn(Date, 'now').mockReturnValue(response.createdAt + 2)
    else await f.ctx.teams.cancelTeam({ actor: f.coordinatorActor, teamId: f.teamId,
      expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('cancel-outbox'), reason: { code: 'CANCEL', message: 'Cancel before delivery' } })
    const input: TeamSystemHumanDeliveryScope = { teamId: f.teamId, channelId: f.channel.manifest.id, envelopeId: response.id,
      recipientId: f.human.id, principalId: productPrincipalId('closed-human'), expectedCursor: (await f.ctx.teams.getChannel({ channelId: f.channel.manifest.id })).cursor }
    const actor = Object.freeze({}) as TeamSystemHumanDeliveryProof
    f.ctx.teams.registerSystemHumanDeliveryProofSource({ name: 'team-human-client', resolveHumanDeliveryProof: proof => proof === actor ? input : undefined })
    await expect(f.ctx.teams.admitHumanChannelDelivery({ actor, ...input })).rejects.toThrow(mode === 'expired' ? 'expired' : 'not pending')
  })
  it('does not revive a consult that was manually closed before its response', async () => {
    const f = await setup(false)
    await closeTestChannel(f.ctx, { channelId: f.channel.manifest.id, expectedCursor: (await f.ctx.teams.getChannel({ channelId: f.channel.manifest.id })).cursor })
    await expect(f.ctx.teams.claimChannelDelivery({ actor: f.coordinatorActor, channelId: f.channel.manifest.id, envelopeId: f.request.id })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  })
})
