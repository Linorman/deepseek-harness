import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import { CallId } from '@clocky/clocky-llm'
import type { UserMessage } from '@clocky/clocky-llm'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import SystemPrompt from '@clocky/clocky-system-prompt'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import * as TeamAssignmentChannel from '@clocky/clocky-team-channel-task-assignment'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import TeamHub from '@clocky/clocky-team-hub'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import type { TeamWorkspaceProvider } from '@clocky/clocky-team-workspace'
import { activationIdSchema, teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  TeamSystemActivationProof,
  TeamSystemActivationScope,
  TeamSystemEnvelopePostProof,
  TeamSystemEnvelopePostScope,
  TeamSystemTaskLeaseProof,
  TeamSystemTaskLeaseScope,
  TeamTaskAssignInput,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import ToolRuntime from '@clocky/clocky-tools'
import * as ToolTeam from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
const signal = new AbortController().signal
const TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_SCHEDULER_TASK_LEASE_PROOF_SOURCE = 'team-scheduler-dag'
const TEAM_ACTIVATION_CONTROLLER_PROOF_SOURCE = 'team-activation-controller'
const activationProofStores = new WeakMap<Context, WeakMap<TeamSystemActivationProof, ControllerActivationScope>>()
const envelopePostProofStores = new WeakMap<Context, WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>>()

type ControllerActivationScope =
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-bind' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-status' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-fence' }>
  | Extract<TeamSystemActivationScope, { readonly kind: 'activation-controller-quiesce' }>

type SchedulerTaskAssignScope = Extract<TeamSystemTaskLeaseScope, { readonly kind: 'scheduler-task-assign' }>

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of contexts) {
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
  if (failures.length > 0) throw new AggregateError(failures, 'tool-team composition cleanup failed')
})

/** Compose the real local Team persistence, Link, delivery client, and scoped reporting tool. */
async function setup(): Promise<Context> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'tool-team-composition-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(DirectChannel)
  await ctx.plugin(TeamAssignmentChannel)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(TeamWorkspaceRegistry)
  ctx.teamWorkspaces.registerProvider(integrationProvider())
  await ctx.plugin(TeamLinkLocal, {
    providerName: 'local', pageSize: 16, disposalTimeoutMs: 100, notificationRetryDelayMs: 1,
  })
  await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 100 })
  await ctx.plugin(ToolTeam)
  return ctx
}

/** Register a provider-backed source integration route for the real Team tool composition. */
function integrationProvider(): TeamWorkspaceProvider {
  return {
    name: 'fixture-integration',
    modes: ['shared'],
    async eligible() { return true },
    async prepare() { throw new Error('fixture integration provider does not allocate a workspace') },
    async restore() { throw new Error('fixture integration provider does not restore a workspace') },
    async reconcileRelease() { throw new Error('fixture integration provider does not release a workspace') },
    async integrateSource(request) {
      const artifact = request.source.artifacts.find(candidate => candidate.kind === 'patch')
      return {
        teamId: request.source.teamId,
        sourceTaskId: request.source.taskId,
        sourceAttemptId: request.source.attemptId,
        integrationTaskId: request.integrationTaskId,
        integrationAttemptId: request.integrationAttemptId,
        target: request.target,
        status: 'integrated' as const,
        targetVersion: 'fixture-integrated-version',
        ...artifact === undefined ? {} : { artifact },
      }
    },
  }
}

/** Issue one nonserializable controller proof only for its exact test lifecycle operation. */
async function withActivationProof<T>(
  ctx: Context,
  scope: ControllerActivationScope,
  operation: (actor: TeamSystemActivationProof) => Promise<T>,
): Promise<T> {
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
  proofs.set(actor, scope)
  try {
    return await operation(actor)
  } finally {
    proofs.delete(actor)
  }
}

