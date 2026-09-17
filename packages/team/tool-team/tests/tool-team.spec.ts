import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry, { emitAgentEvent, Inbox } from '@clocky/clocky-agent'
import type { Agent, AgentStatus } from '@clocky/clocky-agent'
import { MessageId } from '@clocky/clocky-llm'
import type { UserMessage } from '@clocky/clocky-llm'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import SystemPrompt from '@clocky/clocky-system-prompt'
import {
  activationBindingSnapshotSchema,
  channelIdSchema,
  channelPostIdempotencyKeySchema,
  channelSnapshotSchema,
  teamEnvelopeSchema,
  teamStateSnapshotSchema,
  teamTaskSnapshotSchema,
  teamWorkspaceAllocationSnapshotSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelSnapshot,
  TaskAttemptOutcome,
  TeamStateSnapshot,
  TeamEnvelope,
  TeamTaskSnapshot,
} from '@clocky/clocky-team'
import type {
  TeamLink,
  TeamLinkFinalResultRequest,
  TeamLinkTaskAttemptSettleRequest,
  TeamLinkTaskAttemptHeartbeatRequest,
  TeamLinkTaskIntegrationRequest,
} from '@clocky/clocky-team-link'
import ToolRuntime from '@clocky/clocky-tools'
import type { ToolExecutionResult } from '@clocky/clocky-tools'
import * as toolTeam from '../src/index.ts'

const signal = new AbortController().signal
const contexts = new Set<Context>()

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
  if (failures.length > 0) throw new AggregateError(failures, 'tool-team test cleanup failed')
})

interface Harness {
  readonly ctx: Context
  readonly toolFiber: Awaited<ReturnType<Context['plugin']>>
  readonly agent: Agent
  readonly binding: ActivationBindingSnapshot
  readonly link: TeamLink & {
    readonly post: ReturnType<typeof vi.fn>
    readonly postFinalResult: ReturnType<typeof vi.fn>
    readonly settle: ReturnType<typeof vi.fn>
    readonly integrate: ReturnType<typeof vi.fn>
    readonly heartbeat: ReturnType<typeof vi.fn>
    readonly resolveTaskReview: ReturnType<typeof vi.fn>
    readonly close: ReturnType<typeof vi.fn>
  }
  readonly teams: {
    readonly getTask: ReturnType<typeof vi.fn>
    readonly getActivation: ReturnType<typeof vi.fn>
    readonly getTeam: ReturnType<typeof vi.fn>
    readonly getChannel: ReturnType<typeof vi.fn>
  }
  readonly links: {
    readonly connect: ReturnType<typeof vi.fn>
    readonly getBoundLinkBorrower: ReturnType<typeof vi.fn>
  }
  readonly borrower: {
    withLink<T>(operation: (current: TeamLink) => Promise<T>): Promise<T>
  } | undefined
  readonly borrowCalls: ReturnType<typeof vi.fn>
  task: TeamTaskSnapshot
  team: TeamStateSnapshot
  channel: ChannelSnapshot
  appendAssignment(overrides?: Record<string, unknown>): void
  execute(args: Record<string, unknown>, agent?: Agent, name?: string, callId?: string, rootCallId?: string): Promise<ToolExecutionResult>
  executeFinal(args: Record<string, unknown>, agent?: Agent, callId?: string, rootCallId?: string): Promise<ToolExecutionResult>
  setStatus(status: AgentStatus): void
}

/** Build one mounted Tool runtime with a fake but identity-preserving Team/Link boundary. */
async function harness(options: {
  readonly teamHeader?: boolean
  readonly source?: boolean
  readonly task?: TeamTaskSnapshot
  readonly binding?: ActivationBindingSnapshot
  readonly team?: TeamStateSnapshot
  readonly channel?: ChannelSnapshot
  readonly mountAfterAgent?: boolean
  readonly linkProvider?: string
  readonly remote?: boolean
} = {}): Promise<Harness> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)

  const teamId = 'team-tool-team'
  const participantId = 'participant-tool-team'
  const sessionId = SessionId('session-tool-team')
  const binding = options.binding ?? activationBinding(teamId, participantId, sessionId)
  let task = options.task ?? runningTask(teamId, participantId, binding.activation.id)
  let channel = options.channel ?? finalChannel(teamId, participantId)
  let team = options.team ?? finalTeamState(teamId, binding, task, channel)
  const teams = {
    getTask: vi.fn(async () => task),
    getActivation: vi.fn(async () => binding),
    getTeam: vi.fn(async () => team),
    getChannel: vi.fn(async () => channel),
  }
  const link = fakeLink(
    binding,
    async (request) => {
      task = settledTask(task, request.outcome)
      return task
    },
    async request => finalEnvelope(binding, request),
    async () => channel,
  )
  const borrowCalls = vi.fn()
  const borrower = options.remote === true ? {
    async withLink<T>(operation: (current: TeamLink) => Promise<T>): Promise<T> {
      borrowCalls(operation)
      return await operation(link)
    },
  } : undefined
  const links = {
    connect: vi.fn(async () => link),
    getBoundLinkBorrower: vi.fn(() => borrower),
  }
  if (!options.remote) ctx.provide('teams', teams as never)
  ctx.provide('teamLinks', links as never)
  let toolFiber: Awaited<ReturnType<Context['plugin']>> | undefined
  if (!options.mountAfterAgent) {
    toolFiber = await ctx.plugin(toolTeam, {
      ...options.linkProvider === undefined ? {} : { linkProvider: options.linkProvider },
    })
  }

  const session = ctx.sessions.create(sessionId, options.teamHeader === false ? {} : {
    meta: { teamId, participantId },
  })
  let status: AgentStatus = 'running'
  const agent = {} as Agent
  const agentCtx = ctx.extend({ agent })
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status,
    ctx: agentCtx,
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  Object.defineProperty(agent, 'status', { get: () => status })
  ctx.agents.register(agent)
  toolFiber ??= await ctx.plugin(toolTeam, {
    ...options.linkProvider === undefined ? {} : { linkProvider: options.linkProvider },
  })

  const appendAssignment = (overrides: Record<string, unknown> = {}): void => {
    session.append('user/message', assignmentMessage({
      teamId,
      taskId: task.id,
      attemptId: task.lease?.attemptId ?? 'attempt-tool-team',
      assignedRevision: task.lease?.assignedRevision ?? 2,
      runningRevision: task.revision,
      activationId: binding.activation.id,
      ...overrides,
    }), { surfaceOp: 'append' })
  }
  if (options.source !== false) appendAssignment()

  return {
    ctx,
    toolFiber,
    agent,
    binding,
    link,
    teams,
    links,
    borrower,
    borrowCalls,
    get task() { return task },
    set task(value: TeamTaskSnapshot) { task = value },
    get team() { return team },
    set team(value: TeamStateSnapshot) { team = value },
    get channel() { return channel },
    set channel(value: ChannelSnapshot) { channel = value },
    appendAssignment,
    async execute(args, executionAgent = agent, toolName = 'team_task_report', callId = `call-tool-team-${Math.random()}`, rootCallId = callId) {
      return await ctx.agents.withInitiator(executionAgent, async () => await ctx.tools.execute({
        signal,
        callId: callId as never,
        rootCallId: rootCallId as never,
        name: toolName,
        arguments: args,
        agent: executionAgent,
      }))
    },
    async executeFinal(args, executionAgent = agent, callId = `call-team-final-${Math.random()}`, rootCallId = callId) {
      return await ctx.agents.withInitiator(executionAgent, async () => await ctx.tools.execute({
        signal,
        callId: callId as never,
        rootCallId: rootCallId as never,
        name: 'team_final',
        arguments: args,
        agent: executionAgent,
      }))
    },
    setStatus(value) { status = value },
  }
}

/** Create one exact live Team activation binding for a Session-backed task Agent. */
function activationBinding(teamId: string, participantId: string, sessionId: SessionId): ActivationBindingSnapshot {
  return activationBindingSnapshotSchema.parse({
    activation: {
      id: 'activation-tool-team', teamId, participantId, status: 'running',
    },
    sessionId,
    provider: 'in-process',
  })
}

/** Build the active two-party direct product channel that can carry a final answer. */
function finalChannel(
  teamId: string,
  participantId: string,
  overrides: Record<string, unknown> = {},
): ChannelSnapshot {
  return channelSnapshotSchema.parse({
    manifest: {
      id: 'channel-team-final',
      teamId,
      adapter: { type: 'direct', version: 3 },
      participants: [
        { id: participantId, role: 'worker' },
        { id: 'participant-team-final-recipient', role: 'coordinator' },
      ],
      limits: {},
    },
    phase: 'active',
    cursor: 2,
    ...overrides,
  })
}

/** Build the Team projection that derives one exact live activation from the calling Agent Session. */
function finalTeamState(
  teamId: string,
  binding: ActivationBindingSnapshot,
  task: TeamTaskSnapshot,
  channel: ChannelSnapshot,
  overrides: Record<string, unknown> = {},
): TeamStateSnapshot {
  const goal = { teamId, revision: 1, objective: 'Send one final answer.', phase: 'active' as const, budgets: {} }
  return teamStateSnapshotSchema.parse({
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 0,
      goal,
      phase: 'active',
      cursor: 1,
      createdAt: 0,
      updatedAt: 1,
    },
    goal,
    rules: {},
    budgets: {},
    participants: [
      { id: binding.activation.participantId, teamId, kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [], phase: 'active' },
      {
        id: 'participant-team-final-recipient',
        teamId,
        kind: 'human',
        displayName: 'Coordinator',
        role: 'coordinator',
        capabilities: [],
        phase: 'active',
        owner: { kind: 'product-principal', principalId: 'product-principal-tool-team' },
      },
    ],
    activations: [binding],
    tasks: [task],
    workspaceAllocations: [],
    channelIds: [channel.manifest.id],
    ...overrides,
  })
}

/** Build the immutable Hub result that the fake Link returns after one accepted final post. */
function finalEnvelope(binding: ActivationBindingSnapshot, request: TeamLinkFinalResultRequest): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-team-final',
    teamId: binding.activation.teamId,
    channelId: request.channelId,
    audience: ['participant-team-final-recipient'],
    kind: 'final',
    payload: { text: request.text },
    delivery: 'turn',
    sequence: 3,
    senderId: binding.activation.participantId,
    priority: 'normal',
    createdAt: 3,
  })
}

/** Build one accepted message Envelope for the activation-bound tool fixture. */
function acceptedMessageEnvelope(
  binding: ActivationBindingSnapshot,
  channelId: string,
  audience: readonly string[] | null,
  text: string,
  delivery: 'context' | 'turn' | 'steer',
): TeamEnvelope {
  return teamEnvelopeSchema.parse({
    id: 'envelope-team-message',
    teamId: binding.activation.teamId,
    channelId,
    audience,
    kind: 'message',
    payload: { text },
    delivery,
    sequence: 3,
    senderId: binding.activation.participantId,
    priority: 'normal',
    createdAt: 3,
  })
}

