import { channelInvitationIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamSystemChannelAdmissionProof } from '@clocky/clocky-team'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import { consentChannelEndpoints } from '../../../core/team/tests/channel-endpoint-consent.ts'
import { recordEnvelope } from '../../../core/team/tests/channel-envelope-record.ts'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@clocky/cordis'
import type { SessionEvent } from '@clocky/clocky-session'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { TeamError, activationIdSchema, teamTaskCreateIdempotencyKeySchema, teamWorkspaceAllocationIdSchema, teamWorkspaceExecutionWorldSchema } from '@clocky/clocky-team'
import type { TeamTaskWorkspaceMode, TeamWorkspaceLoss } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ParticipantSnapshot,
  TeamActorProof,
  TeamEnvelope,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemInterruptProof,
  TeamSystemInterruptScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamSystemWorkspaceAllocationProof,
  TeamSystemWorkspaceAllocationProofSource,
  TeamSystemWorkspaceAllocationScope,
  TeamTaskAssignInput,
} from '@clocky/clocky-team'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import {
  AgentWorkspaceUnavailableError,
  openAgentWorkspaceLease,
  resolveAgentWorkspaceRoot,
  settleAgentWorkspaceLease,
} from '@clocky/clocky-agent'
import { createUserMessage, freezeMessage, LlmAdapter, MessageId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk, UserMessage } from '@clocky/clocky-llm'
import { SessionId } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as TeamChannelDirect from '@clocky/clocky-team-channel-direct'
import * as TeamChannelBasic from '@clocky/clocky-team-channel-basic'
import * as TeamChannelTaskAssignment from '@clocky/clocky-team-channel-task-assignment'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import { TeamDagScheduler } from '@clocky/clocky-team-scheduler-dag'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type {
  TeamWorkspaceAllocation,
  TeamWorkspaceAllocationMetadata,
  TeamWorkspacePreparation,
  TeamWorkspaceProvider,
} from '@clocky/clocky-team-workspace'
import * as TeamAgentClientPlugin from '../src/index.ts'

const contexts = new Set<Context>()
const hubFibers = new WeakMap<Context, Fiber>()
const workspaceFibers = new WeakMap<Context, Fiber>()
const roots: string[] = []
const TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_RUN_INTERRUPT_PROOF_SOURCE = 'team-run'
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
type ControllerActivationScope = Extract<TeamSystemActivationScope, {
  readonly kind: 'activation-controller-bind' | 'activation-controller-status'
}>
type SchedulerTaskAssignScope = Extract<TeamSystemTaskLeaseScope, { readonly kind: 'scheduler-task-assign' }>
const schedulerPostAuthorities = new WeakMap<Context, {
  issue(scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof
}>()
const teamRunInterruptProofStores = new WeakMap<Context, WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>>()
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationScope>>()

/** Retain one exact workspace source scope only for a direct Hub setup operation. */
async function withWorkspaceAllocationProof<T>(
  ctx: Context,
  scope: TeamSystemWorkspaceAllocationScope,
  operation: (actor: TeamSystemWorkspaceAllocationProof) => Promise<T>,
): Promise<T> {
  const proofs = new Map<TeamSystemWorkspaceAllocationProof, TeamSystemWorkspaceAllocationScope>()
  const source: TeamSystemWorkspaceAllocationProofSource = {
    name: 'team-agent-client-workspace-test',
    resolveWorkspaceAllocationProof: proof => proofs.get(proof),
  }
  const unregister = ctx.teams.registerSystemWorkspaceAllocationProofSource(source)
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test workspace allocation proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemWorkspaceAllocationProof
  proofs.set(actor, Object.freeze(structuredClone(scope)))
  try {
    return await operation(actor)
  } finally {
    proofs.delete(actor)
    unregister()
  }
}

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of [...contexts]) {
    try {
      await ctx.fiber.dispose()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  contexts.clear()
  for (const root of roots.splice(0)) {
    try {
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Team Agent Client test cleanup failed')
})

/** Complete one short model turn when a direct turn or steer delivery wakes an Agent. */
class ReplyAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ack' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ack' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Report every optional usage dimension through a real final assistant message. */
class MeteredReplyAdapter extends ReplyAdapter {
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    for await (const chunk of super.stream(options)) {
      if (chunk.type === 'usage') {
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3 } }
      } else {
        yield chunk
      }
    }
  }
}

/** Wait for the target Agent's cancellation signal before ending its model request. */
class InterruptibleAdapter extends LlmAdapter {
  readonly started = Promise.withResolvers<undefined>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal
    if (signal === undefined) throw new Error('Team Agent Client interrupt test requires a turn signal')
    this.started.resolve(undefined)
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'interrupted by Team command' } } }
  }
}

/** Compose one Team Hub, Agent factory, session persistence, and direct client. */
async function setup(
  loadClient = true,
  adapter: LlmAdapter = new ReplyAdapter(),
  config: TeamAgentClientPlugin.Config = {},
  providerOverride?: TeamWorkspaceProvider | null,
): Promise<Context> {
  const root = await freshRoot()
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  hubFibers.set(ctx, await ctx.plugin(TeamHub))
  await ctx.plugin(TeamChannelAdmission)
  await ctx.plugin(TeamChannelDirect)
  await ctx.plugin(TeamChannelBasic)
  await ctx.plugin(TeamChannelTaskAssignment)
  workspaceFibers.set(ctx, await ctx.plugin(TeamWorkspaceRegistry))
  const workspaceProvider = providerOverride === null ? undefined : providerOverride ?? {
    name: 'agent-client-test-shared',
    modes: ['shared'],
    async eligible() { return true },
    async prepare() { throw new Error('Agent Client scheduler integration must not prepare a workspace') },
    async restore() { throw new Error('Agent Client scheduler integration must not restore a workspace') },
    async reconcileRelease() { throw new Error('Agent Client scheduler integration must not reconcile a workspace') },
  }
  if (workspaceProvider !== undefined) ctx.teamWorkspaces.registerProvider(workspaceProvider)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(TeamLinkLocal, {
    providerName: 'local', pageSize: 128, disposalTimeoutMs: 1_000, notificationRetryDelayMs: 1,
  })
  if (loadClient) await ctx.plugin(TeamAgentClientPlugin, config)
  return ctx
}

/** Create one workspace-local persistence root. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-agent-client-'))
  roots.push(root)
  return root
}

/** Build one root-less provider whose calls make reservation/materialization order observable. */
function workspaceProvider(calls: string[], release: () => Promise<void>, withBaseVersion = true): TeamWorkspaceProvider {
  return {
    name: 'agent-client-workspace',
    modes: ['shared'],
    async eligible() { return true },
    async prepare(request) {
      calls.push('prepare')
      const metadata: TeamWorkspaceAllocationMetadata = {
        id: teamWorkspaceAllocationIdSchema.parse(`agent-client-allocation:${String(request.attemptId)}`),
        provider: 'agent-client-workspace',
        mode: 'shared',
        teamId: request.teamId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        assignedRevision: request.assignedRevision,
        participantId: request.participantId,
        activationId: request.activationId,
        sessionId: request.sessionId,
        ...withBaseVersion ? { baseVersion: 'client-test-base' } : {},
      }
      let abandoned = false
      const preparation: TeamWorkspacePreparation = {
        ...metadata,
        async materialize() {
          if (abandoned) throw new Error('workspace preparation was abandoned')
          calls.push('materialize')
          const allocation: TeamWorkspaceAllocation = {
            ...metadata,
            root: '/workspace/agent-client',
            release,
          }
          return allocation
        },
        async abandon() {
          calls.push('abandon')
          abandoned = true
        },
      }
      return preparation
    },
    async restore(request, metadata) {
      calls.push('restore')
      return {
        ...metadata,
        teamId: request.teamId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        assignedRevision: request.assignedRevision,
        participantId: request.participantId,
        activationId: request.activationId,
        sessionId: request.sessionId,
        root: '/workspace/agent-client',
        release,
      }
    },
    async reconcileRelease() { calls.push('reconcile-release') },
  }
}

/** Build a provider whose post-reservation materialization and reservation cleanup both fail. */
function failingMaterializationProvider(calls: string[]): TeamWorkspaceProvider {
  return {
    name: 'agent-client-failing-workspace',
    modes: ['shared'],
    async eligible() { return true },
    async prepare(request) {
      calls.push('prepare')
      const metadata: TeamWorkspaceAllocationMetadata = {
        id: teamWorkspaceAllocationIdSchema.parse(`agent-client-failing-allocation:${String(request.attemptId)}`),
        provider: 'agent-client-failing-workspace',
        mode: 'shared',
        teamId: request.teamId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        assignedRevision: request.assignedRevision,
        participantId: request.participantId,
        activationId: request.activationId,
        sessionId: request.sessionId,
      }
      return {
        ...metadata,
        async materialize() {
          calls.push('materialize')
          throw new Error('materialization failed')
        },
        async abandon() {
          calls.push('abandon')
          throw new Error('reservation cleanup failed')
        },
      }
    },
    async restore() { throw new Error('not used') },
    async reconcileRelease() {},
  }
}

/** Invite one participant and move it through the durable active lifecycle. */
async function activeParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  name: string,
  kind: ParticipantSnapshot['kind'] = 'local-agent',
  role = 'worker',
) {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind,
    displayName: name,
    role,
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

/** Persist one test-owned activation binding through a single-call controller proof. */
async function bindActivation(
  ctx: Context,
  input: { readonly expectedCursor: number; readonly binding: ActivationBindingSnapshot },
): Promise<ActivationBindingSnapshot> {
  let proofs = activationProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemActivationProof, ControllerActivationScope>()
    proofs = sourceProofs
    activationProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemActivationProofSource({
      name: TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE,
      resolveActivationProof: proof => sourceProofs.get(proof),
    })
  }
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test activation controller proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemActivationProof
  proofs.set(actor, { kind: 'activation-controller-bind', ...input })
  try {
    return await ctx.teams.bindActivation({ actor, ...input })
  } finally {
    proofs.delete(actor)
  }
}

/** Mark a temporary task-creation coordinator offline before scheduler selection. */
async function offlineActivation(ctx: Context, binding: ActivationBindingSnapshot): Promise<void> {
  const proofs = activationProofStores.get(ctx)
  if (proofs === undefined) throw new Error('task-creation fixture did not register the activation proof source')
  const state = await ctx.teams.getTeam({ teamId: binding.activation.teamId })
  const input = {
    teamId: binding.activation.teamId,
    activationId: binding.activation.id,
    expectedCursor: state.team.cursor,
    status: 'offline' as const,
  }
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test activation controller proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemActivationProof
  proofs.set(actor, {
    kind: 'activation-controller-status',
    participantId: binding.activation.participantId,
    sessionId: binding.sessionId,
    provider: binding.provider,
    ...input,
  })
  try {
    await ctx.teams.updateActivationStatus({ actor, ...input })
  } finally {
    proofs.delete(actor)
  }
}

/** Assign one test fixture lease through a one-shot canonical scheduler proof. */
async function assignSchedulerLease(ctx: Context, input: TeamTaskAssignInput) {
  const proofs = new WeakMap<TeamSystemTaskLeaseProof, SchedulerTaskAssignScope>()
  const unregister = ctx.teams.registerSystemTaskLeaseProofSource({
    name: TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE,
    resolveTaskLeaseProof: proof => proofs.get(proof),
  })
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test scheduler task-lease proofs are runtime-only') },
  })
  const actor = Object.freeze(proof) as TeamSystemTaskLeaseProof
  proofs.set(actor, { kind: 'scheduler-task-assign', ...input })
  try {
    return await ctx.teams.assignTask({ actor, ...input })
  } finally {
    proofs.delete(actor)
    unregister()
  }
}

/** Build an active two-member direct channel for one selected direct protocol version. */
async function directChannel(ctx: Context, adapter = TeamChannelDirect.DIRECT_CHANNEL_ADAPTER_V1, recipientRole = 'worker') {
  const created = await createTestRootTeam(ctx, { goal: { objective: 'Deliver one direct Envelope', budgets: {} }, rules: {}, budgets: {} })
  const sender = await activeParticipant(ctx, created.team.id, 'Sender')
  const recipient = await activeParticipant(ctx, created.team.id, 'Recipient', 'local-agent', recipientRole)
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter,
    participants: [{ id: sender.id, role: 'sender' }, { id: recipient.id, role: 'recipient' }],
    limits: {},
  })
  return { team: created.team, sender, recipient, channel }
}

/** Persist the exact local Session authorization required before direct delivery. */
async function bindRecipient(
  ctx: Context,
  input: Awaited<ReturnType<typeof directChannel>>,
  sessionId: SessionId,
  activationId = 'activation-direct-recipient',
) {
  const state = await ctx.teams.getTeam({ teamId: input.team.id })
  return await bindActivation(ctx, {
    expectedCursor: state.team.cursor,
    binding: {
      activation: {
        id: activationIdSchema.parse(activationId),
        teamId: input.team.id,
        participantId: input.recipient.id,
        status: 'idle',
      },
      sessionId,
      provider: 'in-process',
    },
  })
}

/** Issue an opaque proof for one active direct-channel participant. */
async function activeActor(
  ctx: Context,
  teamId: Awaited<ReturnType<typeof directChannel>>['team']['id'],
  participant: ParticipantSnapshot,
): Promise<TeamActorProof> {
  const current = await ctx.teams.getTeam({ teamId })
  const binding = current.activations.find(candidate => candidate.activation.participantId === participant.id
    && (candidate.activation.status === 'idle' || candidate.activation.status === 'running'))
    ?? await bindActivation(ctx, {
      expectedCursor: current.team.cursor,
      binding: {
        activation: {
          id: activationIdSchema.parse(`activation-agent-client-${participant.id}`),
          teamId,
          participantId: participant.id,
          status: 'idle',
        },
        sessionId: SessionId(`session-agent-client-${participant.id}`),
        provider: 'agent-client-test',
      },
    })
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Provision one active coordinator and issue its exact activation proof for task creation. */
async function coordinatorTaskActor(
  ctx: Context,
  teamId: Awaited<ReturnType<typeof directChannel>>['team']['id'],
): Promise<TeamActorProof> {
  const state = await ctx.teams.getTeam({ teamId })
  const coordinator = state.participants.find(candidate => (
    candidate.phase === 'active'
    && candidate.role === 'coordinator'
    && (candidate.kind === 'local-agent' || candidate.kind === 'remote-agent')
  )) ?? await activeParticipant(ctx, teamId, 'Task coordinator', 'local-agent', 'coordinator')
  return await activeActor(ctx, teamId, coordinator)
}

/** Issue one test-only TeamRun interrupt proof for the exact durable human/coordinator topology. */
function teamRunInterruptActor(
  ctx: Context,
  scope: TeamSystemInterruptScope,
): { readonly proof: TeamSystemInterruptProof; revoke(): void } {
  let proofs = teamRunInterruptProofStores.get(ctx)
  if (proofs === undefined) {
    const sourceProofs = new WeakMap<TeamSystemInterruptProof, TeamSystemInterruptScope>()
    proofs = sourceProofs
    teamRunInterruptProofStores.set(ctx, sourceProofs)
    ctx.teams.registerSystemInterruptProofSource({
      name: TEAM_RUN_INTERRUPT_PROOF_SOURCE,
      resolveInterruptProof: proof => sourceProofs.get(proof),
    })
  }
  if (proofs === undefined) throw new Error('TeamRun interrupt proof store was not initialized')
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('TeamRun interrupt proofs are runtime-only') },
  })
  const opaque = Object.freeze(proof) as TeamSystemInterruptProof
  proofs.set(opaque, scope)
  return Object.freeze({ proof: opaque, revoke: () => proofs.delete(opaque) })
}

