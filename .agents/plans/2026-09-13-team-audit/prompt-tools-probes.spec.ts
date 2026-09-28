import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent, AgentStatus } from '@clocky/clocky-agent'
import { CallId } from '@clocky/clocky-llm'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import SystemPrompt from '@clocky/clocky-system-prompt'
import { participantIdSchema, teamTaskIdSchema, teamWorkflowPlanIdSchema } from '@clocky/clocky-team'
import type { TeamTaskId } from '@clocky/clocky-team'
import { TeamRunError } from '@clocky/clocky-team-run'
import type {
  TeamRunCoordinatorTaskAuthority,
  TeamRunDefaultWorkerTaskTerminal,
  TeamRunWorkflowPlanTerminal,
} from '@clocky/clocky-team-run'
import ToolRuntime from '@clocky/clocky-tools'
import type { ToolExecutionResult } from '@clocky/clocky-tools'
import * as ToolTeamTask from '../../../packages/team/tool-team-task/src/index.ts'

const noReview = { reviewPolicy: { kind: 'none' as const }, reviewResult: null, cancellation: null }
const noReviewValue = { review_policy: { kind: 'none' }, review_result: null, cancellation: null }

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
  if (failures.length > 0) throw new AggregateError(failures, 'tool-team-task test cleanup failed')
})

interface Harness {
  readonly ctx: Context
  readonly toolFiber: Awaited<ReturnType<Context['plugin']>>
  readonly agent: Agent
  readonly authority: TeamRunCoordinatorTaskAuthority
  readonly teamRuns: {
    readonly coordinatorTaskAuthority: ReturnType<typeof vi.fn>
    readonly setWorkerPoolSize: ReturnType<typeof vi.fn>
    readonly startDelegatedTask: ReturnType<typeof vi.fn>
    readonly startDefaultWorkerTask: ReturnType<typeof vi.fn>
    readonly waitForDefaultWorkerTask: ReturnType<typeof vi.fn>
    readonly listDefaultWorkerTasks: ReturnType<typeof vi.fn>
    readonly watchDefaultWorkerTasks: ReturnType<typeof vi.fn>
    readonly cancelDefaultWorkerTask: ReturnType<typeof vi.fn>
    readonly proposeDefaultWorkerTaskOwner: ReturnType<typeof vi.fn>
    readonly startWorkflowPlan: ReturnType<typeof vi.fn>
    readonly waitForWorkflowPlan: ReturnType<typeof vi.fn>
  }
  setEligible(value: boolean): void
  setStatus(value: AgentStatus): void
  emitTeamChanged(): void
  emitChannelChanged(): void
  delegate(args: Record<string, unknown>, callId?: string, rootCallId?: string): Promise<ToolExecutionResult>
  start(args: Record<string, unknown>, callId?: string, rootCallId?: string): Promise<ToolExecutionResult>
  setWorkerPool(args: Record<string, unknown>, callId?: string): Promise<ToolExecutionResult>
  wait(args: Record<string, unknown>, callId?: string): Promise<ToolExecutionResult>
  list(): Promise<ToolExecutionResult>
  watch(args: Record<string, unknown>, callId?: string): Promise<ToolExecutionResult>
  cancel(args: Record<string, unknown>, callId?: string): Promise<ToolExecutionResult>
  proposeOwner(args: Record<string, unknown>, callId?: string): Promise<ToolExecutionResult>
  workflowStart(args: Record<string, unknown>, callId?: string, rootCallId?: string): Promise<ToolExecutionResult>
  workflowWait(args: Record<string, unknown>, callId?: string): Promise<ToolExecutionResult>
}

