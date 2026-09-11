/**
 * Model-facing read and edit controls for one exact default Team coordinator's
 * durable objective.
 *
 * @module @clocky/clocky-tool-team-goal
 */

import type { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import { HarnessError } from '@clocky/clocky-llm'
import type { TeamGoalSnapshot } from '@clocky/clocky-team'
import type { TeamRunCoordinatorGoalAuthority } from '@clocky/clocky-team-run'
import { defineTool, ToolArgsError } from '@clocky/clocky-tools'
import type { GenericCallView, JsonValue, ToolRunContext } from '@clocky/clocky-tools'

/** Cordis plugin name. */
export const name = 'tool-team-goal'
/** TeamRun, live Agent discovery, and the scoped Tool registry must exist before installation. */
export const inject = ['teamRuns', 'agents', 'tools']

/** Compact model-facing durable Team objective. */
interface TeamGoalValue {
  readonly revision: number
  readonly objective: string
  readonly phase: TeamGoalSnapshot['phase']
  readonly blocker?: NonNullable<TeamGoalSnapshot['blocker']>
  readonly budgets: Record<string, JsonValue>
}

const GOAL_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    revision: { type: 'integer', required: true },
    objective: { type: 'string', required: true },
    phase: { type: 'string', required: true, enum: ['active', 'paused', 'blocked', 'complete'] },
    blocker: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
    budgets: { type: 'object', required: true, additionalProperties: true },
  },
} as const

const GOAL_OUTPUT = {
  schema: GOAL_VALUE_SCHEMA,
  render: (_args: unknown, value: TeamGoalValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Register one Team-goal read/edit pair in an exact live coordinator scope. */
function install(agent: Agent, ctx: Context, authority: TeamRunCoordinatorGoalAuthority): () => void {
  const unregisterGet = agent.ctx.tools.register(defineTool({
    name: 'get_goal',
    description: 'Read this Team’s durable objective, including its exact revision, phase, blocker, and budget.',
    parameters: {},
    output: GOAL_OUTPUT,
    async execute(_args, exec) {
      requireExecution(ctx, exec, agent, 'get_goal')
      return goalValue(await ctx.teamRuns.readCoordinatorGoal(authority))
    },
    presentCall: () => presentRead(),
  }))
  const unregisterUpdate = agent.ctx.tools.register(defineTool({
    name: 'update_goal',
    description: 'Replace this Team’s objective at the exact revision returned by get_goal. '
      + 'Use only when the current human message asks to revise the task.',
    parameters: {
      revision: { type: 'integer', required: true, description: 'Exact positive revision returned by get_goal.' },
      objective: { type: 'string', required: true, description: 'Replacement non-empty Team objective.' },
    },
    output: GOAL_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'update_goal')
      assertUpdateArguments(args)
      return goalValue(await ctx.teamRuns.updateCoordinatorGoal(authority, {
        expectedRevision: args.revision,
        objective: args.objective,
      }))
    },
    presentCall: args => presentUpdate(args.objective),
  }))
  const unregisterPhase = agent.ctx.tools.register(defineTool({
    name: 'team_goal_phase',
    description: 'Advance this Team objective to active, paused, blocked, or complete at the exact revision. '
      + 'A blocked objective must include a code and explanation.',
    parameters: {
      revision: { type: 'integer', required: true, description: 'Exact positive revision returned by get_goal.' },
      phase: { type: 'string', required: true, enum: ['active', 'paused', 'blocked', 'complete'] },
      blocker_code: { type: 'string', description: 'Required with blocked.' },
      blocker_message: { type: 'string', description: 'Required with blocked.' },
    },
    output: GOAL_OUTPUT,
    async execute(args, exec) {
      requireExecution(ctx, exec, agent, 'team_goal_phase')
      if (!Number.isSafeInteger(args.revision) || args.revision < 1) {
        throw new ToolArgsError(['"revision" must be a positive safe integer'])
      }
      const rawPhase: unknown = args.phase
      if (rawPhase !== 'active' && rawPhase !== 'paused' && rawPhase !== 'blocked' && rawPhase !== 'complete') {
        throw new ToolArgsError(['"phase" is not a supported Team objective phase'])
      }
      const phase = rawPhase
      const code = typeof args.blocker_code === 'string' ? args.blocker_code.trim() : ''
      const message = typeof args.blocker_message === 'string' ? args.blocker_message.trim() : ''
      if (phase === 'blocked' && (code.length === 0 || message.length === 0)) {
        throw new ToolArgsError(['blocked objective requires blocker_code and blocker_message'])
      }
      if (phase !== 'blocked' && (code.length > 0 || message.length > 0)) {
        throw new ToolArgsError(['blocker fields are valid only with blocked phase'])
      }
      return goalValue(await ctx.teamRuns.transitionCoordinatorGoalPhase(authority, {
        expectedRevision: args.revision,
        phase,
        ...phase === 'blocked' ? { blocker: { code, message } } : {},
      }))
    },
    presentCall: args => presentUpdate(args.phase),
  }))
  return () => {
    unregisterPhase()
    unregisterUpdate()
    unregisterGet()
  }
}

