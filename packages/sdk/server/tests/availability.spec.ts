/** Authentication and readiness do not manufacture optional Team services or actor authority. */
import { Context } from '@clocky/cordis'
import AgentRegistry from '@clocky/clocky-agent'
import SessionStore from '@clocky/clocky-session'
import Llm, { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { expect, it, vi } from 'vitest'
import type { TeamHumanActorProof, TeamHumanActorProofInput } from '@clocky/clocky-team'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'
import { installTestProductPrincipals, SDK_TEST_CREDENTIAL } from './product-auth.ts'

class NeverRequestedAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncGenerator<StreamChunk> {
    throw new Error('Unavailable Team operations must not request a model')
  }
}

async function initializedServer() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Llm)
  ctx.llm.registerAdapter(['test-provider'], new NeverRequestedAdapter())
  await installTestProductPrincipals(ctx)
  const server = new HarnessSdkJsonRpcServer(ctx, {
    request: async () => { throw new Error('An unavailable owner must not request client work') }, notify() {},
  })
  await server.initialize({ credential: SDK_TEST_CREDENTIAL, provider: 'test-provider', model: 'test-model', cwd: process.cwd() })
  return { ctx, server }
}

const unavailableReads: ReadonlyArray<[string, (server: HarnessSdkJsonRpcServer) => Promise<unknown>]> = [
  ['Team', server => server.getTeam({ teamId: 'team' })],
  ['selection', server => server.getTeamSelection({ teamId: 'team' })],
  ['member', server => server.inspectTeamMember({ teamId: 'team', participantId: 'member' })],
  ['member session', server => server.getTeamMemberSession({ teamId: 'team', participantId: 'member' })],
  ['task', server => server.handleRequest('team/task-get', { teamId: 'team', taskId: 'task' })],
  ['task inspection', server => server.inspectTeamTask({ teamId: 'team', taskId: 'task', section: 'record' })],
  ['collection browse', server => server.browseTeam({ teamId: 'team', kind: 'tasks' })],
  ['workflow inspection', server => server.inspectWorkflowPlan({ teamId: 'team', planId: 'workflow' })],
  ['task page', server => server.listTeamTasks({ teamId: 'team' })],
  ['workflow page', server => server.listWorkflowPlans({ teamId: 'team' })],
  ['artifact page', server => server.listTeamArtifacts({ teamId: 'team' })],
  ['artifact', server => server.teamArtifactRead({ teamId: 'team', artifactId: 'artifact' })],
  ['member page', server => server.listTeamMembers({ teamId: 'team' })],
  ['action', server => server.readTeamAction({ teamId: 'team', actionId: 'action' })],
  ['audit', server => server.teamAuditRead({ teamId: 'team' })],
  ['quiescence', server => server.teamQuiescence({ teamId: 'team' })],
  ['channel catalog', server => server.getTeamChannelCatalog()],
  ['channel page', server => server.listTeamChannels({ teamId: 'team' })],
  ['channel', server => server.readTeamChannel({ channelId: 'channel' })],
  ['channel watch', server => server.handleRequest('team/channel-watch', { channelId: 'channel' })],
  ['task watch', server => server.handleRequest('team/task-watch', { teamId: 'team' })],
  ['task original update', server => server.getTeamTaskUpdateResult({ teamId: 'team', taskId: 'task', commandId: 'original' })],
]

it.each(unavailableReads)('refuses initialized %s inspection when its Team provider is not mounted', async (_name, read) => {
  const { ctx, server } = await initializedServer()
  try {
    await expect(read(server)).rejects.toThrow('Team provider')
    expect(ctx.agents.list()).toEqual([])
  } finally { await server.shutdown(); await ctx.fiber.dispose() }
})

it('refuses operational counters without the mounted Team provider', async () => {
  const { ctx, server } = await initializedServer()
  try {
    expect(() => server.teamMetrics({})).toThrow('Team provider')
  } finally { await server.shutdown(); await ctx.fiber.dispose() }
})

it('routes a strict principal-wide inbox response only to its mounted owner', async () => {
  const { ctx, server } = await initializedServer()
  const response = { teamId: 'team', actionId: 'action', expectedUpdatedAt: 1,
    idempotencyKey: 'sdk-response', answer: { kind: 'approval', outcome: 'allowed-once' } }
  try {
    await expect(server.handleRequest('team/inbox-respond', response)).rejects.toThrow('Durable principal inbox is not mounted')
    for (const method of ['team/inbox-read', 'team/inbox-watch', 'team/inbox-acknowledge'] as const) {
      await expect(server.handleRequest(method, {})).rejects.toThrow('Durable principal inbox is not mounted')
    }
    const respond = vi.fn(async (_call: AuthenticatedProductCall, input: unknown) => ({ accepted: input }))
    ctx.provide('teamHumanDelivery', { respond } as never)
    await expect(server.handleRequest('team/inbox-respond', {})).rejects.toMatchObject({ code: -32_602 })
    await expect(server.handleRequest('team/inbox-respond', response)).resolves.toEqual({ accepted: response })
    expect(respond).toHaveBeenCalledOnce()
    expect(respond.mock.calls[0]?.[0].principal.id).toBeDefined()
  } finally { await server.shutdown(); await ctx.fiber.dispose() }
})

