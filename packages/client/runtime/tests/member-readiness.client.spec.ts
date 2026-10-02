/** A visible member set is published only after all bounded pages agree on its identities and revision. */
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamMemberReadinessInput, TeamMemberReadinessPage, TeamMemberReadinessState } from '../src/client/contract/team-tasks.ts'
import { MemberReadiness } from '../src/client/teams/member-readiness.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

const input: TeamMemberReadinessInput = { teamId: 'readiness-team' as never, participantIds: ['one', 'two'] as never }
function page(index: number): TeamMemberReadinessPage {
  return { teamId: input.teamId, teamCursor: 2, observationId: String(index).repeat(64) as never, observedAt: index,
    items: [{ participantId: input.participantIds[index]!, participation: 'active', state: 'route-unavailable', reasons: ['route-unavailable'] }],
    ...index === 0 ? { nextCursor: 1 } : {} }
}
function setup() {
  const api = new FakeApiClient()
  let state: TeamMemberReadinessState | undefined
  const values: (TeamMemberReadinessState | undefined)[] = []
  const owner = new MemberReadiness(api, (value) => { state = value; values.push(value) })
  const read = vi.spyOn(api.teams, 'memberReadiness').mockImplementation(async request => ok(page(request.afterCursor ?? 0)))
  return { owner, read, values, state: () => state }
}
afterEach(() => { vi.useRealTimers() })

it('reads only requested identities and retains the observation version for each page', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.owner.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.read.mock.calls.map(([request]) => request)).toEqual([
    { ...input, afterCursor: 0 }, { ...input, afterCursor: 1, expectedTeamCursor: 2 },
  ])
  expect(h.values.filter(value => value?.value !== undefined)).toHaveLength(1)
  expect(h.state()?.value?.items.map(item => [item.participantId, item.observationId])).toEqual([
    ['one', '0'.repeat(64)], ['two', '1'.repeat(64)],
  ])
  h.owner.close()
})

it.each([
  { ...page(0), nextCursor: 0 },
  { ...page(0), nextCursor: 2 },
  { ...page(0), nextCursor: undefined },
  { ...page(0), items: [] },
  { ...page(0), teamId: 'foreign' as never },
  { ...page(0), items: [{ ...page(0).items[0]!, participantId: 'foreign' as never }] },
])('rejects a mismatched or nonadvancing page without publishing its rows', async (invalid) => {
  vi.useFakeTimers()
  const h = setup()
  h.read.mockResolvedValueOnce(ok(invalid))
  h.owner.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.error).toContain('requested identities and revision')
  expect(h.state()?.value).toBeUndefined()
  expect(h.read).toHaveBeenCalledOnce()
  h.owner.close()
})

it('keeps the old complete observation when continuation fails and refuses a mixed revision', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.owner.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  const previous = h.state()?.value
  h.read.mockResolvedValueOnce(ok(page(0))).mockResolvedValueOnce(err({ code: 'team-cursor-conflict', message: 'Refresh members', details: {} }))
  await h.owner.refresh()
  expect(h.state()).toMatchObject({ value: previous, error: 'Refresh members' })
  h.read.mockResolvedValueOnce(ok(page(0))).mockResolvedValueOnce(ok({ ...page(1), teamCursor: 3 }))
  await h.owner.refresh()
  expect(h.state()?.error).toContain('revision')
  h.owner.close()
})

it('cancels the remaining page traversal when the selected member set is dismissed', async () => {
  vi.useFakeTimers()
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['memberReadiness']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const close = h.owner.watch(input, 500)
  close()
  pending.resolve(ok(page(0)))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.read).toHaveBeenCalledOnce()
  expect(h.state()).toBeUndefined()
})

it('accepts an empty selection without inventing unavailable members', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.read.mockResolvedValueOnce(ok({ ...page(0), items: [], nextCursor: undefined }))
  h.owner.watch({ ...input, participantIds: [] }, 500)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.value?.items).toEqual([])
  h.owner.close()
})
