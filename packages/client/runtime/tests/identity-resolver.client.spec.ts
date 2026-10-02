/** Names are retained only within a pinned authenticated scope and finite cache budget. */
import { afterEach, expect, it, vi } from 'vitest'
import { IdentityResolver, type TeamIdentityState } from '../src/client/teams/identity-resolver.ts'
import { FakeApiClient, deferred, err, ok } from './fake-api.client.ts'

const teamId = 'identity-team' as never
const scope = 'a'.repeat(64) as never
const options = { refreshMs: 500, capacity: 3, batchSize: 2 }
function setup() {
  const api = new FakeApiClient()
  const read = vi.spyOn(api.teams, 'identityResolve').mockImplementation(async input => ok({ teamId: input.teamId,
    teamCursor: 1, authorizationScope: scope, items: input.participantIds.slice(input.afterCursor ?? 0).map(participantId => ({
      participantId, state: 'resolved' as const, displayName: { text: String(participantId), truncated: false }, phase: 'active' as const,
    })) }))
  let state: TeamIdentityState | undefined
  const denied = vi.fn()
  const resolver = new IdentityResolver(api, (next) => { state = next }, denied)
  resolver.authorize(scope)
  return { resolver, read, denied, state: () => state }
}
afterEach(() => { vi.useRealTimers() })

it('reads deduplicated finite batches and retains off-page names within a bounded cache', async () => {
  vi.useFakeTimers()
  const h = setup()
  const old = h.resolver.watch(teamId, ['a', 'b', 'a', 'c'] as never[], options)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.read.mock.calls.map(call => call[0].participantIds)).toEqual([['a', 'b'], ['c']])
  expect(h.read.mock.calls[1]?.[0].expectedTeamCursor).toBe(1)
  h.resolver.watch(teamId, ['d'] as never[], options)
  old()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.items.map(item => item.participantId)).toEqual(['b', 'c', 'd'])
  h.resolver.close()
  h.resolver.watch(teamId, ['b'] as never[], options)
  expect(h.state()?.items.map(item => item.participantId)).toEqual(['b', 'c', 'd'])
  h.resolver.dispose()
})

it('retains names on network failure but removes them on revoked Team membership', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.resolver.watch(teamId, ['a'] as never[], options)
  await vi.advanceTimersByTimeAsync(0)
  h.read.mockRejectedValueOnce(new Error('offline'))
  await h.resolver.refresh()
  expect(h.state()).toMatchObject({ items: [{ participantId: 'a' }], error: 'offline', forbidden: false })
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_NOT_FOUND', message: 'access revoked', details: {} }))
  await h.resolver.refresh()
  expect(h.state()).toMatchObject({ items: [], forbidden: true, error: 'access revoked' })
  expect(h.denied).toHaveBeenCalledOnce()
  h.resolver.dispose()
})

it('pins the handshake scope and ignores old responses after a principal change', async () => {
  vi.useFakeTimers()
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['identityResolve']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  h.resolver.watch(teamId, ['a'] as never[], options)
  expect(h.resolver.authorize('b'.repeat(64) as never)).toBe(true)
  pending.resolve(ok({ teamId, teamCursor: 1, authorizationScope: scope,
    items: [{ participantId: 'a' as never, state: 'resolved', displayName: { text: 'Old secret', truncated: false }, phase: 'active' }] }))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.items).toEqual([])
  await h.resolver.refresh()
  expect(h.denied).toHaveBeenCalledOnce()
  expect(h.state()?.forbidden).toBe(true)
  expect(h.resolver.authorize('b'.repeat(64) as never)).toBe(false)
  h.resolver.dispose()
})

it('follows a bounded continuation and rejects mixed revisions without partial publication', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.read.mockResolvedValueOnce(ok({ teamId, teamCursor: 1, authorizationScope: scope,
    items: [{ participantId: 'a' as never, state: 'unavailable' }], nextCursor: 1 }))
  h.read.mockResolvedValueOnce(ok({ teamId, teamCursor: 2, authorizationScope: scope,
    items: [{ participantId: 'b' as never, state: 'unavailable' }] }))
  h.resolver.watch(teamId, ['a', 'b'] as never[], options)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.read.mock.calls[1]?.[0]).toMatchObject({ afterCursor: 1, expectedTeamCursor: 1 })
  expect(h.state()?.items).toEqual([])
  expect(h.state()?.error).toContain('revision')
  h.resolver.dispose()
})