/** Build the current running lease used by a task Agent report. */
function runningTask(teamId: string, participantId: string, activationId: string): TeamTaskSnapshot {
  return teamTaskSnapshotSchema.parse({
    id: 'task-tool-team',
    teamId,
    revision: 3,
    createCommand: {
      creator: {
        teamId,
        participantId,
        activationId,
        sessionId: `session-tool-team-${participantId}`,
        provider: 'test',
      },
      idempotencyKey: 'task-create-tool-team',
    },
    subject: 'Report the task.',
    execution: { kind: 'participant' },
    description: 'Use team_task_report after this assigned task finishes.',
    phase: 'running',
    blockedBy: [],
    requiredCapabilities: [],
    priority: 0,
    readScopes: [],
    writeScopes: [],
    workspaceMode: 'shared',
    budget: {},
    reviewPolicy: { kind: 'none' },
    reviewHistory: [],
    maxAttempts: 2,
    attemptCount: 1,
    attemptHistory: [],
    lease: {
      attemptId: 'attempt-tool-team',
      assignedRevision: 2,
      ordinal: 1,
      participantId,
      activationId,
      wakeChannelId: 'channel-tool-team',
      assignedAt: 1,
      startedAt: 2,
      durationMs: 1_000,
      renewedAt: 1,
      expiresAt: 1_001,
    },
  })
}

/** Record one requested report under the same phase mapping as the authoritative Team Hub. */
function settledTask(task: TeamTaskSnapshot, outcome: TaskAttemptOutcome): TeamTaskSnapshot {
  const lease = task.lease
  if (lease === undefined) throw new Error('fixture task requires a current lease')
  const phase = outcome.kind === 'completed'
    ? task.reviewPolicy.kind === 'none' ? 'completed' : 'review'
    : outcome.kind === 'cancelled'
      ? 'cancelled'
      : task.attemptCount >= task.maxAttempts ? 'failed' : 'pending'
  const { lease: _lease, ...withoutLease } = task
  const settledAt = outcome.kind === 'lease-expired' ? lease.expiresAt : 3
  return teamTaskSnapshotSchema.parse({
    ...withoutLease,
    revision: task.revision + 1,
    phase,
    attemptHistory: [{
      id: lease.attemptId,
      teamId: task.teamId,
      taskId: task.id,
      ordinal: lease.ordinal,
      participantId: lease.participantId,
      activationId: lease.activationId,
      assignedAt: lease.assignedAt,
      startedAt: lease.startedAt,
      leaseExpiresAt: lease.expiresAt,
      settledAt,
      outcome,
    }],
  })
}

/** Build one short-lived Link whose settlement route stays directly observable. */
function fakeLink(
  binding: ActivationBindingSnapshot,
  settle: (request: TeamLinkTaskAttemptSettleRequest) => Promise<TeamTaskSnapshot>,
  postFinalResult: (request: TeamLinkFinalResultRequest) => Promise<TeamEnvelope>,
  getChannel: () => Promise<ChannelSnapshot>,
): Harness['link'] {
  const subject = {
    provider: 'local',
    binding,
    done: new Promise<void>(() => {}),
    onNotify: () => () => {},
    getChannel,
    onInvitation() { return () => {} },
    async acknowledgeChannelInvitation() { throw new Error('This fixture has no pending channel invitation') },
    onInterrupt: () => () => {},
    onTaskCancellation: () => () => {},
    acknowledgeTaskCancellation: async () => { throw new Error('not used') },
    post: vi.fn(async () => { throw new Error('not used') }),
    postFinalResult: vi.fn(postFinalResult),
    claim: async () => undefined,
    claimTaskAttemptStart: async () => { throw new Error('not used') },
    settle: vi.fn(settle),
    settleTaskAttempt(request: TeamLinkTaskAttemptSettleRequest) { return subject.settle(request) },
    integrate: vi.fn(async (_request: TeamLinkTaskIntegrationRequest) => { throw new Error('not used') }),
    integrateTask(request: TeamLinkTaskIntegrationRequest) { return subject.integrate(request) },
    heartbeat: vi.fn(async (_request: TeamLinkTaskAttemptHeartbeatRequest) => runningTask(
      binding.activation.teamId,
      binding.activation.participantId,
      binding.activation.id,
    )),
    heartbeatTaskAttempt(request: TeamLinkTaskAttemptHeartbeatRequest) { return subject.heartbeat(request) },
    resolveTaskReview: vi.fn(async () => { throw new Error('not used') }),
    acknowledge: async () => { throw new Error('not used') },
    acknowledgeInterrupt: async () => { throw new Error('not used') },
    close: vi.fn(async () => {}),
  }
  return subject
}

/** Build the durable source that `team-agent-client` persists before a task Agent's model turn. */
function assignmentMessage(input: {
  readonly teamId: string
  readonly taskId: string
  readonly attemptId: string
  readonly assignedRevision: number
  readonly runningRevision: number
  readonly activationId: string
  readonly channelId?: string
  readonly envelopeId?: string
}): UserMessage {
  return {
    id: MessageId(`team-task-assignment:${input.envelopeId ?? 'envelope-tool-team'}`),
    role: 'user',
    content: [{ type: 'text', text: 'Team task assignment.' }],
    source: {
      kind: 'team-task-assignment',
      teamId: input.teamId,
      channelId: input.channelId ?? 'channel-tool-team',
      envelopeId: input.envelopeId ?? 'envelope-tool-team',
      taskId: input.taskId,
      attemptId: input.attemptId,
      assignedRevision: input.assignedRevision,
      runningRevision: input.runningRevision,
      activationId: input.activationId,
    },
  } as unknown as UserMessage
}

/** Read a successful tool value without relying on its rendered JSON. */
function value(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected a successful task report')
  if (typeof result.value !== 'object' || result.value === null) throw new Error('expected an object tool value')
  return result.value as Record<string, unknown>
}

/** Resolve one exact agent-scoped definition for direct defensive execution tests. */
function definition(harnessed: Harness, name = 'team_task_report') {
  const tool = harnessed.ctx.tools.get(name, harnessed.agent)
  if (tool === undefined) throw new Error(`expected scoped ${name} tool`)
  return tool
}

/** Execute the registered body directly when the Tool executor rejects its carrier first. */
async function directExecute(
  harnessed: Harness,
  args: Record<string, unknown>,
  agent?: Agent,
  name = 'team_task_report',
): Promise<unknown> {
  return await definition(harnessed, name).execute(args, { agent } as never)
}

