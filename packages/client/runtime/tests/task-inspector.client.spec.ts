/** Task detail reads retain bounded windows, exact latest results, and selection generations. */
import { expect, it, vi } from 'vitest'
import type { TeamTaskSnapshot, TeamId, TeamTaskId } from '@clocky/clocky-client-connection/client'
import type { TeamTaskDetailState } from '../src/client/contract/team-tasks.ts'
import { projectTaskInspection } from '@clocky/clocky-team/selection'
import { TaskInspector } from '../src/client/teams/task-inspector.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

const teamId = 'inspector-team' as TeamId

function task(id: string, count = 100): TeamTaskSnapshot {
  const taskId = id as TeamTaskId
  return { id: taskId, teamId, revision: 1, subject: id, description: `Instructions ${id}`, execution: { kind: 'participant' },
    createCommand: { creator: { teamId, participantId: 'human' as never }, idempotencyKey: id as never },
    phase: count === 0 ? 'pending' : 'completed', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, reviewHistory: [],
    maxAttempts: count + 1, attemptCount: count,
    attemptHistory: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}` as never, teamId, taskId,
      ordinal: index + 1, participantId: 'worker' as never, assignedAt: index * 10, leaseExpiresAt: index * 10 + 9,
      settledAt: index * 10 + 5, outcome: index === count - 1 ? { kind: 'completed', result: { summary: `Latest ${id}` } } : { kind: 'released' } })),
  }
}

function setup(onPublish?: (owner: TaskInspector, state: TeamTaskDetailState | undefined) => void) {
  const api = new FakeApiClient()
  const rows = new Map([['a', task('a', 1000)], ['b', task('b', 0)]])
  let state: TeamTaskDetailState | undefined
  const owner = new TaskInspector(api, (value) => { state = value; onPublish?.(owner, value) })
  const response = (input: Parameters<typeof api.teams.taskInspect>[0]) => {
    const row = rows.get(input.taskId)
    if (row === undefined) throw new Error('Unknown task')
    const spec = input.section === 'record' ? input : { ...input, afterCursor: input.afterCursor ?? -1, limit: input.limit ?? 32 }
    const projected = projectTaskInspection(row, 100, spec, 16384)
    if (!projected.ok) throw new Error(projected.reason)
    return ok(projected.value)
  }
  const read = vi.spyOn(api.teams, 'taskInspect').mockImplementation(async input => response(input))
  return { api, rows, owner, read, response, state: () => state }
}

it('keeps one history window and the actual latest attempt independently across a long history', async () => {
  const h = setup()
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.read.mock.calls.map(([input]) => input)).toEqual([
    { teamId, taskId: 'a', section: 'record' },
    { teamId, taskId: 'a', section: 'attempts', expectedRevision: 1, afterCursor: 998, limit: 1 },
  ])
  expect(h.state()?.latest.value?.id).toBe('a-999')
  expect(h.state()?.attempts.value).toBeUndefined()
  await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'first')
  for (let index = 0; index < 20; index++) {
    expect(h.state()?.attempts.value?.items).toHaveLength(32)
    expect(h.state()?.latest.value?.id).toBe('a-999')
    await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'next')
  }
  expect(h.state()?.attempts.value?.items[0]?.id).toBe('a-640')
  expect(h.api.callsOf('team.get')).toEqual([])
  h.owner.close()
  expect(h.state()).toBeUndefined()
})

it('aborts replaced reads and ignores both late responses and old history commands after dismissal', async () => {
  const h = setup()
  await h.owner.read(teamId, 'a' as TeamTaskId)
  const pending = deferred<Awaited<ReturnType<typeof h.api.teams.taskInspect>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const old = h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'first')
  const signal = h.read.mock.calls.at(-1)?.[1]
  await h.owner.read(teamId, 'b' as TeamTaskId)
  expect(signal?.aborted).toBe(true)
  pending.resolve(h.response({ teamId, taskId: 'a' as TeamTaskId, section: 'attempts', afterCursor: -1, limit: 32 }))
  await old
  expect(h.state()?.taskId).toBe('b')
  expect(h.state()?.latest.value).toBeUndefined()
  h.owner.close()
  await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts')
  expect(h.state()).toBeUndefined()
})

it('preserves a failed history window, requires fresh revisions, and does not leave cancelled spinners running', async () => {
  const h = setup()
  await h.owner.read(teamId, 'a' as TeamTaskId)
  await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'first')
  const previous = h.state()?.attempts.value
  h.read.mockRejectedValueOnce(new Error('Temporary history failure'))
  await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'next')
  expect(h.state()?.attempts).toMatchObject({ value: previous, loading: false, error: 'Temporary history failure' })
  h.owner.changed(teamId, 'a' as TeamTaskId, 2)
  const reads = h.read.mock.calls.length
  await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'next')
  expect(h.read).toHaveBeenCalledTimes(reads)
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.record.error).toContain('older than')
  expect(h.state()?.hasNewer).toBe(true)
  h.rows.set('a', { ...h.rows.get('a')!, revision: 2 })
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.record.value?.revision).toBe(2)
  expect(h.state()?.attempts.value).toBeUndefined()
  expect(h.state()?.hasNewer).toBe(false)
  h.owner.disconnect()
  expect(h.state()).toMatchObject({ disconnected: true, hasNewer: true, record: { loading: false }, latest: { loading: false } })
  await h.owner.reconnect()
  expect(h.state()).toMatchObject({ disconnected: false, hasNewer: false, record: { value: { revision: 2 } } })
})

it('publishes an error for a mismatched response without replacing the retained record', async () => {
  const h = setup()
  await h.owner.read(teamId, 'b' as TeamTaskId)
  const previous = h.state()?.record.value
  h.read.mockResolvedValueOnce(h.response({ teamId, taskId: 'a' as TeamTaskId, section: 'record' }))
  await h.owner.read(teamId, 'b' as TeamTaskId)
  expect(h.state()?.record).toMatchObject({ value: previous, loading: false, error: 'Task inspection selection changed' })
})

it('opens a cached inspector without losing its history window and does not advance past its last page', async () => {
  const h = setup()
  await h.owner.reconnect()
  h.owner.disconnect()
  await h.owner.read(teamId, 'b' as TeamTaskId)
  await h.owner.read(teamId, 'b' as TeamTaskId, 'reviews', 'first')
  const reads = h.read.mock.calls.length
  await h.owner.read(teamId, 'b' as TeamTaskId, 'reviews', 'next')
  await h.owner.read(teamId, 'b' as TeamTaskId, 'record', 'first')
  expect(h.read).toHaveBeenCalledTimes(reads)
  expect(h.state()?.reviews.value).toMatchObject({ items: [], total: 0 })
  h.owner.changed('another-team' as TeamId, 'b' as TeamTaskId, 99)
  expect(h.state()?.hasNewer).toBe(false)
})

it('reports latest-result failures separately and revalidates them without clearing the task record', async () => {
  const h = setup()
  h.read.mockImplementationOnce(async input => h.response(input)).mockResolvedValueOnce(err({
    code: 'team-task-stale-revision', message: 'Task changed', details: { teamId, taskId: 'a' as TeamTaskId },
  }))
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()).toMatchObject({ record: { value: { taskId: 'a' }, loading: false },
    latest: { loading: false, error: 'Task changed' }, hasNewer: true })
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.latest.value?.id).toBe('a-999')
  h.read.mockImplementationOnce(async input => h.response(input)).mockResolvedValueOnce(h.response({
    teamId, taskId: 'a' as TeamTaskId, section: 'attempts', afterCursor: -1, limit: 1,
  }))
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.latest.error).toContain('does not match')
  expect(h.state()?.record.value?.taskId).toBe('a')
})

it('retains the prior record when the Host refuses a read and rejects contradictory history windows', async () => {
  const h = setup()
  await h.owner.read(teamId, 'a' as TeamTaskId)
  h.read.mockResolvedValueOnce(err({ code: 'team-task-stale-revision', message: 'Revision changed', details: { teamId } }))
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.record.error).toBe('Revision changed')
  expect(h.state()?.hasNewer).toBe(true)
  await h.owner.read(teamId, 'a' as TeamTaskId)
  const wrong = h.response({ teamId, taskId: 'a' as TeamTaskId, section: 'attempts', afterCursor: 5, limit: 1 })
  h.read.mockResolvedValueOnce(wrong)
  await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'first')
  expect(h.state()?.attempts.error).toContain('selected window')
  h.read.mockRejectedValueOnce('read failed')
  await h.owner.read(teamId, 'a' as TeamTaskId, 'reviews')
  expect(h.state()?.reviews.error).toBe('read failed')
})

it('keeps a reentrant newer selection when an aborted transport synchronously starts another read', async () => {
  const h = setup()
  const pending = deferred<Awaited<ReturnType<typeof h.api.teams.taskInspect>>>()
  let replacement: Promise<void> | undefined
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { replacement = h.owner.read(teamId, 'b' as TeamTaskId) }, { once: true })
    return pending.promise
  })
  const original = h.owner.read(teamId, 'a' as TeamTaskId)
  h.owner.close()
  await replacement
  expect(h.state()?.taskId).toBe('b')
  pending.resolve(h.response({ teamId, taskId: 'a' as TeamTaskId, section: 'record' }))
  await original
  expect(h.state()?.record.value?.taskId).toBe('b')
})

it.each(['selection', 'loading', 'record', 'latest'] as const)('respects dismissal from the %s publication callback', async (stage) => {
  let dismissed = false
  const h = setup((owner, state) => {
    if (dismissed || state === undefined) return
    const reached = stage === 'selection' ? !state.record.loading && state.record.value === undefined
      : stage === 'loading' ? state.record.loading : stage === 'record' ? state.record.value !== undefined : state.latest.loading
    if (reached) { dismissed = true; owner.close() }
  })
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(dismissed).toBe(true)
  expect(h.state()).toBeUndefined()
  expect(h.read.mock.calls.length).toBeLessThanOrEqual(1)
})

it.each(['disconnect', 'replace', 'refresh'] as const)('does not let an older %s overwrite a reentrant selection', async (operation) => {
  const h = setup()
  await h.owner.read(teamId, 'a' as TeamTaskId)
  const pending = deferred<Awaited<ReturnType<typeof h.api.teams.taskInspect>>>()
  let newer: Promise<void> | undefined
  h.read.mockImplementationOnce((_input, signal) => {
    signal?.addEventListener('abort', () => { newer = h.owner.read(teamId, 'b' as TeamTaskId) }, { once: true })
    return pending.promise
  })
  const older = h.owner.read(teamId, 'a' as TeamTaskId, 'attempts', 'first')
  if (operation === 'disconnect') h.owner.disconnect()
  else await h.owner.read(teamId, (operation === 'refresh' ? 'a' : 'absent') as TeamTaskId)
  await newer
  pending.reject(new Error('Retired transport'))
  await older
  expect(h.state()?.taskId).toBe('b')
  expect(h.state()?.record.value?.taskId).toBe('b')
})

it('single-flights initial reads and preserves a revision observed before the first response', async () => {
  const h = setup()
  const pending = deferred<Awaited<ReturnType<typeof h.api.teams.taskInspect>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const reading = h.owner.read(teamId, 'a' as TeamTaskId)
  await h.owner.read(teamId, 'a' as TeamTaskId)
  await h.owner.read(teamId, 'a' as TeamTaskId, 'attempts')
  expect(h.read).toHaveBeenCalledTimes(1)
  h.owner.changed(teamId, 'a' as TeamTaskId, 2)
  h.owner.changed(teamId, 'a' as TeamTaskId, 2)
  pending.resolve(h.response({ teamId, taskId: 'a' as TeamTaskId, section: 'record' }))
  await reading
  expect(h.state()?.record.error).toContain('older than')
})

it.each([false, true])('drops a retired latest-result response, rejected=%s', async (reject) => {
  const h = setup()
  const pending = deferred<Awaited<ReturnType<typeof h.api.teams.taskInspect>>>()
  h.read.mockImplementationOnce(async input => h.response(input)).mockReturnValueOnce(pending.promise)
  const reading = h.owner.read(teamId, 'a' as TeamTaskId)
  await vi.waitFor(() => { expect(h.state()?.latest.loading).toBe(true) })
  h.owner.close()
  if (reject) pending.reject('retired')
  else pending.resolve(h.response({ teamId, taskId: 'a' as TeamTaskId, section: 'attempts', afterCursor: 998, limit: 1 }))
  await reading
  expect(h.state()).toBeUndefined()
})

it('publishes ordinary Host failures and non-Error latest read failures as local errors', async () => {
  const h = setup()
  h.read.mockResolvedValueOnce(err({ code: 'internal', message: 'Record failed', details: {} }))
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.record.error).toBe('Record failed')
  h.read.mockImplementationOnce(async input => h.response(input)).mockRejectedValueOnce('Latest failed')
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.latest.error).toBe('Latest failed')
  h.read.mockImplementationOnce(async input => h.response(input)).mockResolvedValueOnce(err({ code: 'internal', message: 'Latest unavailable', details: {} }))
  await h.owner.read(teamId, 'a' as TeamTaskId)
  expect(h.state()?.latest.error).toBe('Latest unavailable')
  h.owner.changed(teamId, 'a' as TeamTaskId, 1)
  expect(h.state()?.hasNewer).toBe(false)
})
