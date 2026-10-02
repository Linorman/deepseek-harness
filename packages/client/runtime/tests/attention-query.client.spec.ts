/** Preview and full-list windows preserve authorized content, cancellation and exact continuations. */
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamAttentionPage, TeamAttentionState } from '../src/client/contract/team-tasks.ts'
import { AttentionQuery } from '../src/client/teams/attention-query.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

afterEach(() => { vi.useRealTimers() })
const teamId = 'attention-team' as TeamId
const spec = { teamId, limit: 2, minimumCursor: 1 }
function page(cursor = 1, next = true): TeamAttentionPage {
  const position = { kind: 'human-action' as const, id: `action-${cursor}` as never, createdAt: cursor }
  return { teamId, teamCursor: cursor, counts: { recovery: 0, humanActions: 2, reviews: 0, total: 2 },
    items: [{ ...position, actionKind: 'question', updatedAt: cursor, handling: { kind: 'actionable' } }],
    ...next ? { nextCursor: { teamId, teamCursor: cursor, order: 'attention-priority-time-id-v1' as const, position } } : {} }
}
function setup(onPublish?: (owner: AttentionQuery, state: TeamAttentionState | undefined) => void) {
  const api = new FakeApiClient()
  let state: TeamAttentionState | undefined
  const denied = vi.fn()
  const owner = new AttentionQuery(api, (value) => { state = value; onPublish?.(owner, value) }, denied)
  const read = vi.spyOn(api.teams, 'attentionRead').mockImplementation(async () => ok(page()))
  return { owner, read, denied, state: () => state }
}

it('retains a failed continuation, marks moved revisions and refreshes explicitly', async () => {
  const h = setup()
  await h.owner.read(spec)
  const first = h.state()?.page
  h.read.mockResolvedValueOnce(err({ code: 'team-cursor-conflict', message: 'Refresh pending', details: { teamId } }))
  await h.owner.read(spec, 'next')
  expect(h.read.mock.calls[1]?.[0]).toMatchObject({ cursor: first?.nextCursor })
  expect(h.state()).toMatchObject({ page: first, error: 'Refresh pending', hasNewer: true, loading: false })
  await h.owner.read(spec, 'next')
  expect(h.read).toHaveBeenCalledTimes(2)
  h.read.mockResolvedValueOnce(ok(page(3, false)))
  await h.owner.read(spec)
  expect(h.state()).toMatchObject({ page: { teamCursor: 3 }, hasNewer: false })
  expect(h.state()?.error).toBeUndefined()
  await h.owner.read(spec, 'next')
  expect(h.read).toHaveBeenCalledTimes(3)
  h.owner.changed('other' as TeamId, 10)
  h.owner.changed(teamId, 4)
  expect(h.state()?.hasNewer).toBe(true)
  h.owner.close()
})

it('withholds superseded responses and clears only a current denied Team', async () => {
  const h = setup()
  const old = deferred<Awaited<ReturnType<FakeApiClient['teams']['attentionRead']>>>()
  h.read.mockReturnValueOnce(old.promise)
  const first = h.owner.read(spec)
  await h.owner.read({ ...spec, teamId: 'new-team' as TeamId })
  old.resolve(ok(page()))
  await first
  expect(h.state()?.teamId).toBe('new-team')
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Access retired', details: {} }))
  await h.owner.read(spec)
  expect(h.state()).toBeUndefined()
  expect(h.denied).toHaveBeenCalledExactlyOnceWith(teamId)
})

it('retains an IO failure while discarding response-scope errors and stale revisions', async () => {
  const h = setup()
  await h.owner.read(spec)
  const first = h.state()?.page
  h.read.mockRejectedValueOnce(new Error('Offline IO'))
  await h.owner.read(spec)
  expect(h.state()).toMatchObject({ page: first, error: 'Offline IO' })
  h.read.mockRejectedValueOnce('Unknown IO')
  await h.owner.read(spec)
  expect(h.state()?.error).toBe('Unknown IO')
  for (const result of [{ ...page(), teamId: 'other' as TeamId }, page(0), { ...page(), items: [...page().items, ...page().items, ...page().items] }]) {
    h.read.mockResolvedValueOnce(ok(result))
    await h.owner.read(spec)
    expect(h.state()?.page).toBe(first)
    expect(h.state()?.error).toContain('current Team revision')
  }
  h.owner.close()
})

