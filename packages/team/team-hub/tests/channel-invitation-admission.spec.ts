import { setTimeout } from 'node:timers/promises'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import * as Basic from '@clocky/clocky-team-channel-basic'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { channelInvitationIdempotencyKeySchema, channelSummaryIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ChannelId, ParticipantSnapshot, TeamEnvelope } from '@clocky/clocky-team'
import * as Direct from '../../team-channel-direct/src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { closeTestChannel, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { postActor } from './fixtures.ts'
import TeamHub from '../src/index.ts'

const contexts = new Set<Context>()
const roots: string[] = []
type Backend = 'json' | 'sqlite'

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function hub(backend: Backend, root: string, timeoutMs = 30_000) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { channelInvitationTimeoutMs: timeoutMs, maxEnvelopeBytes: 4096 })
  await ctx.plugin(Direct)
  return ctx
}

async function setup(backend: Backend, optional = false, timeoutMs = 30_000) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'direct-v4-'))
  roots.push(root)
  const ctx = await hub(backend, root, timeoutMs)
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Address direct messages explicitly.', budgets: {} }, rules: {}, budgets: {} })
  const teamId = team.team.id
  const members: ParticipantSnapshot[] = []
  for (const role of ['coordinator', 'worker', 'worker-2']) {
    const participant = await inviteBootstrapParticipant(ctx, { teamId,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'local-agent', displayName: role, role, capabilities: [] })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    members.push(participant)
  }
  const [sender, fast, slow] = members
  if (sender === undefined || fast === undefined || slow === undefined) throw new Error('Direct fixture lacks members')
  const senderActor = await postActor(ctx, teamId, sender.id)
  const fastActor = await postActor(ctx, teamId, fast.id)
  const open = async (participants: readonly { id: ParticipantSnapshot['id']; role: string }[]) => await openTestChannel(ctx, {
    teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
    adapter: Direct.DIRECT_CHANNEL_ADAPTER_V4, viewPolicy: { type: 'directed', version: 1 }, participants, limits: {},
    ...optional ? { invitations: [{ participantId: slow.id, required: false }] } : {},
  })
  const channel = await open([sender, fast, slow].map(participant => ({ id: participant.id, role: participant.role })))
  return { ctx, root, teamId, sender, fast, slow, senderActor, fastActor, channel, open }
}

async function post(f: Awaited<ReturnType<typeof setup>>, channelId: ChannelId, audience: readonly ParticipantSnapshot['id'][] | null) {
  return await f.ctx.teams.postChannelEnvelope({ actor: f.senderActor,
    expectedCursor: (await f.ctx.teams.getChannel({ channelId })).cursor,
    draft: { channelId, audience, kind: 'message', payload: { content: [{ type: 'text', text: 'Explicit direct message.' }] }, delivery: 'context' } })
}

async function acknowledge(f: Awaited<ReturnType<typeof setup>>, participant: ParticipantSnapshot, channelId = f.channel.manifest.id) {
  const admission = await f.ctx.teams.getChannelAdmission({ channelId })
  const invitation = admission.invitations.find(value => value.participantId === participant.id)!
  const actor = participant.id === f.sender.id ? f.senderActor
    : participant.id === f.fast.id ? f.fastActor : await postActor(f.ctx, f.teamId, participant.id)
  return await f.ctx.teams.acknowledgeChannelInvitation({ actor, channelId, revision: invitation.revision,
    manifestFingerprint: invitation.manifestFingerprint,
    idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`consent:${String(participant.id)}`) })
}

async function expireThroughConsumer(f: Awaited<ReturnType<typeof setup>>, channelId = f.channel.manifest.id) {
  const admission = await f.ctx.teams.getChannelAdmission({ channelId })
  await setTimeout(Math.max(1, Math.max(...admission.invitations.map(value => value.deadline)) - Date.now() + 1))
  await f.ctx.plugin(TeamChannelAdmission)
  await f.ctx.teamChannelAdmission.runOnce()
  return await f.ctx.teams.getChannelAdmission({ channelId })
}

