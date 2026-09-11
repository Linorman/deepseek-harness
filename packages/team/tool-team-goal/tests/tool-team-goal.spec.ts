import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent, AgentStatus } from '@clocky/clocky-agent'
import { CallId } from '@clocky/clocky-llm'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import SystemPrompt from '@clocky/clocky-system-prompt'
import type { TeamGoalSnapshot } from '@clocky/clocky-team'
import type { TeamRunCoordinatorGoalAuthority } from '@clocky/clocky-team-run'
import ToolRuntime from '@clocky/clocky-tools'
import type { ToolExecutionResult } from '@clocky/clocky-tools'
import * as ToolTeamGoal from '../src/index.ts'

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
  if (failures.length > 0) throw new AggregateError(failures, 'tool-team-goal test cleanup failed')
})

interface Harness {
  readonly ctx: Context
  readonly toolFiber: Awaited<ReturnType<Context['plugin']>>
  readonly agent: Agent
  readonly authority: TeamRunCoordinatorGoalAuthority
  readonly teamRuns: {
    readonly tryCoordinatorGoalAuthority: ReturnType<typeof vi.fn>
    readonly readCoordinatorGoal: ReturnType<typeof vi.fn>
    readonly updateCoordinatorGoal: ReturnType<typeof vi.fn>
  }
  setEligible(value: boolean): void
  setStatus(value: AgentStatus): void
  emitTeamChanged(): void
  emitChannelChanged(): void
  get(callId?: string): Promise<ToolExecutionResult>
  update(args: Record<string, unknown>, callId?: string): Promise<ToolExecutionResult>
}

/** Build a scoped Tool runtime with a fake activation-fenced TeamRun authority. */
async function harness(options: { readonly initiallyEligible?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  const authority = {} as TeamRunCoordinatorGoalAuthority
  let eligible = options.initiallyEligible ?? false
  let current = goal()
  const coordinator = {} as Agent
  const teamRuns = {
    tryCoordinatorGoalAuthority: vi.fn((agent: Agent): TeamRunCoordinatorGoalAuthority | undefined => {
      if (!eligible || agent !== coordinator) {
        return undefined
      }
      return authority
    }),
    readCoordinatorGoal: vi.fn(async () => current),
    updateCoordinatorGoal: vi.fn(async (
      _authority: TeamRunCoordinatorGoalAuthority,
      request: { expectedRevision: number; objective: string },
    ) => {
      current = goal({ revision: request.expectedRevision + 1, objective: request.objective })
      return current
    }),
  }
  ctx.provide('teamRuns', teamRuns as never)
  const toolFiber = await ctx.plugin(ToolTeamGoal)

  const session = ctx.sessions.create(SessionId('tool-team-goal-session'))
  let status: AgentStatus = 'running'
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

  return {
    ctx,
    toolFiber,
    agent: coordinator,
    authority,
    teamRuns,
    setEligible(value) { eligible = value },
    setStatus(value) { status = value },
    emitTeamChanged() { ctx.emit('team/changed', { type: 'team/changed', team: {} } as never) },
    emitChannelChanged() { ctx.emit('channel/changed', { channelId: 'channel-tool-team-goal', record: {} } as never) },
    async get(callId = 'get-goal') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'get_goal',
        arguments: {},
        agent: coordinator,
      }))
    },
    async update(args, callId = 'update-goal') {
      return await ctx.agents.withInitiator(coordinator, async () => await ctx.tools.execute({
        signal,
        callId: CallId(callId),
        name: 'update_goal',
        arguments: args,
        agent: coordinator,
      }))
    },
  }
}

/** Build a detached current Team objective as the narrow model result. */
function goal(overrides: Partial<TeamGoalSnapshot> = {}): TeamGoalSnapshot {
  return {
    teamId: 'team-tool-team-goal' as TeamGoalSnapshot['teamId'],
    revision: 1,
    objective: 'Complete the Team objective.',
    phase: 'active',
    budgets: { turns: 2 },
    ...overrides,
  }
}

/** Read one successful model-tool value. */
function value(result: ToolExecutionResult): unknown {
  if (result.isError) throw new Error(result.error?.message)
  return result.value
}