/** Assign one fixture lease through an exact one-shot scheduler authority. */
async function assignSchedulerTask(
  ctx: Context,
  input: TeamTaskAssignInput,
): Promise<TeamTaskSnapshot> {
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

/** Move one local-agent participant to the active durable membership state. */
async function activeParticipant(
  ctx: Context,
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  role = 'worker',
  displayName = 'Worker',
) {
  let state = await ctx.teams.getTeam({ teamId })
  const participant = await inviteBootstrapParticipant(ctx, {
    teamId, expectedCursor: state.team.cursor, kind: 'local-agent', displayName, role, capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId, participantId: participant.id, expectedCursor: state.team.cursor, phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId, participantId: participant.id, expectedCursor: state.team.cursor, phase: 'active',
  })
}

/** Register a live Agent whose follow-up durably admits the source in a small test driver. */
function taskAgent(ctx: Context, teamId: string, participantId: string): Agent {
  const session = ctx.sessions.create(SessionId('tool-team-composition-session'), { meta: { teamId, participantId } })
  const agent = {} as Agent
  const agentCtx = ctx.extend({ agent })
  let turn = 0
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: agentCtx,
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    send: () => {},
    followup(message: UserMessage) {
      agent.inbox.append('next-turn', message)
      turn += 1
      session.append('turn/start', { turn })
      session.append('user/message', message, { surfaceOp: 'append' })
    },
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  ctx.agents.register(agent)
  return agent
}

/** Issue one test-only opaque scheduler proof for its exact durable post scope. */
function schedulerPostActor(ctx: Context, scope: TeamSystemEnvelopePostScope): TeamSystemEnvelopePostProof {
  let proofs = envelopePostProofStores.get(ctx)
  if (proofs === undefined) {
    proofs = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
    ctx.teams.registerSystemEnvelopePostProofSource({
      name: TEAM_SCHEDULER_ENVELOPE_POST_PROOF_SOURCE,
      resolveEnvelopePostProof: proof => proofs?.get(proof),
    })
    envelopePostProofStores.set(ctx, proofs)
  }
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('scheduler post proofs are runtime-only') },
  })
  const opaque = Object.freeze(proof) as TeamSystemEnvelopePostProof
  proofs.set(opaque, scope)
  return opaque
}

