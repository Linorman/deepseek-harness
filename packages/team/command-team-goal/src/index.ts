/**
 * Scoped human-facing `/goal` command for the durable Team objective.
 *
 * @module @clocky/clocky-command-team-goal
 */

import type { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import type { CommandResult } from '@clocky/clocky-commands'
import {
  TeamError,
  teamIdSchema,
} from '@clocky/clocky-team'
import type { TeamGoalPhase, TeamGoalSnapshot } from '@clocky/clocky-team'

/** Cordis plugin name. */
export const name = 'command-team-goal'
/** Team-bound Agents, the command registry, and Team authority must exist before installation. */
export const inject = ['agents', 'commands', 'teams']

const USAGE = 'Usage: /goal [edit <objective>|pause|resume|complete|block <code> <message>]'
const ACTOR_REQUIRED = 'Changing a Team objective through /goal requires an authenticated Team actor.'

/** Closed command grammar for a Team-owned objective. */
type GoalCommand =
  | { readonly kind: 'show' }
  | { readonly kind: 'edit'; readonly objective: string }
  | { readonly kind: 'invalid-edit' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'block'; readonly code: string; readonly message: string }
  | { readonly kind: 'invalid-block' }
  | { readonly kind: 'invalid' }

/** Fail loudly if a locally closed union gains an unhandled member. */
/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never, label: string): never {
  throw new TypeError(`unknown ${label}: ${String(value)}`)
}
/* v8 ignore stop */

/** Parse only the Team-goal command grammar; implicit objective replacement is intentionally unavailable. */
function parseGoalCommand(rawInput: string): GoalCommand {
  const input = rawInput.trim()
  if (input.length === 0) return { kind: 'show' }
  const control = input.toLowerCase()
  if (control === 'pause') return { kind: 'pause' }
  if (control === 'resume') return { kind: 'resume' }
  if (control === 'complete') return { kind: 'complete' }
  if (control === 'edit') return { kind: 'invalid-edit' }
  if (/^edit(?=\s)/iu.test(input)) {
    const objective = input.slice('edit'.length).trim()
    return { kind: 'edit', objective }
  }
  if (control === 'block') return { kind: 'invalid-block' }
  const block = /^block\s+(\S+)(?:\s+(.+))?$/iu.exec(input)
  if (block !== null) {
    const code = block[1]
    const message = block[2]?.trim()
    if (code !== undefined && message !== undefined && message.length > 0) {
      return { kind: 'block', code, message }
    }
    return { kind: 'invalid-block' }
  }
  return { kind: 'invalid' }
}

/** Return the command's human-readable label for one durable Team-goal phase. */
function phaseLabel(phase: TeamGoalPhase): string {
  switch (phase) {
    case 'active': return 'active'
    case 'paused': return 'paused'
    case 'blocked': return 'blocked'
    case 'complete': return 'complete'
    /* v8 ignore next 2 -- TeamGoalPhase is closed and every member is handled above */
    default: return assertNever(phase, 'Team goal phase')
  }
}

/** Render the only currently usable Team-goal command path without advertising unavailable mutations. */
function commandHint(): string {
  return '/goal (objective mutations require an authenticated Team actor)'
}

/** Render a current Team goal without exposing Team-wide mutation internals. */
function renderGoal(title: string, goal: TeamGoalSnapshot): CommandResult {
  const blocker = goal.blocker === undefined ? [] : [`Blocker: ${goal.blocker.code}: ${goal.blocker.message}`]
  return {
    kind: 'success',
    text: [
      title,
      `Status: ${phaseLabel(goal.phase)}`,
      ...blocker,
      `Objective: ${goal.objective}`,
      `Budgets: ${JSON.stringify(goal.budgets)}`,
      '',
      `Commands: ${commandHint()}`,
    ].join('\n'),
  }
}

/** Read a fully validated Team identity from one local Agent's Session header for status-only access. */
function teamIdForAgent(agent: Agent): ReturnType<typeof teamIdSchema.parse> | undefined {
  const teamId = teamIdSchema.safeParse(agent.session.header.teamId)
  return teamId.success ? teamId.data : undefined
}

/** Map expected Team-state rejections into concise direct command output. */
function commandError(error: TeamError): CommandResult {
  switch (error.code) {
    case 'TEAM_GOAL_STALE_REVISION':
      return { kind: 'error', text: 'The Team goal changed while this command was pending. Run /goal and retry.' }
    case 'TEAM_POLICY_DENIED':
    case 'TEAM_PARTICIPANT_NOT_FOUND':
      return { kind: 'error', text: 'You are not authorized to change this Team goal.' }
    case 'TEAM_INVALID_ARGUMENT':
      return { kind: 'error', text: 'The Team goal command is not valid for the current state. Run /goal to view available commands.' }
    /* v8 ignore next 2 -- Team goal operations emit only the handled error codes above */
    default:
      throw error
  }
}

/** Execute one Team-goal command through the Team provider that owns persistence and policy. */
async function executeGoalCommand(
  ctx: Context,
  teamId: NonNullable<ReturnType<typeof teamIdForAgent>>,
  rawInput: string,
): Promise<CommandResult> {
  const command = parseGoalCommand(rawInput)
  try {
    switch (command.kind) {
      case 'show': {
        const state = await ctx.teams.getTeam({ teamId })
        return renderGoal('Goal', state.team.goal)
      }
      case 'invalid-edit':
        return { kind: 'error', text: `Goal editing requires a replacement objective.\n${USAGE}` }
      case 'invalid-block':
        return { kind: 'error', text: `Blocking requires a code and explanation.\n${USAGE}` }
      case 'invalid':
        return { kind: 'error', text: USAGE }
      case 'edit':
      case 'pause':
      case 'resume':
      case 'complete':
      case 'block':
        return { kind: 'error', text: ACTOR_REQUIRED }
      /* v8 ignore next 2 -- GoalCommand is closed and every member is handled above */
      default:
        return assertNever(command, 'Team goal command')
    }
  } catch (error: unknown) {
    if (error instanceof TeamError) return commandError(error)
    throw error
  }
}

/** Register `/goal` only in live Agent scopes whose Session headers identify a Team. */
export function apply(ctx: Context): void {
  const installed = new Map<Agent, () => void>()
  const install = (agent: Agent): void => {
    const teamId = teamIdForAgent(agent)
    if (installed.has(agent) || teamId === undefined) return
    const fiber = agent.ctx.plugin(Object.assign((scoped: Context) => {
      scoped.commands.register({
        name: 'goal',
        description: 'view this Team’s durable objective; authenticated product actors own mutations',
        input: { hint: '[edit <objective>|pause|resume|complete|block <code> <message>]' },
        handler: invocation => executeGoalCommand(ctx, teamId, invocation.rawInput),
      })
    }, { inject: ['commands'] }))
    installed.set(agent, () => { void fiber.dispose() })
  }
  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => { install(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'commandTeamGoal.scopedCommands()')
}
