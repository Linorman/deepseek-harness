import type { ChannelId } from '@clocky/clocky-client-connection/client'
import { Context } from '@clocky/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamChannelSummary } from '../src/client/contract/team-tasks.ts'
import { TeamTaskRuntime } from '../src/client/teams/service.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'
import type { ChannelReadPageResult } from '@clocky/clocky-client-connection/client'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
function setup() {
  const ctx = new Context(); contexts.push(ctx)
  const api = new FakeApiClient()
  return { api, tasks: new TeamTaskRuntime(ctx, api) }
}

it('refreshes active catalog registrations after reconnect and discards an older catalog failure', async () => {
  const { api, tasks } = setup()
  const stale = deferred<Awaited<ReturnType<FakeApiClient['teams']['channelCatalog']>>>()
  api.onTeamChannelCatalog = async () => await stale.promise
  const first = tasks.readChannelCatalog()
  tasks.handleDisconnected()
  const current = { adapters: [{ type: 'consult', version: 1 }], viewPolicies: [{ type: 'recent-window', version: 1 }] }
  api.onTeamChannelCatalog = async () => ok(current)
  tasks.handleConnected()
  await vi.waitFor(() => { expect(tasks.list.getSnapshot().channelCatalog?.value).toEqual(current) })
  stale.resolve(err({ code: 'internal', message: 'Old catalog request failed', details: {} }))
  await first
  expect(tasks.list.getSnapshot().channelCatalog?.error).toBeUndefined()
  expect(api.callsOf('team.channel.catalog')).toEqual([{}, {}])
})

it('retains a newly committed summary while a prior channel read finishes', async () => {
  const { api, tasks } = setup()
  const selected = await tasks.open('summary-owner' as never)
  const channelId = `runtime-fk-team-channel-${selected.teamId}` as ChannelId
  await tasks.readChannel(channelId)
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['channelRead']>>>()
  api.onTeamChannelRead = async () => await pending.promise
  const reading = tasks.readChannel(channelId).catch((error: unknown) => error)
  const summary: TeamChannelSummary = { type: 'channel/summary', sequence: 12, createdAt: 12,
    coveredSequenceRange: { from: 10, to: 10 }, sourceEnvelopeIds: ['source-envelope' as never], sourceFingerprint: `sha256:${'b'.repeat(64)}` as never,
    text: 'Saved source summary', policy: { type: 'summarized-window', version: 1 }, idempotencyKey: 'summary-key' as never }
  vi.spyOn(api.teams, 'channelSummarize').mockResolvedValue(ok(summary))
  const summarizing = tasks.manage(selected.teamId, { operation: 'channelSummarize', input: { channelId, expectedCursor: 11,
    coveredSequenceRange: summary.coveredSequenceRange, idempotencyKey: summary.idempotencyKey } })
  await vi.waitFor(() => { expect(tasks.list.getSnapshot().channel?.lastSummary).toEqual(summary) })
  pending.resolve(ok({ channel: { manifest: { id: channelId, teamId: selected.teamId, adapter: { type: 'direct', version: 4 },
    participants: [], limits: {} }, phase: 'closed', cursor: 12 }, records: [] }))
  await reading
  await summarizing
  expect(tasks.list.getSnapshot().channel?.lastSummary).toEqual(summary)
})

it('preserves loaded summary sources after image rejection and after successful summary admission', async () => {
  const { api, tasks } = setup()
  const selected = await tasks.open('summary-window' as never)
  const channelId = `runtime-fk-team-channel-${selected.teamId}` as ChannelId
  const senderId = tasks.list.getSnapshot().collections!.members.items[0]!.id
  const snapshot: ChannelReadPageResult['channel'] = { manifest: { id: channelId, teamId: selected.teamId,
    adapter: { type: 'direct', version: 4 }, participants: tasks.list.getSnapshot().collections!.members.items.map(member => ({ id: member.id, role: member.role })),
    viewPolicy: { type: 'summarized-window', version: 1 }, limits: {} }, phase: 'closed', cursor: 13 }
  const records: ChannelReadPageResult['records'] = [
    { type: 'channel/envelope', envelope: { id: 'image-source' as never, teamId: selected.teamId, channelId, sequence: 10,
      senderId, audience: null, kind: 'message', delivery: 'context', priority: 'normal', createdAt: 10,
      payload: { content: [{ type: 'image', attachment: { attachmentId: `sha256:${'c'.repeat(64)}`, mediaType: 'image/png', bytes: 4, width: 1, height: 1 } }] } }, deliveryIntents: [] },
    { type: 'channel/envelope', envelope: { id: 'text-source' as never, teamId: selected.teamId, channelId, sequence: 11,
      senderId, audience: null, kind: 'message', delivery: 'context', priority: 'normal', createdAt: 11,
      payload: { content: [{ type: 'text', text: 'Visible text source' }] } }, deliveryIntents: [] },
    { type: 'channel/phase', sequence: 12, phase: 'closing', createdAt: 12 },
    { type: 'channel/closed', sequence: 13, phase: 'closed', createdAt: 13 },
  ]
  api.onTeamChannelRead = async () => ok({ channel: snapshot, records })
  await tasks.readChannel(channelId, 9)
  const summary: TeamChannelSummary = { type: 'channel/summary', sequence: 15, createdAt: 15, coveredSequenceRange: { from: 11, to: 11 },
    sourceEnvelopeIds: ['text-source' as never], sourceFingerprint: `sha256:${'d'.repeat(64)}` as never,
    text: 'Saved text summary', policy: { type: 'summarized-window', version: 1 }, idempotencyKey: 'saved-summary' as never }
  const summarize = vi.spyOn(api.teams, 'channelSummarize').mockResolvedValueOnce(err({ code: 'internal',
    message: 'Extractive summaries require text-only source messages', details: {} })).mockResolvedValue(ok(summary))
  api.onTeamChannelRead = async (input) => {
    expect(input.afterCursor).toBe(13)
    return ok({ channel: { ...snapshot, cursor: 14 }, records: [{ ...summary, sequence: 14, createdAt: 14 }] })
  }
  await expect(tasks.manage(selected.teamId, { operation: 'channelSummarize', input: { channelId, expectedCursor: 13,
    coveredSequenceRange: { from: 10, to: 10 }, idempotencyKey: 'image-summary' as never } })).rejects.toThrow('text-only source messages')
  expect(tasks.list.getSnapshot().channel?.page?.records).toBe(records)
  expect(tasks.list.getSnapshot().channel?.page?.channel.cursor).toBe(14)
  api.onTeamChannelRead = async (input) => {
    expect(input.afterCursor).toBe(14)
    return ok({ channel: { ...snapshot, cursor: 15 }, records: [summary] })
  }
  await tasks.manage(selected.teamId, { operation: 'channelSummarize', input: { channelId, expectedCursor: 14,
    coveredSequenceRange: { from: 11, to: 11 }, idempotencyKey: summary.idempotencyKey } })
  expect(summarize).toHaveBeenCalledTimes(2)
  expect(tasks.list.getSnapshot().channel?.page?.records).toBe(records)
  expect(tasks.list.getSnapshot().channel?.page?.channel.cursor).toBe(15)
  expect(tasks.list.getSnapshot().channel?.lastSummary).toEqual(summary)
})
