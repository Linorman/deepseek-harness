import { Context } from '@clocky/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelId, IApiClient, TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamChannelAdmission, TeamChannelListPage } from '../src/client/contract/team-tasks.ts'
import { TeamTaskRuntime } from '../src/client/teams/service.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const teamId = 'paged-team' as TeamId
function channel(id: string): TeamChannelListPage['items'][number] {
  return { manifest: { id: id as ChannelId, teamId, adapter: { type: 'direct', version: 4 }, participants: [], limits: {} }, phase: 'closed', cursor: 0 }
}
function setup() {
  const ctx = new Context(); contexts.push(ctx)
  const api = new FakeApiClient()
  return { api, tasks: new TeamTaskRuntime(ctx, api) }
}

describe('authorized channel pages and metadata', () => {
  it('does not reopen an old Team list when its channel mutation finishes after selection changes', async () => {
    const { api, tasks } = setup()
    const oldTeam = await tasks.open(teamId)
    const closed = deferred<Awaited<ReturnType<IApiClient['teams']['channelClose']>>>()
    vi.spyOn(api.teams, 'channelClose').mockImplementation(async () => await closed.promise)
    const mutation = tasks.manage(teamId, { operation: 'channelClose', input: {
      channelId: oldTeam.state.channelIds[0]!, expectedCursor: 0 } })
    const next = 'next-selected-team' as TeamId
    await tasks.open(next)
    await tasks.readChannels(next)
    closed.resolve(ok(channel(oldTeam.state.channelIds[0]!)))
    await mutation
    expect(tasks.list.getSnapshot().channels?.teamId).toBe(next)
    expect(api.callsOf('team.channel.list')).toEqual([{ teamId: next }])
  })

  it('retains a newer-channel notice when an earlier list request finishes afterward', async () => {
    const { api, tasks } = setup()
    const listing = deferred<Awaited<ReturnType<IApiClient['teams']['channelList']>>>()
    api.onTeamChannelList = async () => await listing.promise
    const pending = tasks.readChannels(teamId)
    tasks.handleMuxEnvelope({ type: 'channel/changed', event: { channelId: 'new-channel' as ChannelId,
      record: { type: 'channel/opened', sequence: 0, createdAt: 1, manifest: channel('new-channel').manifest } } })
    const coalesced = tasks.readChannels(teamId)
    expect(coalesced).toBe(pending)
    listing.resolve(ok({ items: [channel('older')] }))
    await pending
    expect(tasks.list.getSnapshot().channels).toMatchObject({ items: [channel('older')], hasNewer: true })
    expect(api.callsOf('team.channel.list')).toHaveLength(1)
  })

  it('loads one page per explicit continuation and refreshes only the requested window', async () => {
    const { api, tasks } = setup()
    api.onTeamChannelList = async input => ok(input.afterCursor === undefined
      ? { items: [channel('a'), channel('b')], nextCursor: 1 } : { items: [channel('c')] })
    await tasks.readChannels(teamId)
    expect(tasks.list.getSnapshot().channels?.items.map(item => item.manifest.id)).toEqual(['a', 'b'])
    expect(api.callsOf('team.channel.list')).toEqual([{ teamId }])
    await tasks.readChannels(teamId, true)
    expect(tasks.list.getSnapshot().channels?.items.map(item => item.manifest.id)).toEqual(['a', 'b', 'c'])
    await tasks.readChannels(teamId)
    expect(tasks.list.getSnapshot().channels?.items.map(item => item.manifest.id)).toEqual(['a', 'b', 'c'])
    expect(api.callsOf('team.channel.list')).toEqual([{ teamId }, { teamId, afterCursor: 1 }, { teamId }, { teamId, afterCursor: 1 }])
  })

  it('preserves loaded channels and the retry cursor after a continuation failure', async () => {
    const { api, tasks } = setup()
    api.onTeamChannelList = async () => ok({ items: [channel('a')], nextCursor: 0 })
    await tasks.readChannels(teamId)
    api.onTeamChannelList = async () => err({ code: 'internal', message: 'Page interrupted', details: {} })
    await tasks.readChannels(teamId, true)
    expect(tasks.list.getSnapshot().channels).toMatchObject({ items: [channel('a')], nextCursor: 0, error: 'Page interrupted' })
    api.onTeamChannelList = async () => ok({ items: [channel('b')] })
    await tasks.readChannels(teamId, true)
    expect(tasks.list.getSnapshot().channels?.items).toEqual([channel('a'), channel('b')])
    expect(api.callsOf('team.channel.list').slice(1)).toEqual([{ teamId, afterCursor: 0 }, { teamId, afterCursor: 0 }])
  })

  it('does not replace a newly selected Team with an old list response', async () => {
    const { api, tasks } = setup()
    const old = deferred<Awaited<ReturnType<IApiClient['teams']['channelList']>>>()
    const next = 'next-team' as TeamId
    api.onTeamChannelList = async input => input.teamId === teamId ? await old.promise : ok({ items: [channel('new')] })
    const pending = tasks.readChannels(teamId)
    await tasks.readChannels(next)
    old.resolve(ok({ items: [channel('old')] }))
    await pending
    expect(tasks.list.getSnapshot().channels).toMatchObject({ teamId: next, items: [channel('new')] })
  })

  it('marks newer loaded-channel activity without growing the page window', async () => {
    const { api, tasks } = setup()
    api.onTeamChannelList = async () => ok({ items: [channel('a')], nextCursor: 0 })
    await tasks.readChannels(teamId)
    tasks.handleMuxEnvelope({ type: 'channel/changed', event: { channelId: 'a' as ChannelId,
      record: { type: 'channel/phase', sequence: 1, phase: 'closing', createdAt: 1 } } })
    expect(tasks.list.getSnapshot().channels?.hasNewer).toBe(true)
    expect(api.callsOf('team.channel.list')).toHaveLength(1)
  })

  it('discards disconnected responses and resumes the retained page window after reconnect', async () => {
    const { api, tasks } = setup()
    api.onTeamChannelList = async () => ok({ items: [channel('a')], nextCursor: 0 })
    await tasks.readChannels(teamId)
    const stale = deferred<Awaited<ReturnType<IApiClient['teams']['channelList']>>>()
    api.onTeamChannelList = async () => await stale.promise
    const pending = tasks.readChannels(teamId, true)
    tasks.handleDisconnected()
    api.onTeamChannelList = async () => ok({ items: [channel('current')], nextCursor: 0 })
    tasks.handleConnected()
    await vi.waitFor(() => { expect(tasks.list.getSnapshot().channels?.items).toEqual([channel('current')]) })
    stale.resolve(err({ code: 'internal', message: 'Old connection failed', details: {} }))
    await pending
    expect(tasks.list.getSnapshot().channels?.error).toBeUndefined()
  })

  it('shows authorized full metadata when own consent is unavailable and never borrows another endpoint invitation', async () => {
    const { api, tasks } = setup()
    const snapshot = channel('metadata')
    const admission: TeamChannelAdmission = { channel: snapshot, expectedNext: { kind: 'none' }, protocolStatus: { kind: 'other' }, invitations: [{ participantId: 'other-human' as never,
      role: 'human', visibility: 'channel', required: true, deadline: 1000, endpoint: { kind: 'human' },
      revision: 1, manifestFingerprint: `sha256:${'a'.repeat(64)}` as never, status: 'pending' }] }
    api.onTeamChannelRead = async () => ok({ channel: snapshot, records: [] })
    api.onTeamChannelAdmission = async () => ok(admission)
    const acknowledge = vi.spyOn(api.teams, 'channelInvitationAcknowledge')
    await tasks.readChannel(snapshot.manifest.id)
    expect(tasks.list.getSnapshot().channel?.admission).toEqual(admission)
    expect(tasks.list.getSnapshot().channel?.invitation).toBeUndefined()
    await tasks.acknowledgeChannel(snapshot.manifest.id)
    expect(acknowledge).not.toHaveBeenCalled()
    expect(api.callsOf('team.channel.admission')).toEqual([{ teamId, channelId: snapshot.manifest.id }])
  })
})