/** Commit one source-authorized human-to-coordinator soft interrupt for a current fixture target. */
async function requestTeamRunInterrupt(
  ctx: Context,
  input: Awaited<ReturnType<typeof directChannel>>,
  target: ParticipantSnapshot,
) {
  const human = await activeParticipant(ctx, input.team.id, 'Interrupt human', 'human', 'human')
  let state = await ctx.teams.getTeam({ teamId: input.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: state.team.id,
    expectedCursor: state.team.cursor,
    adapter: TeamChannelDirect.DIRECT_CHANNEL_ADAPTER_V4,
    participants: [{ id: human.id, role: 'human' }, { id: target.id, role: 'coordinator' }],
    limits: {},
  })
  TeamChannelDirect.directChannelV4Adapter.validateCreate(channel.manifest)
  const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
  const invitation = admission.invitations.find(value => value.participantId === human.id)!
  const acknowledgement = { channelId: channel.manifest.id, revision: invitation.revision,
    manifestFingerprint: invitation.manifestFingerprint,
    idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`interrupt-human:${String(human.id)}`) }
  const token: object = { toJSON(): never { throw new TypeError('Fixture human endpoint proof is runtime-only') } }
  const humanActor = Object.freeze(token) as TeamSystemChannelAdmissionProof
  const dispose = ctx.teams.registerSystemChannelAdmissionProofSource({ name: 'team-run',
    resolveChannelAdmissionProof: candidate => candidate === humanActor ? {
      kind: 'channel-invitation-acknowledge', teamId: input.team.id, participantId: human.id, ...acknowledgement,
    } : undefined })
  try { await ctx.teams.acknowledgeChannelInvitation({ actor: humanActor, ...acknowledgement }) }
  finally { dispose() }
  await consentChannelEndpoints(ctx, channel, [{ participantId: target.id, actor: await activeActor(ctx, input.team.id, target) }],
    (manifest) => { TeamChannelDirect.directChannelV4Adapter.validateCreate(manifest) })
  state = await ctx.teams.getTeam({ teamId: input.team.id })
  const authority = teamRunInterruptActor(ctx, {
    kind: 'team-run-human-interrupt',
    teamId: input.team.id,
    channelId: channel.manifest.id,
    humanId: human.id,
    coordinatorId: target.id,
  })
  try {
    return await ctx.teams.requestParticipantInterrupt({
      actor: authority.proof,
      teamId: state.team.id,
      expectedCursor: state.team.cursor,
    })
  } finally {
    authority.revoke()
  }
}

/** Read pending soft interrupts through one transient proof for the exact durable target binding. */
async function pendingInterrupts(ctx: Context, binding: ActivationBindingSnapshot) {
  const lease = ctx.teams.openActivationActorProofIssuer().issue(binding)
  try {
    return await ctx.teams.listPendingParticipantInterrupts({ actor: lease.proof })
  } finally {
    lease.revoke()
  }
}

/** Issue a test-only opaque scheduler proof for one exact durable post scope. */
function schedulerPostActor(ctx: Context, scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof {
  let authority = schedulerPostAuthorities.get(ctx)
  if (authority === undefined) {
    const proofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
    ctx.teams.registerSystemEnvelopePostProofSource({
      name: TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE,
      resolveEnvelopePostProof: proof => proofs.get(proof),
    })
    authority = Object.freeze({
      issue(nextScope) {
        const proof: object = {}
        Object.defineProperty(proof, 'toJSON', {
          enumerable: true,
          value: (): never => { throw new TypeError('scheduler post proofs are runtime-only') },
        })
        const opaque = Object.freeze(proof) as TeamSystemEnvelopePostProof
        proofs.set(opaque, nextScope)
        return opaque
      },
    })
    schedulerPostAuthorities.set(ctx, authority)
  }
  return authority.issue(scope)
}

/** A fixture endpoint explicitly accepts the supported direct version using its current binding. */
async function consentDirect(ctx: Context, input: Awaited<ReturnType<typeof directChannel>>): Promise<void> {
  const senderActor = await activeActor(ctx, input.team.id, input.sender)
  const current = await ctx.teams.getTeam({ teamId: input.team.id })
  const recipient = current.activations.find(value => value.activation.participantId === input.recipient.id
    && (value.activation.status === 'idle' || value.activation.status === 'running'))
  const endpoints = [{ participantId: input.sender.id, actor: senderActor }]
  if (recipient !== undefined) endpoints.push({ participantId: input.recipient.id,
    actor: ctx.teams.openActivationActorProofIssuer().issue(recipient).proof })
  await consentChannelEndpoints(ctx, input.channel, endpoints, (manifest) => {
    switch (manifest.adapter.version) {
      case 1: TeamChannelDirect.directChannelAdapter.validateCreate(manifest); break
      case 2: TeamChannelDirect.directChannelV2Adapter.validateCreate(manifest); break
      case 3: TeamChannelDirect.directChannelV3Adapter.validateCreate(manifest); break
      default: throw new Error('Direct fixture endpoint does not support this protocol')
    }
  })
}

/** Post one text Envelope with the current direct channel cursor. */
async function post(
  ctx: Context,
  input: Awaited<ReturnType<typeof directChannel>>,
  delivery: TeamEnvelope['delivery'],
): Promise<TeamEnvelope> {
  await consentDirect(ctx, input)
  const current = await ctx.teams.getChannel({ channelId: input.channel.manifest.id })
  return await ctx.teams.postChannelEnvelope({
    actor: await activeActor(ctx, input.team.id, input.sender),
    expectedCursor: current.cursor,
    draft: {
      channelId: current.manifest.id,
      audience: [input.recipient.id],
      kind: 'message',
      payload: { text: `${delivery} delivery` },
      delivery,
    },
  })
}

/** Post one recipient reply that causally handles an earlier direct Envelope. */
async function postCausalReply(
  ctx: Context,
  input: Awaited<ReturnType<typeof directChannel>>,
  source: TeamEnvelope,
): Promise<TeamEnvelope> {
  const current = await ctx.teams.getChannel({ channelId: input.channel.manifest.id })
  return await ctx.teams.postChannelEnvelope({
    actor: await activeActor(ctx, input.team.id, input.recipient),
    expectedCursor: current.cursor,
    draft: {
      channelId: current.manifest.id,
      audience: [input.sender.id],
      kind: 'message',
      payload: { text: 'already handled' },
      delivery: 'context',
      causationId: source.id,
    },
  })
}

/** Create, bind, lease, and post one durable task-assignment turn for the selected local recipient. */
async function assignTask(
  ctx: Context,
  input: Awaited<ReturnType<typeof directChannel>>,
  binding: Awaited<ReturnType<typeof bindRecipient>>,
  suffix = '',
  workspaceMode: TeamTaskWorkspaceMode = 'shared',
  maxAttempts = 1,
) {
  const actor = await coordinatorTaskActor(ctx, input.team.id)
  let state = await ctx.teams.getTeam({ teamId: input.team.id })
  const task = await ctx.teams.createTask({
    actor,
    teamId: input.team.id,
    expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`agent-client-assignment:${input.team.id}${suffix}`) },
    subject: 'Verify durable task assignment.',
    description: 'Record the assigned task in the bound Session before starting the model turn.',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode,
    budget: {},
    reviewPolicy: { kind: 'none' },
    maxAttempts,
  })
  state = await ctx.teams.getTeam({ teamId: input.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: input.team.id,
    expectedCursor: state.team.cursor,
    adapter: TeamChannelTaskAssignment.TASK_ASSIGNMENT_CHANNEL_ADAPTER,
    participants: [{ id: input.recipient.id, role: TeamChannelTaskAssignment.TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
    limits: {
      taskId: task.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
    },
  })
  await consentChannelEndpoints(ctx, channel, [{ participantId: input.recipient.id,
    actor: ctx.teams.openActivationActorProofIssuer().issue(binding).proof }],
  (manifest) => { TeamChannelTaskAssignment.taskAssignmentChannelAdapter.validateCreate(manifest) })
  const assigned = await assignSchedulerLease(ctx, {
    teamId: input.team.id,
    taskId: task.id,
    expectedRevision: task.revision,
    participantId: input.recipient.id,
    activationId: binding.activation.id,
    wakeChannelId: channel.manifest.id,
    leaseDurationMs: 30_000,
  })
  const lease = assigned.lease
  if (lease === undefined) throw new Error('task assignment did not retain a lease')
  const current = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const envelope = await ctx.teams.postChannelEnvelope({
    actor: schedulerPostActor(ctx, {
      kind: 'scheduler-assignment',
      teamId: input.team.id,
      channelId: channel.manifest.id,
      taskId: task.id,
      attemptId: lease.attemptId,
      assignedRevision: lease.assignedRevision,
      assigneeId: input.recipient.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
    }),
    expectedCursor: current.cursor,
    draft: {
      channelId: current.manifest.id,
      audience: [input.recipient.id],
      kind: TeamChannelTaskAssignment.TASK_ASSIGNMENT_ENVELOPE_KIND,
      payload: {
        taskId: task.id,
        attemptId: lease.attemptId,
        assignedRevision: lease.assignedRevision,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
      },
      delivery: 'turn',
      taskId: task.id,
    },
  })
  return { task, assigned, channel, envelope }
}

/** Retain a running assignment and its reserved allocation for crash-recovery tests. */
async function reserveAssignedWorkspace(
  ctx: Context,
  input: Awaited<ReturnType<typeof directChannel>>,
  binding: ActivationBindingSnapshot,
  suffix = '',
) {
  const assignment = await assignTask(ctx, input, binding, suffix)
  const lease = assignment.assigned.lease
  if (lease === undefined) throw new Error('workspace recovery requires an assignment lease')
  const running = await ctx.teams.startTaskAttempt({
    actor: await activeActor(ctx, input.team.id, input.recipient), taskId: assignment.task.id,
    expectedRevision: assignment.assigned.revision, attemptId: lease.attemptId,
  })
  const request = {
    teamId: input.team.id, taskId: assignment.task.id, attemptId: lease.attemptId, assignedRevision: lease.assignedRevision,
    participantId: input.recipient.id, activationId: binding.activation.id, sessionId: binding.sessionId,
  }
  const preparation = await ctx.teamWorkspaces.prepare('shared', request)
  const reserve = {
    teamId: input.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: input.team.id })).team.cursor,
    taskId: assignment.task.id, expectedTaskRevision: running.revision, attemptId: lease.attemptId,
    allocation: {
      id: preparation.id, provider: preparation.provider, mode: preparation.mode,
      assignedRevision: preparation.assignedRevision, participantId: preparation.participantId,
      activationId: preparation.activationId, sessionId: preparation.sessionId,
      ...preparation.baseVersion === undefined ? {} : { baseVersion: preparation.baseVersion },
    },
  }
  const reserved = await withWorkspaceAllocationProof(ctx, { kind: 'workspace-allocation-reserve', ...reserve },
    async actor => await ctx.teams.reserveWorkspaceAllocation({ actor, ...reserve }))
  return { assignment, reserved, request, preparation }
}

/** Seed restart-visible workspace ownership before mounting its fixed delivery consumer. */
async function workspaceRecoveryFixture(
  release: () => Promise<void> = async () => {},
  withBaseVersion = true,
  disposalTimeoutMs = 1_000,
  workspaceMutationMaxAttempts?: number,
) {
  const calls: string[] = []
  const provider = workspaceProvider(calls, release, withBaseVersion)
  const ctx = await setup(false, new ReplyAdapter(), {}, provider)
  const input = await directChannel(ctx)
  const receiver = await ctx.agents.create({ sessionId: SessionId('workspace-recovery-fixture'),
    meta: { teamId: input.team.id, participantId: input.recipient.id, cwd: '/session/recovery-fixture' },
    agentOptions: { provider: 'mock', model: 'mock' } })
  const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
  const seeded = await reserveAssignedWorkspace(ctx, input, binding)
  const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, { agent: receiver.agent, binding },
    { consumeWorkspace: true, disposalTimeoutMs, ...workspaceMutationMaxAttempts === undefined ? {} : { workspaceMutationMaxAttempts } })
  return { ctx, input, receiver, binding, seeded, delivery, calls }
}

