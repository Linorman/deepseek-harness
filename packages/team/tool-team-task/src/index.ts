/**
 * Model-facing worker and child-Team task creation, inspection, cancellation, and
 * owner proposals for one exact live TeamRun coordinator.
 *
 * @module @clocky/clocky-tool-team-task
 */

import type { Context } from '@clocky/cordis'
import { isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { resolveAgentWorkspaceRoot, type Agent } from '@clocky/clocky-agent'
import { HarnessError } from '@clocky/clocky-llm'
import {
  teamTaskCreateIdempotencyKeySchema,
  teamResourceBudgetSchema,
  teamTaskIdSchema,
  participantIdSchema,
  teamWorkflowPlanIdSchema,
  teamWorkflowPlanSchema,
  teamWorkflowPlanIdempotencyKeySchema,
  teamWorkflowTaskTemplateIdSchema,
} from '@clocky/clocky-team'
import type { TeamTaskPhase, TeamWorkflowPlan } from '@clocky/clocky-team'
import type { JsonValue as ToolJsonValue } from '@clocky/clocky-session'
import { TeamRunError } from '@clocky/clocky-team-run'
import type {
  TeamRunCoordinatorTaskAuthority,
  TeamRunDefaultWorkerTaskStatus,
  TeamRunDefaultWorkerTaskTerminal,
  TeamRunWorkerPoolStatus,
  TeamRunWorkflowPlanTerminal,
} from '@clocky/clocky-team-run'
import { defineTool } from '@clocky/clocky-tools'
import type { GenericCallView, ToolRunContext } from '@clocky/clocky-tools'

/** Cordis plugin name. */
export const name = 'tool-team-task'
/** TeamRun authority, live Agent discovery, and scoped Tool registration must exist before installation. */
export const inject = ['teamRuns', 'agents', 'tools']

const TASK_PHASES = ['pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled', 'deleted'] as const satisfies readonly TeamTaskPhase[]

/** Bounded review facts in the tool's field naming convention. */
interface TaskReviewValue {
  readonly child_team_id?: string
  readonly delegation_result?: ToolJsonValue
  readonly cancellation: { readonly requested_revision: number; readonly attempt_id: string | null; readonly expired: boolean } | null
  readonly review_policy: { readonly kind: 'none' } | { readonly kind: 'participant'; readonly reviewer_id: string }
  readonly review_result: { readonly attempt_id: string; readonly decision: 'accepted' | 'rework' } | null
}

/** Compact accepted or replayed default-worker task identity. */
interface TaskStartValue extends TaskReviewValue {
  readonly task_id: string
  readonly phase: TeamTaskPhase
}

/** Compact coordinator-owned task list. */
interface TaskListValue {
  readonly tasks: readonly TaskStartValue[]
}

/** Compact cursor and coordinator-owned task progress snapshot. */
interface TaskWatchValue {
  readonly cursor: number
  readonly tasks: readonly TaskStartValue[]
}

/** Compact task cancellation result. */
interface TaskCancelValue extends TaskReviewValue {
  readonly task_id: string
  readonly phase: TeamTaskPhase
}

/** Compact advisory owner-proposal result. */
interface TaskOwnerProposalValue {
  readonly task_id: string
  readonly phase: TeamTaskPhase
  readonly proposed_owner_id?: string
}

/** Compact worker-pool capacity returned after a coordinator resize request. */
type WorkerPoolValue = {
  readonly requested_workers: number
  readonly target_workers: number
  readonly max_workers: number
  readonly worker_count: number
  readonly active_workers: number
  readonly idle_workers: number
  readonly busy_workers: number
  readonly queued_tasks: number
  readonly saturated: boolean
}

/** Compact terminal default-worker task result without worker execution details. */
type TaskWaitValue = TaskReviewValue & (
  | { readonly task_id: string; readonly phase: 'completed'; readonly summary: string }
  | { readonly task_id: string; readonly phase: 'failed'; readonly failure?: { readonly code: string; readonly message: string } }
  | { readonly task_id: string; readonly phase: 'cancelled' | 'deleted' }
)

const REVIEW_FACTS_DESCRIPTION = ' Review facts select the active attempt, or the latest settled attempt when none is active. '
  + 'A null review_result means that attempt has no review decision, not that review is disabled.'

const REVIEW_PROPERTIES = {
  child_team_id: { type: 'string' },
  delegation_result: { type: 'json', description: 'Accepted child Team response text and artifact references.' },
  cancellation: {
    required: true,
    description: 'Null without a single-task stop request. A non-terminal phase means owner termination is still pending, even after expiry.',
    oneOf: [
      { type: 'null' },
      { type: 'object', additionalProperties: false, properties: {
        requested_revision: { type: 'integer', required: true },
        attempt_id: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
        expired: { type: 'boolean', required: true },
      } },
    ],
  },
  review_policy: {
    required: true,
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', required: true, const: 'none' } } },
      { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', required: true, const: 'participant' },
        reviewer_id: { type: 'string', required: true },
      } },
    ],
  },
  review_result: {
    required: true,
    description: 'Decision for the active attempt, or latest settled attempt when no attempt is active; null means no decision for that attempt.',
    oneOf: [
      { type: 'null' },
      { type: 'object', additionalProperties: false, properties: {
        attempt_id: { type: 'string', required: true },
        decision: { type: 'string', required: true, enum: ['accepted', 'rework'] },
      } },
    ],
  },
} as const

