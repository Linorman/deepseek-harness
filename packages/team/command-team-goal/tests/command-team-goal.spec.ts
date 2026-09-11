import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent, AgentStatus } from '@clocky/clocky-agent'
import CommandRuntime from '@clocky/clocky-commands'
import { createScope } from '@clocky/clocky-scope'
import {
  participantIdSchema,
  teamIdSchema,
  teamStateSnapshotSchema,
} from '@clocky/clocky-team'
import type { TeamGoalSnapshot, TeamStateSnapshot } from '@clocky/clocky-team'
import SessionStore, { Session, SessionId } from '@clocky/clocky-session'
import * as CommandTeamGoal from '../src/index.ts'

const contexts = new Set<Context>()
const teamId = teamIdSchema.parse('team-command-goal')
const participantId = participantIdSchema.parse('participant-command-goal')

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
  if (failures.length > 0) throw new AggregateError(failures, 'command-team-goal test cleanup failed')
})

/** Build one exact detached Team state with a replaceable goal projection. */
function state(goal: Partial<TeamGoalSnapshot> = {}): TeamStateSnapshot {
  const snapshot = {
    teamId,
    revision: 1,
    objective: 'Finish the Team migration.',
    phase: 'active' as const,
    budgets: { turns: 8 },
    ...goal,
  }
  return teamStateSnapshotSchema.parse({
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 2,
      phase: 'active',
      cursor: 4,
      createdAt: 1,
      updatedAt: 4,
      goal: snapshot,
    },
    goal: snapshot,
    rules: {},
    budgets: {},
    participants: [],
    activations: [],
    tasks: [],
    workspaceAllocations: [],
    channelIds: [],
  })
}

