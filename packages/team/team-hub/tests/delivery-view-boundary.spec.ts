import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage, { type LogStream } from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { TeamError } from '@clocky/clocky-team'
import type { ChannelDeliveryClaim, ParticipantId, TeamViewPolicy } from '@clocky/clocky-team'
import { discussionChannelAdapter } from '@clocky/clocky-team-channel-basic'
import { DIRECTED_VIEW_POLICY } from '@clocky/clocky-team-channel-direct'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { postActor } from './fixtures.ts'
import TeamHub from '../src/index.ts'
import { TeamHubError } from '../src/error.ts'

const roots: string[] = []
const contexts = new Set<Context>()
const maxViewBytes = 4096

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Build a real bounded discussion whose registered policy controls only its projection output. */
async function setup(
  backend: 'json' | 'sqlite',
  project: TeamViewPolicy['project'],
  limit = maxViewBytes,
  source = 'A small accepted message.',
) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'delivery-view-boundary-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { maxChannelViewBytes: limit, recoveryPageSize: 1 })
  let channelStream: LogStream | undefined
  const open = ctx.storageLog.open.bind(ctx.storageLog)
  vi.spyOn(ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
    const stream = await open(descriptor)
    if (descriptor.name.startsWith('channel/')) channelStream = stream
    return stream
  })
  ctx.teams.registerAdapter(discussionChannelAdapter)
  ctx.teams.registerViewPolicy({ type: 'test-projection', version: 1, project })
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Keep delivery views bounded and causal.', budgets: {} }, rules: {}, budgets: {},
  })
  const members: ParticipantId[] = []
  for (const role of ['sender', 'recipient']) {
    const invited = await inviteBootstrapParticipant(ctx, {
      teamId: created.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      kind: 'local-agent', displayName: role, role, capabilities: [],
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId: created.team.id, participantId: invited.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor, phase })
    }
    members.push(invited.id)
  }
  const [sender, recipient] = members
  if (sender === undefined || recipient === undefined) throw new Error('Delivery fixture requires two active participants')
  const senderActor = await postActor(ctx, created.team.id, sender)
  await postActor(ctx, created.team.id, recipient)
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  const binding = state.activations.find(binding => binding.activation.participantId === recipient)
  if (binding === undefined) throw new Error('Delivery fixture requires the recipient activation')
  const recipientActor = ctx.teams.openActivationActorProofIssuer().issue(binding)
  const opened = await openTestChannel(ctx, {
    teamId: created.team.id, expectedCursor: state.team.cursor, adapter: { type: 'discussion', version: 1 },
    viewPolicy: { type: 'test-projection', version: 1 }, participants: [{ id: sender, role: 'sender' }, { id: recipient, role: 'recipient' }],
    limits: { maxTurns: 8, speakerPolicy: 'free-form' },
  })
  const channel = await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
  const envelope = await ctx.teams.postChannelEnvelope({ actor: senderActor, expectedCursor: channel.cursor,
    draft: { channelId: channel.manifest.id, audience: [recipient], kind: 'message', payload: { text: source }, delivery: 'turn' } })
  const claim = { actor: recipientActor.proof, channelId: channel.manifest.id, envelopeId: envelope.id }
  if (channelStream === undefined) throw new Error('Delivery fixture did not open its channel WAL')
  return { ctx, senderActor, recipientActor, recipient, envelope, claim, channelStream }
}

/** Read the model-visible text carried by a successful Hub claim. */
function viewText(claim: ChannelDeliveryClaim | undefined): string {
  const content = claim?.view?.content[0]
  if (content?.type !== 'text') throw new Error('Delivery did not contain a text view')
  return content.text
}

