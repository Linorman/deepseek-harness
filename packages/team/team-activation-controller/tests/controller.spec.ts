import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as InProcessRuntime from '@clocky/clocky-agent-runtime-in-process'
import { SessionId } from '@clocky/clocky-session'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type { TeamPolicy } from '@clocky/clocky-team'
import TeamHub from '@clocky/clocky-team-hub'
import * as TeamChannelDirect from '@clocky/clocky-team-channel-direct'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import * as TeamActivationControllerPlugin from '../src/index.ts'
import { TeamActivationController } from '../src/index.ts'
import type { TeamActivationRequest } from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []

afterEach(async () => {
  const failures: unknown[] = []
  for (const ctx of [...contexts]) {
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
  if (failures.length > 0) throw new AggregateError(failures, 'activation-controller test cleanup failed')
})

/** Compose local Team, AgentRuntime, and durable Agent prerequisites. */
async function setup(): Promise<Context> {
  const root = await freshRoot()
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamChannelDirect)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  await ctx.plugin(TeamAgentClient)
  return ctx
}

/** Allocate durable test artifacts inside the repository workspace. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-activation-controller-'))
  roots.push(root)
  return root
}

/** Invite one local worker and enter its durable active membership phase. */
async function activeParticipant(ctx: Context, teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'], name: string) {
  let state = await ctx.teams.getTeam({ teamId })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId,
    expectedCursor: state.team.cursor,
    kind: 'local-agent',
    displayName: name,
    role: 'worker',
    capabilities: [],
  })
  state = await ctx.teams.getTeam({ teamId })
  await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId })
  return await transitionBootstrapParticipant(ctx, {
    teamId,
    participantId: invited.id,
    expectedCursor: state.team.cursor,
    phase: 'active',
  })
}

/** Build one Team-resolved local activation request from the latest Team cursor. */
function request(
  teamId: Awaited<ReturnType<Context['teams']['createTeam']>>['team']['id'],
  participantId: Awaited<ReturnType<typeof activeParticipant>>['id'],
  expectedCursor: number,
  sessionId: SessionId,
  seed: TeamActivationRequest['seed'] = { kind: 'fresh' },
): TeamActivationRequest {
  return {
    teamId,
    participantId,
    expectedCursor,
    provider: 'in-process',
    sessionId,
    seed,
    agent: { options: {} },
    signal: new AbortController().signal,
  }
}

