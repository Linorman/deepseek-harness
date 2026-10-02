import { expect, it, vi } from 'vitest'
import type { TeamId, ParticipantId } from '@clocky/clocky-client-connection/client'
import type { TeamMemberDetailState } from '../src/client/contract/team-tasks.ts'
import { MemberInspector } from '../src/client/teams/member-inspector.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

const teamId = 'team' as TeamId
const participantId = 'member' as ParticipantId
const detail: NonNullable<TeamMemberDetailState['value']> = {
  record: { teamId, id: participantId, kind: 'local-agent', phase: 'active', displayName: 'Researcher', role: 'research' },
  teamCursor: 7, startCursor: -1, total: 3, scanned: 2, items: ['first', 'second'], nextCursor: 1,
}
function setup(onPublish?: (owner: MemberInspector, state: TeamMemberDetailState | undefined) => void) {
  const api = new FakeApiClient()
  let state: TeamMemberDetailState | undefined
  const denied = vi.fn()
  const owner = new MemberInspector(api, (value) => { state = value; onPublish?.(owner, value) }, denied)
  const read = vi.spyOn(api.teams, 'memberInspect').mockResolvedValue(ok(detail))
  return { owner, read, denied, state: () => state }
}

it('pins continuation and keeps failed pages until explicit refresh', async () => {
  const h = setup()
  await h.owner.read(teamId, participantId)
  h.read.mockResolvedValueOnce(err({ code: 'internal', message: 'Team changed', details: {} }))
  await h.owner.read(teamId, participantId, 'next')
  expect(h.read).toHaveBeenLastCalledWith({ teamId, participantId, afterCursor: 1, expectedTeamCursor: 7 }, expect.any(AbortSignal))
  expect(h.state()).toMatchObject({ value: detail, error: 'Team changed', loading: false })
  await h.owner.read(teamId, participantId, 'next')
  expect(h.read).toHaveBeenCalledTimes(2)
  h.read.mockResolvedValueOnce(ok({ ...detail, teamCursor: 8 }))
  await h.owner.read(teamId, participantId, 'refresh')
  h.read.mockResolvedValueOnce(ok({ ...detail, teamCursor: 8, startCursor: 1, nextCursor: undefined, items: ['third'] }))
  await h.owner.read(teamId, participantId, 'next')
  expect(h.state()?.value?.items).toEqual(['third'])
  h.owner.disconnect()
  expect(h.state()).toMatchObject({ disconnected: true, hasNewer: true, loading: false })
  await h.owner.read(teamId, participantId)
  expect(h.read).toHaveBeenCalledTimes(4)
  h.read.mockResolvedValueOnce(ok({ ...detail, teamCursor: 9, startCursor: 1, nextCursor: undefined, items: ['third'] }))
  await h.owner.reconnect()
  expect(h.read).toHaveBeenLastCalledWith({ teamId, participantId, afterCursor: 1 }, expect.any(AbortSignal))
  expect(h.state()?.disconnected).toBe(false)
  h.owner.close()
})

it('rejects foreign, old, wrong-window and nonadvancing replies while retaining authorized content', async () => {
  const h = setup()
  await h.owner.read(teamId, participantId)
  for (const patch of [{ record: { ...detail.record, id: 'foreign' as ParticipantId } },
    { record: { ...detail.record, teamId: 'foreign' as TeamId } }, { startCursor: 3 }, { teamCursor: 6 }, { nextCursor: -1 }]) {
    h.read.mockResolvedValueOnce(ok({ ...detail, ...patch }))
    await h.owner.read(teamId, participantId, 'refresh')
    expect(h.state()?.value).toBe(detail)
    expect(h.state()?.error).toContain('identity, revision or capability page')
  }
  h.owner.close()
})

it.each(['replace', 'close', 'disconnect', 'changed'] as const)('fences pending detail after %s', async (change) => {
  const h = setup()
  await h.owner.read(teamId, participantId)
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['memberInspect']>>>()
  h.read.mockReturnValueOnce(held.promise)
  const pending = h.owner.read(teamId, participantId)
  if (change === 'replace') {
    h.read.mockResolvedValueOnce(ok({ ...detail, record: { ...detail.record, id: 'new' as ParticipantId } }))
    await h.owner.read(teamId, 'new' as ParticipantId)
  } else if (change === 'changed') h.owner.changed(teamId, 10)
  else h.owner[change]()
  held.resolve(ok({ ...detail, items: ['late'] }))
  await pending
  expect(h.state()?.value?.items ?? []).not.toContain('late')
  if (change === 'changed') {
    expect(h.state()?.hasNewer).toBe(true)
    expect(h.state()?.error).toContain('revision')
  }
  if (change === 'close') expect(h.state()).toBeUndefined()
  h.owner.close()
})

it('clears data and invalidates the current Team when access is denied', async () => {
  const h = setup()
  await h.owner.read(teamId, participantId)
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Revoked', details: {} }))
  await h.owner.read(teamId, participantId, 'refresh')
  expect(h.state()).toBeUndefined()
  expect(h.denied).toHaveBeenCalledExactlyOnceWith(teamId)
})

it('does not issue IO after a publication synchronously closes the inspector', async () => {
  const h = setup((owner, state) => { if (state?.loading) owner.close() })
  await h.owner.read(teamId, participantId)
  expect(h.read).not.toHaveBeenCalled()
  expect(h.state()).toBeUndefined()
})

it('retains an offline selection for inspection after handshake without issuing IO', async () => {
  const h = setup()
  h.owner.disconnect()
  await h.owner.read(teamId, participantId)
  expect(h.state()).toMatchObject({ teamId, participantId, disconnected: true, loading: false })
  expect(h.read).not.toHaveBeenCalled()
  await h.owner.reconnect()
  expect(h.state()?.value).toBe(detail)
  h.owner.close()
})