it('preserves a disconnected page and revalidates the first page after a fresh handshake', async () => {
  const h = setup()
  await h.owner.reconnect()
  await h.owner.read(spec)
  h.owner.disconnect()
  expect(h.state()).toMatchObject({ disconnected: true, hasNewer: true })
  await h.owner.read(spec, 'next')
  expect(h.read).toHaveBeenCalledOnce()
  h.read.mockResolvedValueOnce(ok(page(2)))
  await h.owner.reconnect()
  expect(h.read.mock.calls[1]?.[0]).not.toHaveProperty('cursor')
  expect(h.state()).toMatchObject({ disconnected: false, page: { teamCursor: 2 } })
  h.owner.close()
})

it('polls only the preview first page and keeps replaced watcher disposers independent', async () => {
  vi.useFakeTimers()
  const h = setup()
  const first = h.owner.watch(spec, 100)
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(100)
  expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.read.mock.calls.every(call => call[0].cursor === undefined)).toBe(true)
  const second = h.owner.watch(spec, 100)
  first()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.read).toHaveBeenCalledTimes(4)
  second()
  await vi.advanceTimersByTimeAsync(100)
  expect(h.read).toHaveBeenCalledTimes(4)
  h.owner.close()
})

it('starts a watcher created offline only after reconnect and rejects old pending reads after closure', async () => {
  const h = setup()
  h.owner.disconnect()
  const stop = h.owner.watch(spec, 100)
  expect(h.read).not.toHaveBeenCalled()
  await h.owner.reconnect()
  expect(h.read).toHaveBeenCalledOnce()
  stop()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['attentionRead']>>>()
  h.read.mockReturnValueOnce(held.promise)
  const pending = h.owner.read(spec)
  h.owner.close()
  held.resolve(ok(page()))
  await pending
  expect(h.state()).toBeUndefined()
})

it('does not advance a pending page while reading or after its owner marks a new revision', async () => {
  const h = setup()
  await h.owner.read(spec, 'next')
  expect(h.read).not.toHaveBeenCalled()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['attentionRead']>>>()
  h.read.mockReturnValueOnce(held.promise)
  const pending = h.owner.read(spec)
  await h.owner.read(spec, 'next')
  h.owner.changed(teamId, 2)
  held.resolve(ok(page()))
  await pending
  expect(h.state()?.page).toBeUndefined()
  expect(h.state()?.error).toContain('current Team revision')
  h.owner.pause()
  h.owner.close()
})

it.each(['read', 'watch', 'pause', 'close'] as const)('keeps a replacement selected during %s cancellation callbacks', async (operation) => {
  const h = setup()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['attentionRead']>>>()
  const replacement = { ...spec, teamId: 'replacement' as TeamId }
  h.read.mockImplementation(async input => ok({ ...page(1, false), teamId: input.teamId }))
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { void h.owner.read(replacement) }, { once: true })
    return held.promise
  })
  const old = h.owner.read(spec)
  if (operation === 'read') await h.owner.read(spec)
  else if (operation === 'watch') { const stop = h.owner.watch(spec, 100); stop() }
  else h.owner[operation]()
  held.reject(new Error('Old response failed'))
  await old
  expect(h.state()?.teamId).toBe(replacement.teamId)
  h.owner.close()
})

it('cancels a published loading state before IO when its view closes synchronously', async () => {
  const h = setup((owner, state) => { if (state?.loading) owner.pause() })
  await h.owner.read(spec)
  expect(h.read).not.toHaveBeenCalled()
  expect(h.state()?.loading).toBe(false)
  h.owner.close()
})

it('refreshes only an initialized pending scope', async () => {
  const h = setup()
  await h.owner.refresh()
  expect(h.read).not.toHaveBeenCalled()
  await h.owner.read(spec)
  await h.owner.refresh()
  expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.read.mock.calls[1]?.[0]).not.toHaveProperty('cursor')
  h.owner.close()
})