describe('Team activation controller', () => {
  it('publishes one Controller service through its function-plugin entry', async () => {
    const ctx = await setup()
    const fiber = await ctx.plugin(TeamActivationControllerPlugin)
    expect(ctx.get('teamActivations')).toBeInstanceOf(TeamActivationController)
    const runtime = ctx.teams as unknown as { readonly systemActivationProofSources: ReadonlyMap<string, unknown> }
    expect(runtime.systemActivationProofSources.has('team-activation-controller')).toBe(true)
    await fiber.dispose()
    expect(ctx.get('teamActivations')).toBeUndefined()
    expect(runtime.systemActivationProofSources.has('team-activation-controller')).toBe(false)
  })

  it('binds active local participants, preserves old offline epochs, and resumes the same durable Session', async () => {
    const ctx = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Coordinate local work', budgets: {} }, rules: {}, budgets: {} })
    const first = await activeParticipant(ctx, team.team.id, 'First worker')
    const second = await activeParticipant(ctx, team.team.id, 'Second worker')
    await ctx.plugin(TeamActivationControllerPlugin)
    const controller = ctx.teamActivations

    let state = await ctx.teams.getTeam({ teamId: team.team.id })
    const firstLease = await controller.activate(request(
      team.team.id,
      first.id,
      state.team.cursor,
      SessionId('controller-first'),
    ))
    state = await ctx.teams.getTeam({ teamId: team.team.id })
    const secondLease = await controller.activate(request(
      team.team.id,
      second.id,
      state.team.cursor,
      SessionId('controller-second'),
    ))
    if (firstLease.localAgent === undefined) throw new Error('in-process controller lease has no local Agent')
    expect(firstLease.localAgent.session.header).toMatchObject({ teamId: team.team.id, participantId: first.id })
    expect(secondLease.binding.activation).toMatchObject({ participantId: second.id, status: 'idle' })
    await expect(firstLease.health()).resolves.toMatchObject({ activation: { status: 'idle' } })

    const oldActivationId = firstLease.binding.activation.id
    await firstLease.dispose()
    await vi.waitFor(async () => {
      await expect(ctx.teams.getActivation({ teamId: team.team.id, activationId: oldActivationId }))
        .resolves.toMatchObject({ activation: { status: 'offline' } })
    })
    state = await ctx.teams.getTeam({ teamId: team.team.id })
    const resumed = await controller.activate(request(
      team.team.id,
      first.id,
      state.team.cursor,
      SessionId('controller-first'),
      { kind: 'resume' },
    ))
    expect(resumed.binding.activation.id).not.toBe(oldActivationId)
    await expect(ctx.teams.getActivation({ teamId: team.team.id, activationId: oldActivationId }))
      .resolves.toMatchObject({ sessionId: 'controller-first', activation: { status: 'offline' } })
    await expect(ctx.teams.getActivation({ teamId: team.team.id, activationId: resumed.binding.activation.id }))
      .resolves.toMatchObject({ sessionId: 'controller-first', activation: { status: 'idle' } })
    await Promise.all([resumed.dispose(), secondLease.dispose()])
    await controller.close()
  })

  it('settles a live activation durably while its controller shuts down', async () => {
    const ctx = await setup()
    const fiber = await ctx.plugin(TeamActivationControllerPlugin)
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Settle shutdown ownership', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(ctx, team.team.id, 'Shutdown worker')
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    const lease = await ctx.teamActivations.activate(request(
      team.team.id,
      participant.id,
      state.team.cursor,
      SessionId('controller-shutdown'),
    ))

    await ctx.teamActivations.close()

    await expect(ctx.teams.getActivation({
      teamId: team.team.id,
      activationId: lease.binding.activation.id,
    })).resolves.toMatchObject({
      activation: { status: 'offline' },
      quiescenceSource: 'quiesced',
    })
    await fiber.dispose()
  })

  it('rejects stale activation requests before placement and disposes a published handle when Hub policy rejects its bind', async () => {
    const ctx = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Reject unsafe activation', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(ctx, team.team.id, 'Worker')
    await ctx.plugin(TeamActivationControllerPlugin)
    const controller = ctx.teamActivations
    const state = await ctx.teams.getTeam({ teamId: team.team.id })
    await expect(controller.activate(request(
      team.team.id,
      participant.id,
      state.team.cursor - 1,
      SessionId('controller-stale'),
    ))).rejects.toMatchObject({ code: 'TEAM_CURSOR_CONFLICT' })
    expect(ctx.agents.get(SessionId('controller-stale'))).toBeUndefined()

    const deny: TeamPolicy = {
      name: 'deny-activation-bind',
      async apply() { return { kind: 'deny', code: 'test-denied', message: 'activation binding is denied' } },
    }
    const unregister = ctx.teams.registerPolicy('activate', deny)
    await expect(controller.activate(request(
      team.team.id,
      participant.id,
      state.team.cursor,
      SessionId('controller-denied'),
    ))).rejects.toMatchObject({ code: 'TEAM_POLICY_DENIED' })
    await vi.waitFor(() => {
      expect(ctx.agents.get(SessionId('controller-denied'))).toBeUndefined()
    })
    unregister()
    await controller.close()
  })

  it('binds an accepted activation after unrelated Team progress during provider startup', async () => {
    const ctx = await setup()
    const team = await createTestRootTeam(ctx, { goal: { objective: 'Activate while the Team progresses', budgets: {} }, rules: {}, budgets: {} })
    const participant = await activeParticipant(ctx, team.team.id, 'Starting worker')
    await ctx.plugin(TeamActivationControllerPlugin)
    const observed = await ctx.teams.getTeam({ teamId: team.team.id })
    const activate = ctx.agentRuntimes.activate.bind(ctx.agentRuntimes)
    const provider = vi.spyOn(ctx.agentRuntimes, 'activate').mockImplementation(async (input) => {
      const handle = await activate(input)
      await activeParticipant(ctx, team.team.id, 'Concurrent worker')
      return handle
    })
    try {
      const lease = await ctx.teamActivations.activate(request(
        team.team.id, participant.id, observed.team.cursor, SessionId('controller-concurrent-start'),
      ))
      const state = await ctx.teams.getTeam({ teamId: team.team.id })
      expect(provider).toHaveBeenCalledTimes(1)
      expect(state.team.cursor).toBeGreaterThan(observed.team.cursor)
      expect(state.participants.map(member => member.displayName)).toEqual(['Starting worker', 'Concurrent worker'])
      expect(state.activations).toHaveLength(1)
      expect(state.activations[0]?.activation.id).toBe(lease.binding.activation.id)
      expect(ctx.agents.get(SessionId('controller-concurrent-start'))).toBe(lease.localAgent)
      await lease.dispose()
    } finally {
      provider.mockRestore()
    }
  })
})
