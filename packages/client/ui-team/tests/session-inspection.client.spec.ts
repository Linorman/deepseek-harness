/** A later navigation or dismissal prevents stale asynchronous Session selection. */
import { expect, it, vi } from 'vitest'
import type { SessionId, TeamId } from '@clocky/clocky-client-runtime/client'
import { createSessionInspection } from '../src/client/session-inspection.ts'

it('selects only the newest request when an older resolver completes later', async () => {
  const team = 'team' as TeamId
  const older = Promise.withResolvers<SessionId>()
  const refresh = vi.fn(async () => {})
  const select = vi.fn()
  const inspection = createSessionInspection({ currentTeam: () => team, refresh, select })
  const first = inspection.open(team, async () => await older.promise)
  await inspection.open(team, async () => 'new-session' as SessionId)
  older.resolve('old-session' as SessionId)
  await first
  expect(select).toHaveBeenCalledExactlyOnceWith('new-session')
  expect(refresh).toHaveBeenCalledOnce()
})

it('does not select a Session when its Team changes during refresh', async () => {
  let team = 'first-team' as TeamId
  const refresh = Promise.withResolvers<undefined>()
  const select = vi.fn()
  const inspection = createSessionInspection({ currentTeam: () => team, refresh: async () =>{  await refresh.promise }, select })
  const pending = inspection.open(team, async () => 'session' as SessionId)
  await Promise.resolve()
  team = 'second-team' as TeamId
  refresh.resolve(undefined)
  await pending
  expect(select).not.toHaveBeenCalled()
})

it('aborts a dismissed inspection and ignores its late resolver failure', async () => {
  const team = 'team' as TeamId
  const resolved = Promise.withResolvers<SessionId>()
  const select = vi.fn()
  const inspection = createSessionInspection({ currentTeam: () => team, refresh: async () => {}, select })
  let signal: AbortSignal | undefined
  const pending = inspection.open(team, async (current) => { signal = current; return await resolved.promise })
  inspection.cancel()
  expect(signal?.aborted).toBe(true)
  resolved.reject(new Error('Late transport failure'))
  await pending
  expect(select).not.toHaveBeenCalled()
})

it('reports an active inspection failure without changing selection', async () => {
  const team = 'team' as TeamId
  const select = vi.fn()
  const inspection = createSessionInspection({ currentTeam: () => team, refresh: async () => {}, select })
  await expect(inspection.open(team, async () => { throw new Error('Session is unavailable') })).rejects.toThrow('Session is unavailable')
  expect(select).not.toHaveBeenCalled()
})
