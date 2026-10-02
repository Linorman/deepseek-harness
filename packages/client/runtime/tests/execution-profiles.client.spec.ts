/** Catalog polling preserves an invitation's independent selection through page and provider changes. */
import { afterEach, expect, it, vi } from 'vitest'
import type { TeamExecutionProfilesInput, TeamExecutionProfilesState, TeamExecutionProfilesValue } from '../src/client/contract/team-tasks.ts'
import { ExecutionProfiles } from '../src/client/teams/execution-profiles.ts'
import { FakeApiClient, ok, err, deferred } from './fake-api.client.ts'

const input: TeamExecutionProfilesInput = { teamId: 'profiles' as never, kind: 'local-agent' }
function value(): TeamExecutionProfilesValue {
  return { teamId: input.teamId, kind: input.kind, revision: 1, allowed: true,
    items: [{ id: `profile-${'a'.repeat(64)}` as never, kind: 'local-agent', role: 'custom', provider: 'runtime', model: 'test', available: true, reasons: [] }] }
}
function setup() {
  const api = new FakeApiClient()
  let state: TeamExecutionProfilesState | undefined
  const observer = new ExecutionProfiles(api, (next) => { state = next })
  const read = vi.spyOn(api.teams, 'executionProfiles').mockResolvedValue(ok(value()))
  return { observer, read, state: () => state }
}
afterEach(() => { vi.useRealTimers() })

it('refreshes availability without changing profile identity or the requested page', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.observer.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  const current = value()
  h.read.mockResolvedValue(ok({ ...current, items: current.items.map(item => ({ ...item, available: false, reasons: ['provider-unavailable'] })) }))
  await vi.advanceTimersByTimeAsync(500)
  expect(h.state()?.value?.items[0]).toMatchObject({ id: current.items[0]!.id, available: false })
  expect(h.state()?.input).toEqual(input)
  h.observer.close()
})

it('retains the last page on stale continuation and clears it when current principal access is revoked', async () => {
  vi.useFakeTimers()
  const h = setup()
  const selectedId = value().items[0]!.id
  const selected = { ...input, selectedId, cursor: { ...input, revision: 1, offset: 2 } }
  h.read.mockResolvedValueOnce(ok({ ...value(), selected: value().items[0]! }))
  h.observer.watch(selected, 500)
  await vi.advanceTimersByTimeAsync(0)
  h.read.mockResolvedValueOnce(err({ code: 'team-profile-stale', message: 'Refresh first profiles', details: {} }))
  await h.observer.refresh()
  expect(h.state()?.value?.selected?.id).toBe(selectedId)
  expect(h.state()?.error).toBe('Refresh first profiles')
  h.read.mockResolvedValueOnce(err({ code: 'TEAM_HUMAN_ACTOR_FORBIDDEN', message: 'Access revoked', details: {} }))
  await h.observer.refresh()
  expect(h.state()?.value).toBeUndefined()
  h.observer.close()
})

it('rejects mismatched kind or selected identity and ignores an old kind response', async () => {
  vi.useFakeTimers()
  const h = setup()
  h.read.mockResolvedValueOnce(ok({ ...value(), kind: 'remote-agent', items: [] }))
  h.observer.watch(input, 500)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.state()?.error).toContain('do not match')
  h.read.mockResolvedValueOnce(ok({ ...value(), selected: value().items[0]! }))
  await h.observer.refresh()
  expect(h.state()?.error).toContain('do not match')
  const pending = deferred<Awaited<ReturnType<FakeApiClient['teams']['executionProfiles']>>>()
  h.read.mockReturnValueOnce(pending.promise)
  const old = h.observer.watch(input, 500)
  h.read.mockResolvedValueOnce(ok({ ...value(), kind: 'service', items: [] }))
  h.observer.watch({ ...input, kind: 'service' }, 500)
  await vi.advanceTimersByTimeAsync(0)
  pending.resolve(ok(value()))
  await vi.advanceTimersByTimeAsync(0)
  old()
  expect(h.state()?.value?.kind).toBe('service')
  h.observer.close()
})