describe('delivery view output bounds', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`rejects the same oversized pure projection while another valid source fits on ${backend}`, async () => {
      const project: TeamViewPolicy['project'] = input => ({
        ...DIRECTED_VIEW_POLICY.project(input),
        padding: input.records.some(record => record.type === 'channel/envelope' && record.envelope.payload.text === 'large source')
          ? '中'.repeat(512) : '',
      })
      const preview = await setup(backend, project, 16384, 'large source')
      const previewText = viewText(await preview.ctx.teams.claimChannelDelivery(preview.claim))
      const bytes = Buffer.byteLength(previewText, 'utf8')
      const boundary = await setup(backend, project, bytes, 'large source')
      expect(Buffer.byteLength(viewText(await boundary.ctx.teams.claimChannelDelivery(boundary.claim)), 'utf8')).toBe(bytes)
      const limit = bytes - 1
      expect(previewText.length).toBeLessThan(limit)
      const oversized = await setup(backend, project, limit, 'large source')
      const before = await oversized.ctx.teams.getChannel({ channelId: oversized.claim.channelId })
      const teamBefore = await oversized.ctx.teams.getTeam({ teamId: oversized.envelope.teamId })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(oversized.ctx.teams.claimChannelDelivery(oversized.claim)).rejects.toSatisfy((error: unknown) =>
          error instanceof TeamError && error.code === 'TEAM_CHANNEL_BACKPRESSURE'
            && error.message.includes(`${bytes} bytes, exceeding maxChannelViewBytes ${limit}`),
        )
        expect(await oversized.ctx.teams.getChannel({ channelId: oversized.claim.channelId })).toEqual(before)
        expect(await oversized.ctx.teams.getTeam({ teamId: oversized.envelope.teamId })).toEqual(teamBefore)
      }
      const small = await setup(backend, project, limit, 'small source')
      const accepted = await small.ctx.teams.claimChannelDelivery(small.claim)
      expect(Buffer.byteLength(viewText(accepted), 'utf8')).toBeLessThan(limit)
      expect(accepted?.view?.sourceEnvelopeIds).toEqual([small.envelope.id])
    })

    it(`keeps an earlier delivery causal and rejects reversed provenance from a pure policy on ${backend}`, async () => {
      const harness = await setup(backend, input => ({ messages: input.records.flatMap(record => record.type === 'channel/envelope'
        ? [{ id: record.envelope.id }] : []).reverse() }))
      const current = await harness.ctx.teams.getChannel({ channelId: harness.claim.channelId })
      const future = await harness.ctx.teams.postChannelEnvelope({ actor: harness.senderActor, expectedCursor: current.cursor,
        draft: { channelId: harness.claim.channelId, audience: [harness.recipient], kind: 'message',
          payload: { text: 'A later message must not enter the earlier view.' }, delivery: 'turn' } })
      const before = await harness.ctx.teams.getChannel({ channelId: harness.claim.channelId })
      const earlier = await harness.ctx.teams.claimChannelDelivery(harness.claim)
      expect(earlier?.view?.sourceEnvelopeIds).toEqual([harness.envelope.id])
      expect(viewText(earlier)).not.toContain('A later message')
      const later = harness.ctx.teams.claimChannelDelivery({ ...harness.claim, envelopeId: future.id })
      await expect(later).rejects.toSatisfy((error: unknown) =>
        error instanceof TeamHubError && error.code === 'TEAM_CHANNEL_WAL_MALFORMED'
          && error.message.includes('non-causal Envelope provenance'),
      )
      expect(await harness.ctx.teams.getChannel({ channelId: harness.claim.channelId })).toEqual(before)
    })

    it(`rejects a delivery proof revoked during a real source read and permits a fresh proof on ${backend}`, async () => {
      const harness = await setup(backend, input => DIRECTED_VIEW_POLICY.project(input))
      const before = await harness.ctx.teams.getChannel({ channelId: harness.claim.channelId })
      const entered = Promise.withResolvers<undefined>()
      const gate = Promise.withResolvers<undefined>()
      const read = harness.channelStream.read.bind(harness.channelStream)
      vi.spyOn(harness.channelStream, 'read').mockImplementationOnce(async (...args) => {
        const records = await read(...args)
        entered.resolve(undefined)
        await gate.promise
        return records
      })
      const claiming = harness.ctx.teams.claimChannelDelivery(harness.claim)
      const outcome = expect(claiming).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      await entered.promise
      harness.recipientActor.revoke()
      gate.resolve(undefined)
      await outcome
      expect(await harness.ctx.teams.getChannel({ channelId: harness.claim.channelId })).toEqual(before)
      const actor = await postActor(harness.ctx, harness.envelope.teamId, harness.recipient)
      await expect(harness.ctx.teams.claimChannelDelivery({ ...harness.claim, actor })).resolves.toMatchObject({
        envelopeId: harness.envelope.id, view: { sourceEnvelopeIds: [harness.envelope.id] },
      })
    })
  }
})
