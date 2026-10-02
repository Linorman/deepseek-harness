/** Dependency queries keep bounded pages and never share task-table selection or request generations. */
import { expect, it, vi } from 'vitest'
import type { TeamId } from '@clocky/clocky-client-connection/client'
import type { TeamTaskQueryPage, TeamTaskQueryState } from '../src/client/contract/team-tasks.ts'
import { TaskQuery } from '../src/client/teams/task-query.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

const teamId = 'query-team' as TeamId
function page(search = '', cursor = 1): TeamTaskQueryPage {
  return { teamId, kind: 'tasks', query: { search }, teamCursor: cursor, sourceTotal: 2, total: 2, scanned: 2, items: [{ id: 'query-task' as never, teamId, revision: 1, phase: 'pending', subject: { text: search, truncated: false },
    executionKind: 'participant', priority: 0, attemptCount: 0, maxAttempts: 1, dependencyCount: 0, reviewCount: 0,
    hasLease: false, cancellationRequested: false }],
  nextQueryCursor: { teamId, teamCursor: cursor, query: { search }, order: 'task-insertion-v1', afterCursor: 0 } }
}
function setup(onPublish?: (owner: TaskQuery, state: TeamTaskQueryState | undefined) => void) {
  const api = new FakeApiClient()
  let state: TeamTaskQueryState | undefined
  const owner = new TaskQuery(api, 2, (value) => { state = value; onPublish?.(owner, value) })
  const read = vi.spyOn(api.teams, 'browse').mockImplementation(async input => ok(page(input.query?.search)))
  return { owner, read, state: () => state }
}

it('retains its page after a rejected continuation and restarts the same query after a revision change', async () => {
  const h = setup()
  await h.owner.read(teamId, { search: '报告' })
  const first = h.state()?.page
  h.read.mockResolvedValueOnce(err({ code: 'team-cursor-conflict', message: 'Refresh query', details: { teamId } }))
  await h.owner.read(teamId, { search: '报告' }, 'next')
  expect(h.read.mock.calls[1]?.[0]).toMatchObject({ queryCursor: first?.nextQueryCursor })
  expect(h.state()).toMatchObject({ page: first, error: 'Refresh query', hasNewer: true, loading: false })
  await h.owner.read(teamId, { search: '报告' }, 'next')
  expect(h.read).toHaveBeenCalledTimes(2)
  h.read.mockResolvedValueOnce(ok(page('报告', 4)))
  await h.owner.read(teamId, { search: '报告' })
  expect(h.read.mock.calls[2]?.[0]).not.toHaveProperty('queryCursor')
  expect(h.state()).toMatchObject({ hasNewer: false, page: { teamCursor: 4 } })
  expect(h.state()?.error).toBeUndefined()
  h.owner.changed(teamId, 5)
  expect(h.state()?.hasNewer).toBe(true)
})

it('fences replaced queries and clears rows when the principal loses access', async () => {
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['browse']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const old = h.owner.read(teamId, { search: 'old' })
  const signal = h.read.mock.calls[0]?.[1]
  await h.owner.read(teamId, { search: 'new' })
  expect(signal?.aborted).toBe(true)
  pending.resolve(ok(page('old')))
  await old
  expect(h.state()?.query.search).toBe('new')
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Access revoked', details: { teamId } }))
  await h.owner.read(teamId, { search: 'new' })
  expect(h.state()).toMatchObject({ page: undefined, loading: false, error: 'Access revoked' })
  h.owner.close()
  expect(h.state()).toBeUndefined()
})

it('reconnects without accepting responses older than observed Team facts', async () => {
  const h = setup()
  await h.owner.read(teamId, { search: '' })
  h.owner.changed(teamId, 5)
  h.owner.disconnect()
  expect(h.state()).toMatchObject({ disconnected: true, loading: false, hasNewer: true })
  await h.owner.reconnect()
  expect(h.state()?.error).toContain('current selection')
  h.read.mockResolvedValueOnce(ok(page('', 5)))
  await h.owner.reconnect()
  expect(h.state()).toMatchObject({ disconnected: false, hasNewer: false, page: { teamCursor: 5 } })
})