describe('tool-team-goal', () => {
  it('registers only for an exact live default coordinator and removes both tools when that scope ends', async () => {
    const mounted = await harness()
    expect(mounted.ctx.tools.get('get_goal', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('update_goal', mounted.agent)).toBeUndefined()

    mounted.setEligible(true)
    mounted.emitChannelChanged()
    expect(mounted.ctx.tools.get('get_goal', mounted.agent)?.name).toBe('get_goal')
    expect(mounted.ctx.tools.get('update_goal', mounted.agent)?.name).toBe('update_goal')

    mounted.setEligible(false)
    mounted.emitTeamChanged()
    expect(mounted.ctx.tools.get('get_goal', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('update_goal', mounted.agent)).toBeUndefined()
  })

  it('removes its scoped registrations when its plugin fiber disposes', async () => {
    const mounted = await harness({ initiallyEligible: true })
    expect(mounted.ctx.tools.get('get_goal', mounted.agent)).toBeDefined()
    expect(mounted.ctx.tools.get('update_goal', mounted.agent)).toBeDefined()

    await mounted.toolFiber.dispose()
    expect(mounted.ctx.tools.get('get_goal', mounted.agent)).toBeUndefined()
    expect(mounted.ctx.tools.get('update_goal', mounted.agent)).toBeUndefined()
  })

  it('reads and edits only the durable Team objective through the coordinator authority', async () => {
    const mounted = await harness({ initiallyEligible: true })
    expect(mounted.ctx.tools.get('get_goal', mounted.agent)?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Read Team objective', kind: 'read',
    })
    expect(mounted.ctx.tools.get('update_goal', mounted.agent)?.presentCall?.({ revision: 1, objective: 'Ship Team Goal.' })).toEqual({
      card: 'generic', title: 'Edit Team objective', kind: 'other', rawInput: 'Ship Team Goal.',
    })
    expect(value(await mounted.get())).toEqual({
      revision: 1, objective: 'Complete the Team objective.', phase: 'active', budgets: { turns: 2 },
    })
    expect(value(await mounted.update({ revision: 1, objective: 'Ship Team Goal.' }))).toEqual({
      revision: 2, objective: 'Ship Team Goal.', phase: 'active', budgets: { turns: 2 },
    })
    expect(mounted.teamRuns.readCoordinatorGoal).toHaveBeenCalledWith(mounted.authority)
    expect(mounted.teamRuns.updateCoordinatorGoal).toHaveBeenCalledWith(mounted.authority, {
      expectedRevision: 1,
      objective: 'Ship Team Goal.',
    })
  })

  it('retains a blocked explanation without exposing Team identity', async () => {
    const mounted = await harness({ initiallyEligible: true })
    mounted.teamRuns.readCoordinatorGoal.mockResolvedValueOnce(goal({
      revision: 3,
      phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Choose a deployment target.' },
      budgets: {},
    }))
    expect(value(await mounted.get())).toEqual({
      revision: 3,
      objective: 'Complete the Team objective.',
      phase: 'blocked',
      blocker: { code: 'needs-input', message: 'Choose a deployment target.' },
      budgets: {},
    })
  })

  it('rejects invalid durable update arguments before calling TeamRun', async () => {
    const mounted = await harness({ initiallyEligible: true })
    for (const args of [
      { revision: 0, objective: 'A valid replacement.' },
      { revision: 1, objective: '   ' },
    ]) {
      const result = await mounted.update(args)
      expect(result.error?.info?.code).toBe('INVALID_ARGS')
    }
    expect(mounted.teamRuns.updateCoordinatorGoal).not.toHaveBeenCalled()
  })

  it('rejects driverless and stale execution at the tool boundary', async () => {
    const mounted = await harness({ initiallyEligible: true })
    const driverless = await mounted.ctx.tools.execute({
      signal,
      callId: CallId('driverless'),
      name: 'get_goal',
      arguments: {},
      agent: mounted.agent,
    })
    expect(driverless.error?.info?.code).toBe('TEAM_GOAL_GET_DRIVER_REQUIRED')

    mounted.setStatus('idle')
    const stale = await mounted.get('stale')
    expect(stale.error?.info?.code).toBe('TEAM_GOAL_GET_DRIVER_REQUIRED')

    const agentless = await mounted.ctx.tools.execute({
      signal,
      callId: CallId('agentless'),
      name: 'update_goal',
      arguments: { revision: 1, objective: 'x' },
    })
    expect(agentless.error?.info?.code).toBe('TEAM_GOAL_UPDATE_AGENT_REQUIRED')
  })
})
