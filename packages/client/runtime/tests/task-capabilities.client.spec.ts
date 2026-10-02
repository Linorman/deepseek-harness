/** Authoring observations refresh runtime availability without Team WAL changes or draft ownership. */
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamTaskCapabilitiesInput, TeamTaskCapabilitiesState, TeamTaskCapabilitiesValue } from '../src/client/contract/team-tasks.ts'
import { TaskCapabilities } from '../src/client/teams/task-capabilities.ts'
import { FakeApiClient, deferred, ok, err } from './fake-api.client.ts'

const input: TeamTaskCapabilitiesInput = { teamId: 'capability-team' as never, integration: false, readScopes: [], writeScopes: [] }
function value(allowed = true): TeamTaskCapabilitiesValue {
  return { teamId: input.teamId, teamCursor: 1, observationId: (allowed ? 'a' : 'b').repeat(64) as never, observedAt: 1,
    create: { allowed: true, reasons: [] }, maxAttempts: 2,
    workspaceModes: (['shared', 'worktree', 'sandbox', 'remote'] as const).map(mode => ({ mode, allowed,
      reasons: allowed ? [] : ['provider-unavailable'] })),
    readScopes: { editable: false, accepted: true }, writeScopes: { editable: false, accepted: true } }
}
function setup(onPublish?: (observer: TaskCapabilities, state: TeamTaskCapabilitiesState | undefined) => void) {
  const api = new FakeApiClient()
  let state: TeamTaskCapabilitiesState | undefined
  const observer = new TaskCapabilities(api, (next) => { state = next; onPublish?.(observer, next) })
  const read = vi.spyOn(api.teams, 'capabilities').mockResolvedValue(ok(value()))
  return { observer, read, state: () => state }
}
afterEach(() => { vi.useRealTimers() })

it('polls provider changes without a journal update and stops after the form closes', async () => {
  vi.useFakeTimers()
  const h = setup()
  const stop = h.observer.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.value?.workspaceModes[0]?.allowed).toBe(true)
  h.read.mockResolvedValue(ok(value(false)))
  await vi.advanceTimersByTimeAsync(500)
  expect(h.state()?.value?.workspaceModes[0]?.allowed).toBe(false)
  expect(h.state()?.value?.teamCursor).toBe(1)
  stop()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.read).toHaveBeenCalledTimes(2)
  expect(h.state()).toBeUndefined()
})

it('retains display hints after network failure, clears them after denial, and revalidates on reconnect', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.observer.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  h.read.mockRejectedValueOnce(new Error('Network failed'))
  await h.observer.refresh()
  expect(h.state()).toMatchObject({ value: value(), loading: false, error: 'Network failed' })
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_NOT_FOUND', message: 'Access revoked', details: {} }))
  await h.observer.refresh()
  expect(h.state()).toMatchObject({ value: undefined, loading: false, error: 'Access revoked' })
  h.observer.disconnect()
  const calls = h.read.mock.calls.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.read).toHaveBeenCalledTimes(calls)
  h.observer.reconnect()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.disconnected).toBe(false)
  expect(h.state()?.value).toEqual(value())
  h.observer.close()
})

it('ignores replaced scope responses and an older watcher cannot close the current form', async () => {
  vi.useFakeTimers()
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['capabilities']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const stopOld = h.observer.watch(input, 500)
  const signal = h.read.mock.calls[0]?.[1]
  const current = { ...input, readScopes: ['src'] }
  h.observer.watch(current, 500)
  await vi.advanceTimersByTimeAsync(0)
  stopOld()
  expect(signal?.aborted).toBe(true)
  pending.resolve(ok(value(false)))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.input).toEqual(current)
  expect(h.state()?.value?.workspaceModes[0]?.allowed).toBe(true)
  h.observer.close()
})


it('does not read before a form opens, while offline, or concurrently with its pending observation', async () => {
  vi.useFakeTimers()
  const h = setup()
  await h.observer.refresh()
  h.observer.disconnect()
  const stop = h.observer.watch(input, 500)
  await h.observer.refresh()
  expect(h.read).not.toHaveBeenCalled()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['capabilities']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  h.observer.reconnect()
  await h.observer.refresh()
  await vi.advanceTimersByTimeAsync(1000)
  expect(h.read).toHaveBeenCalledOnce()
  stop()
  pending.reject('Retired request')
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()).toBeUndefined()
})

it('keeps display hints after ordinary Host errors and rejects cross-Team observations', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.observer.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  h.read.mockResolvedValueOnce(err({ code: 'internal', message: 'Host unavailable', details: {} }))
  await h.observer.refresh()
  expect(h.state()).toMatchObject({ value: value(), error: 'Host unavailable' })
  h.read.mockResolvedValueOnce(ok({ ...value(), teamId: 'foreign-team' as never }))
  await h.observer.refresh()
  expect(h.state()?.error).toContain('another Team')
  expect(h.state()?.value?.teamId).toBe(input.teamId)
  h.read.mockRejectedValueOnce('Disconnected')
  await h.observer.refresh()
  expect(h.state()?.error).toBe('Disconnected')
  h.observer.close()
})

it.each(['watch', 'close'] as const)('preserves an abort-callback replacement during %s', async (action) => {
  vi.useFakeTimers()
  const h = setup()
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['capabilities']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  h.observer.watch(input, 500)
  const replacement = { ...input, readScopes: ['replacement'] }
  h.read.mock.calls[0]?.[1]?.addEventListener('abort', () => { h.observer.watch(replacement, 500) })
  if (action === 'watch') h.observer.watch({ ...input, readScopes: ['superseded'] }, 500)()
  else h.observer.close()
  await vi.advanceTimersByTimeAsync(0)
  pending.resolve(ok(value(false)))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.input).toEqual(replacement)
  h.observer.close()
})

it.each(['initial', 'loading', 'value'] as const)('honors dismissal from its %s publication', async (stage) => {
  vi.useFakeTimers()
  let dismissed = false
  const h = setup((observer, state) => {
    if (dismissed || state === undefined) return
    const reached = stage === 'initial' ? !state.loading : stage === 'loading' ? state.loading : state.value !== undefined
    if (reached) { dismissed = true; observer.close() }
  })
  h.observer.watch(input, 500)
  await vi.advanceTimersByTimeAsync(1000)
  expect(dismissed).toBe(true)
  expect(h.state()).toBeUndefined()
  expect(h.read.mock.calls.length).toBeLessThanOrEqual(1)
})
