import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import { channelInvitationIdempotencyKeySchema, fingerprintChannelManifest, fingerprintTeamHumanActorPayload, jsonObjectSchema, channelPostIdempotencyKeySchema } from '@clocky/clocky-team'
import type { ChannelId, ParticipantSnapshot, TeamHumanActorProof, TeamHumanActorProofInput, TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope } from '@clocky/clocky-team'
import * as Direct from '../../team-channel-direct/src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
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

async function hub(backend: Backend, root: string) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(Direct)
  return ctx
}

async function setup(backend: Backend) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'direct-v4-'))
  roots.push(root)
  const ctx = await hub(backend, root)
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Address direct messages explicitly.', budgets: {} }, rules: {}, budgets: {} })
  const teamId = team.team.id
  const members: ParticipantSnapshot[] = []
  const admissionProofs = new WeakMap<TeamSystemChannelAdmissionProof, TeamSystemChannelAdmissionScope>()
  ctx.teams.registerSystemChannelAdmissionProofSource({ name: 'team-run', resolveChannelAdmissionProof: proof => admissionProofs.get(proof) })
  const issueHumanAdmission = (scope: Extract<TeamSystemChannelAdmissionScope, { readonly kind: 'channel-invitation-acknowledge' }>) => {
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('direct-v4 admission proof is runtime-only') } })
    const proof = Object.freeze(token) as TeamSystemChannelAdmissionProof
    admissionProofs.set(proof, scope)
    return proof
  }
  for (const role of ['coordinator', 'worker', 'worker-2', 'human']) {
    const participant = await inviteBootstrapParticipant(ctx, { teamId,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: role === 'human' ? 'human' : 'local-agent', displayName: role, role, capabilities: [],
      ...role === 'human' ? { owner: { kind: 'system' as const } } : {} })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: participant.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    members.push(participant)
  }
  const [sender, fast, slow, human] = members
  if (sender === undefined || fast === undefined || slow === undefined || human === undefined) throw new Error('Direct fixture lacks members')
  const senderActor = await postActor(ctx, teamId, sender.id)
  const fastActor = await postActor(ctx, teamId, fast.id)
  await postActor(ctx, teamId, slow.id)
  const open = async (participants: readonly { id: ParticipantSnapshot['id']; role: string }[]) => {
    const opened = await openTestChannel(ctx, {
      teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      adapter: Direct.DIRECT_CHANNEL_ADAPTER_V4, participants, limits: {},
    })
    const activated = await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
    const human = participants.find(participant => participant.role === 'human')
    if (human !== undefined) {
      const admission = await ctx.teams.getChannelAdmission({ channelId: activated.manifest.id })
      const invitation = admission.invitations.find(value => value.participantId === human.id)
      if (invitation?.status === 'pending') {
        const idempotencyKey = channelInvitationIdempotencyKeySchema.parse(`direct-v4-human:${String(human.id)}`)
        await ctx.teams.acknowledgeChannelInvitation({
          actor: issueHumanAdmission({ kind: 'channel-invitation-acknowledge', teamId, channelId: activated.manifest.id,
            participantId: human.id, revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint, idempotencyKey }),
          channelId: activated.manifest.id, revision: invitation.revision,
          manifestFingerprint: fingerprintChannelManifest(activated.manifest), idempotencyKey,
        })
      }
    }
    return await ctx.teams.getChannel({ channelId: activated.manifest.id })
  }
  const opened = await open([sender, fast, slow].map(participant => ({ id: participant.id, role: participant.role })))
  const channel = await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
  return { ctx, root, teamId, sender, fast, slow, human, senderActor, fastActor, channel, open }
}

async function post(f: Awaited<ReturnType<typeof setup>>, channelId: ChannelId, audience: readonly ParticipantSnapshot['id'][] | null) {
  return await f.ctx.teams.postChannelEnvelope({ actor: f.senderActor,
    expectedCursor: (await f.ctx.teams.getChannel({ channelId })).cursor,
    draft: { channelId, audience, kind: 'message', payload: { content: [{ type: 'text', text: 'Explicit direct message.' }] }, delivery: 'context' } })
}