const TASK_START_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...REVIEW_PROPERTIES,
    task_id: { type: 'string', required: true },
    phase: { type: 'string', required: true, enum: TASK_PHASES },
  },
} as const

const TASK_WAIT_VALUE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...REVIEW_PROPERTIES,
        task_id: { type: 'string', required: true },
        phase: { type: 'string', required: true, const: 'completed' },
        summary: { type: 'string', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...REVIEW_PROPERTIES,
        task_id: { type: 'string', required: true },
        phase: { type: 'string', required: true, const: 'failed' },
        failure: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...REVIEW_PROPERTIES,
        task_id: { type: 'string', required: true },
        phase: { type: 'string', required: true, enum: ['cancelled', 'deleted'] },
      },
    },
  ],
} as const

const TASK_START_OUTPUT = {
  schema: TASK_START_VALUE_SCHEMA,
  render: (_args: unknown, value: TaskStartValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const TASK_WAIT_OUTPUT = {
  schema: TASK_WAIT_VALUE_SCHEMA,
  render: (_args: unknown, value: TaskWaitValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const TASK_LIST_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tasks: {
        type: 'array',
        required: true,
        items: TASK_START_VALUE_SCHEMA,
      },
    },
  },
  render: (_args: unknown, value: TaskListValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

const TASK_WATCH_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      cursor: { type: 'integer', required: true },
      tasks: {
        type: 'array',
        required: true,
        items: TASK_START_VALUE_SCHEMA,
      },
    },
  },
  render: (_args: unknown, value: TaskWatchValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

const TASK_CANCEL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...REVIEW_PROPERTIES,
      task_id: { type: 'string', required: true },
      phase: { type: 'string', required: true, enum: TASK_PHASES },
    },
  },
  render: (_args: unknown, value: TaskCancelValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

const TASK_OWNER_PROPOSAL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      task_id: { type: 'string', required: true },
      phase: { type: 'string', required: true, enum: TASK_PHASES },
      proposed_owner_id: { type: 'string' },
    },
  },
  render: (_args: unknown, value: TaskOwnerProposalValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

const WORKER_POOL_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      requested_workers: { type: 'integer', required: true },
      target_workers: { type: 'integer', required: true },
      max_workers: { type: 'integer', required: true },
      worker_count: { type: 'integer', required: true },
      active_workers: { type: 'integer', required: true },
      idle_workers: { type: 'integer', required: true },
      busy_workers: { type: 'integer', required: true },
      queued_tasks: { type: 'integer', required: true },
      saturated: { type: 'boolean', required: true },
    },
  },
  render: (_args: unknown, value: WorkerPoolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

/** Compact workflow-plan admission identity. */
interface WorkflowStartValue {
  readonly plan_id: string
  readonly phase: 'compiling' | 'ready' | 'completed' | 'failed' | 'cancelled'
}

/** Compact terminal workflow-plan result. */
type WorkflowWaitValue =
  | { readonly plan_id: string; readonly phase: 'completed'; readonly result: ToolJsonValue }
  | { readonly plan_id: string; readonly phase: 'failed'; readonly failure?: { readonly code: string; readonly message: string }; readonly result?: ToolJsonValue }
  | { readonly plan_id: string; readonly phase: 'cancelled'; readonly cancellation?: { readonly code: string; readonly message: string }; readonly result?: ToolJsonValue }

const WORKFLOW_START_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    plan_id: { type: 'string', required: true },
    phase: { type: 'string', required: true, enum: ['compiling', 'ready', 'completed', 'failed', 'cancelled'] },
  },
} as const

const WORKFLOW_WAIT_VALUE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        plan_id: { type: 'string', required: true },
        phase: { type: 'string', required: true, const: 'completed' },
        result: { type: 'json', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        plan_id: { type: 'string', required: true },
        phase: { type: 'string', required: true, const: 'failed' },
        result: { type: 'json' },
        failure: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        plan_id: { type: 'string', required: true },
        phase: { type: 'string', required: true, const: 'cancelled' },
        cancellation: {
          type: 'object',
          additionalProperties: false,
          properties: {
            code: { type: 'string', required: true },
            message: { type: 'string', required: true },
          },
        },
        result: { type: 'json' },
      },
    },
  ],
} as const