/** Reject structurally valid Tool JSON that cannot name a durable objective revision or replacement. */
function assertUpdateArguments(args: { readonly revision: number; readonly objective: string }): void {
  const violations: string[] = []
  if (!Number.isSafeInteger(args.revision) || args.revision < 1) {
    violations.push('"revision" must be a positive safe integer')
  }
  if (args.objective.trim().length === 0) violations.push('"objective" must contain non-whitespace text')
  if (violations.length > 0) throw new ToolArgsError(violations)
}

/** Register Team-goal controls only for exact live default TeamRun coordinators. */
/* jscpd:ignore-start */
export function apply(ctx: Context): void {
  const installed = new Map<Agent, () => void>()
  const reconcile = (agent: Agent): void => {
    const authority = ctx.teamRuns.tryCoordinatorGoalAuthority(agent)
    if (authority === undefined) {
      installed.get(agent)?.()
      installed.delete(agent)
      return
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
  }, 'toolTeamGoal.scopedTools()')
}
/* jscpd:ignore-end */

/** Project one durable objective without Team, Participant, Session, or activation identifiers. */
function goalValue(goal: TeamGoalSnapshot): TeamGoalValue {
  return {
    revision: goal.revision,
    objective: goal.objective,
    phase: goal.phase,
    ...goal.blocker === undefined ? {} : { blocker: goal.blocker },
    budgets: toolJsonObject(goal.budgets),
  }
}

/** Recast a durable Team JSON object for the Tool runtime's mutable JSON value vocabulary. */
function toolJsonObject(value: TeamGoalSnapshot['budgets']): Record<string, JsonValue> {
  return value as unknown as Record<string, JsonValue>
}

/** Render a pure generic pending view for a Team-objective read. */
function presentRead(): GenericCallView {
  return { card: 'generic', title: 'Read Team objective', kind: 'read' }
}

/** Render a pure generic pending view for a Team-objective edit. */
function presentUpdate(objective: string): GenericCallView {
  return { card: 'generic', title: 'Edit Team objective', kind: 'other', rawInput: objective }
}

/** Confirm that a Tool execution still runs under its exact live coordinator. */
/* jscpd:ignore-start */
function requireExecution(
  ctx: Context,
  exec: ToolRunContext,
  scopedAgent: Agent,
  tool: 'get_goal' | 'update_goal' | 'team_goal_phase',
): Agent {
  const agent = exec.agent
  if (agent === undefined) throw executionError(tool, `${tool} requires a calling Agent`, 'AGENT_REQUIRED')
  if (agent !== scopedAgent || ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
    || ctx.agents.currentInitiator() !== agent) {
    throw executionError(tool, `${tool} requires its exact live scoped Agent inside an active driver`, 'DRIVER_REQUIRED')
  }
  return agent
}
/* jscpd:ignore-end */

/** Build one stable execution-authentication failure for Team-goal tools. */
function executionError(
  tool: 'get_goal' | 'update_goal' | 'team_goal_phase',
  message: string,
  suffix: 'AGENT_REQUIRED' | 'DRIVER_REQUIRED',
): HarnessError {
  const prefix = tool === 'get_goal' ? 'TEAM_GOAL_GET' : tool === 'update_goal' ? 'TEAM_GOAL_UPDATE' : 'TEAM_GOAL_PHASE'
  return new HarnessError(message, `${prefix}_${suffix}`)
}
