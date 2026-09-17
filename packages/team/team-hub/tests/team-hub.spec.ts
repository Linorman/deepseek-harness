import type { TeamListPageRequest } from '@clocky/clocky-team'
import { fingerprintChannelSummarySources } from '@clocky/clocky-team'
import { admitTestFinal } from './final-admission-fixture.ts'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import type {
  ActivationBindingSnapshot,
  ChannelCloseInput,
  ChannelEvent,
  ChannelOpenInput,
  ChannelSnapshot,
  ParticipantSnapshot,
  TeamActorProof,
  TeamChannelAdapter,
  TeamEvent,
  TeamPolicy,
  TeamPolicyRequest,
  TeamSystemClosureProof,
  TeamSystemClosureScope,
  TeamSystemClosureDriverProof,
  TeamSystemClosureDriverScope,
  TeamSystemFinalReceiptProof,
  TeamSystemFinalReceiptScope,
  TeamSystemMaintenanceProof,
  TeamSystemMaintenanceScope,
  TeamSystemInterruptProof,
  TeamSystemInterruptScope,
  TeamHumanActorProof,
  TeamHumanActorProofInput,
  TeamHumanActorProofSource,
  TeamHumanActorScope,
  TeamSystemWorkflowProof,
  TeamSystemWorkflowScope,
  TeamSystemDelegationProof,
  TeamSystemDelegationScope,
  TeamSystemChannelAdmissionProof,
  TeamSystemChannelAdmissionScope,
  ChannelId,
  TeamChildCreateInput,
  TeamTaskSnapshot,
  TeamSystemTaskControlProof,
  TeamSystemTaskControlScope,
  TeamTaskId,
  TeamId,
  TeamViewPolicy,
} from '@clocky/clocky-team'
import { activationIdSchema, channelInvitationIdempotencyKeySchema, channelSummaryIdempotencyKeySchema, fingerprintChannelManifest, fingerprintTeamHumanActorPayload, jsonObjectSchema, participantIdSchema, teamAuthorityGrantSchema, teamClosureIdempotencyKeySchema, teamHumanActionIdSchema, teamHumanActionSourceIdSchema, teamTaskCreateIdempotencyKeySchema, teamUsageSampleIdSchema, teamWorkspaceAllocationIdSchema, teamWorkflowPlanIdempotencyKeySchema, teamWorkflowPlanSchema } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import TeamHub, {
  AUDIT_PROJECTION_FORMAT_VERSION,
  CHANNEL_WAL_FORMAT_VERSION,
  TEAM_CHECKPOINT_FORMAT_VERSION,
  TEAM_JOURNAL_FORMAT_VERSION,
} from '../src/index.ts'
import { teamProjectionData, teamProjectionFromData } from '../src/fold.ts'
import type { Config as TeamHubConfig } from '../src/index.ts'
import type { TeamJournalRecord, TeamProjection } from '../src/types.ts'
import * as WorkflowChannel from '@clocky/clocky-team-channel-workflow'
import { workflowChannelAdapter } from '@clocky/clocky-team-channel-workflow'
import { assignTestTask, bindTestActivation, createTestCoordinatorTask, expireTestTask, fenceTestActivation, postActor, provisionTestCoordinator, quiesceTestActivation, seedTeamPhase, testHumanActionAuthority, updateTestActivationStatus, updateTestCoordinatorTask } from './fixtures.ts'
import { archiveTestTerminalTeam, createTestChildTeam, createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { summarizeTestChannel } from '../../../core/team/tests/channel-summary-authority.ts'
import {
  activateTestWorkspaceAllocation,
  confirmTestWorkspaceAllocationRelease,
  preserveTestWorkspaceAllocation,
  requestTestWorkspaceAllocationRelease,
  reserveTestWorkspaceAllocation,
} from '../../../core/team/tests/workspace-allocation-authority.ts'
type Backend = 'json' | 'sqlite'
interface Harness {
  readonly ctx: Context
  readonly root: string
  dispose(): Promise<void>
}

/** Open a retained-channel fixture only after every activation endpoint has a durable ACK. */
async function openRetainedTestChannel(
  ctx: Context,
  input: ChannelOpenInput,
  participantIds: readonly ParticipantSnapshot['id'][],
): Promise<ChannelSnapshot> {
  for (const participantId of participantIds) await postActor(ctx, input.teamId, participantId)
  const current = await ctx.teams.getTeam({ teamId: input.teamId })
  const opened = await openTestChannel(ctx, { ...input, expectedCursor: current.team.cursor })
  await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
  return await ctx.teams.getChannel({ channelId: opened.manifest.id })
}

/** Open a generic fixture channel and complete the activation-backed endpoints before use. */
async function openActiveTestChannel(
  ctx: Context,
  input: ChannelOpenInput,
  activationParticipantIds: readonly ParticipantSnapshot['id'][],
  systemHumanIds: readonly ParticipantSnapshot['id'][] = [],
): Promise<ChannelSnapshot> {
  for (const participantId of activationParticipantIds) await postActor(ctx, input.teamId, participantId)
  const current = await ctx.teams.getTeam({ teamId: input.teamId })
  const opened = await openTestChannel(ctx, { ...input, expectedCursor: current.team.cursor })
  await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
  for (const participantId of systemHumanIds) await acknowledgeSystemHumanChannel(ctx, opened.manifest.id, participantId)
  return await ctx.teams.getChannel({ channelId: opened.manifest.id })
}
const roots: string[] = []
const channelAdmissionProofs = new WeakMap<Context, WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>>()

/** Issue one fixture-owned system-human endpoint proof for exact interrupt-channel consent. */
function systemHumanAdmissionActor(ctx: Context, scope: TeamSystemChannelAdmissionScope): TeamSystemChannelAdmissionProof {
  let proofs = channelAdmissionProofs.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
    proofs = sourceProofs
    channelAdmissionProofs.set(ctx, sourceProofs)
    ctx.teams.registerSystemChannelAdmissionProofSource({
      name: 'team-run',
      resolveChannelAdmissionProof: proof => sourceProofs.get(proof),
    })
  }
  const proof = Object.freeze({}) as TeamSystemChannelAdmissionProof
  proofs.set(proof, scope)
  return proof
}

/** Acknowledge one exact system-owned human channel endpoint. */
async function acknowledgeSystemHumanChannel(ctx: Context, channelId: ChannelId, participantId: ParticipantSnapshot['id']): Promise<void> {
  const channel = await ctx.teams.getChannel({ channelId })
  const admission = await ctx.teams.getChannelAdmission({ channelId })
  const invitation = admission.invitations.find(item => item.participantId === participantId)
  if (invitation === undefined || invitation.status === 'acknowledged') return
  const idempotencyKey = channelInvitationIdempotencyKeySchema.parse(`interrupt-human:${String(participantId)}`)
  await ctx.teams.acknowledgeChannelInvitation({
    actor: systemHumanAdmissionActor(ctx, {
      kind: 'channel-invitation-acknowledge', teamId: channel.manifest.teamId, channelId, participantId,
      revision: invitation.revision, manifestFingerprint: fingerprintChannelManifest(channel.manifest), idempotencyKey,
    }),
    channelId, revision: invitation.revision, manifestFingerprint: fingerprintChannelManifest(channel.manifest), idempotencyKey,
  })
}
const delegationProofs = new WeakMap<Context, WeakMap<TeamSystemDelegationProof, TeamSystemDelegationScope>>()