const WORKFLOW_START_OUTPUT = {
  schema: WORKFLOW_START_VALUE_SCHEMA,
  render: (_args: unknown, value: WorkflowStartValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

const WORKFLOW_WAIT_OUTPUT = {
  schema: WORKFLOW_WAIT_VALUE_SCHEMA,
  render: (_args: unknown, value: WorkflowWaitValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Render TeamRun worker-pool status in the tool's snake_case wire vocabulary. */
function workerPoolValue(value: TeamRunWorkerPoolStatus): WorkerPoolValue {
  return {
    requested_workers: value.requestedCount,
    target_workers: value.targetCount,
    max_workers: value.maxCount,
    worker_count: value.workerCount,
    active_workers: value.activeCount,
    idle_workers: value.idleCount,
    busy_workers: value.busyCount,
    queued_tasks: value.queuedTaskCount,
    saturated: value.saturated,
  }
}

/** Register default-worker task tools for one authority-approved coordinator Agent. */
function install(agent: Agent, ctx: Context, authority: TeamRunCoordinatorTaskAuthority): () => void {
  const unregisterWorkerPool = agent.ctx.tools.register(defineTool({
    name: 'team_worker_pool_set',
    description: 'Set the desired number of worker agents for this Team. '
      + 'For any non-trivial objective with multiple feasible workstreams, including research, analysis, writing, data, operations, coding, or mixed work, set at least 2 before starting independent work and increase it when the task graph has more parallel work. '
      + 'The request is capped by the deployment limit; tasks beyond currently available workers stay queued and are assigned as workers become idle, so do not wait for a slot before starting independent tasks.',
    parameters: {
      worker_count: { type: 'integer', required: true, description: 'Desired worker-pool size, including the default worker slot.' },
    },
    output: WORKER_POOL_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_worker_pool_set')
      return workerPoolValue(await ctx.teamRuns.setWorkerPoolSize(authority, { targetCount: args.worker_count }))
    },
    presentCall: args => presentWorkerPool(args.worker_count),
  }))
  const unregisterStart = agent.ctx.tools.register(defineTool({
    name: 'team_task_start',
    description: 'Start one independent, bounded Team task for the configured worker pool. '
      + 'Provide a concise subject, complete instructions, the expected deliverable, validation, and any filesystem regions the task may read or modify. '
      + 'For a non-trivial objective with multiple feasible workstreams, start at least two independent tasks before waiting. Use narrow, non-overlapping workspace-relative file scopes only for concurrent shared-workspace writers; leave scopes empty for work that does not touch files, and use a read-only research, analysis, or review task when only one writer is safe. '
      + 'Use workspace-relative read_scopes and write_scopes; absolute paths under the current workspace are converted, '
      + 'while paths outside the workspace are rejected. The current workspace and permission mode are shown in runtime context. '
      + 'The coordinator may set the pool with team_worker_pool_set; the scheduler assigns this task to an eligible '
      + 'idle worker, or leaves it queued when every worker is busy. The returned review_policy identifies the selected '
      + 'reviewer or none. The task continues after this call; start other independent tasks before waiting when useful, '
      + 'then use team_task_wait when a result is needed.'
      + REVIEW_FACTS_DESCRIPTION,
    parameters: {
      subject: { type: 'string', required: true, description: 'Concise statement of the task to perform.' },
      instructions: { type: 'string', required: true, description: 'Complete self-contained instructions for the worker.' },
      read_scopes: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths the task may read, such as src/file.ts. An absolute path under the current workspace is converted.' },
      write_scopes: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths the task may modify, such as src/file.ts. An absolute path under the current workspace is converted.' },
    },
    output: TASK_START_OUTPUT,
    async execute(args, exec) {
      const callingAgent = requireExecution(ctx, exec, agent, 'team_task_start')
      const task = await ctx.teamRuns.startDefaultWorkerTask(authority, {
        idempotencyKey: createIdempotencyKey(exec),
        subject: args.subject,
        instructions: args.instructions,
        readScopes: normalizeWorkspaceScopes(callingAgent, args.read_scopes ?? [], 'read_scopes'),
        writeScopes: normalizeWorkspaceScopes(callingAgent, args.write_scopes ?? [], 'write_scopes'),
      })
      return { task_id: task.id, phase: task.phase, ...reviewValue(task) }
    },
    presentCall: args => presentStart(args.subject),
  }))
  const unregisterDelegate = agent.ctx.tools.register(defineTool({
    name: 'team_task_delegate',
    description: 'Delegate a bounded task to a child Team with its own coordinator. Provide complete instructions, workspace-relative scopes, and explicit resource ceilings. The child shares this workspace and remains within this Team’s authority. Use team_task_list, team_task_watch, team_task_wait, or team_task_cancel with the returned task_id.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Concise task subject.' },
      instructions: { type: 'string', required: true, description: 'Self-contained child Team objective and expected result.' },
      read_scopes: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative readable paths.' },
      write_scopes: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative writable paths.' },
      budget: { type: 'json', required: true, description: 'Resource ceilings: maxInputTokens, maxOutputTokens, maxTotalTokens, maxTurns, maxWallTimeMs, maxCostUnits, maxRetries, maxConcurrency, maxArtifactBytes. Values cannot exceed this Team’s allowance.' },
      template_id: { type: 'string', description: 'Configured child template; supply template_version together. Omit both for this Team’s template.' },
      template_version: { type: 'integer', description: 'Exact version of template_id.' },
    },
    output: TASK_START_OUTPUT,
    async execute(args, exec) {
      const callingAgent = requireExecution(ctx, exec, agent, 'team_task_delegate')
      const task = await ctx.teamRuns.startDelegatedTask(authority, {
        idempotencyKey: createIdempotencyKey(exec, 'team_task_delegate'),
        subject: args.subject,
        instructions: args.instructions,
        readScopes: normalizeWorkspaceScopes(callingAgent, args.read_scopes ?? [], 'read_scopes'),
        writeScopes: normalizeWorkspaceScopes(callingAgent, args.write_scopes ?? [], 'write_scopes'),
        budget: teamResourceBudgetSchema.parse(args.budget),
        ...args.template_id === undefined ? {} : { templateId: args.template_id },
        ...args.template_version === undefined ? {} : { templateVersion: args.template_version },
      })
      return { task_id: task.id, phase: task.phase, ...reviewValue(task) }
    },
    presentCall: args => ({ card: 'generic', title: 'Delegate to child Team', kind: 'other', rawInput: args.subject }),
  }))
  const unregisterWait = agent.ctx.tools.register(defineTool({
    name: 'team_task_wait',
    description: 'Wait for a worker or child-Team task started by this coordinator, including any configured review. '
      + 'The result reports its review policy and the decision for its latest attempt. Use the task_id returned by team_task_start or team_task_delegate. Cancelling this call stops only the wait, not the task.'
      + REVIEW_FACTS_DESCRIPTION,
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact task id returned by team_task_start.' },
    },
    output: TASK_WAIT_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_task_wait')
      const terminal = await ctx.teamRuns.waitForDefaultWorkerTask(authority, {
        taskId: teamTaskIdSchema.parse(args.task_id),
        signal: exec.signal,
      })
      return terminalValue(terminal)
    },
    presentCall: args => presentWait(args.task_id),
  }))
  const unregisterList = agent.ctx.tools.register(defineTool({
    name: 'team_task_list',
    description: 'List the current phase, review facts, and accepted child response of every worker or child-Team task started by this coordinator. '
      + 'The list is bounded by the durable Team task set and excludes workflow-plan tasks.'
      + REVIEW_FACTS_DESCRIPTION,
    parameters: {},
    output: TASK_LIST_OUTPUT,
    async execute(_args, exec) {
      requireExecution(ctx, exec, agent, 'team_task_list')
      const listed = await ctx.teamRuns.listDefaultWorkerTasks(authority)
      return { tasks: listed.tasks.map(task => ({ task_id: task.id, phase: task.phase, ...reviewValue(task) })) }
    },
    presentCall: () => presentTaskList(),
  }))
  const unregisterWatch = agent.ctx.tools.register(defineTool({
    name: 'team_task_watch',
    description: 'Wait for a bounded Team cursor advance and return the compact state of this coordinator\'s worker and child-Team tasks. '
      + 'Provide the cursor from the previous list or watch result; cancelling this call stops only the watch.'
      + REVIEW_FACTS_DESCRIPTION,
    parameters: {
      after_cursor: { type: 'integer', description: 'Last Team cursor already observed; omit for an immediate snapshot.' },
    },
    output: TASK_WATCH_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_task_watch')
      const watched = await ctx.teamRuns.watchDefaultWorkerTasks(authority, {
        ...args.after_cursor === undefined ? {} : { afterCursor: args.after_cursor },
        signal: exec.signal,
      })
      return { cursor: watched.cursor, tasks: watched.tasks.map(task => ({ task_id: task.id, phase: task.phase, ...reviewValue(task) })) }
    },
    presentCall: args => presentTaskWatch(args.after_cursor),
  }))
  const unregisterCancel = agent.ctx.tools.register(defineTool({
    name: 'team_task_cancel',
    description: 'Request cancellation of one worker-pool Team task while the Team and other tasks continue. '
      + 'Assigned or running tasks remain non-terminal until their exact owner stops work and releases resources; use team_task_wait to observe settlement.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact task id returned by team_task_start.' },
      reason: { type: 'string', description: 'Optional explanation retained with the first accepted cancellation.' },
    },
    output: TASK_CANCEL_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_task_cancel')
      const task = await ctx.teamRuns.cancelDefaultWorkerTask(authority, {
        taskId: teamTaskIdSchema.parse(args.task_id),
        ...args.reason === undefined ? {} : { reason: args.reason },
      })
      return { task_id: task.id, phase: task.phase, ...reviewValue(task) }
    },
    presentCall: args => presentTaskCancel(args.task_id),
  }))
  const unregisterOwnerProposal = agent.ctx.tools.register(defineTool({
    name: 'team_task_propose_owner',
    description: 'Set or clear an advisory preferred owner for one pending default-worker Team task. '
      + 'The proposal grants no authority; the scheduler still checks capabilities, availability, workspace, and budgets.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Exact task id returned by team_task_start.' },
      participant_id: { type: 'string', description: 'Preferred Team Participant id; omit to clear the current proposal.' },
    },
    output: TASK_OWNER_PROPOSAL_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_task_propose_owner')
      const proposed = await ctx.teamRuns.proposeDefaultWorkerTaskOwner(authority, {
        taskId: teamTaskIdSchema.parse(args.task_id),
        ...args.participant_id === undefined ? {} : { proposedOwnerId: participantIdSchema.parse(args.participant_id) },
      })
      return {
        task_id: proposed.id,
        phase: proposed.phase,
        ...proposed.proposedOwnerId === undefined ? {} : { proposed_owner_id: proposed.proposedOwnerId },
      }
    },
    presentCall: args => presentTaskOwnerProposal(args.task_id, args.participant_id),
  }))
  const unregisterWorkflowStart = agent.ctx.tools.register(defineTool({
    name: 'team_workflow_start',
    description: 'Compile one bounded declarative Team workflow from JSON. '
      + 'Provide task templates, plan-local dependencies, explicit bounds, and a versioned workflow channel graph. '
      + 'Use workspace-relative readScopes and writeScopes in every task template; absolute paths under the current workspace are converted, while outside paths are rejected. '
      + 'Do not provide JavaScript, filesystem code, or hidden control flow; the complete plan is validated before any task can run. '
      + 'The workflow continues after this call; use team_workflow_wait for its projected result.',
    parameters: {
      plan: { type: 'json', required: true, description: 'Complete JSON-serializable TeamWorkflowPlan.' },
    },
    output: WORKFLOW_START_OUTPUT,
    async execute(args, exec) {
      const callingAgent = requireExecution(ctx, exec, agent, 'team_workflow_start')
      const plan = normalizeWorkflowPlanScopes(teamWorkflowPlanSchema.parse(args.plan), callingAgent)
      const admitted = await ctx.teamRuns.startWorkflowPlan(authority, {
        idempotencyKey: workflowPlanIdempotencyKey(exec),
        plan,
        signal: exec.signal,
      })
      return { plan_id: admitted.id, phase: admitted.phase }
    },
    presentCall: args => presentWorkflowStart(args.plan),
  }))
  const unregisterWorkflowTaskCancel = agent.ctx.tools.register(defineTool({
    name: 'team_workflow_task_cancel',
    description: 'Cancel one task in a workflow created by this coordinator, selected by its plan and task template. '
      + 'Its blocked descendants cancel when their prerequisite cannot complete; independent tasks continue. '
      + 'Use team_workflow_wait for the aggregate outcome and configured results.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Exact plan id returned by team_workflow_start.' },
      task_template_id: { type: 'string', required: true, description: 'Task template id in the admitted plan.' },
      reason: { type: 'string', description: 'Optional reason retained by the task stop intent.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        ...TASK_START_VALUE_SCHEMA.properties,
        plan_id: { type: 'string', required: true },
        task_template_id: { type: 'string', required: true },
        blocked_by_outcome: { type: 'json', required: true },
      } },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_workflow_task_cancel')
      const task = await ctx.teamRuns.cancelWorkflowTask(authority, {
        planId: teamWorkflowPlanIdSchema.parse(args.plan_id), templateId: teamWorkflowTaskTemplateIdSchema.parse(args.task_template_id),
        ...args.reason === undefined ? {} : { reason: args.reason },
      })
      return { plan_id: task.planId, task_template_id: task.templateId, task_id: task.id, phase: task.phase,
        ...reviewValue(task), blocked_by_outcome: task.blockedByOutcome === null ? null : {
          task_id: task.blockedByOutcome.taskId, revision: task.blockedByOutcome.revision, phase: task.blockedByOutcome.phase,
        } }
    },
    presentCall: args => ({ card: 'generic' as const, title: 'Cancel workflow task', kind: 'other' as const,
      rawInput: `${args.plan_id} / ${args.task_template_id}` }),
  }))
  const unregisterWorkflowWait = agent.ctx.tools.register(defineTool({
    name: 'team_workflow_wait',
    description: 'Wait for a declarative Team workflow started by this coordinator. '
      + 'Use the plan_id returned by team_workflow_start. Cancelling this call stops only the wait, not the workflow.',
    parameters: {
      plan_id: { type: 'string', required: true, description: 'Exact plan id returned by team_workflow_start.' },
    },
    output: WORKFLOW_WAIT_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_workflow_wait')
      const terminal = await ctx.teamRuns.waitForWorkflowPlan(authority, {
        planId: teamWorkflowPlanIdSchema.parse(args.plan_id),
        signal: exec.signal,
      })
      return workflowTerminalValue(terminal)
    },
    presentCall: args => presentWorkflowWait(args.plan_id),
  }))
  return () => {
    unregisterWorkflowTaskCancel()
    unregisterWorkflowWait()
    unregisterWorkflowStart()
    unregisterWait()
    unregisterStart()
    unregisterDelegate()
    unregisterCancel()
    unregisterWatch()
    unregisterList()
    unregisterOwnerProposal()
    unregisterWorkerPool()
  }
}