it('keeps cache partitions separate and releases the watcher after a disconnect and reconnect', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.resolver.watch(teamId, ['a'] as never[], options)
  await vi.advanceTimersByTimeAsync(0)
  const stop = h.resolver.watch('other' as never, ['a'] as never[], options)
  expect(h.state()?.items).toEqual([])
  await vi.advanceTimersByTimeAsync(0)
  h.resolver.disconnect()
  expect(h.state()?.disconnected).toBe(true)
  h.resolver.reconnect()
  await vi.advanceTimersByTimeAsync(0)
  stop()
  const calls = h.read.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.read).toHaveBeenCalledTimes(calls)
  expect(h.state()).toBeUndefined()
  h.resolver.dispose()
})

it('waits for authentication, polls current names and does not overlap reads', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.resolver.authorize(undefined)
  h.resolver.disconnect()
  await h.resolver.refresh()
  h.resolver.watch(teamId, [], options)
  h.resolver.reconnect()
  expect(h.read).not.toHaveBeenCalled()
  h.resolver.authorize(scope)
  await h.resolver.refresh()
  expect(h.read).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(500)
  expect(h.read).toHaveBeenCalledTimes(2)
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['identityResolve']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const reading = h.resolver.refresh()
  await h.resolver.refresh()
  expect(h.read).toHaveBeenCalledTimes(3)
  h.resolver.close()
  pending.reject('Request ended after unmount')
  await reading
  expect(h.state()).toBeUndefined()
  h.resolver.dispose()
})

it.each(['PRODUCT_AUTH_REQUIRED', 'PRODUCT_AUTH_INVALID', 'TEAM_HUMAN_ACTOR_FORBIDDEN', 'TEAM_HUMAN_ACTOR_AMBIGUOUS', 'TEAM_ACTOR_PROOF_INVALID', 'TEAM_GRANT_DENIED'] as const)(
  'invalidates known names after %s', async (code) => {
    vi.useFakeTimers()
    const h = setup()
    h.read.mockResolvedValueOnce(err({ code, message: 'No current identity access', details: {} }))
    h.resolver.watch(teamId, ['a'] as never[], options)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()?.forbidden).toBe(true)
    expect(h.denied).toHaveBeenCalledOnce()
    h.resolver.dispose()
  },
)

it('retains authorized names after ordinary Host failures and handles an empty continuation', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.resolver.watch(teamId, ['a'] as never[], options)
  await vi.advanceTimersByTimeAsync(0)
  h.read.mockResolvedValueOnce(err({ code: 'team-cursor-conflict', message: 'Refresh names', details: {} }))
  await h.resolver.refresh()
  expect(h.state()?.items).toHaveLength(1)
  expect(h.denied).not.toHaveBeenCalled()
  h.read.mockRejectedValueOnce('Transport unavailable')
  await h.resolver.refresh()
  expect(h.state()?.error).toBe('Transport unavailable')
  h.read.mockResolvedValueOnce(ok({ teamId, teamCursor: 1, authorizationScope: scope, items: [], nextCursor: 1 }))
  await h.resolver.refresh()
  expect(h.state()?.error).toContain('Identity page')
  expect(h.state()?.items).toHaveLength(1)
  h.resolver.dispose()
})

it.each(['watch', 'close', 'authorize', 'disconnect', 'refuse'] as const)('does not overwrite a view established by an abort callback during %s', async (action) => {
  vi.useFakeTimers()
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['identityResolve']>>>()
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { h.resolver.watch('replacement' as never, [], options) }, { once: true })
    return pending.promise
  })
  h.resolver.watch(teamId, ['a'] as never[], options)
  if (action === 'watch') h.resolver.watch('superseded' as never, [], options)()
  else if (action === 'close') h.resolver.close()
  else if (action === 'authorize') h.resolver.authorize('b'.repeat(64) as never)
  else if (action === 'disconnect') h.resolver.disconnect()
  else pending.resolve(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Revoked old Team', details: {} }))
  if (action !== 'refuse') pending.resolve(ok({ teamId, teamCursor: 1, authorizationScope: scope, items: [] }))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.teamId).toBe('replacement')
  h.resolver.dispose()
})