describe('team_task_report', () => {
  it('scopes the model tool to Team-bound Agents, reports a completed attempt through an authenticated Link, and disposes it', async () => {
    const harnessed = await harness()
    expect(harnessed.ctx.tools.get('team_task_report', harnessed.agent)?.name).toBe('team_task_report')
    emitAgentEvent(harnessed.ctx, harnessed.agent, 'agent/created', {})
    const result = await harnessed.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'Implemented the report flow.',
    })
    expect(value(result)).toEqual({
      task: { id: 'task-tool-team', revision: 4, phase: 'completed' },
      attempt: { id: 'attempt-tool-team', outcome: { kind: 'completed', result: { summary: 'Implemented the report flow.' } } },
      status: 'settled',
    })
    expect(harnessed.links.connect).toHaveBeenCalledWith({ provider: 'local', binding: harnessed.binding })
    expect(harnessed.link.settle).toHaveBeenCalledWith({
      taskId: 'task-tool-team', attemptId: 'attempt-tool-team', expectedRevision: 3,
      outcome: { kind: 'completed', result: { summary: 'Implemented the report flow.' } },
    })
    expect(harnessed.link.close).toHaveBeenCalledTimes(1)
    expect(definition(harnessed, 'team_task_integrate').presentCall?.({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team' })).toEqual({
      card: 'generic', title: 'Integrate Team task', kind: 'other', rawInput: 'task-tool-team',
    })
    expect(definition(harnessed, 'team_task_heartbeat').presentCall?.({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team' })).toEqual({
      card: 'generic', title: 'Renew Team task lease', kind: 'other', rawInput: 'task-tool-team',
    })
    expect(definition(harnessed, 'team_task_review').presentCall?.({ task_id: 'task-tool-team', decision: 'accepted', reason: 'reason' })).toEqual({
      card: 'generic', title: 'Review Team task', kind: 'other', rawInput: 'task-tool-team',
    })
    expect(definition(harnessed, 'team_message').presentCall?.({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' })).toEqual({
      card: 'generic', title: 'Send Team message', kind: 'other', rawInput: 'channel-team-final',
    })
    await harnessed.toolFiber.dispose()
    expect(harnessed.ctx.tools.get('team_task_report', harnessed.agent)).toBeUndefined()
  })

  it('uses the remote Agent delivery owner\'s existing Link without local Team authority or a second connection', async () => {
    const harnessed = await harness({ remote: true })
    const result = await harnessed.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'Reported over the fixed remote Link.',
    })
    expect(value(result)).toMatchObject({ task: { phase: 'completed' }, status: 'settled' })
    expect(harnessed.borrower).toBeDefined()
    expect(harnessed.borrowCalls).toHaveBeenCalledTimes(1)
    expect(harnessed.links.connect).not.toHaveBeenCalled()
    expect(harnessed.link.settle).toHaveBeenCalledWith({
      taskId: 'task-tool-team',
      attemptId: 'attempt-tool-team',
      expectedRevision: 3,
      outcome: { kind: 'completed', result: { summary: 'Reported over the fixed remote Link.' } },
    })
    expect(harnessed.link.close).not.toHaveBeenCalled()
    expect(harnessed.ctx.tools.get('team_final', harnessed.agent)?.name).toBe('team_final')
  })

  it('fails closed when a remote report loses its borrowed Link, binding, or durable settlement response', async () => {
    const unavailable = await harness({ remote: true })
    unavailable.links.getBoundLinkBorrower.mockReturnValue(undefined)
    const unavailableResult = await unavailable.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released',
    })
    expect(unavailableResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const mismatched = await harness({ remote: true })
    Object.assign(mismatched.link.binding.activation, { id: 'activation-other' })
    const mismatchedResult = await mismatched.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released',
    })
    expect(mismatchedResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const invalid = await harness({ remote: true })
    invalid.link.settle.mockResolvedValueOnce(undefined)
    const invalidResult = await invalid.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released',
    })
    expect(invalidResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  })

  it.each([false, true])('executes a durable integration task through the %s Link path', async (remote) => {
    const running = teamTaskSnapshotSchema.parse({
      ...runningTask('team-tool-team', 'participant-tool-team', 'activation-tool-team'),
      integration: {
        sourceTaskId: 'source-task',
        sourceAttemptId: 'source-attempt',
        provider: 'worktree',
        target: 'main',
        expectedTarget: 'base-commit',
        mode: 'integrate',
      },
    })
    const harnessed = await harness({ task: running, remote })
    const integrated = settledTask(running, {
      kind: 'completed',
      result: {
        summary: 'Integrated the source patch.',
        verification: 'integration tests passed',
        integration: {
          target: 'main',
          expectedTarget: 'base-commit',
          status: 'integrated',
          targetVersion: 'merged-commit',
        },
      },
    })
    harnessed.link.integrate.mockResolvedValueOnce(integrated)

    const result = await harnessed.execute({
      task_id: running.id,
      attempt_id: running.lease!.attemptId,
      verification: 'integration tests passed',
    }, harnessed.agent, 'team_task_integrate')
    expect(value(result)).toMatchObject({
      task: { id: running.id, phase: 'completed' },
      attempt: {
        id: running.lease!.attemptId,
        outcome: { kind: 'completed', result: {
          summary: 'Integrated the source patch.',
          verification: 'integration tests passed',
          integration: { target: 'main', status: 'integrated', targetVersion: 'merged-commit' },
        } },
      },
      status: 'settled',
    })
    expect(harnessed.link.integrate).toHaveBeenCalledWith({
      taskId: running.id,
      attemptId: running.lease!.attemptId,
      expectedRevision: running.revision,
      verification: 'integration tests passed',
    })
    if (remote) expect(harnessed.borrowCalls).toHaveBeenCalledOnce()
    else expect(harnessed.links.connect).toHaveBeenCalledOnce()
  })

  it('validates integration provenance, replays committed results, and preserves the full provider result vocabulary', async () => {
    const running = teamTaskSnapshotSchema.parse({
      ...runningTask('team-tool-team', 'participant-tool-team', 'activation-tool-team'),
      integration: {
        sourceTaskId: 'source-task', sourceAttemptId: 'source-attempt', provider: 'worktree', target: 'main',
        expectedTarget: 'base-commit', mode: 'integrate',
      },
    })
    const fullResult = {
      kind: 'completed' as const,
      result: {
        summary: 'Integrated with retained artifacts.',
        verification: 'integration tests passed',
        integration: {
          target: 'main', expectedTarget: 'base-commit', status: 'integrated' as const, targetVersion: 'merged-commit',
          proposalArtifact: { id: 'artifact-proposal', provider: 'local', kind: 'patch' as const, uri: 'artifact://proposal', contentHash: 'hash-proposal', sourceAttemptId: running.lease!.attemptId, visibility: 'team' as const },
          verification: 'provider verification passed',
          artifacts: [{ id: 'artifact-final', provider: 'local', kind: 'report' as const, uri: 'artifact://final', contentHash: 'hash-final', sourceAttemptId: running.lease!.attemptId, visibility: 'human' as const }],
        },
      },
    }
    const accepted = settledTask(running, fullResult)
    const successful = await harness({ task: running })
    successful.link.integrate.mockResolvedValueOnce(accepted)
    const success = await successful.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, successful.agent, 'team_task_integrate')
    expect(value(success)).toMatchObject({
      status: 'settled',
      attempt: { outcome: { result: {
        integration: {
          target: 'main', expectedTarget: 'base-commit', status: 'integrated', targetVersion: 'merged-commit',
          proposalArtifact: { id: 'artifact-proposal', kind: 'patch', uri: 'artifact://proposal', contentHash: 'hash-proposal', sourceAttemptId: 'attempt-tool-team', visibility: 'team' },
          verification: 'provider verification passed',
          artifacts: [{ id: 'artifact-final', kind: 'report', uri: 'artifact://final', contentHash: 'hash-final', sourceAttemptId: 'attempt-tool-team', visibility: 'human' }],
        },
      } } },
    })

    const conflict = await harness({ task: running, remote: true })
    const conflicted = settledTask(running, {
      kind: 'completed', result: {
        summary: 'Integration needs review.',
        integration: {
          target: 'main', status: 'conflict', conflictPaths: ['src/index.ts'],
          artifacts: [{ id: 'artifact-conflict', kind: 'log' as const, uri: 'artifact://conflict', visibility: 'team' as const }],
        },
      },
    })
    conflict.link.integrate.mockResolvedValueOnce(conflicted)
    const conflictResult = await conflict.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, conflict.agent, 'team_task_integrate')
    expect(value(conflictResult)).toMatchObject({
      attempt: { outcome: { result: { summary: 'Integration needs review.', integration: {
        status: 'conflict', conflictPaths: ['src/index.ts'], target: 'main',
        artifacts: [{ id: 'artifact-conflict', kind: 'log', uri: 'artifact://conflict', visibility: 'team' }],
      } } } },
    })

    const replay = await harness({ task: accepted, source: false })
    replay.appendAssignment()
    const replayResult = await replay.execute({ task_id: accepted.id, attempt_id: 'attempt-tool-team' }, replay.agent, 'team_task_integrate')
    expect(value(replayResult)).toMatchObject({ status: 'already-recorded' })

    const different = await harness({ task: settledTask(running, { kind: 'released' }), source: false })
    different.appendAssignment()
    const differentResult = await different.execute({ task_id: running.id, attempt_id: 'attempt-tool-team' }, different.agent, 'team_task_integrate')
    expect(differentResult.error?.info?.code).toBe('TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')

    const invalidVerification = await harness({ task: running })
    const invalidVerificationResult = await invalidVerification.execute({
      task_id: running.id, attempt_id: running.lease!.attemptId, verification: ' padded ',
    }, invalidVerification.agent, 'team_task_integrate')
    expect(invalidVerificationResult.error?.info?.code).toBe('TEAM_TASK_INTEGRATE_INVALID_ARGUMENT')

    const invalidResponse = await harness({ task: running })
    invalidResponse.link.integrate.mockResolvedValueOnce(settledTask(running, {
      kind: 'completed', result: { summary: 'Missing integration result.' },
    }))
    const invalidResponseResult = await invalidResponse.execute({
      task_id: running.id, attempt_id: running.lease!.attemptId,
    }, invalidResponse.agent, 'team_task_integrate')
    expect(invalidResponseResult.error?.info?.code).toBe('TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')

    const race = await harness({ task: running })
    race.teams.getTask.mockReturnValueOnce(Promise.resolve(running)).mockReturnValueOnce(Promise.resolve(accepted))
    race.link.integrate.mockRejectedValueOnce(new Error('integration response lost'))
    const raced = await race.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, race.agent, 'team_task_integrate')
    expect(value(raced)).toMatchObject({ status: 'already-recorded' })

    const closeFailure = await harness({ task: running })
    closeFailure.link.integrate.mockResolvedValueOnce(accepted)
    closeFailure.link.close.mockRejectedValueOnce(new Error('integration close failed'))
    const closed = await closeFailure.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, closeFailure.agent, 'team_task_integrate')
    expect(value(closed)).toMatchObject({ status: 'settled' })
  })

  it('rejects integration attempts whose assignment or Link authority is absent, foreign, or lost', async () => {
    const running = teamTaskSnapshotSchema.parse({
      ...runningTask('team-tool-team', 'participant-tool-team', 'activation-tool-team'),
      integration: {
        sourceTaskId: 'source-task', sourceAttemptId: 'source-attempt', provider: 'worktree', target: 'main',
        expectedTarget: 'base-commit', mode: 'integrate',
      },
    })

    const missingOwner = await harness({ task: running })
    Object.defineProperty(missingOwner.agent.session, 'header', {
      value: { ...missingOwner.agent.session.header, teamId: '' },
    })
    const missingOwnerResult = await missingOwner.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, missingOwner.agent, 'team_task_integrate')
    expect(missingOwnerResult.error?.info?.code).toBe('TEAM_TASK_INTEGRATE_ASSIGNMENT_REQUIRED')

    const foreign = await harness({ task: running, source: false })
    foreign.appendAssignment({ teamId: 'team-foreign' })
    const foreignResult = await foreign.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, foreign.agent, 'team_task_integrate')
    expect(foreignResult.error?.info?.code).toBe('TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')

    const unavailable = await harness({ task: running, remote: true })
    unavailable.links.getBoundLinkBorrower.mockReturnValue(undefined)
    const unavailableResult = await unavailable.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, unavailable.agent, 'team_task_integrate')
    expect(unavailableResult.error?.info?.code).toBe('TEAM_TASK_INTEGRATE_ASSIGNMENT_STALE')

    const failed = await harness({ task: running })
    failed.link.integrate.mockRejectedValueOnce(new Error('integration failed'))
    failed.link.close.mockRejectedValueOnce(new Error('integration close failed'))
    const failedResult = await failed.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, failed.agent, 'team_task_integrate')
    expect(failedResult.error?.message).toContain('integration failed')

    const closeOnly = await harness({ task: running })
    closeOnly.link.integrate.mockResolvedValueOnce(undefined)
    closeOnly.link.close.mockRejectedValueOnce(new Error('integration close only failed'))
    const closeOnlyResult = await closeOnly.execute({ task_id: running.id, attempt_id: running.lease!.attemptId }, closeOnly.agent, 'team_task_integrate')
    expect(closeOnlyResult.error?.message).toContain('integration close only failed')
  })

  it('renews the exact running attempt through the authenticated Link', async () => {
    const harnessed = await harness()
    const result = await harnessed.execute({
      task_id: 'task-tool-team',
      attempt_id: 'attempt-tool-team',
    }, harnessed.agent, 'team_task_heartbeat')
    expect(value(result)).toEqual({
      task: { id: 'task-tool-team', revision: 3, phase: 'running' },
      attempt: { id: 'attempt-tool-team', expiresAt: 1001 },
    })
    expect(harnessed.link.heartbeat).toHaveBeenCalledWith({
      taskId: 'task-tool-team', attemptId: 'attempt-tool-team', expectedRevision: 3,
    })
  })

  it('renews through a borrowed remote Link and recovers an uncertain local response from durable task state', async () => {
    const remote = await harness({ remote: true })
    const remoteResult = await remote.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, remote.agent, 'team_task_heartbeat')
    expect(value(remoteResult)).toEqual({
      task: { id: 'task-tool-team', revision: 3, phase: 'running' },
      attempt: { id: 'attempt-tool-team', expiresAt: 1001 },
    })
    expect(remote.borrowCalls).toHaveBeenCalledOnce()
    expect(remote.links.connect).not.toHaveBeenCalled()

    const recovered = await harness()
    recovered.link.heartbeat.mockRejectedValueOnce(new Error('heartbeat response lost'))
    const recoveredResult = await recovered.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, recovered.agent, 'team_task_heartbeat')
    expect(value(recoveredResult)).toMatchObject({ task: { phase: 'running' } })
    expect(recovered.teams.getTask).toHaveBeenCalledTimes(2)

    const rejected = await harness()
    const settled = settledTask(rejected.task, { kind: 'released' })
    rejected.teams.getTask.mockReturnValueOnce(Promise.resolve(rejected.task)).mockReturnValueOnce(Promise.resolve(settled))
    rejected.link.heartbeat.mockRejectedValueOnce(new Error('lease was lost'))
    const rejectedResult = await rejected.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, rejected.agent, 'team_task_heartbeat')
    expect(rejectedResult.error?.message).toContain('lease was lost')

    const invalidResponse = await harness()
    invalidResponse.link.heartbeat.mockResolvedValueOnce(settledTask(invalidResponse.task, { kind: 'released' }))
    const invalidResult = await invalidResponse.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, invalidResponse.agent, 'team_task_heartbeat')
    expect(invalidResult.error?.info?.code).toBe('TEAM_TASK_HEARTBEAT_ASSIGNMENT_STALE')

    const closeFailure = await harness()
    closeFailure.link.close.mockRejectedValueOnce(new Error('heartbeat close failed'))
    const closeResult = await closeFailure.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, closeFailure.agent, 'team_task_heartbeat')
    expect(value(closeResult)).toMatchObject({ task: { phase: 'running' } })
  })

  it('rejects heartbeat requests without the current Team header, assignment Team, or borrowed Link', async () => {
    const missingOwner = await harness()
    Object.defineProperty(missingOwner.agent.session, 'header', {
      value: { ...missingOwner.agent.session.header, participantId: '' },
    })
    const missingOwnerResult = await missingOwner.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, missingOwner.agent, 'team_task_heartbeat')
    expect(missingOwnerResult.error?.info?.code).toBe('TEAM_TASK_HEARTBEAT_ASSIGNMENT_REQUIRED')

    const foreign = await harness({ source: false })
    foreign.appendAssignment({ teamId: 'team-foreign' })
    const foreignResult = await foreign.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, foreign.agent, 'team_task_heartbeat')
    expect(foreignResult.error?.info?.code).toBe('TEAM_TASK_HEARTBEAT_ASSIGNMENT_STALE')

    const unavailable = await harness({ remote: true })
    unavailable.links.getBoundLinkBorrower.mockReturnValue(undefined)
    const unavailableResult = await unavailable.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    }, unavailable.agent, 'team_task_heartbeat')
    expect(unavailableResult.error?.info?.code).toBe('TEAM_TASK_HEARTBEAT_ASSIGNMENT_STALE')
  })

  it.each([
    [{ outcome: 'failed', failure_code: 'TEST_FAILURE', failure_message: 'Verification failed.' }, { kind: 'failed', failure: { code: 'TEST_FAILURE', message: 'Verification failed.' } }, 'pending'],
    [{ outcome: 'released' }, { kind: 'released' }, 'pending'],
  ] as const)('reports worker %s outcomes with their Hub-owned retry phase', async (args, outcome, phase) => {
    const harnessed = await harness()
    const result = await harnessed.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', ...args })
    expect(value(result)).toMatchObject({ task: { phase }, attempt: { outcome }, status: 'settled' })
  })

  it('publishes provider-owned workspace changes before settling a completed report and merges provenance safely', async () => {
    const harnessed = await harness()
    const allocation = {
      id: 'allocation-tool-team', provider: 'shared-local', mode: 'shared',
      revision: 2, lifecycle: 'active', reservedAt: 1, activatedAt: 2, updatedAt: 2,
      teamId: harnessed.task.teamId, taskId: harnessed.task.id, attemptId: 'attempt-tool-team', assignedRevision: 2,
      participantId: 'participant-tool-team', activationId: 'activation-tool-team', sessionId: harnessed.agent.session.id,
    }
    const publish = vi.fn(async () => ({
      teamId: harnessed.task.teamId, taskId: harnessed.task.id, attemptId: 'attempt-tool-team',
      changedPaths: ['generated.ts', 'README.md'],
      artifacts: [{ id: 'artifact-published', kind: 'patch' as const, uri: 'artifact://published', visibility: 'team' as const }],
      accepted: false,
    }))
    harnessed.ctx.provide('teamWorkspaces', { publishForOwner: publish } as never)
    harnessed.team = { ...harnessed.team, workspaceAllocations: [teamWorkspaceAllocationSnapshotSchema.parse(allocation)] }
    const result = await harnessed.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'Published workspace changes.',
      changed_paths: ['README.md', 'src/index.ts'],
    })
    expect(value(result)).toMatchObject({
      attempt: { outcome: { result: {
        changedPaths: ['README.md', 'generated.ts', 'src/index.ts'],
        artifacts: [{ id: 'artifact-published', sourceAttemptId: 'attempt-tool-team' }],
      } } },
    })
    expect(publish).toHaveBeenCalledWith(harnessed.agent, expect.objectContaining({
      taskId: harnessed.task.id, attemptId: 'attempt-tool-team', allocationId: allocation.id, expectedRevision: 2,
    }))
    const settleRequest: unknown = harnessed.link.settle.mock.calls[0]?.[0]
    expect(settleRequest).toMatchObject({ outcome: { result: { changedPaths: ['README.md', 'generated.ts', 'src/index.ts'] } } })

    const noChanges = await harness()
    const noChangeAllocation = { ...allocation, taskId: noChanges.task.id, sessionId: noChanges.agent.session.id }
    const noChangePublish = vi.fn(async () => ({
      teamId: noChanges.task.teamId, taskId: noChanges.task.id, attemptId: 'attempt-tool-team',
      changedPaths: [], artifacts: [], accepted: false,
    }))
    noChanges.ctx.provide('teamWorkspaces', { publishForOwner: noChangePublish } as never)
    noChanges.team = { ...noChanges.team, workspaceAllocations: [teamWorkspaceAllocationSnapshotSchema.parse(noChangeAllocation)] }
    const noChangesResult = await noChanges.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'No workspace changes.',
    })
    expect(value(noChangesResult)).toMatchObject({ task: { phase: 'completed' }, attempt: { outcome: { result: { summary: 'No workspace changes.' } } } })
    expect(noChangePublish).toHaveBeenCalledWith(noChanges.agent, expect.objectContaining({
      taskId: noChanges.task.id, attemptId: 'attempt-tool-team', allocationId: noChangeAllocation.id, expectedRevision: 2,
    }))
  })

  it('retains optional report evidence, artifact metadata, changed paths, and verification in the model result', async () => {
    const harnessed = await harness()
    const result = await harnessed.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'Complete with evidence.',
      evidence: ['unit tests passed'],
      artifacts: [
        { id: 'artifact-minimal', kind: 'log', uri: 'artifact://minimal', visibility: 'team' },
        { id: 'artifact-full', kind: 'report', uri: 'artifact://full', contentHash: 'hash-full', sourceAttemptId: 'attempt-tool-team', visibility: 'human' },
      ],
      changed_paths: ['src/index.ts'], verification: 'pnpm test --filter tool-team',
    })
    expect(value(result)).toMatchObject({
      attempt: { outcome: { result: {
        summary: 'Complete with evidence.', evidence: ['unit tests passed'], changedPaths: ['src/index.ts'],
        verification: 'pnpm test --filter tool-team',
        artifacts: [
          { id: 'artifact-minimal', kind: 'log', uri: 'artifact://minimal', visibility: 'team' },
          { id: 'artifact-full', kind: 'report', uri: 'artifact://full', contentHash: 'hash-full', sourceAttemptId: 'attempt-tool-team', visibility: 'human' },
        ],
      } } },
    })
  })

  it('returns an identical durable outcome as already-recorded without opening another Link', async () => {
    const first = await harness()
    const completed = await first.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'Done.',
    })
    expect(value(completed)).toMatchObject({ status: 'settled' })
    const result = await first.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'Done.',
    })
    expect(value(result)).toMatchObject({ status: 'already-recorded', task: { phase: 'completed' } })
    expect(first.links.connect).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid outcome fields, missing durable sources, stale identities, and a different terminal report', async () => {
    const harnessed = await harness({ source: false })
    const invalid = await harnessed.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: '', failure_code: 'extra',
    })
    expect(invalid.error?.info?.code).toBe('TEAM_TASK_REPORT_INVALID_OUTCOME')
    const blankSummary = await harnessed.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: '',
    })
    expect(blankSummary.error?.info?.code).toBe('TEAM_TASK_REPORT_INVALID_OUTCOME')
    const missing = await harnessed.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released', summary: '', failure_code: '', failure_message: '',
    })
    expect(missing.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED')
    harnessed.appendAssignment({ activationId: 'activation-other' })
    const stale = await harnessed.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(stale.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const settled = await harness()
    await settled.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    const different = await settled.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'failed', failure_code: 'OTHER', failure_message: 'Different.',
    })
    expect(different.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  })

  it('does not install for an unbound Session and rejects stale or driverless agents through the executor', async () => {
    const unbound = await harness({ teamHeader: false })
    expect(unbound.ctx.tools.get('team_task_report', unbound.agent)).toBeUndefined()
    const missing = await unbound.ctx.tools.execute({
      signal,
      callId: 'call-agentless' as never,
      name: 'team_task_report',
      arguments: {},
    })
    expect(missing.error?.info?.code).toBe('UNKNOWN_TOOL')

    const bound = await harness()
    const driverless = await bound.ctx.tools.execute({
      signal,
      callId: 'call-driverless' as never,
      name: 'team_task_report',
      arguments: { task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' },
      agent: bound.agent,
    })
    expect(driverless.error?.info?.code).toBe('TEAM_TASK_REPORT_DRIVER_REQUIRED')
    const driverlessOperations: readonly [string, Record<string, unknown>][] = [
      ['team_task_integrate', { task_id: 'task-tool-team', attempt_id: 'attempt-tool-team' }],
      ['team_task_heartbeat', { task_id: 'task-tool-team', attempt_id: 'attempt-tool-team' }],
      ['team_task_review', { task_id: 'task-tool-team', decision: 'accepted', reason: 'x' }],
      ['team_message', { channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }],
      ['team_final', { channel_id: 'channel-team-final', text: 'x' }],
    ]
    for (const [name, arguments_] of driverlessOperations) {
      const result = await bound.ctx.tools.execute({
        signal,
        callId: `call-driverless-${name}` as never,
        name,
        arguments: arguments_,
        agent: bound.agent,
      })
      expect(result.error?.info?.code).toBe(`${name.toUpperCase()}_DRIVER_REQUIRED`)
    }
    bound.setStatus('idle')
    const idle = await bound.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(idle.isError).toBe(true)
  })

  it('uses initial Agent discovery, validates defensive direct carriers, and exposes args-only presentation', async () => {
    const discovered = await harness({ mountAfterAgent: true, linkProvider: 'fixture' })
    expect(definition(discovered).presentCall?.({
      outcome: 'released', task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    })).toEqual({
      card: 'generic', title: 'Report Team task', kind: 'other', rawInput: 'task-tool-team',
    })
    expect(definition(discovered).presentCall?.({
      outcome: 'unknown', task_id: 'task-tool-team', attempt_id: 'attempt-tool-team',
    })).toBeUndefined()
    await expect(directExecute(discovered, {
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_REPORT_AGENT_REQUIRED' })
    discovered.setStatus('idle')
    await expect(directExecute(discovered, {
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released',
    }, discovered.agent)).rejects.toMatchObject({ code: 'TEAM_TASK_REPORT_DRIVER_REQUIRED' })
    discovered.setStatus('running')
    Object.defineProperty(discovered.agent.session, 'header', {
      value: { ...discovered.agent.session.header, teamId: '' },
    })
    await expect(discovered.ctx.agents.withInitiator(discovered.agent, async () => await directExecute(discovered, {
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released',
    }, discovered.agent))).rejects.toMatchObject({ code: 'TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED' })
  })

  it('reports after continuation messages repeat the same durable assignment', async () => {
    const mounted = await harness()
    mounted.appendAssignment()
    mounted.appendAssignment()
    const reported = await mounted.execute({
      task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'completed', summary: 'Recovered work.',
    })
    expect(reported.isError).toBe(false)
    expect(value(reported)).toMatchObject({ status: 'settled', task: { phase: 'completed' } })
  })

  it('rejects malformed, ambiguous, cross-Team, stale-binding, and non-running assignment sources', async () => {
    const malformed = await harness({ source: false })
    malformed.agent.session.append('turn/start', { turn: 1 })
    malformed.agent.session.append('user/message', {
      id: MessageId('ordinary-source'), role: 'user', content: [{ type: 'text', text: 'ordinary' }], source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    malformed.agent.session.append('user/message', {
      id: MessageId('null-source'), role: 'user', content: [{ type: 'text', text: 'invalid' }], source: null,
    } as unknown as UserMessage, { surfaceOp: 'append' })
    const nullPrototypeSource = Object.assign(Object.create(null) as Record<string, unknown>, {
      kind: 'team-task-assignment',
      teamId: 'team-tool-team', channelId: 'channel-tool-team', envelopeId: 'envelope-null-prototype',
      taskId: 'not-this-task', attemptId: 'not-this-attempt', assignedRevision: 1, runningRevision: 2, activationId: 'activation-tool-team',
    })
    malformed.agent.session.append('user/message', {
      id: MessageId('null-prototype-source'), role: 'user', content: [{ type: 'text', text: 'other assignment' }], source: nullPrototypeSource,
    } as unknown as UserMessage, { surfaceOp: 'append' })
    malformed.appendAssignment({ assignedRevision: 0 })
    const malformedResult = await malformed.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(malformedResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED')

    const ambiguous = await harness()
    ambiguous.appendAssignment({ envelopeId: 'envelope-duplicate' })
    const ambiguousResult = await ambiguous.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(ambiguousResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED')

    const foreign = await harness({ source: false })
    foreign.appendAssignment({ teamId: 'team-foreign' })
    const foreignResult = await foreign.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(foreignResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const binding = await harness()
    binding.teams.getActivation.mockResolvedValueOnce(activationBindingSnapshotSchema.parse({
      ...binding.binding,
      activation: { ...binding.binding.activation, status: 'offline' },
    }))
    const bindingResult = await binding.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(bindingResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const lease = await harness()
    lease.task = teamTaskSnapshotSchema.parse({
      ...lease.task,
      lease: { ...lease.task.lease!, wakeChannelId: 'channel-other' },
    })
    const leaseResult = await lease.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(leaseResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  })

  it('rejects expired/cancelled history, invalid identifiers, and a Link result without the settled attempt', async () => {
    const expired = await harness()
    expired.task = settledTask(expired.task, { kind: 'lease-expired' })
    const expiredResult = await expired.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(expiredResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const cancelled = await harness()
    cancelled.task = settledTask(cancelled.task, { kind: 'cancelled' })
    const cancelledResult = await cancelled.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(cancelledResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const invalid = await harness()
    const invalidResult = await invalid.execute({ task_id: '', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(invalidResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED')
    const invalidAttemptResult = await invalid.execute({ task_id: 'task-tool-team', attempt_id: '', outcome: 'released' })
    expect(invalidAttemptResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_REQUIRED')

    const invalidLink = await harness()
    invalidLink.link.settle.mockResolvedValueOnce(undefined)
    const result = await invalidLink.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(result.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')

    const wrongTask = await harness()
    wrongTask.link.settle.mockResolvedValueOnce(runningTask('team-tool-team', 'participant-tool-team', 'activation-tool-team'))
    const wrongResult = await wrongTask.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(wrongResult.error?.info?.code).toBe('TEAM_TASK_REPORT_ASSIGNMENT_STALE')
  })

  it('preserves an accepted settlement when Link close fails and recognizes a settlement race after rereading durable history', async () => {
    const harnessed = await harness()
    harnessed.link.close.mockRejectedValueOnce(new Error('close failed'))
    const settled = await harnessed.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(value(settled)).toMatchObject({ status: 'settled' })

    const raced = await harness()
    const afterLostResponse = Promise.resolve(raced.task).then(() => {
      raced.task = settledTask(raced.task, { kind: 'released' })
      return raced.task
    })
    raced.teams.getTask.mockReturnValueOnce(Promise.resolve(raced.task))
    raced.teams.getTask.mockReturnValueOnce(afterLostResponse)
    raced.link.settle.mockRejectedValueOnce(new Error('response lost after commit'))
    const replay = await raced.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(value(replay)).toMatchObject({ status: 'already-recorded' })
  })

  it('preserves settlement failure over Link close failure and contains a hostile close diagnostic', async () => {
    const rejected = await harness()
    rejected.link.settle.mockRejectedValueOnce(new Error('settlement failed'))
    rejected.link.close.mockRejectedValueOnce(new Error('close failed'))
    const failed = await rejected.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(failed.error?.message).toContain('settlement failed')

    const hostile = await harness()
    hostile.link.close.mockRejectedValueOnce({
      [Symbol.toPrimitive]() { throw new Error('hostile conversion') },
    })
    const settled = await hostile.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(value(settled)).toMatchObject({ status: 'settled' })

    const closeOnly = await harness()
    closeOnly.link.settle.mockResolvedValueOnce(undefined)
    closeOnly.link.close.mockRejectedValueOnce(new Error('only close failed'))
    const closeOnlyResult = await closeOnly.execute({ task_id: 'task-tool-team', attempt_id: 'attempt-tool-team', outcome: 'released' })
    expect(closeOnlyResult.error?.message).toContain('only close failed')
  })

  it('keeps the Loader-safe namespace and pure args-only presentation', () => {
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-team')
    expect(toolTeam.inject).toEqual(['teamLinks', 'agents', 'tools'])
  })

  it('fails invalid direct configuration before registering a scoped tool', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    ctx.provide('teams', {} as never)
    ctx.provide('teamLinks', {} as never)
    expect(() => { toolTeam.apply(ctx, { linkProvider: ' local ' }) }).toThrow('linkProvider must be non-empty')
    expect(() => { toolTeam.apply(ctx, { linkProvider: 'fixture' }) }).not.toThrow()
    expect(() => { toolTeam.apply(ctx, {}) }).not.toThrow()
  })
})

describe('team_message', () => {
  it.each([false, true])('answers an ordinary consult from a structured logged source with remote=%s', async (remote) => {
    const channel = channelSnapshotSchema.parse({ ...finalChannel('team-tool-team', 'participant-tool-team'),
      manifest: { ...finalChannel('team-tool-team', 'participant-tool-team').manifest, adapter: { type: 'consult', version: 1 },
        participants: [{ id: 'participant-team-final-recipient', role: 'initiator' }, { id: 'participant-tool-team', role: 'respondent' }], limits: {} } })
    const mounted = await harness({ remote, source: false, channel })
    mounted.agent.session.append('team/channel-view', { teamId: 'team-tool-team', channelId: channel.manifest.id,
      adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'full-transcript', version: 1 },
      triggeringEnvelopeId: 'ordinary-request', sourceEnvelopeIds: ['ordinary-request'], delivery: 'turn',
      content: [{ type: 'text', text: 'Opaque renderer output that is deliberately not JSON.' }] }, { surfaceOp: 'append' })
    const post = mounted.link.post as unknown as ReturnType<typeof vi.fn>
    post.mockResolvedValueOnce({ ...acceptedMessageEnvelope(mounted.binding, String(channel.manifest.id), ['participant-team-final-recipient'], 'Answer.', 'turn'),
      kind: 'response', causationId: 'ordinary-request' })
    const result = await mounted.execute({ channel_id: channel.manifest.id, text: 'Answer.', delivery: 'turn' }, mounted.agent, 'team_message')
    expect(value(result)).toHaveProperty('envelope_id')
    expect(post.mock.calls.at(-1)?.[0]).toMatchObject({ draft: { kind: 'response', causationId: 'ordinary-request',
      audience: ['participant-team-final-recipient'], payload: { text: 'Answer.' } } })
    mounted.agent.session.append('team/channel-view', { teamId: 'team-tool-team', channelId: channel.manifest.id,
      adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'full-transcript', version: 1 },
      triggeringEnvelopeId: 'review-request', sourceEnvelopeIds: ['review-request'], delivery: 'turn', taskId: 'task-tool-team',
      review: { attemptId: 'attempt-tool-team', reviewRevision: 1, reviewerId: 'participant-tool-team', initiatorId: 'participant-team-final-recipient' },
      content: [{ type: 'text', text: 'A structured review cannot be answered as ordinary text.' }] }, { surfaceOp: 'append' })
    const denied = await mounted.execute({ channel_id: channel.manifest.id, text: 'Not a review decision', delivery: 'turn' }, mounted.agent, 'team_message')
    expect(denied.isError).toBe(true)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('posts a direct message through the local Link, derives the peer audience, and uses a message-specific retry key', async () => {
    const harnessed = await harness({ source: false })
    const post = harnessed.link.post as unknown as ReturnType<typeof vi.fn>
    post.mockResolvedValueOnce(acceptedMessageEnvelope(
      harnessed.binding, 'channel-team-final', ['participant-team-final-recipient'], 'A durable progress update.', 'turn',
    ))

    const result = await harnessed.execute({
      channel_id: 'channel-team-final', text: 'A durable progress update.', delivery: 'turn',
    }, harnessed.agent, 'team_message', 'message-call', 'message-root')

    expect(value(result)).toEqual({ channel_id: 'channel-team-final', envelope_id: 'envelope-team-message' })
    expect(post).toHaveBeenCalledWith({
      expectedCursor: 2,
      idempotencyKey: '["team_message","message-root","message-call"]',
      draft: {
        channelId: 'channel-team-final',
        audience: ['participant-team-final-recipient'],
        kind: 'message',
        payload: { content: [{ type: 'text', text: 'A durable progress update.' }] },
        delivery: 'turn',
      },
    })
    expect(harnessed.teams.getTeam).toHaveBeenCalledWith({ teamId: 'team-tool-team' })
    expect(harnessed.teams.getChannel).toHaveBeenCalledWith({ channelId: 'channel-team-final' })
    expect(harnessed.link.close).toHaveBeenCalledTimes(1)
  })

  it('posts a remote message through the borrowed Link with an explicit audience and supports broadcast adapters locally', async () => {
    const remote = await harness({ remote: true, source: false })
    const remotePost = remote.link.post as unknown as ReturnType<typeof vi.fn>
    remotePost.mockResolvedValueOnce(acceptedMessageEnvelope(
      remote.binding, 'channel-team-final', ['participant-team-final-recipient'], 'Remote update.', 'context',
    ))
    const remoteResult = await remote.execute({
      channel_id: 'channel-team-final', text: 'Remote update.', delivery: 'context', audience: ['participant-team-final-recipient'],
    }, remote.agent, 'team_message', 'remote-message-call', 'remote-message-root')
    expect(value(remoteResult)).toEqual({ channel_id: 'channel-team-final', envelope_id: 'envelope-team-message' })
    expect(remotePost).toHaveBeenCalledWith({
      idempotencyKey: '["team_message","remote-message-root","remote-message-call"]',
      draft: {
        channelId: 'channel-team-final',
        audience: ['participant-team-final-recipient'],
        kind: 'message',
        payload: { content: [{ type: 'text', text: 'Remote update.' }] },
        delivery: 'context',
      },
    })
    expect(remote.borrowCalls).toHaveBeenCalledOnce()
    expect(remote.links.connect).not.toHaveBeenCalled()

    const broadcast = await harness({ source: false, channel: channelSnapshotSchema.parse({
      ...finalChannel('team-tool-team', 'participant-tool-team'),
      manifest: {
        ...finalChannel('team-tool-team', 'participant-tool-team').manifest,
        adapter: { type: 'discussion', version: 1 },
      },
    }) })
    const broadcastPost = broadcast.link.post as unknown as ReturnType<typeof vi.fn>
    broadcastPost.mockResolvedValueOnce(acceptedMessageEnvelope(broadcast.binding, 'channel-team-final', null, 'Broadcast update.', 'steer'))
    const broadcastResult = await broadcast.execute({
      channel_id: 'channel-team-final', text: 'Broadcast update.', delivery: 'steer',
    }, broadcast.agent, 'team_message')
    expect(value(broadcastResult)).toEqual({ channel_id: 'channel-team-final', envelope_id: 'envelope-team-message' })
    expect(broadcastPost.mock.calls[0]?.[0]).toMatchObject({ draft: { audience: null, delivery: 'steer' } })
  })

  it('rejects invalid message arguments, recipients, channels, Link bindings, and responses', async () => {
    const invalid = await harness({ source: false })
    const cases: readonly [Record<string, unknown>, string][] = [
      [{ channel_id: '', text: 'x', delivery: 'turn' }, 'TEAM_MESSAGE_CHANNEL_INVALID'],
      [{ channel_id: 'channel-team-final', text: '', delivery: 'turn' }, 'TEAM_MESSAGE_INVALID_TEXT'],
      [{ channel_id: 'channel-team-final', text: 'x', delivery: 'turn', audience: [] }, 'TEAM_MESSAGE_INVALID_AUDIENCE'],
      [{ channel_id: 'channel-team-final', text: 'x', delivery: 'turn', audience: [''] }, 'TEAM_MESSAGE_INVALID_AUDIENCE'],
      [{ channel_id: 'channel-team-final', text: 'x', delivery: 'turn', audience: ['participant-tool-team'] }, 'TEAM_MESSAGE_INVALID_AUDIENCE'],
      [{ channel_id: 'channel-team-final', text: 'x', delivery: 'turn', audience: ['participant-team-final-recipient', 'participant-team-final-recipient'] }, 'TEAM_MESSAGE_INVALID_AUDIENCE'],
    ]
    for (const [args, code] of cases) {
      const result = await invalid.execute(args, invalid.agent, 'team_message')
      expect(result.error?.info?.code).toBe(code)
    }
    const invalidDelivery = await invalid.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'other' }, invalid.agent, 'team_message')
    expect(invalidDelivery.error?.message).toContain('invalid arguments')
    const invalidAudienceType = await invalid.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn', audience: [42] }, invalid.agent, 'team_message')
    expect(invalidAudienceType.error?.message).toContain('invalid arguments')

    const inactive = await harness({ source: false, channel: channelSnapshotSchema.parse({
      ...finalChannel('team-tool-team', 'participant-tool-team'), phase: 'closed',
    }) })
    const inactiveResult = await inactive.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }, inactive.agent, 'team_message')
    expect(inactiveResult.error?.info?.code).toBe('TEAM_MESSAGE_CHANNEL_INVALID')

    const missingOwner = await harness({ source: false })
    Object.defineProperty(missingOwner.agent.session, 'header', {
      value: { ...missingOwner.agent.session.header, teamId: '' },
    })
    const missingOwnerResult = await missingOwner.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }, missingOwner.agent, 'team_message')
    expect(missingOwnerResult.error?.info?.code).toBe('TEAM_MESSAGE_ACTIVATION_REQUIRED')

    const noPeer = await harness({ source: false, channel: channelSnapshotSchema.parse({
      ...finalChannel('team-tool-team', 'participant-tool-team'),
      manifest: {
        ...finalChannel('team-tool-team', 'participant-tool-team').manifest,
        participants: [{ id: 'participant-tool-team', role: 'worker' }],
      },
    }) })
    const noPeerResult = await noPeer.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }, noPeer.agent, 'team_message')
    expect(noPeerResult.error?.info?.code).toBe('TEAM_MESSAGE_CHANNEL_INVALID')

    const foreign = await harness({ source: false, channel: finalChannel('team-foreign', 'participant-tool-team') })
    const foreignResult = await foreign.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }, foreign.agent, 'team_message')
    expect(foreignResult.error?.info?.code).toBe('TEAM_MESSAGE_CHANNEL_INVALID')

    const unavailable = await harness({ remote: true, source: false })
    unavailable.links.getBoundLinkBorrower.mockReturnValue(undefined)
    const unavailableResult = await unavailable.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn', audience: ['participant-team-final-recipient'] }, unavailable.agent, 'team_message')
    expect(unavailableResult.error?.info?.code).toBe('TEAM_MESSAGE_UNAVAILABLE')

    const remoteAudience = await harness({ remote: true, source: false })
    remoteAudience.link.post.mockResolvedValueOnce(acceptedMessageEnvelope(
      remoteAudience.binding, 'channel-team-final', ['participant-team-final-recipient'], 'x', 'turn',
    ))
    const remoteAudienceResult = await remoteAudience.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }, remoteAudience.agent, 'team_message')
    expect(remoteAudienceResult.error).toBeUndefined()
    expect(remoteAudience.link.post.mock.calls[0]?.[0]).toMatchObject({ draft: {
      audience: ['participant-team-final-recipient'], payload: { content: [{ type: 'text', text: 'x' }] },
    } })

    const mismatchedBinding = await harness({ remote: true, source: false })
    Object.assign(mismatchedBinding.link.binding.activation, { participantId: 'participant-other' })
    const mismatchResult = await mismatchedBinding.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn', audience: ['participant-team-final-recipient'] }, mismatchedBinding.agent, 'team_message')
    expect(mismatchResult.error?.info?.code).toBe('TEAM_MESSAGE_UNAVAILABLE')

    const malformed = await harness({ source: false })
    const malformedPost = malformed.link.post as unknown as ReturnType<typeof vi.fn>
    malformedPost.mockResolvedValueOnce(finalEnvelope(malformed.binding, {
      channelId: channelIdSchema.parse('channel-team-final'), idempotencyKey: channelPostIdempotencyKeySchema.parse('message-key'), text: 'x',
    }))
    const malformedResult = await malformed.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }, malformed.agent, 'team_message')
    expect(malformedResult.error?.info?.code).toBe('TEAM_MESSAGE_CHANNEL_INVALID')

    const closeFailure = await harness({ source: false })
    const closePost = closeFailure.link.post as unknown as ReturnType<typeof vi.fn>
    closePost.mockResolvedValueOnce(acceptedMessageEnvelope(closeFailure.binding, 'channel-team-final', ['participant-team-final-recipient'], 'x', 'turn'))
    closeFailure.link.close.mockRejectedValueOnce(new Error('message close failed'))
    const closeResult = await closeFailure.execute({ channel_id: 'channel-team-final', text: 'x', delivery: 'turn' }, closeFailure.agent, 'team_message')
    expect(value(closeResult)).toMatchObject({ envelope_id: 'envelope-team-message' })
  })
})

describe('team_final', () => {
  it('derives the peer and activation from the live Agent header, then posts one final Envelope through the bound Link', async () => {
    const harnessed = await harness({ source: false })
    expect(harnessed.ctx.tools.get('team_final', harnessed.agent)?.name).toBe('team_final')
    expect(definition(harnessed, 'team_final').presentCall?.({
      channel_id: 'channel-team-final', text: 'Presentation input.',
    })).toEqual({
      card: 'generic', title: 'Send Team final answer', kind: 'other', rawInput: 'channel-team-final',
    })
    const result = await harnessed.executeFinal({
      channel_id: 'channel-team-final',
      text: 'The requested work is complete.',
    })
    expect(value(result)).toEqual({ channel_id: 'channel-team-final', envelope_id: 'envelope-team-final' })
    expect(harnessed.teams.getTeam).toHaveBeenCalledWith({ teamId: 'team-tool-team' })
    expect(harnessed.teams.getChannel).not.toHaveBeenCalled()
    expect(harnessed.links.connect).toHaveBeenCalledWith({ provider: 'local', binding: harnessed.binding })
    expect(harnessed.link.postFinalResult).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'channel-team-final',
      text: 'The requested work is complete.',
    }))
    expect(harnessed.link.close).toHaveBeenCalledTimes(1)
    await harnessed.toolFiber.dispose()
    expect(harnessed.ctx.tools.get('team_final', harnessed.agent)).toBeUndefined()
  })

  it('uses the remote delivery owner\'s existing Link for a final without local Team authority or another connection', async () => {
    const harnessed = await harness({ remote: true, source: false })
    const result = await harnessed.executeFinal({
      channel_id: 'channel-team-final', text: 'Remote coordinator final.',
    }, undefined, 'final-call', 'root-final')
    expect(value(result)).toEqual({ channel_id: 'channel-team-final', envelope_id: 'envelope-team-final' })
    expect(harnessed.borrowCalls).toHaveBeenCalledTimes(1)
    expect(harnessed.links.connect).not.toHaveBeenCalled()
    expect(harnessed.teams.getTeam).not.toHaveBeenCalled()
    expect(harnessed.link.postFinalResult).toHaveBeenCalledWith({
      channelId: 'channel-team-final',
      idempotencyKey: '["team_final","root-final","final-call"]',
      text: 'Remote coordinator final.',
    })
  })

  it('rejects an unavailable or mismatched borrowed final Link and a malformed final response', async () => {
    const unavailable = await harness({ remote: true, source: false })
    unavailable.links.getBoundLinkBorrower.mockReturnValue(undefined)
    const unavailableResult = await unavailable.executeFinal({ channel_id: 'channel-team-final', text: 'Unavailable.' })
    expect(unavailableResult.error?.info?.code).toBe('TEAM_FINAL_ACTIVATION_REQUIRED')

    const mismatched = await harness({ remote: true, source: false })
    Object.assign(mismatched.link.binding.activation, { participantId: 'participant-other' })
    const mismatchResult = await mismatched.executeFinal({ channel_id: 'channel-team-final', text: 'Mismatched.' })
    expect(mismatchResult.error?.info?.code).toBe('TEAM_FINAL_ACTIVATION_REQUIRED')

    const malformed = await harness({ remote: true, source: false })
    malformed.link.postFinalResult.mockResolvedValueOnce(teamEnvelopeSchema.parse({
      id: 'envelope-malformed-final',
      teamId: malformed.binding.activation.teamId,
      channelId: 'channel-team-final',
      sequence: 3,
      senderId: malformed.binding.activation.participantId,
      audience: [],
      kind: 'final',
      payload: { text: 'Malformed.' },
      delivery: 'turn',
      priority: 'normal',
      createdAt: 3,
    }))
    const malformedResult = await malformed.executeFinal({ channel_id: 'channel-team-final', text: 'Malformed.' })
    expect(malformedResult.error?.info?.code).toBe('TEAM_FINAL_CHANNEL_REQUIRED')
  })

  it('accepts one idle binding and rejects absent or ambiguous current activation authority', async () => {
    const idle = await harness({ source: false })
    const idleBinding = activationBindingSnapshotSchema.parse({
      ...idle.binding,
      activation: { ...idle.binding.activation, status: 'idle' },
    })
    idle.team = finalTeamState('team-tool-team', idleBinding, idle.task, idle.channel)
    const idleResult = await idle.executeFinal({ channel_id: 'channel-team-final', text: 'Idle activation is current.' })
    expect(value(idleResult)).toEqual({ channel_id: 'channel-team-final', envelope_id: 'envelope-team-final' })
    expect(idle.links.connect).toHaveBeenCalledWith({ provider: 'local', binding: idleBinding })

    const absent = await harness({ source: false })
    absent.team = finalTeamState('team-tool-team', absent.binding, absent.task, absent.channel, { activations: [] })
    const absentResult = await absent.executeFinal({ channel_id: 'channel-team-final', text: 'No binding.' })
    expect(absentResult.error?.info?.code).toBe('TEAM_FINAL_ACTIVATION_REQUIRED')

    const ambiguous = await harness({ source: false })
    const second = activationBindingSnapshotSchema.parse({
      ...ambiguous.binding,
      activation: { ...ambiguous.binding.activation, id: 'activation-team-final-second' },
    })
    ambiguous.team = finalTeamState('team-tool-team', ambiguous.binding, ambiguous.task, ambiguous.channel, {
      activations: [ambiguous.binding, second],
    })
    const ambiguousResult = await ambiguous.executeFinal({ channel_id: 'channel-team-final', text: 'Ambiguous binding.' })
    expect(ambiguousResult.error?.info?.code).toBe('TEAM_FINAL_ACTIVATION_REQUIRED')
  })

  it('accepts only non-empty model arguments and leaves channel validation to the bound Hub operation', async () => {
    const harnessed = await harness({ source: false })
    await expect(harnessed.ctx.agents.withInitiator(harnessed.agent, async () => await directExecute(harnessed, {
      channel_id: '', text: 'Invalid channel.',
    }, harnessed.agent, 'team_final'))).rejects.toMatchObject({ code: 'TEAM_FINAL_CHANNEL_REQUIRED' })
    await expect(harnessed.ctx.agents.withInitiator(harnessed.agent, async () => await directExecute(harnessed, {
      channel_id: 'channel-team-final', text: '',
    }, harnessed.agent, 'team_final'))).rejects.toMatchObject({ code: 'TEAM_FINAL_TEXT_REQUIRED' })

    const unexpected = await harnessed.executeFinal({
      channel_id: 'channel-team-final', text: 'No recipient argument.', recipient_id: 'participant-forged',
    })
    expect(unexpected.isError).toBe(true)
    expect(unexpected.error?.info?.code).toBe('TEAM_FINAL_ARGUMENTS_REQUIRED')
    expect(harnessed.link.postFinalResult).not.toHaveBeenCalled()

    Object.defineProperty(harnessed.agent.session, 'header', {
      value: { ...harnessed.agent.session.header, teamId: '' },
    })
    await expect(harnessed.ctx.agents.withInitiator(harnessed.agent, async () => await directExecute(harnessed, {
      channel_id: 'channel-team-final', text: 'Invalid header.',
    }, harnessed.agent, 'team_final'))).rejects.toMatchObject({ code: 'TEAM_FINAL_ACTIVATION_REQUIRED' })
  })

  it('requires its exact active caller and preserves an accepted post if Link closure fails', async () => {
    const harnessed = await harness({ source: false })
    await expect(directExecute(harnessed, {
      channel_id: 'channel-team-final', text: 'No caller.',
    }, undefined, 'team_final')).rejects.toMatchObject({ code: 'TEAM_FINAL_AGENT_REQUIRED' })
    harnessed.setStatus('idle')
    const driverless = await harnessed.executeFinal({ channel_id: 'channel-team-final', text: 'Idle caller.' })
    expect(driverless.error?.info?.code).toBe('TEAM_FINAL_DRIVER_REQUIRED')

    const closing = await harness({ source: false })
    closing.link.close.mockRejectedValueOnce(new Error('close failed'))
    const posted = await closing.executeFinal({ channel_id: 'channel-team-final', text: 'Accepted before close.' })
    expect(value(posted)).toEqual({ channel_id: 'channel-team-final', envelope_id: 'envelope-team-final' })

    const rejected = await harness({ source: false })
    rejected.link.postFinalResult.mockRejectedValueOnce(new Error('post failed'))
    rejected.link.close.mockRejectedValueOnce(new Error('close also failed'))
    const failed = await rejected.executeFinal({ channel_id: 'channel-team-final', text: 'Rejected post.' })
    expect(failed.error?.message).toContain('post failed')
  })

  it('derives the review revision from the current durable review assignment source', async () => {
    const running = runningTask('team-tool-team', 'participant-tool-team', 'activation-tool-team')
    const reviewed = settledTask({
      ...running,
      reviewPolicy: { kind: 'participant', reviewerId: running.lease!.participantId },
    }, { kind: 'completed', result: { summary: 'The worker submitted a verified result.' } })
    const harnessed = await harness({ task: reviewed })
    const attempt = reviewed.attemptHistory[0]
    if (attempt?.outcome.kind !== 'completed') throw new Error('review fixture must contain a completed attempt')
    harnessed.agent.session.append('turn/start', { turn: 1 })
    harnessed.agent.session.append('user/message', {
      id: MessageId('team-review-assignment:envelope-review-tool-team'),
      role: 'user',
      content: [{ type: 'text', text: 'Review the submitted result.' }],
      source: {
        kind: 'team-review-assignment',
        teamId: reviewed.teamId,
        channelId: 'channel-review-tool-team',
        envelopeId: 'envelope-review-tool-team',
        taskId: reviewed.id,
        attemptId: attempt.id,
        reviewRevision: reviewed.revision,
        reviewerId: 'participant-tool-team',
        initiatorId: 'participant-team-final-recipient',
        result: attempt.outcome.result,
      },
    } as never, { surfaceOp: 'append' })
    const accepted = teamTaskSnapshotSchema.parse({
      ...reviewed,
      revision: reviewed.revision + 1,
      phase: 'completed',
      reviewHistory: [{
        attemptId: attempt.id,
        reviewerId: 'participant-tool-team',
        nextPhase: 'completed',
        reason: 'The result is verified.',
        decidedAt: 4,
      }],
    })
    const resolveTaskReview = vi.fn(async (_request: unknown) => accepted)
    const postReview = (harnessed.link as unknown as {
      readonly post: {
        mockResolvedValue(value: TeamEnvelope): void
        readonly mock: { readonly calls: readonly unknown[][] }
      }
    }).post
    postReview.mockResolvedValue(teamEnvelopeSchema.parse({
      id: 'envelope-review-response-tool-team',
      teamId: reviewed.teamId,
      channelId: 'channel-review-tool-team',
      sequence: 4,
      senderId: 'participant-tool-team',
      audience: ['participant-team-final-recipient'],
      kind: 'response',
      payload: { text: 'The result is verified.' },
      delivery: 'turn',
      causationId: 'envelope-review-tool-team',
      taskId: reviewed.id,
      priority: 'normal',
      createdAt: 4,
    }))
    ;(harnessed.link as unknown as { resolveTaskReview: typeof resolveTaskReview }).resolveTaskReview = resolveTaskReview

    const result = await harnessed.execute({
      task_id: reviewed.id,
      decision: 'accepted',
      reason: 'The result is verified.',
    }, harnessed.agent, 'team_task_review')
    expect(value(result)).toMatchObject({ task: { id: reviewed.id, revision: reviewed.revision + 1, phase: 'completed' } })
    expect(resolveTaskReview).toHaveBeenCalledWith({
      taskId: reviewed.id,
      expectedRevision: reviewed.revision,
      nextPhase: 'completed',
      reason: 'The result is verified.',
    })
    const postedReview = postReview.mock.calls.at(-1)?.[0]
    expect(postedReview).toMatchObject({
      draft: {
        channelId: 'channel-review-tool-team',
        causationId: 'envelope-review-tool-team',
        kind: 'response',
      },
    })
  })

  it('resolves remote rework through the borrowed Link and fails closed for missing, unauthorized, invalid, and stale review authority', async () => {
    const running = runningTask('team-tool-team', 'participant-tool-team', 'activation-tool-team')
    const reviewed = settledTask({
      ...running,
      reviewPolicy: { kind: 'participant', reviewerId: running.lease!.participantId },
    }, { kind: 'completed', result: { summary: 'The worker submitted a result.' } })
    const attempt = reviewed.attemptHistory[0]
    if (attempt?.outcome.kind !== 'completed') throw new Error('review fixture must contain a completed attempt')
    const reviewResult = attempt.outcome.result

    const appendReviewAssignment = (harnessed: Harness, overrides: Record<string, unknown> = {}): void => {
      harnessed.agent.session.append('turn/start', { turn: 1 })
      const envelopeId = typeof overrides.envelopeId === 'string' ? overrides.envelopeId : 'envelope-review-tool-team'
      harnessed.agent.session.append('user/message', {
        id: MessageId(`team-review-assignment:${envelopeId}`),
        role: 'user',
        content: [{ type: 'text', text: 'Review the submitted result.' }],
        source: {
          kind: 'team-review-assignment',
          teamId: reviewed.teamId,
          channelId: 'channel-review-tool-team',
          envelopeId: 'envelope-review-tool-team',
          taskId: reviewed.id,
          attemptId: attempt.id,
          reviewRevision: reviewed.revision,
          reviewerId: 'participant-tool-team',
          initiatorId: 'participant-team-final-recipient',
          result: reviewResult,
          ...overrides,
        },
      } as never, { surfaceOp: 'append' })
    }

    const remote = await harness({ task: reviewed, remote: true, source: false })
    appendReviewAssignment(remote)
    remote.link.post.mockResolvedValueOnce(teamEnvelopeSchema.parse({
      id: 'envelope-review-response-rework', teamId: reviewed.teamId, channelId: 'channel-review-tool-team', sequence: 4,
      senderId: 'participant-tool-team', audience: ['participant-team-final-recipient'], kind: 'response',
      payload: { text: 'Please add a regression test.', decision: 'rework' }, delivery: 'turn',
      causationId: 'envelope-review-tool-team', taskId: reviewed.id, priority: 'normal', createdAt: 4,
    }))
    const pending = teamTaskSnapshotSchema.parse({
      ...reviewed, revision: reviewed.revision + 1, phase: 'pending',
      reviewHistory: [{ attemptId: attempt.id, reviewerId: 'participant-tool-team', nextPhase: 'pending', reason: 'Please add a regression test.', decidedAt: 4 }],
    })
    remote.link.resolveTaskReview.mockResolvedValueOnce(pending)
    const remoteResult = await remote.execute({ task_id: reviewed.id, decision: 'rework', reason: '  Please add a regression test.  ' }, remote.agent, 'team_task_review')
    expect(value(remoteResult)).toEqual({
      task: { id: reviewed.id, revision: reviewed.revision + 1, phase: 'pending' },
      decision: 'rework', reason: 'Please add a regression test.',
    })
    expect(remote.link.resolveTaskReview).toHaveBeenCalledWith({
      taskId: reviewed.id, expectedRevision: reviewed.revision, nextPhase: 'pending', reason: 'Please add a regression test.',
    })
    expect(remote.borrowCalls).toHaveBeenCalledOnce()

    const missingOwner = await harness({ task: reviewed, source: false })
    appendReviewAssignment(missingOwner)
    Object.defineProperty(missingOwner.agent.session, 'header', {
      value: { ...missingOwner.agent.session.header, participantId: '' },
    })
    const missingOwnerResult = await missingOwner.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'No owner.' }, missingOwner.agent, 'team_task_review')
    expect(missingOwnerResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_ACTIVATION_REQUIRED')

    const blankReason = await harness({ task: reviewed, source: false })
    appendReviewAssignment(blankReason)
    const blankReasonResult = await blankReason.execute({ task_id: reviewed.id, decision: 'accepted', reason: '   ' }, blankReason.agent, 'team_task_review')
    expect(blankReasonResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_INVALID_REASON')

    const missing = await harness({ task: reviewed, source: false })
    const missingResult = await missing.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'No source.' }, missing.agent, 'team_task_review')
    expect(missingResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_SOURCE_REQUIRED')

    const unauthorized = await harness({ task: reviewed, source: false })
    appendReviewAssignment(unauthorized, { reviewerId: 'participant-other' })
    const unauthorizedResult = await unauthorized.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Not mine.' }, unauthorized.agent, 'team_task_review')
    expect(unauthorizedResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_UNAUTHORIZED')

    const noBinding = await harness({ task: reviewed, source: false })
    appendReviewAssignment(noBinding)
    noBinding.team = finalTeamState('team-tool-team', noBinding.binding, reviewed, noBinding.channel, { activations: [] })
    const noBindingResult = await noBinding.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'No activation.' }, noBinding.agent, 'team_task_review')
    expect(noBindingResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_ACTIVATION_REQUIRED')

    const remoteUnavailable = await harness({ task: reviewed, remote: true, source: false })
    appendReviewAssignment(remoteUnavailable)
    remoteUnavailable.links.getBoundLinkBorrower.mockReturnValue(undefined)
    const remoteUnavailableResult = await remoteUnavailable.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Unavailable.' }, remoteUnavailable.agent, 'team_task_review')
    expect(remoteUnavailableResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_UNAVAILABLE')

    const remoteUnexpected = await harness({ task: reviewed, remote: true, source: false })
    appendReviewAssignment(remoteUnexpected)
    remoteUnexpected.link.post.mockResolvedValueOnce(teamEnvelopeSchema.parse({
      id: 'envelope-review-response-unexpected-remote', teamId: reviewed.teamId, channelId: 'channel-review-tool-team', sequence: 4,
      senderId: 'participant-tool-team', audience: ['participant-team-final-recipient'], kind: 'response',
      payload: { text: 'Unexpected.', decision: 'accepted' }, delivery: 'turn',
      causationId: 'envelope-review-tool-team', taskId: reviewed.id, priority: 'normal', createdAt: 4,
    }))
    remoteUnexpected.link.resolveTaskReview.mockResolvedValueOnce(running)
    const remoteUnexpectedResult = await remoteUnexpected.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Unexpected.' }, remoteUnexpected.agent, 'team_task_review')
    expect(remoteUnexpectedResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_INVALID_STATE')

    const wrongState = await harness({ task: reviewed, source: false })
    appendReviewAssignment(wrongState)
    wrongState.team = finalTeamState('team-tool-team', wrongState.binding, running, wrongState.channel)
    const wrongStateResult = await wrongState.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Wrong state.' }, wrongState.agent, 'team_task_review')
    expect(wrongStateResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_UNAUTHORIZED')

    const malformedSource = await harness({ task: reviewed, source: false })
    malformedSource.agent.session.append('turn/start', { turn: 1 })
    malformedSource.agent.session.append('user/message', {
      id: MessageId('ordinary-review-source'), role: 'user', content: [{ type: 'text', text: 'Ordinary message.' }],
      source: { kind: 'ordinary-message' },
    } as never, { surfaceOp: 'append' })
    malformedSource.agent.session.append('assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'context' },
    })
    malformedSource.agent.session.append('user/message', {
      id: MessageId('malformed-review-source'), role: 'user', content: [{ type: 'text', text: 'Malformed review.' }],
      source: { kind: 'team-review-assignment' },
    } as never, { surfaceOp: 'append' })
    malformedSource.agent.session.append('user/message', {
      id: MessageId('other-review-source'), role: 'user', content: [{ type: 'text', text: 'Other review.' }],
      source: {
        kind: 'team-review-assignment', teamId: reviewed.teamId, channelId: 'channel-review-tool-team',
        envelopeId: 'envelope-other-review', taskId: 'other-review-task', attemptId: attempt.id,
        reviewRevision: reviewed.revision, reviewerId: 'participant-tool-team',
        initiatorId: 'participant-team-final-recipient', result: attempt.outcome.result,
      },
    } as never, { surfaceOp: 'append' })
    const malformedSourceResult = await malformedSource.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'No valid source.' }, malformedSource.agent, 'team_task_review')
    expect(malformedSourceResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_SOURCE_REQUIRED')

    const invalidResponse = await harness({ task: reviewed, source: false })
    appendReviewAssignment(invalidResponse)
    invalidResponse.link.post.mockResolvedValueOnce(teamEnvelopeSchema.parse({
      id: 'envelope-review-response-wrong-kind', teamId: reviewed.teamId, channelId: 'channel-review-tool-team', sequence: 4,
      senderId: 'participant-tool-team', audience: ['participant-team-final-recipient'], kind: 'message',
      payload: { text: 'wrong' }, delivery: 'turn', priority: 'normal', createdAt: 4,
    }))
    const invalidResponseResult = await invalidResponse.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Invalid response.' }, invalidResponse.agent, 'team_task_review')
    expect(invalidResponseResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_RESPONSE_INVALID')

    const staleResult = await harness({ task: reviewed, source: false })
    appendReviewAssignment(staleResult, { reviewRevision: reviewed.revision + 1 })
    const stale = await staleResult.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Stale.' }, staleResult.agent, 'team_task_review')
    expect(stale.error?.info?.code).toBe('TEAM_TASK_REVIEW_UNAUTHORIZED')

    const unexpected = await harness({ task: reviewed, source: false })
    appendReviewAssignment(unexpected)
    unexpected.link.post.mockResolvedValueOnce(teamEnvelopeSchema.parse({
      id: 'envelope-review-response-unexpected', teamId: reviewed.teamId, channelId: 'channel-review-tool-team', sequence: 4,
      senderId: 'participant-tool-team', audience: ['participant-team-final-recipient'], kind: 'response',
      payload: { text: 'Unexpected.', decision: 'accepted' }, delivery: 'turn',
      causationId: 'envelope-review-tool-team', taskId: reviewed.id, priority: 'normal', createdAt: 4,
    }))
    unexpected.link.resolveTaskReview.mockResolvedValueOnce(running)
    const unexpectedResult = await unexpected.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Unexpected.' }, unexpected.agent, 'team_task_review')
    expect(unexpectedResult.error?.info?.code).toBe('TEAM_TASK_REVIEW_INVALID_STATE')

    const closeFailure = await harness({ task: reviewed, source: false })
    appendReviewAssignment(closeFailure)
    closeFailure.link.post.mockResolvedValueOnce(teamEnvelopeSchema.parse({
      id: 'envelope-review-response-close', teamId: reviewed.teamId, channelId: 'channel-review-tool-team', sequence: 4,
      senderId: 'participant-tool-team', audience: ['participant-team-final-recipient'], kind: 'response',
      payload: { text: 'Accepted.', decision: 'accepted' }, delivery: 'turn',
      causationId: 'envelope-review-tool-team', taskId: reviewed.id, priority: 'normal', createdAt: 4,
    }))
    const accepted = teamTaskSnapshotSchema.parse({
      ...reviewed, revision: reviewed.revision + 1, phase: 'completed',
      reviewHistory: [{ attemptId: attempt.id, reviewerId: 'participant-tool-team', nextPhase: 'completed', reason: 'Accepted.', decidedAt: 4 }],
    })
    closeFailure.link.resolveTaskReview.mockResolvedValueOnce(accepted)
    closeFailure.link.close.mockRejectedValueOnce(new Error('review close failed'))
    const closeResult = await closeFailure.execute({ task_id: reviewed.id, decision: 'accepted', reason: 'Accepted.' }, closeFailure.agent, 'team_task_review')
    expect(value(closeResult)).toMatchObject({ task: { phase: 'completed' } })
  })
})
