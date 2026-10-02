/** Dependency facts publish atomically across pages, connection generations and reference changes. */
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamId, TeamTaskId, TeamTaskReferencesPage } from '@clocky/clocky-client-connection/client'
import { TaskReferences, type TaskReferencesState } from '../src/client/teams/task-references.ts'
import { FakeApiClient, ok, err, deferred } from './fake-api.client.ts'

const teamId = 'refs-team' as TeamId
const ids = ['first', 'second', 'third'].map(id => id as TeamTaskId)
const options = { capacity: 8, batchSize: 2, refreshMs: 1_000_000 }
const owners: TaskReferences[] = []
afterEach(() => { owners.splice(0).forEach(owner => owner.close()); vi.useRealTimers() })
const page = (taskIds: readonly TeamTaskId[] = ids, cursor = 1): TeamTaskReferencesPage => ({ teamId, teamCursor: cursor,
  items: taskIds.map(taskId => ({ taskId, state: 'unavailable' })) })
async function settled(state: () => TaskReferencesState | undefined) { await vi.waitFor(() => { expect(state()?.loading).toBe(false) }) }
function setup(publish?: (owner: TaskReferences, value: TaskReferencesState | undefined) => void) {
  const api = new FakeApiClient()
  let state: TaskReferencesState | undefined
  const denied = vi.fn()
  const owner = new TaskReferences(api, (value) => { state = value; publish?.(owner, value) }, denied)
  owners.push(owner)
  const read = vi.spyOn(api.teams, 'taskReferences').mockImplementation(async input => ok(page(input.taskIds.slice(input.afterCursor ?? 0))))
  return { owner, read, denied, state: () => state }
}

it('pins all bounded batches to one revision and replaces only the requested reference set', async () => {
  const h = setup()
  h.read.mockResolvedValueOnce(ok({ ...page([ids[0]!]), nextCursor: 1 }))
  const closeOld = h.owner.watch(teamId, [...ids, ids[0]!], options)
  await settled(h.state)
  expect(h.state()?.items.map(row => row.taskId)).toEqual(ids)
  expect(h.read.mock.calls.map(([input]) => [input.taskIds, input.afterCursor, input.expectedTeamCursor]))
    .toEqual([[ids.slice(0, 2), 0, undefined], [ids.slice(0, 2), 1, 1], [[ids[2]], 0, 1]])
  h.owner.changed(teamId, 1)
  h.owner.changed('foreign' as TeamId, 5)
  h.owner.changed(teamId, 2)
  expect(h.state()?.hasNewer).toBe(true)
  h.read.mockImplementation(async input => ok(page(input.taskIds.slice(input.afterCursor ?? 0), 2)))
  h.owner.watch(teamId, [ids[2]!], options)
  closeOld()
  await settled(h.state)
  expect(h.state()?.items.map(row => row.taskId)).toEqual([ids[2]])
  h.owner.watch('other' as TeamId, [], options)
  await settled(h.state)
  expect(h.state()?.error).toContain('identity set or revision')
})

it('preserves authorized facts after ordinary and partial-batch failure and clears denied facts', async () => {
  const h = setup()
  h.owner.watch(teamId, ids, options)
  await settled(h.state)
  const first = h.state()?.items
  h.read.mockResolvedValueOnce(ok(page(ids.slice(0, 2)))).mockRejectedValueOnce(new Error('Partial IO failed'))
  await h.owner.refresh()
  expect(h.state()).toMatchObject({ items: first, error: 'Partial IO failed' })
  h.read.mockRejectedValueOnce('Unknown IO')
  await h.owner.refresh()
  expect(h.state()?.error).toBe('Unknown IO')
  h.read.mockResolvedValueOnce(err({ code: 'internal', message: 'Provider unavailable', details: {} }))
  await h.owner.refresh()
  expect(h.state()?.error).toBe('Provider unavailable')
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Revoked', details: {} }))
  await h.owner.refresh()
  expect(h.state()).toBeUndefined()
  expect(h.denied).toHaveBeenCalledExactlyOnceWith(teamId)
  await h.owner.refresh()
})

