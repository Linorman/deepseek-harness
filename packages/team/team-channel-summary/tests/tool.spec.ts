import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import AgentRegistry, { Inbox } from '@clocky/clocky-agent'
import type { Agent, AgentStatus } from '@clocky/clocky-agent'
import { CallId } from '@clocky/clocky-llm'
import SessionStore, { SessionId } from '@clocky/clocky-session'
import SystemPrompt from '@clocky/clocky-system-prompt'
import { channelIdSchema, participantIdSchema, teamIdSchema } from '@clocky/clocky-team'
import ToolRuntime from '@clocky/clocky-tools'
import * as SummaryTool from '../src/tool.ts'

const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
})

const teamId = teamIdSchema.parse('team-summary-tool')
const participantId = participantIdSchema.parse('participant-summary-tool')
const channelId = channelIdSchema.parse('channel-summary-tool')
const args = { channel_id: channelId, expected_cursor: 4, from_sequence: 2, to_sequence: 3,
  idempotency_key: 'summary-tool-retry' }

async function harness(withTeam = true) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  let eligible = false
  let status: AgentStatus = 'running'
  const teamRuns = { tryCoordinatorGoalAuthority: vi.fn((agent: Agent) => eligible && agent === coordinator ? {} : undefined) }
  const binding = { sessionId: SessionId('summary-tool-session'),
    activation: { participantId, status: 'running' as const } }
  const revoke = vi.fn()
  const issue = vi.fn(() => ({ proof: {}, revoke }))
  const getTeam = vi.fn(async () => ({ activations: [binding] }))
  const summarize = vi.fn(async () => ({ idempotencyKey: args.idempotency_key, sequence: 5,
    coveredSequenceRange: { from: 2, to: 3 }, text: 'Selected messages.' }))
  ctx.provide('teamRuns', teamRuns as never)
  ctx.provide('teams', { getTeam, openActivationActorProofIssuer: () => ({ issue }) } as never)
  ctx.provide('teamChannelSummaries', { summarize } as never)
  const session = ctx.sessions.create(binding.sessionId, withTeam ? { meta: { teamId, participantId } } : {})
  const coordinator = {} as Agent
  const agentCtx = ctx.extend({ agent: coordinator })
  Object.assign(coordinator, {
    id: session.id, options: {}, session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    ctx: agentCtx,
    cancel: () => {}, send: () => {}, followup: () => {}, inject: () => {},
    runMaintenance: task => task(new AbortController().signal),
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  Object.defineProperty(coordinator, 'status', { get: () => status })
  ctx.agents.register(coordinator)
  const fiber = await ctx.plugin(SummaryTool)
  const definition = () => ctx.tools.get('team_channel_summarize', coordinator)
  const execute = async (input: Record<string, unknown> = args) => await ctx.agents.withInitiator(coordinator,
    async () => await ctx.tools.execute({ signal: new AbortController().signal, callId: CallId('summary-tool-call'),
      name: 'team_channel_summarize', arguments: input, agent: coordinator }))
  return { ctx, fiber, coordinator, teamRuns, getTeam, summarize, issue, revoke, binding,
    definition, execute, setEligible(value: boolean) { eligible = value }, setStatus(value: AgentStatus) { status = value },
    emitTeamChanged() { ctx.emit('team/changed', { type: 'team/changed', team: {} } as never) } }
}

it('registers only for the current coordinator, renders the range, and returns durable summary facts', async () => {
  const mounted = await harness()
  expect(mounted.definition()).toBeUndefined()
  mounted.setEligible(true)
  mounted.ctx.emit('agent/created', { agent: mounted.coordinator } as never)
  mounted.emitTeamChanged()
  const definition = mounted.definition()
  expect(definition?.presentCall?.(args)).toMatchObject({ title: 'Summarize channel', rawInput: `${channelId}: 2–3` })
  const result = await mounted.execute()
  expect(result).toMatchObject({ isError: false, value: { summary_id: args.idempotency_key,
    sequence: 5, from_sequence: 2, to_sequence: 3, text: 'Selected messages.' } })
  expect(mounted.getTeam).toHaveBeenCalledWith({ teamId })
  expect(mounted.summarize).toHaveBeenCalledWith({ requester: {}, channelId,
    expectedCursor: 4, coveredSequenceRange: { from: 2, to: 3 }, idempotencyKey: args.idempotency_key })
  expect(mounted.revoke).toHaveBeenCalledOnce()
  mounted.ctx.emit('agent/disposed', { agent: mounted.coordinator } as never)
  expect(mounted.definition()).toBeUndefined()
  mounted.emitTeamChanged()
  expect(mounted.definition()).toBeDefined()
  mounted.setEligible(false)
  mounted.emitTeamChanged()
  expect(mounted.definition()).toBeUndefined()
})

it('rejects stale coordinator context, missing Team or binding, and revokes proofs after summary failures', async () => {
  const mounted = await harness()
  mounted.setEligible(true)
  mounted.emitTeamChanged()
  const definition = mounted.definition()
  if (definition === undefined) throw new Error('summary tool was not installed')
  await expect(definition.execute(args, { agent: mounted.coordinator } as never))
    .rejects.toMatchObject({ code: 'TEAM_SUMMARY_COORDINATOR_REQUIRED' })
  mounted.setStatus('idle')
  await expect(mounted.execute()).resolves.toMatchObject({ isError: true })
  mounted.setStatus('running')
  mounted.getTeam.mockResolvedValueOnce({ activations: [] })
  await expect(mounted.execute()).resolves.toMatchObject({ isError: true })
  mounted.summarize.mockRejectedValueOnce(new Error('summary backend failed'))
  await expect(mounted.execute()).resolves.toMatchObject({ isError: true })
  expect(mounted.revoke).toHaveBeenCalledOnce()
  const noTeam = await harness(false)
  noTeam.setEligible(true)
  noTeam.emitTeamChanged()
  await expect(noTeam.execute()).resolves.toMatchObject({ isError: true })
})

it('removes an installed coordinator tool when its plugin fiber closes', async () => {
  const mounted = await harness()
  mounted.setEligible(true)
  mounted.emitTeamChanged()
  expect(mounted.definition()).toBeDefined()
  await mounted.fiber.dispose()
  expect(mounted.definition()).toBeUndefined()
})