/** Register tools only in the exact live coordinator scope of a default Team run. */
export function apply(ctx: Context): void {
  const installed = new Map<Agent, () => void>()
  const reconcile = (agent: Agent): void => {
    let authority: TeamRunCoordinatorTaskAuthority
    try {
      authority = ctx.teamRuns.coordinatorTaskAuthority(agent)
    } catch (error: unknown) {
      if (isOutOfScope(error)) {
        installed.get(agent)?.()
        installed.delete(agent)
        return
      }
      throw error
    }
    if (installed.has(agent)) return
    installed.set(agent, install(agent, ctx, authority))
  }
  for (const agent of ctx.agents.list()) reconcile(agent)
  ctx.on('agent/created', ({ agent }) => { reconcile(agent) })
  ctx.on('team/changed', () => {
    for (const agent of ctx.agents.list()) reconcile(agent)
  })
  ctx.on('channel/changed', () => {
    for (const agent of ctx.agents.list()) reconcile(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'toolTeamTask.scopedTools()')
}

/** Derive the durable default-worker task-create identity from the complete model-call lineage. */
function createIdempotencyKey(exec: ToolRunContext, operation: 'team_task_start' | 'team_task_delegate' = 'team_task_start'): ReturnType<typeof teamTaskCreateIdempotencyKeySchema.parse> {
  return teamTaskCreateIdempotencyKeySchema.parse(JSON.stringify([operation, exec.rootCallId, exec.callId]))
}

/** Derive one stable workflow admission key from the complete model-call lineage. */
function workflowPlanIdempotencyKey(exec: ToolRunContext): ReturnType<typeof teamWorkflowPlanIdempotencyKeySchema.parse> {
  return teamWorkflowPlanIdempotencyKeySchema.parse(JSON.stringify(['team_workflow_start', exec.rootCallId, exec.callId]))
}

/** Normalize model-supplied task scopes against the exact current Agent workspace. */
function normalizeWorkspaceScopes(agent: Agent, scopes: readonly string[], field: 'read_scopes' | 'write_scopes'): readonly string[] {
  const workspace = resolveAgentWorkspaceRoot(agent)
  return scopes.map(scope => normalizeWorkspaceScope(scope, workspace, field))
}

/** Normalize every model-authored task scope in a declarative workflow plan. */
function normalizeWorkflowPlanScopes(plan: TeamWorkflowPlan, agent: Agent): TeamWorkflowPlan {
  const tasks = plan.tasks.map(task => ({
    ...task,
    readScopes: normalizeWorkspaceScopes(agent, task.readScopes, 'read_scopes'),
    writeScopes: normalizeWorkspaceScopes(agent, task.writeScopes, 'write_scopes'),
  }))
  return { ...plan, tasks }
}

/** Convert an in-workspace absolute scope to the Team wire form and reject escapes. */
function normalizeWorkspaceScope(value: string, workspace: string | undefined, field: 'read_scopes' | 'write_scopes'): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${field} must contain non-empty workspace-relative paths`)
  const windowsAbsolute = /^[a-z]:[\\/]/iu.test(trimmed)
  if (!isAbsolute(trimmed) && !windowsAbsolute) {
    const normalized = trimmed.replaceAll('\\', '/').replace(/^(?:\.\/)+/u, '').replace(/\/+$/u, '') || '.'
    const segments = normalized.split('/')
    if (normalized.startsWith('/') || (normalized !== '.' && segments.some(segment => segment === '.')) || segments.some(segment => segment === '..' || segment.length === 0)) {
      throw scopeOutsideWorkspace(field, value, workspace)
    }
    return normalized
  }
  if (workspace === undefined) {
    throw new Error(`${field} path ${JSON.stringify(value)} is absolute but the current Agent has no workspace root; use a workspace-relative path`)
  }
  const root = resolvePath(workspace)
  const candidate = resolvePath(trimmed)
  const relativePath = relative(root, candidate).replaceAll('\\', '/')
  if (relativePath === '') return '.'
  if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath) || /^[a-z]:/iu.test(relativePath)) {
    throw scopeOutsideWorkspace(field, value, root)
  }
  return relativePath
}

/** Render one actionable scope error that teaches the model the workspace boundary. */
function scopeOutsideWorkspace(field: string, value: string, workspace: string | undefined): Error {
  const root = workspace === undefined ? 'the current workspace' : JSON.stringify(resolvePath(workspace))
  return new Error(`${field} path ${JSON.stringify(value)} is outside ${root}; use a workspace-relative path such as "src/file.ts"`)
}

/** Render only the policy and matching attempt decision supplied by TeamRun. */
function reviewValue(value: TeamRunDefaultWorkerTaskStatus): TaskReviewValue {
  return {
    ...value.childTeamId === undefined ? {} : { child_team_id: value.childTeamId },
    ...value.delegationResult === undefined ? {} : { delegation_result: value.delegationResult as unknown as ToolJsonValue },
    cancellation: value.cancellation === null ? null : {
      requested_revision: value.cancellation.requestedRevision,
      attempt_id: value.cancellation.attemptId,
      expired: value.cancellation.expired,
    },
    review_policy: value.reviewPolicy.kind === 'none' ? { kind: 'none' }
      : { kind: 'participant', reviewer_id: value.reviewPolicy.reviewerId },
    review_result: value.reviewResult === null ? null : {
      attempt_id: value.reviewResult.attemptId, decision: value.reviewResult.decision,
    },
  }
}

/** Convert one retained TeamRun terminal state to the model-facing compact result. */
function terminalValue(terminal: TeamRunDefaultWorkerTaskTerminal): TaskWaitValue {
  switch (terminal.phase) {
    case 'completed':
      return { task_id: terminal.id, phase: terminal.phase, ...reviewValue(terminal), summary: terminal.result.summary }
    case 'failed':
      switch (terminal.outcome.kind) {
        case 'failed':
          return { task_id: terminal.id, phase: terminal.phase, ...reviewValue(terminal), failure: terminal.outcome.failure }
        case 'released':
        case 'lease-expired':
          return { task_id: terminal.id, phase: terminal.phase, ...reviewValue(terminal) }
        /* v8 ignore next -- TeamRunDefaultWorkerTaskTerminal retains a closed Team task outcome union. */
        default:
          return assertNever(terminal.outcome, 'default-worker task failure outcome')
      }
    case 'cancelled':
    case 'deleted':
      return { task_id: terminal.id, phase: terminal.phase, ...reviewValue(terminal) }
    /* v8 ignore next -- TeamRunDefaultWorkerTaskTerminal is a closed TeamRun projection. */
    default:
      return assertNever(terminal, 'default-worker task terminal state')
  }
}

/** Render a pure generic pending view for one default-worker task start. */
function presentStart(subject: string): GenericCallView {
  return { card: 'generic', title: 'Start Team task', kind: 'other', rawInput: subject }
}

/** Render a pure generic pending view for one default-worker task wait. */
function presentWait(taskId: string): GenericCallView {
  return { card: 'generic', title: 'Wait for Team task', kind: 'other', rawInput: taskId }
}

/** Render a pure generic pending view for one task list read. */
function presentTaskList(): GenericCallView {
  return { card: 'generic', title: 'List Team tasks', kind: 'other', rawInput: '' }
}

/** Render a pure generic pending view for one task progress watch. */
function presentTaskWatch(afterCursor: number | undefined): GenericCallView {
  return { card: 'generic', title: 'Watch Team tasks', kind: 'other', rawInput: afterCursor === undefined ? '' : String(afterCursor) }
}

/** Render a pure generic pending view for a worker-pool resize. */
function presentWorkerPool(workerCount: number): GenericCallView {
  return { card: 'generic', title: 'Set Team worker pool', kind: 'other', rawInput: String(workerCount) }
}

/** Render a pure generic pending view for one task cancellation. */
function presentTaskCancel(taskId: string): GenericCallView {
  return { card: 'generic', title: 'Cancel Team task', kind: 'other', rawInput: taskId }
}

/** Render a pure generic pending view for one task owner proposal. */
function presentTaskOwnerProposal(taskId: string, participantId: string | undefined): GenericCallView {
  return {
    card: 'generic',
    title: 'Propose Team task owner',
    kind: 'other',
    rawInput: participantId === undefined ? taskId : `${taskId} → ${participantId}`,
  }
}

/** Render a pure generic pending view for one workflow-plan start. */
function presentWorkflowStart(plan: unknown): GenericCallView {
  return { card: 'generic', title: 'Start Team workflow', kind: 'other', rawInput: JSON.stringify(plan) }
}

/** Render a pure generic pending view for one workflow-plan wait. */
function presentWorkflowWait(planId: string): GenericCallView {
  return { card: 'generic', title: 'Wait for Team workflow', kind: 'other', rawInput: planId }
}

/** Convert one durable workflow terminal to the model-facing result. */
function workflowTerminalValue(terminal: TeamRunWorkflowPlanTerminal): WorkflowWaitValue {
  switch (terminal.phase) {
    case 'completed':
      return { plan_id: terminal.id, phase: terminal.phase, result: terminal.result as unknown as ToolJsonValue }
    case 'failed':
      return { plan_id: terminal.id, phase: terminal.phase, failure: terminal.failure,
        ...terminal.result === undefined ? {} : { result: terminal.result as unknown as ToolJsonValue } }
    case 'cancelled':
      return { plan_id: terminal.id, phase: terminal.phase,
        ...terminal.cancellation === undefined ? {} : { cancellation: terminal.cancellation },
        ...terminal.result === undefined ? {} : { result: terminal.result as unknown as ToolJsonValue } }
    /* v8 ignore next -- TeamRunWorkflowPlanTerminal is a closed projection. */
    default:
      return assertNever(terminal, 'workflow terminal value')
  }
}

/** Confirm that the Tool runtime still invokes the exact coordinator Agent in its active driver. */
type TeamTaskToolName =
  | 'team_worker_pool_set'
  | 'team_task_start'
  | 'team_task_delegate'
  | 'team_task_wait'
  | 'team_task_list'
  | 'team_task_watch'
  | 'team_task_cancel'
  | 'team_task_propose_owner'
  | 'team_workflow_start'
  | 'team_workflow_wait'
  | 'team_workflow_task_cancel'

function requireExecution(
  ctx: Context,
  exec: ToolRunContext,
  scopedAgent: Agent,
  tool: TeamTaskToolName,
): Agent {
  const agent = exec.agent
  if (agent === undefined) throw executionError(tool, `${tool} requires a calling Agent`, 'AGENT_REQUIRED')
  if (agent !== scopedAgent || ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
    || ctx.agents.currentInitiator() !== agent) {
    throw executionError(tool, `${tool} requires its exact live scoped Agent inside an active driver`, 'DRIVER_REQUIRED')
  }
  return agent
}

/** Build one stable execution-authentication failure for a scoped default-worker task tool. */
function executionError(
  tool: TeamTaskToolName,
  message: string,
  suffix: 'AGENT_REQUIRED' | 'DRIVER_REQUIRED',
): HarnessError {
  const prefix = executionPrefix(tool)
  return new HarnessError(message, `${prefix}_${suffix}`)
}

/** Map one model-facing Team task tool to its stable execution-error prefix. */
function executionPrefix(tool: TeamTaskToolName): string {
  switch (tool) {
    case 'team_worker_pool_set': return 'TEAM_WORKER_POOL_SET'
    case 'team_task_start': return 'TEAM_TASK_START'
    case 'team_task_delegate': return 'TEAM_TASK_DELEGATE'
    case 'team_task_wait': return 'TEAM_TASK_WAIT'
    case 'team_task_list': return 'TEAM_TASK_LIST'
    case 'team_task_watch': return 'TEAM_TASK_WATCH'
    case 'team_task_cancel': return 'TEAM_TASK_CANCEL'
    case 'team_task_propose_owner': return 'TEAM_TASK_PROPOSE_OWNER'
    case 'team_workflow_start': return 'TEAM_WORKFLOW_START'
    case 'team_workflow_wait': return 'TEAM_WORKFLOW_WAIT'
    case 'team_workflow_task_cancel': return 'TEAM_WORKFLOW_TASK_CANCEL'
    default: return assertNever(tool, 'Team task tool name')
  }
}

/** Distinguish a normal non-coordinator discovery result from a TeamRun failure that must surface. */
function isOutOfScope(error: unknown): boolean {
  return error instanceof TeamRunError && error.code === 'TEAM_RUN_COORDINATOR_INVALID'
}

/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract. */
/** Fail loudly if a locally closed union gains an unhandled member. */
function assertNever(value: never, label: string): never {
  throw new TypeError(`unknown ${label}: ${String(value)}`)
}
/* v8 ignore stop */