it('does not revive a dismissed query after transport failure or an abort callback replacement', async () => {
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['browse']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const old = h.owner.read(teamId, { search: 'old' })
  h.read.mock.calls[0]?.[1]?.addEventListener('abort', () => { void h.owner.read(teamId, { search: 'replacement' }) })
  await h.owner.read(teamId, { search: 'superseded' })
  expect(h.state()?.query.search).toBe('replacement')
  h.owner.close()
  pending.reject(new Error('Disconnected'))
  await old
  expect(h.state()).toBeUndefined()
})


it('reports a transport failure without inventing a newer Team revision', async () => {
  const h = setup()
  await h.owner.read(teamId, { search: '' })
  const previous = h.state()?.page
  h.read.mockRejectedValueOnce(new Error('Network unavailable'))
  await h.owner.read(teamId, { search: '' })
  expect(h.state()).toMatchObject({ page: previous, loading: false, error: 'Network unavailable', hasNewer: false })
})


it('leaves unopened queries alone and tracks a change observed before the first reply', async () => {
  const h = setup()
  h.owner.changed(teamId, 10)
  h.owner.disconnect()
  await h.owner.reconnect()
  expect(h.read).not.toHaveBeenCalled()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['browse']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const reading = h.owner.read(teamId, { search: '' })
  h.owner.changed(teamId, 5)
  pending.resolve(ok(page('', 5)))
  await reading
  h.owner.changed(teamId, 5)
  expect(h.state()?.hasNewer).toBe(false)
  h.owner.close()
})

it.each(['close', 'disconnect'] as const)('does not let an older %s erase a reentrant query', async (action) => {
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['browse']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const reading = h.owner.read(teamId, { search: 'old' })
  let replacement: Promise<void> | undefined
  h.read.mock.calls[0]?.[1]?.addEventListener('abort', () => { replacement = h.owner.read(teamId, { search: 'replacement' }) })
  h.owner[action]()
  await replacement
  pending.resolve(ok(page('old')))
  await reading
  expect(h.state()?.query.search).toBe('replacement')
  h.owner.close()
})

it('honors dismissal from a loading publication and renders non-Error read failures', async () => {
  const closed = setup((owner, state) => { if (state?.loading) owner.close() })
  await closed.owner.read(teamId, { search: '' })
  expect(closed.read).not.toHaveBeenCalled()
  expect(closed.state()).toBeUndefined()
  const h = setup()
  h.read.mockRejectedValueOnce('Transport unavailable')
  await h.owner.read(teamId, { search: '' })
  expect(h.state()?.error).toBe('Transport unavailable')
  h.owner.close()
})

it('retains the page origin when a continuation succeeds and a later read is paused', async () => {
  const h = setup()
  await h.owner.read(teamId, { search: 'page' })
  const first = h.state()!.page!
  await h.owner.read(teamId, { search: 'page' }, 'next')
  expect(h.state()?.startCursor).toEqual(first.nextQueryCursor)
  const retained = h.state()?.page
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['browse']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const reading = h.owner.read(teamId, { search: 'page' }, 'next')
  h.owner.pause()
  expect(h.state()?.page).toBe(retained)
  expect(h.state()?.loading).toBe(false)
  pending.resolve(ok(page('stale')))
  await reading
  expect(h.state()?.page).toBe(retained)
  h.owner.pause()
  h.owner.close()
  h.owner.pause()
})

it('does not let an abort callback replace a new query with paused old state', async () => {
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['browse']>>>()
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { void h.owner.read(teamId, { search: 'replacement' }) }, { once: true })
    return pending.promise
  })
  const reading = h.owner.read(teamId, { search: 'old' })
  h.owner.pause()
  pending.resolve(ok(page('old')))
  await reading
  expect(h.state()?.query.search).toBe('replacement')
  h.owner.close()
})
