import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type {
  ChannelSummarySourceRequest,
  TeamActorProof,
  TeamChannelAdapter,
  TeamViewPolicy,
} from '@clocky/clocky-team'
import TeamHub from '../../team-hub/src/index.ts'
import * as Summary from '../src/index.ts'
import { fingerprintChannelSummarySources } from '@clocky/clocky-team'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { postActor } from '../../team-hub/tests/fixtures.ts'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const directAdapter: TeamChannelAdapter = {
  type: 'direct',
  version: 1,
  validateCreate() {},
  initialState() { return {} },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
}
const summaryPolicy: TeamViewPolicy = {
  type: 'summary-test',
  version: 1,
  project() { return {} },
}
/** Compose the local Hub over one isolated JSON Team journal backend. */
async function setup(overrides: Partial<Summary.Config> = {}): Promise<{
  readonly ctx: Context
  retirePolicy(): void
  dispose(): Promise<void>
}> {
  const root = await freshRoot()
  const ctx = new Context()
  let retirePolicy = (): void => {}
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    ctx.teams.registerAdapter(directAdapter)
    retirePolicy = ctx.teams.registerViewPolicy(summaryPolicy)
    await ctx.plugin(Summary, { allowedPolicies: ['summary-test'], maxSourceEnvelopes: 8, maxSourceBytes: 65536, maxSummaryBytes: 1024, maxHistorySpan: 32, disposalTimeoutMs: 5000, ...overrides })
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
  return { ctx, retirePolicy, async dispose() { await ctx.fiber.dispose() } }
}
/** Allocate one repository-local root for an isolated durable Team journal. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-summary-authority-'))
  roots.push(root)
  return root
}
/** Create one active channel with an accepted source Envelope and summary input. */
async function summaryInput(
  ctx: Context, options: { hidden?: boolean; text?: string; role?: string } = {},
): Promise<ChannelSummarySourceRequest & { requester: TeamActorProof }> {
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Summarize one channel.', budgets: {} }, rules: {}, budgets: {} })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId: team.team.id,
    expectedCursor: team.team.cursor,
    kind: 'local-agent', displayName: 'Summarizer', role: options.role ?? 'coordinator', capabilities: [],
  })
  let state = await ctx.teams.getTeam({ teamId: team.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: team.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: team.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active',
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  const others = []
  const activationParticipantIds = [invited.id]
  if (options.hidden === true) {
    const member = await inviteBootstrapParticipant(ctx, {
      teamId: team.team.id, expectedCursor: state.team.cursor,
      kind: 'local-agent', displayName: 'Other member', role: 'worker', capabilities: [],
    })
    for (const phase of ['provisioning', 'active'] as const) await transitionBootstrapParticipant(ctx, {
      teamId: team.team.id, participantId: member.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId: team.team.id })).team.cursor, phase,
    })
    others.push({ id: member.id, role: 'other' })
    activationParticipantIds.push(member.id)
    state = await ctx.teams.getTeam({ teamId: team.team.id })
  }
  for (const participantId of activationParticipantIds) await postActor(ctx, team.team.id, participantId)
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  const channel = await openTestChannel(ctx, {
    teamId: team.team.id,
    expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 1 },
    viewPolicy: { type: summaryPolicy.type, version: summaryPolicy.version },
    participants: [{ id: invited.id, role: 'participant' }, ...others],
    limits: {},
  })
  await acknowledgeTestChannelActivations(ctx, channel.manifest.id)
  const activeChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
  const actor = await postActor(ctx, team.team.id, invited.id)
  const envelope = await ctx.teams.postChannelEnvelope({
    actor,
    expectedCursor: activeChannel.cursor,
    draft: {
      channelId: channel.manifest.id,
      audience: [], kind: 'message', payload: { text: options.text ?? 'Source summary input.' }, delivery: 'context',
    },
  })
  return {
    channelId: channel.manifest.id,
    expectedCursor: envelope.sequence,
    coveredSequenceRange: { from: envelope.sequence, to: envelope.sequence },
    requester: actor,
    idempotencyKey: 'summary-authority-test' as never,
  }
}
describe('explicit channel summary Consumer', () => {
  it('commits extracted text and source fingerprint, then returns the same durable retry', async () => {
    const harness = await setup()
    try {
      const request = await summaryInput(harness.ctx)
      const before = await harness.ctx.teams.readChannel({ channelId: request.channelId, afterCursor: -1 })
      const sources = before.records.filter(record => record.type === 'channel/envelope').map(record => record.envelope)
      const summary = await harness.ctx.teamChannelSummaries.summarize(request)
      expect(summary.text).toBe(`[${String(request.expectedCursor)}] Source summary input.`)
      expect(summary.sourceFingerprint).toBe(fingerprintChannelSummarySources(sources))
      expect(await harness.ctx.teamChannelSummaries.summarize(request)).toEqual(summary)
      const after = await harness.ctx.teams.readChannel({ channelId: request.channelId, afterCursor: -1 })
      expect(after.records.filter(record => record.type === 'channel/summary')).toEqual([summary])
    } finally { await harness.dispose() }
  })
  it('rejects a stale cursor for a new identity without appending another summary', async () => {
    const harness = await setup()
    try {
      const request = await summaryInput(harness.ctx)
      await harness.ctx.teamChannelSummaries.summarize(request)
      await expect(harness.ctx.teamChannelSummaries.summarize({ ...request, idempotencyKey: 'different' as never }))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
    } finally { await harness.dispose() }
  })
  it('bounds source bytes before generation and rejects a closed Consumer', async () => {
    const harness = await setup({ maxSourceBytes: 1 })
    try {
      const request = await summaryInput(harness.ctx)
      await expect(harness.ctx.teamChannelSummaries.summarize(request)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
      await harness.ctx.teamChannelSummaries.close()
      await expect(harness.ctx.teamChannelSummaries.summarize(request)).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    } finally { await harness.dispose() }
  })
  it('rejects hidden subset content and non-coordinator requests without returning source text', async () => {
    const harness = await setup()
    try {
      const hidden = await summaryInput(harness.ctx, { hidden: true, text: 'PRIVATE_SOURCE_VALUE' })
      await expect(harness.ctx.teamChannelSummaries.summarize(hidden)).rejects.toMatchObject({ code: 'TEAM_GRANT_DENIED' })
      try { await harness.ctx.teamChannelSummaries.summarize(hidden) } catch (error: unknown) {
        expect(String(error)).not.toContain('PRIVATE_SOURCE_VALUE')
      }
      const worker = await summaryInput(harness.ctx, { role: 'worker' })
      await expect(harness.ctx.teamChannelSummaries.summarize(worker)).rejects.toMatchObject({ code: 'TEAM_GRANT_DENIED' })
      expect((await harness.ctx.teams.readChannel({ channelId: hidden.channelId, afterCursor: -1 })).records
        .filter(record => record.type === 'channel/summary')).toEqual([])
    } finally { await harness.dispose() }
  })
  it('keeps Unicode characters whole within the configured UTF-8 text allowance', async () => {
    const harness = await setup({ maxSummaryBytes: 9 })
    try {
      const request = await summaryInput(harness.ctx, { text: '你好 world' })
      const summary = await harness.ctx.teamChannelSummaries.summarize(request)
      expect(summary.text).toBe('[5] 你')
      expect(Buffer.byteLength(summary.text, 'utf8')).toBeLessThanOrEqual(9)
    } finally { await harness.dispose() }
  })
  it('rejects an empty message range and conflicting retry selection', async () => {
    const harness = await setup()
    try {
      const request = await summaryInput(harness.ctx)
      await expect(harness.ctx.teamChannelSummaries.summarize({ ...request, coveredSequenceRange: { from: 0, to: 1 } }))
        .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
      await harness.ctx.teamChannelSummaries.summarize(request)
      await expect(harness.ctx.teamChannelSummaries.summarize({ ...request,
        coveredSequenceRange: { from: 0, to: request.expectedCursor } }))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_IDEMPOTENCY_CONFLICT' })
    } finally { await harness.dispose() }
  })
  it('rejects an output allowance that can retain only a sequence label', async () => {
    const harness = await setup({ maxSummaryBytes: 4 })
    try {
      const request = await summaryInput(harness.ctx)
      await expect(harness.ctx.teamChannelSummaries.summarize(request)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_BACKPRESSURE' })
    } finally { await harness.dispose() }
  })
  it('refuses new work after policy retirement while preserving its committed retry result', async () => {
    const harness = await setup()
    try {
      const request = await summaryInput(harness.ctx)
      const summary = await harness.ctx.teamChannelSummaries.summarize(request)
      harness.retirePolicy()
      expect(await harness.ctx.teamChannelSummaries.summarize(request)).toEqual(summary)
      await expect(harness.ctx.teamChannelSummaries.summarize({ ...request, expectedCursor: summary.sequence,
        idempotencyKey: 'retired-new-summary' as never })).rejects.toMatchObject({ code: 'TEAM_ADAPTER_NOT_FOUND' })
    } finally { await harness.dispose() }
  })
  it('rejects an intervening real message instead of silently expanding the selected source range', async () => {
    const harness = await setup()
    try {
      const request = await summaryInput(harness.ctx)
      const read = harness.ctx.teams.readChannelSummarySource.bind(harness.ctx.teams)
      vi.spyOn(harness.ctx.teams, 'readChannelSummarySource').mockImplementationOnce(async (input) => {
        const source = await read(input)
        await harness.ctx.teams.postChannelEnvelope({ actor: request.requester,
          expectedCursor: request.expectedCursor, draft: { channelId: request.channelId, audience: [], kind: 'message',
            payload: { text: 'A new accepted message.' }, delivery: 'context' } })
        return source
      })
      await expect(harness.ctx.teamChannelSummaries.summarize(request)).rejects.toMatchObject({ code: 'TEAM_CHANNEL_CURSOR_CONFLICT' })
      const records = (await harness.ctx.teams.readChannel({ channelId: request.channelId, afterCursor: -1 })).records
      expect(records.filter(record => record.type === 'channel/envelope')).toHaveLength(2)
      expect(records.filter(record => record.type === 'channel/summary')).toHaveLength(0)
    } finally { await harness.dispose() }
  })
})