describe('direct v4 through durable Hub admission', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`keeps subset and broadcast receipts independent across recovery on ${backend}`, async () => {
      const f = await setup(backend)
      const channelId = f.channel.manifest.id
      const subset = await post(f, channelId, [f.fast.id])
      const broadcast = await post(f, channelId, null)
      expect(subset.audience).toEqual([f.fast.id])
      expect(broadcast.audience).toBeNull()
      for (const envelope of [subset, broadcast]) {
        expect(await f.ctx.teams.claimChannelDelivery({ actor: f.fastActor, channelId, envelopeId: envelope.id })).toBeDefined()
        await f.ctx.teams.ackChannelEnvelope({ actor: f.fastActor, channelId, envelopeId: envelope.id,
          expectedCursor: (await f.ctx.teams.getChannel({ channelId })).cursor })
        expect(await f.ctx.teams.claimChannelDelivery({ actor: f.fastActor, channelId, envelopeId: envelope.id })).toBeUndefined()
      }
      await f.ctx.fiber.dispose()
      contexts.delete(f.ctx)
      const recovered = await hub(backend, f.root)
      const slowActor = await postActor(recovered, f.teamId, f.slow.id)
      await expect(recovered.teams.claimChannelDelivery({ actor: slowActor, channelId, envelopeId: subset.id }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      expect(await recovered.teams.claimChannelDelivery({ actor: slowActor, channelId, envelopeId: broadcast.id })).toBeDefined()
      await recovered.teams.ackChannelEnvelope({ actor: slowActor, channelId, envelopeId: broadcast.id,
        expectedCursor: (await recovered.teams.getChannel({ channelId })).cursor })
      const records = (await recovered.teams.readChannel({ channelId, afterCursor: -1 })).records
      expect(records.filter(record => record.type === 'channel/receipt').map(record => [record.participantId, record.envelopeId]))
        .toEqual([[f.fast.id, subset.id], [f.fast.id, broadcast.id], [f.slow.id, broadcast.id]])
      expect(records.filter(record => record.type === 'channel/envelope')).toHaveLength(2)
    })

    it(`rejects invalid subsets and a broadcast to a departed member before an Envelope commit on ${backend}`, async () => {
      const f = await setup(backend)
      const channelId = f.channel.manifest.id
      const before = await f.ctx.teams.readChannel({ channelId, afterCursor: -1 })
      for (const audience of [[], [f.sender.id], [f.fast.id, f.fast.id], [f.human.id]]) {
        await expect(post(f, channelId, audience)).rejects.toBeDefined()
        expect(await f.ctx.teams.readChannel({ channelId, afterCursor: -1 })).toEqual(before)
      }
      const input = { teamId: f.teamId, participantId: f.slow.id,
        expectedCursor: (await f.ctx.teams.getTeam({ teamId: f.teamId })).team.cursor, phase: 'left' as const }
      const expected: TeamHumanActorProofInput = { teamId: f.teamId, operation: 'close',
        fence: { kind: 'cursor', cursor: input.expectedCursor }, payload: jsonObjectSchema.parse(input) }
      const actor = Object.freeze({}) as TeamHumanActorProof
      const unregister = f.ctx.teams.registerHumanActorProofSource({ name: 'direct-v4-human', resolveHumanActorProof: candidate => candidate === actor
        ? { teamId: f.teamId, participantId: f.human.id, operation: 'close', fence: expected.fence,
          payloadFingerprint: fingerprintTeamHumanActorPayload(expected) } : undefined })
      try { await f.ctx.teams.transitionParticipantPhase({ actor, ...input }) }
      finally { unregister() }
      await expect(post(f, channelId, null)).rejects.toMatchObject({ code: 'TEAM_PARTICIPANT_NOT_FOUND' })
      expect(await f.ctx.teams.readChannel({ channelId, afterCursor: -1 })).toEqual(before)
      expect(await post(f, channelId, [f.fast.id])).toMatchObject({ audience: [f.fast.id] })
    })

    it(`restricts finals to the exact two-party coordinator and actual human on ${backend}`, async () => {
      const f = await setup(backend)
      await expect(f.ctx.teams.postChannelFinalEnvelope({ actor: f.senderActor, channelId: f.channel.manifest.id,
        idempotencyKey: channelPostIdempotencyKeySchema.parse('group-final'), text: 'Not a group final.' })).rejects.toBeDefined()
      const forged = await f.open([{ id: f.sender.id, role: 'coordinator' }, { id: f.fast.id, role: 'human' }])
      await expect(f.ctx.teams.postChannelFinalEnvelope({ actor: f.senderActor, channelId: forged.manifest.id,
        idempotencyKey: channelPostIdempotencyKeySchema.parse('forged-human'), text: 'Not a human recipient.' }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const product = await f.open([{ id: f.sender.id, role: 'coordinator' }, { id: f.human.id, role: 'human' }])
      for (const delivery of ['context', 'steer'] as const) {
        await expect(f.ctx.teams.postChannelEnvelope({ actor: f.senderActor,
          expectedCursor: product.cursor, draft: { channelId: product.manifest.id, audience: [f.human.id],
            kind: 'final', payload: { text: 'Wrong delivery.' }, delivery } })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      }
      await expect(f.ctx.teams.postChannelEnvelope({ actor: f.senderActor, expectedCursor: product.cursor,
        draft: { channelId: product.manifest.id, audience: null, kind: 'final', payload: { text: 'No broadcast final.' }, delivery: 'turn' } }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      const final = await f.ctx.teams.postChannelFinalEnvelope({ actor: f.senderActor, channelId: product.manifest.id,
        idempotencyKey: channelPostIdempotencyKeySchema.parse('human-final'), text: 'Explicit product final.' })
      expect(final).toMatchObject({ audience: [f.human.id], kind: 'final', payload: { text: 'Explicit product final.' }, delivery: 'turn' })
      expect((await f.ctx.teams.getChannel({ channelId: product.manifest.id })).phase).toBe('active')
    })
  }
})
