/** SDK readers use actual Hub membership independently of their connection's model route. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import SessionStore from '@clocky/clocky-session'
import AgentRegistry from '@clocky/clocky-agent'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as TeamHumanActor from '@clocky/clocky-team-human-actor'
import type { TeamId } from '@clocky/clocky-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'
import type { JsonRpcTransportPeer } from '@clocky/clocky-sdk-protocol'
import { installTestProductPrincipals, SDK_TEST_CREDENTIAL } from './product-auth.ts'

const fixtures: { ctx: Context; root: string; server: HarnessSdkJsonRpcServer }[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.server.shutdown()
    await fixture.ctx.fiber.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function fixture() {
  const directory = join(process.cwd(), '.tmp')
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(join(directory, 'sdk-product-reads-'))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await installTestProductPrincipals(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(TeamHumanActor)
  ctx.provide('llm', { listProviders: () => [{ id: 'reader-route', name: 'Reader route' }] } as never)
  const server = new HarnessSdkJsonRpcServer(ctx, { notify: vi.fn() } as unknown as JsonRpcTransportPeer)
  fixtures.push({ ctx, root, server })
  await server.initialize({ credential: SDK_TEST_CREDENTIAL, provider: 'reader-route', model: 'reader-model', cwd: root })
  return { ctx, root, server }
}

async function team(ctx: Context, owner: string): Promise<TeamId> {
  const state = await createTestRootTeam(ctx, { goal: { objective: owner, budgets: {} }, budgets: {}, rules: {} })
  const member = await inviteBootstrapParticipant(ctx, { teamId: state.team.id, expectedCursor: state.team.cursor,
    kind: 'human', role: 'human', displayName: owner, capabilities: [], owner })
  for (const phase of ['provisioning', 'active'] as const) {
    await transitionBootstrapParticipant(ctx, { teamId: state.team.id, participantId: member.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: state.team.id })).team.cursor, phase })
  }
  return state.team.id
}

it('discovers safe metadata and refuses another principal before selected-Team body reads', async () => {
  const { ctx, server } = await fixture()
  const own = await team(ctx, 'sdk-test-principal')
  const hidden = await team(ctx, 'private-sdk-principal')
  const page = await server.listTeams({ afterCursor: -1, limit: 8 })
  expect(page.items.map(item => item.id)).toContain(own)
  expect(page.items.map(item => item.id)).not.toContain(hidden)
  expect(page).not.toHaveProperty('scanned')
  expect(page.items[0]).not.toHaveProperty('authorityGrant')
  expect(page.items[0]?.goal).not.toHaveProperty('budgets')
  expect((await server.getTeamSelection({ teamId: own })).selection.team.id).toBe(own)
  const body = vi.spyOn(ctx.teams, 'getTeam')
  const selected = await server.getTeam({ teamId: own })
  expect(selected.state.team.id).toBe(own)
  body.mockClear()
  for (const method of ['team/get', 'team/selection', 'team/member-list', 'team/task-list', 'team/artifact-list',
    'team/workflow-plan-list', 'team/quiescence', 'team/audit-read'] as const) {
    await expect(server.handleRequest(method, { teamId: hidden })).rejects.toMatchObject({ data: { code: 'SDK_TEAM_FORBIDDEN' } })
  }
  const updates = vi.spyOn(ctx.teams, 'getTaskUpdateResult')
  await expect(server.handleRequest('team/task-update-result', { teamId: hidden, taskId: 'private', commandId: 'original' }))
    .rejects.toMatchObject({ data: { code: 'SDK_TEAM_FORBIDDEN' } })
  expect(updates).not.toHaveBeenCalled()
  expect(body).not.toHaveBeenCalled()
})

it('withholds both successful and failed selected-Team results when membership changes during IO', async () => {
  const { ctx, server } = await fixture()
  const own = await team(ctx, 'sdk-test-principal')
  const original = ctx.teams.resolveIdentities.bind(ctx.teams)
  await server.drainNotifications()
  for (const fail of [false, true]) {
    let checks = 0
    const authority = vi.spyOn(ctx.teams, 'resolveIdentities').mockImplementation(async (input) => {
      if (++checks === 2) throw Object.assign(new Error('Private revoked metadata'), { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' })
      return await original(input)
    })
    const body = fail ? vi.spyOn(ctx.teams, 'getTeam').mockRejectedValue(new Error('Private provider diagnostic')) : undefined
    try {
      await expect(server.getTeam({ teamId: own })).rejects.toMatchObject({ data: { code: 'SDK_TEAM_FORBIDDEN' } })
      expect(authority).toHaveBeenCalledTimes(2)
    } finally { body?.mockRestore(); authority.mockRestore() }
  }
})

it.each([false, true])('withholds update outcomes after read authority changes during IO (failure: %s)', async (fail) => {
  const { ctx, server } = await fixture()
  const own = await team(ctx, 'sdk-test-principal')
  const original = ctx.teams.resolveIdentities.bind(ctx.teams)
  await server.drainNotifications()
  let checks = 0
  const authority = vi.spyOn(ctx.teams, 'resolveIdentities').mockImplementation(async (input) => {
    if (++checks === 2) throw Object.assign(new Error('Private revoked metadata'), { code: 'TEAM_HUMAN_ACTOR_FORBIDDEN' })
    return await original(input)
  })
  const body = fail ? vi.spyOn(ctx.teams, 'getTaskUpdateResult').mockRejectedValue(new Error('Private update diagnostic')) : undefined
  try {
    await expect(server.handleRequest('team/task-update-result', { teamId: own, taskId: 'task', commandId: 'original' }))
      .rejects.toMatchObject({ data: { code: 'SDK_TEAM_FORBIDDEN' } })
    expect(authority).toHaveBeenCalledTimes(2)
  } finally { body?.mockRestore(); authority.mockRestore() }
})