/** Issue one test-local delegation proof for a real parent reservation. */
function delegationProof(ctx: Context, scope: TeamSystemDelegationScope): TeamSystemDelegationProof {
  let proofs = delegationProofs.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemDelegationProof, TeamSystemDelegationScope>()
    proofs = sourceProofs
    delegationProofs.set(ctx, sourceProofs)
    ctx.teams.registerSystemDelegationProofSource({
      name: 'team-delegation',
      resolveDelegationProof: proof => sourceProofs.get(proof),
      resolveChildWorkspace: async () => process.cwd(),
    })
  }
  const proof = Object.freeze({}) as TeamSystemDelegationProof
  proofs.set(proof, scope)
  return proof
}
const taskDefaults = {
  requiredCapabilities: [],
  priority: 0,
  readScopes: [],
  workspaceMode: 'shared' as const,
  budget: {},
  reviewPolicy: { kind: 'none' as const },
  maxAttempts: 3,
}
/** Issue one test-local human proof bound to its participant and complete input. */
function issueHumanActorProof(
  proofs: Map<TeamHumanActorProof, TeamHumanActorScope>,
  participantId: ParticipantSnapshot['id'],
  input: TeamHumanActorProofInput,
): TeamHumanActorProof {
  const proof = Object.freeze({}) as TeamHumanActorProof
  proofs.set(proof, {
    teamId: input.teamId,
    participantId,
    operation: input.operation,
    payloadFingerprint: fingerprintTeamHumanActorPayload(input),
    fence: input.fence,
  })
  return proof
}
afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('retained channel implementations', () => {
  it('continues an admitted channel after registration retirement and releases its leases at terminal quiescence', async () => {
    const harness = await setup('json')
    const adapterFiber = await harness.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.teams.registerAdapter(retainedAdapter)
    }, { inject: ['teams'] }))
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Exercise retained channel implementations.', budgets: {} }, rules: {}, budgets: {},
      })
      const sender = await activeServiceParticipant(harness.ctx, created.team.id, 'sender', 'local-agent')
      const recipient = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'recipient', 'Recipient')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openRetainedTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: retainedAdapter.type, version: retainedAdapter.version },
        viewPolicy: { type: directedViewPolicy.type, version: directedViewPolicy.version },
        participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
        limits: {},
      }, [sender.id, recipient.id])
      await adapterFiber.dispose()
      expect(() => harness.ctx.teams.getAdapter({ type: retainedAdapter.type, version: retainedAdapter.version }))
        .toThrow(expect.objectContaining({ code: 'TEAM_ADAPTER_NOT_FOUND' }))
      const senderActor = await postActor(harness.ctx, created.team.id, sender.id)
      const posted = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'Retained implementation remains callable.' },
          delivery: 'turn',
        },
      })
      const recipientActor = await postActor(harness.ctx, created.team.id, recipient.id)
      const current = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      const claim = await harness.ctx.teams.claimChannelDelivery({
        actor: recipientActor,
        channelId: channel.manifest.id,
        envelopeId: posted.id,
      })
      expect(claim).toMatchObject({ envelopeId: posted.id, delivery: 'turn' })
      await harness.ctx.teams.ackChannelEnvelope({
        actor: recipientActor,
        channelId: channel.manifest.id,
        envelopeId: posted.id,
        expectedCursor: current.cursor,
      })
      const acknowledged = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      await closeTestChannel(harness.ctx, {
        channelId: channel.manifest.id,
        expectedCursor: acknowledged.cursor,
        reason: 'terminal retained lease test',
      })
      const hub = harness.ctx.teams as unknown as {
        readonly channels: Map<string, unknown>
      }
      expect(hub.channels.has(channel.manifest.id)).toBe(false)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 0,
        activeAdapterLeases: 0,
        activeViewPolicyLeases: 0,
      })
    } finally {
      await adapterFiber.dispose()
      await harness.dispose()
    }
  })
  it('rejects channel recovery when its exact adapter version is unavailable', async () => {
    const first = await setup('json')
    const adapterFiber = await first.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.teams.registerAdapter(retainedAdapter)
    }, { inject: ['teams'] }))
    let second: Harness | undefined
    try {
      const created = await createTestRootTeam(first.ctx, {
        goal: { objective: 'Reject missing adapter versions.', budgets: {} }, rules: {}, budgets: {},
      })
      const participant = await activeServiceParticipant(first.ctx, created.team.id, 'participant', 'local-agent')
      const state = await first.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openTestChannel(first.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: retainedAdapter.type, version: retainedAdapter.version },
        participants: [{ id: participant.id, role: 'participant' }],
        limits: {},
      })
      await first.dispose()
      second = await setup('json', first.root)
      await expect(second.ctx.teams.getChannel({ channelId: channel.manifest.id }))
        .rejects.toMatchObject({ code: 'TEAM_ADAPTER_NOT_FOUND' })
      const hub = second.ctx.teams as unknown as { readonly channels: Map<string, unknown> }
      expect(hub.channels.has(channel.manifest.id)).toBe(false)
      expect(second.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        activeAdapterLeases: 0,
        activeViewPolicyLeases: 0,
      })
    } finally {
      await adapterFiber.dispose()
      if (second === undefined) await first.dispose()
      else await second.dispose()
    }
  })
  it('retains retired implementations while a terminal channel still has pending delivery', async () => {
    const harness = await setup('json')
    const adapterFiber = await harness.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.teams.registerAdapter(retainedAdapter)
      ctx.teams.registerViewPolicy(retainedViewPolicy)
    }, { inject: ['teams'] }))
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Drain a terminal channel delivery.', budgets: {} }, rules: {}, budgets: {},
      })
      const sender = await activeServiceParticipant(harness.ctx, created.team.id, 'sender', 'local-agent')
      const recipient = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'recipient', 'Recipient')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openRetainedTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: retainedAdapter.type, version: retainedAdapter.version },
        viewPolicy: { type: retainedViewPolicy.type, version: retainedViewPolicy.version },
        participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
        limits: {},
      }, [sender.id, recipient.id])
      const posted = await harness.ctx.teams.postChannelEnvelope({
        actor: await postActor(harness.ctx, created.team.id, sender.id),
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'Keep the implementation for this delivery.' },
          delivery: 'turn',
        },
      })
      await adapterFiber.dispose()
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 1,
        activeAdapterLeases: 1,
        retiredViewPolicyImplementations: 1,
        activeViewPolicyLeases: 1,
      })
      const closed = await closeTestChannel(harness.ctx, {
        channelId: channel.manifest.id,
        expectedCursor: posted.sequence,
      })
      const hub = harness.ctx.teams as unknown as { readonly channels: Map<string, unknown> }
      expect(hub.channels.has(channel.manifest.id)).toBe(true)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 1,
        activeAdapterLeases: 1,
        retiredViewPolicyImplementations: 1,
        activeViewPolicyLeases: 1,
      })
      await harness.ctx.teams.ackChannelEnvelope({
        actor: await postActor(harness.ctx, created.team.id, recipient.id),
        channelId: channel.manifest.id,
        envelopeId: posted.id,
        expectedCursor: closed.cursor,
      })
      expect(hub.channels.has(channel.manifest.id)).toBe(false)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 0,
        activeAdapterLeases: 0,
        retiredViewPolicyImplementations: 0,
        activeViewPolicyLeases: 0,
      })
    } finally {
      await adapterFiber.dispose()
      await harness.dispose()
    }
  })
  it('renders a delivery through a retired view policy before terminal lease release', async () => {
    const harness = await setup('json')
    const adapterFiber = await harness.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.teams.registerAdapter(causalityAdapter)
      ctx.teams.registerViewPolicy(retainedViewPolicy)
    }, { inject: ['teams'] }))
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Retain the delivery view policy.', budgets: {} }, rules: {}, budgets: {},
      })
      const sender = await activeServiceParticipant(harness.ctx, created.team.id, 'sender', 'local-agent')
      const recipient = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'recipient', 'Recipient')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openRetainedTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: causalityAdapter.type, version: causalityAdapter.version },
        viewPolicy: { type: retainedViewPolicy.type, version: retainedViewPolicy.version },
        participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
        limits: {},
      }, [sender.id, recipient.id])
      const posted = await harness.ctx.teams.postChannelEnvelope({
        actor: await postActor(harness.ctx, created.team.id, sender.id),
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'Render through the retired policy.' },
          delivery: 'turn',
        },
      })
      await adapterFiber.dispose()
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 1,
        activeAdapterLeases: 1,
        retiredViewPolicyImplementations: 1,
        activeViewPolicyLeases: 1,
      })
      const claim = await harness.ctx.teams.claimChannelDelivery({
        actor: await postActor(harness.ctx, created.team.id, recipient.id),
        channelId: channel.manifest.id,
        envelopeId: posted.id,
      })
      expect(claim?.view?.content.some(block => block.type === 'text' && block.text.includes('retained-view'))).toBe(true)
      const current = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      await harness.ctx.teams.ackChannelEnvelope({
        actor: await postActor(harness.ctx, created.team.id, recipient.id),
        channelId: channel.manifest.id,
        envelopeId: posted.id,
        expectedCursor: current.cursor,
      })
      const acknowledged = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      await closeTestChannel(harness.ctx, {
        channelId: channel.manifest.id,
        expectedCursor: acknowledged.cursor,
      })
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 0,
        activeAdapterLeases: 0,
        retiredViewPolicyImplementations: 0,
        activeViewPolicyLeases: 0,
      })
    } finally {
      await adapterFiber.dispose()
      await harness.dispose()
    }
  })
  it('retains workflow graph extensions through Hub channel terminal close', async () => {
    const harness = await setup('json', undefined, undefined, { workflowPlugin: true })
    const extensionFiber = await harness.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.workflowExtensions.register({
        kind: 'condition',
        name: 'p0-retained-condition',
        version: 1,
        validate() {},
        evaluate() { return false },
      })
      ctx.workflowExtensions.register({
        kind: 'target',
        name: 'p0-retained-target',
        version: 1,
        validate() {},
        resolve() { return { kind: 'terminate' } },
      })
      ctx.workflowExtensions.register({
        kind: 'target',
        name: 'p0-retained-default',
        version: 1,
        validate() {},
        resolve() { return { kind: 'terminate' } },
      })
    }, { inject: ['workflowExtensions'] }))
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Retain workflow extensions.', budgets: {} }, rules: {}, budgets: {},
      })
      const sender = await activeServiceParticipant(harness.ctx, created.team.id, 'sender', 'local-agent')
      const recipient = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'recipient', 'Recipient')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openRetainedTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'workflow', version: 1 },
        viewPolicy: { type: directedViewPolicy.type, version: directedViewPolicy.version },
        participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
        limits: {
          graph: {
            initial: { kind: 'participant', participantId: sender.id },
            transitions: [{
              condition: { kind: 'extension', name: 'p0-retained-condition', version: 1, config: {} },
              target: { kind: 'extension', name: 'p0-retained-target', version: 1, config: {} },
            }],
            defaultTarget: { kind: 'extension', name: 'p0-retained-default', version: 1, config: {} },
            maxTurns: 1,
          },
        },
      }, [sender.id, recipient.id])
      await extensionFiber.dispose()
      expect(harness.ctx.workflowExtensions.getLeaseMetrics()).toMatchObject({
        acceptingExtensions: 0,
        retiredExtensions: 3,
        activeExtensionLeases: 3,
      })
      const posted = await harness.ctx.teams.postChannelEnvelope({
        actor: await postActor(harness.ctx, created.team.id, sender.id),
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'Retained workflow extension remains callable.' },
          delivery: 'turn',
        },
      })
      expect(await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).toMatchObject({ phase: 'closed' })
      expect(harness.ctx.workflowExtensions.getLeaseMetrics()).toMatchObject({
        retiredExtensions: 3,
        activeExtensionLeases: 3,
      })
      await harness.ctx.teams.ackChannelEnvelope({
        actor: await postActor(harness.ctx, created.team.id, recipient.id),
        channelId: channel.manifest.id,
        envelopeId: posted.id,
        expectedCursor: posted.sequence + 2,
      })
      expect(harness.ctx.workflowExtensions.getLeaseMetrics()).toMatchObject({
        retiredExtensions: 0,
        activeExtensionLeases: 0,
      })
    } finally {
      await extensionFiber.dispose()
      await harness.dispose()
    }
  })
  it('releases every channel lease when adapter-private cleanup throws', async () => {
    const harness = await setup('json')
    const adapterFiber = await harness.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.teams.registerAdapter(runtimeReleaseThrowsAdapter)
      ctx.teams.registerViewPolicy(retainedViewPolicy)
    }, { inject: ['teams'] }))
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Release all channel leases.', budgets: {} }, rules: {}, budgets: {},
      })
      const participant = await activeServiceParticipant(harness.ctx, created.team.id, 'participant', 'local-agent')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: runtimeReleaseThrowsAdapter.type, version: runtimeReleaseThrowsAdapter.version },
        viewPolicy: { type: retainedViewPolicy.type, version: retainedViewPolicy.version },
        participants: [{ id: participant.id, role: 'participant' }],
        limits: {},
      })
      await adapterFiber.dispose()
      await closeTestChannel(harness.ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor })
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 0,
        activeAdapterLeases: 0,
        retiredViewPolicyImplementations: 0,
        activeViewPolicyLeases: 0,
      })
    } finally {
      await adapterFiber.dispose()
      await harness.dispose()
    }
  })
  it('does not publish an orphan channel before Team attachment commits', async () => {
    const harness = await setup('json')
    const events: ChannelEvent[] = []
    harness.ctx.on('channel/changed', (event) => { events.push(event) })
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Keep failed channel attachment invisible.', budgets: {} }, rules: {}, budgets: {},
      })
      const participant = await activeServiceParticipant(harness.ctx, created.team.id, 'participant', 'local-agent')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const before = await harness.ctx.storageLog.list()
      const internals = harness.ctx.teams as unknown as {
        commitTeam(...args: unknown[]): Promise<void>
      }
      const commit = vi.spyOn(internals, 'commitTeam').mockImplementation(async () => {
        throw new Error('attachment failed')
      })
      try {
        await expect(openTestChannel(harness.ctx, {
          teamId: created.team.id,
          expectedCursor: state.team.cursor,
          adapter: { type: 'direct', version: 1 },
          participants: [{ id: participant.id, role: 'participant' }],
          limits: {},
        })).rejects.toThrow('attachment failed')
      } finally {
        commit.mockRestore()
      }
      expect(events).toEqual([])
      const after = await harness.ctx.storageLog.list()
      const channelNamesBefore = before.filter(info => info.name.startsWith('channel/')).map(info => info.name)
      const channelNamesAfter = after.filter(info => info.name.startsWith('channel/')).map(info => info.name)
      expect(channelNamesAfter).toHaveLength(channelNamesBefore.length + 1)
      const channelAuditPrefix = `audit/${created.team.id}/channel/`
      expect(after.filter(info => info.name.startsWith(channelAuditPrefix))).toHaveLength(
        before.filter(info => info.name.startsWith(channelAuditPrefix)).length,
      )
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        activeAdapterLeases: 0,
        activeViewPolicyLeases: 0,
      })
    } finally {
      await harness.dispose()
    }
  })
  it('does not release an active channel lease while disposal waits past its timeout', async () => {
    const harness = await setup('json', undefined, { disposalTimeoutMs: 2 })
    const adapterFiber = await harness.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.teams.registerAdapter(retainedAdapter)
      ctx.teams.registerViewPolicy(retainedViewPolicy)
    }, { inject: ['teams'] }))
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const unregister = harness.ctx.teams.registerPolicy('send', {
      name: 'block-send-during-disposal',
      async apply(_request, next) {
        entered.resolve(undefined)
        await release.promise
        return await next()
      },
    })
    const teams = harness.ctx.teams
    let disposal: Promise<void> | undefined
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Keep active leases through bounded disposal.', budgets: {} }, rules: {}, budgets: {},
      })
      const sender = await activeServiceParticipant(harness.ctx, created.team.id, 'sender', 'local-agent')
      const recipient = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'recipient', 'Recipient')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openRetainedTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: retainedAdapter.type, version: retainedAdapter.version },
        viewPolicy: { type: retainedViewPolicy.type, version: retainedViewPolicy.version },
        participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
        limits: {},
      }, [sender.id, recipient.id])
      const post = harness.ctx.teams.postChannelEnvelope({
        actor: await postActor(harness.ctx, created.team.id, sender.id),
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'The active implementation must remain leased.' },
          delivery: 'context',
        },
      })
      await entered.promise
      await adapterFiber.dispose()
      disposal = harness.dispose()
      let settled = false
      void disposal.then(() => { settled = true }, () => { settled = true })
      await new Promise<void>((resolve) => { setTimeout(resolve, 10) })
      expect(settled).toBe(false)
      expect(teams.getImplementationLeaseMetrics()).toMatchObject({
        retiredAdapterImplementations: 1,
        activeAdapterLeases: 1,
        retiredViewPolicyImplementations: 1,
        activeViewPolicyLeases: 1,
      })
      release.resolve(undefined)
      await expect(post).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
      await disposal
      expect(teams.getImplementationLeaseMetrics()).toMatchObject({
        activeAdapterLeases: 0,
        activeViewPolicyLeases: 0,
      })
    } finally {
      release.resolve(undefined)
      unregister()
      await adapterFiber.dispose()
      if (disposal === undefined) await harness.dispose()
    }
  })
  it('renders a claimed view from the triggering Envelope state rather than later WAL state', async () => {
    const harness = await setup('json', undefined, { recoveryPageSize: 1 })
    const adapterFiber = await harness.ctx.plugin(Object.assign((ctx: Context) => {
      ctx.teams.registerAdapter(causalityAdapter)
    }, { inject: ['teams'] }))
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Keep delivery views causal.', budgets: {} }, rules: {}, budgets: {},
      })
      const sender = await activeServiceParticipant(harness.ctx, created.team.id, 'sender', 'local-agent')
      const recipient = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'recipient', 'Recipient')
      const state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await openRetainedTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: causalityAdapter.type, version: causalityAdapter.version },
        viewPolicy: { type: directedViewPolicy.type, version: directedViewPolicy.version },
        participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
        limits: {},
      }, [sender.id, recipient.id])
      const senderActor = await postActor(harness.ctx, created.team.id, sender.id)
      const first = await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'first' },
          delivery: 'turn',
        },
      })
      const afterFirst = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      await harness.ctx.teams.postChannelEnvelope({
        actor: senderActor,
        expectedCursor: afterFirst.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'second' },
          delivery: 'turn',
        },
      })
      const recipientActor = await postActor(harness.ctx, created.team.id, recipient.id)
      const claim = await harness.ctx.teams.claimChannelDelivery({
        actor: recipientActor,
        channelId: channel.manifest.id,
        envelopeId: first.id,
      })
      const text = claim?.view?.content[0]
      expect(text).toMatchObject({ type: 'text' })
      if (text?.type !== 'text') throw new Error('claim did not retain a text model view')
      expect(JSON.parse(text.text)).toMatchObject({ view: { envelopes: [first.id] } })
      expect(claim?.view?.sourceEnvelopeIds).toEqual([first.id])
    } finally {
      await adapterFiber.dispose()
      await harness.dispose()
    }
  })
})
describe('authenticated human goal authority', () => {
  it('re-resolves a payload-bound human proof before durable goal acceptance', async () => {
    const harness = await setup('json')
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const source: TeamHumanActorProofSource = {
      name: 'team-human-actor',
      resolveHumanActorProof: proof => proofs.get(proof),
    }
    const teams = harness.ctx.get('teams')
    if (teams === undefined) throw new Error('Team Hub fixture did not publish its runtime')
    const unregister = teams.registerHumanActorProofSource(source)
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Authorize an authenticated human goal edit.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Authenticated human',
        role: 'owner',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: 'principal-team-hub-test' as never },
        authorityGrant: {
          operations: ['goal-mutate'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {},
        },
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const input = {
        teamId: created.team.id,
        expectedRevision: state.team.goal.revision,
        objective: 'Human-authorized durable goal.',
      }
      const bound = {
        teamId: input.teamId,
        operation: 'goal-mutate' as const,
        fence: { kind: 'revision' as const, revision: input.expectedRevision },
        payload: {
          teamId: input.teamId,
          expectedRevision: input.expectedRevision,
          objective: input.objective,
        },
      }
      const proof = Object.freeze({}) as TeamHumanActorProof
      proofs.set(proof, {
        teamId: input.teamId,
        participantId: human.id,
        operation: 'goal-mutate',
        payloadFingerprint: fingerprintTeamHumanActorPayload(bound),
        fence: bound.fence,
      })
      await expect(harness.ctx.teams.updateTeamGoal({ actor: proof, ...input })).resolves.toMatchObject({
        team: { goal: { objective: input.objective } },
      })
      const changed = { ...input, expectedRevision: input.expectedRevision + 1, objective: 'Tampered goal.' }
      await expect(harness.ctx.teams.updateTeamGoal({ actor: proof, ...changed })).rejects.toMatchObject({
        code: 'TEAM_ACTOR_PROOF_INVALID',
      })
      const terminalInput = {
        teamId: created.team.id,
        expectedRevision: (await harness.ctx.teams.getTeam({ teamId: created.team.id })).goal.revision,
        objective: 'Terminal human goal mutation.',
      }
      const terminalBound = {
        teamId: terminalInput.teamId,
        operation: 'goal-mutate' as const,
        fence: { kind: 'revision' as const, revision: terminalInput.expectedRevision },
        payload: jsonObjectSchema.parse(structuredClone(terminalInput)),
      }
      const terminalProof = Object.freeze({}) as TeamHumanActorProof
      proofs.set(terminalProof, {
        teamId: terminalInput.teamId,
        participantId: human.id,
        operation: terminalBound.operation,
        payloadFingerprint: fingerprintTeamHumanActorPayload(terminalBound),
        fence: terminalBound.fence,
      })
      const quiescing = await seedTeamPhase(harness.ctx, created.team.id, 'quiescing')
      await seedTeamPhase(harness.ctx, quiescing.team.id, 'completed')
      await expect(harness.ctx.teams.updateTeamGoal({ actor: terminalProof, ...terminalInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    } finally {
      unregister()
      await harness.dispose()
    }
  })
  it('accepts only exact human proofs for member invitation, activation, removal, and interruption', async () => {
    const harness = await setup('json')
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const source: TeamHumanActorProofSource = {
      name: 'team-human-member-actor',
      resolveHumanActorProof: proof => proofs.get(proof),
    }
    const teams = harness.ctx.get('teams')
    if (teams === undefined) throw new Error('Team Hub fixture did not publish its runtime')
    const unregister = teams.registerHumanActorProofSource(source)
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Control participant membership through a human proof.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Authenticated owner',
        role: 'owner',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: 'principal-member-test' as never },
        authorityGrant: {
          operations: ['invite', 'activate', 'close', 'interrupt'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {},
        },
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const inviteInput = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'local-agent' as const,
        displayName: 'Managed member',
        role: 'member',
        capabilities: [],
      }
      const invited = await harness.ctx.teams.inviteParticipant({
        actor: issueHumanActorProof(proofs, human.id, {
          teamId: inviteInput.teamId,
          operation: 'invite',
          fence: { kind: 'cursor', cursor: inviteInput.expectedCursor },
          payload: jsonObjectSchema.parse(structuredClone(inviteInput)),
        }),
        ...inviteInput,
      })
      expect(invited.phase).toBe('invited')
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const activateInput = {
        teamId: created.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active' as const,
      }
      const activated = await harness.ctx.teams.transitionParticipantPhase({
        actor: issueHumanActorProof(proofs, human.id, {
          teamId: activateInput.teamId,
          operation: 'activate',
          fence: { kind: 'cursor', cursor: activateInput.expectedCursor },
          payload: jsonObjectSchema.parse(structuredClone(activateInput)),
        }),
        ...activateInput,
      })
      expect(activated.phase).toBe('active')
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const removeInput = {
        teamId: created.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'left' as const,
      }
      const removed = await harness.ctx.teams.transitionParticipantPhase({
        actor: issueHumanActorProof(proofs, human.id, {
          teamId: removeInput.teamId,
          operation: 'close',
          fence: { kind: 'cursor', cursor: removeInput.expectedCursor },
          payload: jsonObjectSchema.parse(structuredClone(removeInput)),
        }),
        ...removeInput,
      })
      expect(removed.phase).toBe('left')
      await provisionTestCoordinator(harness.ctx, created.team.id)
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const coordinator = state.participants.find(participant => participant.role === 'coordinator')
      if (coordinator === undefined) throw new Error('interrupt fixture did not create a coordinator')
      const interruptInput = {
        teamId: created.team.id, participantId: coordinator.id, expectedCursor: state.team.cursor,
      }
      const interruptProof = issueHumanActorProof(proofs, human.id, {
        teamId: interruptInput.teamId,
        operation: 'interrupt',
        fence: { kind: 'cursor', cursor: interruptInput.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(interruptInput)),
      })
      const interrupt = await harness.ctx.teams.requestParticipantInterrupt({ actor: interruptProof, ...interruptInput })
      expect(interrupt).toMatchObject({ actorId: human.id, target: { participantId: coordinator.id } })
      await expect(harness.ctx.teams.requestParticipantInterrupt({
        actor: interruptProof,
        ...interruptInput,
        expectedCursor: interruptInput.expectedCursor + 1,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const revokedInvite = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'local-agent' as const,
        displayName: 'Revoked member',
        role: 'member',
        capabilities: [],
      }
      const revokedProof = issueHumanActorProof(proofs, human.id, {
        teamId: revokedInvite.teamId,
        operation: 'invite',
        fence: { kind: 'cursor', cursor: revokedInvite.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(revokedInvite)),
      })
      const unregisterPolicy = teams.registerPolicy('invite', {
        name: 'revoke-human-member-proof-after-policy',
        async apply(_request, next) {
          proofs.delete(revokedProof)
          return await next()
        },
      })
      try {
        await expect(harness.ctx.teams.inviteParticipant({ actor: revokedProof, ...revokedInvite }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        unregisterPolicy()
      }
      expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).participants)
        .toHaveLength(state.participants.length)
    } finally {
      unregister()
      await harness.dispose()
    }
  })
  it('derives a human channel sender from a payload-bound proof and revalidates it before WAL admission', async () => {
    const harness = await setup('json')
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const source: TeamHumanActorProofSource = {
      name: 'team-human-actor',
      resolveHumanActorProof: proof => proofs.get(proof),
    }
    const unregister = harness.ctx.teams.registerHumanActorProofSource(source)
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Authorize an authenticated human channel post.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Authenticated human',
        role: 'human',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: 'principal-channel-post-test' as never },
        authorityGrant: { operations: ['send', 'channel-open'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} },
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const recipient = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'local-agent',
        displayName: 'Recipient',
        role: 'recipient',
        capabilities: [],
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: recipient.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: recipient.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      await postActor(harness.ctx, created.team.id, recipient.id)
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      let channel = await openTestChannel(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: human.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
        limits: {},
      })
      await acknowledgeTestChannelActivations(harness.ctx, channel.manifest.id)
      const admission = await harness.ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
      const invitation = admission.invitations.find(item => item.participantId === human.id)
      if (invitation === undefined) throw new Error('authenticated human channel fixture lost its invitation')
      const idempotencyKey = channelInvitationIdempotencyKeySchema.parse('authenticated-human-channel')
      const humanAck = {
        channelId: channel.manifest.id,
        revision: invitation.revision,
        manifestFingerprint: fingerprintChannelManifest(channel.manifest),
        idempotencyKey,
      }
      const ackProof = issueHumanActorProof(proofs, human.id, {
        teamId: created.team.id,
        operation: 'channel-open',
        fence: { kind: 'revision', revision: invitation.revision },
        payload: jsonObjectSchema.parse(humanAck),
      })
      await harness.ctx.teams.acknowledgeChannelInvitation({ actor: ackProof, ...humanAck })
      channel = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      const post = {
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [recipient.id],
          kind: 'message',
          payload: { text: 'Authenticated human post.' },
          delivery: 'turn' as const,
        },
      }
      const bind = (proof: TeamHumanActorProof, input: typeof post): void => {
        const bound: TeamHumanActorProofInput = {
          teamId: created.team.id,
          operation: 'send',
          fence: { kind: 'cursor', cursor: input.expectedCursor },
          payload: jsonObjectSchema.parse(structuredClone(input)),
        }
        proofs.set(proof, {
          teamId: created.team.id,
          participantId: human.id,
          operation: 'send',
          payloadFingerprint: fingerprintTeamHumanActorPayload(bound),
          fence: bound.fence,
        })
      }
      const proof = Object.freeze({}) as TeamHumanActorProof
      bind(proof, post)
      await expect(harness.ctx.teams.postChannelEnvelope({ actor: proof, ...post })).resolves.toMatchObject({
        senderId: human.id,
        teamId: created.team.id,
        channelId: channel.manifest.id,
      })
      const current = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      const freshPost = { ...post, expectedCursor: current.cursor }
      const tamperedProof = Object.freeze({}) as TeamHumanActorProof
      bind(tamperedProof, freshPost)
      await expect(harness.ctx.teams.postChannelEnvelope({
        actor: tamperedProof,
        ...freshPost,
        draft: { ...freshPost.draft, payload: { text: 'Tampered post.' } },
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const policyProof = Object.freeze({}) as TeamHumanActorProof
      bind(policyProof, freshPost)
      const unregisterPolicy = harness.ctx.teams.registerPolicy('send', {
        name: 'revoke-human-post-after-policy',
        async apply(_request, next) {
          proofs.delete(policyProof)
          return await next()
        },
      })
      try {
        await expect(harness.ctx.teams.postChannelEnvelope({ actor: policyProof, ...freshPost }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        unregisterPolicy()
      }
      await expect(harness.ctx.teams.getChannel({ channelId: channel.manifest.id }))
        .resolves.toMatchObject({ cursor: current.cursor })
    } finally {
      unregister()
      await harness.dispose()
    }
  })
  it('derives authenticated-human channel lifecycle authority from exact parsed inputs', async () => {
    const harness = await setup('json')
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const unregister = harness.ctx.teams.registerHumanActorProofSource({
      name: 'team-human-channel-actor',
      resolveHumanActorProof: proof => proofs.get(proof),
    })
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Control ordinary channels through an authenticated human.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Authenticated human',
        role: 'owner',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: 'principal-channel-lifecycle-test' as never },
        authorityGrant: {
          operations: ['channel-open', 'close'], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {},
        },
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const recipient = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'local-agent',
        displayName: 'Recipient',
        role: 'recipient',
        capabilities: [],
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: recipient.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: recipient.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const issue = (input: TeamHumanActorProofInput): { readonly proof: TeamHumanActorProof; revoke(): void } => {
        const proof = Object.freeze({}) as TeamHumanActorProof
        proofs.set(proof, {
          teamId: input.teamId,
          participantId: human.id,
          operation: input.operation,
          payloadFingerprint: fingerprintTeamHumanActorPayload(input),
          fence: input.fence,
        })
        return { proof, revoke: (): void => { proofs.delete(proof) } }
      }
      const openProofInput = (input: ChannelOpenInput): TeamHumanActorProofInput => ({
        teamId: input.teamId,
        operation: 'channel-open',
        fence: { kind: 'cursor', cursor: input.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(input)),
      })
      const closeProofInput = (input: ChannelCloseInput): TeamHumanActorProofInput => ({
        teamId: created.team.id,
        operation: 'close',
        fence: { kind: 'cursor', cursor: input.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(input)),
      })
      const openInput: Omit<ChannelOpenInput, 'workflowPlanId' | 'expectedPlanRevision'> = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: human.id, role: 'owner' }, { id: recipient.id, role: 'recipient' }],
        limits: {},
      }
      await expect(harness.ctx.teams.openChannel({
        actor: {} as TeamHumanActorProof,
        authorityKind: 'human',
        ...openInput,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const accepted = issue(openProofInput(openInput))
      const channel = await harness.ctx.teams.openChannel({
        actor: accepted.proof,
        authorityKind: 'human',
        ...openInput,
      })
      accepted.revoke()
      expect(channel.manifest).toMatchObject({ teamId: created.team.id, participants: openInput.participants })
      const stale = issue(openProofInput(openInput))
      await expect(harness.ctx.teams.openChannel({
        actor: stale.proof,
        authorityKind: 'human',
        ...openInput,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      stale.revoke()
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const revokedInput = { ...openInput, expectedCursor: state.team.cursor }
      const revoked = issue(openProofInput(revokedInput))
      const unregisterPolicy = harness.ctx.teams.registerPolicy('channel-open', {
        name: 'revoke-human-channel-open-after-policy',
        async apply(_request, next) {
          proofs.delete(revoked.proof)
          return await next()
        },
      })
      try {
        await expect(harness.ctx.teams.openChannel({
          actor: revoked.proof,
          authorityKind: 'human',
          ...revokedInput,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        unregisterPolicy()
      }
      expect((await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor).toBe(state.team.cursor)
      const current = await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })
      const closeInput: ChannelCloseInput = {
        channelId: channel.manifest.id,
        expectedCursor: current.cursor,
        reason: 'Authenticated human closed this ordinary channel.',
      }
      await expect(harness.ctx.teams.closeChannel({
        actor: {} as TeamHumanActorProof,
        ...closeInput,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const closing = issue(closeProofInput(closeInput))
      await expect(harness.ctx.teams.closeChannel({ actor: closing.proof, ...closeInput }))
        .resolves.toMatchObject({ phase: 'closed' })
      closing.revoke()
    } finally {
      unregister()
      await harness.dispose()
    }
  })
})
/** Compose the Hub over a real JSON or SQLite log backend. */
interface SetupOptions {
  readonly workflowPlugin?: boolean
}
async function setup(
  backend: Backend,
  root?: string,
  config?: TeamHubConfig,
  options: SetupOptions = {},
): Promise<Harness> {
  const durableRoot = root ?? await freshRoot()
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    if (backend === 'json') {
      await ctx.plugin(StorageJson, { root: durableRoot })
    } else {
      await ctx.plugin(StorageSqlite, { path: join(durableRoot, 'team-hub.db') })
    }
    await ctx.plugin(StorageLog, { backend, routes: {} })
    await ctx.plugin(TeamHub, config)
    ctx.teams.registerAdapter(directAdapter)
    ctx.teams.registerAdapter(directV4Adapter)
    if (options.workflowPlugin === true) await ctx.plugin(WorkflowChannel)
    else ctx.teams.registerAdapter(workflowChannelAdapter)
    ctx.teams.registerViewPolicy(directedViewPolicy)
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
  return {
    ctx,
    root: durableRoot,
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}
/** Create a project-local test directory so durable artifacts remain in the workspace. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-'))
  roots.push(root)
  return root
}
/** Read a Hub cursor activity's retained waiter count through a test-only structural view. */
function waiterCount(ctx: Context, kind: 'team' | 'channel', id: string): number {
  const hub = ctx.teams as unknown as {
    teams: Map<string, { activity: { waiters: Set<unknown> } }>
    channels: Map<string, { activity: { waiters: Set<unknown> } }>
  }
  const loaded = (kind === 'team' ? hub.teams : hub.channels).get(id)
  if (loaded === undefined) throw new Error(`Team Hub did not retain ${kind} '${id}'`)
  return loaded.activity.waiters.size
}
const directAdapter: TeamChannelAdapter = {
  type: 'direct',
  version: 1,
  validateCreate() {},
  initialState() { return { opened: true } },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
}
/** Fail a settled fixture through current controller quiescence and durable closure authority. */
async function failDurableFixture(ctx: Context, teamId: TeamId, authority = teamRunClosureAuthority(ctx)) {
  const state = await ctx.teams.getTeam({ teamId })
  for (const binding of state.activations) {
    await quiesceTestActivation(ctx, {
      teamId, activationId: binding.activation.id, participantId: binding.activation.participantId,
      sessionId: binding.sessionId, provider: binding.provider,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    })
  }
  const actor = authority.issue({ kind: 'team-run-create-failure', teamId })
  const closing = await ctx.teams.failTeam({ actor: actor.proof, teamId,
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    idempotencyKey: teamClosureIdempotencyKeySchema.parse(`durable-failure:${teamId}`),
    reason: { code: 'FIXTURE_FAILED', message: 'The fixture owner has settled its resources.' },
  })
  actor.revoke()
  const closure = closing.team.closure
  if (closure?.kind !== 'fail') throw new Error('Failure fixture did not retain its closure intent')
  const proof = Object.freeze({}) as TeamSystemClosureDriverProof
  const scopes = new WeakMap<TeamSystemClosureDriverProof, TeamSystemClosureDriverScope>([[proof, {
    kind: 'closure-recover-fail', teamId, expectedCursor: closing.team.cursor,
    closureIdempotencyKey: closure.idempotencyKey, closureRequestedAt: closure.requestedAt,
  }]])
  const unregister = ctx.teams.registerSystemClosureDriverProofSource({
    name: 'team-closure-driver', resolveClosureDriverProof: candidate => scopes.get(candidate),
  })
  try {
    const failed = await ctx.teams.continueTeamClosure({ actor: proof, teamId, expectedCursor: closing.team.cursor })
    expect(failed.team.phase).toBe('failed')
    return failed
  } finally { unregister() }
}
/** Default TeamRun topology marker used by closure-proof tests. */
const directV3Adapter: TeamChannelAdapter = { ...directAdapter, version: 3 }
const directV4Adapter: TeamChannelAdapter = {
  ...directAdapter,
  version: 4,
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
}
const pendingDirectV3Adapter: TeamChannelAdapter = {
  ...directV3Adapter,
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
}
/** Complete a task-free fixture through durable final admission, receipts and controller quiescence. */
async function completeDurableFixture(ctx: Context, teamId: TeamId) {
  ctx.teams.registerAdapter(pendingDirectV3Adapter)
  const human = await activeTeamParticipant(ctx, teamId, 'human', 'human', 'Final recipient')
  const state = await ctx.teams.getTeam({ teamId })
  const coordinator = state.participants.find(member => member.role === 'coordinator')
    ?? await activeTeamParticipant(ctx, teamId, 'local-agent', 'coordinator', 'Coordinator')
  const coordinatorActor = await postActor(ctx, teamId, coordinator.id)
  const channel = await openActiveTestChannel(ctx, {
    teamId,
    expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'direct', version: 4 },
    participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
    limits: {},
  }, [coordinator.id], [human.id])
  const final = await ctx.teams.postChannelEnvelope({
    actor: coordinatorActor,
    expectedCursor: channel.cursor,
    draft: { channelId: channel.manifest.id, audience: [human.id], kind: 'final',
      payload: { text: 'Durably completed.' }, delivery: 'turn' },
  })
  const scope = { teamId, channelId: channel.manifest.id, humanId: human.id, coordinatorId: coordinator.id }
  const closer = teamRunClosureAuthority(ctx).issue({ kind: 'team-run-complete', ...scope, finalEnvelopeId: final.id })
  const closing = await ctx.teams.completeTeam({
    actor: closer.proof, teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    idempotencyKey: teamClosureIdempotencyKeySchema.parse(`durable-completion:${teamId}`),
    reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'Complete the durable fixture.' },
    finalChannelId: channel.manifest.id, finalEnvelopeId: final.id,
  })
  closer.revoke()
  const receipt = Object.freeze({}) as TeamSystemFinalReceiptProof
  const receipts = new WeakMap<TeamSystemFinalReceiptProof, TeamSystemFinalReceiptScope>([[receipt, scope]])
  const unregisterReceipt = ctx.teams.registerSystemFinalReceiptProofSource({
    name: 'team-run', resolveFinalReceiptProof: proof => receipts.get(proof),
  })
  try {
    await admitTestFinal(ctx, receipt, final)
    await ctx.teams.ackChannelEnvelope({ actor: receipt, channelId: channel.manifest.id, envelopeId: final.id,
      expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor })
  } finally { unregisterReceipt() }
  for (const binding of closing.activations) {
    await quiesceTestActivation(ctx, {
      teamId, activationId: binding.activation.id, participantId: binding.activation.participantId,
      sessionId: binding.sessionId, provider: binding.provider,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    })
  }
  const current = await ctx.teams.getTeam({ teamId })
  const closure = current.team.closure
  if (closure === undefined) throw new Error('Completion fixture did not retain its closure intent')
  const continuation = Object.freeze({}) as TeamSystemClosureDriverProof
  const continuations = new WeakMap<TeamSystemClosureDriverProof, TeamSystemClosureDriverScope>([[continuation, {
    kind: 'closure-recover-complete', teamId, expectedCursor: current.team.cursor,
    closureIdempotencyKey: closure.idempotencyKey, closureRequestedAt: closure.requestedAt,
    finalChannelId: channel.manifest.id, finalEnvelopeId: final.id,
  }]])
  const unregisterDriver = ctx.teams.registerSystemClosureDriverProofSource({
    name: 'team-closure-driver', resolveClosureDriverProof: proof => continuations.get(proof),
  })
  try {
    const completed = await ctx.teams.continueTeamClosure({ actor: continuation, teamId, expectedCursor: current.team.cursor })
    expect(completed.team.phase).toBe('completed')
    return completed
  } finally { unregisterDriver() }
}
const wakeAdapter: TeamChannelAdapter = {
  ...directAdapter,
  type: 'wake',
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
}
const retainedAdapter: TeamChannelAdapter = {
  ...directAdapter,
  type: 'retained',
  allowsClosedDelivery() { return true },
  deliveryPlan({ envelope }) {
    return (envelope.audience ?? []).map(participantId => ({
      participantId,
      envelopeId: envelope.id,
      delivery: envelope.delivery,
    }))
  },
}
const runtimeReleaseThrowsAdapter: TeamChannelAdapter = {
  ...retainedAdapter,
  type: 'runtime-release-throws',
  acquireRuntimeLease() {
    return {
      adapter: this,
      release() { throw new Error('adapter-private cleanup failed') },
    }
  },
}
const causalityAdapter: TeamChannelAdapter = {
  ...retainedAdapter,
  type: 'discussion',
  initialState() { return { count: 0 } },
  fold(state, record) {
    if (record.type !== 'channel/envelope') return state
    const count = typeof (state as { readonly count?: unknown }).count === 'number'
      ? (state as { readonly count: number }).count
      : 0
    return { count: count + 1 }
  },
  projectView({ state }) {
    return { count: (state as { readonly count: number }).count }
  },
}
const summaryPolicy: TeamViewPolicy = {
  type: 'test-summary',
  version: 1,
  project: ({ records }) => ({
    summaries: records.flatMap(record => record.type === 'channel/summary' ? [{
      text: record.text,
      sourceEnvelopeIds: record.sourceEnvelopeIds,
      coveredSequenceRange: record.coveredSequenceRange,
    }] : []),
  }),
}
/** Minimal registered policy for generic channel fixtures that need model-view admission. */
const directedViewPolicy: TeamViewPolicy = {
  type: 'directed',
  version: 1,
  project: ({ records }) => ({
    envelopes: records.flatMap(record => record.type === 'channel/envelope' ? [record.envelope.id] : []),
  }),
}
/** View policy used to verify retention across provider retirement. */
const retainedViewPolicy: TeamViewPolicy = {
  type: 'retained-view',
  version: 1,
  project: () => ({ source: 'retained-view' }),
}
/** Create one non-serializable proof that only the scheduler's maintenance source can resolve. */
function maintenanceProof(): TeamSystemMaintenanceProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('scheduler maintenance proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemMaintenanceProof
}
/** Register test-local exact scheduler maintenance scopes for destructive compaction requests. */
function schedulerMaintenanceAuthority(ctx: Context): {
  issue(scope: TeamSystemMaintenanceScope): TeamSystemMaintenanceProof
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemMaintenanceProof, TeamSystemMaintenanceScope>()
  const dispose = ctx.teams.registerSystemMaintenanceProofSource({
    name: 'team-scheduler-dag',
    resolveMaintenanceProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = maintenanceProof()
      proofs.set(proof, scope)
      return proof
    },
    dispose,
  })
}
/** Register scheduler compaction proofs that a policy test may revoke after admission. */
function revocableSchedulerMaintenanceAuthority(ctx: Context): {
  issue(scope: TeamSystemMaintenanceScope): { readonly proof: TeamSystemMaintenanceProof; revoke(): void }
  dispose(): void
} {
  const proofs = new Map<TeamSystemMaintenanceProof, TeamSystemMaintenanceScope>()
  const dispose = ctx.teams.registerSystemMaintenanceProofSource({
    name: 'team-scheduler-dag',
    resolveMaintenanceProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = maintenanceProof()
      proofs.set(proof, scope)
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
    dispose,
  })
}
/** Create one non-serializable proof that only the TeamRun workflow compiler source can resolve. */
function workflowProof(): TeamSystemWorkflowProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team-run workflow proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemWorkflowProof
}
/** Register test-local exact TeamRun workflow compiler scopes. */
function workflowAuthority(ctx: Context): {
  issue(scope: TeamSystemWorkflowScope): TeamSystemWorkflowProof
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemWorkflowProof, TeamSystemWorkflowScope>()
  const dispose = ctx.teams.registerSystemWorkflowProofSource({
    name: 'team-run',
    resolveWorkflowProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = workflowProof()
      proofs.set(proof, scope)
      return proof
    },
    dispose,
  })
}
/** Create one non-serializable proof that only the TeamRun default-worker task-control source can resolve. */
function taskControlProof(): TeamSystemTaskControlProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team-run task-control proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemTaskControlProof
}
/** Register test-local exact TeamRun default-worker task-control scopes. */
function taskControlAuthority(ctx: Context): {
  issue(scope: TeamSystemTaskControlScope): TeamSystemTaskControlProof
  dispose(): void
} {
  const proofs = new WeakMap<TeamSystemTaskControlProof, TeamSystemTaskControlScope>()
  const dispose = ctx.teams.registerSystemTaskControlProofSource({
    name: 'team-run',
    resolveTaskControlProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = taskControlProof()
      proofs.set(proof, scope)
      return proof
    },
    dispose,
  })
}
/** Provision one active member and a pending task for common Hub scenarios. */
async function populated(ctx: Context) {
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Review the change', budgets: {} }, rules: { mode: 'local' }, budgets: { tokens: 10 } })
  await provisionTestCoordinator(ctx, team.team.id)
  let state = await ctx.teams.getTeam({ teamId: team.team.id })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId: team.team.id,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName: 'Reviewer',
    role: 'reviewer',
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: state.team.id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  const participant = await transitionBootstrapParticipant(ctx, {
    teamId: state.team.id,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  const task = await createTestCoordinatorTask(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    subject: 'Review',
    description: 'Inspect the patch.',
    blockedBy: [],
    writeScopes: ['packages/team'],
    ...taskDefaults,
  })
  return { team: await ctx.teams.getTeam({ teamId: team.team.id }), participant, task }
}
/** Create one pending task that can anchor a child-Team link. */
async function childAnchorTask(ctx: Context, teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id']) {
  await provisionTestCoordinator(ctx, teamId)
  const state = await ctx.teams.getTeam({ teamId })
  return await createTestCoordinatorTask(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    subject: 'Delegate child Team',
    description: 'Run nested work.',
    blockedBy: [],
    writeScopes: [],
    ...taskDefaults,
  })
}

/** Reserve one child-Team creation through the public delegation Consumer path. */
async function reservedChildTask(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  objective = 'Run nested work.',
  childBudgets: Readonly<Record<string, number>> = {},
): Promise<{ readonly task: TeamTaskSnapshot; readonly creation: TeamChildCreateInput }> {
  await provisionTestCoordinator(ctx, teamId)
  const state = await ctx.teams.getTeam({ teamId })
  if (state.team.authorityGrant === undefined) throw new Error('child fixture parent has no authority grant')
  const authorityGrant = { ...state.team.authorityGrant, workspaceModes: ['shared'] as const, readScopes: [], writeScopes: [] }
  const task = await createTestCoordinatorTask(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    subject: 'Delegate child Team',
    description: 'Run nested work.',
    blockedBy: [],
    writeScopes: [],
    ...taskDefaults,
    maxAttempts: 1,
    execution: { kind: 'child-team', templateId: 'team-hub-fixture', templateVersion: 1, authorityGrant, budget: {} },
  })
  const current = await ctx.teams.getTeam({ teamId })
  const child = {
    goal: { objective, budgets: childBudgets },
    rules: { workspacePath: process.cwd() },
    budgets: childBudgets,
    authorityGrant,
  }
  const input = {
    teamId,
    taskId: task.id,
    expectedCursor: current.team.cursor,
    expectedRevision: task.revision,
    delegationId: task.delegation!.id,
    child,
  }
  const reserved = await ctx.teams.beginTaskDelegation({
    actor: delegationProof(ctx, { kind: 'delegation-begin', ...input }),
    ...input,
  })
  const creation = reserved.delegation?.creation
  if (creation === undefined) throw new Error('child fixture reservation did not retain creation input')
  return { task: reserved, creation }
}
/** Invite and activate one Team participant for a focused Hub test. */
async function activeTeamParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  kind: 'human' | 'service' | 'local-agent',
  role: string,
  displayName: string,
) {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind,
    displayName,
    role,
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'provisioning' })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active' })
}