/** Build a live Agent with an optional durable Team Session header and scoped Cordis context. */
function agent(
  ctx: Context,
  id: string,
  teamHeader = true,
): { readonly agent: Agent; readonly session: Session; setStatus(status: AgentStatus): void } {
  const session = ctx.sessions.create(SessionId(id), teamHeader ? { meta: { teamId, participantId } } : {})
  let status: AgentStatus = 'idle'
  const value = {} as Agent
  const scope = createScope(ctx, value)
  Object.assign(value, {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    ctx: scope.ctx.extend({ agent: value }),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel: () => { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  Object.defineProperty(value, 'status', { get: () => status })
  return { agent: value, session, setStatus(next) { status = next } }
}

/** Mount the command against an inspectable Team service double. */
async function harness(options: { readonly teamHeader?: boolean } = {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  let current = state()
  const teams = {
    getTeam: vi.fn(async () => current),
    updateTeamGoal: vi.fn(async (request: { readonly objective: string }) => {
      current = state({ ...current.team.goal, revision: current.team.goal.revision + 1, objective: request.objective })
      return current
    }),
    transitionTeamGoalPhase: vi.fn(async (request: { phase: TeamGoalSnapshot['phase']; blocker?: TeamGoalSnapshot['blocker'] }) => {
      const { blocker: _priorBlocker, ...prior } = current.team.goal
      current = state({
        ...prior,
        revision: current.team.goal.revision + 1,
        phase: request.phase,
        ...request.phase === 'blocked' && request.blocker !== undefined ? { blocker: request.blocker } : {},
      })
      return current
    }),
  }
  ctx.provide('teams', teams as never)
  const live = agent(ctx, `command-team-goal-${Math.random()}`, options.teamHeader ?? true)
  ctx.agents.register(live.agent)
  const plugin = await ctx.plugin(CommandTeamGoal)
  const run = async (suffix = '') => {
    const execution = await ctx.commands.execute(live.agent, `/goal${suffix}`, [], new AbortController().signal)
    if (execution === undefined) throw new Error('Team goal command was not registered')
    return execution.result
  }
  return { ctx, plugin, live, teams, get current() { return current }, run }
}

describe('@clocky/clocky-command-team-goal registration', () => {
  it('uses Loader-safe function-plugin exports and scopes the command to Team-bound Agent Sessions', async () => {
    const test = await harness()
    expect(CommandTeamGoal.name).toBe('command-team-goal')
    expect(CommandTeamGoal.inject).toEqual(['agents', 'commands', 'teams'])
    expect('default' in CommandTeamGoal).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(CommandTeamGoal)).toBe(CommandTeamGoal)
    expect(test.ctx.commands.list(test.live.agent)).toContainEqual({
      name: 'goal',
      description: 'view this Team’s durable objective; authenticated product actors own mutations',
      input: { hint: '[edit <objective>|pause|resume|complete|block <code> <message>]' },
    })

    const outside = agent(test.ctx, 'outside-team-goal', false)
    test.ctx.agents.register(outside.agent)
    expect(test.ctx.commands.find(outside.agent, 'goal')).toBeUndefined()

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.live.agent, 'goal')).toBeUndefined()
  })

  it('installs for a Team-bound Agent created after the plugin and removes its scoped registration at disposal', async () => {
    const test = await harness({ teamHeader: false })
    expect(test.ctx.commands.find(test.live.agent, 'goal')).toBeUndefined()
    const later = agent(test.ctx, 'later-team-goal')
    const disposeLater = test.ctx.agents.register(later.agent)
    await vi.waitFor(() => { expect(test.ctx.commands.find(later.agent, 'goal')).toBeDefined() })
    disposeLater()
    await vi.waitFor(() => { expect(test.ctx.commands.find(later.agent, 'goal')).toBeUndefined() })
  })
})

describe('/goal Team command', () => {
  it('renders the durable objective but rejects mutation without an authenticated Team actor', async () => {
    const test = await harness()
    const shown = await test.run()
    expect(shown.kind).toBe('success')
    expect(shown.text).toContain('Status: active\nObjective: Finish the Team migration.\nBudgets: {"turns":8}')
    expect(shown.text).toContain('Commands: /goal (objective mutations require an authenticated Team actor)')

    const edited = await test.run(' edit\n  Finish the Team cutover.  ')
    expect(edited).toEqual({
      kind: 'error',
      text: 'Changing a Team objective through /goal requires an authenticated Team actor.',
    })
    expect(test.teams.updateTeamGoal).not.toHaveBeenCalled()
    expect(test.current.team.goal).toMatchObject({ revision: 1, objective: 'Finish the Team migration.' })
  })

  it('rejects every lifecycle mutation without calling the Team provider', async () => {
    const test = await harness()
    for (const input of [' pause', ' RESUME', ' block needs-input A human choice is required.', ' complete']) {
      await expect(test.run(input)).resolves.toEqual({
        kind: 'error',
        text: 'Changing a Team objective through /goal requires an authenticated Team actor.',
      })
    }
    expect(test.teams.transitionTeamGoalPhase).not.toHaveBeenCalled()
  })

  it('rejects incomplete and implicit grammar without calling the Team provider', async () => {
    const test = await harness()
    await expect(test.run(' edit')).resolves.toEqual({
      kind: 'error',
      text: 'Goal editing requires a replacement objective.\nUsage: /goal [edit <objective>|pause|resume|complete|block <code> <message>]',
    })
    await expect(test.run(' block needs-input')).resolves.toEqual({
      kind: 'error',
      text: 'Blocking requires a code and explanation.\nUsage: /goal [edit <objective>|pause|resume|complete|block <code> <message>]',
    })
    await expect(test.run(' block')).resolves.toEqual({
      kind: 'error',
      text: 'Blocking requires a code and explanation.\nUsage: /goal [edit <objective>|pause|resume|complete|block <code> <message>]',
    })
    await expect(test.run(' replace the objective')).resolves.toEqual({
      kind: 'error',
      text: 'Usage: /goal [edit <objective>|pause|resume|complete|block <code> <message>]',
    })
    expect(test.teams.updateTeamGoal).not.toHaveBeenCalled()
    expect(test.teams.transitionTeamGoalPhase).not.toHaveBeenCalled()
  })

  it('does not call mutation operations whose raw participant identity would bypass an actor proof', async () => {
    const test = await harness()
    await expect(test.run(' edit raced')).resolves.toEqual({
      kind: 'error',
      text: 'Changing a Team objective through /goal requires an authenticated Team actor.',
    })
    expect(test.teams.updateTeamGoal).not.toHaveBeenCalled()
    expect(test.teams.transitionTeamGoalPhase).not.toHaveBeenCalled()
  })

  it('does not turn unexpected provider errors into expected command results', async () => {
    const test = await harness()
    test.teams.getTeam.mockRejectedValueOnce(new Error('unexpected Team failure'))
    await expect(test.run()).rejects.toThrow('unexpected Team failure')
  })
})