describe('tool-team real local Team composition', () => {
  it('delivers a task assignment through the real local client, then reports the exact running attempt through a bound Link', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Report one delivered task.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id)
    const agent = taskAgent(ctx, created.team.id, worker.id)
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const bindingInput: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse('activation-tool-team-composition'),
        teamId: created.team.id,
        participantId: worker.id,
        status: 'running',
      },
      sessionId: agent.session.id,
      provider: 'in-process',
    }
    const binding = await withActivationProof(ctx, {
      kind: 'activation-controller-bind',
      expectedCursor: state.team.cursor,
      binding: bindingInput,
    }, async actor => await ctx.teams.bindActivation({
      actor,
      expectedCursor: state.team.cursor,
      binding: bindingInput,
    }))
    const coordinator = await activeParticipant(ctx, created.team.id, 'coordinator', 'Coordinator')
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const coordinatorBindingInput: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse('activation-tool-team-composition-coordinator'),
        teamId: created.team.id,
        participantId: coordinator.id,
        status: 'idle',
      },
      sessionId: SessionId('tool-team-composition-coordinator-session'),
      provider: 'in-process',
    }
    const coordinatorBinding = await withActivationProof(ctx, {
      kind: 'activation-controller-bind',
      expectedCursor: state.team.cursor,
      binding: coordinatorBindingInput,
    }, async actor => await ctx.teams.bindActivation({
      actor,
      expectedCursor: state.team.cursor,
      binding: coordinatorBindingInput,
    }))
    const coordinatorActor = ctx.teams.openActivationActorProofIssuer().issue(coordinatorBinding).proof
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const task = await ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('tool-team-composition-task') },
      subject: 'Report this delivery.',
      description: 'Use team_task_report after the exact assignment enters the Session.',
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
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: TeamAssignmentChannel.TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: worker.id, role: TeamAssignmentChannel.TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
      limits: { taskId: task.id, activationId: binding.activation.id, sessionId: binding.sessionId },
    })
    await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
    const assigned = await assignSchedulerTask(ctx, {
      teamId: created.team.id,
      taskId: task.id,
      expectedRevision: task.revision,
      participantId: worker.id,
      activationId: binding.activation.id,
      wakeChannelId: channel.manifest.id,
      leaseDurationMs: 1_000,
    })
    const lease = assigned.lease
    if (lease === undefined) throw new Error('assignment did not retain a lease')
    const currentChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
    await ctx.teams.postChannelEnvelope({
      actor: schedulerPostActor(ctx, {
        kind: 'scheduler-assignment',
        teamId: created.team.id,
        channelId: channel.manifest.id,
        taskId: task.id,
        attemptId: lease.attemptId,
        assignedRevision: lease.assignedRevision,
        assigneeId: worker.id,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
      }),
      expectedCursor: currentChannel.cursor,
      draft: {
        channelId: channel.manifest.id,
        audience: [worker.id],
        kind: TeamAssignmentChannel.TASK_ASSIGNMENT_ENVELOPE_KIND,
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

    await vi.waitFor(async () => {
      const running = await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })
      expect(running.phase).toBe('running')
      expect(agent.session.events.some(event => event.type === 'user/message'
        && event.data.source.kind === 'team-task-assignment')).toBe(true)
    })

    const result = await ctx.agents.withInitiator(agent, async () => await ctx.tools.execute({
      signal,
      callId: CallId('tool-team-composition-call'),
      name: 'team_task_report',
      arguments: {
        task_id: task.id,
        attempt_id: lease.attemptId,
        outcome: 'completed',
        summary: 'The real local assignment was reported.',
        artifacts: [{
          id: 'fixture-source-patch',
          kind: 'patch',
          uri: 'artifact://fixture-source-patch',
          sourceAttemptId: lease.attemptId,
          visibility: 'team',
        }],
      },
      agent,
    }))
    expect(result.isError).toBe(false)
    const completed = await ctx.teams.getTask({ teamId: created.team.id, taskId: task.id })
    expect(completed).toMatchObject({
      phase: 'completed',
      attemptHistory: [{ id: lease.attemptId, outcome: { kind: 'completed', result: { summary: 'The real local assignment was reported.' } } }],
    })

    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const integrationTask = await ctx.teams.createTask({
      actor: coordinatorActor,
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('tool-team-composition-integration-task') },
      subject: 'Integrate the reported patch.',
      description: 'Run the provider-backed integration operation and retain its target version.',
      integration: {
        sourceTaskId: task.id,
        sourceAttemptId: lease.attemptId,
        provider: 'fixture-integration',
        target: 'main',
        expectedTarget: 'base-commit',
        mode: 'integrate',
      },
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
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const integrationChannel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: TeamAssignmentChannel.TASK_ASSIGNMENT_CHANNEL_ADAPTER,
      participants: [{ id: worker.id, role: TeamAssignmentChannel.TASK_ASSIGNMENT_ASSIGNEE_ROLE }],
      limits: { taskId: integrationTask.id, activationId: binding.activation.id, sessionId: binding.sessionId },
    })
    await acknowledgeTestChannelActivations(ctx, integrationChannel.manifest.id)
    const assignedIntegration = await assignSchedulerTask(ctx, {
      teamId: created.team.id,
      taskId: integrationTask.id,
      expectedRevision: integrationTask.revision,
      participantId: worker.id,
      activationId: binding.activation.id,
      wakeChannelId: integrationChannel.manifest.id,
      leaseDurationMs: 1_000,
    })
    if (assignedIntegration.lease === undefined) throw new Error('integration assignment did not retain a lease')
    const integrationChannelState = await ctx.teams.getChannel({ channelId: integrationChannel.manifest.id })
    await ctx.teams.postChannelEnvelope({
      actor: schedulerPostActor(ctx, {
        kind: 'scheduler-assignment',
        teamId: created.team.id,
        channelId: integrationChannel.manifest.id,
        taskId: integrationTask.id,
        attemptId: assignedIntegration.lease.attemptId,
        assignedRevision: assignedIntegration.lease.assignedRevision,
        assigneeId: worker.id,
        activationId: binding.activation.id,
        sessionId: binding.sessionId,
      }),
      expectedCursor: integrationChannelState.cursor,
      draft: {
        channelId: integrationChannel.manifest.id,
        audience: [worker.id],
        kind: TeamAssignmentChannel.TASK_ASSIGNMENT_ENVELOPE_KIND,
        payload: {
          taskId: integrationTask.id,
          attemptId: assignedIntegration.lease.attemptId,
          assignedRevision: assignedIntegration.lease.assignedRevision,
          activationId: binding.activation.id,
          sessionId: binding.sessionId,
        },
        delivery: 'turn',
        taskId: integrationTask.id,
      },
    })
    await vi.waitFor(async () => {
      const runningIntegration = await ctx.teams.getTask({ teamId: created.team.id, taskId: integrationTask.id })
      expect(runningIntegration.phase).toBe('running')
    })
    const integratedResult = await ctx.agents.withInitiator(agent, async () => await ctx.tools.execute({
      signal,
      callId: CallId('tool-team-composition-integration-call'),
      name: 'team_task_integrate',
      arguments: {
        task_id: integrationTask.id,
        attempt_id: assignedIntegration.lease!.attemptId,
        verification: 'provider verification passed',
      },
      agent,
    }))
    expect(integratedResult.isError).toBe(false)
    const integratedTask = await ctx.teams.getTask({ teamId: created.team.id, taskId: integrationTask.id })
    expect(integratedTask).toMatchObject({
      phase: 'completed',
      attemptHistory: [{ outcome: { kind: 'completed', result: {
        integration: { status: 'integrated', targetVersion: 'fixture-integrated-version' },
        verification: 'provider verification passed',
      } } }],
    })
  })

  it('derives the direct v3 peer from the real channel and posts a final Envelope through the exact local activation binding', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, { goal: { objective: 'Send one final answer.', budgets: {} }, rules: {}, budgets: {} })
    const worker = await activeParticipant(ctx, created.team.id)
    const coordinator = await activeParticipant(ctx, created.team.id, 'coordinator', 'Coordinator')
    const agent = taskAgent(ctx, created.team.id, worker.id)
    let state = await ctx.teams.getTeam({ teamId: created.team.id })
    const bindingInput: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse('activation-team-final-composition'),
        teamId: created.team.id,
        participantId: worker.id,
        status: 'running',
      },
      sessionId: agent.session.id,
      provider: 'in-process',
    }
    const binding = await withActivationProof(ctx, {
      kind: 'activation-controller-bind',
      expectedCursor: state.team.cursor,
      binding: bindingInput,
    }, async actor => await ctx.teams.bindActivation({
      actor,
      expectedCursor: state.team.cursor,
      binding: bindingInput,
    }))
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const coordinatorBindingInput: ActivationBindingSnapshot = {
      activation: {
        id: activationIdSchema.parse('activation-team-final-composition-coordinator'),
        teamId: created.team.id,
        participantId: coordinator.id,
        status: 'idle',
      },
      sessionId: SessionId('team-final-composition-coordinator'),
      provider: 'in-process',
    }
    await withActivationProof(ctx, {
      kind: 'activation-controller-bind',
      expectedCursor: state.team.cursor,
      binding: coordinatorBindingInput,
    }, async actor => await ctx.teams.bindActivation({
      actor,
      expectedCursor: state.team.cursor,
      binding: coordinatorBindingInput,
    }))
    state = await ctx.teams.getTeam({ teamId: created.team.id })
    const channel = await openTestChannel(ctx, {
      teamId: created.team.id,
      expectedCursor: state.team.cursor,
      adapter: DirectChannel.DIRECT_CHANNEL_ADAPTER_V3,
      participants: [{ id: worker.id, role: 'worker' }, { id: coordinator.id, role: 'coordinator' }],
      limits: {},
    })
    await acknowledgeTestChannelActivations(ctx, channel.manifest.id)

    const result = await ctx.agents.withInitiator(agent, async () => await ctx.tools.execute({
      signal,
      callId: CallId('team-final-composition-call'),
      name: 'team_final',
      arguments: { channel_id: channel.manifest.id, text: 'The completed result is ready for review.' },
      agent,
    }))
    expect(result).toMatchObject({
      isError: false,
      value: { channel_id: channel.manifest.id },
    })
    if (result.isError || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)
      || typeof result.value.envelope_id !== 'string') {
      throw new Error('team_final did not return an accepted Envelope id')
    }
    const records = await ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
    const record = records.records.find(item => item.type === 'channel/envelope')
    if (record === undefined || record.type !== 'channel/envelope') throw new Error('team_final did not append an Envelope')
    expect(record.envelope).toMatchObject({
      teamId: created.team.id,
      senderId: worker.id,
      audience: [coordinator.id],
      kind: DirectChannel.DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
      payload: { text: 'The completed result is ready for review.' },
      delivery: 'turn',
    })
    expect(record.envelope.id).toBe(result.value.envelope_id)
    expect(binding.activation.id).toBe('activation-team-final-composition')
  })
})