/** Build a scoped Tool runtime with a fake TeamRun authority boundary. */
async function harness(options: { readonly initiallyEligible?: boolean; readonly mountAfterAgent?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  const authority = {} as TeamRunCoordinatorTaskAuthority
  let eligible = options.initiallyEligible ?? false
  const terminals: TeamRunDefaultWorkerTaskTerminal[] = [
    { ...noReview, id: taskId('task-completed'), phase: 'completed', result: { summary: 'Completed work.' } },
    { ...noReview, id: taskId('task-failed'), phase: 'failed', outcome: { kind: 'failed', failure: { code: 'WORKER_FAILED', message: 'Worker could not complete the task.' } } },
    { ...noReview, id: taskId('task-released'), phase: 'failed', outcome: { kind: 'released' } },
    { ...noReview, id: taskId('task-expired'), phase: 'failed', outcome: { kind: 'lease-expired' } },
    { ...noReview, id: taskId('task-cancelled'), phase: 'cancelled' },
    { ...noReview, id: taskId('task-deleted'), phase: 'deleted' },
  ]
  const planId = teamWorkflowPlanIdSchema.parse('workflow-plan-started')
  const workflowTerminal: TeamRunWorkflowPlanTerminal = {
    id: planId,
    phase: 'completed',
    result: { kind: 'task-results', tasks: [] },
  }
  const taskList = { tasks: [{ ...noReview, id: taskId('task-started'), phase: 'pending' as const }] }
  const proposedOwnerId = participantIdSchema.parse('participant-proposed-owner')
  const teamRuns = {
    coordinatorTaskAuthority: vi.fn((agent: Agent): TeamRunCoordinatorTaskAuthority => {
      if (!eligible || agent !== coordinator) {
        throw new TeamRunError('coordinator is outside the current default run', 'TEAM_RUN_COORDINATOR_INVALID')
      }
      return authority
    }),
    setWorkerPoolSize: vi.fn(async () => ({
      requestedCount: 6, targetCount: 4, maxCount: 4, workerCount: 4,
      activeCount: 2, idleCount: 0, busyCount: 2, queuedTaskCount: 3, saturated: true,
    })),
    startDelegatedTask: vi.fn(async () => ({ ...noReview, id: taskId('task-delegated'), phase: 'pending' as const })),
    startDefaultWorkerTask: vi.fn(async () => ({ ...noReview, id: taskId('task-started'), phase: 'pending' as const })),
    waitForDefaultWorkerTask: vi.fn(async () => terminals.shift() ?? {
      ...noReview, id: taskId('task-fallback'), phase: 'completed' as const, result: { summary: 'Fallback completion.' },
    }),
    listDefaultWorkerTasks: vi.fn(async () => taskList),
    watchDefaultWorkerTasks: vi.fn(async () => ({ cursor: 12, tasks: taskList.tasks })),
    cancelDefaultWorkerTask: vi.fn(async () => ({ ...noReview, id: taskId('task-started'), phase: 'cancelled' as const })),
    proposeDefaultWorkerTaskOwner: vi.fn(async () => ({
      id: taskId('task-started'), phase: 'pending' as const, proposedOwnerId,
    })),
    startWorkflowPlan: vi.fn(async () => ({ id: planId, phase: 'ready' as const })),
    waitForWorkflowPlan: vi.fn(async () => workflowTerminal),
  }
  ctx.provide('teamRuns', teamRuns as never)
  let toolFiber: Awaited<ReturnType<Context['plugin']>> | undefined
  if (options.mountAfterAgent !== true) toolFiber = await ctx.plugin(ToolTeamTask)

  const session = ctx.sessions.create(SessionId('tool-team-task-session'), { meta: { cwd: '/workspace' } })
  let status: AgentStatus = 'running'
  const coordinator = {} as Agent
  const agentCtx = ctx.extend({ agent: coordinator })
  Object.assign(coordinator, {
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
  Object.defineProperty(coordinator, 'status', { get: () => status })
  ctx.agents.register(coordinator)
  toolFiber ??= await ctx.plugin(ToolTeamTask)

  return {
    ctx,
    toolFiber,
    agent: coordinator,
    authority,
    teamRuns,
    setEligible(value) { eligible = value },
    setStatus(value) { status = value },
    emitTeamChanged() { ctx.emit('team/changed', { type: 'team/changed', team: {} } as never) },
    emitChannelChanged() { ctx.emit('channel/changed', { channelId: 'channel-tool-team-task', record: {} } as never) },
    async delegate(args, callId = 'delegate-call', rootCallId = callId) {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal, callId: CallId(callId), rootCallId: CallId(rootCallId),
        name: 'team_task_delegate', arguments: args, agent: coordinator,
      }))
    },
    async start(args, callId = 'start-call', rootCallId = callId) {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        rootCallId: CallId(rootCallId),
        name: 'team_task_start',
        arguments: args,
        agent: coordinator,
      }))
    },
    async setWorkerPool(args, callId = 'pool-call') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'team_worker_pool_set',
        arguments: args,
        agent: coordinator,
      }))
    },
    async wait(args, callId = 'wait-call') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'team_task_wait',
        arguments: args,
        agent: coordinator,
      }))
    },
    async list() {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId('list-call'),
        name: 'team_task_list',
        arguments: {},
        agent: coordinator,
      }))
    },
    async watch(args, callId = 'watch-call') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'team_task_watch',
        arguments: args,
        agent: coordinator,
      }))
    },
    async cancel(args, callId = 'cancel-call') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'team_task_cancel',
        arguments: args,
        agent: coordinator,
      }))
    },
    async proposeOwner(args, callId = 'propose-owner-call') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'team_task_propose_owner',
        arguments: args,
        agent: coordinator,
      }))
    },
    async workflowStart(args, callId = 'workflow-start-call', rootCallId = callId) {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        rootCallId: CallId(rootCallId),
        name: 'team_workflow_start',
        arguments: args,
        agent: coordinator,
      }))
    },
    async workflowWait(args, callId = 'workflow-wait-call') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'team_workflow_wait',
        arguments: args,
        agent: coordinator,
      }))
    },
  }
}