const unauthenticatedWrites: ReadonlyArray<[string, (server: HarnessSdkJsonRpcServer) => Promise<unknown>]> = [
  ['objective update', server => server.updateTeamGoal({ teamId: 'team', expectedRevision: 1, objective: 'Updated objective' })],
  ['goal transition', server => server.transitionTeamGoal({ teamId: 'team', expectedRevision: 1, phase: 'complete' })],
  ['member activation', server => server.activateTeamMember({ teamId: 'team', participantId: 'member', expectedCursor: 0 })],
  ['member removal', server => server.removeTeamMember({ teamId: 'team', participantId: 'member', expectedCursor: 0 })],
  ['member interrupt', server => server.interruptTeamMember({ teamId: 'team', participantId: 'member', expectedCursor: 0 })],
  ['channel opening', server => server.openTeamChannel({ teamId: 'team', expectedCursor: 0,
    adapter: { type: 'direct', version: 3 }, participants: [{ id: 'member' as never, role: 'reader' }], limits: {} })],
  ['channel posting', server => server.postTeamChannel({ channelId: 'channel', expectedCursor: 0,
    audience: ['member'], kind: 'message', payload: { text: 'hello' }, delivery: 'turn' })],
  ['task update', server => server.updateTeamTask({ teamId: 'team', taskId: 'task', commandId: 'original', expectedRevision: 1, subject: 'Updated subject' })],
  ['task cancellation', server => server.cancelTeamTask({ teamId: 'team', taskId: 'task', expectedRevision: 1 })],
  ['task deletion', server => server.deleteTeamTask({ teamId: 'team', taskId: 'task', expectedRevision: 1 })],
  ['task review', server => server.reviewTeamTask({ teamId: 'team', taskId: 'task', expectedRevision: 1, decision: 'accepted', reason: 'Approved' })],
  ['team archive', server => server.archiveTeam({ teamId: 'team', expectedCursor: 1 })],
]

it.each(unauthenticatedWrites)('does not substitute connection authentication for a human-proof route during %s', async (_name, write) => {
  const { ctx, server } = await initializedServer()
  try {
    await expect(write(server)).rejects.toMatchObject({ data: { code: 'SDK_TEAM_AUTHENTICATED_ACTOR_UNAVAILABLE' } })
    expect(ctx.agents.list()).toEqual([])
  } finally { await server.shutdown(); await ctx.fiber.dispose() }
})

it.each(['', ' local '])('refuses noncanonical principal routing before registering notification listeners (%j)', async (provider) => {
  const ctx = new Context()
  try {
    expect(() => new HarnessSdkJsonRpcServer(ctx, { request: async () => undefined, notify() {} }, provider))
      .toThrow('product principal provider must be non-empty')
  } finally { await ctx.fiber.dispose() }
})

it.each(unavailableReads.filter(([name]) => name !== 'channel catalog' && name !== 'channel page'))(
  'refuses %s inspection when its optional Team provider retires during authorization', async (_name, read) => {
    const { ctx, server } = await initializedServer()
    let retire = (): void => {}
    const resolveIdentities = vi.fn(async () => { retire(); return { items: [] } })
    retire = ctx.provide('teams', { resolveIdentities,
      getChannelOwner: async () => ({ teamId: 'team' }),
    } as never)
    ctx.provide('teamHumanActors', {
      async withProof<T>(_call: AuthenticatedProductCall, input: TeamHumanActorProofInput,
        operation: (proof: TeamHumanActorProof, teamId: TeamHumanActorProofInput['teamId']) => Promise<T>): Promise<T> {
        return await operation(Object.freeze({}) as TeamHumanActorProof, input.teamId)
      },
    } as never)
    try {
      await expect(read(server)).rejects.toThrow('Team provider')
      expect(resolveIdentities).toHaveBeenCalledTimes(2)
      expect(ctx.get('teams')).toBeUndefined()
      expect(ctx.agents.list()).toEqual([])
    } finally { await server.shutdown(); await ctx.fiber.dispose() }
  },
)
