/** Authenticated channel pages preserve attachment order without loading other channel WALs. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@clocky/clocky-storage'
import * as Json from '@clocky/clocky-storage-json'
import * as Sqlite from '@clocky/clocky-storage-sqlite'
import * as Log from '@clocky/clocky-storage-log'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { fingerprintTeamHumanActorPayload, jsonObjectSchema, type TeamChannelListInput,
  type TeamHumanActorProof, type TeamHumanActorScope, type ParticipantId } from '@clocky/clocky-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import TeamHub from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function hub(backend: 'json' | 'sqlite', root: string) {
  const ctx = new Context(); contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(Json, { root })
  else await ctx.plugin(Sqlite, { path: join(root, 'channels.db') })
  await ctx.plugin(Log, { backend, routes: {} })
  await ctx.plugin(TeamHub, { recoveryPageSize: 2 })
  await ctx.plugin(Direct)
  return ctx
}
async function topology(ctx: Context) {
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Read channel pages', budgets: {} }, rules: {}, budgets: {} })
  const teamId = team.team.id
  const members = []
  for (const role of ['human', 'peer'] as const) {
    const member = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: role === 'human' ? 'human' : 'local-agent', role, displayName: role, capabilities: [],
      ...role === 'human' ? { owner: { kind: 'product-principal' as const, principalId: productPrincipalId('channel-reader') } } : {} })
    for (const phase of ['provisioning', 'active'] as const) await transitionBootstrapParticipant(ctx, {
      teamId, participantId: member.id, phase, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    })
    members.push(member)
  }
  return { teamId, humanId: members[0]!.id, members: members.map(member => ({ id: member.id, role: member.role })) }
}
function source(ctx: Context) {
  const proofs = new Map<TeamHumanActorProof, TeamHumanActorScope>()
  ctx.teams.registerHumanActorProofSource({ name: 'team-human-actor', resolveHumanActorProof: proof => proofs.get(proof) })
  return { proofs, issue(input: TeamChannelListInput, participantId: ParticipantId) {
    const actor = Object.freeze({}) as TeamHumanActorProof
    const scope = { teamId: input.teamId, operation: 'channel-list-read' as const, fence: { kind: 'read' as const }, payload: jsonObjectSchema.parse(input) }
    proofs.set(actor, { teamId: input.teamId, participantId, operation: scope.operation, fence: scope.fence,
      payloadFingerprint: fingerprintTeamHumanActorPayload(scope) })
    return actor
  } }
}
for (const backend of ['json', 'sqlite'] as const) describe(`channel list (${backend})`, () => {
  it('loads only the selected page, preserves insertion cursors, and caps the requested size', async () => {
    await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
    const root = await mkdtemp(join(process.cwd(), '.tmp/channel-list-')); roots.push(root)
    const writer = await hub(backend, root)
    const own = await topology(writer)
    const channels = []
    for (let index = 0; index < 3; index++) channels.push(await openTestChannel(writer, { teamId: own.teamId,
      expectedCursor: (await writer.teams.getTeam({ teamId: own.teamId })).team.cursor,
      adapter: { type: 'direct', version: 4 }, participants: own.members, limits: {} }))
    await writer.fiber.dispose(); contexts.delete(writer)
    const ctx = await hub(backend, root)
    const authority = source(ctx)
    const opens = vi.spyOn(ctx.storageLog, 'open')
    const firstInput = { teamId: own.teamId, limit: 1 }
    const first = await ctx.teams.listTeamChannels({ ...firstInput, actor: authority.issue(firstInput, own.humanId) })
    expect(first.items.map(channel => channel.manifest.id)).toEqual([channels[0]!.manifest.id])
    expect(first.nextCursor).toBe(0)
    expect(opens.mock.calls.filter(([request]) => request.name.startsWith('channel/')).map(([request]) => request.name))
      .toEqual([`channel/${channels[0]!.manifest.id}`])
    const fourth = await openTestChannel(ctx, { teamId: own.teamId, expectedCursor: (await ctx.teams.getTeam({ teamId: own.teamId })).team.cursor,
      adapter: { type: 'direct', version: 4 }, participants: own.members, limits: {} })
    const nextInput = { teamId: own.teamId, afterCursor: first.nextCursor, limit: 100 }
    const next = await ctx.teams.listTeamChannels({ ...nextInput, actor: authority.issue(nextInput, own.humanId) })
    expect(next.items.map(channel => channel.manifest.id)).toEqual(channels.slice(1).map(channel => channel.manifest.id))
    expect(next.nextCursor).toBe(2)
    const lastInput = { teamId: own.teamId, afterCursor: next.nextCursor }
    const last = await ctx.teams.listTeamChannels({ ...lastInput, actor: authority.issue(lastInput, own.humanId) })
    expect(last.items.map(channel => channel.manifest.id)).toEqual([fourth.manifest.id])
    expect(last.nextCursor).toBeUndefined()
    const emptyInput = { teamId: own.teamId, afterCursor: 99 }
    expect(await ctx.teams.listTeamChannels({ ...emptyInput, actor: authority.issue(emptyInput, own.humanId) })).toEqual({ items: [] })
  })
  it('rejects foreign, cross-Team, forged and revoked proofs, including revocation while loading a page', async () => {
    await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
    const root = await mkdtemp(join(process.cwd(), '.tmp/channel-list-auth-')); roots.push(root)
    const writer = await hub(backend, root)
    const own = await topology(writer); const foreign = await topology(writer)
    const channel = await openTestChannel(writer, { teamId: own.teamId, expectedCursor: (await writer.teams.getTeam({ teamId: own.teamId })).team.cursor,
      adapter: { type: 'direct', version: 4 }, participants: own.members, limits: {} })
    await writer.fiber.dispose(); contexts.delete(writer)
    const ctx = await hub(backend, root); const authority = source(ctx)
    const input = { teamId: own.teamId, limit: 1 }
    const actor = authority.issue(input, own.humanId)
    await expect(ctx.teams.listTeamChannels({ ...input, actor: Object.freeze({}) as TeamHumanActorProof })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.listTeamChannels({ ...input, actor: authority.issue(input, foreign.humanId) })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    await expect(ctx.teams.listTeamChannels({ ...input, teamId: foreign.teamId, actor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    const open = ctx.storageLog.open.bind(ctx.storageLog)
    const loading = vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (request) => {
      if (request.name === `channel/${channel.manifest.id}`) authority.proofs.delete(actor)
      return await open(request)
    })
    await expect(ctx.teams.listTeamChannels({ ...input, actor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    loading.mockRestore()
    await expect(ctx.teams.listTeamChannels({ ...input, actor })).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
  })
})
