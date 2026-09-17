import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelId, ChannelReadPageResult, IApiClient } from '@clocky/clocky-client-connection/client'
import type { TeamChannelInvitation } from '../src/client/contract/team-tasks.ts'
import { TeamTaskRuntime } from '../src/client/teams/service.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const channelId = 'live-channel' as ChannelId
const fingerprint = `sha256:${'a'.repeat(64)}`
function page(cursor = 0, phase: ChannelReadPageResult['channel']['phase'] = 'pending', id = channelId): ChannelReadPageResult {
  return { channel: { manifest: { id, teamId: 'live-team' as never, adapter: { type: 'direct', version: 4 },
    participants: [], limits: {} }, phase, cursor },
  records: [{ type: 'channel/phase', sequence: cursor, phase, createdAt: cursor + 1 }] }
}
function invitation(revision = 1, status: TeamChannelInvitation['invitation']['status'] = 'pending'): TeamChannelInvitation {
  return { channel: page().channel, invitation: { participantId: 'principal-human' as never, role: 'human', visibility: 'channel',
    required: true, deadline: 1000, endpoint: { kind: 'human' }, revision, manifestFingerprint: fingerprint as never, status,
    ...status === 'acknowledged' ? { acknowledgementKey: 'accepted' as never, settledAt: 2 } : {} } }
}
function setup() {
  const ctx = new Context(); contexts.push(ctx)
  const api = new FakeApiClient()
  const tasks = new TeamTaskRuntime(ctx, api)
  api.onTeamChannelRead = async () => ok(page())
  const readInvitation = vi.spyOn(api.teams, 'channelInvitation').mockImplementation(async () => ok(invitation()))
  const acknowledge = vi.spyOn(api.teams, 'channelInvitationAcknowledge').mockImplementation(async () => ok(invitation(1, 'acknowledged')))
  const watches: { signal?: AbortSignal; result: ReturnType<typeof deferred<Awaited<ReturnType<IApiClient['teams']['channelWatch']>>>> }[] = []
  vi.spyOn(api.teams, 'channelWatch').mockImplementation(async (_input, signal) => {
    const result = deferred<Awaited<ReturnType<IApiClient['teams']['channelWatch']>>>()
    watches.push({ ...signal === undefined ? {} : { signal }, result })
    signal?.addEventListener('abort', () => { result.reject(signal.reason) }, { once: true })
    return await result.promise
  })
  return { api, tasks, readInvitation, acknowledge, watches }
}

