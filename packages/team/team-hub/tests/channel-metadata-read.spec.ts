/** Bound metadata reads never expose another Team or a channel outside the current member roster. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as Json from '@clocky/clocky-storage-json'
import * as Sqlite from '@clocky/clocky-storage-sqlite'
import * as Log from '@clocky/clocky-storage-log'
import * as Direct from '@clocky/clocky-team-channel-direct'
import type { ParticipantSnapshot } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { postActor, updateTestActivationStatus } from './fixtures.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function topology(ctx: Context) {
  const state = await createTestRootTeam(ctx, { goal: { objective: 'Read exact channel metadata.', budgets: {} }, rules: {}, budgets: {} })
  const teamId = state.team.id
  const participants: ParticipantSnapshot[] = []
  for (const displayName of ['member', 'peer', 'outsider']) {
    const member = await inviteBootstrapParticipant(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'local-agent', displayName, role: displayName, capabilities: [] })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: member.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    participants.push(member)
  }
  const channel = await openTestChannel(ctx, { teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: { type: 'direct', version: 4 }, participants: participants.slice(0, 2).map(value => ({ id: value.id, role: value.role })), limits: {} })
  return { teamId, participants, channel }
}

describe('activation-bound channel metadata', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`reads pending metadata and rejects foreign, nonmember, revoked and offline proofs on ${backend}`, async () => {
      await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
      const root = await mkdtemp(join(process.cwd(), '.tmp/channel-metadata-'))
      roots.push(root)
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(Storage)
      if (backend === 'json') await ctx.plugin(Json, { root })
      else await ctx.plugin(Sqlite, { path: join(root, 'team.sqlite') })
      await ctx.plugin(Log, { backend, routes: {} })
      await ctx.plugin(TeamHub)
      await ctx.plugin(Direct)
      const own = await topology(ctx)
      const foreign = await topology(ctx)
      const member = own.participants[0]!
      const actor = await postActor(ctx, own.teamId, member.id)
      const snapshot = await ctx.teams.getChannelForActor({ actor, channelId: own.channel.manifest.id })
      expect(snapshot).toEqual(await ctx.teams.getChannel({ channelId: own.channel.manifest.id }))
      expect(snapshot.phase).toBe('pending')
      expect(Object.keys(snapshot).sort()).toEqual(['cursor', 'manifest', 'phase', 'replayWatermark'])
      await expect(ctx.teams.getChannelForActor({ actor, channelId: foreign.channel.manifest.id }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const outsider = await postActor(ctx, own.teamId, own.participants[2]!.id)
      await expect(ctx.teams.getChannelForActor({ actor: outsider, channelId: own.channel.manifest.id }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const current = await ctx.teams.getTeam({ teamId: own.teamId })
      const binding = current.activations.find(value => value.activation.participantId === member.id)!
      const issuer = ctx.teams.openActivationActorProofIssuer()
      const revoked = issuer.issue(binding)
      revoked.revoke()
      await expect(ctx.teams.getChannelForActor({ actor: revoked.proof, channelId: own.channel.manifest.id }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      issuer.close()
      await updateTestActivationStatus(ctx, { teamId: own.teamId, activationId: binding.activation.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId: own.teamId })).team.cursor, status: 'offline' })
      await expect(ctx.teams.getChannelForActor({ actor, channelId: own.channel.manifest.id }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
    })
  }
})
