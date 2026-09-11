import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent } from '@clocky/clocky-agent'
import CommandRuntime from '@clocky/clocky-commands'
import { createScope } from '@clocky/clocky-scope'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type { TeamPolicy } from '@clocky/clocky-team'
import TeamHub from '@clocky/clocky-team-hub'
import * as CommandTeamGoal from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []

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
  if (failures.length > 0) throw new AggregateError(failures, 'command-team-goal composition cleanup failed')
})

/** Mount a real local Team Hub and the command registry at a test-local durable path. */
async function setup(): Promise<Context> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'command-team-goal-composition-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  return ctx
}

/** Register a live Agent Session whose durable header identifies one active Team participant. */
function teamAgent(ctx: Context, teamId: string, participantId: string): Agent {
  const session = ctx.sessions.create(SessionId('command-team-goal-composition-session'), { meta: { teamId, participantId } })
  const agent = {} as Agent
  const scope = createScope(ctx, agent)
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx.extend({ agent }),
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  ctx.agents.register(agent)
  return agent
}

/** Move one human participant through the Team's durable membership lifecycle. */
async function activeParticipant(ctx: Context, teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id']) {
  let state = await ctx.teams.getTeam({ teamId })
  const participant = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'human',
    displayName: 'Operator',
    role: 'initiator',
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: participant.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

describe('command-team-goal real Team composition', () => {
  it('keeps a Session-header-only `/goal` command read-only in the real Hub', async () => {
    const ctx = await setup()
    const created = await createTestRootTeam(ctx, {
      goal: { objective: 'Prepare the release.', budgets: { turns: 4 } },
      rules: {},
      budgets: {},
    })
    const participant = await activeParticipant(ctx, created.team.id)
    const apply: TeamPolicy['apply'] = async (_request, next) => await next()
    const policy = vi.fn(apply)
    ctx.teams.registerPolicy('goal-mutate', { name: 'observe-goal-actor', apply: policy })
    const agent = teamAgent(ctx, created.team.id, participant.id)
    const commandFiber = await ctx.plugin(CommandTeamGoal)

    const execution = await ctx.commands.execute(
      agent,
      '/goal edit Ship the Team objective.',
      [],
      new AbortController().signal,
    )
    if (execution === undefined) throw new Error('Team goal command was not registered')
    expect(execution.result).toEqual({
      kind: 'error',
      text: 'Changing a Team objective through /goal requires an authenticated Team actor.',
    })
    const state = await ctx.teams.getTeam({ teamId: created.team.id })
    expect(state.team.goal).toMatchObject({ revision: 1, objective: 'Prepare the release.' })
    expect(policy).not.toHaveBeenCalled()

    await commandFiber.dispose()
    expect(ctx.commands.find(agent, 'goal')).toBeUndefined()
  })
})