describe('runtime channel inspection', () => {
  it('does not publish an old ACK error after its refresh crosses a channel switch', async () => {
    const f = setup()
    await f.tasks.readChannel(channelId)
    const oldRefresh = deferred<Awaited<ReturnType<IApiClient['teams']['channelInvitation']>>>()
    f.readInvitation.mockImplementationOnce(async () => await oldRefresh.promise)
    f.acknowledge.mockResolvedValueOnce(err({ code: 'internal', message: 'Old channel ACK failed', details: {} }))
    const pending = f.tasks.acknowledgeChannel(channelId)
    await vi.waitFor(() => { expect(f.readInvitation).toHaveBeenCalledTimes(2) })
    const next = 'new-ack-channel' as ChannelId
    f.api.onTeamChannelRead = async () => ok(page(4, 'closed', next))
    f.readInvitation.mockImplementation(async () => ok({ ...invitation(), channel: page(4, 'closed', next).channel }))
    await f.tasks.readChannel(next)
    oldRefresh.resolve(ok(invitation()))
    await pending
    expect(f.tasks.list.getSnapshot().channel?.channelId).toBe(next)
    expect(f.tasks.list.getSnapshot().channel?.acknowledgementError).toBeUndefined()
  })

  it('retires an old-channel read begun while another Team selection is pending', async () => {
    const f = setup()
    const firstTeam = await f.tasks.open('read-team-a' as never)
    const nextTeam = 'read-team-b' as typeof firstTeam.teamId
    const nextResponse = await f.api.onTeamGet({ teamId: nextTeam })
    const selection = deferred<Awaited<ReturnType<IApiClient['teams']['get']>>>()
    f.api.onTeamGet = async () => await selection.promise
    const opening = f.tasks.open(nextTeam)
    const channelResponse = deferred<Awaited<ReturnType<IApiClient['teams']['channelRead']>>>()
    f.api.onTeamChannelRead = async () => await channelResponse.promise
    const reading = f.tasks.readChannel(`runtime-fk-team-channel-${firstTeam.teamId}` as ChannelId).catch((error: unknown) => error)
    selection.resolve(nextResponse)
    await opening
    channelResponse.resolve(ok({ ...page(), channel: { ...page().channel, manifest: { ...page().channel.manifest,
      id: `runtime-fk-team-channel-${firstTeam.teamId}` as ChannelId, teamId: firstTeam.teamId } } }))
    await reading
    expect(f.tasks.list.getSnapshot().current).toBe(nextTeam)
    expect(f.tasks.list.getSnapshot().channel).toBeUndefined()
  })

  it('keeps reconnect authority pending until both reads settle and retains prior readable facts on failure', async () => {
    const f = setup()
    await f.tasks.readChannel(channelId)
    const before = f.tasks.list.getSnapshot().channel!
    const own = deferred<Awaited<ReturnType<IApiClient['teams']['channelInvitation']>>>()
    const metadata = deferred<Awaited<ReturnType<IApiClient['teams']['channelAdmission']>>>()
    f.readInvitation.mockImplementationOnce(async () => await own.promise)
    f.api.onTeamChannelAdmission = async () => await metadata.promise
    f.tasks.handleDisconnected()
    f.tasks.handleConnected()
    expect(f.tasks.list.getSnapshot().channel?.loading).toBe(true)
    expect(f.tasks.list.getSnapshot().channel?.page).toBe(before.page)
    own.resolve(err({ code: 'internal', message: 'Invitation read unavailable', details: {} }))
    await vi.waitFor(() => { expect(f.tasks.list.getSnapshot().channel?.invitationError).toBe('Invitation read unavailable') })
    expect(f.tasks.list.getSnapshot().channel?.loading).toBe(true)
    expect(f.watches).toHaveLength(1)
    metadata.resolve(err({ code: 'internal', message: 'Metadata read unavailable', details: {} }))
    await vi.waitFor(() => { expect(f.tasks.list.getSnapshot().channel?.loading).toBe(false) })
    expect(f.tasks.list.getSnapshot().channel?.invitation).toBe(before.invitation)
    expect(f.tasks.list.getSnapshot().channel?.admission).toBe(before.admission)
    expect(f.tasks.list.getSnapshot().channel?.admissionError).toBe('Metadata read unavailable')
  })

  for (const stale of ['pending', 'failure'] as const) it(`ignores an older ${stale} invitation read after a newer acknowledged read`, async () => {
    const f = setup()
    await f.tasks.readChannel(channelId)
    const old = deferred<Awaited<ReturnType<IApiClient['teams']['channelInvitation']>>>()
    f.readInvitation.mockImplementationOnce(async () => await old.promise)
    f.api.onTeamChannelRead = async () => ok(page(1, 'active'))
    f.watches[0]!.result.resolve(ok({ kind: 'changed', cursor: 1 }))
    await vi.waitFor(() => { expect(f.readInvitation).toHaveBeenCalledTimes(2) })
    f.readInvitation.mockResolvedValue(ok({ ...invitation(1, 'acknowledged'), channel: page(1, 'active').channel }))
    f.acknowledge.mockResolvedValueOnce(err({ code: 'internal', message: 'Acknowledgement response lost', details: {} }))
    await f.tasks.acknowledgeChannel(channelId)
    expect(f.tasks.list.getSnapshot().channel?.invitation?.invitation.status).toBe('acknowledged')
    old.resolve(stale === 'pending' ? ok(invitation()) : err({ code: 'internal', message: 'Old invitation failure', details: {} }))
    await vi.waitFor(() => { expect(f.watches).toHaveLength(2) })
    expect(f.tasks.list.getSnapshot().channel?.invitation?.invitation.status).toBe('acknowledged')
    expect(f.tasks.list.getSnapshot().channel?.invitationError).toBeUndefined()
  })

  it('keeps one record window when repeatedly reading the next channel page', async () => {
    const f = setup()
    f.api.onTeamChannelRead = async input => ok(page((input.afterCursor ?? -1) + 1, 'closed'))
    for (let cursor = -1; cursor < 32; cursor++) {
      await f.tasks.readChannel(channelId, cursor)
      expect(f.tasks.list.getSnapshot().channel?.page?.records.map(record => record.type === 'channel/envelope' ? record.envelope.sequence : record.sequence)).toEqual([cursor + 1])
      expect(f.tasks.list.getSnapshot().channel?.startCursor).toBe(cursor)
    }
  })

  it('reconstructs the same consent intent after the browser runtime is recreated', async () => {
    const first = setup()
    const second = setup()
    await first.tasks.readChannel(channelId)
    await second.tasks.readChannel(channelId)
    first.acknowledge.mockResolvedValueOnce(err({ code: 'internal', message: 'response lost', details: {} }))
    await first.tasks.acknowledgeChannel(channelId)
    await second.tasks.acknowledgeChannel(channelId)
    expect(first.acknowledge.mock.calls[0]?.[0]).toEqual(second.acknowledge.mock.calls[0]?.[0])
  })

  it('reads consent without accepting it and retries ambiguous consent with the same exact manifest key', async () => {
    const f = setup()
    await f.tasks.readChannel(channelId)
    expect(f.acknowledge).not.toHaveBeenCalled()
    f.acknowledge.mockResolvedValueOnce(err({ code: 'internal', message: 'connection interrupted', details: {} }))
    await f.tasks.acknowledgeChannel(channelId)
    expect(f.tasks.list.getSnapshot().channel?.acknowledgementError).toBe('connection interrupted')
    await f.tasks.acknowledgeChannel(channelId)
    expect(f.acknowledge.mock.calls[0]?.[0]).toEqual(f.acknowledge.mock.calls[1]?.[0])
    expect(f.acknowledge.mock.calls[0]?.[0]).toMatchObject({ channelId, revision: 1, manifestFingerprint: fingerprint })
  })

  it('requires a fresh click and key after the invitation revision changes', async () => {
    const f = setup()
    await f.tasks.readChannel(channelId)
    f.readInvitation.mockResolvedValue(ok(invitation(2)))
    f.acknowledge.mockResolvedValueOnce(err({ code: 'team-channel-cursor-conflict', message: 'Invitation revision or manifest does not match', details: {} }))
    await f.tasks.acknowledgeChannel(channelId)
    expect(f.acknowledge).toHaveBeenCalledTimes(1)
    expect(f.tasks.list.getSnapshot().channel?.invitation?.invitation.revision).toBe(2)
    await f.tasks.acknowledgeChannel(channelId)
    expect(f.acknowledge.mock.calls[1]?.[0].revision).toBe(2)
    expect(f.acknowledge.mock.calls[1]?.[0].idempotencyKey).not.toBe(f.acknowledge.mock.calls[0]?.[0].idempotencyKey)
  })

  it('updates lifecycle without growing retained history and stops watching terminal channels', async () => {
    const f = setup()
    await f.tasks.readChannel(channelId)
    f.api.onTeamChannelRead = async (input) => {
      expect(input.afterCursor).toBe(0)
      return ok(page(2, 'closed'))
    }
    f.watches[0]!.result.resolve(ok({ kind: 'changed', cursor: 2 }))
    await vi.waitFor(() => { expect(f.tasks.list.getSnapshot().channel?.page?.channel.phase).toBe('closed') })
    expect(f.tasks.list.getSnapshot().channel?.page?.records.map(record => 'sequence' in record ? record.sequence : record.envelope.sequence)).toEqual([0])
    expect(f.tasks.list.getSnapshot().channel?.hasNewer).toBe(true)
    expect(f.tasks.list.getSnapshot().channel?.page?.nextCursor).toBe(0)
    expect(f.watches).toHaveLength(1)
  })

  it('preserves read history across reconnect and retires the old watch', async () => {
    const f = setup()
    await f.tasks.readChannel(channelId)
    const before = f.tasks.list.getSnapshot().channel?.page
    f.tasks.handleConnected()
    expect(f.watches[0]?.signal?.aborted).toBe(true)
    expect(f.tasks.list.getSnapshot().channel?.page).toBe(before)
    await vi.waitFor(() => { expect(f.watches).toHaveLength(2) })
    f.tasks.closeChannelView()
    expect(f.watches[1]?.signal?.aborted).toBe(true)
    expect(f.tasks.list.getSnapshot().channel).toBeUndefined()
  })

  it('ignores a replaced read even if its transport returns after abort', async () => {
    const f = setup()
    const first = deferred<Awaited<ReturnType<IApiClient['teams']['channelRead']>>>()
    f.api.onTeamChannelRead = async input => input.channelId === channelId ? await first.promise : ok(page(2, 'closed', input.channelId))
    const old = f.tasks.readChannel(channelId).catch((error: unknown) => error)
    const next = 'next-channel' as ChannelId
    await f.tasks.readChannel(next)
    first.resolve(ok(page(100)))
    await old
    expect(f.tasks.list.getSnapshot().channel?.channelId).toBe(next)
    expect(f.tasks.list.getSnapshot().channel?.page?.channel.cursor).toBe(2)
  })

  it('retains the visible prefix on pagination failure and exposes newer records without skipping the gap', async () => {
    const f = setup()
    f.api.onTeamChannelRead = async () => ok({ ...page(8), nextCursor: 2 })
    await f.tasks.readChannel(channelId)
    f.watches[0]!.result.resolve(ok({ kind: 'changed', cursor: 9 }))
    await vi.waitFor(() => { expect(f.tasks.list.getSnapshot().channel?.hasNewer).toBe(true) })
    f.api.onTeamChannelRead = async () => err({ code: 'internal', message: 'Page unavailable', details: {} })
    await expect(f.tasks.readChannel(channelId, 2)).rejects.toThrow('Page unavailable')
    expect(f.tasks.list.getSnapshot().channel?.page?.records).toHaveLength(1)
    expect(f.tasks.list.getSnapshot().channel?.page?.nextCursor).toBe(2)
  })
})