/** Prepare a current local binding before its first task assignment reaches the workspace provider. */
async function liveWorkspaceFixture(consumeWorkspace = true, fixedOwner = false) {
  const calls: string[] = []
  const ctx = await setup(!fixedOwner, new ReplyAdapter(), { consumeWorkspace }, workspaceProvider(calls, async () => { calls.push('release') }))
  const input = await directChannel(ctx)
  const receiver = await ctx.agents.create({ sessionId: SessionId('live-workspace-fixture'),
    meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
  const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
  const delivery = fixedOwner ? new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx,
    { agent: receiver.agent, binding }, { consumeWorkspace, disposalTimeoutMs: 1_000 }) : undefined
  delivery?.start()
  await vi.waitFor(() => { expect(ctx.teamLinks.getBoundLinkBorrower(receiver.agent) === undefined).toBe(false) })
  return { ctx, input, receiver, binding, calls, delivery }
}

/** Mount a directly owned local wrapper around one real Agent and bound Link. */
async function usageFixture() {
  const ctx = await setup(false, new MeteredReplyAdapter())
  const client = new TeamAgentClientPlugin.TeamAgentClient(ctx)
  client.start()
  const input = await directChannel(ctx)
  const receiver = await ctx.agents.create({ sessionId: SessionId('usage-fixture-recipient'),
    meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
  await bindRecipient(ctx, input, receiver.agent.session.id)
  await vi.waitFor(() => { expect(ctx.teamLinks.getBoundLinkBorrower(receiver.agent) === undefined).toBe(false) })
  return { ctx, client, input, receiver }
}

/** Create one ready shared-work task that the mounted scheduler can select. */
async function createPendingTask(ctx: Context, input: Awaited<ReturnType<typeof directChannel>>) {
  const actor = await coordinatorTaskActor(ctx, input.team.id)
  const state = await ctx.teams.getTeam({ teamId: input.team.id })
  const coordinatorBinding = state.activations.find(binding => (
    binding.activation.status === 'idle'
    && state.participants.some(participant => participant.id === binding.activation.participantId && participant.role === 'coordinator')
  ))
  if (coordinatorBinding === undefined) throw new Error('scheduler fixture did not retain a task-creation coordinator activation')
  const task = await ctx.teams.createTask({
    actor,
    teamId: input.team.id,
    expectedCursor: state.team.cursor,
    createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`agent-client-pending:${input.team.id}`) },
    subject: 'Dispatch through the durable scheduler.',
    description: 'The scheduler must create and deliver the task-assignment turn before the Agent starts it.',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    maxAttempts: 1,
  })
  await offlineActivation(ctx, coordinatorBinding)
  return task
}

/** Count every durable inbox or model-history admission for one Envelope. */
function acceptanceCount(events: readonly { readonly type: string; readonly data: unknown }[], envelopeId: string): number {
  return events.filter((event) => {
    if (event.type === 'user/message') {
      const data = event.data as { readonly source?: { readonly kind?: unknown; readonly envelopeId?: unknown } }
      return data.source?.kind === 'team-envelope' && data.source.envelopeId === envelopeId
    }
    if (event.type !== 'agent/inbox/spliced') return false
    const data = event.data as {
      readonly inserted?: readonly {
        readonly source?: { readonly kind?: unknown; readonly envelopeId?: unknown }
      }[]
    }
    return data.inserted?.some(message => message.source?.kind === 'team-envelope' && message.source.envelopeId === envelopeId) === true
  }).length
}

/** Return direct Envelope identities that became model-visible user messages. */
function recordedEnvelopeIds(events: readonly { readonly type: string; readonly data: unknown }[]): string[] {
  const ids: string[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const data = event.data as { readonly source?: { readonly kind?: unknown; readonly envelopeId?: unknown } }
    if (data.source?.kind === 'team-envelope' && typeof data.source.envelopeId === 'string') {
      ids.push(data.source.envelopeId)
    }
  }
  return ids
}

/** Return task-assignment Envelope identities that became durable model-visible user messages. */
function recordedTaskAssignmentEnvelopeIds(events: readonly { readonly type: string; readonly data: unknown }[]): string[] {
  const ids: string[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const data = event.data as { readonly source?: { readonly kind?: unknown; readonly envelopeId?: unknown } }
    if (data.source?.kind === 'team-task-assignment' && typeof data.source.envelopeId === 'string') {
      ids.push(data.source.envelopeId)
    }
  }
  return ids
}

/** Wait until the Hub records exactly one recipient receipt for an Envelope. */
async function expectReceipt(ctx: Context, envelope: TeamEnvelope, participantId: string): Promise<void> {
  await vi.waitFor(async () => {
    const records = await ctx.teams.readChannel({ channelId: envelope.channelId, afterCursor: -1 })
    expect(records.records.filter(record => record.type === 'channel/receipt'
      && record.participantId === participantId
      && record.envelopeId === envelope.id)).toHaveLength(1)
  })
}

/** Run a real task turn while the external workspace provider owns its loss notification. */
async function workspaceLossFixture() {
  const calls: string[] = []
  const release = vi.fn(async () => { calls.push('release') })
  const base = workspaceProvider(calls, release)
  const world = teamWorkspaceExecutionWorldSchema.parse({ kind: 'e2b', id: 'loss-test-sandbox' })
  let listener: ((loss: TeamWorkspaceLoss) => Promise<void>) | undefined
  const provider: TeamWorkspaceProvider = {
    ...base, modes: ['remote'],
    async prepare(request) {
      const preparation = await base.prepare(request)
      return {
        ...preparation, mode: 'remote', executionWorld: world,
        async materialize() {
          const allocation = await preparation.materialize()
          return {
            ...allocation, mode: 'remote', executionWorld: world,
            onLoss(next) { listener = next; return () => { listener = undefined } },
          }
        },
      }
    },
  }
  const adapter = new InterruptibleAdapter()
  const ctx = await setup(true, adapter, { consumeWorkspace: true }, provider)
  const input = await directChannel(ctx)
  const receiver = await ctx.agents.create({ sessionId: SessionId('workspace-loss-fixture'),
    meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
  const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
  const assignment = await assignTask(ctx, input, binding, '-loss', 'remote', 2)
  await adapter.started.promise
  return {
    ctx, input, receiver, binding, assignment, release, world,
    async lose(reason: TeamWorkspaceLoss['reason']) {
      if (listener === undefined) throw new Error('Expected the current allocation loss listener')
      await listener({ executionWorld: world, reason, terminationProven: reason === 'sandbox-expired', artifacts: [] })
    },
  }
}

describe('Team Agent Client', () => {
  it('stops exact model work before releasing an expired world and retries its failed attempt', async () => {
    const test = await workspaceLossFixture()
    const releasedAfterTurn: boolean[] = []
    test.release.mockImplementation(async () => {
      releasedAfterTurn.push(test.receiver.agent.session.events.some(event => event.type === 'turn/end'))
    })
    await test.lose('sandbox-expired')
    const state = await test.ctx.teams.getTeam({ teamId: test.input.team.id })
    expect(releasedAfterTurn).toEqual([true])
    expect(state.workspaceAllocations[0]).toMatchObject({ lifecycle: 'released', loss: { terminationProven: true, reason: 'sandbox-expired' } })
    expect(state.tasks.find(task => task.id === test.assignment.task.id)).toMatchObject({
      phase: 'pending', attemptHistory: [{ outcome: { kind: 'failed', failure: { code: 'WORKSPACE_LOST' } } }],
    })
  })

  it('retains unconfirmed workspace loss as unavailable and stalls before another attempt may execute', async () => {
    const test = await workspaceLossFixture()
    await test.lose('manifest-missing')
    const state = await test.ctx.teams.getTeam({ teamId: test.input.team.id })
    expect(state.team).toMatchObject({ phase: 'stalled', stallReason: { code: 'WORKSPACE_LOSS_UNCONFIRMED' } })
    expect(state.workspaceAllocations[0]).toMatchObject({ lifecycle: 'unavailable', loss: { reason: 'manifest-missing', terminationProven: false } })
    expect(test.release).not.toHaveBeenCalled()
    expect(() => resolveAgentWorkspaceRoot(test.receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
    await test.lose('sandbox-expired')
    expect(test.release).toHaveBeenCalledOnce()
  })

  it('rejects loss from a different execution world before policy or durable mutation', async () => {
    const test = await workspaceLossFixture()
    const state = await test.ctx.teams.getTeam({ teamId: test.input.team.id })
    const allocation = state.workspaceAllocations[0]
    if (allocation === undefined) throw new Error('Expected task allocation')
    const policy = vi.fn(async () => ({ kind: 'allow' as const }))
    test.ctx.teams.registerPolicy('workspace-allocate', { name: 'check-loss-world', apply: policy })
    const input = {
      teamId: state.team.id, expectedCursor: state.team.cursor, allocationId: allocation.id, expectedRevision: allocation.revision,
      loss: { executionWorld: teamWorkspaceExecutionWorldSchema.parse({ kind: 'e2b', id: 'foreign-world' }),
        reason: 'sandbox-expired' as const, terminationProven: true, artifacts: [] },
    }
    await expect(withWorkspaceAllocationProof(test.ctx, { kind: 'workspace-allocation-loss', ...input },
      async actor => await test.ctx.teams.recordWorkspaceAllocationLoss({ actor, ...input }))).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    expect(policy).not.toHaveBeenCalled()
    expect((await test.ctx.teams.getTeam({ teamId: state.team.id })).team.cursor).toBe(state.team.cursor)
    await test.lose('sandbox-expired')
  })

  it('waits for a durable activation binding before replaying context delivery, flushes it, and deduplicates a repeated channel event', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const predecessor = await bindRecipient(ctx, input, SessionId('direct-context-recipient'), 'activation-consent-predecessor')
    await consentDirect(ctx, input)
    await offlineActivation(ctx, predecessor)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-context-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const flush = vi.spyOn(ctx.sessions, 'flush')
    const envelope = await post(ctx, input, 'context')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(0)
    await bindRecipient(ctx, input, receiver.agent.session.id)
    await vi.waitFor(async () => {
      expect(flush).toHaveBeenCalledWith(receiver.agent.session)
      const stored = await ctx.sessionPersistence.inspect(receiver.agent.id)
      expect(acceptanceCount(stored.events, envelope.id)).toBeGreaterThan(0)
    })
    await expectReceipt(ctx, envelope, input.recipient.id)
    expect(receiver.agent.status).toBe('idle')
    const delivered = receiver.agent.inbox.nextStep[0]
    expect(delivered?.id).toBe(`team-envelope:${envelope.id}`)
    if (delivered?.source.kind !== 'team-envelope') throw new Error('direct Envelope did not enter the target inbox')
    expect(delivered.source).toMatchObject({
      teamId: input.team.id,
      channelId: input.channel.manifest.id,
      envelopeId: envelope.id,
      senderId: input.sender.id,
    })

    ctx.emit('channel/changed', {
      channelId: envelope.channelId,
      record: recordEnvelope(envelope),
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(1)
    await expectReceipt(ctx, envelope, input.recipient.id)
  })

  it('delivers direct v2 message Envelopes through the normal source/flush/receipt path but leaves final Envelopes for human receipt', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx, TeamChannelDirect.DIRECT_CHANNEL_ADAPTER_V2)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-v2-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const message = await post(ctx, input, 'context')
    await vi.waitFor(() => {
      expect(acceptanceCount(receiver.agent.session.events, message.id)).toBeGreaterThan(0)
    })
    await expectReceipt(ctx, message, input.recipient.id)

    const current = await ctx.teams.getChannel({ channelId: input.channel.manifest.id })
    const final = await ctx.teams.postChannelEnvelope({
      actor: await activeActor(ctx, input.team.id, input.sender),
      expectedCursor: current.cursor,
      draft: {
        channelId: current.manifest.id,
        audience: [input.recipient.id],
        kind: TeamChannelDirect.DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
        payload: { text: 'Final answers are handled by TeamRun.' },
        delivery: 'turn',
      },
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(acceptanceCount(receiver.agent.session.events, final.id)).toBe(0)
    const records = await ctx.teams.readChannel({ channelId: final.channelId, afterCursor: -1 })
    expect(records.records.some(record => record.type === 'channel/receipt'
      && record.participantId === input.recipient.id
      && record.envelopeId === final.id)).toBe(false)
  })

  it('delivers ordered direct v3 human content with durable provenance and leaves final Envelopes outside an Agent inbox', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx, TeamChannelDirect.DIRECT_CHANNEL_ADAPTER_V3)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-v3-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const content = [
      { type: 'text' as const, text: 'Review this image.' },
      {
        type: 'image' as const,
        attachment: {
          attachmentId: 'attachment-direct-v3',
          mediaType: 'image/png' as const,
          bytes: 12,
          width: 3,
          height: 4,
          name: 'reference.png',
        },
      },
      { type: 'text' as const, text: 'Keep the findings concise.' },
    ]
    await consentDirect(ctx, input)
    const current = await ctx.teams.getChannel({ channelId: input.channel.manifest.id })
    const accepted = await ctx.teams.postChannelEnvelope({
      actor: await activeActor(ctx, input.team.id, input.sender),
      expectedCursor: current.cursor,
      draft: {
        channelId: current.manifest.id,
        audience: [input.recipient.id],
        kind: TeamChannelDirect.DIRECT_CHANNEL_MESSAGE_ENVELOPE_KIND,
        payload: { content },
        delivery: 'turn',
      },
    })
    await vi.waitFor(() => {
      expect(acceptanceCount(receiver.agent.session.events, accepted.id)).toBeGreaterThan(0)
    })
    await receiver.agent.whenIdle()
    await vi.waitFor(async () => {
      const audit = await ctx.teams.readAudit({ teamId: input.team.id, afterCursor: -1, limit: 32 })
      expect(audit.items.find(item => item.type === 'usage/changed')).toMatchObject({
        facts: {
          sample: {
            teamId: input.team.id,
            participantId: input.recipient.id,
            sessionId: receiver.agent.session.id,
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        },
      })
    })
    await expectReceipt(ctx, accepted, input.recipient.id)
    const delivered = receiver.agent.session.events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'team-envelope'
      && event.data.source.envelopeId === accepted.id)?.data as UserMessage | undefined
    if (delivered === undefined || delivered.source.kind !== 'team-envelope') {
      throw new Error('direct v3 Envelope did not enter the target inbox')
    }
    expect(delivered.content).toEqual([
      { type: 'text', text: `Direct message from ${input.sender.id}:\n` },
      ...content,
    ])
    expect(Object.isFrozen(delivered.content)).toBe(true)
    expect(Object.isFrozen(delivered.content[2])).toBe(true)
    expect(delivered.source).toMatchObject({
      teamId: input.team.id,
      channelId: input.channel.manifest.id,
      envelopeId: accepted.id,
      senderId: input.sender.id,
    })

    const acceptedCount = acceptanceCount(receiver.agent.session.events, accepted.id)
    ctx.emit('channel/changed', {
      channelId: accepted.channelId,
      record: recordEnvelope(accepted),
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(acceptanceCount(receiver.agent.session.events, accepted.id)).toBe(acceptedCount)

    const beforeFinal = await ctx.teams.getChannel({ channelId: input.channel.manifest.id })
    const final = await ctx.teams.postChannelEnvelope({
      actor: await activeActor(ctx, input.team.id, input.sender),
      expectedCursor: beforeFinal.cursor,
      draft: {
        channelId: beforeFinal.manifest.id,
        audience: [input.recipient.id],
        kind: TeamChannelDirect.DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
        payload: { text: 'Final answers do not enter participant Agent inboxes.' },
        delivery: 'turn',
      },
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(acceptanceCount(receiver.agent.session.events, final.id)).toBe(0)
    const records = await ctx.teams.readChannel({ channelId: final.channelId, afterCursor: -1 })
    expect(records.records.some(record => record.type === 'channel/receipt'
      && record.participantId === input.recipient.id
      && record.envelopeId === final.id)).toBe(false)
  })

  it.each(['consult', 'discussion'] as const)('delivers a normal closed %s outbox to a real Agent after reconnect', async (protocol) => {
    const ctx = await setup(false)
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({ sessionId: SessionId(`closed-${protocol}-recipient`),
      meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const sender = await activeActor(ctx, input.team.id, input.sender)
    const recipient = await activeActor(ctx, input.team.id, input.recipient)
    const channel = await openTestChannel(ctx, { teamId: input.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: input.team.id })).team.cursor,
      adapter: { type: protocol, version: 1 }, viewPolicy: { type: 'recent-window', version: 1 },
      participants: protocol === 'consult' ? [{ id: input.recipient.id, role: 'initiator' }, { id: input.sender.id, role: 'respondent' }]
        : [{ id: input.sender.id, role: 'speaker' }, { id: input.recipient.id, role: 'speaker' }],
      limits: protocol === 'consult' ? {} : { maxTurns: 1, speakerPolicy: 'free-form' } })
    await consentChannelEndpoints(ctx, channel, [{ participantId: input.sender.id, actor: sender }, { participantId: input.recipient.id, actor: recipient }], (manifest) => {
      (protocol === 'consult' ? TeamChannelBasic.consultChannelAdapter : TeamChannelBasic.discussionChannelAdapter).validateCreate(manifest)
    })
    const request = protocol === 'consult' ? await ctx.teams.postChannelEnvelope({ actor: recipient,
      expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      draft: { channelId: channel.manifest.id, audience: [input.sender.id], kind: 'request', payload: { text: 'An ordinary question' }, delivery: 'turn' } }) : undefined
    const last = await ctx.teams.postChannelEnvelope({ actor: sender,
      expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      draft: { channelId: channel.manifest.id, audience: [input.recipient.id], kind: protocol === 'consult' ? 'response' : 'message',
        payload: { text: 'NORMAL_CLOSED_OUTBOX' }, delivery: 'turn', ...request === undefined ? {} : { causationId: request.id } } })
    expect((await ctx.teams.getChannel({ channelId: channel.manifest.id })).phase).toBe('closed')
    await ctx.plugin(TeamAgentClientPlugin)
    await vi.waitFor(() => { expect(receiver.agent.session.events.some(event => event.type === 'team/channel-view'
      && JSON.stringify(event.data).includes('NORMAL_CLOSED_OUTBOX'))).toBe(true) })
    await expectReceipt(ctx, last, input.recipient.id)
    expect(receiver.agent.session.events.filter(event => event.type === 'team/channel-view' && event.data.triggeringEnvelopeId === last.id)).toHaveLength(1)
    await expect(ctx.teams.postChannelEnvelope({ actor: sender, expectedCursor: (await ctx.teams.getChannel({ channelId: channel.manifest.id })).cursor,
      draft: { channelId: channel.manifest.id, audience: [input.recipient.id], kind: 'message', payload: { text: 'Too late' }, delivery: 'turn' } }))
      .rejects.toThrow()
  })

  it('persists one review channel view with its exact revision fence before receipt', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('review-assignment-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const recipientBinding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-review-assignment-recipient')
    const senderActor = await activeActor(ctx, input.team.id, input.sender)
    let state = await ctx.teams.getTeam({ teamId: input.team.id })
    const senderBinding = state.activations.find(binding => binding.activation.participantId === input.sender.id)
    if (senderBinding === undefined) throw new Error('review assignment fixture requires a sender activation binding')
    const taskActor = await coordinatorTaskActor(ctx, input.team.id)
    state = await ctx.teams.getTeam({ teamId: input.team.id })
    const task = await ctx.teams.createTask({
      actor: taskActor,
      teamId: input.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('agent-client-review-task') },
      subject: 'Review the completed worker result.',
      description: 'Route the completed result through the scheduler-owned review request.',
      blockedBy: [],
      requiredCapabilities: [],
      priority: 0,
      readScopes: [],
      writeScopes: [],
      workspaceMode: 'shared',
      budget: {},
      reviewPolicy: { kind: 'participant', reviewerId: input.recipient.id },
      maxAttempts: 1,
    })
    const assigned = await assignSchedulerLease(ctx, {
      teamId: input.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: input.sender.id,
      activationId: senderBinding.activation.id,
      leaseDurationMs: 1_000,
    })
    const lease = assigned.lease
    if (lease === undefined) throw new Error('review assignment fixture requires a task lease')
    const running = await ctx.teams.startTaskAttempt({
      actor: senderActor,
      taskId: task.id,
      expectedRevision: assigned.revision,
      attemptId: lease.attemptId,
    })
    const reviewing = await ctx.teams.settleTaskAttempt({
      actor: senderActor,
      taskId: task.id,
      expectedRevision: running.revision,
      attemptId: lease.attemptId,
      outcome: { kind: 'completed', result: { summary: 'The worker result is available for review.' } },
    })
    const reviewChannel = await openTestChannel(ctx, {
      teamId: input.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: input.team.id })).team.cursor,
      adapter: TeamChannelBasic.CONSULT_CHANNEL_ADAPTER_V1,
      viewPolicy: { type: 'recent-window', version: 1 },
      participants: [
        { id: input.sender.id, role: TeamChannelBasic.CONSULT_INITIATOR_ROLE },
        { id: input.recipient.id, role: TeamChannelBasic.CONSULT_RESPONDENT_ROLE },
      ],
      limits: {},
    })
    await consentChannelEndpoints(ctx, reviewChannel, [
      { participantId: input.sender.id, actor: senderActor },
      { participantId: input.recipient.id, actor: await activeActor(ctx, input.team.id, input.recipient) },
    ], (manifest) => { TeamChannelBasic.consultChannelAdapter.validateCreate(manifest) })
    let receiptObservedDurableView = false
    const originalAcknowledge = ctx.teams.ackChannelEnvelope.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'ackChannelEnvelope').mockImplementation(async (request) => {
      if (request.channelId === reviewChannel.manifest.id) {
        const stored = await ctx.sessionPersistence.inspect(receiver.agent.session.id)
        receiptObservedDurableView = stored.events.some(event => event.type === 'team/channel-view'
          && event.data.triggeringEnvelopeId === request.envelopeId)
      }
      return await originalAcknowledge(request)
    })
    const review = await ctx.teams.postChannelEnvelope({
      actor: schedulerPostActor(ctx, {
        kind: 'scheduler-review-request',
        teamId: input.team.id,
        channelId: reviewChannel.manifest.id,
        taskId: task.id,
        attemptId: lease.attemptId,
        reviewRevision: reviewing.revision,
        initiatorId: input.sender.id,
        reviewerId: input.recipient.id,
        reviewerActivationId: recipientBinding.activation.id,
        reviewerSessionId: recipientBinding.sessionId,
        reviewerProvider: recipientBinding.provider,
      }),
      expectedCursor: (await ctx.teams.getChannel({ channelId: reviewChannel.manifest.id })).cursor,
      draft: {
        channelId: reviewChannel.manifest.id,
        audience: [input.recipient.id],
        kind: TeamChannelBasic.CONSULT_REVIEW_REQUEST_KIND,
        payload: {
          text: 'Inspect the worker result.',
          taskId: task.id,
          attemptId: lease.attemptId,
          reviewRevision: reviewing.revision,
          reviewerId: input.recipient.id,
          initiatorId: input.sender.id,
          result: { summary: 'The worker result is available for review.' },
        },
        delivery: 'turn',
        taskId: task.id,
      },
    })
    await vi.waitFor(async () => {
      const delivered = receiver.agent.session.events.find(event => event.type === 'team/channel-view'
        && event.data.triggeringEnvelopeId === review.id)
      expect(delivered).toBeDefined()
      if (delivered?.type !== 'team/channel-view') return
      expect(delivered.data).toMatchObject({
        teamId: input.team.id,
        channelId: reviewChannel.manifest.id,
        triggeringEnvelopeId: review.id,
        taskId: task.id,
        review: {
          attemptId: lease.attemptId,
          reviewRevision: reviewing.revision,
          reviewerId: input.recipient.id,
        },
      })
      expect(delivered.data.sourceEnvelopeIds).toEqual([review.id])
      expect(delivered.data.content[0]).toMatchObject({ type: 'text' })
    })
    await receiver.agent.whenIdle()
    await expectReceipt(ctx, review, input.recipient.id)
    expect(receiptObservedDurableView).toBe(true)
    expect(receiver.agent.session.events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'team-channel-view')).toHaveLength(0)
    const viewCount = receiver.agent.session.events.filter(event => event.type === 'team/channel-view'
      && event.data.triggeringEnvelopeId === review.id).length
    const turnCount = receiver.agent.session.events.filter(event => event.type === 'turn/start').length
    ctx.emit('channel/changed', {
      channelId: review.channelId,
      record: recordEnvelope(review),
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(receiver.agent.session.events.filter(event => event.type === 'team/channel-view'
      && event.data.triggeringEnvelopeId === review.id)).toHaveLength(viewCount)
    expect(receiver.agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(turnCount)
    state = await ctx.teams.getTeam({ teamId: input.team.id })
    expect(state.tasks.find(candidate => candidate.id === task.id)?.phase).toBe('review')
  })

  it('cancels a live exact local target with keepInbox and acknowledges its durable soft interrupt', async () => {
    const adapter = new InterruptibleAdapter()
    const ctx = await setup(true, adapter)
    const input = await directChannel(ctx, TeamChannelDirect.DIRECT_CHANNEL_ADAPTER_V1, 'coordinator')
    const receiver = await ctx.agents.create({
      sessionId: SessionId('soft-interrupt-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-soft-interrupt-recipient')
    const acknowledge = vi.spyOn(ctx.teams, 'acknowledgeParticipantInterrupt')

    receiver.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Wait for an interrupt.' }],
      source: { kind: 'user' },
    }))
    await adapter.started.promise
    const command = await requestTeamRunInterrupt(ctx, input, input.recipient)

    await vi.waitFor(() => {
      const request = acknowledge.mock.calls.find(([candidate]) => candidate.interruptId === command.id)?.[0]
      if (request === undefined) throw new Error('local Link did not acknowledge the requested interrupt')
      expect(Object.keys(request).sort()).toEqual(['actor', 'interruptId'])
      expect(request.actor).toBeTypeOf('object')
    })
    await receiver.agent.whenIdle()
    expect(receiver.agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason)
      .toEqual({ kind: 'aborted', reason: { kind: 'user' } })
    await expect(pendingInterrupts(ctx, binding)).resolves.toEqual([])
  })

  it('maps turn and steer delivery intent through the public waking inbox operations', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-waking-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const turn = await post(ctx, input, 'turn')
    await vi.waitFor(() => {
      expect(acceptanceCount(receiver.agent.session.events, turn.id)).toBeGreaterThan(0)
    })
    await receiver.agent.whenIdle()
    const steer = await post(ctx, input, 'steer')
    await vi.waitFor(() => {
      expect(acceptanceCount(receiver.agent.session.events, steer.id)).toBeGreaterThan(0)
    })
    await receiver.agent.whenIdle()
    expect(recordedEnvelopeIds(receiver.agent.session.events)).toEqual([turn.id, steer.id])
    expect(receiver.agent.session.events
      .filter((event): event is SessionEvent<'user/message'> =>
        event.type === 'user/message' && event.data.source.kind === 'team-envelope')
      .map(event => (event.data.source as unknown as { readonly delivery: string }).delivery)).toEqual(['turn', 'steer'])
  })

  it('holds waking direct delivery at Session persistence before each model request', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-persistence-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    const turnFlush = { started: Promise.withResolvers<undefined>(), release: Promise.withResolvers<undefined>() }
    const steerFlush = { started: Promise.withResolvers<undefined>(), release: Promise.withResolvers<undefined>() }
    const barriers = [turnFlush, steerFlush]
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      const barrier = session === receiver.agent.session ? barriers.shift() : undefined
      if (barrier !== undefined) {
        barrier.started.resolve(undefined)
        await barrier.release.promise
      }
      return await originalFlush(session)
    })
    let requests = 0
    ctx.on('agent/request', ({ agent }, next) => {
      if (agent === receiver.agent) requests += 1
      return next()
    })

    const turn = await post(ctx, input, 'turn')
    await turnFlush.started.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(requests).toBe(0)
    turnFlush.release.resolve(undefined)
    await receiver.agent.whenIdle()
    expect(requests).toBe(1)
    await expectReceipt(ctx, turn, input.recipient.id)

    const steer = await post(ctx, input, 'steer')
    await steerFlush.started.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(requests).toBe(1)
    steerFlush.release.resolve(undefined)
    await receiver.agent.whenIdle()
    expect(requests).toBe(2)
    await expectReceipt(ctx, steer, input.recipient.id)
  })

  it('re-admits a waking Envelope after one target Session flush failure without duplicating its durable input', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-flush-failure-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const originalFlush = ctx.sessions.flush.bind(ctx.sessions)
    let failed = false
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (session === receiver.agent.session && !failed) {
        failed = true
        throw new Error('target flush failed')
      }
      return await originalFlush(session)
    })
    let requests = 0
    ctx.on('agent/request', ({ agent }, next) => {
      if (agent === receiver.agent) requests += 1
      return next()
    })

    const accepted = await post(ctx, input, 'turn')
    await vi.waitFor(() => { expect(failed).toBe(true) })
    await vi.waitFor(() => { expect(requests).toBe(1) })
    await receiver.agent.whenIdle()
    await expectReceipt(ctx, accepted, input.recipient.id)
    expect(recordedEnvelopeIds(receiver.agent.session.events)).toEqual([accepted.id])
  })

  it('retries a failed receipt after target persistence without appending another inbox source', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-receipt-retry-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const originalAcknowledge = ctx.teams.ackChannelEnvelope.bind(ctx.teams)
    let failed = false
    vi.spyOn(ctx.teams, 'ackChannelEnvelope').mockImplementation(async (request) => {
      if (!failed) {
        failed = true
        throw new Error('receipt store temporarily unavailable')
      }
      return await originalAcknowledge(request)
    })

    const accepted = await post(ctx, input, 'context')
    await vi.waitFor(() => { expect(failed).toBe(true) })
    await expectReceipt(ctx, accepted, input.recipient.id)
    expect(acceptanceCount(receiver.agent.session.events, accepted.id)).toBe(1)
  })

  it('claims a task-assignment turn, starts its exact lease, records durable task provenance, and acknowledges the wake-up', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('task-assignment-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-task-assignment-recipient')
    let requests = 0
    ctx.on('agent/request', ({ agent }, next) => {
      if (agent === receiver.agent) requests += 1
      return next()
    })

    const assignment = await assignTask(ctx, input, binding)
    await vi.waitFor(async () => {
      const task = await ctx.teams.getTask({ teamId: input.team.id, taskId: assignment.task.id })
      expect(task.phase).toBe('running')
      expect(task.lease).toMatchObject({
        attemptId: assignment.assigned.lease?.attemptId,
        assignedRevision: assignment.assigned.lease?.assignedRevision,
        wakeChannelId: assignment.channel.manifest.id,
      })
      expect(task.lease?.startedAt).toBeDefined()
    })
    await receiver.agent.whenIdle()
    await expectReceipt(ctx, assignment.envelope, input.recipient.id)
    expect(requests).toBe(1)
    expect(recordedTaskAssignmentEnvelopeIds(receiver.agent.session.events)).toEqual([assignment.envelope.id])
    const source = receiver.agent.session.events.find(event => event.type === 'user/message'
      && (event.data as { readonly source?: { readonly kind?: unknown } }).source?.kind === 'team-task-assignment')
    const taskMessage = source?.data as {
      readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[]
    } | undefined
    expect(taskMessage?.content?.[0]?.text).toBeTypeOf('string')
    expect(taskMessage?.content?.[0]?.text).toContain(assignment.task.description)
    expect(source?.data).toMatchObject({
      source: {
        kind: 'team-task-assignment',
        teamId: input.team.id,
        channelId: assignment.channel.manifest.id,
        envelopeId: assignment.envelope.id,
        taskId: assignment.task.id,
        attemptId: assignment.assigned.lease?.attemptId,
        assignedRevision: assignment.assigned.lease?.assignedRevision,
        runningRevision: assignment.assigned.revision + 1,
        activationId: binding.activation.id,
      },
    })
  })

  it('keeps an ordinary binding on its Session cwd when recovery finds no durable allocation', async () => {
    const ctx = await setup(true, new ReplyAdapter(), { consumeWorkspace: true }, workspaceProvider([], async () => {}))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('workspace-empty-binding-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id, cwd: '/session/ordinary-root' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-workspace-empty-binding')

    await vi.waitFor(() => {
      expect(resolveAgentWorkspaceRoot(receiver.agent)).toBe('/session/ordinary-root')
    })
  })

  it('blocks a binding synchronously while its durable workspace recovery scan is pending', async () => {
    const ctx = await setup(false, new ReplyAdapter(), {}, workspaceProvider([], async () => {}))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('workspace-recovery-barrier-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id, cwd: '/session/recovery-root' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-workspace-recovery-barrier')
    const gate = Promise.withResolvers<undefined>()
    const getTeam = ctx.teams.getTeam.bind(ctx.teams)
    const getTeamSpy = vi.spyOn(ctx.teams, 'getTeam').mockImplementation(async (request) => {
      await gate.promise
      return await getTeam(request)
    })
    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, {
      agent: receiver.agent,
      binding,
    }, { consumeWorkspace: true, reconnectDelayMs: 1, disposalTimeoutMs: 100 })

    try {
      delivery.start()
      expect(() => resolveAgentWorkspaceRoot(receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
      gate.resolve(undefined)
      await vi.waitFor(() => {
        expect(resolveAgentWorkspaceRoot(receiver.agent)).toBe('/session/recovery-root')
      })
    } finally {
      gate.resolve(undefined)
      getTeamSpy.mockRestore()
      await delivery.close()
    }
  })

  it('reserves metadata before materializing a task root, then records durable release before removing that root', async () => {
    const calls: string[] = []
    const release = vi.fn(async () => { calls.push('release') })
    const ctx = await setup(true, new ReplyAdapter(), { consumeWorkspace: true }, workspaceProvider(calls, release))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('workspace-task-assignment-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id, cwd: '/session/released-task-root' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-workspace-task-assignment')
    const assignment = await assignTask(ctx, input, binding)

    let running: Awaited<ReturnType<Context['teams']['getTask']>> | undefined
    await vi.waitFor(async () => {
      running = await ctx.teams.getTask({ teamId: input.team.id, taskId: assignment.task.id })
      expect(running.phase).toBe('running')
      expect(calls).toContain('materialize')
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{
          taskId: assignment.task.id,
          attemptId: assignment.assigned.lease?.attemptId,
          lifecycle: 'active',
          provider: 'agent-client-workspace',
        }],
      })
    })
    if (running?.lease === undefined) throw new Error('workspace test assignment did not reach a running lease')
    expect(calls).toEqual(['prepare', 'materialize'])
    expect(resolveAgentWorkspaceRoot(receiver.agent)).toBe('/workspace/agent-client')
    await receiver.agent.whenIdle()
    await expectReceipt(ctx, assignment.envelope, input.recipient.id)
    const source = receiver.agent.session.events.find(event => event.type === 'user/message'
      && (event.data as { readonly source?: { readonly kind?: unknown } }).source?.kind === 'team-task-assignment')
    const workspaceAllocationId = (source?.data as {
      readonly source?: { readonly workspaceAllocationId?: unknown }
    } | undefined)?.source?.workspaceAllocationId
    expect(workspaceAllocationId).toBeTypeOf('string')

    const settled = await ctx.teams.settleTaskAttempt({
      actor: await activeActor(ctx, input.team.id, input.recipient),
      taskId: assignment.task.id,
      attemptId: running.lease.attemptId,
      expectedRevision: running.revision,
      outcome: { kind: 'completed', result: { summary: 'Workspace task settled.' } },
    })
    expect(settled.phase).toBe('completed')
    await vi.waitFor(async () => {
      const state = await ctx.teams.getTeam({ teamId: input.team.id })
      expect(state.workspaceAllocations).toMatchObject([{ lifecycle: 'released' }])
      expect(release).toHaveBeenCalledTimes(1)
    })
    expect(resolveAgentWorkspaceRoot(receiver.agent)).toBe('/session/released-task-root')
  })

  it('preserves a provider root durably when terminal cleanup cannot release it', async () => {
    const release = vi.fn(async () => { throw new Error('dirty worktree remains') })
    const ctx = await setup(true, new ReplyAdapter(), { consumeWorkspace: true }, workspaceProvider([], release))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('preserved-workspace-task-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-preserved-workspace-task')
    const assignment = await assignTask(ctx, input, binding)
    let running: Awaited<ReturnType<Context['teams']['getTask']>> | undefined
    await vi.waitFor(async () => {
      running = await ctx.teams.getTask({ teamId: input.team.id, taskId: assignment.task.id })
      expect(running.phase).toBe('running')
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'active' }],
      })
    })
    if (running?.lease === undefined) throw new Error('preservation fixture did not reach a running lease')
    await ctx.teams.settleTaskAttempt({
      actor: await activeActor(ctx, input.team.id, input.recipient),
      taskId: assignment.task.id,
      attemptId: running.lease.attemptId,
      expectedRevision: running.revision,
      outcome: { kind: 'failed', failure: { code: 'WORKSPACE_TEST_FAILURE', message: 'release must preserve this root' } },
    })
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{
          lifecycle: 'preserved',
          preservationReason: { code: 'WORKSPACE_RELEASE_FAILED' },
        }],
      })
      expect(release).toHaveBeenCalledTimes(1)
    })
    expect(() => resolveAgentWorkspaceRoot(receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
  })

  it('fails closed instead of admitting a task to its Session cwd when no workspace provider is registered', async () => {
    const ctx = await setup(true, new ReplyAdapter(), { consumeWorkspace: true }, null)
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('missing-workspace-provider-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-missing-workspace-provider')
    const assignment = await assignTask(ctx, input, binding)
    await vi.waitFor(() => {
      expect(() => resolveAgentWorkspaceRoot(receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
    })
    const task = await ctx.teams.getTask({ teamId: input.team.id, taskId: assignment.task.id })
    expect(task.phase).toBe('running')
    expect(recordedTaskAssignmentEnvelopeIds(receiver.agent.session.events)).toEqual([])
  })

  it('preserves a reserved allocation and reports combined cleanup failure when materialization cannot start', async () => {
    const calls: string[] = []
    const ctx = await setup(true, new ReplyAdapter(), { consumeWorkspace: true }, failingMaterializationProvider(calls))
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('failed-workspace-materialization-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-failed-workspace-materialization')
    const assignment = await assignTask(ctx, input, binding)

    await vi.waitFor(async () => {
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{
          taskId: assignment.task.id,
          lifecycle: 'preserved',
          preservationReason: { code: 'WORKSPACE_MATERIALIZATION_FAILED' },
        }],
      })
      expect(calls.slice(0, 3)).toEqual(['prepare', 'materialize', 'abandon'])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('workspace \'agent-client-failing-allocation'))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('materialization cleanup failed'))
    })
    expect(recordedTaskAssignmentEnvelopeIds(receiver.agent.session.events)).toEqual([])
    expect(() => resolveAgentWorkspaceRoot(receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
  })

  it('releases the Agent-keyed workspace lease when its fixed delivery closes', async () => {
    const ctx = await setup(false, new ReplyAdapter(), {}, workspaceProvider([], async () => {}))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('workspace-settler-disposal-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-workspace-settler-disposal')
    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, {
      agent: receiver.agent,
      binding,
    }, { consumeWorkspace: true, reconnectDelayMs: 1, disposalTimeoutMs: 100 })

    delivery.start()
    await vi.waitFor(() => {
      expect(() => openAgentWorkspaceLease(receiver.agent)).toThrow(/already has a live workspace lease/)
    })
    await delivery.close()
    const replacement = openAgentWorkspaceLease(receiver.agent)
    replacement.dispose()
  })

  it('reconciles a restart-visible release request after physical cleanup succeeded before its confirmation commit', async () => {
    const calls: string[] = []
    const release = vi.fn(async () => { calls.push('release') })
    const ctx = await setup(false, new ReplyAdapter(), {}, workspaceProvider(calls, release))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('release-reconciliation-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id, cwd: '/session/reconciled-release-root' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-release-reconciliation')
    const assignment = await assignTask(ctx, input, binding)
    const assignedLease = assignment.assigned.lease
    if (assignedLease === undefined) throw new Error('release reconciliation fixture did not retain an assignment lease')
    const running = await ctx.teams.startTaskAttempt({
      actor: await activeActor(ctx, input.team.id, input.recipient),
      taskId: assignment.task.id,
      expectedRevision: assignment.assigned.revision,
      attemptId: assignedLease.attemptId,
    })
    const request = {
      teamId: input.team.id,
      taskId: assignment.task.id,
      attemptId: assignedLease.attemptId,
      assignedRevision: assignedLease.assignedRevision,
      participantId: input.recipient.id,
      activationId: binding.activation.id,
      sessionId: binding.sessionId,
    }
    const preparation = await ctx.teamWorkspaces.prepare('shared', request)
    const reserveInput = {
      teamId: input.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: input.team.id })).team.cursor,
      taskId: assignment.task.id,
      expectedTaskRevision: running.revision,
      attemptId: assignedLease.attemptId,
      allocation: {
        id: preparation.id,
        provider: preparation.provider,
        mode: preparation.mode,
        assignedRevision: preparation.assignedRevision,
        participantId: preparation.participantId,
        activationId: preparation.activationId,
        sessionId: preparation.sessionId,
        ...preparation.baseVersion === undefined ? {} : { baseVersion: preparation.baseVersion },
      },
    }
    const reserved = await withWorkspaceAllocationProof(ctx, {
      kind: 'workspace-allocation-reserve',
      ...reserveInput,
    }, async actor => await ctx.teams.reserveWorkspaceAllocation({ actor, ...reserveInput }))
    const allocation = await ctx.teamWorkspaces.materialize('shared', request, preparation)
    const activateInput = {
      teamId: input.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: input.team.id })).team.cursor,
      allocationId: reserved.id,
      expectedRevision: reserved.revision,
    }
    const active = await withWorkspaceAllocationProof(ctx, {
      kind: 'workspace-allocation-activate',
      ...activateInput,
    }, async actor => await ctx.teams.activateWorkspaceAllocation({ actor, ...activateInput }))
    const releaseRequestInput = {
      teamId: input.team.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: input.team.id })).team.cursor,
      allocationId: active.id,
      expectedRevision: active.revision,
    }
    const releaseRequested = await withWorkspaceAllocationProof(ctx, {
      kind: 'workspace-allocation-release-request',
      ...releaseRequestInput,
    }, async actor => await ctx.teams.requestWorkspaceAllocationRelease({ actor, ...releaseRequestInput }))
    await allocation.release()
    expect((await ctx.teams.getTeam({ teamId: input.team.id })).workspaceAllocations).toMatchObject([
      { id: releaseRequested.id, lifecycle: 'release-requested' },
    ])

    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, {
      agent: receiver.agent,
      binding,
    }, { consumeWorkspace: true, reconnectDelayMs: 1, disposalTimeoutMs: 100 })
    delivery.start()
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ id: releaseRequested.id, lifecycle: 'released' }],
      })
      expect(calls).toContain('reconcile-release')
    })
    expect(() => resolveAgentWorkspaceRoot(receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
    await delivery.close()
  })

  it('runs the scheduler-to-Link-to-Agent task-assignment path without an advisory event waking the Agent', async () => {
    const ctx = await setup()
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('scheduler-task-assignment-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id, 'activation-scheduler-task-assignment')
    const task = await createPendingTask(ctx, input)
    const scheduler = new TeamDagScheduler(ctx, {
      leaseDurationMs: 1_000,
      maxAssignmentsPerDrive: 1,
      maxExpirationsPerDrive: 1,
      maxWakeDispatchesPerDrive: 1,
      maxConflictsPerDrive: 1,
      maxActiveAttemptsPerParticipant: 1,
      permittedWorkspaceModes: ['shared'],
      disposalTimeoutMs: 100,
    })
    const unregisterEnvelopePost = ctx.teams.registerSystemEnvelopePostProofSource(scheduler.envelopePostProofSource)
    const unregisterTaskLease = ctx.teams.registerSystemTaskLeaseProofSource(scheduler.taskLeaseProofSource)
    const unregisterSchedulerChannel = ctx.teams.registerSystemSchedulerChannelProofSource(scheduler.schedulerChannelProofSource)
    try {
      await scheduler.drive({ teamId: input.team.id })
      await vi.waitFor(async () => {
        const started = await ctx.teams.getTask({ teamId: input.team.id, taskId: task.id })
        expect(started.phase).toBe('running')
        expect(started.lease?.wakeChannelId).toBeDefined()
        expect(started.lease?.startedAt).toBeDefined()
        if (started.lease?.wakeChannelId === undefined) throw new Error('scheduler did not retain a task wake channel')
        const channel = await ctx.teams.readChannel({ channelId: started.lease.wakeChannelId, afterCursor: -1 })
        expect(channel.channel.manifest.adapter).toEqual(TeamChannelTaskAssignment.TASK_ASSIGNMENT_CHANNEL_ADAPTER)
        expect(channel.records.filter(record => record.type === 'channel/envelope')).toHaveLength(1)
      })
      await receiver.agent.whenIdle()
      expect(recordedTaskAssignmentEnvelopeIds(receiver.agent.session.events)).toHaveLength(1)
    } finally {
      try {
        await scheduler.close()
      } finally {
        try {
          unregisterTaskLease()
        } finally {
          try {
            unregisterSchedulerChannel()
          } finally {
            unregisterEnvelopePost()
          }
        }
      }
    }
  })

  it('stops new local admission once the client unloads', async () => {
    const ctx = await setup(false)
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-unloaded-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const client = await ctx.plugin(TeamAgentClientPlugin)
    await client.dispose()
    const envelope = await post(ctx, input, 'context')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(0)
  })

  it('replays a missed direct Envelope and acknowledges a flush that preceded client startup without duplicating inbox input', async () => {
    const ctx = await setup(false)
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-replay-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const envelope = await post(ctx, input, 'context')
    receiver.agent.inject(freezeMessage({
      id: MessageId(`team-envelope:${envelope.id}`),
      role: 'user',
      content: [{ type: 'text', text: `Direct message from ${envelope.senderId}:\ncontext delivery` }],
      source: {
        kind: 'team-envelope',
        teamId: envelope.teamId,
        channelId: envelope.channelId,
        envelopeId: envelope.id,
        senderId: envelope.senderId,
        delivery: 'context',
      },
    }))
    await ctx.sessions.flush(receiver.agent.session)
    await ctx.plugin(TeamAgentClientPlugin)
    await vi.waitFor(() => {
      expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(1)
    })
    await expectReceipt(ctx, envelope, input.recipient.id)
  })

  it('records a causal-reply receipt during replay without injecting or waking the handled source', async () => {
    const ctx = await setup(false)
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({
      sessionId: SessionId('direct-causal-reply-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await bindRecipient(ctx, input, receiver.agent.session.id)
    const source = await post(ctx, input, 'turn')
    await postCausalReply(ctx, input, source)
    let requests = 0
    ctx.on('agent/request', ({ agent }, next) => {
      if (agent === receiver.agent) requests += 1
      return next()
    })

    await ctx.plugin(TeamAgentClientPlugin)
    await expectReceipt(ctx, source, input.recipient.id)
    await receiver.agent.whenIdle()
    expect(acceptanceCount(receiver.agent.session.events, source.id)).toBe(0)
    expect(receiver.agent.session.events.some(event => event.type === 'turn/start')).toBe(false)
    expect(requests).toBe(0)
  })

  it('releases a restored allocation when its durable activation cannot be committed', async () => {
    const calls: string[] = []
    const release = vi.fn(async () => { calls.push('release') })
    const ctx = await setup(false, new ReplyAdapter(), {}, workspaceProvider(calls, release))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({ sessionId: SessionId('restore-activation-failure'),
      meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
    await reserveAssignedWorkspace(ctx, input, binding)
    vi.spyOn(ctx.teams, 'activateWorkspaceAllocation').mockImplementationOnce(async (request) => {
      expect(() => JSON.stringify(request.actor)).toThrow('runtime-only')
      throw new Error('activation append failed')
    })
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, { agent: receiver.agent, binding },
      { consumeWorkspace: true, disposalTimeoutMs: 100 })
    try {
      delivery.start()
      await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('activation append failed')) })
      expect(release).toHaveBeenCalledTimes(1)
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'released' }],
      })
    } finally {
      await delivery.close()
    }
  })

  it('retains workspace authority after close times out until an admitted release is durably confirmed', async () => {
    const releaseEntered = Promise.withResolvers<undefined>()
    const releaseGate = Promise.withResolvers<undefined>()
    const calls: string[] = []
    const release = vi.fn(async () => { releaseEntered.resolve(undefined); await releaseGate.promise })
    const ctx = await setup(false, new ReplyAdapter(), {}, workspaceProvider(calls, release))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({ sessionId: SessionId('release-after-close-timeout'),
      meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
    await reserveAssignedWorkspace(ctx, input, binding)
    const liveSources = new Set<string>()
    const register = ctx.teams.registerSystemWorkspaceAllocationProofSource.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'registerSystemWorkspaceAllocationProofSource').mockImplementation((source) => {
      liveSources.add(source.name)
      const unregister = register(source)
      return () => { liveSources.delete(source.name); unregister() }
    })
    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, { agent: receiver.agent, binding },
      { consumeWorkspace: true, disposalTimeoutMs: 5 })
    delivery.start()
    await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(receiver.agent)).toBe('/workspace/agent-client') })
    await receiver.agent.whenIdle()
    const closing = delivery.close()
    const closed = expect(closing).rejects.toThrow('disposal exceeded')
    await releaseEntered.promise
    await closed
    const retainedSourceCount = liveSources.size
    releaseGate.resolve(undefined)
    await vi.waitFor(async () => {
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'released' }],
      })
    })
    expect(release).toHaveBeenCalledTimes(1)
    expect(retainedSourceCount).toBe(1)
    await vi.waitFor(() => { expect(liveSources.size).toBe(0) })
  })


  it('settles the exact Agent workspace before activation disposal without repeating pending release', async () => {
    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const release = vi.fn(async () => { entered.resolve(undefined); await gate.promise })
    const ctx = await setup(false, new ReplyAdapter(), {}, workspaceProvider([], release))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({ sessionId: SessionId('activation-workspace-settlement'),
      meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
    const seeded = await reserveAssignedWorkspace(ctx, input, binding)
    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, { agent: receiver.agent, binding },
      { consumeWorkspace: true, disposalTimeoutMs: 100 })
    try {
      delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(receiver.agent)).toBe('/workspace/agent-client') })
      await receiver.agent.whenIdle()
      delivery.releaseTaskAllocation(seeded.reserved.taskId, seeded.reserved.attemptId)
      await entered.promise
      let done = false
      const settlement = settleAgentWorkspaceLease(receiver.agent).then(() => { done = true })
      await Promise.resolve()
      expect(done).toBe(false)
      gate.resolve(undefined)
      await settlement
      expect(release).toHaveBeenCalledTimes(1)
      await settleAgentWorkspaceLease(receiver.agent)
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'released' }],
      })
    } finally {
      gate.resolve(undefined)
      await delivery.close()
    }
  })

  it('retries workspace release intent after a real same-Team commit advances its cursor', async () => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release)
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      await mounted.receiver.agent.whenIdle()
      const request = mounted.ctx.teams.requestWorkspaceAllocationRelease.bind(mounted.ctx.teams)
      const admission = vi.spyOn(mounted.ctx.teams, 'requestWorkspaceAllocationRelease')
        .mockImplementationOnce(async (input) => {
          await activeParticipant(mounted.ctx, mounted.input.team.id, 'concurrent release observer')
          return await request(input)
        })
      await expect(mounted.delivery.close()).resolves.toBeUndefined()
      expect(admission).toHaveBeenCalledTimes(2)
      expect(release).toHaveBeenCalledTimes(1)
      await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'released' }],
      })
    } finally { await Promise.allSettled([mounted.delivery.close()]) }
  })

  it.each(['storage', 'policy'] as const)('retains a failed-close workspace owner until Core retries durable release intent: %s', async (cause) => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release)
    mounted.delivery.start()
    await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
    await mounted.receiver.agent.whenIdle()
    const failure = new Error('release intent storage unavailable')
    const admission = vi.spyOn(mounted.ctx.teams, 'requestWorkspaceAllocationRelease')
    const policy = vi.fn(async () => ({ kind: 'deny' as const, code: 'KEEP_WORKSPACE', message: 'Workspace release requires approval.' }))
    const unregister = cause === 'policy'
      ? mounted.ctx.teams.registerPolicy('workspace-allocate', { name: 'retain-workspace', apply: policy })
      : undefined
    if (cause === 'storage') admission.mockRejectedValueOnce(failure)
    await expect(mounted.delivery.close()).rejects.toSatisfy((error: unknown) =>
      error instanceof AggregateError && error.errors.some((rejection: unknown) =>
        cause === 'storage' ? rejection === failure : rejection instanceof TeamError && rejection.code === 'TEAM_POLICY_DENIED'),
    )
    expect(admission).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
    expect(() => openAgentWorkspaceLease(mounted.receiver.agent)).toThrow('already has a live workspace lease')
    expect(() => resolveAgentWorkspaceRoot(mounted.receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
    const lateMessage = createUserMessage({ content: [{ type: 'text', text: 'after failed close' }], source: { kind: 'user' } })
    mounted.receiver.agent.followup(lateMessage)
    await mounted.receiver.agent.whenIdle()
    expect(mounted.receiver.agent.session.events.some(event => event.type === 'user/message' && event.data.id === lateMessage.id)).toBe(false)
    expect(policy).toHaveBeenCalledTimes(cause === 'policy' ? 1 : 0)
    unregister?.()
    await settleAgentWorkspaceLease(mounted.receiver.agent)
    expect(release).toHaveBeenCalledTimes(1)
    await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
      workspaceAllocations: [{ lifecycle: 'released' }],
    })
    const replacement = openAgentWorkspaceLease(mounted.receiver.agent)
    replacement.dispose()
    await expect(mounted.delivery.close()).rejects.toThrow('Team Agent Client disposal failed')
  })

  it('retries confirmation CAS without repeating physical workspace release or reconciliation', async () => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release)
    const reconcile = vi.spyOn(mounted.ctx.teamWorkspaces, 'reconcileRelease')
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      await mounted.receiver.agent.whenIdle()
      const confirm = mounted.ctx.teams.confirmWorkspaceAllocationRelease.bind(mounted.ctx.teams)
      const confirmation = vi.spyOn(mounted.ctx.teams, 'confirmWorkspaceAllocationRelease')
        .mockImplementationOnce(async (input) => {
          await activeParticipant(mounted.ctx, mounted.input.team.id, 'concurrent confirmation observer')
          return await confirm(input)
        })
      await mounted.delivery.close()
      expect(confirmation).toHaveBeenCalledTimes(2)
      expect(release).toHaveBeenCalledTimes(1)
      expect(reconcile).not.toHaveBeenCalled()
    } finally { await Promise.allSettled([mounted.delivery.close()]) }
  })

  it('retains a physically released workspace without reconciling a denied confirmation', async () => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release)
    mounted.delivery.start()
    await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
    await mounted.receiver.agent.whenIdle()
    let confirmations = 0
    const unregister = mounted.ctx.teams.registerPolicy('workspace-allocate', {
      name: 'deny-release-confirmation',
      async apply(request, next) {
        if (request.facts.operation === 'workspace-allocation-release') {
          confirmations += 1
          return { kind: 'deny', code: 'CONFIRMATION_DENIED', message: 'An owner must review this release.' }
        }
        return await next()
      },
    })
    const reconcile = vi.spyOn(mounted.ctx.teamWorkspaces, 'reconcileRelease')
    await expect(mounted.delivery.close()).rejects.toThrow('Team Agent Client disposal failed')
    expect(confirmations).toBe(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(reconcile).not.toHaveBeenCalled()
    expect(() => openAgentWorkspaceLease(mounted.receiver.agent)).toThrow('already has a live workspace lease')
    expect(() => resolveAgentWorkspaceRoot(mounted.receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
    unregister()
    await settleAgentWorkspaceLease(mounted.receiver.agent)
    expect(release).toHaveBeenCalledTimes(1)
    expect(reconcile).not.toHaveBeenCalled()
    const replacement = openAgentWorkspaceLease(mounted.receiver.agent)
    replacement.dispose()
  })

  it.each(['request', 'confirm'] as const)('bounds %s CAS attempts and retains the workspace owner for later Core settlement', async (phase) => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release, true, 1000, 2)
    mounted.delivery.start()
    await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
    await mounted.receiver.agent.whenIdle()
    const method = phase === 'request' ? 'requestWorkspaceAllocationRelease' : 'confirmWorkspaceAllocationRelease'
    const mutate = mounted.ctx.teams[method].bind(mounted.ctx.teams)
    let conflicts = 0
    let racing = true
    const mutation = vi.spyOn(mounted.ctx.teams, method).mockImplementation(async (input) => {
      if (racing) {
        conflicts += 1
        await activeParticipant(mounted.ctx, mounted.input.team.id, `concurrent ${phase} ${String(conflicts)}`)
      }
      return await mutate(input)
    })
    const reconcile = vi.spyOn(mounted.ctx.teamWorkspaces, 'reconcileRelease')
    await expect(mounted.delivery.close()).rejects.toSatisfy((error: unknown) =>
      error instanceof AggregateError && error.errors.some((cause: unknown) => cause instanceof TeamError && cause.code === 'TEAM_CURSOR_CONFLICT'),
    )
    expect(mutation).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledTimes(phase === 'request' ? 0 : 1)
    expect(reconcile).not.toHaveBeenCalled()
    expect(() => openAgentWorkspaceLease(mounted.receiver.agent)).toThrow('already has a live workspace lease')
    expect(() => resolveAgentWorkspaceRoot(mounted.receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
    racing = false
    await settleAgentWorkspaceLease(mounted.receiver.agent)
    expect(mutation).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledTimes(1)
    expect(reconcile).not.toHaveBeenCalled()
    await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
      workspaceAllocations: [{ lifecycle: 'released' }],
    })
    const replacement = openAgentWorkspaceLease(mounted.receiver.agent)
    replacement.dispose()
  })

  it('bounds same-Team CAS retries for workspace activation and preservation', async () => {
    const release = vi.fn(async () => { throw new Error('provider retained its root') })
    const mounted = await workspaceRecoveryFixture(release)
    const activate = mounted.ctx.teams.activateWorkspaceAllocation.bind(mounted.ctx.teams)
    const activation = vi.spyOn(mounted.ctx.teams, 'activateWorkspaceAllocation').mockImplementationOnce(async (input) => {
      await activeParticipant(mounted.ctx, mounted.input.team.id, 'concurrent activation observer')
      return await activate(input)
    })
    const preserve = mounted.ctx.teams.preserveWorkspaceAllocation.bind(mounted.ctx.teams)
    const preservation = vi.spyOn(mounted.ctx.teams, 'preserveWorkspaceAllocation').mockImplementationOnce(async (input) => {
      await activeParticipant(mounted.ctx, mounted.input.team.id, 'concurrent preservation observer')
      return await preserve(input)
    })
    mounted.delivery.start()
    await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
    await mounted.receiver.agent.whenIdle()
    await mounted.delivery.close()
    expect(activation).toHaveBeenCalledTimes(2)
    expect(preservation).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledTimes(1)
    await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
      workspaceAllocations: [{ lifecycle: 'preserved' }],
    })
    const replacement = openAgentWorkspaceLease(mounted.receiver.agent)
    replacement.dispose()
  })

  it.each([true, false])('replays a rejected in-flight claim when its Link retires=%s', async (retire) => {
    const ctx = await setup(false)
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({ sessionId: SessionId('claim-retirement-recipient'),
      meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, { agent: receiver.agent, binding },
      { disposalTimeoutMs: 1_000 })
    const entered = Promise.withResolvers<undefined>()
    const proceed = Promise.withResolvers<undefined>()
    const claim = ctx.teams.claimChannelDelivery.bind(ctx.teams)
    const claims = vi.spyOn(ctx.teams, 'claimChannelDelivery').mockImplementationOnce(async (request) => {
      entered.resolve(undefined)
      await proceed.promise
      if (!retire) throw new Error('active claim temporarily unavailable')
      return await claim(request)
    })
    delivery.start()
    const envelope = await post(ctx, input, 'context')
    await entered.promise
    expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(0)
    if (!retire) {
      proceed.resolve(undefined)
      try {
        await expectReceipt(ctx, envelope, input.recipient.id)
        expect(claims.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(1)
      } finally { await delivery.close() }
      return
    }
    const closing = delivery.close()
    proceed.resolve(undefined)
    await expect(closing).resolves.toBeUndefined()
    expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(0)
    const replay = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, { agent: receiver.agent, binding },
      { disposalTimeoutMs: 1_000 })
    try {
      replay.start()
      await expectReceipt(ctx, envelope, input.recipient.id)
      expect(acceptanceCount(receiver.agent.session.events, envelope.id)).toBe(1)
    } finally { await replay.close() }
  })

  it('retries a workspace reservation with a fresh Team cursor while retaining its admitted task fence', async () => {
    const mounted = await liveWorkspaceFixture(true, true)
    const reserve = mounted.ctx.teams.reserveWorkspaceAllocation.bind(mounted.ctx.teams)
    const reservation = vi.spyOn(mounted.ctx.teams, 'reserveWorkspaceAllocation').mockImplementationOnce(async (input) => {
      await activeParticipant(mounted.ctx, mounted.input.team.id, 'concurrent reservation observer')
      return await reserve(input)
    })
    try {
      await assignTask(mounted.ctx, mounted.input, mounted.binding)
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      expect(reservation).toHaveBeenCalledTimes(2)
      expect(mounted.calls.filter(call => call === 'prepare')).toHaveLength(1)
      expect(mounted.calls.filter(call => call === 'materialize')).toHaveLength(1)
    } finally { await mounted.delivery?.close() }
  })

  it('reports workspace release admission failure and permits the activation owner to retry settlement', async () => {
    const ctx = await setup(false, new ReplyAdapter(), {}, workspaceProvider([], async () => {}))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({ sessionId: SessionId('activation-workspace-settlement-retry'),
      meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
    await reserveAssignedWorkspace(ctx, input, binding)
    const delivery = new TeamAgentClientPlugin.FixedBindingTeamAgentLinkDelivery(ctx, { agent: receiver.agent, binding },
      { consumeWorkspace: true, disposalTimeoutMs: 100 })
    try {
      delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(receiver.agent)).toBe('/workspace/agent-client') })
      await receiver.agent.whenIdle()
      vi.spyOn(ctx.teams, 'requestWorkspaceAllocationRelease').mockRejectedValueOnce(new Error('release intent append failed'))
      await expect(settleAgentWorkspaceLease(receiver.agent)).rejects.toSatisfy((error: unknown) =>
        error instanceof AggregateError && error.errors.length === 1,
      )
      await settleAgentWorkspaceLease(receiver.agent)
      await expect(ctx.teams.getTeam({ teamId: input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'released' }],
      })
    } finally {
      await delivery.close()
    }
  })


  it.each([false, true])('preserves a workspace after restore failure and reports preservation failure=%s', async (preservationFails) => {
    const mounted = await workspaceRecoveryFixture()
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(mounted.ctx.teamWorkspaces, 'restore').mockRejectedValueOnce(new Error('provider cannot restore workspace'))
    if (preservationFails) vi.spyOn(mounted.ctx.teams, 'preserveWorkspaceAllocation').mockRejectedValueOnce(new Error('preservation append failed'))
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(warning).toHaveBeenCalled() })
      const state = await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })
      expect(state.workspaceAllocations[0]?.lifecycle).toBe(preservationFails ? 'reserved' : 'preserved')
      expect(() => resolveAgentWorkspaceRoot(mounted.receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(preservationFails ? 'recovery preservation failed' : 'provider cannot restore'))
    } finally { await mounted.delivery.close() }
  })

  it('restores an already active allocation without repeating its activation mutation', async () => {
    const mounted = await workspaceRecoveryFixture()
    const activate = { teamId: mounted.input.team.id,
      expectedCursor: (await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).team.cursor,
      allocationId: mounted.seeded.reserved.id, expectedRevision: mounted.seeded.reserved.revision }
    await withWorkspaceAllocationProof(mounted.ctx, { kind: 'workspace-allocation-activate', ...activate },
      async actor => await mounted.ctx.teams.activateWorkspaceAllocation({ actor, ...activate }))
    const activation = vi.spyOn(mounted.ctx.teams, 'activateWorkspaceAllocation')
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      expect(activation).not.toHaveBeenCalled()
    } finally { await mounted.delivery.close() }
  })

  it('keeps a preserved allocation unavailable instead of restoring it into the Agent', async () => {
    const mounted = await workspaceRecoveryFixture()
    const preserve = { teamId: mounted.input.team.id,
      expectedCursor: (await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).team.cursor,
      allocationId: mounted.seeded.reserved.id, expectedRevision: mounted.seeded.reserved.revision,
      reason: { code: 'PROVIDER_RECOVERY_UNCONFIRMED', message: 'The provider retained this allocation.' } }
    await withWorkspaceAllocationProof(mounted.ctx, { kind: 'workspace-allocation-preserve', ...preserve },
      async actor => await mounted.ctx.teams.preserveWorkspaceAllocation({ actor, ...preserve }))
    const restore = vi.spyOn(mounted.ctx.teamWorkspaces, 'restore')
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(mounted.calls).toEqual(['prepare']) })
      expect(restore).not.toHaveBeenCalled()
      expect(() => resolveAgentWorkspaceRoot(mounted.receiver.agent)).toThrow(AgentWorkspaceUnavailableError)
    } finally { await mounted.delivery.close() }
  })

  it('reconciles a release whose physical cleanup succeeded before its confirmation append failed', async () => {
    const mounted = await workspaceRecoveryFixture()
    const reconcile = vi.spyOn(mounted.ctx.teamWorkspaces, 'reconcileRelease')
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      await mounted.receiver.agent.whenIdle()
      vi.spyOn(mounted.ctx.teams, 'confirmWorkspaceAllocationRelease').mockRejectedValueOnce(new Error('confirmation append failed'))
      await settleAgentWorkspaceLease(mounted.receiver.agent)
      expect(reconcile).toHaveBeenCalledTimes(1)
      expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/session/recovery-fixture')
      await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'released' }],
      })
    } finally { await mounted.delivery.close() }
  })

  it('keeps release intent when confirmation and provider reconciliation both fail', async () => {
    const mounted = await workspaceRecoveryFixture()
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      await mounted.receiver.agent.whenIdle()
      vi.spyOn(mounted.ctx.teams, 'confirmWorkspaceAllocationRelease').mockRejectedValueOnce(new Error('confirmation append failed'))
      vi.spyOn(mounted.ctx.teamWorkspaces, 'reconcileRelease').mockRejectedValueOnce(new Error('reconciliation failed'))
      await expect(settleAgentWorkspaceLease(mounted.receiver.agent)).rejects.toSatisfy((error: unknown) =>
        error instanceof AggregateError && error.errors[0] instanceof AggregateError && error.errors[0].errors.length === 2,
      )
      await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'release-requested' }],
      })
    } finally { await mounted.delivery.close() }
  })

  it.each([false, true])('preserves an unpublished restored root after release failure with preservation failure=%s', async (preservationFails) => {
    const mounted = await workspaceRecoveryFixture(async () => { throw new Error('provider release failed') })
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(mounted.ctx.teams, 'activateWorkspaceAllocation').mockRejectedValueOnce(new Error('activation append failed'))
    if (preservationFails) vi.spyOn(mounted.ctx.teams, 'preserveWorkspaceAllocation').mockRejectedValueOnce(new Error('preservation append failed'))
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('workspace publication cleanup failed')) })
      await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: preservationFails ? 'release-requested' : 'preserved' }],
      })
    } finally { await mounted.delivery.close() }
  })

  it('retains release intent after an unpublished restored root was removed but confirmation failed', async () => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release)
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    vi.spyOn(mounted.ctx.teams, 'activateWorkspaceAllocation').mockRejectedValueOnce(new Error('activation append failed'))
    vi.spyOn(mounted.ctx.teams, 'confirmWorkspaceAllocationRelease').mockRejectedValueOnce(new Error('release confirmation failed'))
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('workspace publication cleanup failed')) })
      expect(release).toHaveBeenCalledTimes(1)
      await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'release-requested' }],
      })
    } finally { await mounted.delivery.close() }
  })


  it('records detailed final usage after retrying an intervening Team cursor append', async () => {
    const mounted = await usageFixture()
    const record = vi.spyOn(mounted.ctx.teams, 'recordUsage').mockRejectedValueOnce(new TeamError('cursor raced', 'TEAM_CURSOR_CONFLICT'))
    try {
      await post(mounted.ctx, mounted.input, 'turn')
      await vi.waitFor(() => { expect(record).toHaveBeenCalledTimes(2) })
      expect(record.mock.calls[1]?.[0].sample.usage).toEqual({
        inputTokens: 11, outputTokens: 7, cacheReadTokens: 2, cacheWriteTokens: 1, reasoningTokens: 3,
      })
    } finally { await mounted.client.close() }
  })

  it.each(['cursor', 'provider'] as const)('reports a bounded %s usage-write failure without retrying unrelated errors', async (failure) => {
    const mounted = await usageFixture()
    const error = failure === 'cursor' ? new TeamError('cursor raced', 'TEAM_CURSOR_CONFLICT') : new Error('usage append failed')
    const record = vi.spyOn(mounted.ctx.teams, 'recordUsage').mockRejectedValue(error)
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      await post(mounted.ctx, mounted.input, 'turn')
      await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining(failure === 'cursor' ? 'cursor kept changing' : 'usage append failed')) })
      expect(record).toHaveBeenCalledTimes(failure === 'cursor' ? 3 : 1)
    } finally { await mounted.client.close() }
  })

  it.each([false, true])('contains a delayed usage read rejection after wrapper retirement=%s', async (retire) => {
    const mounted = await usageFixture()
    const entered = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<Awaited<ReturnType<Context['teams']['getTeam']>>>()
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    mounted.ctx.on('session/event', (session, event) => {
      if (session !== mounted.receiver.agent.session || event.type !== 'assistant/message') return
      vi.spyOn(mounted.ctx.teams, 'getTeam').mockImplementationOnce(async () => { entered.resolve(undefined); return await read.promise })
    }, { prepend: true })
    try {
      await post(mounted.ctx, mounted.input, 'turn')
      await entered.promise
      if (retire) await mounted.client.close()
      read.reject(new Error('usage read failed'))
      if (retire) {
        await new Promise<void>(resolve => setImmediate(resolve))
        expect(warning.mock.calls.some(args => String(args[0]).includes('usage read failed'))).toBe(false)
      } else {
        await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('usage read failed')) })
      }
    } finally { await mounted.client.close() }
  })

  it.each(['cursor', 'provider'] as const)('does not publish a late %s usage warning after its wrapper closes', async (failure) => {
    const mounted = await usageFixture()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const error = failure === 'cursor' ? new TeamError('cursor raced', 'TEAM_CURSOR_CONFLICT') : new Error('usage append failed')
    const record = vi.spyOn(mounted.ctx.teams, 'recordUsage').mockImplementation(async () => {
      entered.resolve(undefined)
      await release.promise
      throw error
    })
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      await post(mounted.ctx, mounted.input, 'turn')
      await entered.promise
      await mounted.client.close()
      release.resolve(undefined)
      await vi.waitFor(() => { expect(record).toHaveBeenCalledTimes(failure === 'cursor' ? 3 : 1) })
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(warning.mock.calls.some(args => String(args[0]).includes('usage sample'))).toBe(false)
    } finally { release.resolve(undefined); await mounted.client.close() }
  })


  it('restores provider metadata that has no base version', async () => {
    const mounted = await workspaceRecoveryFixture(async () => {}, false)
    const restore = vi.spyOn(mounted.ctx.teamWorkspaces, 'restore')
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      expect(restore.mock.calls[0]?.[2].baseVersion).toBeUndefined()
    } finally { await mounted.delivery.close() }
  })

  it('requires the workspace registry before local fixed delivery can start', async () => {
    const mounted = await workspaceRecoveryFixture()
    await workspaceFibers.get(mounted.ctx)!.dispose()
    expect(() => { mounted.delivery.start() }).toThrow('requires a registered workspace registry')
    await mounted.delivery.close()
  })

  it('rejects workspace admission after its registry retires during the task-start claim', async () => {
    const ctx = await setup(true, new ReplyAdapter(), { consumeWorkspace: true }, workspaceProvider([], async () => {}))
    const input = await directChannel(ctx)
    const receiver = await ctx.agents.create({ sessionId: SessionId('workspace-registry-retired'),
      meta: { teamId: input.team.id, participantId: input.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
    const binding = await bindRecipient(ctx, input, receiver.agent.session.id)
    const start = ctx.teams.claimTaskAttemptStart.bind(ctx.teams)
    vi.spyOn(ctx.teams, 'claimTaskAttemptStart').mockImplementationOnce(async (request) => {
      const task = await start(request)
      await workspaceFibers.get(ctx)!.dispose()
      return task
    })
    const warning = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await assignTask(ctx, input, binding)
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('without a workspace provider registry')) })
    expect(receiver.agent.session.events.some(event => event.type === 'user/message')).toBe(false)
  })

  it('ignores usage from an unbound Agent and releases the wrapper binding on explicit Agent disposal', async () => {
    const mounted = await usageFixture()
    const record = vi.spyOn(mounted.ctx.teams, 'recordUsage')
    try {
      const outsider = await mounted.ctx.agents.create({ sessionId: SessionId('unbound-usage-agent'),
        agentOptions: { provider: 'mock', model: 'mock' } })
      outsider.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Complete one unbound turn.' }], source: { kind: 'user' } }))
      await vi.waitFor(() => { expect(outsider.agent.session.events.some(event => event.type === 'assistant/message')).toBe(true) })
      expect(record).not.toHaveBeenCalled()
      const getTeam = vi.spyOn(mounted.ctx.teams, 'getTeam')
      const current = await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })
      mounted.ctx.emit('team/changed', { type: 'participant/changed', participant: mounted.input.recipient,
        cursor: current.team.cursor, createdAt: current.team.updatedAt })
      await vi.waitFor(() => { expect(getTeam).toHaveBeenCalled() })
      await mounted.receiver.dispose()
      expect(mounted.ctx.teamLinks.getBoundLinkBorrower(mounted.receiver.agent)).toBeUndefined()
    } finally { await mounted.client.close() }
  })

  it.each([false, true])('preserves a release-requested allocation after provider reconciliation fails, preservation failure=%s', async (preservationFails) => {
    const mounted = await workspaceRecoveryFixture()
    const release = { teamId: mounted.input.team.id,
      expectedCursor: (await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).team.cursor,
      allocationId: mounted.seeded.reserved.id, expectedRevision: mounted.seeded.reserved.revision }
    await withWorkspaceAllocationProof(mounted.ctx, { kind: 'workspace-allocation-release-request', ...release },
      async actor => await mounted.ctx.teams.requestWorkspaceAllocationRelease({ actor, ...release }))
    vi.spyOn(mounted.ctx.teamWorkspaces, 'reconcileRelease').mockRejectedValueOnce(new Error('provider reconciliation failed'))
    if (preservationFails) vi.spyOn(mounted.ctx.teams, 'preserveWorkspaceAllocation').mockRejectedValueOnce(new Error('preservation append failed'))
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(warning).toHaveBeenCalled() })
      await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: preservationFails ? 'release-requested' : 'preserved' }],
      })
    } finally { await mounted.delivery.close() }
  })


  it.each([false, true])('abandons provider preparation when reservation fails, abandonment failure=%s', async (abandonmentFails) => {
    const mounted = await liveWorkspaceFixture()
    const prepare = mounted.ctx.teamWorkspaces.prepare.bind(mounted.ctx.teamWorkspaces)
    const abandon = vi.fn(async () => { if (abandonmentFails) throw new Error('abandonment failed') })
    vi.spyOn(mounted.ctx.teamWorkspaces, 'prepare').mockImplementation(async (...args) => ({ ...await prepare(...args), abandon }))
    vi.spyOn(mounted.ctx.teams, 'reserveWorkspaceAllocation').mockRejectedValue(new Error('reservation append failed'))
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    await assignTask(mounted.ctx, mounted.input, mounted.binding)
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining(abandonmentFails ? 'reservation cleanup failed' : 'reservation append failed')) })
    expect(abandon).toHaveBeenCalled()
    await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({ workspaceAllocations: [] })
    expect(mounted.calls).not.toContain('materialize')
  })

  it.each([false, true])('reports failed materialization while retaining its reservation, preservation failure=%s', async (preservationFails) => {
    const mounted = await liveWorkspaceFixture()
    vi.spyOn(mounted.ctx.teamWorkspaces, 'materialize').mockRejectedValue(new Error('provider materialization failed'))
    if (preservationFails) vi.spyOn(mounted.ctx.teams, 'preserveWorkspaceAllocation').mockRejectedValue(new Error('preservation append failed'))
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    await assignTask(mounted.ctx, mounted.input, mounted.binding)
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining(preservationFails ? 'materialization cleanup failed' : 'provider materialization failed')) })
    await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
      workspaceAllocations: [{ lifecycle: preservationFails ? 'reserved' : 'preserved' }],
    })
    expect(mounted.calls).toContain('abandon')
  })

  it.each([false, true])('handles task inbox admission failure with workspace consumption=%s', async (consumeWorkspace) => {
    const mounted = await liveWorkspaceFixture(consumeWorkspace)
    vi.spyOn(mounted.receiver.agent, 'followup').mockImplementation(() => { throw new Error('task inbox admission failed') })
    const warning = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => undefined)
    await assignTask(mounted.ctx, mounted.input, mounted.binding)
    await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith(expect.stringContaining('task inbox admission failed')) })
    if (consumeWorkspace) await vi.waitFor(() => { expect(mounted.calls).toContain('release') })
    else expect(mounted.calls).toEqual([])
    expect(mounted.receiver.agent.inbox.hasPending).toBe(false)
  })

  it('fails workspace settlement explicitly when its durable allocation is absent from the provider snapshot', async () => {
    const mounted = await workspaceRecoveryFixture()
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      await mounted.receiver.agent.whenIdle()
      const getTeam = mounted.ctx.teams.getTeam.bind(mounted.ctx.teams)
      vi.spyOn(mounted.ctx.teams, 'getTeam').mockImplementationOnce(async request => ({ ...await getTeam(request), workspaceAllocations: [] }))
      await expect(settleAgentWorkspaceLease(mounted.receiver.agent)).rejects.toSatisfy((error: unknown) =>
        error instanceof AggregateError && error.errors.some((cause: unknown) => cause instanceof Error && cause.message.includes('no longer durable')),
      )
    } finally { await mounted.delivery.close() }
  })

  it('reports a retired Team runtime when workspace settlement still owns a provider allocation', async () => {
    const mounted = await workspaceRecoveryFixture()
    mounted.delivery.start()
    await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
    await mounted.receiver.agent.whenIdle()
    await hubFibers.get(mounted.ctx)!.dispose()
    await expect(settleAgentWorkspaceLease(mounted.receiver.agent)).rejects.toSatisfy((error: unknown) =>
      error instanceof AggregateError && error.errors.some((cause: unknown) => cause instanceof Error && cause.message.includes('requires local Team authority')),
    )
    await expect(mounted.delivery.close()).rejects.toThrow('Team Agent Client disposal failed')
  })

  it('reports a retired workspace registry when a physical release needs reconciliation', async () => {
    const mounted = await workspaceRecoveryFixture(async () => { await workspaceFibers.get(mounted.ctx)!.dispose() })
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      await mounted.receiver.agent.whenIdle()
      vi.spyOn(mounted.ctx.teams, 'confirmWorkspaceAllocationRelease').mockRejectedValueOnce(new Error('confirmation append failed'))
      await expect(settleAgentWorkspaceLease(mounted.receiver.agent)).rejects.toSatisfy((error: unknown) =>
        error instanceof AggregateError && error.errors[0] instanceof AggregateError
          && error.errors[0].errors.some((cause: unknown) => cause instanceof Error && cause.message.includes('workspace registry is unavailable')),
      )
    } finally { await mounted.delivery.close() }
  })


  it('reuses a concurrent durable activation observed after provider restoration', async () => {
    const mounted = await workspaceRecoveryFixture()
    const restore = mounted.ctx.teamWorkspaces.restore.bind(mounted.ctx.teamWorkspaces)
    const activation = vi.spyOn(mounted.ctx.teams, 'activateWorkspaceAllocation')
    vi.spyOn(mounted.ctx.teamWorkspaces, 'restore').mockImplementationOnce(async (...args) => {
      const allocation = await restore(...args)
      const input = { teamId: mounted.input.team.id,
        expectedCursor: (await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).team.cursor,
        allocationId: mounted.seeded.reserved.id, expectedRevision: mounted.seeded.reserved.revision }
      await withWorkspaceAllocationProof(mounted.ctx, { kind: 'workspace-allocation-activate', ...input },
        async actor => await mounted.ctx.teams.activateWorkspaceAllocation({ actor, ...input }))
      return allocation
    })
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      expect(activation).toHaveBeenCalledTimes(1)
    } finally { await mounted.delivery.close() }
  })

  it('awaits an accepted release operation even after another owner preserves its resource', async () => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release)
    const entered = Promise.withResolvers<undefined>()
    const read = Promise.withResolvers<Awaited<ReturnType<Context['teams']['getTeam']>>>()
    try {
      mounted.delivery.start()
      await vi.waitFor(() => { expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client') })
      await mounted.receiver.agent.whenIdle()
      const getTeam = mounted.ctx.teams.getTeam.bind(mounted.ctx.teams)
      const state = await getTeam({ teamId: mounted.input.team.id })
      vi.spyOn(mounted.ctx.teams, 'getTeam').mockImplementationOnce(async () => { entered.resolve(undefined); return await read.promise })
      const first = settleAgentWorkspaceLease(mounted.receiver.agent)
      await entered.promise
      const preserve = { teamId: mounted.input.team.id, expectedCursor: state.team.cursor,
        allocationId: state.workspaceAllocations[0]!.id, expectedRevision: state.workspaceAllocations[0]!.revision,
        reason: { code: 'OWNER_PRESERVED_RESOURCE', message: 'Another owner retained this resource.' } }
      await withWorkspaceAllocationProof(mounted.ctx, { kind: 'workspace-allocation-preserve', ...preserve },
        async actor => await mounted.ctx.teams.preserveWorkspaceAllocation({ actor, ...preserve }))
      let settled = false
      const second = settleAgentWorkspaceLease(mounted.receiver.agent).then(() => { settled = true })
      await new Promise<void>(resolve => setImmediate(resolve))
      const settledBeforeProviderRead = settled
      read.resolve(await getTeam({ teamId: mounted.input.team.id }))
      await Promise.all([first, second])
      expect(settledBeforeProviderRead).toBe(false)
      expect(release).not.toHaveBeenCalled()
      mounted.delivery.releaseTaskAllocation(mounted.seeded.reserved.taskId, mounted.seeded.reserved.attemptId)
    } finally {
      read.resolve(await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id }))
      await mounted.delivery.close()
    }
  })

  it('retains another live allocation when one shared task settles and ignores other Teams allocations', async () => {
    const mounted = await workspaceRecoveryFixture()
    const second = await reserveAssignedWorkspace(mounted.ctx, mounted.input, mounted.binding, ':second')
    try {
      mounted.delivery.start()
      await vi.waitFor(async () => {
        const state = await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })
        expect(state.workspaceAllocations.map(allocation => allocation.lifecycle)).toEqual(['active', 'active'])
      })
      await expectReceipt(mounted.ctx, mounted.seeded.assignment.envelope, mounted.input.recipient.id)
      await expectReceipt(mounted.ctx, second.assignment.envelope, mounted.input.recipient.id)
      await mounted.receiver.agent.whenIdle()
      const first = await mounted.ctx.teams.getTask({ teamId: mounted.input.team.id, taskId: mounted.seeded.reserved.taskId })
      await mounted.ctx.teams.settleTaskAttempt({ actor: await activeActor(mounted.ctx, mounted.input.team.id, mounted.input.recipient),
        taskId: first.id, attemptId: first.lease!.attemptId, expectedRevision: first.revision,
        outcome: { kind: 'completed', result: { summary: 'First shared task completed.' } } })
      mounted.delivery.releaseTaskAllocation(first.id, first.lease!.attemptId)
      await vi.waitFor(async () => {
        const state = await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })
        expect(state.workspaceAllocations.map(allocation => allocation.lifecycle)).toEqual(['released', 'active'])
      })
      expect(resolveAgentWorkspaceRoot(mounted.receiver.agent)).toBe('/workspace/agent-client')
      const other = await directChannel(mounted.ctx)
      const otherReceiver = await mounted.ctx.agents.create({ sessionId: SessionId('other-team-workspace-recipient'),
        meta: { teamId: other.team.id, participantId: other.recipient.id }, agentOptions: { provider: 'mock', model: 'mock' } })
      const otherBinding = await bindRecipient(mounted.ctx, other, otherReceiver.agent.session.id, 'other-team-activation')
      await reserveAssignedWorkspace(mounted.ctx, other, otherBinding)
      expect(mounted.delivery.workspaceUsageProvenance()).toEqual({ taskId: second.reserved.taskId, attemptId: second.reserved.attemptId })
    } finally { await mounted.delivery.close() }
  })


  it.each(['restore', 'activation'] as const)('releases a recovery handle that returns from %s after close begins', async (stage) => {
    const release = vi.fn(async () => {})
    const mounted = await workspaceRecoveryFixture(release, true, 1_000)
    const entered = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    if (stage === 'restore') {
      const restore = mounted.ctx.teamWorkspaces.restore.bind(mounted.ctx.teamWorkspaces)
      vi.spyOn(mounted.ctx.teamWorkspaces, 'restore').mockImplementationOnce(async (...args) => {
        const result = await restore(...args)
        entered.resolve(undefined)
        await gate.promise
        return result
      })
    } else {
      const activate = mounted.ctx.teams.activateWorkspaceAllocation.bind(mounted.ctx.teams)
      vi.spyOn(mounted.ctx.teams, 'activateWorkspaceAllocation').mockImplementationOnce(async (request) => {
        const result = await activate(request)
        entered.resolve(undefined)
        await gate.promise
        return result
      })
    }
    try {
      mounted.delivery.start()
      await entered.promise
      const closing = mounted.delivery.close()
      const completion = Promise.allSettled([closing])
      gate.resolve(undefined)
      await expect(completion).resolves.toMatchObject([{ status: 'fulfilled' }])
      expect(release).toHaveBeenCalledTimes(1)
      await expect(mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })).resolves.toMatchObject({
        workspaceAllocations: [{ lifecycle: 'released' }],
      })
    } finally { gate.resolve(undefined); await mounted.delivery.close() }
  })

  it.each(['prepare', 'reserve', 'materialize', 'activation'] as const)('settles task setup returning from %s after its fixed owner closes', async (stage) => {
    const mounted = await liveWorkspaceFixture(true, true)
    const delivery = mounted.delivery!
    const entered = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    if (stage === 'prepare') {
      const prepare = mounted.ctx.teamWorkspaces.prepare.bind(mounted.ctx.teamWorkspaces)
      vi.spyOn(mounted.ctx.teamWorkspaces, 'prepare').mockImplementationOnce(async (...args) => {
        const result = await prepare(...args)
        entered.resolve(undefined)
        await gate.promise
        return result
      })
    } else if (stage === 'reserve') {
      const reserve = mounted.ctx.teams.reserveWorkspaceAllocation.bind(mounted.ctx.teams)
      vi.spyOn(mounted.ctx.teams, 'reserveWorkspaceAllocation').mockImplementationOnce(async (request) => {
        const result = await reserve(request)
        entered.resolve(undefined)
        await gate.promise
        return result
      })
    } else if (stage === 'materialize') {
      const materialize = mounted.ctx.teamWorkspaces.materialize.bind(mounted.ctx.teamWorkspaces)
      vi.spyOn(mounted.ctx.teamWorkspaces, 'materialize').mockImplementationOnce(async (...args) => {
        const result = await materialize(...args)
        entered.resolve(undefined)
        await gate.promise
        return result
      })
    } else {
      const activate = mounted.ctx.teams.activateWorkspaceAllocation.bind(mounted.ctx.teams)
      vi.spyOn(mounted.ctx.teams, 'activateWorkspaceAllocation').mockImplementationOnce(async (request) => {
        const result = await activate(request)
        entered.resolve(undefined)
        await gate.promise
        return result
      })
    }
    try {
      await assignTask(mounted.ctx, mounted.input, mounted.binding)
      await entered.promise
      const closing = delivery.close()
      const completion = Promise.allSettled([closing])
      gate.resolve(undefined)
      await expect(completion).resolves.toMatchObject([{ status: 'fulfilled' }])
      expect(mounted.calls).toContain(stage === 'prepare' || stage === 'reserve' ? 'abandon' : 'release')
      expect(mounted.receiver.agent.inbox.hasPending).toBe(false)
      const state = await mounted.ctx.teams.getTeam({ teamId: mounted.input.team.id })
      expect(state.workspaceAllocations.map(allocation => allocation.lifecycle)).toEqual(stage === 'prepare' ? [] : ['released'])
    } finally { gate.resolve(undefined); await delivery.close() }
  })

})
