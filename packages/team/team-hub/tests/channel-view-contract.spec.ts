import { fingerprintChannelSummarySources } from '@clocky/clocky-team'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { channelSummaryIdempotencyKeySchema, jsonObjectSchema } from '@clocky/clocky-team'
import type { JsonObject, ParticipantId, TeamViewPolicy } from '@clocky/clocky-team'
import { consultChannelAdapter, discussionChannelAdapter } from '../../team-channel-basic/src/index.ts'
import { FULL_TRANSCRIPT_VIEW_POLICY, RECENT_WINDOW_VIEW_POLICY, SUMMARIZED_WINDOW_VIEW_POLICY } from '../../team-channel-direct/src/index.ts'
import { workflowChannelAdapter } from '../../team-channel-workflow/src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { summarizeTestChannel } from '../../../core/team/tests/channel-summary-authority.ts'
import TeamHub from '../src/index.ts'
import type { Config as TeamHubConfig } from '../src/index.ts'
import { postActor } from './fixtures.ts'
const roots: string[] = []
const contexts = new Set<Context>()
afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
/** Compose real channel protocols over project-local durable storage. */
async function setup(backend: 'json' | 'sqlite', config: Pick<TeamHubConfig, 'maxEnvelopeBytes' | 'maxChannelViewBytes'> = {}) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'channel-view-contract-'))
  roots.push(root)
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { recoveryPageSize: 1, ...config })
  ctx.teams.registerAdapter(consultChannelAdapter)
  ctx.teams.registerAdapter(discussionChannelAdapter)
  ctx.teams.registerAdapter(workflowChannelAdapter)
  ctx.teams.registerViewPolicy(FULL_TRANSCRIPT_VIEW_POLICY)
  ctx.teams.registerViewPolicy(RECENT_WINDOW_VIEW_POLICY)
  ctx.teams.registerViewPolicy(SUMMARIZED_WINDOW_VIEW_POLICY)
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Render channel views with bounded durable sources.', budgets: {} }, rules: {}, budgets: {},
  })
  const teamId = created.team.id
  const members: ParticipantId[] = []
  for (const role of ['initiator', 'respondent']) {
    const invited = await inviteBootstrapParticipant(ctx, {
      teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      kind: 'local-agent', displayName: role, role: role === 'initiator' ? 'coordinator' : role, capabilities: [],
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, { teamId, participantId: invited.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor, phase })
    }
    members.push(invited.id)
  }
  const [sender, recipient] = members
  if (sender === undefined || recipient === undefined) throw new Error('Channel views require two active participants')
  const senderActor = await postActor(ctx, teamId, sender)
  const recipientActor = await postActor(ctx, teamId, recipient)
  const participants = [{ id: sender, role: 'initiator' }, { id: recipient, role: 'respondent' }]
  return {
    ctx, teamId, sender, senderActor, recipientActor,
    async open(type: 'consult' | 'discussion' | 'workflow', limits: JsonObject, policy = FULL_TRANSCRIPT_VIEW_POLICY) {
      const channel = await openTestChannel(ctx, {
        teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
        adapter: { type, version: 1 }, viewPolicy: { type: policy.type, version: policy.version }, participants,
        limits: jsonObjectSchema.parse(JSON.parse(JSON.stringify(limits))),
      })
      const admission = await ctx.teams.getChannelAdmission({ channelId: channel.manifest.id })
      for (const invitation of admission.invitations) {
        const actor = invitation.participantId === sender ? senderActor : recipientActor
        await ctx.teams.acknowledgeChannelInvitation({ actor, channelId: channel.manifest.id,
          revision: invitation.revision, manifestFingerprint: invitation.manifestFingerprint,
          idempotencyKey: `view-consent-${invitation.participantId}` as never })
      }
      return await ctx.teams.getChannel({ channelId: channel.manifest.id })
    },
    async post(channelId: Parameters<typeof ctx.teams.getChannel>[0]['channelId'], text: string) {
      return await ctx.teams.postChannelEnvelope({ actor: senderActor,
        expectedCursor: (await ctx.teams.getChannel({ channelId })).cursor,
        draft: { channelId, audience: [recipient], kind: 'message', payload: { text }, delivery: 'turn' } })
    },
  }
}
/** Supply a valid built-in graph whose only capacity variable is its hard turn limit. */
function graph(sender: ParticipantId, maxTurns: number): JsonObject {
  return { initial: { kind: 'participant', participantId: sender },
    transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns }
}
describe('channel view admission and durable provenance', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`applies complete full-transcript capacity bounds to real protocols on ${backend}`, async () => {
      const rows = [
        { type: 'consult', turns: 2 },
        { type: 'discussion', turns: 1 },
        { type: 'workflow', turns: 2 },
      ] as const
      for (const row of rows) {
        for (const fits of [true, false]) {
          const harness = await setup(backend, { maxEnvelopeBytes: 1024, maxChannelViewBytes: row.turns * 6144 - (fits ? 0 : 1) })
          const limits = row.type === 'consult' ? {} : row.type === 'workflow'
            ? { graph: graph(harness.sender, row.turns) } : { maxTurns: row.turns, speakerPolicy: 'free-form' }
          const before = await harness.ctx.teams.getTeam({ teamId: harness.teamId })
          const opening = harness.open(row.type, jsonObjectSchema.parse(limits))
          if (fits) {
            const channel = await opening
            expect(channel.manifest).toMatchObject({ adapter: { type: row.type }, limits })
            expect((await harness.ctx.teams.getTeam({ teamId: harness.teamId })).channelIds).toEqual([channel.manifest.id])
          } else {
            await expect(opening).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
            expect(await harness.ctx.teams.getTeam({ teamId: harness.teamId })).toEqual(before)
          }
        }
      }
      const huge = await setup(backend, { maxEnvelopeBytes: Number.MAX_SAFE_INTEGER, maxChannelViewBytes: 6144 })
      const before = await huge.ctx.teams.getTeam({ teamId: huge.teamId })
      await expect(huge.open('discussion', { maxTurns: 1, speakerPolicy: 'free-form' }))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      expect(await huge.ctx.teams.getTeam({ teamId: huge.teamId })).toEqual(before)
    })
    it(`rejects JSON limits without a finite protocol turn bound before attaching a channel on ${backend}`, async () => {
      const harness = await setup(backend, { maxEnvelopeBytes: 1024, maxChannelViewBytes: 12288 })
      const before = await harness.ctx.teams.getTeam({ teamId: harness.teamId })
      const invalidLimits: JsonObject[] = [{}, { graph: null }, { graph: [] }, { graph: 'graph' }, { graph: {} }]
      for (const value of ['2', 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        invalidLimits.push({ graph: { ...graph(harness.sender, 2), maxTurns: value } })
      }
      for (const limits of invalidLimits) {
        await expect(harness.open('workflow', limits)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      }
      for (const limits of [{ speakerPolicy: 'free-form' }, ...['2', 0, 1.5, Number.MAX_SAFE_INTEGER + 1].map(maxTurns => ({
        maxTurns, speakerPolicy: 'free-form',
      }))]) {
        await expect(harness.open('discussion', limits)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      }
      expect(await harness.ctx.teams.getTeam({ teamId: harness.teamId })).toEqual(before)
    })
    it(`renders a durable summary and its later trigger through the summary extension API on ${backend}`, async () => {
      const harness = await setup(backend)
      const channel = await harness.open('discussion', { maxTurns: 8, speakerPolicy: 'free-form' }, SUMMARIZED_WINDOW_VIEW_POLICY)
      const channelId = channel.manifest.id
      const source = await harness.post(channelId, 'The retained source text.')
      const claim = { actor: harness.recipientActor, channelId, envelopeId: source.id }
      const before = await harness.ctx.teams.getChannel({ channelId })
      const summary = await summarizeTestChannel(harness.ctx, {
        requester: harness.senderActor,
        sourceFingerprint: fingerprintChannelSummarySources([source]), channelId, expectedCursor: before.cursor,
        coveredSequenceRange: { from: source.sequence, to: source.sequence }, sourceEnvelopeIds: [source.id],
        text: 'Durable summary of the retained source.', policy: { type: 'summarized-window', version: 1 },
        idempotencyKey: channelSummaryIdempotencyKeySchema.parse('view-source-summary') })
      const tail = await harness.post(channelId, 'The new trigger after the summary.')
      const claimed = await harness.ctx.teams.claimChannelDelivery({ ...claim, envelopeId: tail.id })
      expect(claimed?.view?.sourceEnvelopeIds).toEqual([source.id, tail.id])
      const content = claimed?.view?.content[0]
      if (content?.type !== 'text') throw new Error('Summary delivery requires a text view')
      expect(content.text).not.toContain('The retained source text.')
      expect(JSON.parse(content.text)).toMatchObject({ adapter: { type: 'discussion', version: 1, expectedNext: { kind: 'none' } } })
      const text = JSON.parse(content.text) as { view: JsonObject }
      expect(text.view.messages).toEqual([
        { id: summary.idempotencyKey, sequence: source.sequence, kind: 'summary', summary: summary.text },
        { id: tail.id, sequence: tail.sequence, senderId: tail.senderId, kind: tail.kind, payload: tail.payload },
      ])
      // Delivery rendering stops at its triggering Envelope, even after a later summary is durable.
      const original = await harness.ctx.teams.claimChannelDelivery(claim)
      expect(original?.view?.sourceEnvelopeIds).toEqual([source.id])
    })
    it(`does not leak history omitted by recent-window through adapter rendering on ${backend}`, async () => {
      const harness = await setup(backend)
      const channel = await harness.open('discussion', { maxTurns: 30, speakerPolicy: 'free-form' }, RECENT_WINDOW_VIEW_POLICY)
      const omitted = await harness.post(channel.manifest.id, 'OMITTED_EARLY_ORIGINAL')
      let latest = omitted
      for (let index = 0; index < 20; index++) latest = await harness.post(channel.manifest.id, `retained message ${index}`)
      const claimed = await harness.ctx.teams.claimChannelDelivery({ actor: harness.recipientActor,
        channelId: channel.manifest.id, envelopeId: latest.id })
      const content = claimed?.view?.content[0]
      if (content?.type !== 'text') throw new Error('Recent delivery requires text')
      expect(content.text).not.toContain('OMITTED_EARLY_ORIGINAL')
      expect(content.text).toContain('retained message 19')
      expect(claimed?.view?.sourceEnvelopeIds).toHaveLength(20)
      expect(claimed?.view?.sourceEnvelopeIds).not.toContain(omitted.id)
    })
    it(`rejects invalid pure policy selections and retains sources for opaque custom views on ${backend}`, async () => {
      const harness = await setup(backend)
      const invalid: JsonObject[] = [{ messages: null }, { messages: [] }, { messages: [null] },
        { messages: [{}] }, { messages: [{ id: 4 }] }, { messages: [{ id: '' }] }]
      for (const [index, output] of invalid.entries()) {
        const policy: TeamViewPolicy = { type: `invalid-selection-${index}`, version: 1, project: () => structuredClone(output) }
        harness.ctx.teams.registerViewPolicy(policy)
        const channel = await harness.open('discussion', { maxTurns: 8, speakerPolicy: 'free-form' }, policy)
        const envelope = await harness.post(channel.manifest.id, 'A real accepted source.')
        const before = await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })
        await expect(harness.ctx.teams.claimChannelDelivery({ actor: harness.recipientActor,
          channelId: channel.manifest.id, envelopeId: envelope.id })).rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
        expect(await harness.ctx.teams.readChannel({ channelId: channel.manifest.id, afterCursor: -1 })).toEqual(before)
      }
      const opaque: TeamViewPolicy = { type: 'opaque-source-count', version: 1,
        project: ({ records }) => ({ count: records.filter(record => record.type === 'channel/envelope').length }) }
      harness.ctx.teams.registerViewPolicy(opaque)
      const channel = await harness.open('discussion', { maxTurns: 8, speakerPolicy: 'free-form' }, opaque)
      const first = await harness.post(channel.manifest.id, 'First retained source.')
      const trigger = await harness.post(channel.manifest.id, 'Last retained source.')
      const claim = await harness.ctx.teams.claimChannelDelivery({ actor: harness.recipientActor,
        channelId: channel.manifest.id, envelopeId: trigger.id })
      expect(claim?.view?.sourceEnvelopeIds).toEqual([first.id, trigger.id])
      const content = claim?.view?.content[0]
      if (content?.type !== 'text') throw new Error('Opaque delivery requires a text view')
      expect(JSON.parse(content.text)).toMatchObject({ view: { count: 2 } })
    })
  }
})