it('rejects mismatched, incomplete, repeated and older pages without publishing their rows', async () => {
  const h = setup()
  h.owner.watch(teamId, ids.slice(0, 2), options)
  await settled(h.state)
  const first = h.state()?.items
  for (const bad of [{ ...page(ids.slice(0, 2)), teamId: 'foreign' as TeamId }, page(ids.slice(0, 2), 0),
    { ...page(ids.slice(0, 2)), nextCursor: 0 }, { ...page(ids.slice(0, 2)), nextCursor: 3 }, page([ids[0]!]), page([ids[1]!, ids[0]!])]) {
    h.read.mockResolvedValueOnce(ok(bad))
    h.owner.changed(teamId, 1)
    await h.owner.refresh()
    expect(h.state()?.items).toBe(first)
    expect(h.state()?.error).toContain('identity set or revision')
  }
  h.owner.watch(teamId, ids, options)
  await settled(h.state)
  h.read.mockResolvedValueOnce(ok(page(ids.slice(0, 2), 2))).mockResolvedValueOnce(ok(page([ids[2]!], 3)))
  await h.owner.refresh()
  expect(h.state()?.error).toContain('identity set or revision')
})

it('keeps disconnected facts, rechecks after handshake and never reads an oversized reference set', async () => {
  const h = setup()
  h.owner.reconnect()
  h.owner.disconnect()
  h.owner.watch(teamId, ids, options)
  expect(h.read).not.toHaveBeenCalled()
  h.owner.reconnect()
  await settled(h.state)
  h.owner.disconnect()
  await h.owner.refresh()
  expect(h.state()).toMatchObject({ disconnected: true, hasNewer: true })
  h.owner.reconnect()
  await settled(h.state)
  const calls = h.read.mock.calls.length
  h.owner.watch(teamId, ids, { ...options, capacity: 1 })
  await settled(h.state)
  expect(h.state()?.error).toContain('capacity')
  expect(h.read).toHaveBeenCalledTimes(calls)
})

it('withholds old IO and publication canceled by its runtime consumer', async () => {
  const h = setup()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['taskReferences']>>>()
  h.read.mockReturnValueOnce(held.promise)
  h.owner.watch(teamId, ids, options)
  h.owner.changed(teamId, 3)
  await h.owner.refresh()
  h.owner.watch(teamId, [], options)
  held.resolve(ok(page()))
  await settled(h.state)
  expect(h.state()?.items).toEqual([])
  h.owner.close()
  const stopped = setup((owner, value) => { if (value?.loading) owner.close() })
  stopped.owner.watch(teamId, ids, options)
  expect(stopped.read).not.toHaveBeenCalled()
})

it.each(['watch', 'close', 'disconnect'] as const)('preserves replacement ownership during %s abort callbacks', async (operation) => {
  const h = setup()
  const held = deferred<Awaited<ReturnType<FakeApiClient['teams']['taskReferences']>>>()
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { h.owner.watch(teamId, [], options) }, { once: true })
    return held.promise
  })
  h.owner.watch(teamId, ids, options)
  if (operation === 'watch') h.owner.watch(teamId, ids, options)()
  else h.owner[operation]()
  held.reject(new Error('Old failure'))
  await settled(h.state)
  expect(h.state()?.taskIds).toEqual([])
})

it('polls the exact reference set and releases its current disposer', async () => {
  vi.useFakeTimers()
  const h = setup()
  const dispose = h.owner.watch(teamId, [], { ...options, refreshMs: 10 })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.read).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(10)
  expect(h.read).toHaveBeenCalledTimes(2)
  dispose()
  expect(h.state()).toBeUndefined()
  await vi.advanceTimersByTimeAsync(20)
  expect(h.read).toHaveBeenCalledTimes(2)
})
