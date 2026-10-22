// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useObservedRefresh } from '../src/client/useObservedRefresh.ts'

afterEach(cleanup)

it('coalesces advancing observations behind a slow read and uses the latest callback', () => {
  const first = vi.fn(), latest = vi.fn()
  const hook = renderHook(({ version, loading, refresh }) => { useObservedRefresh(version, loading, refresh) },
    { initialProps: { version: '1', loading: false, refresh: first } })
  expect(first).not.toHaveBeenCalled()
  hook.rerender({ version: '2', loading: true, refresh: first })
  hook.rerender({ version: '3', loading: true, refresh: latest })
  expect(first).not.toHaveBeenCalled(); expect(latest).not.toHaveBeenCalled()
  hook.rerender({ version: '3', loading: false, refresh: latest })
  expect(latest).toHaveBeenCalledOnce()
  hook.rerender({ version: '3', loading: false, refresh: first })
  expect(first).not.toHaveBeenCalled()
  hook.rerender({ version: '4', loading: false, refresh: first })
  expect(first).toHaveBeenCalledOnce()
})

it('discards queued changes when disconnected or hidden and leaves initial reads to the view', () => {
  const refresh = vi.fn()
  const initialProps: { version: string | undefined; loading: boolean } = { version: '1', loading: false }
  const hook = renderHook(({ version, loading }: { version: string | undefined; loading: boolean }) => {
    useObservedRefresh(version, loading, refresh)
  }, { initialProps })
  hook.rerender({ version: '2', loading: true })
  hook.rerender({ version: undefined, loading: false })
  hook.rerender({ version: '3', loading: false })
  expect(refresh).not.toHaveBeenCalled()
  hook.rerender({ version: '4', loading: false })
  expect(refresh).toHaveBeenCalledOnce()
})

it('revalidates an initial response overtaken by the first watch without retrying an unchanged failed read forever', () => {
  const refresh = vi.fn()
  const initialProps: { version: string | undefined; loading: boolean; stale: boolean } = {
    version: undefined, loading: true, stale: false,
  }
  const hook = renderHook(({ version, loading, stale }) => { useObservedRefresh(version, loading, refresh, stale) }, { initialProps })
  hook.rerender({ version: '1', loading: true, stale: false })
  hook.rerender({ version: '1', loading: false, stale: true })
  expect(refresh).toHaveBeenCalledOnce()
  hook.rerender({ version: '1', loading: true, stale: true })
  hook.rerender({ version: '1', loading: false, stale: true })
  expect(refresh).toHaveBeenCalledOnce()
})
