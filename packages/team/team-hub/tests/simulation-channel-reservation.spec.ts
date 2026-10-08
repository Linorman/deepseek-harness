/** Reserved Simulation channel admission recovers only its exact immutable WAL. */
import { expect, it } from 'vitest'
import { channelIdSchema } from '@clocky/clocky-team'
import type { SimulationChannelOpenScope, TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope } from '@clocky/clocky-team'
import { SessionId } from '@clocky/clocky-session'
import { directChannelV4Adapter } from '../../team-channel-direct/src/index.ts'
import { recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase } from './fixtures.ts'

const channelId = channelIdSchema.parse('simulation-reserved-channel')
const runId = 'simulation-reservation-run'
const lifecycleOwner = 'simulation/reservation-owner'
type SimulationInput = Omit<SimulationChannelOpenScope, 'kind' | 'runId' | 'lifecycleOwner' | 'channelId'>

async function fixture(backend: 'json' | 'sqlite') {
  const now = Date.now() - 1000
  const members = [participant({ id: 'simulation-coordinator', role: 'coordinator' }),
    participant({ id: 'simulation-worker', role: 'worker' })]
  const journal = [createdTeam({ createdAt: now, rules: { simulationRunId: runId, activationLifecycleOwner: lifecycleOwner } }),
    teamPhase({ createdAt: now + 1 }),
    ...members.flatMap((member, memberIndex) => (['invited', 'provisioning', 'active'] as const).map((phase, index) =>
      participantChanged({ participant: { ...member, phase }, createdAt: now + 2 + memberIndex * 4 + index })))]
  for (const [index, member] of members.entries()) journal.push({ type: 'activation/changed', createdAt: now + 11 + index,
    binding: { activation: { id: `simulation-reservation-activation-${index}`, teamId, participantId: member.id,
      status: 'idle' }, sessionId: SessionId(`simulation-reservation-session-${index}`), provider: 'in-process' } } as never)
  const ctx = await recover(backend, journal)
  ctx.teams.registerAdapter(directChannelV4Adapter)
  const scopes = new Map<TeamSystemChannelLifecycleProof, TeamSystemChannelLifecycleScope>()
  ctx.teams.registerSystemChannelLifecycleProofSource({ name: 'simulation-team',
    resolveChannelLifecycleProof: proof => scopes.get(proof) })
  const input = async (): Promise<SimulationInput> => ({
    teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'direct', version: 4 },
    participants: members.map(member => ({ id: member.id, role: member.role })),
    invitations: members.map((member, index) => ({ participantId: member.id, required: true,
      sessionId: SessionId(`simulation-reservation-session-${index}`) })), limits: {},
  })
  const open = async (selected: SimulationInput, options: {
    readonly runId?: string
    readonly lifecycleOwner?: string
  } = {}) => {
    const proof = Object.freeze({}) as TeamSystemChannelLifecycleProof
    scopes.set(proof, { kind: 'simulation-channel-open', ...selected, channelId,
      runId: options.runId ?? runId, lifecycleOwner: options.lifecycleOwner ?? lifecycleOwner })
    try { return await ctx.teams.openChannel({ ...selected, actor: proof, authorityKind: 'channel-lifecycle' }) }
    finally { scopes.delete(proof) }
  }
  return { ctx, members, input, open, scopes }
}

it.each(['json', 'sqlite'] as const)('reuses only a matching reserved Simulation channel after Team cursor advancement (%s)', async (backend) => {
  const f = await fixture(backend)
  const firstInput = await f.input()
  const first = await f.open(firstInput)
  expect(first.manifest.id).toBe(channelId)
  expect(first.phase).toBe('pending')
  const retry = await f.input()
  expect(await f.open(retry)).toEqual(first)
  expect((await f.ctx.teams.getTeam({ teamId })).channelIds).toEqual([channelId])
  await expect(f.open(retry, { runId: 'another-run' }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  const swapped = { ...retry, participants: [...retry.participants].reverse(),
    invitations: [...retry.invitations ?? []].reverse() }
  await expect(f.open(swapped)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(f.open({ ...retry, adapter: { type: 'direct', version: 3 } }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(f.open({ ...retry, expectedCursor: retry.expectedCursor + 1 }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(f.open({ ...retry, invitations: retry.invitations?.map((invitation, index) =>
    index === 0 ? { ...invitation, required: false } : invitation) }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(f.open({ ...retry, invitations: retry.invitations?.map((invitation, index) =>
    index === 0 ? { ...invitation, participantId: f.members[1]!.id } : invitation) }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  await expect(f.open({ ...retry, invitations: retry.invitations?.map((invitation, index) =>
    index === 0 ? { ...invitation, sessionId: undefined } : invitation) }))
    .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect(await f.ctx.teams.getChannel({ channelId })).toEqual(first)
})

it('revokes a Simulation channel proof after policy without attaching its reserved WAL', async () => {
  const f = await fixture('json')
  const input = await f.input()
  f.ctx.teams.registerPolicy('channel-open', { name: 'revoke-reserved-opening', async apply(_request, next) {
    f.scopes.clear()
    return await next()
  } })
  await expect(f.open(input)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  expect((await f.ctx.teams.getTeam({ teamId })).channelIds).toEqual([])
  await expect(f.ctx.teams.getChannel({ channelId })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
})

it.each(['json', 'sqlite'] as const)('recovers the exact Simulation channel reservation from a cold Team and WAL replay (%s)', async (backend) => {
  const first = await fixture(backend)
  const opened = await first.open(await first.input())
  const teamStream = first.ctx.storageLog.get(`team/${teamId}`)
  const channelStream = first.ctx.storageLog.get(`channel/${channelId}`)
  if (teamStream === undefined || channelStream === undefined) throw new Error('Fixture journals were not opened')
  const teamRows = (await teamStream.read(-1, 64)).map(entry => entry.value)
  const channelRows = (await channelStream.read(-1, 64)).map(entry => entry.value)
  const cold = await recover(backend, teamRows, undefined, teamId, [{ id: channelId, records: channelRows }])
  cold.teams.registerAdapter(directChannelV4Adapter)
  const proof = Object.freeze({}) as TeamSystemChannelLifecycleProof
  const state = await cold.teams.getTeam({ teamId })
  const input: SimulationInput = { ...await first.input(), expectedCursor: state.team.cursor }
  cold.teams.registerSystemChannelLifecycleProofSource({ name: 'simulation-team',
    resolveChannelLifecycleProof: candidate => candidate === proof ? {
      kind: 'simulation-channel-open', ...input, runId, lifecycleOwner, channelId,
    } : undefined })
  expect(await cold.teams.openChannel({ ...input, actor: proof, authorityKind: 'channel-lifecycle' })).toEqual(opened)
  expect((await cold.teams.getTeam({ teamId })).channelIds).toEqual([channelId])
})