/** Invite a human endpoint with the system owner required by TeamRun channel consent. */
async function activeSystemHumanParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  role: string,
  displayName: string,
) {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId, expectedCursor: state.team.cursor, kind: 'human', displayName, role, capabilities: [], owner: { kind: 'system' },
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'provisioning' })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active' })
}
/** Invite and activate the service/local participant used by legacy Hub scenarios. */
async function activeServiceParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  role = 'worker',
  kind: 'service' | 'local-agent' = 'service',
) {
  return await activeTeamParticipant(ctx, teamId, kind, role, 'Child worker')
}
/** Create one opaque proof that only a registered TeamRun closure source can resolve. */
function createTeamRunClosureProof(): TeamSystemClosureProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team-run closure proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemClosureProof
}
/** Register a test-only TeamRun source with independently revocable closure proofs. */
function teamRunClosureAuthority(ctx: Context): {
  issue(scope: TeamSystemClosureScope): { readonly proof: TeamSystemClosureProof; revoke(): void }
} {
  const proofs = new WeakMap<TeamSystemClosureProof, TeamSystemClosureScope>()
  ctx.teams.registerSystemClosureProofSource({
    name: 'team-run',
    resolveClosureProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = createTeamRunClosureProof()
      proofs.set(proof, scope)
      return Object.freeze({
        proof,
        revoke: (): void => { proofs.delete(proof) },
      })
    },
  })
}
/** Create one non-serializable proof that only the TeamRun interrupt source can resolve. */
function createTeamRunInterruptProof(): TeamSystemInterruptProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('Team-run interrupt proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemInterruptProof
}
/** Register a test-local TeamRun source with exact human-to-coordinator interrupt proofs. */
function teamRunInterruptAuthority(ctx: Context): {
  issue(scope: TeamSystemInterruptScope): TeamSystemInterruptProof
} {
  const proofs = new WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>()
  ctx.teams.registerSystemInterruptProofSource({
    name: 'team-run',
    resolveInterruptProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = createTeamRunInterruptProof()
      proofs.set(proof, scope)
      return proof
    },
  })
}
/** Issue one current target-activation proof for interrupt discovery or acknowledgement. */
function interruptActor(ctx: Context, binding: ActivationBindingSnapshot): TeamActorProof {
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}
/** Create the exact default TeamRun topology required by a human interrupt proof. */
async function interruptTopology(ctx: Context, objective: string): Promise<{
  readonly team: Awaited<ReturnType<Context['teams']['createTeam']>>
  readonly human: ParticipantSnapshot
  readonly coordinator: ParticipantSnapshot
  readonly channel: ChannelSnapshot
}> {
  const team = await createTestRootTeam(ctx, { goal: { objective, budgets: {} }, rules: {}, budgets: {} })
  const human = await activeSystemHumanParticipant(ctx, team.team.id, 'human', 'Human')
  const coordinator = await activeTeamParticipant(ctx, team.team.id, 'local-agent', 'coordinator', 'Coordinator')
  let state = await ctx.teams.getTeam({ teamId: team.team.id })
  const bootstrap = await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: { id: activationIdSchema.parse('interrupt-bootstrap'), teamId: team.team.id, participantId: coordinator.id, status: 'idle' },
      sessionId: SessionId('interrupt-session'),
      provider: 'in-process',
    },
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: team.team.id,
    expectedCursor: state.team.cursor,
    adapter: { type: directV4Adapter.type, version: directV4Adapter.version },
    participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
    limits: {},
  })
  await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
  await acknowledgeSystemHumanChannel(ctx, channel.manifest.id, human.id)
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  await quiesceTestActivation(ctx, {
    teamId: team.team.id,
    activationId: bootstrap.activation.id,
    participantId: coordinator.id,
    sessionId: bootstrap.sessionId,
    provider: bootstrap.provider,
    expectedCursor: state.team.cursor,
  })
  return { team, human, coordinator, channel }
}
/** Build a valid two-task workflow plan for Hub persistence/restart tests. */
function workflowPlan() {
  return teamWorkflowPlanSchema.parse({
    version: 1,
    name: 'hub-restart-plan',
    tasks: [
      {
        id: 'first', subject: 'First', description: 'Run first.', blockedBy: [],
        requiredCapabilities: [], priority: 1, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      },
      {
        id: 'second', subject: 'Second', description: 'Run second.', blockedBy: ['first'],
        requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared',
        budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
      },
    ],
    bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
    channel: {
      participantRoles: ['coordinator', 'worker'],
      graph: {
        initial: { kind: 'participant', role: 'coordinator' },
        transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
        maxTurns: 1,
      },
    },
    result: { kind: 'task-results', taskTemplateIds: ['first', 'second'] },
  })
}
/** Bind one idle local activation before assigning a task to its agent participant. */
async function taskActivation(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: Awaited<ReturnType<typeof populated>>['participant']['id'],
) {
  const state = await ctx.teams.getTeam({ teamId })
  const binding = await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse('task-recovery-activation'),
        teamId,
        participantId,
        status: 'idle',
      },
      sessionId: SessionId('task-recovery-session'),
      provider: 'in-process',
    },
  })
  return binding.activation.id
}
/** Bind one local activation for participant-interrupt command tests. */
async function interruptActivation(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: ParticipantSnapshot['id'],
  activation = 'interrupt-activation',
  channelId?: ChannelId,
) {
  const state = await ctx.teams.getTeam({ teamId })
  const binding = await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: { id: activationIdSchema.parse(activation), teamId, participantId, status: 'idle' },
      sessionId: SessionId('interrupt-session'),
      provider: 'in-process',
    },
  })
  if (channelId !== undefined) {
    await acknowledgeTestChannelActivations(ctx, channelId)
    const current = await ctx.teams.getChannel({ channelId })
    await acknowledgeSystemHumanChannel(ctx, current.manifest.id, current.manifest.participants.find(member => member.role === 'human')!.id)
  }
  return binding
}
/** Bind one idle local activation and issue its proof for an exact usage reporter. */
async function usageAuthority(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: ParticipantSnapshot['id'],
  suffix: string,
): Promise<{ readonly binding: ActivationBindingSnapshot; readonly actor: TeamActorProof }> {
  const state = await ctx.teams.getTeam({ teamId })
  const binding = await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`usage-${suffix}-activation`),
        teamId,
        participantId,
        status: 'idle',
      },
      sessionId: SessionId(`usage-${suffix}-session`),
      provider: 'in-process',
    },
  })
  return { binding, actor: ctx.teams.openActivationActorProofIssuer().issue(binding).proof }
}
/** Issue one current activation proof for the Team's active coordinator fixture. */
async function coordinatorActor(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: ParticipantSnapshot['id'],
  suffix: string,
): Promise<TeamActorProof> {
  const state = await ctx.teams.getTeam({ teamId })
  const existing = state.activations.find(binding => (
    binding.activation.participantId === participantId
    && (binding.activation.status === 'idle' || binding.activation.status === 'running')
  ))
  const binding = existing ?? await bindTestActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(`coordinator-${suffix}-activation`),
        teamId,
        participantId,
        status: 'idle',
      },
      sessionId: SessionId(`coordinator-${suffix}-session`),
      provider: 'in-process',
    },
  })
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}
for (const backend of ['json', 'sqlite'] as const) {
  describe(`TeamHub durable recovery (${backend})`, () => {
    it('rejects a replayed duplicate active product-principal owner', async () => {
      const first = await setup(backend)
      const created = await createTestRootTeam(first.ctx, {
        goal: { objective: 'Reject duplicate durable human owners.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await first.ctx.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(first.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Durable owner',
        role: 'human',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: 'durable-owner' as never },
      })
      state = await first.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(first.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await first.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(first.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await first.ctx.teams.getTeam({ teamId: created.team.id })
      const root = first.root
      await first.dispose()
      const rawBackend = backend === 'json'
        ? new StorageJson.JsonStorageBackend(root)
        : new StorageSqlite.SqliteStorageBackend(new StorageSqlite.Config({ path: join(root, 'team-hub.db') }))
      const stream = await rawBackend.log.open({ name: `team/${created.team.id}`, version: TEAM_JOURNAL_FORMAT_VERSION })
      const duplicateId = participantIdSchema.parse(`duplicate-owner-${backend}`)
      const invited = {
        id: duplicateId,
        teamId: created.team.id,
        kind: 'human' as const,
        displayName: 'Duplicate durable owner',
        role: 'human',
        capabilities: [],
        phase: 'invited' as const,
        owner: { kind: 'product-principal' as const, principalId: 'durable-owner' as never },
      }
      const createdAt = state.team.updatedAt + 1
      const records = [
        { type: 'participant/changed', participant: invited, createdAt },
        { type: 'participant/changed', participant: { ...invited, phase: 'provisioning' as const }, createdAt: createdAt + 1 },
        { type: 'participant/changed', participant: { ...invited, phase: 'active' as const }, createdAt: createdAt + 2 },
      ] satisfies readonly TeamJournalRecord[]
      await stream.append(state.team.cursor, records)
      await stream.close()
      await rawBackend.close()
      const second = await setup(backend, root)
      await expect(second.ctx.teams.getTeam({ teamId: created.team.id }))
        .rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
      await second.dispose()
    })
    it('durably admits, binds, and restores a declarative workflow plan', async () => {
      const harness = await setup(backend)
      const created = await createTestRootTeam(harness.ctx, { goal: { objective: 'Run a workflow', budgets: {} }, rules: {}, budgets: {} })
      const coordinator = await activeServiceParticipant(harness.ctx, created.team.id, 'coordinator', 'local-agent')
      const worker = await activeServiceParticipant(harness.ctx, created.team.id, 'worker', 'local-agent')
      await postActor(harness.ctx, created.team.id, worker.id)
      const plan = workflowPlan()
      const workflowActor = await coordinatorActor(harness.ctx, created.team.id, coordinator.id, `workflow-${backend}`)
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const coordinatorBinding = state.activations.find(binding => binding.activation.participantId === coordinator.id)
      if (coordinatorBinding === undefined) throw new Error('workflow fixture did not retain its coordinator activation')
      const workflowCoordinator = {
        teamId: coordinatorBinding.activation.teamId,
        participantId: coordinatorBinding.activation.participantId,
        activationId: coordinatorBinding.activation.id,
        sessionId: coordinatorBinding.sessionId,
        provider: coordinatorBinding.provider,
      }
      let admitted = await harness.ctx.teams.admitWorkflowPlan({
        actor: workflowActor,
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('hub-workflow-plan'),
        plan,
      })
      const compiler = workflowAuthority(harness.ctx)
      const channelParticipants = [
        { id: coordinator.id, role: 'coordinator' },
        { id: worker.id, role: 'worker' },
      ]
      const channelLimits = {
        graph: {
          initial: { kind: 'participant' as const, participantId: coordinator.id },
          transitions: [{ condition: { kind: 'always' as const }, target: { kind: 'terminate' as const } }],
          maxTurns: 1,
        },
      }
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const channel = await harness.ctx.teams.openChannel({
        actor: compiler.issue({
          kind: 'team-run-workflow-channel-open',
          teamId: created.team.id,
          coordinator: workflowCoordinator,
          planId: admitted.id,
          expectedCursor: state.team.cursor,
          expectedRevision: admitted.revision,
          adapter: { type: 'workflow', version: 1 },
          viewPolicy: { type: directedViewPolicy.type, version: directedViewPolicy.version },
          participants: channelParticipants,
          limits: channelLimits,
        }),
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'workflow', version: 1 },
        viewPolicy: { type: directedViewPolicy.type, version: directedViewPolicy.version },
        workflowPlanId: admitted.id,
        expectedPlanRevision: admitted.revision,
        participants: channelParticipants,
        limits: channelLimits,
      })
      await acknowledgeTestChannelActivations(harness.ctx, channel.manifest.id)
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      admitted = await harness.ctx.teams.bindWorkflowPlanChannel({
        actor: compiler.issue({
          kind: 'team-run-workflow-channel-bind',
          teamId: created.team.id,
          coordinator: workflowCoordinator,
          planId: admitted.id,
          expectedCursor: state.team.cursor,
          expectedRevision: admitted.revision,
          channelId: channel.manifest.id,
        }),
        teamId: created.team.id,
        planId: admitted.id,
        expectedCursor: state.team.cursor,
        expectedRevision: admitted.revision,
        channelId: channel.manifest.id,
      })
      const taskIds = new Map<string, TeamTaskId>()
      for (const template of plan.tasks) {
        state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
        const task = await createTestCoordinatorTask(harness.ctx, {
          teamId: created.team.id,
          expectedCursor: state.team.cursor,
          workflowPlanId: admitted.id,
          workflowTemplateId: template.id,
          subject: template.subject,
          description: template.description,
          blockedBy: template.blockedBy.map((dependency) => {
            const taskId = taskIds.get(dependency)
            if (taskId === undefined) throw new Error(`missing task binding for '${dependency}'`)
            return taskId
          }),
          requiredCapabilities: template.requiredCapabilities,
          priority: template.priority,
          readScopes: template.readScopes,
          writeScopes: template.writeScopes,
          workspaceMode: template.workspaceMode,
          budget: template.budget,
          reviewPolicy: { kind: 'none' },
          maxAttempts: template.maxAttempts,
        })
        taskIds.set(template.id, task.id)
        state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
        admitted = await harness.ctx.teams.bindWorkflowPlanTask({
          actor: compiler.issue({
            kind: 'team-run-workflow-task-bind',
            teamId: created.team.id,
            coordinator: workflowCoordinator,
            planId: admitted.id,
            expectedCursor: state.team.cursor,
            expectedRevision: admitted.revision,
            templateId: template.id,
            taskId: task.id,
          }),
          teamId: created.team.id,
          planId: admitted.id,
          expectedCursor: state.team.cursor,
          expectedRevision: admitted.revision,
          templateId: template.id,
          taskId: task.id,
        })
      }
      const firstTaskId = taskIds.get('first')
      if (firstTaskId === undefined) throw new Error('workflow test did not bind its first task')
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await expect(updateTestCoordinatorTask(harness.ctx, {
        teamId: created.team.id,
        taskId: firstTaskId,
        expectedRevision: 1,
        description: 'Do not rewrite a compiled workflow task.',
      })).rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_INVALID' })
      await expect(harness.ctx.teams.cancelTask({
        actor: taskControlAuthority(harness.ctx).issue({
          kind: 'team-run-default-worker-cancel',
          teamId: created.team.id,
          coordinator: workflowCoordinator,
          taskId: firstTaskId,
          expectedRevision: 1,
        }),
        teamId: created.team.id,
        taskId: firstTaskId,
        expectedRevision: 1,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      admitted = await harness.ctx.teams.transitionWorkflowPlan({
        actor: compiler.issue({
          kind: 'team-run-workflow-plan-phase',
          teamId: created.team.id,
          coordinator: workflowCoordinator,
          planId: admitted.id,
          expectedCursor: state.team.cursor,
          expectedRevision: admitted.revision,
          phase: 'ready',
        }),
        teamId: created.team.id,
        planId: admitted.id,
        expectedCursor: state.team.cursor,
        expectedRevision: admitted.revision,
        phase: 'ready',
      })
      compiler.dispose()
      await harness.dispose()
      const recovered = await setup(backend, harness.root)
      const restored = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
      expect(restored.workflowPlans).toEqual([expect.objectContaining({ id: admitted.id, phase: 'ready', channelId: channel.manifest.id })])
      expect(restored.tasks.filter(task => task.workflowPlanId === admitted.id)).toHaveLength(2)
      expect((await recovered.ctx.teams.getWorkflowPlan({ teamId: created.team.id, planId: admitted.id })).taskBindings).toHaveLength(2)
      const replayActor = await coordinatorActor(recovered.ctx, created.team.id, coordinator.id, `workflow-replay-${backend}`)
      const replay = await recovered.ctx.teams.admitWorkflowPlan({
        actor: replayActor,
        teamId: created.team.id,
        expectedCursor: restored.team.cursor - 1,
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('hub-workflow-plan'),
        plan,
      })
      expect(replay.id).toBe(admitted.id)
      await expect(recovered.ctx.teams.admitWorkflowPlan({
        actor: replayActor,
        teamId: created.team.id,
        expectedCursor: restored.team.cursor,
        idempotencyKey: teamWorkflowPlanIdempotencyKeySchema.parse('hub-workflow-plan'),
        plan: { ...plan, name: 'different-plan' },
      })).rejects.toMatchObject({ code: 'TEAM_WORKFLOW_PLAN_IDEMPOTENCY_CONFLICT' })
      const closureActor = await postActor(recovered.ctx, created.team.id, coordinator.id)
      const beforeCancel = await recovered.ctx.teams.getTeam({ teamId: created.team.id })
      const cancelled = await recovered.ctx.teams.cancelTeam({
        teamId: created.team.id,
        expectedCursor: beforeCancel.team.cursor,
        idempotencyKey: teamClosureIdempotencyKeySchema.parse(`cancel-workflow-${backend}`),
        actor: closureActor,
        reason: { code: 'TEST_CANCELLED', message: 'The workflow cancellation path is under test.' },
      })
      expect(cancelled).toMatchObject({
        team: { phase: 'quiescing' },
        workflowPlans: [expect.objectContaining({ id: admitted.id, phase: 'cancelled',
          cancellation: { code: 'TEST_CANCELLED', message: 'The workflow cancellation path is under test.' } })],
      })
      await recovered.dispose()
    })
    it('atomically releases current task leases and fences their activation before replacement', async () => {
      const harness = await setup(backend)
      const seeded = await populated(harness.ctx)
      const activationId = await taskActivation(harness.ctx, seeded.team.team.id, seeded.participant.id)
      let state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const assigned = await assignTestTask(harness.ctx, {
        teamId: seeded.team.team.id,
        taskId: seeded.task.id,
        expectedRevision: seeded.task.revision,
        participantId: seeded.participant.id,
        activationId,
        leaseDurationMs: 10_000,
      })
      const lease = assigned.lease
      if (lease === undefined) throw new Error('assigned task must retain a lease')
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await expect(fenceTestActivation(harness.ctx, {
        teamId: seeded.team.team.id,
        activationId,
        participantId: seeded.participant.id,
        sessionId: SessionId('wrong-fenced-session'),
        provider: 'in-process',
        expectedCursor: state.team.cursor,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const fenced = await fenceTestActivation(harness.ctx, {
        teamId: seeded.team.team.id,
        activationId,
        participantId: seeded.participant.id,
        sessionId: SessionId('task-recovery-session'),
        provider: 'in-process',
        expectedCursor: state.team.cursor,
      })
      expect(fenced.activations.find(binding => binding.activation.id === activationId))
        .toMatchObject({ activation: { status: 'offline' }, quiescenceSource: 'fenced' })
      const fencedTask = fenced.tasks.find(task => task.id === seeded.task.id)
      expect(fencedTask).toMatchObject({
        phase: 'pending',
        attemptHistory: [{ id: lease.attemptId, outcome: { kind: 'released' } }],
      })
      expect(fencedTask?.lease).toBeUndefined()
      const replay = await fenceTestActivation(harness.ctx, {
        teamId: seeded.team.team.id,
        activationId,
        participantId: seeded.participant.id,
        sessionId: SessionId('task-recovery-session'),
        provider: 'in-process',
        expectedCursor: fenced.team.cursor,
      })
      expect(replay.team.cursor).toBe(fenced.team.cursor)
      await harness.dispose()
    })
    it('rejects oversized discovery metadata before materializing a Team journal', async () => {
      const harness = await setup(backend, undefined, { maxDiscoveryBytes: 128 })
      await expect(createTestRootTeam(harness.ctx, { goal: { objective: '界😀'.repeat(100), budgets: {} }, rules: {}, budgets: {} }))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      expect((await harness.ctx.storageLog.list()).filter(item => item.name.startsWith('team/'))).toEqual([])
      await harness.dispose()
    })

    it('discovers an exact current summary after restart without opening the Team journal', async () => {
      const first = await setup(backend)
      const created = await createTestRootTeam(first.ctx, { goal: { objective: 'Cold summary', budgets: {} }, rules: {}, budgets: {} })
      await seedTeamPhase(first.ctx, created.team.id, 'quiescing')
      const current = await first.ctx.teams.getTeam({ teamId: created.team.id })
      await first.dispose()
      const second = await setup(backend, first.root)
      const open = vi.spyOn(second.ctx.storageLog, 'open').mockRejectedValue(new Error('Discovery opened a journal'))
      expect((await second.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items).toEqual([current.team])
      expect(open).not.toHaveBeenCalled()
      expect((second.ctx.teams as TeamHub).inspectLoadedTeam(created.team.id)).toBeUndefined()
      open.mockRestore()
      expect((await second.ctx.teams.getTeam({ teamId: created.team.id })).team).toEqual(current.team)
      await second.dispose()
    })

    it('caps discovery work through archived Teams without using full stream listing', async () => {
      const first = await setup(backend)
      const archivedIds: TeamId[] = []
      const authority = teamRunClosureAuthority(first.ctx)
      for (let index = 0; index < 16; index += 1) {
        const created = await createTestRootTeam(first.ctx, { goal: { objective: `Archived ${index}`, budgets: {} }, rules: {}, budgets: {} })
        const ended = await failDurableFixture(first.ctx, created.team.id, authority)
        await archiveTestTerminalTeam(first.ctx, { teamId: ended.team.id, expectedCursor: ended.team.cursor })
        archivedIds.push(ended.team.id)
      }
      const visible = await createTestRootTeam(first.ctx, { goal: { objective: 'Visible work', budgets: {} }, rules: {}, budgets: {} })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      vi.spyOn(second.ctx.storageLog, 'list').mockRejectedValue(new Error('Unbounded stream listing was invoked'))
      const hub = second.ctx.teams as TeamHub
      const watching = new AbortController()
      const watch = second.ctx.teams.watchTeam({ teamId: visible.team.id, afterCursor: visible.team.cursor, signal: watching.signal })
      const observedWatch = watch.catch((error: unknown) => error)
      await vi.waitFor(() => { expect(hub.inspectLoadedTeam(visible.team.id)).toBeDefined() })
      const ids = [...archivedIds, visible.team.id]
      const loaded = () => ids.filter(id => hub.inspectLoadedTeam(id) !== undefined).length
      const opens = vi.spyOn(second.ctx.storageLog, 'open')
      const found: TeamId[] = []
      let cursor: TeamListPageRequest['afterCursor'] = -1
      let pages = 0
      for (;;) {
        const before = loaded()
        const page = await second.ctx.teams.listTeamsPage({ afterCursor: cursor, limit: 3 })
        pages += 1
        expect(page.scanned).toBeLessThanOrEqual(3)
        expect(loaded() - before).toBeLessThanOrEqual(3)
        found.push(...page.items.map(team => team.id))
        if (page.nextCursor === undefined) break
        expect(page.nextCursor).not.toBe(cursor)
        cursor = page.nextCursor
      }
      expect(opens).not.toHaveBeenCalled()
      opens.mockRestore()
      expect(found).toEqual([visible.team.id])
      expect(loaded()).toBe(1)
      expect(archivedIds.every(id => hub.inspectLoadedTeam(id) === undefined)).toBe(true)
      const archivedId = archivedIds[0]!
      expect((await second.ctx.teams.getTeam({ teamId: archivedId })).team.archivedAt).toBeDefined()
      expect(hub.inspectLoadedTeam(archivedId)).toBeUndefined()
      const historical = await second.ctx.teams.getTeam({ teamId: archivedId })
      await expect(second.ctx.teams.watchTeam({ teamId: archivedId, afterCursor: historical.team.cursor })).resolves.toEqual({ kind: 'closed' })
      expect(hub.inspectLoadedTeam(archivedId)).toBeUndefined()
      watching.abort()
      await observedWatch
      console.info('CLOCKY_TEAM_DISCOVERY_BOUND', JSON.stringify({ backend, pages, maxScanEntries: 3, retainedTeams: loaded() }))
      await second.dispose()
    })

    it('releases archived channel and audit handles while another Team is watched', async () => {
      const h = await setup(backend)
      const created = await createTestRootTeam(h.ctx, { goal: { objective: 'Archived history', budgets: {} }, rules: {}, budgets: {} })
      const complete = await completeDurableFixture(h.ctx, created.team.id)
      const archived = await archiveTestTerminalTeam(h.ctx, { teamId: created.team.id, expectedCursor: complete.team.cursor })
      const active = await createTestRootTeam(h.ctx, { goal: { objective: 'Watched work', budgets: {} }, rules: {}, budgets: {} })
      const controller = new AbortController()
      const watch = h.ctx.teams.watchTeam({ teamId: active.team.id, afterCursor: active.team.cursor, signal: controller.signal })
      const observed = watch.catch((error: unknown) => error)
      try {
        expect((await h.ctx.teams.getTeam({ teamId: archived.team.id })).team.archivedAt).toBeDefined()
        await h.ctx.teams.readAudit({ teamId: archived.team.id, afterCursor: -1, limit: 1 })
        const hub = h.ctx.teams as TeamHub
        expect(hub.inspectLoadedTeam(archived.team.id)).toBeUndefined()
        expect(archived.channelIds.every(id => hub.inspectLoadedChannel(id) === undefined)).toBe(true)
        expect(h.ctx.storageLog.get(`audit/${archived.team.id}`)).toBeUndefined()
        const originalOpen = h.ctx.storageLog.open.bind(h.ctx.storageLog)
        const opening = vi.spyOn(h.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
          if (descriptor.name === `audit/${archived.team.id}`) throw new Error('Audit read failed')
          return await originalOpen(descriptor)
        })
        try {
          await expect(h.ctx.teams.readAudit({ teamId: archived.team.id, afterCursor: -1, limit: 1 })).rejects.toThrow('Audit read failed')
          expect(hub.inspectLoadedTeam(archived.team.id)).toBeUndefined()
          expect(archived.channelIds.every(id => hub.inspectLoadedChannel(id) === undefined)).toBe(true)
        } finally { opening.mockRestore() }
      } finally { controller.abort(); await observed; await h.dispose() }
    })

    it('waits for archived stream eviction before a concurrent reader reopens it', async () => {
      const h = await setup(backend)
      const created = await createTestRootTeam(h.ctx, { goal: { objective: 'Concurrent archive reads', budgets: {} }, rules: {}, budgets: {} })
      const ended = await failDurableFixture(h.ctx, created.team.id)
      await archiveTestTerminalTeam(h.ctx, { teamId: ended.team.id, expectedCursor: ended.team.cursor })
      const closing = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const originalOpen = h.ctx.storageLog.open.bind(h.ctx.storageLog)
      let opened = 0
      const open = vi.spyOn(h.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await originalOpen(descriptor)
        if (descriptor.name === `team/${created.team.id}` && opened++ === 0) {
          const originalClose = stream.close.bind(stream)
          vi.spyOn(stream, 'close').mockImplementation(async () => {
            closing.resolve(undefined)
            await release.promise
            await originalClose()
          })
        }
        return stream
      })
      try {
        const first = h.ctx.teams.getTeam({ teamId: created.team.id })
        await closing.promise
        let secondFinished = false
        const second = h.ctx.teams.getTeam({ teamId: created.team.id }).then((value) => { secondFinished = true; return value })
        await new Promise(resolve => setImmediate(resolve))
        expect(secondFinished).toBe(false)
        expect(opened).toBe(1)
        release.resolve(undefined)
        expect((await first).team.archivedAt).toBeDefined()
        expect((await second).team.archivedAt).toBeDefined()
        expect(opened).toBe(2)
      } finally { release.resolve(undefined); open.mockRestore(); await h.dispose() }
    })

    it('archives terminal Teams durably and omits them from default listings', async () => {
      const first = await setup(backend)
      const created = await createTestRootTeam(first.ctx, { goal: { objective: 'Archive me', budgets: {} }, rules: {}, budgets: {} })
      const firstAudit = await first.ctx.teams.readAudit({ teamId: created.team.id, afterCursor: -1, limit: 1 })
      expect(firstAudit.items[0]).toMatchObject({ stream: 'team', cursor: 0, type: 'team/created' })
      expect(firstAudit.nextCursor).toBe(0)
      await expect(first.ctx.teams.readAudit({ teamId: created.team.id, afterCursor: -1, limit: 129 }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const state = await completeDurableFixture(first.ctx, created.team.id)
      const archived = await archiveTestTerminalTeam(first.ctx, { teamId: state.team.id, expectedCursor: state.team.cursor })
      expect(archived.team).toMatchObject({ phase: 'completed', archivedAt: archived.team.updatedAt })
      const archivedAudit = await first.ctx.teams.readAudit({ teamId: state.team.id, afterCursor: -1, limit: 128 })
      expect(archivedAudit.items.at(-1)).toMatchObject({ type: 'team/archived', cursor: archived.team.cursor })
      await expect(archiveTestTerminalTeam(first.ctx, { teamId: state.team.id, expectedCursor: 0 }))
        .resolves.toMatchObject({ team: { archivedAt: archived.team.archivedAt } })
      await expect(first.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      second.ctx.teams.registerAdapter(pendingDirectV3Adapter)
      await expect(second.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).resolves.toMatchObject({ items: [] })
      await expect(second.ctx.teams.getTeam({ teamId: state.team.id })).resolves.toMatchObject({
        team: { phase: 'completed', archivedAt: archived.team.archivedAt },
      })
      await second.dispose()
    })
    it('reads attached channel WAL records through the source-specific audit page', async () => {
      const harness = await setup(backend)
      const seeded = await populated(harness.ctx)
      const channel = await openTestChannel(harness.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: seeded.team.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'worker' }],
        limits: {},
      })
      const audit = await harness.ctx.teams.readAudit({
        teamId: seeded.team.team.id,
        channelId: channel.manifest.id,
        afterCursor: -1,
        limit: 1,
      })
      expect(audit).toMatchObject({ teamId: seeded.team.team.id, channelId: channel.manifest.id })
      expect(audit.items[0]).toMatchObject({ stream: 'channel', cursor: 0, type: 'channel/opened' })
      const finalPage = await harness.ctx.teams.readAudit({
        teamId: seeded.team.team.id,
        channelId: channel.manifest.id,
        afterCursor: 0,
        limit: 2,
      })
      expect(finalPage.items).toHaveLength(2)
      expect(finalPage.nextCursor).toBeUndefined()
      await harness.dispose()
    })
    it('repairs a missing audit suffix from the authoritative Team journal before reading', async () => {
      const first = await setup(backend)
      const created = await createTestRootTeam(first.ctx, { goal: { objective: 'Repair audit', budgets: {} }, rules: {}, budgets: {} })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      const source = await second.ctx.storageLog.open({
        name: `team/${created.team.id}`,
        version: TEAM_JOURNAL_FORMAT_VERSION,
      })
      const createdAt = Date.now() + 1_000
      await source.append(1, [{
        type: 'team/phase',
        phase: 'stalled',
        reason: { code: 'AUDIT_REPAIR', message: 'repair the derived audit projection' },
        createdAt,
      }])
      await source.close()
      const audit = await second.ctx.teams.readAudit({ teamId: created.team.id, afterCursor: -1, limit: 8 })
      expect(audit.items.at(-1)).toMatchObject({ cursor: 2, type: 'team/phase' })
      expect(second.ctx.teams.getMetrics()).toMatchObject({
        auditProjectionRepairs: 1,
        auditProjectionFailures: 0,
      })
      const streams = await second.ctx.storageLog.list()
      const auditInfo = streams.find(stream => stream.name === `audit/${created.team.id}`)
      expect(auditInfo).toMatchObject({
        name: `audit/${created.team.id}`,
        version: AUDIT_PROJECTION_FORMAT_VERSION,
        tailSequence: 2,
      })
      await second.dispose()
    })
    it('compacts terminal channel and audit prefixes behind verified checkpoints', async () => {
      const first = await setup(backend, undefined, { auditRetentionTail: 1 })
      const maintenance = schedulerMaintenanceAuthority(first.ctx)
      const created = await createTestRootTeam(first.ctx, {
        goal: { objective: 'Compact completed Team history.', budgets: {} }, rules: {}, budgets: {},
      })
      const participant = await activeTeamParticipant(first.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
      const seeded = { participant, team: await first.ctx.teams.getTeam({ teamId: created.team.id }) }
      const opened = await openActiveTestChannel(first.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: seeded.team.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'worker' }],
        limits: {},
      }, [seeded.participant.id])
      const actor = await postActor(first.ctx, seeded.team.team.id, seeded.participant.id)
      let channel = opened
      for (const text of ['one', 'two', 'three']) {
        await first.ctx.teams.postChannelEnvelope({
          actor,
          expectedCursor: channel.cursor,
          draft: {
            channelId: channel.manifest.id,
            audience: [seeded.participant.id],
            kind: 'message',
            payload: { text },
            delivery: 'context',
          },
        })
        channel = await first.ctx.teams.getChannel({ channelId: channel.manifest.id })
      }
      const closed = await closeTestChannel(first.ctx, {
        channelId: channel.manifest.id,
        expectedCursor: channel.cursor,
      })
      const compacted = await first.ctx.teams.compactChannel({
        teamId: seeded.team.team.id,
        channelId: closed.manifest.id,
        expectedCursor: closed.cursor,
        throughSequence: 1,
        actor: maintenance.issue({
          kind: 'scheduler-channel-compaction',
          teamId: seeded.team.team.id,
          channelId: closed.manifest.id,
          expectedCursor: closed.cursor,
          throughSequence: 1,
        }),
      })
      expect(compacted).toMatchObject({ compactedThrough: 1, auditCompactedThrough: 7 })
      expect(compacted.channel.firstCursor).toBe(2)
      expect(compacted.channel.replayWatermark).toBe(compacted.channel.cursor)
      await expect(first.ctx.teams.readChannel({ channelId: closed.manifest.id, afterCursor: -1 }))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_COMPACTED' })
      const suffix = await first.ctx.teams.readChannelPage({ channelId: closed.manifest.id, afterCursor: 1, limit: 16 })
      expect(suffix.records.map(record => record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence))
        .toEqual([2, 3, 4, 5, 6, 7, 8, 9])
      await expect(first.ctx.teams.readAudit({
        teamId: seeded.team.team.id,
        channelId: closed.manifest.id,
        afterCursor: -1,
        limit: 16,
      })).rejects.toMatchObject({ code: 'TEAM_AUDIT_COMPACTED' })
      const auditSuffix = await first.ctx.teams.readAudit({
        teamId: seeded.team.team.id,
        channelId: closed.manifest.id,
        afterCursor: 7,
        limit: 16,
      })
      expect(auditSuffix.firstCursor).toBe(8)
      expect(auditSuffix.items.map(item => item.cursor)).toEqual([8, 9])
      const terminalTeam = await completeDurableFixture(first.ctx, seeded.team.team.id)
      const compactedTeam = await first.ctx.teams.compactTeam({
        teamId: terminalTeam.team.id,
        expectedCursor: terminalTeam.team.cursor,
        throughSequence: 1,
        actor: maintenance.issue({
          kind: 'scheduler-team-journal-compaction',
          teamId: terminalTeam.team.id,
          expectedCursor: terminalTeam.team.cursor,
          throughSequence: 1,
        }),
      })
      expect(compactedTeam.compactedThrough).toBe(1)
      expect(compactedTeam.team.team.phase).toBe('completed')
      expect(compactedTeam.team.team.cursor).toBe(terminalTeam.team.cursor)
      expect(compactedTeam.auditCompactedThrough).toBeGreaterThanOrEqual(1)
      expect(first.ctx.teams.getMetrics()).toMatchObject({
        channelCompactions: 1,
        teamCompactions: 1,
        checkpointFailures: 0,
      })
      await expect(first.ctx.teams.readAudit({ teamId: seeded.team.team.id, afterCursor: -1, limit: 16 }))
        .rejects.toMatchObject({ code: 'TEAM_AUDIT_COMPACTED' })
      const teamAuditSuffix = await first.ctx.teams.readAudit({
        teamId: seeded.team.team.id,
        afterCursor: compactedTeam.auditCompactedThrough ?? 1,
        limit: 16,
      })
      expect(teamAuditSuffix.firstCursor).toBe((compactedTeam.auditCompactedThrough ?? 1) + 1)
      expect(teamAuditSuffix.items.at(-1)).toMatchObject({ cursor: terminalTeam.team.cursor, type: 'team/phase' })
      const root = first.root
      maintenance.dispose()
      await first.dispose()
      const second = await setup(backend, root, { auditRetentionTail: 1 })
      second.ctx.teams.registerAdapter(pendingDirectV3Adapter)
      try {
        await expect(second.ctx.teams.getChannel({ channelId: closed.manifest.id })).resolves.toMatchObject({ cursor: closed.cursor })
        await expect(second.ctx.teams.readChannelPage({ channelId: closed.manifest.id, afterCursor: -1, limit: 16 }))
          .rejects.toMatchObject({ code: 'TEAM_CHANNEL_COMPACTED' })
        const restartedSuffix = await second.ctx.teams.readChannelPage({ channelId: closed.manifest.id, afterCursor: 1, limit: 16 })
        expect(restartedSuffix.records.map(record => record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence))
          .toEqual([2, 3, 4, 5, 6, 7, 8, 9])
        const restartedAuditSuffix = await second.ctx.teams.readAudit({
          teamId: seeded.team.team.id,
          channelId: closed.manifest.id,
          afterCursor: 7,
          limit: 16,
        })
        expect(restartedAuditSuffix.items.map(item => item.cursor)).toEqual([8, 9])
        await expect(second.ctx.teams.getTeam({ teamId: seeded.team.team.id }))
          .resolves.toMatchObject({ team: { phase: 'completed', cursor: terminalTeam.team.cursor } })
        const restartedTeamAudit = await second.ctx.teams.readAudit({
          teamId: seeded.team.team.id,
          afterCursor: compactedTeam.auditCompactedThrough ?? 1,
          limit: 16,
        })
        expect(restartedTeamAudit.items.at(-1)).toMatchObject({ cursor: terminalTeam.team.cursor, type: 'team/phase' })
      } finally {
        await second.dispose()
      }
    })
    it('revalidates a scheduler compaction proof after close policy before destructive maintenance', async () => {
      const harness = await setup(backend)
      const maintenance = revocableSchedulerMaintenanceAuthority(harness.ctx)
      const seeded = await populated(harness.ctx)
      const opened = await openActiveTestChannel(harness.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: seeded.team.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'worker' }],
        limits: {},
      }, [seeded.participant.id])
      const channelStream = harness.ctx.storageLog.get(`channel/${opened.manifest.id}`)
      if (channelStream === undefined) throw new Error('channel stream was not retained before close')
      const closed = await closeTestChannel(harness.ctx, {
        channelId: opened.manifest.id,
        expectedCursor: opened.cursor,
      })
      let revokeAfterPolicy: (() => void) | undefined
      const unregister = harness.ctx.teams.registerPolicy('close', {
        name: 'revoke-maintenance-proof-after-policy',
        async apply(request, next) {
          if (request.facts.phase === 'compact') revokeAfterPolicy?.()
          return await next()
        },
      })
      try {
        const channelProof = maintenance.issue({
          kind: 'scheduler-channel-compaction',
          teamId: seeded.team.team.id,
          channelId: closed.manifest.id,
          expectedCursor: closed.cursor,
          throughSequence: 0,
        })
        revokeAfterPolicy = (): void => { channelProof.revoke() }
        await expect(harness.ctx.teams.compactChannel({
          teamId: seeded.team.team.id,
          channelId: closed.manifest.id,
          expectedCursor: closed.cursor,
          throughSequence: 0,
          actor: channelProof.proof,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        const channelInfo = (await harness.ctx.storageLog.list()).find(info => info.name === `channel/${closed.manifest.id}`)
        expect(channelInfo).toMatchObject({ tailSequence: closed.cursor })
        const controls = taskControlAuthority(harness.ctx)
        const state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
        const coordinator = state.activations.find(binding =>
          binding.activation.participantId === seeded.task.createCommand.creator.participantId)
        if (coordinator === undefined) throw new Error('maintenance fixture did not retain its task creator activation')
        const cancelInput = { teamId: seeded.team.team.id, taskId: seeded.task.id, expectedRevision: seeded.task.revision }
        const cancel = controls.issue({ kind: 'team-run-default-worker-cancel', ...cancelInput,
          coordinator: { teamId: seeded.team.team.id, participantId: coordinator.activation.participantId,
            activationId: coordinator.activation.id, sessionId: coordinator.sessionId, provider: coordinator.provider } })
        try { await harness.ctx.teams.cancelTask({ actor: cancel, ...cancelInput }) }
        finally { controls.dispose() }
        const terminal = await failDurableFixture(harness.ctx, seeded.team.team.id)
        const teamStream = harness.ctx.storageLog.get(`team/${terminal.team.id}`)
        if (teamStream === undefined) throw new Error('Team stream was not retained for maintenance proof revocation')
        const teamFirstSequence = teamStream.firstSequence
        const teamProof = maintenance.issue({
          kind: 'scheduler-team-journal-compaction',
          teamId: terminal.team.id,
          expectedCursor: terminal.team.cursor,
          throughSequence: 0,
        })
        revokeAfterPolicy = (): void => { teamProof.revoke() }
        await expect(harness.ctx.teams.compactTeam({
          teamId: terminal.team.id,
          expectedCursor: terminal.team.cursor,
          throughSequence: 0,
          actor: teamProof.proof,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        expect(teamStream.firstSequence).toBe(teamFirstSequence)
        expect(teamStream.tailSequence).toBe(terminal.team.cursor)
        expect(harness.ctx.teams.getMetrics()).toMatchObject({ channelCompactions: 0, teamCompactions: 0 })
      } finally {
        unregister()
        maintenance.dispose()
        await harness.dispose()
      }
    })
    it('revalidates a scheduler channel compaction proof after audit repair before checkpointing', async () => {
      const harness = await setup(backend)
      const maintenance = revocableSchedulerMaintenanceAuthority(harness.ctx)
      const seeded = await populated(harness.ctx)
      const opened = await openActiveTestChannel(harness.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: seeded.team.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'worker' }],
        limits: {},
      }, [seeded.participant.id])
      const streamBeforeClose = harness.ctx.storageLog.get(`channel/${opened.manifest.id}`)
      if (streamBeforeClose === undefined) throw new Error('channel stream was not retained before close')
      const firstSequence = streamBeforeClose.firstSequence
      const closed = await closeTestChannel(harness.ctx, {
        channelId: opened.manifest.id,
        expectedCursor: opened.cursor,
      })
      const proof = maintenance.issue({
        kind: 'scheduler-channel-compaction',
        teamId: seeded.team.team.id,
        channelId: closed.manifest.id,
        expectedCursor: closed.cursor,
        throughSequence: 0,
      })
      const internals = harness.ctx.teams as unknown as {
        repairAuditForRead(...args: unknown[]): Promise<unknown>
      }
      const repairAuditForRead = internals.repairAuditForRead.bind(internals)
      const repair = vi.spyOn(internals, 'repairAuditForRead').mockImplementation(async (...args) => {
        const audit = await repairAuditForRead(...args)
        proof.revoke()
        return audit
      })
      try {
        await expect(harness.ctx.teams.compactChannel({
          teamId: seeded.team.team.id,
          channelId: closed.manifest.id,
          expectedCursor: closed.cursor,
          throughSequence: 0,
          actor: proof.proof,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
        expect(repair).toHaveBeenCalledOnce()
        const stream = await harness.ctx.storageLog.open({
          name: `channel/${closed.manifest.id}`,
          version: CHANNEL_WAL_FORMAT_VERSION,
        })
        await expect(stream.readCheckpoint()).resolves.toMatchObject({ sequence: closed.cursor })
        expect(stream.firstSequence).toBe(firstSequence)
        expect(stream.tailSequence).toBe(closed.cursor)
        expect(harness.ctx.teams.getMetrics()).toMatchObject({ channelCompactions: 0 })
      } finally {
        repair.mockRestore()
        maintenance.dispose()
        await harness.dispose()
      }
    })
    it('refuses to compact a causal predecessor of a retained Envelope', async () => {
      const harness = await setup(backend)
      const maintenance = schedulerMaintenanceAuthority(harness.ctx)
      const seeded = await populated(harness.ctx)
      const opened = await openActiveTestChannel(harness.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: seeded.team.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'worker' }],
        limits: {},
      }, [seeded.participant.id])
      const actor = await postActor(harness.ctx, seeded.team.team.id, seeded.participant.id)
      const first = await harness.ctx.teams.postChannelEnvelope({
        actor,
        expectedCursor: opened.cursor,
        draft: {
          channelId: opened.manifest.id,
          audience: [seeded.participant.id],
          kind: 'request',
          payload: { text: 'root' },
          delivery: 'context',
        },
      })
      const second = await harness.ctx.teams.postChannelEnvelope({
        actor,
        expectedCursor: first.sequence,
        draft: {
          channelId: opened.manifest.id,
          audience: [seeded.participant.id],
          kind: 'reply',
          payload: { text: 'reply' },
          delivery: 'context',
          causationId: first.id,
        },
      })
      const closed = await closeTestChannel(harness.ctx, {
        channelId: opened.manifest.id,
        expectedCursor: second.sequence,
      })
      await expect(harness.ctx.teams.compactChannel({
        teamId: seeded.team.team.id,
        channelId: closed.manifest.id,
        expectedCursor: closed.cursor,
        throughSequence: first.sequence,
        actor: maintenance.issue({
          kind: 'scheduler-channel-compaction',
          teamId: seeded.team.team.id,
          channelId: closed.manifest.id,
          expectedCursor: closed.cursor,
          throughSequence: first.sequence,
        }),
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const replay = await harness.ctx.teams.readChannel({ channelId: closed.manifest.id, afterCursor: -1 })
      expect(replay.records.filter(record => record.type === 'channel/envelope')).toHaveLength(2)
      maintenance.dispose()
      await harness.dispose()
    })
    if (backend === 'json') {
      it('does not roll back a Team mutation when its audit projection is unavailable', async () => {
        const first = await setup(backend)
        const created = await createTestRootTeam(first.ctx, { goal: { objective: 'Audit failure', budgets: {} }, rules: {}, budgets: {} })
        const root = first.root
        await first.dispose()
        const auditPath = join(root, 'logs', `${Buffer.from(`audit/${created.team.id}`, 'utf8').toString('base64url')}.json`)
        const original = await readFile(auditPath, 'utf8')
        const altered = original.replace('"version":1', '"version":999')
        expect(altered).not.toBe(original)
        await writeFile(auditPath, altered, 'utf8')
        const second = await setup(backend, root)
        try {
          const state = await second.ctx.teams.getTeam({ teamId: created.team.id })
          await expect(seedTeamPhase(second.ctx, state.team.id, 'quiescing'))
            .resolves.toMatchObject({ team: { phase: 'quiescing' } })
          expect(second.ctx.teams.getMetrics()).toMatchObject({
            auditProjectionFailures: 1,
          })
          await expect(second.ctx.teams.readAudit({ teamId: created.team.id, afterCursor: -1, limit: 8 }))
            .rejects.toMatchObject({ code: 'version-mismatch' })
          expect(second.ctx.teams.getMetrics()).toMatchObject({
            auditProjectionFailures: 2,
          })
        } finally {
          await second.dispose()
        }
      })
      it('rejects an audit projection whose facts disagree with the source record', async () => {
        const first = await setup(backend)
        const created = await createTestRootTeam(first.ctx, { goal: { objective: 'Audit facts', budgets: {} }, rules: {}, budgets: {} })
        const root = first.root
        await first.dispose()
        const auditPath = join(root, 'logs', `${Buffer.from(`audit/${created.team.id}`, 'utf8').toString('base64url')}.json`)
        const original = await readFile(auditPath, 'utf8')
        const altered = original.replace('"depth": 0', '"depth": 999')
        expect(altered).not.toBe(original)
        await writeFile(auditPath, altered, 'utf8')
        const second = await setup(backend, root)
        try {
          await expect(second.ctx.teams.readAudit({ teamId: created.team.id, afterCursor: -1, limit: 8 }))
            .rejects.toMatchObject({ code: 'TEAM_JOURNAL_MALFORMED' })
          expect(second.ctx.teams.getMetrics()).toMatchObject({ auditProjectionFailures: 1 })
        } finally {
          await second.dispose()
        }
      })
    }
    it('persists, validates, and replays an idempotent channel summary', async () => {
      const first = await setup(backend)
      first.ctx.teams.registerViewPolicy(summaryPolicy)
      first.ctx.teams.registerAdapter(pendingDirectV3Adapter)
      const seeded = await populated(first.ctx)
      const coordinator = seeded.team.participants.find(member => member.role === 'coordinator')
      if (coordinator === undefined) throw new Error('Summary fixture requires its existing coordinator')
      const channel = await openActiveTestChannel(first.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: seeded.team.team.cursor,
        adapter: { type: 'direct', version: 3 },
        viewPolicy: { type: summaryPolicy.type, version: summaryPolicy.version },
        participants: [{ id: seeded.participant.id, role: 'worker' }, { id: coordinator.id, role: 'coordinator' }],
        limits: {},
      }, [seeded.participant.id, coordinator.id])
      const actor = await postActor(first.ctx, seeded.team.team.id, seeded.participant.id)
      const firstEnvelope = await first.ctx.teams.postChannelEnvelope({
        actor,
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [seeded.participant.id, coordinator.id],
          kind: 'message',
          payload: { text: 'First source.' },
          delivery: 'context',
        },
      })
      const secondEnvelope = await first.ctx.teams.postChannelEnvelope({
        actor,
        expectedCursor: firstEnvelope.sequence,
        draft: {
          channelId: channel.manifest.id,
          audience: [seeded.participant.id, coordinator.id],
          kind: 'message',
          payload: { text: 'Second source.' },
          delivery: 'context',
        },
      })
      const request = {
        requester: await postActor(first.ctx, seeded.team.team.id, coordinator.id),
        sourceFingerprint: fingerprintChannelSummarySources([firstEnvelope, secondEnvelope]),
        channelId: channel.manifest.id,
        expectedCursor: secondEnvelope.sequence,
        coveredSequenceRange: { from: firstEnvelope.sequence, to: secondEnvelope.sequence },
        sourceEnvelopeIds: [firstEnvelope.id, secondEnvelope.id],
        text: 'First and second source.',
        policy: { type: summaryPolicy.type, version: summaryPolicy.version },
        idempotencyKey: channelSummaryIdempotencyKeySchema.parse(`summary-${backend}`),
      }
      const summary = await summarizeTestChannel(first.ctx, request)
      expect(summary).toMatchObject({
        type: 'channel/summary',
        sequence: secondEnvelope.sequence + 1,
        sourceEnvelopeIds: request.sourceEnvelopeIds,
        text: request.text,
      })
      expect((await first.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).view)
        .toMatchObject({ summaries: [{ text: request.text, sourceEnvelopeIds: request.sourceEnvelopeIds }] })
      await expect(summarizeTestChannel(first.ctx, request)).resolves.toEqual(summary)
      await expect(summarizeTestChannel(first.ctx, { ...request, text: 'Conflicting summary.' }))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT' })
      await expect(summarizeTestChannel(first.ctx, {
        ...request,
        expectedCursor: summary.sequence,
        idempotencyKey: channelSummaryIdempotencyKeySchema.parse(`summary-invalid-${backend}`),
        sourceEnvelopeIds: [firstEnvelope.id],
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      second.ctx.teams.registerViewPolicy(summaryPolicy)
      second.ctx.teams.registerAdapter(pendingDirectV3Adapter)
      const restored = await second.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
      expect(restored.records.find(record => record.type === 'channel/summary')).toMatchObject({
        sourceEnvelopeIds: request.sourceEnvelopeIds,
        text: request.text,
      })
      await expect(summarizeTestChannel(second.ctx, { ...request,
        requester: await postActor(second.ctx, seeded.team.team.id, coordinator.id) })).resolves.toEqual(summary)
      await second.dispose()
    })
    it('keeps Team, member, task, and channel product reads bounded across restart', async () => {
      const first = await setup(backend, undefined, { recoveryPageSize: 2 })
      const seeded = await populated(first.ctx)
      await activeServiceParticipant(first.ctx, seeded.team.team.id, 'worker')
      let state = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await createTestCoordinatorTask(first.ctx, {
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        subject: 'Second task',
        description: 'Keep the task page bounded.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
      })
      state = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const channel = await openActiveTestChannel(first.ctx, {
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'reviewer' }],
        limits: {},
      }, [seeded.participant.id])
      await first.ctx.teams.postChannelEnvelope({
        actor: await postActor(first.ctx, seeded.team.team.id, seeded.participant.id),
        expectedCursor: channel.cursor,
        draft: {
          channelId: channel.manifest.id,
          audience: [seeded.participant.id],
          kind: 'message',
          payload: { text: 'A bounded channel page.' },
          delivery: 'context',
        },
      })
      await createTestRootTeam(first.ctx, { goal: { objective: 'Second Team', budgets: {} }, rules: {}, budgets: {} })
      await createTestRootTeam(first.ctx, { goal: { objective: 'Third Team', budgets: {} }, rules: {}, budgets: {} })
      const members1 = await first.ctx.teams.listParticipantsPage({ teamId: state.team.id, afterCursor: -1, limit: 1 })
      expect(members1.items).toHaveLength(1)
      expect(members1.nextCursor).toBe(0)
      const members2 = await first.ctx.teams.listParticipantsPage({ teamId: state.team.id, afterCursor: members1.nextCursor!, limit: 1 })
      expect(members2.items).toHaveLength(1)
      expect(members2.nextCursor).toBe(1)
      const members3 = await first.ctx.teams.listParticipantsPage({ teamId: state.team.id, afterCursor: members2.nextCursor!, limit: 1 })
      expect(members3.items).toHaveLength(1)
      expect(members3.nextCursor).toBeUndefined()
      const tasks1 = await first.ctx.teams.listTasksPage({ teamId: state.team.id, afterCursor: -1, limit: 1 })
      expect(tasks1.items).toHaveLength(1)
      expect(tasks1.nextCursor).toBe(0)
      const tasks2 = await first.ctx.teams.listTasksPage({ teamId: state.team.id, afterCursor: tasks1.nextCursor!, limit: 1 })
      expect(tasks2.items).toHaveLength(1)
      expect(tasks2.nextCursor).toBeUndefined()
      const channel1 = await first.ctx.teams.readChannelPage({ channelId: channel.manifest.id, afterCursor: -1, limit: 1 })
      expect(channel1.records).toHaveLength(1)
      expect(channel1.nextCursor).toBe(0)
      const channel2 = await first.ctx.teams.readChannelPage({
        channelId: channel.manifest.id, afterCursor: channel1.nextCursor!, limit: 1,
      })
      expect(channel2.records).toHaveLength(1)
      expect(channel2.nextCursor).toBe(1)
      const channel3 = await first.ctx.teams.readChannelPage({
        channelId: channel.manifest.id, afterCursor: channel2.nextCursor!, limit: 1,
      })
      expect(channel3.records).toHaveLength(1)
      expect(channel3.nextCursor).toBe(2)
      const channel4 = await first.ctx.teams.readChannelPage({
        channelId: channel.manifest.id, afterCursor: channel3.nextCursor!, limit: 1,
      })
      expect(channel4.records).toHaveLength(1)
      expect(channel4.nextCursor).toBe(3)
      const channel5 = await first.ctx.teams.readChannelPage({
        channelId: channel.manifest.id, afterCursor: channel4.nextCursor!, limit: 1,
      })
      expect(channel5.records).toHaveLength(1)
      expect(channel5.nextCursor).toBe(4)
      const channel6 = await first.ctx.teams.readChannelPage({
        channelId: channel.manifest.id, afterCursor: channel5.nextCursor!, limit: 1,
      })
      expect(channel6.records).toHaveLength(1)
      expect(channel6.nextCursor).toBeUndefined()
      let discoveryCursor: TeamListPageRequest['afterCursor'] = -1
      const discovered = []
      for (;;) {
        const page = await first.ctx.teams.listTeamsPage({ afterCursor: discoveryCursor, limit: 1 })
        expect(page.items.length).toBeLessThanOrEqual(1)
        expect(page.scanned).toBeLessThanOrEqual(1)
        discovered.push(...page.items)
        if (page.nextCursor === undefined) break
        expect(page.nextCursor).not.toBe(discoveryCursor)
        discoveryCursor = page.nextCursor
      }
      expect(discovered).toHaveLength(3)
      expect(new Set(discovered.map(team => team.id)).size).toBe(3)
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root, { recoveryPageSize: 2 })
      await expect(second.ctx.teams.readChannelPage({ channelId: channel.manifest.id, afterCursor: -1, limit: 1 }))
        .resolves.toMatchObject({ records: [{ type: 'channel/opened' }], nextCursor: 0 })
      await expect(second.ctx.teams.listTasksPage({ teamId: state.team.id, afterCursor: -1, limit: 1 }))
        .resolves.toMatchObject({ items: [{ subject: 'Review' }], nextCursor: 0 })
      await second.dispose()
    })
    it('retires a fenced task wake channel before the task can receive a new lease', async () => {
      let harness = await setup(backend)
      harness.ctx.teams.registerAdapter(wakeAdapter)
      const seeded = await populated(harness.ctx)
      const activationId = await taskActivation(harness.ctx, seeded.team.team.id, seeded.participant.id)
      let state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const wake = await openActiveTestChannel(harness.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'wake', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'assignee' }],
        limits: {},
      }, [seeded.participant.id])
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const assigned = await assignTestTask(harness.ctx, {
        teamId: seeded.team.team.id,
        taskId: seeded.task.id,
        expectedRevision: seeded.task.revision,
        participantId: seeded.participant.id,
        activationId,
        wakeChannelId: wake.manifest.id,
        leaseDurationMs: 10_000,
      })
      const lease = assigned.lease
      if (lease === undefined) throw new Error('assigned task must retain its wake lease')
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const competing = await createTestCoordinatorTask(harness.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: state.team.cursor,
        subject: 'Competing wake lease',
        description: 'Must receive another wake channel.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
      })
      await expect(assignTestTask(harness.ctx, {
        teamId: seeded.team.team.id,
        taskId: competing.id,
        expectedRevision: competing.revision,
        participantId: seeded.participant.id,
        activationId,
        wakeChannelId: wake.manifest.id,
        leaseDurationMs: 10_000,
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const accepted = await harness.ctx.teams.postChannelEnvelope({
        actor: await postActor(harness.ctx, seeded.team.team.id, seeded.participant.id),
        expectedCursor: wake.cursor,
        draft: {
          channelId: wake.manifest.id,
          audience: [seeded.participant.id],
          kind: 'assignment',
          payload: { taskId: seeded.task.id },
          delivery: 'turn',
          taskId: seeded.task.id,
        },
      })
      const pending = await harness.ctx.teams.listChannelPendingDeliveries({
        channelId: wake.manifest.id,
        participantId: seeded.participant.id,
        afterCursor: -1,
        limit: 1,
      })
      expect(pending.channel.replayWatermark).toBe(accepted.sequence - 1)
      const metrics = harness.ctx.teams.getMetrics()
      expect(metrics.pendingDeliveries).toBe(1)
      expect(metrics.replayLag).toEqual(expect.any(Number))
      expect(pending.deliveries).toMatchObject([{ envelope: { id: accepted.id } }])
      const denyWakeClose: TeamPolicy = {
        name: 'deny-fenced-wake-close',
        async apply() { return { kind: 'deny', code: 'test-denied', message: 'wait for recovery retry' } },
      }
      const unregisterDeny = harness.ctx.teams.registerPolicy('close', denyWakeClose)
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await expect(fenceTestActivation(harness.ctx, {
        teamId: seeded.team.team.id,
        activationId,
        participantId: seeded.participant.id,
        sessionId: SessionId('task-recovery-session'),
        provider: 'in-process',
        expectedCursor: state.team.cursor,
      })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
      unregisterDeny()
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      expect(state.activations.find(binding => binding.activation.id === activationId)).toMatchObject({
        activation: { status: 'offline' },
        quiescenceSource: 'fenced',
        quiescedWakeChannelIds: [wake.manifest.id],
      })
      const internals = harness.ctx.teams as unknown as {
        teams: Map<string, { projection: TeamProjection }>
      }
      const projection = internals.teams.get(seeded.team.team.id)?.projection
      if (projection === undefined) throw new Error('Team Hub did not retain the fenced projection')
      const checkpoint = teamProjectionData(projection)
      expect(() => teamProjectionFromData({
        ...checkpoint,
        activations: checkpoint.activations.map(binding => binding.activation.id === activationId
          ? { ...binding, quiescedWakeChannelIds: [] }
          : binding),
      })).toThrow('quiescence proof does not match its released task wakes')
      const root = harness.root
      await harness.dispose()
      harness = await setup(backend, root)
      harness.ctx.teams.registerAdapter(wakeAdapter)
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await expect(bindTestActivation(harness.ctx, {
        expectedCursor: state.team.cursor,
        binding: {
          activation: {
            id: activationIdSchema.parse('task-recovery-blocked-replacement'),
            teamId: seeded.team.team.id,
            participantId: seeded.participant.id,
            status: 'idle',
          },
          sessionId: SessionId('task-recovery-session'),
          provider: 'in-process',
        },
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const fenced = await fenceTestActivation(harness.ctx, {
        teamId: seeded.team.team.id,
        activationId,
        participantId: seeded.participant.id,
        sessionId: SessionId('task-recovery-session'),
        provider: 'in-process',
        expectedCursor: state.team.cursor,
      })
      expect(fenced.activations.find(binding => binding.activation.id === activationId)).toMatchObject({
        activation: { status: 'offline' },
        quiescenceSource: 'fenced',
        quiescedWakeChannelIds: [wake.manifest.id],
      })
      const retired = await harness.ctx.teams.getChannel({ channelId: wake.manifest.id })
      expect(retired.phase).toBe('closed')
      await expect(harness.ctx.teams.listChannelPendingDeliveries({
        channelId: wake.manifest.id,
        participantId: seeded.participant.id,
        afterCursor: -1,
        limit: 1,
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const replacement = await bindTestActivation(harness.ctx, {
        expectedCursor: state.team.cursor,
        binding: {
          activation: {
            id: activationIdSchema.parse('task-recovery-replacement'),
            teamId: seeded.team.team.id,
            participantId: seeded.participant.id,
            status: 'idle',
          },
          sessionId: SessionId('task-recovery-session'),
          provider: 'in-process',
        },
      })
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const nextWake = await openActiveTestChannel(harness.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: state.team.cursor,
        adapter: { type: 'wake', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'assignee' }],
        limits: {},
      }, [seeded.participant.id])
      const released = fenced.tasks.find(task => task.id === seeded.task.id)
      if (released === undefined) throw new Error('fenced task was not returned')
      const reassigned = await assignTestTask(harness.ctx, {
        teamId: seeded.team.team.id,
        taskId: seeded.task.id,
        expectedRevision: released.revision,
        participantId: seeded.participant.id,
        activationId: replacement.activation.id,
        wakeChannelId: nextWake.manifest.id,
        leaseDurationMs: 10_000,
      })
      expect(reassigned.lease).toMatchObject({ activationId: replacement.activation.id, wakeChannelId: nextWake.manifest.id })
      await harness.dispose()
    })
    it('rebuilds a child Team link and inherited depth cap after restart', async () => {
      const first = await setup(backend, undefined, { maxTeamDepth: 1 })
      const parent = await createTestRootTeam(first.ctx, { goal: { objective: 'Parent work', budgets: {} }, rules: {}, budgets: {} })
      const task = await reservedChildTask(first.ctx, parent.team.id)
      const child = await createTestChildTeam(first.ctx, task.creation)
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root, { maxTeamDepth: 0 })
      await expect(second.ctx.teams.getTeam({ teamId: child.team.id })).resolves.toMatchObject({
        team: {
          parentTeamId: parent.team.id,
          parentTaskId: task.task.id,
          depth: 1,
          maxTeamDepth: 1,
        },
      })
      await second.dispose()
    })
    it('rebuilds Team, task, and attached-channel projections after restart', async () => {
      const first = await setup(backend)
      const seeded = await populated(first.ctx)
      const channel = await openTestChannel(first.ctx, {
        teamId: seeded.team.team.id,
        expectedCursor: seeded.team.team.cursor,
        adapter: { type: 'direct', version: 1 },
        participants: [{ id: seeded.participant.id, role: 'reviewer' }],
        limits: { turns: 2 },
      })
      const closed = await closeTestChannel(first.ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      const teams = (await second.ctx.teams.listTeamsPage({ afterCursor: -1, limit: 128 })).items
      expect(teams).toEqual([expect.objectContaining({ id: seeded.team.team.id, phase: 'active' })])
      const restored = await second.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      expect(restored).toMatchObject({
        team: { id: seeded.team.team.id, phase: 'active' },
        rules: { mode: 'local' },
        budgets: { tokens: 10 },
        tasks: [{ id: seeded.task.id, subject: 'Review', writeScopes: ['packages/team'] }],
        channelIds: [channel.manifest.id],
      })
      expect(restored.participants).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: seeded.participant.id, phase: 'active' }),
      ]))
      await expect(second.ctx.teams.getChannel({ channelId: channel.manifest.id }))
        .resolves.toEqual(expect.objectContaining({ phase: 'closed', cursor: closed.cursor }))
      await second.dispose()
    })
    it('rebuilds an advisory task owner proposal after restart without turning it into a lease', async () => {
      const first = await setup(backend)
      const seeded = await populated(first.ctx)
      const coordinator = await activeServiceParticipant(first.ctx, seeded.team.team.id, 'coordinator', 'local-agent')
      const taskActor = await coordinatorActor(first.ctx, seeded.team.team.id, coordinator.id, `owner-proposal-${backend}`)
      const current = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const coordinatorBinding = current.activations.find(binding => binding.activation.participantId === coordinator.id)
      if (coordinatorBinding === undefined) throw new Error('owner-proposal fixture did not retain its coordinator activation')
      const defaultWorkerTask = await first.ctx.teams.createTask({
        actor: taskActor,
        teamId: seeded.team.team.id,
        expectedCursor: current.team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`owner-proposal-task-${backend}`) },
        subject: 'Coordinator-owned task',
        description: 'Retain one durable owner proposal.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
      })
      const control = taskControlAuthority(first.ctx)
      const proposed = await first.ctx.teams.proposeTaskOwner({
        actor: control.issue({
          kind: 'team-run-default-worker-owner-proposal',
          teamId: seeded.team.team.id,
          coordinator: {
            teamId: coordinatorBinding.activation.teamId,
            participantId: coordinatorBinding.activation.participantId,
            activationId: coordinatorBinding.activation.id,
            sessionId: coordinatorBinding.sessionId,
            provider: coordinatorBinding.provider,
          },
          taskId: defaultWorkerTask.id,
          expectedRevision: defaultWorkerTask.revision,
          proposedOwnerId: seeded.participant.id,
        }),
        teamId: defaultWorkerTask.teamId,
        taskId: defaultWorkerTask.id,
        expectedRevision: defaultWorkerTask.revision,
        proposedOwnerId: seeded.participant.id,
      })
      const root = first.root
      control.dispose()
      await first.dispose()
      const second = await setup(backend, root)
      const restored = await second.ctx.teams.getTask({ teamId: defaultWorkerTask.teamId, taskId: defaultWorkerTask.id })
      expect(restored).toMatchObject({
        revision: proposed.revision,
        phase: 'pending',
        proposedOwnerId: seeded.participant.id,
      })
      expect(restored.lease).toBeUndefined()
      await second.dispose()
    })
    it('replays one activation-authorized task creation command after restart and rejects conflicting reuse', async () => {
      const first = await setup(backend)
      const seeded = await populated(first.ctx)
      const coordinator = await activeServiceParticipant(first.ctx, seeded.team.team.id, 'coordinator', 'local-agent')
      const taskActor = await coordinatorActor(first.ctx, seeded.team.team.id, coordinator.id, `task-retry-${backend}`)
      const state = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const request = {
        actor: taskActor,
        teamId: seeded.team.team.id,
        expectedCursor: state.team.cursor,
        createCommand: {
          idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('task-create-retry'),
        },
        subject: 'Create through an activation command',
        description: 'Persist this task creation once.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
      }
      const policyRequests: TeamPolicyRequest[] = []
      const unregister = first.ctx.teams.registerPolicy('task-mutate', {
        name: 'observe-task-create-actor',
        async apply(request, next) {
          policyRequests.push(request)
          return await next()
        },
      })
      const created = await first.ctx.teams.createTask(request)
      const replayed = await first.ctx.teams.createTask(request)
      expect(replayed).toEqual(created)
      expect(policyRequests).toHaveLength(1)
      expect(policyRequests[0]?.actorId).toBe(coordinator.id)
      expect(policyRequests[0]?.facts.idempotencyKey).toBe('task-create-retry')
      await expect(first.ctx.teams.createTask({
        ...request,
        description: 'This is another task.',
      })).rejects.toMatchObject({ code: 'TEAM_TASK_IDEMPOTENCY_CONFLICT' })
      expect((await first.ctx.teams.listTasksPage({ teamId: seeded.team.team.id, afterCursor: -1, limit: 128 })).items
        .filter(task => task.id === created.id)).toHaveLength(1)
      unregister()
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      const replayActor = await coordinatorActor(second.ctx, seeded.team.team.id, coordinator.id, `task-retry-replay-${backend}`)
      await expect(second.ctx.teams.createTask({ ...request, actor: replayActor })).resolves.toEqual(created)
      await expect(second.ctx.teams.getTask({ teamId: seeded.team.team.id, taskId: created.id })).resolves.toMatchObject({
        createCommand: { idempotencyKey: request.createCommand.idempotencyKey, creator: { participantId: coordinator.id } },
      })
      await second.dispose()
    })
    it('derives task-create policy identity from one exact live activation while retaining trusted creation', async () => {
      const harness = await setup(backend)
      const seeded = await populated(harness.ctx)
      const coordinator = await activeServiceParticipant(harness.ctx, seeded.team.team.id, 'coordinator', 'local-agent')
      const taskActor = await coordinatorActor(harness.ctx, seeded.team.team.id, coordinator.id, `task-authorization-${backend}`)
      const policyRequests: TeamPolicyRequest[] = []
      const unregister = harness.ctx.teams.registerPolicy('task-mutate', {
        name: 'observe-task-create-command',
        async apply(request, next) {
          policyRequests.push(request)
          return await next()
        },
      })
      let state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await harness.ctx.teams.createTask({
        actor: taskActor,
        teamId: seeded.team.team.id,
        expectedCursor: state.team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`trusted-task-${backend}`) },
        subject: 'Trusted task creation',
        description: 'Keep trusted callers available.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
      })
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const request = {
        actor: taskActor,
        teamId: seeded.team.team.id,
        expectedCursor: state.team.cursor,
        createCommand: {
          idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('task-create-authorization'),
        },
        subject: 'Authorized task creation',
        description: 'Require the exact activation command.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
      }
      await harness.ctx.teams.createTask(request)
      expect(policyRequests.map(request => request.actorId)).toEqual([coordinator.id, coordinator.id])
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const coordinatorBinding = state.activations.find(binding => binding.activation.participantId === coordinator.id)
      if (coordinatorBinding === undefined) throw new Error('task coordinator activation is missing')
      await updateTestActivationStatus(harness.ctx, {
        teamId: seeded.team.team.id,
        activationId: coordinatorBinding.activation.id,
        expectedCursor: state.team.cursor,
        status: 'offline',
      })
      state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await expect(harness.ctx.teams.createTask({
        ...request,
        expectedCursor: state.team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('task-create-stale-authorization') },
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      unregister()
      await harness.dispose()
    })
    it('rebuilds a durable local activation binding and its residency status after restart', async () => {
      const first = await setup(backend)
      const seeded = await populated(first.ctx)
      const recovery = {
        kind: 'sdk-local-cold-replace' as const,
        version: 1 as const,
        runtimeProvider: 'sdk',
        profile: 'local-sdk-v1',
        agent: { provider: 'mock', model: 'mock', maxTokens: 32 },
        process: { hostId: 'host-a', pid: 42, started: 'start-a', processGroupId: 42 },
      }
      const binding = await bindTestActivation(first.ctx, {
        expectedCursor: seeded.team.team.cursor,
        binding: {
          activation: {
            id: activationIdSchema.parse('activation-restart'),
            teamId: seeded.team.team.id,
            participantId: seeded.participant.id,
            status: 'idle',
          },
          sessionId: SessionId('activation-restart-session'),
          provider: 'sdk',
          recovery,
        },
      })
      let current = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const running = await updateTestActivationStatus(first.ctx, {
        teamId: current.team.id,
        activationId: binding.activation.id,
        expectedCursor: current.team.cursor,
        status: 'running',
      })
      current = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await updateTestActivationStatus(first.ctx, {
        teamId: current.team.id,
        activationId: binding.activation.id,
        expectedCursor: current.team.cursor,
        status: 'offline',
      })
      current = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      await expect(bindTestActivation(first.ctx, {
        expectedCursor: current.team.cursor,
        binding: {
          activation: {
            id: activationIdSchema.parse('activation-restart-unproven'),
            teamId: seeded.team.team.id,
            participantId: seeded.participant.id,
            status: 'idle',
          },
          sessionId: binding.sessionId,
          provider: 'in-process',
        },
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await quiesceTestActivation(first.ctx, {
        teamId: current.team.id,
        activationId: binding.activation.id,
        participantId: seeded.participant.id,
        sessionId: binding.sessionId,
        provider: binding.provider,
        expectedCursor: current.team.cursor,
      })
      current = await first.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const resumed = await bindTestActivation(first.ctx, {
        expectedCursor: current.team.cursor,
        binding: {
          activation: {
            id: activationIdSchema.parse('activation-restart-resumed'),
            teamId: seeded.team.team.id,
            participantId: seeded.participant.id,
            status: 'idle',
          },
          sessionId: binding.sessionId,
          provider: 'in-process',
        },
      })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      await expect(second.ctx.teams.getActivation({
        teamId: seeded.team.team.id,
        activationId: binding.activation.id,
      })).resolves.toMatchObject({
        sessionId: binding.sessionId,
        provider: 'sdk',
        recovery,
        activation: { id: binding.activation.id, status: 'offline' },
      })
      const restored = await second.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      expect(restored.activations.find(item => item.activation.id === running.activation.id))
        .toMatchObject({ activation: { id: running.activation.id, status: 'offline' } })
      expect(restored.activations.find(item => item.activation.id === resumed.activation.id))
        .toMatchObject({ activation: { id: resumed.activation.id, status: 'idle' } })
      await expect(second.ctx.teams.getActivation({
        teamId: seeded.team.team.id,
        activationId: resumed.activation.id,
      })).resolves.toMatchObject({
        sessionId: binding.sessionId,
        activation: { id: resumed.activation.id, status: 'idle' },
      })
      await second.dispose()
    })
    it('falls back to journal replay when a structurally invalid checkpoint is present', async () => {
      const first = await setup(backend)
      const seeded = await populated(first.ctx)
      const root = first.root
      await first.dispose()
      const rawBackend = backend === 'json'
        ? new StorageJson.JsonStorageBackend(root)
        : new StorageSqlite.SqliteStorageBackend(new StorageSqlite.Config({ path: join(root, 'team-hub.db') }))
      const stream = await rawBackend.log.open({
        name: `team/${seeded.team.team.id}`,
        version: TEAM_JOURNAL_FORMAT_VERSION,
      })
      await stream.writeCheckpoint({
        sequence: seeded.team.team.cursor,
        value: {
          kind: 'team-projection',
          version: TEAM_CHECKPOINT_FORMAT_VERSION,
          teamId: 'wrong-team',
          projection: {},
        },
      })
      await stream.close()
      await rawBackend.close()
      const second = await setup(backend, root)
      const restored = await second.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      expect(restored.team.id).toBe(seeded.team.team.id)
      await second.dispose()
    })
    it('recovers a pending participant interrupt and its exact-target acknowledgement', async () => {
      const first = await setup(backend)
      const topology = await interruptTopology(first.ctx, 'Recover one participant interrupt.')
      const binding = await interruptActivation(first.ctx, topology.team.team.id, topology.coordinator.id, 'interrupt-activation', topology.channel.manifest.id)
      const authority = teamRunInterruptAuthority(first.ctx)
      const state = await first.ctx.teams.getTeam({ teamId: topology.team.team.id })
      const interrupt = await first.ctx.teams.requestParticipantInterrupt({
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        actor: authority.issue({
          kind: 'team-run-human-interrupt',
          teamId: topology.team.team.id,
          channelId: topology.channel.manifest.id,
          humanId: topology.human.id,
          coordinatorId: topology.coordinator.id,
        }),
      })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      const secondActor = interruptActor(second.ctx, binding)
      await expect(second.ctx.teams.listPendingParticipantInterrupts({
        actor: secondActor,
      })).resolves.toEqual([expect.objectContaining({ id: interrupt.id, target: interrupt.target })])
      const secondAcknowledged = await second.ctx.teams.acknowledgeParticipantInterrupt({
        interruptId: interrupt.id,
        actor: secondActor,
      })
      expect(secondAcknowledged.id).toBe(interrupt.id)
      expect(secondAcknowledged.acknowledgedAt).toEqual(expect.any(Number))
      await second.dispose()
      const third = await setup(backend, root)
      const thirdActor = interruptActor(third.ctx, binding)
      await expect(third.ctx.teams.listPendingParticipantInterrupts({
        actor: thirdActor,
      })).resolves.toEqual([])
      const thirdAcknowledged = await third.ctx.teams.acknowledgeParticipantInterrupt({
        interruptId: interrupt.id,
        actor: thirdActor,
      })
      expect(thirdAcknowledged.id).toBe(interrupt.id)
      expect(thirdAcknowledged.acknowledgedAt).toEqual(expect.any(Number))
      await third.dispose()
    })
    it('recovers a renewed lease, records its expiry once, and mints the next attempt', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(1_700_000_000_000)
      const first = await setup(backend)
      const seeded = await populated(first.ctx)
      const activationId = await taskActivation(first.ctx, seeded.team.team.id, seeded.participant.id)
      const assigned = await assignTestTask(first.ctx, {
        teamId: seeded.team.team.id,
        taskId: seeded.task.id,
        expectedRevision: seeded.task.revision,
        participantId: seeded.participant.id,
        activationId,
        leaseDurationMs: 100,
      })
      const assignedLease = assigned.lease
      if (assignedLease === undefined) throw new Error('assignment must retain a current lease')
      const actor = first.ctx.teams.openActivationActorProofIssuer().issue(
        await first.ctx.teams.getActivation({ teamId: seeded.team.team.id, activationId }),
      ).proof
      const started = await first.ctx.teams.startTaskAttempt({
        actor,
        taskId: assigned.id,
        expectedRevision: assigned.revision,
        attemptId: assignedLease.attemptId,
      })
      vi.advanceTimersByTime(20)
      const renewed = await first.ctx.teams.heartbeatTaskAttempt({
        actor,
        taskId: started.id,
        expectedRevision: started.revision,
        attemptId: assignedLease.attemptId,
      })
      const renewedLease = renewed.lease
      if (renewedLease === undefined) throw new Error('heartbeat must retain a current lease')
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root)
      const restored = await second.ctx.teams.getTask({ teamId: renewed.teamId, taskId: renewed.id })
      expect(restored).toMatchObject({
        phase: 'running',
        attemptCount: 1,
        attemptHistory: [],
        lease: {
          attemptId: assignedLease.attemptId,
          assignedRevision: assignedLease.assignedRevision,
          ordinal: 1,
          participantId: seeded.participant.id,
          activationId,
          startedAt: assignedLease.assignedAt,
          renewedAt: renewedLease.renewedAt,
          expiresAt: renewedLease.expiresAt,
        },
      })
      vi.advanceTimersByTime(100)
      const expired = await expireTestTask(second.ctx, {
        teamId: restored.teamId,
        taskId: restored.id,
        expectedRevision: restored.revision,
        attemptId: assignedLease.attemptId,
      })
      expect(expired).toMatchObject({
        phase: 'pending',
        attemptCount: 1,
        attemptHistory: [{
          id: assignedLease.attemptId,
          ordinal: 1,
          participantId: seeded.participant.id,
          leaseExpiresAt: renewedLease.expiresAt,
          outcome: { kind: 'lease-expired' },
        }],
      })
      expect(expired.lease).toBeUndefined()
      const retried = await assignTestTask(second.ctx, {
        teamId: expired.teamId,
        taskId: expired.id,
        expectedRevision: expired.revision,
        participantId: seeded.participant.id,
        activationId,
        leaseDurationMs: 100,
      })
      expect(retried.lease).toMatchObject({ ordinal: 2, participantId: seeded.participant.id })
      expect(retried.lease?.attemptId).not.toBe(assignedLease.attemptId)
      await second.dispose()
    })
    it('retains pending and settled human actions across a JSON/SQLite restart', async () => {
      const first = await setup(backend)
      const seeded = await populated(first.ctx)
      const teamId = seeded.team.team.id
      const actionId = teamHumanActionIdSchema.parse(`question:${backend}`)
      const sessionId = SessionId(`question-session-${backend}`)
      const sourceAction = {
        id: actionId,
        teamId,
        kind: 'question' as const,
        phase: 'pending' as const,
        sessionId,
        participantId: seeded.participant.id,
        sourceId: teamHumanActionSourceIdSchema.parse(`rpc-${backend}`),
        details: { questionRpcId: `rpc-${backend}`, questions: [] },
        createdAt: 0,
        updatedAt: 0,
      }
      const authority = testHumanActionAuthority(first.ctx)
      const upsert = authority.issue({
        kind: 'host-human-action-upsert',
        teamId,
        expectedCursor: seeded.team.team.cursor,
        action: sourceAction,
      })
      const action = await first.ctx.teams.upsertHumanAction({
        actor: upsert.proof,
        teamId,
        expectedCursor: seeded.team.team.cursor,
      })
      upsert.revoke()
      expect(action.phase).toBe('pending')
      const pending = await first.ctx.teams.getTeam({ teamId })
      expect(pending.humanActions).toEqual([expect.objectContaining({ id: actionId, phase: 'pending' })])
      const resolve = authority.issue({
        kind: 'host-human-action-resolve',
        teamId,
        expectedCursor: pending.team.cursor,
        action: sourceAction,
        phase: 'resolved',
        outcome: { kind: 'answered', answer: { answers: [] } },
      })
      const settled = await first.ctx.teams.resolveHumanAction({
        actor: resolve.proof,
        teamId,
        expectedCursor: pending.team.cursor,
      })
      resolve.revoke()
      expect(settled.phase).toBe('resolved')
      await first.dispose()
      const second = await setup(backend, first.root)
      const recovered = await second.ctx.teams.getTeam({ teamId })
      expect(recovered.humanActions).toEqual([expect.objectContaining({ id: actionId, phase: 'resolved' })])
      expect((await second.ctx.teams.inspectQuiescence(teamId)).reasons).not.toContain('human-actions-pending')
      await second.dispose()
    })
    it('replaces a step usage sample exactly once and stalls when a frozen budget is exceeded', async () => {
      const harness = await setup(backend, undefined, { maxModelTokensPerTeam: 5, maxTurnsPerTeam: 10 })
      const seeded = await populated(harness.ctx)
      const usage = await usageAuthority(harness.ctx, seeded.team.team.id, seeded.participant.id, `replace-${backend}`)
      const beforeFirst = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const sampleId = teamUsageSampleIdSchema.parse(`usage:${backend}`)
      const first = await harness.ctx.teams.recordUsage({
        expectedCursor: beforeFirst.team.cursor,
        actor: usage.actor,
        sample: {
          id: sampleId,
          turn: 1,
          step: 0,
          usage: { inputTokens: 3, outputTokens: 4 },
        },
      })
      expect(first).toMatchObject({ inputTokens: 3, outputTokens: 4, turns: 1 })
      const afterFirst = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      const replaced = await harness.ctx.teams.recordUsage({
        expectedCursor: afterFirst.team.cursor,
        actor: usage.actor,
        sample: {
          id: sampleId,
          turn: 1,
          step: 0,
          usage: { inputTokens: 3, outputTokens: 6 },
        },
      })
      expect(replaced.outputTokens).toBe(6)
      const state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      expect(state.usage).toMatchObject({ inputTokens: 3, outputTokens: 6, turns: 1 })
      expect(state.team.phase).toBe('stalled')
      await harness.dispose()
      const recovered = await setup(backend, harness.root, { maxModelTokensPerTeam: 5, maxTurnsPerTeam: 10 })
      await expect(recovered.ctx.teams.getTeam({ teamId: seeded.team.team.id })).resolves.toMatchObject({
        usage: { inputTokens: 3, outputTokens: 6, turns: 1 },
        team: { phase: 'stalled' },
      })
      await recovered.dispose()
    })
    it('keeps a Team active when usage is recorded while its concurrency cap is occupied', async () => {
      const harness = await setup(backend)
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Keep concurrent work alive.', budgets: {} },
        rules: {},
        budgets: { maxConcurrency: 1 },
      })
      await provisionTestCoordinator(harness.ctx, created.team.id)
      const participant = await activeServiceParticipant(harness.ctx, created.team.id, 'worker', 'local-agent')
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const task = await createTestCoordinatorTask(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        subject: 'Keep running',
        description: 'Remain active while another attempt is running.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
        budget: { maxConcurrency: 1 },
      })
      const activationId = await taskActivation(harness.ctx, created.team.id, participant.id)
      const assigned = await assignTestTask(harness.ctx, {
        teamId: created.team.id,
        taskId: task.id,
        expectedRevision: task.revision,
        participantId: participant.id,
        activationId,
        leaseDurationMs: 10_000,
      })
      expect(assigned.lease).toBeDefined()
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const usageBinding = state.activations.find(binding => binding.activation.id === activationId)
      if (usageBinding === undefined) throw new Error('concurrency test activation was not retained')
      await harness.ctx.teams.recordUsage({
        expectedCursor: state.team.cursor,
        actor: harness.ctx.teams.openActivationActorProofIssuer().issue(usageBinding).proof,
        sample: {
          id: teamUsageSampleIdSchema.parse(`concurrency:${backend}`),
          taskId: task.id,
          attemptId: assigned.lease?.attemptId,
          turn: 1,
          step: 0,
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      })
      await expect(harness.ctx.teams.getTeam({ teamId: created.team.id })).resolves.toMatchObject({
        team: { phase: 'active' },
      })
      await harness.dispose()
    })
    it('prices provider usage from the creation-time route table when a sample omits cost', async () => {
      const harness = await setup(backend, undefined, {
        usageRates: { 'mock/model': { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.003 } },
      })
      const seeded = await populated(harness.ctx)
      const usage = await usageAuthority(harness.ctx, seeded.team.team.id, seeded.participant.id, `priced-${backend}`)
      const aggregate = await harness.ctx.teams.recordUsage({
        expectedCursor: (await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })).team.cursor,
        actor: usage.actor,
        sample: {
          id: teamUsageSampleIdSchema.parse(`priced:${backend}`),
          provider: 'mock',
          model: 'model',
          turn: 1,
          step: 0,
          usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 5 },
        },
      })
      expect(aggregate.costUnits).toBeCloseTo(1.425)
      const state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
      expect(state.rules.usageRates).toEqual({
        'mock/model': { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.003 },
      })
      await harness.dispose()
    })
    it('rejects unknown usage pricing when a cost ceiling is active', async () => {
      const harness = await setup(backend)
      const team = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Require usage pricing', budgets: {} },
        rules: {},
        budgets: { maxCostUnits: 5 },
      })
      const participant = await activeServiceParticipant(harness.ctx, team.team.id, 'worker', 'local-agent')
      const usage = await usageAuthority(harness.ctx, team.team.id, participant.id, `unknown-cost-${backend}`)
      const sample = {
        id: teamUsageSampleIdSchema.parse(`unknown-cost:${backend}`),
        turn: 1,
        step: 0,
        usage: { inputTokens: 1, outputTokens: 1 },
      }
      await expect(harness.ctx.teams.recordUsage({
        expectedCursor: (await harness.ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
        actor: usage.actor,
        sample,
      })).rejects.toMatchObject({ code: 'TEAM_BUDGET_INVALID' })
      const retry = await harness.ctx.teams.recordUsage({
        expectedCursor: (await harness.ctx.teams.getTeam({ teamId: team.team.id })).team.cursor,
        actor: usage.actor,
        sample: { ...sample, costUnits: 1 },
      })
      expect(retry.costUnits).toBe(1)
      await harness.dispose()
    })
    it('rejects forged, revoked, foreign, and stale usage proofs before policy or journal effects', async () => {
      const harness = await setup(backend)
      const team = await createTestRootTeam(harness.ctx, { goal: { objective: 'Authorize usage facts.', budgets: {} }, rules: {}, budgets: {} })
      const participant = await activeServiceParticipant(harness.ctx, team.team.id, 'worker', 'local-agent')
      const usage = await usageAuthority(harness.ctx, team.team.id, participant.id, `proof-${backend}`)
      const issuer = harness.ctx.teams.openActivationActorProofIssuer()
      const revoked = issuer.issue(usage.binding)
      revoked.revoke()
      const foreignHarness = await setup(backend)
      const foreign = await createTestRootTeam(foreignHarness.ctx, { goal: { objective: 'Supply a foreign usage proof.', budgets: {} }, rules: {}, budgets: {} })
      const foreignParticipant = await activeServiceParticipant(foreignHarness.ctx, foreign.team.id, 'worker', 'local-agent')
      const foreignUsage = await usageAuthority(foreignHarness.ctx, foreign.team.id, foreignParticipant.id, `foreign-${backend}`)
      const policies: TeamPolicyRequest[] = []
      const unregister = harness.ctx.teams.registerPolicy('usage', {
        name: 'observe-invalid-usage-proof',
        async apply(request, next) {
          policies.push(request)
          return await next()
        },
      })
      const before = await harness.ctx.teams.getTeam({ teamId: team.team.id })
      const sample = {
        id: teamUsageSampleIdSchema.parse(`proof-usage:${backend}`),
        turn: 1,
        step: 0,
        usage: { inputTokens: 1, outputTokens: 1 },
      }
      for (const actor of [{}, revoked.proof, foreignUsage.actor] as const) {
        await expect(harness.ctx.teams.recordUsage({
          actor: actor as never,
          expectedCursor: before.team.cursor,
          sample,
        })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      }
      expect((await harness.ctx.teams.getTeam({ teamId: team.team.id })).team.cursor).toBe(before.team.cursor)
      expect(policies).toEqual([])
      await updateTestActivationStatus(harness.ctx, {
        teamId: team.team.id,
        activationId: usage.binding.activation.id,
        expectedCursor: before.team.cursor,
        status: 'offline',
      })
      const afterOffline = await harness.ctx.teams.getTeam({ teamId: team.team.id })
      await expect(harness.ctx.teams.recordUsage({
        actor: usage.actor,
        expectedCursor: afterOffline.team.cursor,
        sample,
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect((await harness.ctx.teams.getTeam({ teamId: team.team.id })).team.cursor).toBe(afterOffline.team.cursor)
      expect(policies).toEqual([])
      unregister()
      issuer.close()
      await foreignHarness.dispose()
      await harness.dispose()
    })
    it('propagates nested Team usage to every parent exactly once and restores it', async () => {
      const first = await setup(backend, undefined, { maxTeamDepth: 2 })
      const parent = await createTestRootTeam(first.ctx, {
        goal: { objective: 'Charge nested usage', budgets: {} },
        rules: {},
        budgets: { maxOutputTokens: 10 },
      })
      const parentTask = await reservedChildTask(first.ctx, parent.team.id, 'Child usage', { maxOutputTokens: 10 })
      const child = await createTestChildTeam(first.ctx, parentTask.creation)
      const childParticipant = await activeServiceParticipant(first.ctx, child.team.id, 'worker', 'local-agent')
      const childTask = await reservedChildTask(first.ctx, child.team.id, 'Grandchild usage', { maxOutputTokens: 10 })
      const grandchild = await createTestChildTeam(first.ctx, childTask.creation)
      const grandchildParticipant = await activeServiceParticipant(first.ctx, grandchild.team.id, 'worker', 'local-agent')
      const childUsage = await usageAuthority(first.ctx, child.team.id, childParticipant.id, `child-${backend}`)
      const grandchildUsage = await usageAuthority(first.ctx, grandchild.team.id, grandchildParticipant.id, `grandchild-${backend}`)
      const childState = await first.ctx.teams.getTeam({ teamId: child.team.id })
      await first.ctx.teams.recordUsage({
        expectedCursor: childState.team.cursor,
        actor: childUsage.actor,
        sample: {
          id: teamUsageSampleIdSchema.parse(`child-usage:${backend}`),
          turn: 1,
          step: 0,
          usage: { inputTokens: 1, outputTokens: 2 },
        },
      })
      const grandchildSampleId = teamUsageSampleIdSchema.parse(`grandchild-usage:${backend}`)
      await first.ctx.teams.recordUsage({
        expectedCursor: (await first.ctx.teams.getTeam({ teamId: grandchild.team.id })).team.cursor,
        actor: grandchildUsage.actor,
        sample: {
          id: grandchildSampleId,
          turn: 1,
          step: 0,
          usage: { inputTokens: 2, outputTokens: 5 },
        },
      })
      expect((await first.ctx.teams.getTeam({ teamId: child.team.id })).usage).toMatchObject({ inputTokens: 3, outputTokens: 7, turns: 2 })
      expect((await first.ctx.teams.getTeam({ teamId: parent.team.id })).usage).toMatchObject({ inputTokens: 3, outputTokens: 7, turns: 2 })
      await first.ctx.teams.recordUsage({
        expectedCursor: (await first.ctx.teams.getTeam({ teamId: grandchild.team.id })).team.cursor,
        actor: grandchildUsage.actor,
        sample: {
          id: grandchildSampleId,
          turn: 1,
          step: 0,
          usage: { inputTokens: 2, outputTokens: 5 },
        },
      })
      expect((await first.ctx.teams.getTeam({ teamId: parent.team.id })).usage).toMatchObject({ inputTokens: 3, outputTokens: 7, turns: 2 })
      const root = first.root
      await first.dispose()
      const second = await setup(backend, root, { maxTeamDepth: 2 })
      await expect(second.ctx.teams.getTeam({ teamId: child.team.id })).resolves.toMatchObject({
        usage: { inputTokens: 3, outputTokens: 7, turns: 2 },
      })
      await expect(second.ctx.teams.getTeam({ teamId: parent.team.id })).resolves.toMatchObject({
        usage: { inputTokens: 3, outputTokens: 7, turns: 2 },
      })
      await second.dispose()
    })
  })
  it('binds human task creation and edits to their complete payloads and revalidates after policy', async () => {
    const harness = await setup(backend)
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const unregister = harness.ctx.teams.registerHumanActorProofSource({
      name: 'team-human-task-actor',
      resolveHumanActorProof: proof => proofs.get(proof),
    })
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Control a task through an authenticated human proof.', budgets: {} }, rules: {}, budgets: {},
      })
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const human = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'human',
        displayName: 'Authenticated task owner',
        role: 'owner',
        capabilities: [],
        owner: { kind: 'product-principal', principalId: 'principal-task-test' as never },
        authorityGrant: {
          operations: ['task-mutate'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {},
        },
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: human.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const createInput = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('human-task-create') },
        subject: 'Human-created task',
        description: 'Persist the human-derived creator without an activation binding.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
      }
      const createProof = issueHumanActorProof(proofs, human.id, {
        teamId: createInput.teamId,
        operation: 'task-mutate',
        fence: { kind: 'cursor', cursor: createInput.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(createInput)),
      })
      const task = await harness.ctx.teams.createTask({ actor: createProof, ...createInput })
      expect(task.createCommand.creator).toEqual({ teamId: created.team.id, participantId: human.id })
      const updateInput = {
        teamId: created.team.id,
        taskId: task.id,
        expectedRevision: task.revision,
        subject: 'Human-updated task',
      }
      const updateProofInput: TeamHumanActorProofInput = {
        teamId: updateInput.teamId,
        operation: 'task-mutate',
        fence: { kind: 'revision', revision: updateInput.expectedRevision },
        payload: jsonObjectSchema.parse(structuredClone(updateInput)),
      }
      const tamperedProof = issueHumanActorProof(proofs, human.id, updateProofInput)
      await expect(harness.ctx.teams.updateTaskDetails({
        actor: tamperedProof,
        ...updateInput,
        subject: 'Tampered task edit',
      })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const crossOperationProof = Object.freeze({}) as TeamHumanActorProof
      const crossOperationInput = { ...updateProofInput, operation: 'send' as const }
      proofs.set(crossOperationProof, {
        teamId: crossOperationInput.teamId,
        participantId: human.id,
        operation: crossOperationInput.operation,
        payloadFingerprint: fingerprintTeamHumanActorPayload(crossOperationInput),
        fence: crossOperationInput.fence,
      })
      await expect(harness.ctx.teams.updateTaskDetails({ actor: crossOperationProof, ...updateInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const revokedProof = issueHumanActorProof(proofs, human.id, updateProofInput)
      const unregisterPolicy = harness.ctx.teams.registerPolicy('task-mutate', {
        name: 'revoke-human-task-proof-after-policy',
        async apply(_request, next) {
          proofs.delete(revokedProof)
          return await next()
        },
      })
      try {
        await expect(harness.ctx.teams.updateTaskDetails({ actor: revokedProof, ...updateInput }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        unregisterPolicy()
      }
      await expect(harness.ctx.teams.getTask({ teamId: created.team.id, taskId: task.id }))
        .resolves.toMatchObject({ revision: task.revision, subject: task.subject })
      const cancelInput = { teamId: created.team.id, taskId: task.id, expectedRevision: task.revision }
      const cancelProof = issueHumanActorProof(proofs, human.id, {
        teamId: created.team.id, operation: 'task-mutate',
        fence: { kind: 'revision', revision: task.revision }, payload: jsonObjectSchema.parse(cancelInput),
      })
      const cancelled = await harness.ctx.teams.cancelTask({ actor: cancelProof, ...cancelInput })
      await failDurableFixture(harness.ctx, created.team.id)
      const terminalInput = { ...updateInput, expectedRevision: cancelled.revision }
      const terminalProof = issueHumanActorProof(proofs, human.id, {
        teamId: created.team.id, operation: 'task-mutate',
        fence: { kind: 'revision', revision: cancelled.revision }, payload: jsonObjectSchema.parse(terminalInput),
      })
      await expect(harness.ctx.teams.updateTaskDetails({ actor: terminalProof, ...terminalInput }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await expect(harness.ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })).resolves.toEqual(cancelled)
    } finally {
      unregister()
      await harness.dispose()
    }
  })
  it('derives a human task reviewer from the proof and enforces the durable review policy', async () => {
    const harness = await setup('json')
    const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
    const unregister = harness.ctx.teams.registerHumanActorProofSource({
      name: 'team-human-task-reviewer',
      resolveHumanActorProof: proof => proofs.get(proof),
    })
    try {
      const created = await createTestRootTeam(harness.ctx, {
        goal: { objective: 'Review a task through an authenticated human proof.', budgets: {} }, rules: {}, budgets: {},
      })
      const activateHuman = async (
        displayName: string,
        owner: Extract<NonNullable<ParticipantSnapshot['owner']>, { readonly kind: 'product-principal' }>,
      ): Promise<ParticipantSnapshot> => {
        let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
        const invited = await inviteBootstrapParticipant(harness.ctx, {
          teamId: created.team.id,
          expectedCursor: state.team.cursor,
          kind: 'human',
          displayName,
          role: 'reviewer',
          capabilities: [],
          owner,
          authorityGrant: {
            operations: ['task-mutate'], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {},
          },
        })
        state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
        await transitionBootstrapParticipant(harness.ctx, {
          teamId: created.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'provisioning',
        })
        state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
        return await transitionBootstrapParticipant(harness.ctx, {
          teamId: created.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active',
        })
      }
      const reviewer = await activateHuman('Configured reviewer', {
        kind: 'product-principal', principalId: 'principal-reviewer' as never,
      })
      const otherHuman = await activateHuman('Other human', {
        kind: 'product-principal', principalId: 'principal-other-reviewer' as never,
      })
      let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const worker = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        kind: 'local-agent',
        displayName: 'Task worker',
        role: 'worker',
        capabilities: [],
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: worker.id, expectedCursor: state.team.cursor, phase: 'provisioning',
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id, participantId: worker.id, expectedCursor: state.team.cursor, phase: 'active',
      })
      const binding = await bindTestActivation(harness.ctx, {
        expectedCursor: (await harness.ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
        binding: {
          activation: {
            id: activationIdSchema.parse('human-task-review-worker'),
            teamId: created.team.id,
            participantId: worker.id,
            status: 'idle',
          },
          sessionId: SessionId('human-task-review-worker-session'),
          provider: 'in-process',
        },
      })
      state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const createInput = {
        teamId: created.team.id,
        expectedCursor: state.team.cursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('human-task-review-create') },
        subject: 'Human-reviewed task',
        description: 'The durable reviewer must match the authenticated proof-derived participant.',
        blockedBy: [],
        writeScopes: [],
        ...taskDefaults,
        reviewPolicy: { kind: 'participant' as const, reviewerId: reviewer.id },
      }
      const createProofInput: TeamHumanActorProofInput = {
        teamId: createInput.teamId,
        operation: 'task-mutate',
        fence: { kind: 'cursor', cursor: createInput.expectedCursor },
        payload: jsonObjectSchema.parse(structuredClone(createInput)),
      }
      const task = await harness.ctx.teams.createTask({
        actor: issueHumanActorProof(proofs, reviewer.id, createProofInput),
        ...createInput,
      })
      const assigned = await assignTestTask(harness.ctx, {
        teamId: task.teamId,
        taskId: task.id,
        expectedRevision: task.revision,
        participantId: worker.id,
        activationId: binding.activation.id,
        leaseDurationMs: 1_000,
      })
      const lease = assigned.lease
      if (lease === undefined) throw new Error('review task was not assigned')
      const workerActor = harness.ctx.teams.openActivationActorProofIssuer().issue(binding).proof
      const running = await harness.ctx.teams.startTaskAttempt({
        actor: workerActor,
        taskId: assigned.id,
        expectedRevision: assigned.revision,
        attemptId: lease.attemptId,
      })
      const reviewing = await harness.ctx.teams.settleTaskAttempt({
        actor: workerActor,
        taskId: running.id,
        expectedRevision: running.revision,
        attemptId: lease.attemptId,
        outcome: { kind: 'completed', result: { summary: 'Ready for review.' } },
      })
      const reviewInput = {
        taskId: reviewing.id,
        expectedRevision: reviewing.revision,
        nextPhase: 'completed' as const,
        reason: 'The configured human accepted the result.',
      }
      const proofInput: TeamHumanActorProofInput = {
        teamId: created.team.id,
        operation: 'task-mutate',
        fence: { kind: 'revision', revision: reviewInput.expectedRevision },
        payload: jsonObjectSchema.parse({ teamId: created.team.id, ...reviewInput }),
      }
      await expect(harness.ctx.teams.resolveTaskReview({
        actor: issueHumanActorProof(proofs, otherHuman.id, proofInput),
        ...reviewInput,
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await expect(harness.ctx.teams.resolveTaskReview({
        actor: issueHumanActorProof(proofs, reviewer.id, proofInput),
        ...reviewInput,
      })).resolves.toMatchObject({
        phase: 'completed', reviewHistory: [{ reviewerId: reviewer.id, nextPhase: 'completed' }],
      })
    } finally {
      unregister()
      await harness.dispose()
    }
  })
}
describe('TeamHub commands', () => {
  it('resolves visible artifacts through the provider-owned lookup source', async () => {
    const harness = await setup('json')
    try {
      const seeded = await populated(harness.ctx)
      const activationId = await taskActivation(harness.ctx, seeded.team.team.id, seeded.participant.id)
      const assigned = await assignTestTask(harness.ctx, {
        teamId: seeded.team.team.id,
        taskId: seeded.task.id,
        expectedRevision: seeded.task.revision,
        participantId: seeded.participant.id,
        activationId,
        leaseDurationMs: 1_000,
      })
      const lease = assigned.lease
      if (lease === undefined) throw new Error('artifact lookup fixture was not assigned')
      const actor = await postActor(harness.ctx, seeded.team.team.id, seeded.participant.id)
      const running = await harness.ctx.teams.startTaskAttempt({
        actor,
        taskId: assigned.id,
        expectedRevision: assigned.revision,
        attemptId: lease.attemptId,
      })
      const artifact = {
        id: 'hub-visible-artifact', provider: 'local', kind: 'report' as const,
        uri: 'artifact://hub-visible-artifact', visibility: 'team' as const,
        sourceAttemptId: lease.attemptId,
      }
      await harness.ctx.teams.settleTaskAttempt({
        actor,
        taskId: running.id,
        expectedRevision: running.revision,
        attemptId: lease.attemptId,
        outcome: { kind: 'completed', result: { summary: 'Published one artifact.', artifacts: [artifact] } },
      })
      await expect(harness.ctx.teams.getArtifact({ teamId: seeded.team.team.id, artifactId: artifact.id }))
        .resolves.toEqual(artifact)
      await expect(harness.ctx.teams.getArtifact({ teamId: seeded.team.team.id, artifactId: 'missing-artifact' }))
        .resolves.toBeUndefined()
    } finally {
      await harness.dispose()
    }
  })

  it('keeps a denied child usage charge pending and repairs it before assignment', async () => {
    const harness = await setup('sqlite', undefined, { maxTeamDepth: 1 })
    const parent = await createTestRootTeam(harness.ctx, { goal: { objective: 'Parent budget owner', budgets: {} }, rules: {}, budgets: {} })
    const parentTask = await reservedChildTask(harness.ctx, parent.team.id, 'Pending child charge')
    const child = await createTestChildTeam(harness.ctx, parentTask.creation)
    const participant = await activeServiceParticipant(harness.ctx, child.team.id, 'worker', 'local-agent')
    const usage = await usageAuthority(harness.ctx, child.team.id, participant.id, 'pending-child')
    const task = await childAnchorTask(harness.ctx, child.team.id)
    let denyParentCharge = true
    const unregister = harness.ctx.teams.registerPolicy('usage', {
      name: 'temporarily-deny-parent-charge',
      async apply(request, next) {
        if (denyParentCharge && request.facts.chargeId !== undefined) {
          return { kind: 'deny', code: 'PARENT_NOT_READY', message: 'parent charge is temporarily unavailable' }
        }
        return await next()
      },
    })
    const sample = {
      id: teamUsageSampleIdSchema.parse('pending-child-usage'),
      turn: 1,
      step: 0,
      usage: { inputTokens: 1, outputTokens: 1 },
    }
    await expect(harness.ctx.teams.recordUsage({
      expectedCursor: (await harness.ctx.teams.getTeam({ teamId: child.team.id })).team.cursor,
      actor: usage.actor,
      sample,
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    const internals = harness.ctx.teams as unknown as {
      teams: Map<string, { projection: { pendingParentCharges: Map<unknown, unknown> } }>
    }
    expect(internals.teams.get(child.team.id)?.projection.pendingParentCharges.size).toBe(1)
    await expect(assignTestTask(harness.ctx, {
      teamId: child.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: participant.id,
      activationId: usage.binding.activation.id,
      leaseDurationMs: 1_000,
    })).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    denyParentCharge = false
    const assigned = await assignTestTask(harness.ctx, {
      teamId: child.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: participant.id,
      activationId: usage.binding.activation.id,
      leaseDurationMs: 1_000,
    })
    expect(assigned.lease).toBeDefined()
    expect(internals.teams.get(child.team.id)?.projection.pendingParentCharges.size).toBe(0)
    unregister()
    await harness.dispose()
  })
  it('requires a durable human receipt before completing and makes completion retry-safe', async () => {
    const harness = await setup('sqlite')
    const completionAdapter = directV4Adapter
    const created = await createTestRootTeam(harness.ctx, { goal: { objective: 'Complete one Team', budgets: {} }, rules: {}, budgets: {} })
    const invite = async (kind: 'human' | 'local-agent', role: string, displayName: string) => {
      const before = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      const participant = await inviteBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        expectedCursor: before.team.cursor,
        kind,
        displayName,
        role,
        capabilities: [],
      })
      let current = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        participantId: participant.id,
        expectedCursor: current.team.cursor,
        phase: 'provisioning',
      })
      current = await harness.ctx.teams.getTeam({ teamId: created.team.id })
      return await transitionBootstrapParticipant(harness.ctx, {
        teamId: created.team.id,
        participantId: participant.id,
        expectedCursor: current.team.cursor,
        phase: 'active',
      })
    }
    const human = await invite('human', 'human', 'Human')
    const coordinator = await invite('local-agent', 'coordinator', 'Coordinator')
    const coordinatorActor = await postActor(harness.ctx, created.team.id, coordinator.id)
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openActiveTestChannel(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: completionAdapter.type, version: completionAdapter.version },
      participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    }, [coordinator.id], [human.id])
    const final = await harness.ctx.teams.postChannelEnvelope({
      actor: coordinatorActor,
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [human.id],
        kind: 'final',
        payload: { text: 'Done.' },
        delivery: 'turn',
      },
    })
    const closureActor = await postActor(harness.ctx, created.team.id, coordinator.id)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await expect(harness.ctx.teams.completeTeam({
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('complete-without-receipt'),
      actor: closureActor,
      reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'Done.' },
      finalChannelId: channel.manifest.id,
      finalEnvelopeId: final.id,
    })).rejects.toMatchObject({ code: 'TEAM_FINAL_INVALID' })
    const receiptProofObject: object = {}
    Object.defineProperty(receiptProofObject, 'toJSON', {
      enumerable: true,
      value: (): never => { throw new TypeError('test final-receipt proofs are runtime-only') },
    })
    const receiptProof = Object.freeze(receiptProofObject) as TeamSystemFinalReceiptProof
    const receiptScope: TeamSystemFinalReceiptScope = {
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    const receiptProofs = new WeakMap<TeamSystemFinalReceiptProof, TeamSystemFinalReceiptScope>([
      [receiptProof, receiptScope],
    ])
    harness.ctx.teams.registerSystemFinalReceiptProofSource({
      name: 'team-run',
      resolveFinalReceiptProof: proof => receiptProofs.get(proof),
    })
    await admitTestFinal(harness.ctx, receiptProof, final)
    await harness.ctx.teams.ackChannelEnvelope({
      actor: receiptProof,
      channelId: channel.manifest.id,
      envelopeId: final.id,
      expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
    })
    const closed = await closeTestChannel(harness.ctx, {
      channelId: channel.manifest.id,
      expectedCursor: (await harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('complete-with-receipt'),
      actor: closureActor,
      reason: { code: 'FINAL_ANSWER_ACCEPTED', message: 'Done.' },
      finalChannelId: closed.manifest.id,
      finalEnvelopeId: final.id,
    }
    const completed = await harness.ctx.teams.completeTeam(request)
    expect(completed.team).toMatchObject({ phase: 'quiescing', closure: { kind: 'complete', finalEnvelopeId: final.id } })
    expect(completed.goal.phase).toBe('complete')
    const replay = await harness.ctx.teams.completeTeam({ ...request, expectedCursor: 0 })
    expect(replay).toEqual(completed)
    await harness.dispose()
  })
  it('cancels lease-free work and closes channels under one durable closure intent', async () => {
    const harness = await setup('sqlite')
    const created = await createTestRootTeam(harness.ctx, { goal: { objective: 'Cancel one Team', budgets: {} }, rules: {}, budgets: {} })
    harness.ctx.teams.registerAdapter(directV3Adapter)
    const human = await activeTeamParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const task = await createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Cancelable task',
      description: 'This task should be durably cancelled.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openActiveTestChannel(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: directV4Adapter.type, version: directV4Adapter.version },
      participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    }, [coordinator.id], [human.id])
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const coordinatorBinding = state.activations.find(binding => binding.activation.participantId === coordinator.id)
    if (coordinatorBinding === undefined) throw new Error('task creation did not retain the cancellation coordinator activation')
    await quiesceTestActivation(harness.ctx, {
      teamId: created.team.id,
      activationId: coordinatorBinding.activation.id,
      participantId: coordinatorBinding.activation.participantId,
      sessionId: coordinatorBinding.sessionId,
      provider: coordinatorBinding.provider,
      expectedCursor: state.team.cursor,
    })
    const closureActor = teamRunClosureAuthority(harness.ctx).issue({
      kind: 'team-run-cancel',
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }).proof
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('cancel-team'),
      actor: closureActor,
      reason: { code: 'TEST_CANCELLED', message: 'The test requested cancellation.' },
    }
    const cancelled = await harness.ctx.teams.cancelTeam(request)
    expect(cancelled.team).toMatchObject({
      phase: 'cancelled',
      closure: { kind: 'cancel', actor: { kind: 'system', name: 'team-run' } },
    })
    await expect(harness.ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })).resolves.toMatchObject({ phase: 'cancelled' })
    await expect(harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
    expect(await harness.ctx.teams.cancelTeam({ ...request, expectedCursor: 0 })).toEqual(cancelled)
    await harness.dispose()
  })
  it('persists cancellation before an active lease settles and finalizes on retry', async () => {
    const harness = await setup('sqlite')
    const created = await createTestRootTeam(harness.ctx, { goal: { objective: 'Cancel active work', budgets: {} }, rules: {}, budgets: {} })
    harness.ctx.teams.registerAdapter(directV3Adapter)
    const human = await activeTeamParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const defaultChannel = await openActiveTestChannel(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: directV4Adapter.type, version: directV4Adapter.version },
      participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    }, [coordinator.id], [human.id])
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const participant = await inviteBootstrapParticipant(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      kind: 'local-agent',
      displayName: 'Active worker',
      role: 'worker',
      capabilities: [],
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await transitionBootstrapParticipant(harness.ctx, { teamId: created.team.id, participantId: participant.id, expectedCursor: state.team.cursor, phase: 'provisioning' })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await transitionBootstrapParticipant(harness.ctx, { teamId: created.team.id, participantId: participant.id, expectedCursor: state.team.cursor, phase: 'active' })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const binding = await bindTestActivation(harness.ctx, {
      expectedCursor: state.team.cursor,
      binding: {
        activation: { id: activationIdSchema.parse('cancel-active-activation'), teamId: created.team.id, participantId: participant.id, status: 'idle' },
        sessionId: SessionId('cancel-active-session'),
        provider: 'in-process',
      },
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const task = await createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Active cancellation',
      description: 'The owner settles after cancellation intent.',
      blockedBy: [],
      writeScopes: [],
      ...taskDefaults,
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const coordinatorBinding = state.activations.find(binding => binding.activation.participantId === coordinator.id)
    if (coordinatorBinding === undefined) throw new Error('task creation did not retain the active-cancellation coordinator activation')
    await quiesceTestActivation(harness.ctx, {
      teamId: created.team.id,
      activationId: coordinatorBinding.activation.id,
      participantId: coordinatorBinding.activation.participantId,
      sessionId: coordinatorBinding.sessionId,
      provider: coordinatorBinding.provider,
      expectedCursor: state.team.cursor,
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const assigned = await assignTestTask(harness.ctx, {
      teamId: created.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: participant.id,
      activationId: binding.activation.id,
      leaseDurationMs: 10_000,
    })
    expect(assigned.phase).toBe('assigned')
    const closureProof = teamRunClosureAuthority(harness.ctx).issue({
      kind: 'team-run-cancel',
      teamId: created.team.id,
      channelId: defaultChannel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }).proof
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('cancel-active-team'),
      actor: closureProof,
      reason: { code: 'TEST_CANCELLED', message: 'The test requested cancellation.' },
    }
    const pending = await harness.ctx.teams.cancelTeam(request)
    expect(pending.team).toMatchObject({ phase: 'quiescing', cancellation: { idempotencyKey: request.idempotencyKey } })
    expect(pending.team.closure).toBeUndefined()
    expect(pending.tasks.find(candidate => candidate.id === task.id)?.phase).toBe('assigned')
    await expect(harness.ctx.teams.getChannel({ channelId: defaultChannel.manifest.id })).resolves.toMatchObject({ phase: 'active' })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const fenced = await fenceTestActivation(harness.ctx, {
      teamId: created.team.id,
      activationId: binding.activation.id,
      participantId: participant.id,
      sessionId: SessionId('cancel-active-session'),
      provider: 'in-process',
      expectedCursor: state.team.cursor,
    })
    expect(fenced.tasks.find(candidate => candidate.id === task.id)).toMatchObject({
      phase: 'cancelled', attemptHistory: [{ outcome: { kind: 'released' } }],
    })
    const cancelled = await harness.ctx.teams.cancelTeam({ ...request, expectedCursor: fenced.team.cursor })
    expect(cancelled.team).toMatchObject({
      phase: 'cancelled',
      cancellation: { idempotencyKey: request.idempotencyKey, actor: { kind: 'system', name: 'team-run' } },
      closure: { kind: 'cancel', actor: { kind: 'system', name: 'team-run' } },
    })
    await harness.dispose()
  })
  it('durably abandons pending deliveries before cancelling a Team', async () => {
    const harness = await setup('sqlite')
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Retain pending cancellation delivery.', budgets: {} }, rules: {}, budgets: {},
    })
    harness.ctx.teams.registerAdapter(pendingDirectV3Adapter)
    const human = await activeTeamParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openActiveTestChannel(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: directV4Adapter.type, version: directV4Adapter.version },
      participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    }, [coordinator.id], [human.id])
    const envelope = await harness.ctx.teams.postChannelEnvelope({
      actor: await postActor(harness.ctx, created.team.id, coordinator.id),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [human.id],
        kind: 'message',
        payload: { text: 'This delivery must remain durable.' },
        delivery: 'turn',
      },
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const coordinatorBinding = state.activations.find(binding => binding.activation.participantId === coordinator.id)
    if (coordinatorBinding === undefined) throw new Error('pending-delivery fixture did not bind its coordinator')
    await quiesceTestActivation(harness.ctx, {
      teamId: created.team.id,
      activationId: coordinatorBinding.activation.id,
      participantId: coordinatorBinding.activation.participantId,
      sessionId: coordinatorBinding.sessionId,
      provider: coordinatorBinding.provider,
      expectedCursor: state.team.cursor,
    })
    const scope: TeamSystemClosureScope = {
      kind: 'team-run-cancel',
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    const closure = teamRunClosureAuthority(harness.ctx)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('cancel-pending-delivery-team'),
      actor: closure.issue(scope).proof,
      reason: { code: 'TEST_CANCELLED', message: 'The test requested cancellation.' },
    }
    const cancelling = await harness.ctx.teams.cancelTeam(request)
    expect(cancelling.team).toMatchObject({
      phase: 'cancelled',
      cancellation: { idempotencyKey: request.idempotencyKey },
      closure: { kind: 'cancel' },
    })
    await expect(harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
    const hub = harness.ctx.teams as unknown as {
      readonly channels: ReadonlyMap<string, {
        readonly projection: { readonly pendingDeliveries: ReadonlyMap<string, ReadonlyMap<string, unknown>> }
      }>
    }
    expect(hub.channels.get(channel.manifest.id)?.projection.pendingDeliveries.get(human.id)?.has(envelope.id)).not.toBe(true)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const retry = await harness.ctx.teams.cancelTeam({
      ...request,
      expectedCursor: state.team.cursor,
      actor: closure.issue(scope).proof,
    })
    expect(retry.team).toMatchObject({ phase: 'cancelled', closure: { kind: 'cancel' } })
    await expect(harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
    await harness.dispose()
  })
  it('retains a durable cancellation delivery-abandonment record for TTL-bound input', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const harness = await setup('sqlite')
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Drain an expired cancellation delivery.', budgets: {} }, rules: {}, budgets: {},
    })
    harness.ctx.teams.registerAdapter(pendingDirectV3Adapter)
    const human = await activeTeamParticipant(harness.ctx, created.team.id, 'human', 'human', 'Human')
    const coordinator = await activeTeamParticipant(harness.ctx, created.team.id, 'local-agent', 'coordinator', 'Coordinator')
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openActiveTestChannel(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: { type: directV4Adapter.type, version: directV4Adapter.version },
      participants: [{ id: human.id, role: 'human' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    }, [coordinator.id], [human.id])
    const envelope = await harness.ctx.teams.postChannelEnvelope({
      actor: await postActor(harness.ctx, created.team.id, coordinator.id),
      expectedCursor: channel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [human.id],
        kind: 'message',
        payload: { text: 'This delivery expires before cancellation can finish.' },
        delivery: 'turn',
        ttlMs: 10,
      },
    })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const coordinatorBinding = state.activations.find(binding => binding.activation.participantId === coordinator.id)
    if (coordinatorBinding === undefined) throw new Error('cancellation expiry fixture did not bind its coordinator')
    await quiesceTestActivation(harness.ctx, {
      teamId: created.team.id,
      activationId: coordinatorBinding.activation.id,
      participantId: coordinatorBinding.activation.participantId,
      sessionId: coordinatorBinding.sessionId,
      provider: coordinatorBinding.provider,
      expectedCursor: state.team.cursor,
    })
    const scope: TeamSystemClosureScope = {
      kind: 'team-run-cancel',
      teamId: created.team.id,
      channelId: channel.manifest.id,
      humanId: human.id,
      coordinatorId: coordinator.id,
    }
    const closure = teamRunClosureAuthority(harness.ctx)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const request = {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      idempotencyKey: teamClosureIdempotencyKeySchema.parse('cancel-ttl-delivery-team'),
      actor: closure.issue(scope).proof,
      reason: { code: 'TEST_CANCELLED', message: 'The test requested cancellation.' },
    }
    const cancelling = await harness.ctx.teams.cancelTeam(request)
    expect(cancelling.team).toMatchObject({ phase: 'cancelled', closure: { kind: 'cancel' } })
    const records = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    expect(records.records.some(record => record.type === 'channel/receipt' && record.envelopeId === envelope.id)).toBe(false)
    expect(records.records).toContainEqual(expect.objectContaining({
      type: 'channel/delivery-expired', participantId: human.id, envelopeId: envelope.id, reason: 'cancellation',
    }))
    await expect(harness.ctx.teams.getChannel({ channelId: channel.manifest.id })).resolves.toMatchObject({ phase: 'closed' })
    await harness.dispose()
  })
  it('reserves typed task ceilings against the remaining Team budget', async () => {
    const harness = await setup('sqlite')
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Reserve task budget', budgets: {} },
      rules: {},
      budgets: { maxOutputTokens: 5 },
    })
    await provisionTestCoordinator(harness.ctx, created.team.id)
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    const first = await createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'First budgeted task',
      description: 'Reserve four output tokens.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: { maxOutputTokens: 4 },
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
    })
    expect(first.budget).toEqual({ maxOutputTokens: 4 })
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await expect(createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Over-reserved task',
      description: 'The Team has only one output token left.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: { maxOutputTokens: 2 },
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
    })).rejects.toMatchObject({ code: 'TEAM_BUDGET_EXCEEDED' })
    await harness.dispose()
  })
  it('enforces immutable authority subsets for participant and task admission', async () => {
    const harness = await setup('sqlite')
    const grant = teamAuthorityGrantSchema.parse({
      operations: ['invite', 'activate', 'task-mutate', 'close'],
      workspaceModes: ['shared'],
      readScopes: ['packages/team'],
      writeScopes: ['packages/team'],
      budgets: { maxOutputTokens: 5 },
    })
    const created = await createTestRootTeam(harness.ctx, {
      goal: { objective: 'Enforce authority', budgets: {} },
      rules: {},
      budgets: { maxOutputTokens: 10 },
      authorityGrant: grant,
    })
    await provisionTestCoordinator(harness.ctx, created.team.id)
    let state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await expect(inviteBootstrapParticipant(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      kind: 'service',
      displayName: 'Escalated',
      role: 'worker',
      capabilities: [],
      authorityGrant: {
        ...grant,
        workspaceModes: ['worktree'],
      },
    })).rejects.toMatchObject({ code: 'TEAM_GRANT_DENIED' })
    const participant = await inviteBootstrapParticipant(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      kind: 'service',
      displayName: 'Worker',
      role: 'worker',
      capabilities: [],
    })
    expect(participant.authorityGrant).toEqual(grant)
    state = await harness.ctx.teams.getTeam({ teamId: created.team.id })
    await expect(createTestCoordinatorTask(harness.ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      subject: 'Outside scope',
      description: 'The grant does not cover this path.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: ['docs'],
      workspaceMode: 'shared',
      budget: { maxOutputTokens: 1 },
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
    })).rejects.toMatchObject({ code: 'TEAM_GRANT_DENIED' })
    await harness.dispose()
  })
  it('authorizes, deduplicates, emits, and acknowledges exact participant interrupts', async () => {
    const harness = await setup('sqlite')
    const topology = await interruptTopology(harness.ctx, 'Authorize a participant interrupt.')
    const binding = await interruptActivation(harness.ctx, topology.team.team.id, topology.coordinator.id, 'interrupt-activation', topology.channel.manifest.id)
    const authority = teamRunInterruptAuthority(harness.ctx)
    const policyFacts: TeamPolicyRequest[] = []
    const events: TeamEvent[] = []
    harness.ctx.teams.registerPolicy('interrupt', {
      name: 'capture-interrupt-target',
      async apply(request, next) {
        policyFacts.push(request)
        return await next()
      },
    })
    harness.ctx.on('team/changed', (event) => {
      if (event.type === 'participant-interrupt/changed') events.push(event)
    })
    const state = await harness.ctx.teams.getTeam({ teamId: topology.team.team.id })
    const interrupt = await harness.ctx.teams.requestParticipantInterrupt({
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      actor: authority.issue({
        kind: 'team-run-human-interrupt',
        teamId: topology.team.team.id,
        channelId: topology.channel.manifest.id,
        humanId: topology.human.id,
        coordinatorId: topology.coordinator.id,
      }),
    })
    expect(interrupt.actorId).toBe(topology.human.id)
    expect(interrupt.target).toEqual({
      teamId: topology.team.team.id,
      participantId: topology.coordinator.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
      provider: binding.provider,
    })
    expect(interrupt.requestedAt).toEqual(expect.any(Number))
    expect(policyFacts).toHaveLength(1)
    const policy = policyFacts[0]
    expect(policy?.hook).toBe('interrupt')
    expect(policy?.actorId).toBe(topology.human.id)
    expect(policy?.facts).toMatchObject(interrupt.target)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'participant-interrupt/changed', interrupt })
    const duplicate = await harness.ctx.teams.requestParticipantInterrupt({
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      actor: authority.issue({
        kind: 'team-run-human-interrupt',
        teamId: topology.team.team.id,
        channelId: topology.channel.manifest.id,
        humanId: topology.human.id,
        coordinatorId: topology.coordinator.id,
      }),
    })
    expect(duplicate).toEqual(interrupt)
    expect((await harness.ctx.teams.getTeam({ teamId: state.team.id })).team.cursor).toBe(state.team.cursor + 1)
    const targetActor = interruptActor(harness.ctx, binding)
    await expect(harness.ctx.teams.listPendingParticipantInterrupts({
      actor: targetActor,
    })).resolves.toEqual([interrupt])
    const acknowledged = await harness.ctx.teams.acknowledgeParticipantInterrupt({
      interruptId: interrupt.id,
      actor: targetActor,
    })
    expect(acknowledged.id).toBe(interrupt.id)
    expect(acknowledged.acknowledgedAt).toEqual(expect.any(Number))
    await expect(harness.ctx.teams.acknowledgeParticipantInterrupt({
      interruptId: interrupt.id,
      actor: targetActor,
    })).resolves.toEqual(acknowledged)
    await expect(harness.ctx.teams.listPendingParticipantInterrupts({
      actor: targetActor,
    })).resolves.toEqual([])
    await expect(harness.ctx.teams.requestParticipantInterrupt({
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      actor: authority.issue({
        kind: 'team-run-human-interrupt',
        teamId: topology.team.team.id,
        channelId: topology.channel.manifest.id,
        humanId: topology.human.id,
        coordinatorId: topology.coordinator.id,
      }),
    })).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(events).toEqual([
      expect.objectContaining({ type: 'participant-interrupt/changed', interrupt }),
      expect.objectContaining({ type: 'participant-interrupt/changed', interrupt: acknowledged }),
    ])
    await harness.dispose()
  })
  it('rejects policy-denied, stale, and replaced interrupt targets without delivering old requests', async () => {
    const harness = await setup('sqlite')
    const topology = await interruptTopology(harness.ctx, 'Reject stale interrupt targets.')
    const authority = teamRunInterruptAuthority(harness.ctx)
    const requestInterrupt = async () => {
      const state = await harness.ctx.teams.getTeam({ teamId: topology.team.team.id })
      return await harness.ctx.teams.requestParticipantInterrupt({
        teamId: state.team.id,
        expectedCursor: state.team.cursor,
        actor: authority.issue({
          kind: 'team-run-human-interrupt',
          teamId: topology.team.team.id,
          channelId: topology.channel.manifest.id,
          humanId: topology.human.id,
          coordinatorId: topology.coordinator.id,
        }),
      })
    }
    await expect(requestInterrupt()).rejects.toMatchObject({ code: 'TEAM_ACTIVATION_NOT_FOUND' })
    const binding = await interruptActivation(harness.ctx, topology.team.team.id, topology.coordinator.id, 'interrupt-activation', topology.channel.manifest.id)
    const deny = harness.ctx.teams.registerPolicy('interrupt', {
      name: 'deny-interrupt',
      async apply() { return { kind: 'deny', code: 'interrupt-denied', message: 'not now' } },
    })
    await expect(requestInterrupt()).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    deny()
    const interrupt = await requestInterrupt()
    let state = await harness.ctx.teams.getTeam({ teamId: topology.team.team.id })
    await updateTestActivationStatus(harness.ctx, {
      teamId: state.team.id,
      activationId: binding.activation.id,
      expectedCursor: state.team.cursor,
      status: 'stopping',
    })
    const stoppingActor = interruptActor(harness.ctx, binding)
    await expect(harness.ctx.teams.listPendingParticipantInterrupts({
      actor: stoppingActor,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.acknowledgeParticipantInterrupt({
      interruptId: interrupt.id,
      actor: stoppingActor,
    })).resolves.toMatchObject({ id: interrupt.id })
    state = await harness.ctx.teams.getTeam({ teamId: topology.team.team.id })
    await updateTestActivationStatus(harness.ctx, {
      teamId: state.team.id,
      activationId: binding.activation.id,
      expectedCursor: state.team.cursor,
      status: 'offline',
    })
    const resumed = await interruptActivation(harness.ctx, topology.team.team.id, topology.coordinator.id, 'interrupt-resumed', topology.channel.manifest.id)
    const resumedActor = interruptActor(harness.ctx, resumed)
    await expect(harness.ctx.teams.listPendingParticipantInterrupts({
      actor: resumedActor,
    })).resolves.toEqual([])
    await expect(harness.ctx.teams.acknowledgeParticipantInterrupt({
      interruptId: interrupt.id,
      actor: resumedActor,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(harness.ctx.teams.listPendingParticipantInterrupts({
      actor: {} as never,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(harness.ctx.teams.acknowledgeParticipantInterrupt({
      interruptId: interrupt.id,
      actor: {} as never,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    state = await harness.ctx.teams.getTeam({ teamId: topology.team.team.id })
    await seedTeamPhase(harness.ctx, state.team.id, 'quiescing')
    await expect(requestInterrupt()).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await harness.dispose()
  })
  it('rejects missing and cyclic durable task blockers before appending a mutation', async () => {
    const harness = await setup('sqlite')
    const seeded = await populated(harness.ctx)
    await expect(createTestCoordinatorTask(harness.ctx, {
      teamId: seeded.team.team.id,
      expectedCursor: seeded.team.team.cursor,
      subject: 'Broken dependency',
      description: 'References a task that does not exist.',
      blockedBy: ['missing-task' as typeof seeded.task.id],
      writeScopes: [],
      ...taskDefaults,
    })).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
    const current = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    const dependent = await createTestCoordinatorTask(harness.ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      subject: 'Dependent review',
      description: 'Runs after the first review.',
      blockedBy: [seeded.task.id],
      writeScopes: [],
      ...taskDefaults,
    })
    await expect(updateTestCoordinatorTask(harness.ctx, {
      teamId: current.team.id,
      taskId: seeded.task.id,
      expectedRevision: seeded.task.revision,
      blockedBy: [dependent.id],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_GRAPH_INVALID' })
    await harness.dispose()
  })
  it('uses durable task revisions and cursor watches without a lost wakeup', async () => {
    const harness = await setup('sqlite')
    const seeded = await populated(harness.ctx)
    const watch = harness.ctx.teams.watchTeam({ teamId: seeded.team.team.id, afterCursor: seeded.team.team.cursor })
    const updates = await Promise.allSettled([
      updateTestCoordinatorTask(harness.ctx, {
        teamId: seeded.team.team.id,
        taskId: seeded.task.id,
        expectedRevision: seeded.task.revision,
        subject: 'Review carefully',
        description: 'Inspect the patch in detail.',
      }),
      updateTestCoordinatorTask(harness.ctx, {
        teamId: seeded.team.team.id,
        taskId: seeded.task.id,
        expectedRevision: seeded.task.revision,
        subject: 'Conflicting update',
        description: 'This should lose the compare-and-set race.',
      }),
    ])
    expect(updates.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(updates.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(watch).resolves.toMatchObject({ kind: 'changed' })
    await harness.dispose()
  })
  it('returns an ordered opening-record suffix and wakes a channel watch after close', async () => {
    const harness = await setup('sqlite')
    const seeded = await populated(harness.ctx)
    const channel = await openActiveTestChannel(harness.ctx, {
      teamId: seeded.team.team.id,
      expectedCursor: seeded.team.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: seeded.participant.id, role: 'reviewer' }],
      limits: {},
    }, [seeded.participant.id])
    const opening = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    expect(opening).toMatchObject({ records: [
      { type: 'channel/opened' },
      { type: 'channel/phase', phase: 'pending' },
      { type: 'channel/invitation' },
      { type: 'channel/acknowledged', invitation: { status: 'acknowledged' } },
      { type: 'channel/phase', phase: 'active' },
    ] })
    const watch = harness.ctx.teams.watchChannel({ channelId: channel.manifest.id, afterCursor: channel.cursor })
    await closeTestChannel(harness.ctx, { channelId: channel.manifest.id, expectedCursor: channel.cursor })
    await expect(watch).resolves.toEqual({ kind: 'closed' })
    await harness.dispose()
  })
  it('forwards watch AbortSignals without retaining cancelled Team or channel waiters', async () => {
    const harness = await setup('sqlite')
    const seeded = await populated(harness.ctx)
    const preTeamAbort = new AbortController()
    const preTeamError = new Error('team watch cancelled before registration')
    preTeamAbort.abort(preTeamError)
    await expect(harness.ctx.teams.watchTeam({
      teamId: seeded.team.team.id,
      afterCursor: seeded.team.team.cursor,
      signal: preTeamAbort.signal,
    })).rejects.toBe(preTeamError)
    expect(waiterCount(harness.ctx, 'team', seeded.team.team.id)).toBe(0)
    const postTeamAbort = new AbortController()
    const postTeamError = new Error('team watch cancelled after registration')
    const cancelledTeamWatch = harness.ctx.teams.watchTeam({
      teamId: seeded.team.team.id,
      afterCursor: seeded.team.team.cursor,
      signal: postTeamAbort.signal,
    })
    const survivingTeamWatch = harness.ctx.teams.watchTeam({
      teamId: seeded.team.team.id,
      afterCursor: seeded.team.team.cursor,
    })
    await vi.waitFor(() => { expect(waiterCount(harness.ctx, 'team', seeded.team.team.id)).toBe(2) })
    postTeamAbort.abort(postTeamError)
    await expect(cancelledTeamWatch).rejects.toBe(postTeamError)
    expect(waiterCount(harness.ctx, 'team', seeded.team.team.id)).toBe(1)
    const team = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    await inviteBootstrapParticipant(harness.ctx, {
      teamId: team.team.id,
      expectedCursor: team.team.cursor,
      kind: 'service',
      displayName: 'Watch survivor',
      role: 'observer',
      capabilities: [],
    })
    await expect(survivingTeamWatch).resolves.toMatchObject({ kind: 'changed' })
    expect(waiterCount(harness.ctx, 'team', seeded.team.team.id)).toBe(0)
    const current = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    const channel = await openTestChannel(harness.ctx, {
      teamId: current.team.id,
      expectedCursor: current.team.cursor,
      adapter: { type: 'direct', version: 1 },
      participants: [{ id: seeded.participant.id, role: 'reviewer' }],
      limits: {},
    })
    const preChannelAbort = new AbortController()
    const preChannelError = new Error('channel watch cancelled before registration')
    preChannelAbort.abort(preChannelError)
    await expect(harness.ctx.teams.watchChannel({
      channelId: channel.manifest.id,
      afterCursor: channel.cursor,
      signal: preChannelAbort.signal,
    })).rejects.toBe(preChannelError)
    expect(waiterCount(harness.ctx, 'channel', channel.manifest.id)).toBe(0)
    const postChannelAbort = new AbortController()
    const postChannelError = new Error('channel watch cancelled after registration')
    const cancelledChannelWatch = harness.ctx.teams.watchChannel({
      channelId: channel.manifest.id,
      afterCursor: channel.cursor,
      signal: postChannelAbort.signal,
    })
    const survivingChannelWatch = harness.ctx.teams.watchChannel({
      channelId: channel.manifest.id,
      afterCursor: channel.cursor,
    })
    await vi.waitFor(() => { expect(waiterCount(harness.ctx, 'channel', channel.manifest.id)).toBe(2) })
    postChannelAbort.abort(postChannelError)
    await expect(cancelledChannelWatch).rejects.toBe(postChannelError)
    expect(waiterCount(harness.ctx, 'channel', channel.manifest.id)).toBe(1)
    const closed = await closeTestChannel(harness.ctx, {
      channelId: channel.manifest.id,
      expectedCursor: channel.cursor,
    })
    await expect(survivingChannelWatch).resolves.toEqual({ kind: 'closed' })
    const closeAbort = new AbortController()
    const closeError = new Error('channel close watch cancelled')
    const closingWatch = harness.ctx.teams.watchChannel({
      channelId: channel.manifest.id,
      afterCursor: closed.cursor,
    })
    const cancelledCloseWatch = harness.ctx.teams.watchChannel({
      channelId: channel.manifest.id,
      afterCursor: closed.cursor,
      signal: closeAbort.signal,
    })
    await expect(closingWatch).resolves.toEqual({ kind: 'closed' })
    closeAbort.abort(closeError)
    await expect(cancelledCloseWatch).resolves.toEqual({ kind: 'closed' })
    await harness.dispose()
  })
  it('durably reserves, activates, releases, and recovers one exact task workspace allocation', async () => {
    let harness = await setup('json')
    const seeded = await populated(harness.ctx)
    const activationId = await taskActivation(harness.ctx, seeded.team.team.id, seeded.participant.id)
    const assigned = await assignTestTask(harness.ctx, {
      teamId: seeded.team.team.id,
      taskId: seeded.task.id,
      expectedRevision: seeded.task.revision,
      participantId: seeded.participant.id,
      activationId,
      leaseDurationMs: 10_000,
    })
    const lease = assigned.lease
    if (lease === undefined) throw new Error('workspace allocation fixture requires an assigned lease')
    let owner = await postActor(harness.ctx, seeded.team.team.id, seeded.participant.id)
    const running = await harness.ctx.teams.startTaskAttempt({
      actor: owner,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })
    let state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    const reserve = {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      taskId: running.id,
      expectedTaskRevision: running.revision,
      attemptId: lease.attemptId,
      allocation: {
        id: teamWorkspaceAllocationIdSchema.parse('workspace-allocation-a'),
        provider: 'test-worktree',
        mode: 'shared' as const,
        assignedRevision: lease.assignedRevision,
        participantId: seeded.participant.id,
        activationId,
        sessionId: SessionId('task-recovery-session'),
        baseVersion: 'base-a',
      },
    }
    const reserved = await reserveTestWorkspaceAllocation(harness.ctx, reserve)
    expect(reserved).toMatchObject({ lifecycle: 'reserved', revision: 1 })
    expect(reserved.reservedAt).toBeTypeOf('number')
    state = await harness.ctx.teams.getTeam({ teamId: state.team.id })
    expect(state.workspaceAllocations).toEqual([expect.objectContaining({ id: reserved.id, lifecycle: 'reserved' })])
    expect((await harness.ctx.teams.inspectQuiescence(state.team.id)).activeWorkspaceAllocationIds).toEqual([reserved.id])
    await expect(harness.ctx.teams.activateWorkspaceAllocation({
      actor: {} as never,
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      allocationId: reserved.id,
      expectedRevision: reserved.revision,
    })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const activated = await activateTestWorkspaceAllocation(harness.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      allocationId: reserved.id,
      expectedRevision: reserved.revision,
    })
    expect(activated).toMatchObject({ lifecycle: 'active', revision: 2 })
    expect(activated.activatedAt).toBeTypeOf('number')
    const durableRoot = harness.root
    await harness.dispose()
    harness = await setup('json', durableRoot)
    state = await harness.ctx.teams.getTeam({ teamId: seeded.team.team.id })
    expect(state.workspaceAllocations).toEqual([expect.objectContaining({ id: activated.id, lifecycle: 'active', baseVersion: 'base-a' })])
    owner = await postActor(harness.ctx, seeded.team.team.id, seeded.participant.id)
    const settled = await harness.ctx.teams.settleTaskAttempt({
      actor: owner,
      taskId: running.id,
      expectedRevision: running.revision,
      attemptId: lease.attemptId,
      outcome: { kind: 'released' },
    })
    await expect(assignTestTask(harness.ctx, {
      teamId: settled.teamId,
      taskId: settled.id,
      expectedRevision: settled.revision,
      participantId: seeded.participant.id,
      activationId,
      leaseDurationMs: 10_000,
    })).rejects.toMatchObject({ code: 'TEAM_NOT_QUIESCENT' })
    state = await harness.ctx.teams.getTeam({ teamId: settled.teamId })
    const releaseRequested = await requestTestWorkspaceAllocationRelease(harness.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      allocationId: activated.id,
      expectedRevision: activated.revision,
    })
    expect(releaseRequested).toMatchObject({ lifecycle: 'release-requested', revision: 3 })
    state = await harness.ctx.teams.getTeam({ teamId: state.team.id })
    const preserved = await preserveTestWorkspaceAllocation(harness.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      allocationId: releaseRequested.id,
      expectedRevision: releaseRequested.revision,
      reason: { code: 'CLEANUP_FAILED', message: 'The provider retained the worktree.' },
    })
    expect(preserved).toMatchObject({ lifecycle: 'preserved', revision: 4, preservationReason: { code: 'CLEANUP_FAILED' } })
    state = await harness.ctx.teams.getTeam({ teamId: state.team.id })
    await expect(confirmTestWorkspaceAllocationRelease(harness.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      allocationId: releaseRequested.id,
      expectedRevision: releaseRequested.revision,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const retryRelease = await requestTestWorkspaceAllocationRelease(harness.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      allocationId: preserved.id,
      expectedRevision: preserved.revision,
    })
    state = await harness.ctx.teams.getTeam({ teamId: state.team.id })
    const released = await confirmTestWorkspaceAllocationRelease(harness.ctx, {
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
      allocationId: retryRelease.id,
      expectedRevision: retryRelease.revision,
    })
    expect(released).toMatchObject({ lifecycle: 'released', revision: 6 })
    expect(released.releasedAt).toBeTypeOf('number')
    const reassigned = await assignTestTask(harness.ctx, {
      teamId: settled.teamId,
      taskId: settled.id,
      expectedRevision: settled.revision,
      participantId: seeded.participant.id,
      activationId,
      leaseDurationMs: 10_000,
    })
    expect(reassigned.lease?.ordinal).toBe(2)
    await harness.dispose()
  })
  it('records an explicit integration task result against its source attempt and target fence', async () => {
    const harness = await setup('json')
    const seeded = await populated(harness.ctx)
    const activationId = await taskActivation(harness.ctx, seeded.team.team.id, seeded.participant.id)
    let owner = await postActor(harness.ctx, seeded.team.team.id, seeded.participant.id)
    const assigned = await assignTestTask(harness.ctx, {
      teamId: seeded.team.team.id,
      taskId: seeded.task.id,
      expectedRevision: seeded.task.revision,
      participantId: seeded.participant.id,
      activationId,
      leaseDurationMs: 10_000,
    })
    if (assigned.lease === undefined) throw new Error('integration source fixture requires an assigned lease')
    const running = await harness.ctx.teams.startTaskAttempt({
      actor: owner,
      taskId: assigned.id,
      expectedRevision: assigned.revision,
      attemptId: assigned.lease.attemptId,
    })
    const source = await harness.ctx.teams.settleTaskAttempt({
      actor: owner,
      taskId: running.id,
      expectedRevision: running.revision,
      attemptId: assigned.lease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'Source change is ready.' } },
    })
    const sourceAttempt = source.attemptHistory.at(-1)
    if (sourceAttempt === undefined || sourceAttempt.outcome.kind !== 'completed') {
      throw new Error('integration source fixture did not retain a completed result')
    }
    let state = await harness.ctx.teams.getTeam({ teamId: source.teamId })
    const integration = await createTestCoordinatorTask(harness.ctx, {
      teamId: source.teamId,
      expectedCursor: state.team.cursor,
      subject: 'Integrate the source change',
      description: 'Apply the source attempt to the selected target and report the durable integration result.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'worktree',
      budget: {},
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
      integration: {
        sourceTaskId: source.id,
        sourceAttemptId: sourceAttempt.id,
        provider: 'worktree',
        target: 'main',
        expectedTarget: 'base-commit',
        mode: 'integrate',
      },
    })
    expect(integration.integration).toMatchObject({
      sourceTaskId: source.id,
      sourceAttemptId: sourceAttempt.id,
      target: 'main',
      expectedTarget: 'base-commit',
    })
    const assignedIntegration = await assignTestTask(harness.ctx, {
      teamId: source.teamId,
      taskId: integration.id,
      expectedRevision: integration.revision,
      participantId: seeded.participant.id,
      activationId,
      leaseDurationMs: 10_000,
    })
    if (assignedIntegration.lease === undefined) throw new Error('integration task fixture requires an assigned lease')
    owner = await postActor(harness.ctx, source.teamId, seeded.participant.id)
    const runningIntegration = await harness.ctx.teams.startTaskAttempt({
      actor: owner,
      taskId: assignedIntegration.id,
      expectedRevision: assignedIntegration.revision,
      attemptId: assignedIntegration.lease.attemptId,
    })
    const completed = await harness.ctx.teams.settleTaskAttempt({
      actor: owner,
      taskId: runningIntegration.id,
      expectedRevision: runningIntegration.revision,
      attemptId: assignedIntegration.lease.attemptId,
      outcome: {
        kind: 'completed',
        result: {
          summary: 'Target updated.',
          verification: 'integration tests passed',
          integration: {
            target: 'main',
            expectedTarget: 'base-commit',
            status: 'integrated',
            targetVersion: 'merged-commit',
            verification: 'integration tests passed',
            artifacts: [],
          },
        },
      },
    })
    expect(completed).toMatchObject({
      phase: 'completed',
      attemptHistory: [{ outcome: { kind: 'completed', result: { integration: { status: 'integrated', targetVersion: 'merged-commit' } } } }],
    })
    state = await harness.ctx.teams.getTeam({ teamId: source.teamId })
    const invalid = await createTestCoordinatorTask(harness.ctx, {
      teamId: source.teamId,
      expectedCursor: state.team.cursor,
      subject: 'Validate integration result fences',
      description: 'This task exercises rejection of a mismatched integration result.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'worktree',
      budget: {},
      reviewPolicy: { kind: 'none' },
      maxAttempts: 1,
      integration: {
        sourceTaskId: source.id,
        sourceAttemptId: sourceAttempt.id,
        provider: 'worktree',
        target: 'main',
        expectedTarget: 'base-commit',
        mode: 'integrate',
      },
    })
    const assignedInvalid = await assignTestTask(harness.ctx, {
      teamId: source.teamId,
      taskId: invalid.id,
      expectedRevision: invalid.revision,
      participantId: seeded.participant.id,
      activationId,
      leaseDurationMs: 10_000,
    })
    if (assignedInvalid.lease === undefined) throw new Error('invalid integration fixture requires an assigned lease')
    owner = await postActor(harness.ctx, source.teamId, seeded.participant.id)
    const runningInvalid = await harness.ctx.teams.startTaskAttempt({
      actor: owner,
      taskId: assignedInvalid.id,
      expectedRevision: assignedInvalid.revision,
      attemptId: assignedInvalid.lease.attemptId,
    })
    const beforeInvalid = await harness.ctx.teams.getTeam({ teamId: source.teamId })
    await expect(harness.ctx.teams.settleTaskAttempt({
      actor: owner,
      taskId: runningInvalid.id,
      expectedRevision: runningInvalid.revision,
      attemptId: assignedInvalid.lease.attemptId,
      outcome: {
        kind: 'completed',
        result: {
          summary: 'Wrong target.',
          integration: {
            target: 'release',
            expectedTarget: 'base-commit',
            status: 'integrated',
            targetVersion: 'wrong-commit',
          },
        },
      },
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(harness.ctx.teams.getTeam({ teamId: source.teamId })).resolves.toMatchObject({
      team: { cursor: beforeInvalid.team.cursor },
    })
    await expect(harness.ctx.teams.getTask({ teamId: source.teamId, taskId: invalid.id })).resolves.toMatchObject({ phase: 'running' })
    owner = await postActor(harness.ctx, source.teamId, seeded.participant.id)
    await expect(harness.ctx.teams.settleTaskAttempt({
      actor: owner,
      taskId: runningInvalid.id,
      expectedRevision: runningInvalid.revision,
      attemptId: assignedInvalid.lease.attemptId,
      outcome: {
        kind: 'completed',
        result: {
          summary: 'Conflict retained for review.',
          integration: {
            target: 'main',
            expectedTarget: 'base-commit',
            status: 'conflict',
            conflictPaths: ['README.md'],
          },
        },
      },
    })).resolves.toMatchObject({ phase: 'completed' })
    const root = harness.root
    await harness.dispose()
    const restarted = await setup('json', root)
    await expect(restarted.ctx.teams.getTask({ teamId: source.teamId, taskId: integration.id }))
      .resolves.toMatchObject({
        integration: {
          sourceTaskId: source.id,
          sourceAttemptId: sourceAttempt.id,
          target: 'main',
          expectedTarget: 'base-commit',
        },
        attemptHistory: [{ outcome: { kind: 'completed', result: { integration: { targetVersion: 'merged-commit' } } } }],
      })
    await restarted.dispose()
  })
})