describe('durable endpoint channel admission', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`retains the historical broadcast recipients when an optional endpoint later acknowledges on ${backend}`, async () => {
      const f = await setup(backend, true)
      await acknowledge(f, f.sender)
      expect((await acknowledge(f, f.fast)).channel.phase).toBe('active')
      const first = await post(f, f.channel.manifest.id, null)
      const source = async (envelope: TeamEnvelope) => await f.ctx.teams.readChannelSummarySource({
        requester: f.senderActor, channelId: f.channel.manifest.id,
        expectedCursor: (await f.ctx.teams.getChannel({ channelId: f.channel.manifest.id })).cursor,
        coveredSequenceRange: { from: envelope.sequence, to: envelope.sequence },
        idempotencyKey: channelSummaryIdempotencyKeySchema.parse(`source:${String(envelope.id)}`),
      })
      await expect(source(first)).rejects.toMatchObject({ code: 'TEAM_GRANT_DENIED' })
      await expect(post(f, f.channel.manifest.id, [f.slow.id])).rejects.toBeDefined()
      await acknowledge(f, f.slow)
      await expect(source(first)).rejects.toMatchObject({ code: 'TEAM_GRANT_DENIED' })
      const second = await post(f, f.channel.manifest.id, null)
      expect((await source(second)).envelopes.map(envelope => envelope.id)).toEqual([second.id])
      const rows = (await f.ctx.teams.readChannel({ channelId: f.channel.manifest.id, afterCursor: -1 })).records
        .filter(row => row.type === 'channel/envelope')
      expect(rows.map(row => row.deliveryIntents.map(intent => intent.participantId))).toEqual([[f.fast.id], [f.fast.id, f.slow.id]])
      expect(rows.map(row => row.envelope.id)).toEqual([first.id, second.id])
      const pending = await f.ctx.teams.listChannelPendingDeliveries({ channelId: f.channel.manifest.id, participantId: f.slow.id,
        afterCursor: -1, limit: 10 })
      expect(pending.deliveries.map(value => value.envelope.id)).toEqual([second.id])
    })

    it(`expires a missing required endpoint through the real recovery Consumer on ${backend}`, async () => {
      const f = await setup(backend, false, 150)
      const result = await expireThroughConsumer(f)
      expect(result.channel.phase).toBe('expired')
      expect(result.invitations.every(value => value.status === 'expired')).toBe(true)
      expect(result.invitations[0]?.reason?.code).toBe('TEAM_CHANNEL_REQUIRED_INVITATION_EXPIRED')
      await expect(acknowledge(f, f.sender)).rejects.toBeDefined()
      await expect(post(f, f.channel.manifest.id, null)).rejects.toBeDefined()
    })

    it(`ends a v4 optional invitation without changing the manifest or earlier pending intents on ${backend}`, async () => {
      const f = await setup(backend, true, 1_000)
      await acknowledge(f, f.sender)
      await acknowledge(f, f.fast)
      const envelope = await post(f, f.channel.manifest.id, null)
      const result = await expireThroughConsumer(f)
      expect(result.channel.phase).toBe('active')
      expect(result.channel.manifest).toEqual(f.channel.manifest)
      expect(result.invitations.find(value => value.participantId === f.slow.id)?.status).toBe('expired')
      const pending = await f.ctx.teams.listChannelPendingDeliveries({ channelId: f.channel.manifest.id, participantId: f.fast.id,
        afterCursor: -1, limit: 10 })
      expect(pending.deliveries.map(value => value.envelope.id)).toEqual([envelope.id])
      await expect(acknowledge(f, f.slow)).rejects.toBeDefined()
      expect((await post(f, f.channel.manifest.id, null)).audience).toBeNull()
    })

    it(`fails an optional-member timeout when the consult protocol cannot remove its required role on ${backend}`, async () => {
      const f = await setup(backend, false, 150)
      await f.ctx.plugin(Basic)
      const channel = await openTestChannel(f.ctx, { teamId: f.teamId,
        expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor,
        adapter: { type: 'consult', version: 1 }, viewPolicy: { type: 'full-transcript', version: 1 },
        participants: [{ id: f.sender.id, role: 'initiator' }, { id: f.fast.id, role: 'respondent' }], limits: {},
        invitations: [{ participantId: f.fast.id, required: false }] })
      await acknowledge(f, f.sender, channel.manifest.id)
      const result = await expireThroughConsumer(f, channel.manifest.id)
      expect(result.channel.phase).toBe('failed')
      expect(result.invitations.find(value => value.participantId === f.fast.id)?.reason?.code).toBe('TEAM_CHANNEL_OPTIONAL_REMOVAL_UNSUPPORTED')
    })

    it(`cancels pending invitations before closure and refuses a late acknowledgement on ${backend}`, async () => {
      const f = await setup(backend)
      const closed = await closeTestChannel(f.ctx, { channelId: f.channel.manifest.id, expectedCursor: f.channel.cursor, reason: 'Creator stopped' })
      expect(closed.phase).toBe('closed')
      const admission = await f.ctx.teams.getChannelAdmission({ channelId: closed.manifest.id })
      expect(admission.invitations.map(value => value.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
      await expect(acknowledge(f, f.sender)).rejects.toBeDefined()
      expect((await f.ctx.teams.getChannelAdmission({ channelId: closed.manifest.id })).channel.phase).toBe('closed')
    })

    it(`keeps send pending until all three exact activation acknowledgements are durable on ${backend}`, async () => {
      const f = await setup(backend)
      const channelId = f.channel.manifest.id
      expect(f.channel.phase).toBe('pending')
      const original = await f.ctx.teams.getChannelAdmission({ channelId })
      expect(original.invitations.map(invitation => invitation.status)).toEqual(['pending', 'pending', 'pending'])
      await expect(post(f, channelId, null)).rejects.toBeDefined()
      const slowActor = await postActor(f.ctx, f.teamId, f.slow.id)
      const actors = [f.senderActor, f.fastActor, slowActor]
      for (const [index, invitation] of original.invitations.entries()) {
        const actor = actors[index]!
        const input = { channelId, revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
          idempotencyKey: channelInvitationIdempotencyKeySchema.parse(`endpoint-${index}`) }
        await expect(f.ctx.teams.acknowledgeChannelInvitation({ actor, ...input, revision: input.revision + 1 }))
          .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
        const result = await f.ctx.teams.acknowledgeChannelInvitation({ actor, ...input })
        expect(result.channel.phase).toBe(index === 2 ? 'active' : 'pending')
        expect(await f.ctx.teams.acknowledgeChannelInvitation({ actor, ...input })).toEqual(result)
      }
      const broadcast = await post(f, channelId, null)
      const rows = (await f.ctx.teams.readChannel({ channelId, afterCursor: -1 })).records
      const recorded = rows.find(row => row.type === 'channel/envelope')
      expect(recorded?.type === 'channel/envelope' ? recorded.deliveryIntents : undefined).toEqual([
        { participantId: f.fast.id, envelopeId: broadcast.id, delivery: 'context' },
        { participantId: f.slow.id, envelopeId: broadcast.id, delivery: 'context' },
      ])
      await f.ctx.fiber.dispose()
      contexts.delete(f.ctx)
      const recovered = await hub(backend, f.root)
      const restored = await recovered.teams.getChannelAdmission({ channelId })
      expect(restored.channel.phase).toBe('active')
      expect(restored.invitations.map(invitation => invitation.status)).toEqual(['acknowledged', 'acknowledged', 'acknowledged'])
      expect((await recovered.teams.readChannel({ channelId, afterCursor: -1 })).records).toEqual(rows)
    })
  }
})
