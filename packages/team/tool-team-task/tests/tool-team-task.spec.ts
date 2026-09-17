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
import * as ToolTeamTask from '../src/index.ts'
import { WORKFLOW_PLAN_PARAMETER } from '../src/workflow-schema.ts'

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
    { ...noReview, id: taskId('task-completed'), phase: 'completed', result: { summary: 'Completed work.', evidence: ['Observed result'], verification: 'pnpm test', changedPaths: ['report.md'],
      artifacts: [{ id: 'report', kind: 'report', uri: 'file:///workspace/report.md', visibility: 'team' }],
      integration: { target: 'main', status: 'proposed', verification: 'patch checked' } } },
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
    viewPolicy: { type: 'recent-window', version: 1 },
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

describe('tool-team-task', () => {
  it('registers only after the exact default-run coordinator authority becomes live and removes the scoped tools when it no longer applies', async () => {
    const mounted = await harness()
    expect(mounted.ctx.tools.get('team_task_start', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_delegate', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_worker_pool_set', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_wait', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_start', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_wait', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_task_cancel', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_list', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_cancel', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_propose_owner', mounted.agent)).toBeUndefined()

    mounted.setEligible(true)
    mounted.emitChannelChanged()
    mounted.emitChannelChanged()
    expect(mounted.ctx.tools.get('team_task_start', mounted.agent)?.name).toBe('team_task_start')
    expect(mounted.ctx.tools.get('team_worker_pool_set', mounted.agent)?.name).toBe('team_worker_pool_set')
    expect(mounted.ctx.tools.get('team_task_wait', mounted.agent)?.name).toBe('team_task_wait')
    expect(mounted.ctx.tools.get('team_workflow_start', mounted.agent)?.name).toBe('team_workflow_start')
    expect(mounted.ctx.tools.get('team_workflow_wait', mounted.agent)?.name).toBe('team_workflow_wait')
    expect(mounted.ctx.tools.get('team_workflow_task_cancel', mounted.agent)?.name).toBe('team_workflow_task_cancel')
    expect(mounted.ctx.tools.get('team_task_list', mounted.agent)?.name).toBe('team_task_list')
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)?.name).toBe('team_task_watch')
    expect(mounted.ctx.tools.get('team_task_cancel', mounted.agent)?.name).toBe('team_task_cancel')
    expect(mounted.ctx.tools.get('team_task_propose_owner', mounted.agent)?.name).toBe('team_task_propose_owner')

    mounted.setEligible(false)
    mounted.emitTeamChanged()
    expect(mounted.ctx.tools.get('team_task_start', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_delegate', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_worker_pool_set', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_wait', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_start', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_wait', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_task_cancel', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_list', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_cancel', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_propose_owner', mounted.agent)).toBeUndefined()

    const initial = await harness({ initiallyEligible: true, mountAfterAgent: true })
    expect(initial.ctx.tools.get('team_task_start', initial.agent)).toBeDefined()
    expect(initial.ctx.tools.get('team_worker_pool_set', initial.agent)).toBeDefined()

    const failedReconcile = await harness({ initiallyEligible: true })
    failedReconcile.teamRuns.coordinatorTaskAuthority.mockImplementationOnce(() => {
      throw new Error('coordinator lookup failed')
    })
    expect(() => { failedReconcile.emitTeamChanged() }).toThrow('coordinator lookup failed')
  })

  it('removes both scoped registrations when its plugin fiber disposes', async () => {
    const mounted = await harness({ initiallyEligible: true })
    expect(mounted.ctx.tools.get('team_task_start', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_worker_pool_set', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_task_wait', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_workflow_start', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_workflow_wait', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_workflow_task_cancel', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_task_list', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_task_cancel', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('team_task_propose_owner', mounted.agent)).toBeDefined()

    await mounted.toolFiber.dispose()
    expect(mounted.ctx.tools.get('team_task_start', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_delegate', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_worker_pool_set', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_wait', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_start', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_wait', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_workflow_task_cancel', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_list', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_cancel', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('team_task_propose_owner', mounted.agent)).toBeUndefined()
  })

  it('delegates with a separate retry identity, normalized scopes, and parsed resource ceilings', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const result = await mounted.delegate({ subject: 'Research', instructions: 'Return evidence.',
      read_scopes: ['/workspace/src'], budget: { maxTurns: 4, maxConcurrency: 1 },
      template_id: 'research', template_version: 2,
    }, 'child', 'root')
    expect(value(result)).toEqual({ ...noReviewValue, task_id: 'task-delegated', phase: 'pending' })
    expect(mounted.teamRuns.startDelegatedTask).toHaveBeenCalledWith(mounted.authority, {
      idempotencyKey: '["team_task_delegate","root","child"]', subject: 'Research', instructions: 'Return evidence.',
      readScopes: ['src'], writeScopes: [], budget: { maxTurns: 4, maxConcurrency: 1 },
      templateId: 'research', templateVersion: 2,
    })
    expect(mounted.teamRuns.startDefaultWorkerTask).not.toHaveBeenCalled()
  })

  it('rejects invalid child ceilings and out-of-workspace scopes before delegation', async () => {
    const mounted = await harness({ initiallyEligible: true })
    for (const extra of [{ budget: { maxTurns: -1 } }, { budget: {}, read_scopes: ['/outside/file'] }]) {
      expect((await mounted.delegate({ subject: 'Research', instructions: 'Return evidence.', ...extra })).isError).toBe(true)
    }
    expect(mounted.teamRuns.startDelegatedTask).not.toHaveBeenCalled()
  })

  it('returns accepted child response evidence through the common task list', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const delegationResult = { text: 'Child findings.', artifacts: [{ id: 'report', kind: 'report', uri: 'artifact:report', visibility: 'team' }] }
    mounted.teamRuns.listDefaultWorkerTasks.mockResolvedValueOnce({ tasks: [{ ...noReview,
      id: taskId('task-delegated'), phase: 'completed', childTeamId: 'child-team', delegationResult,
    }] })
    expect(value(await mounted.list())).toEqual({ tasks: [{ ...noReviewValue,
      task_id: 'task-delegated', phase: 'completed', child_team_id: 'child-team', delegation_result: delegationResult,
    }] })
  })

  it('starts a task with a call-lineage key, explicit empty scopes, and a pure generic presentation', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const definition = mounted.ctx.tools.get('team_task_start', mounted.agent)
    expect(definition?.presentCall?.({ subject: 'Inspect the package', instructions: 'Read the package.' })).toEqual({
      card: 'generic', title: 'Start Team task', kind: 'other', rawInput: 'Inspect the package',
    })
    expect(definition?.presentCall?.({ subject: 'Inspect the package' })).toBeUndefined()

    const result = await mounted.start({ subject: 'Inspect the package', instructions: 'Read the package.' }, 'child-call', 'root-call')
    expect(value(result)).toEqual({ ...noReviewValue, task_id: 'task-started', phase: 'pending' })
    expect(mounted.teamRuns.startDefaultWorkerTask).toHaveBeenCalledWith(mounted.authority, {
      idempotencyKey: '["team_task_start","root-call","child-call"]',
      subject: 'Inspect the package',
      instructions: 'Read the package.',
      readScopes: [],
      writeScopes: [],
    })

    await mounted.start({
      subject: 'Inspect the package',
      instructions: 'Read the package.',
      read_scopes: ['packages/team'],
      write_scopes: ['packages/team/tool-team-task'],
    }, 'child-call', 'root-call')
    expect(mounted.teamRuns.startDefaultWorkerTask).toHaveBeenLastCalledWith(mounted.authority, expect.objectContaining({
      readScopes: ['packages/team'],
      writeScopes: ['packages/team/tool-team-task'],
    }))

    await mounted.start({
      subject: 'Inspect an absolute path',
      instructions: 'Read the workspace file.',
      read_scopes: ['/workspace/packages/team'],
      write_scopes: ['/workspace/packages/team/tool-team-task'],
    }, 'absolute-call', 'absolute-root')
    expect(mounted.teamRuns.startDefaultWorkerTask).toHaveBeenLastCalledWith(mounted.authority, expect.objectContaining({
      readScopes: ['packages/team'],
      writeScopes: ['packages/team/tool-team-task'],
    }))

    await mounted.start({
      subject: 'Inspect the workspace root',
      instructions: 'Read the workspace root.',
      read_scopes: ['/workspace'],
      write_scopes: ['/workspace/'],
    }, 'workspace-root-call', 'workspace-root-root')
    expect(mounted.teamRuns.startDefaultWorkerTask).toHaveBeenLastCalledWith(mounted.authority, expect.objectContaining({
      readScopes: ['.'],
      writeScopes: ['.'],
    }))

    const outside = await mounted.start({
      subject: 'Reject an outside path',
      instructions: 'Do not run this task.',
      read_scopes: ['/outside'],
    }, 'outside-call', 'outside-root')
    expect(outside.error?.message).toContain('outside')
    expect(mounted.teamRuns.startDefaultWorkerTask).toHaveBeenCalledTimes(4)
  })

  it('sets the coordinator-owned worker pool and exposes bounded saturation facts', async () => {
    const mounted = await harness({ initiallyEligible: true })
    expect(mounted.ctx.tools.get('team_worker_pool_set', mounted.agent)?.presentCall?.({ worker_count: 6 })).toEqual({
      card: 'generic', title: 'Set Team worker pool', kind: 'other', rawInput: '6',
    })
    expect(value(await mounted.setWorkerPool({ worker_count: 6 }))).toEqual({
      requested_workers: 6,
      target_workers: 4,
      max_workers: 4,
      worker_count: 4,
      active_workers: 2,
      idle_workers: 0,
      busy_workers: 2,
      queued_tasks: 3,
      saturated: true,
    })
    expect(mounted.teamRuns.setWorkerPoolSize).toHaveBeenCalledWith(mounted.authority, { targetCount: 6 })
  })

  it('maps terminal results without worker leases or transcripts and forwards wait cancellation only to TeamRun', async () => {
    const mounted = await harness({ initiallyEligible: true })
    expect(mounted.ctx.tools.get('team_task_wait', mounted.agent)?.presentCall?.({ task_id: 'task-completed' })).toEqual({
      card: 'generic', title: 'Wait for Team task', kind: 'other', rawInput: 'task-completed',
    })
    expect(mounted.ctx.tools.get('team_task_wait', mounted.agent)?.presentCall?.({})).toBeUndefined()
    expect(value(await mounted.wait({ task_id: 'task-completed' })))
      .toEqual({ ...noReviewValue, task_id: 'task-completed', phase: 'completed', summary: 'Completed work.', evidence: ['Observed result'], verification: 'pnpm test', changed_paths: ['report.md'],
        artifacts: [{ id: 'report', kind: 'report', uri: 'file:///workspace/report.md', visibility: 'team' }],
        integration: { target: 'main', status: 'proposed', verification: 'patch checked' } })
    expect(value(await mounted.wait({ task_id: 'task-failed' }, 'wait-failed')))
      .toEqual({ ...noReviewValue, task_id: 'task-failed', phase: 'failed', outcome: 'failed', failure: { code: 'WORKER_FAILED', message: 'Worker could not complete the task.' } })
    expect(value(await mounted.wait({ task_id: 'task-released' }, 'wait-released')))
      .toEqual({ ...noReviewValue, task_id: 'task-released', phase: 'failed', outcome: 'released' })
    expect(value(await mounted.wait({ task_id: 'task-expired' }, 'wait-expired')))
      .toEqual({ ...noReviewValue, task_id: 'task-expired', phase: 'failed', outcome: 'lease-expired' })
    expect(value(await mounted.wait({ task_id: 'task-cancelled' }, 'wait-cancelled')))
      .toEqual({ ...noReviewValue, task_id: 'task-cancelled', phase: 'cancelled' })
    expect(value(await mounted.wait({ task_id: 'task-deleted' }, 'wait-deleted')))
      .toEqual({ ...noReviewValue, task_id: 'task-deleted', phase: 'deleted' })
    expect(mounted.teamRuns.waitForDefaultWorkerTask).toHaveBeenCalledWith(mounted.authority, {
      taskId: 'task-deleted', signal,
    })
  })

  it('preserves a summary-only result without inventing evidence', async () => {
    const mounted = await harness({ initiallyEligible: true })
    mounted.teamRuns.waitForDefaultWorkerTask.mockResolvedValueOnce({
      ...noReview, id: taskId('minimal-result'), phase: 'completed', result: { summary: 'Summary only.' },
    })
    expect(value(await mounted.wait({ task_id: 'minimal-result' })))
      .toEqual({ ...noReviewValue, task_id: 'minimal-result', phase: 'completed', summary: 'Summary only.' })
  })

  it('executes the model-visible two-stage example and rejects a missing required plan field', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const example = structuredClone(WORKFLOW_PLAN_PARAMETER.examples[0])
    expect(value(await mounted.workflowStart({ plan: example }))).toMatchObject({ phase: 'ready' })
    expect(mounted.teamRuns.startWorkflowPlan).toHaveBeenCalledWith(mounted.authority,
      expect.objectContaining({ plan: example }))
    const invalid = { ...example, bounds: { maxTasks: 2, maxParallelism: 1 } }
    const failed = await mounted.workflowStart({ plan: invalid })
    expect(failed.isError).toBe(true)
    expect(failed.error?.message).toContain('maxTotalAttempts')
    expect(mounted.teamRuns.startWorkflowPlan).toHaveBeenCalledTimes(1)
    const watch = mounted.ctx.tools.get('team_task_watch', mounted.agent)
    expect(watch?.description).toContain('Omit after_cursor for an immediate first snapshot')
    expect(watch?.description).not.toContain('previous list')
  })

  it('passes only JSON workflow plans and complete call lineage to the TeamRun compiler', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const startDefinition = mounted.ctx.tools.get('team_workflow_start', mounted.agent)
    expect(startDefinition?.presentCall?.({ plan: workflowPlan })).toEqual({
      card: 'generic', title: 'Start Team workflow', kind: 'other', rawInput: JSON.stringify(workflowPlan),
    })
    expect(value(await mounted.workflowStart({ plan: workflowPlan }, 'child-workflow', 'root-workflow')))
      .toEqual({ plan_id: 'workflow-plan-started', phase: 'ready' })
    expect(mounted.teamRuns.startWorkflowPlan).toHaveBeenCalledWith(mounted.authority, {
      idempotencyKey: '["team_workflow_start","root-workflow","child-workflow"]',
      plan: workflowPlan,
      signal,
    })

    const absolutePlan = structuredClone(workflowPlan)
    absolutePlan.tasks[0]!.readScopes = ['/workspace/src']
    absolutePlan.tasks[0]!.writeScopes = ['/workspace/out']
    expect(value(await mounted.workflowStart({ plan: absolutePlan }, 'absolute-workflow', 'absolute-workflow-root')))
      .toEqual({ plan_id: 'workflow-plan-started', phase: 'ready' })
    const normalizedPlan = structuredClone(absolutePlan)
    normalizedPlan.tasks[0]!.readScopes = ['src']
    normalizedPlan.tasks[0]!.writeScopes = ['out']
    expect(mounted.teamRuns.startWorkflowPlan).toHaveBeenLastCalledWith(mounted.authority, {
      idempotencyKey: '["team_workflow_start","absolute-workflow-root","absolute-workflow"]',
      plan: normalizedPlan,
      signal,
    })

    const outsidePlan = structuredClone(workflowPlan)
    outsidePlan.tasks[0]!.readScopes = ['/outside']
    const outside = await mounted.workflowStart({ plan: outsidePlan }, 'outside-workflow', 'outside-workflow-root')
    expect(outside.error?.message).toContain('outside')

    expect(value(await mounted.workflowWait({ plan_id: 'workflow-plan-started' })))
      .toEqual({ plan_id: 'workflow-plan-started', phase: 'completed', result: { kind: 'task-results', tasks: [] } })
    expect(mounted.teamRuns.waitForWorkflowPlan).toHaveBeenCalledWith(mounted.authority, {
      planId: 'workflow-plan-started', signal,
    })

    mounted.teamRuns.waitForWorkflowPlan
      .mockResolvedValueOnce({ id: 'workflow-plan-started', phase: 'failed', failure: { code: 'WORKFLOW_FAILED', message: 'Compilation failed.' } })
      .mockResolvedValueOnce({ id: 'workflow-plan-started', phase: 'cancelled' })
    expect(value(await mounted.workflowWait({ plan_id: 'workflow-plan-started' })))
      .toEqual({ plan_id: 'workflow-plan-started', phase: 'failed', failure: { code: 'WORKFLOW_FAILED', message: 'Compilation failed.' } })
    expect(value(await mounted.workflowWait({ plan_id: 'workflow-plan-started' })))
      .toEqual({ plan_id: 'workflow-plan-started', phase: 'cancelled' })
    expect(mounted.ctx.tools.get('team_workflow_wait', mounted.agent)?.presentCall?.({ plan_id: 'workflow-plan-started' })).toEqual({
      card: 'generic', title: 'Wait for Team workflow', kind: 'other', rawInput: 'workflow-plan-started',
    })
  })

  it('exposes bounded list/watch/cancel operations only through the coordinator scope', async () => {
    const mounted = await harness({ initiallyEligible: true })
    expect(mounted.ctx.tools.get('team_task_list', mounted.agent)?.presentCall?.({})).toEqual({
      card: 'generic', title: 'List Team tasks', kind: 'other', rawInput: '',
    })
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)?.presentCall?.({ after_cursor: 7 })).toEqual({
      card: 'generic', title: 'Watch Team tasks', kind: 'other', rawInput: '7',
    })
    expect(mounted.ctx.tools.get('team_task_watch', mounted.agent)?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Watch Team tasks', kind: 'other', rawInput: '',
    })
    expect(mounted.ctx.tools.get('team_task_cancel', mounted.agent)?.presentCall?.({ task_id: 'task-started' })).toEqual({
      card: 'generic', title: 'Cancel Team task', kind: 'other', rawInput: 'task-started',
    })
    expect(value(await mounted.list())).toEqual({ tasks: [{ ...noReviewValue, task_id: 'task-started', phase: 'pending' }] })
    expect(value(await mounted.watch({ after_cursor: 7 }))).toEqual({
      cursor: 12,
      tasks: [{ ...noReviewValue, task_id: 'task-started', phase: 'pending' }],
    })
    expect(value(await mounted.watch({}))).toEqual({
      cursor: 12,
      tasks: [{ ...noReviewValue, task_id: 'task-started', phase: 'pending' }],
    })
    expect(value(await mounted.cancel({ task_id: 'task-started' })))
      .toEqual({ ...noReviewValue, task_id: 'task-started', phase: 'cancelled' })
    expect(mounted.teamRuns.listDefaultWorkerTasks).toHaveBeenCalledWith(mounted.authority)
    expect(mounted.teamRuns.watchDefaultWorkerTasks).toHaveBeenCalledWith(mounted.authority, {
      afterCursor: 7,
      signal,
    })
    expect(mounted.teamRuns.cancelDefaultWorkerTask).toHaveBeenCalledWith(mounted.authority, {
      taskId: 'task-started',
    })
  })

  it('maps an advisory owner proposal without implying assignment authority', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const participantId = 'participant-proposed-owner'
    expect(mounted.ctx.tools.get('team_task_propose_owner', mounted.agent)?.presentCall?.({
      task_id: 'task-started', participant_id: participantId,
    })).toEqual({
      card: 'generic', title: 'Propose Team task owner', kind: 'other', rawInput: `task-started → ${participantId}`,
    })
    expect(mounted.ctx.tools.get('team_task_propose_owner', mounted.agent)?.presentCall?.({ task_id: 'task-started' })).toEqual({
      card: 'generic', title: 'Propose Team task owner', kind: 'other', rawInput: 'task-started',
    })
    expect(value(await mounted.proposeOwner({ task_id: 'task-started', participant_id: participantId })))
      .toEqual({ task_id: 'task-started', phase: 'pending', proposed_owner_id: participantId })
    expect(mounted.teamRuns.proposeDefaultWorkerTaskOwner).toHaveBeenCalledWith(mounted.authority, {
      taskId: 'task-started', proposedOwnerId: participantId,
    })
    mounted.teamRuns.proposeDefaultWorkerTaskOwner.mockResolvedValueOnce({ id: taskId('task-started'), phase: 'pending' as const })
    expect(value(await mounted.proposeOwner({ task_id: 'task-started' })))
      .toEqual({ task_id: 'task-started', phase: 'pending' })
  })

  it('rejects stale and driverless executions in the executor', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const agentless = await mounted.ctx.tools.execute({
      signal,
      callId: CallId('agentless'),
      name: 'team_task_start',
      arguments: { subject: 'x', instructions: 'y' },
    })
    expect(agentless.error?.info?.code).toBe('TEAM_TASK_START_AGENT_REQUIRED')
    const driverless = await mounted.ctx.tools.execute({
      signal,
      callId: CallId('driverless'),
      name: 'team_task_start',
      arguments: { subject: 'x', instructions: 'y' },
      agent: mounted.agent,
    })
    expect(driverless.error?.info?.code).toBe('TEAM_TASK_START_DRIVER_REQUIRED')

    const driverlessCalls: readonly [string, Record<string, unknown>][] = [
      ['team_worker_pool_set', { worker_count: 2 }],
      ['team_task_wait', { task_id: 'task-started' }],
      ['team_task_list', {}],
      ['team_task_watch', {}],
      ['team_task_cancel', { task_id: 'task-started' }],
      ['team_task_propose_owner', { task_id: 'task-started' }],
      ['team_workflow_start', { plan: workflowPlan }],
      ['team_workflow_wait', { plan_id: 'workflow-plan-started' }],
    ]
    for (const [name, args] of driverlessCalls) {
      const result = await mounted.ctx.tools.execute({
        signal,
        callId: CallId(`driverless-${name}`),
        name,
        arguments: args,
        agent: mounted.agent,
      })
      expect(result.error?.info?.code).toBe(`${name.toUpperCase()}_DRIVER_REQUIRED`)
    }

    mounted.setStatus('idle')
    const idle = await mounted.start({ subject: 'x', instructions: 'y' }, 'idle-call')
    expect(idle.error?.info?.code).toBe('TEAM_TASK_START_DRIVER_REQUIRED')
  })

  it('keeps the Loader-safe namespace and scoped dependency declaration', () => {
    expect('default' in ToolTeamTask).toBe(false)
    expect(ToolTeamTask.name).toBe('tool-team-task')
    expect(ToolTeamTask.inject).toEqual(['teamRuns', 'agents', 'tools'])
  })
})