/** Minimal JSON workflow plan accepted by the model-facing plan tool. */
const workflowPlan = {
  version: 1,
  name: 'tool-plan',
  tasks: [{
    id: 'first', subject: 'First', description: 'Run first.', blockedBy: [], requiredCapabilities: ['worker'],
    priority: 0, readScopes: ['src'], writeScopes: ['out'], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1,
  }],
  bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
  channel: {
    participantRoles: ['coordinator', 'worker'],
    graph: {
      initial: { kind: 'participant', role: 'coordinator' },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }],
      maxTurns: 1,
    },
  },
  result: { kind: 'task-results', taskTemplateIds: ['first'] },
}

/** Brand one test task id at the external tool boundary. */
function taskId(value: string): TeamTaskId {
  return teamTaskIdSchema.parse(value)
}

/** Read the declared canonical tool value after asserting a successful execution. */
function value(result: ToolExecutionResult): unknown {
  if (result.isError) throw new Error(result.error?.message)
  return result.value
}


describe('Team model tool audit probes', () => {
  it('drops structured worker evidence from the coordinator result', async () => {
    const mounted = await harness({ initiallyEligible: true })
    mounted.teamRuns.waitForDefaultWorkerTask.mockResolvedValueOnce({
      ...noReview, id: taskId('task-evidence'), phase: 'completed',
      result: { summary: 'Audit complete.', evidence: ['Failure reproduced'], changedPaths: ['report.md'], verification: 'pnpm test passed', artifacts: [{ id: 'a', kind: 'report', uri: 'artifact:a', visibility: 'team' }] },
    })
    const result = value(await mounted.wait({ task_id: 'task-evidence' }))
    expect(result).toEqual({ ...noReviewValue, task_id: 'task-evidence', phase: 'completed', summary: 'Audit complete.' })
  })
  it('has no cursor in the list although watch tells the model to use it', async () => {
    const mounted = await harness({ initiallyEligible: true })
    expect(value(await mounted.list())).not.toHaveProperty('cursor')
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)?.description).toContain('previous list or watch result')
  })
  it('keeps expired and released failure causes indistinguishable in the output', async () => {
    const mounted = await harness({ initiallyEligible: true })
    for (const kind of ['released', 'lease-expired']) {
      mounted.teamRuns.waitForDefaultWorkerTask.mockResolvedValueOnce({ ...noReview, id: taskId('task-terminal'), phase: 'failed', outcome: { kind } })
      expect(value(await mounted.wait({ task_id: 'task-terminal' }))).toEqual({ ...noReviewValue, task_id: 'task-terminal', phase: 'failed' })
    }
  })
  it('offers no structured plan schema or runnable minimal plan in tool instructions', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const tool = mounted.ctx.tools.get('team_workflow_start', mounted.agent)
    expect(tool?.parameters).toMatchObject({ properties: { plan: { description: 'Complete JSON-serializable TeamWorkflowPlan.' } } })
    expect(JSON.stringify(tool?.parameters)).not.toContain('maxTotalAttempts')
    expect(tool?.description).not.toContain('maxTotalAttempts')
    expect(tool?.description).not.toContain('taskTemplateIds')
    expect((await mounted.workflowStart({ plan: { tasks: [] } })).isError).toBe(true)
    expect(mounted.teamRuns.startWorkflowPlan).not.toHaveBeenCalled()
  })
})
