// @vitest-environment jsdom
/** An explicit refresh always ends in an announced outcome; automatic rereads stay silent. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { SimulationReadState } from '@clocky/clocky-client-runtime/client'
import { RefreshFeedback } from '../src/client/Feedback.tsx'
import { useRefreshOutcome } from '../src/client/useRefreshOutcome.ts'
import { Config } from '../src/config.ts'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })
const t = (key: Key, vars?: Record<string, string>) => en[key].replace(/\{(\w+)\}/g, (_m, name: string) => vars?.[name] ?? '')

function Harness({ current, connected = true, refresh, scope = 'run:overview' }: {
  current: SimulationReadState<unknown>
  connected?: boolean
  refresh: () => Promise<void>
  scope?: string
}) {
  const { outcome, start } = useRefreshOutcome(current, connected, 1000, scope)
  return <><button type="button" onClick={() => { start(refresh()) }}>go</button>
    <RefreshFeedback value={outcome} time={() => '14:43:05'} t={t} /></>
}

it('reports refreshing, then refreshed with its time', async () => {
  const pending = Promise.withResolvers<undefined>()
  const ui = render(<Harness current={{ loading: false, stale: false }} refresh={async () => { await pending.promise }} />)
  fireEvent.click(ui.getByRole('button', { name: 'go' }))
  expect(ui.getByText(en['refresh.pending'])).toBeDefined()
  await act(async () => { pending.resolve(undefined) })
  expect(ui.getByText(t('refresh.done', { time: '14:43:05' }))).toBeDefined()
})

it('reports a failure from the refreshed read state or a lost connection', async () => {
  const ui = render(<Harness current={{ loading: false, stale: true, error: 'network' }} refresh={async () => {}} />)
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'go' })) })
  expect(ui.getByRole('alert').textContent).toBe(en['refresh.failed'])
  ui.rerender(<Harness current={{ loading: false, stale: false }} connected={false} refresh={async () => {}} />)
  expect(ui.getByRole('alert').textContent).toBe(en['refresh.failed'])
})

it('reports a timeout without abandoning a late settlement, and clears on another view', async () => {
  vi.useFakeTimers()
  const pending = Promise.withResolvers<undefined>()
  const ui = render(<Harness current={{ loading: true, stale: false }} refresh={async () => { await pending.promise }} />)
  fireEvent.click(ui.getByRole('button', { name: 'go' }))
  act(() => { vi.advanceTimersByTime(1001) })
  expect(ui.getByRole('alert').textContent).toBe(en['refresh.timeout'])
  await act(async () => { pending.resolve(undefined) })
  ui.rerender(<Harness current={{ loading: false, stale: false }} refresh={async () => { await pending.promise }} />)
  expect(ui.getByText(t('refresh.done', { time: '14:43:05' }))).toBeDefined()
  ui.rerender(<Harness current={{ loading: false, stale: false }} refresh={async () => { await pending.promise }} scope="run:cases" />)
  expect(ui.container.querySelector('[data-refresh]')).toBeNull()
})

it('derives the freshness threshold from the refresh interval and rejects one that would always be stale', () => {
  expect(Config.parse({}).staleAfterMs).toBeUndefined()
  expect(Config.parse({ controlRefreshMs: 1000, staleAfterMs: 2001 }).staleAfterMs).toBe(2001)
  expect(() => Config.parse({ controlRefreshMs: 1000, staleAfterMs: 2000 })).toThrow(/staleAfterMs/)
})

it('keeps a settled outcome when its timeout later elapses', async () => {
  vi.useFakeTimers()
  const ui = render(<Harness current={{ loading: false, stale: false }} refresh={async () => {}} />)
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'go' })) })
  expect(ui.getByText(t('refresh.done', { time: '14:43:05' }))).toBeDefined()
  await act(async () => { vi.advanceTimersByTime(5000) })
  expect(ui.getByText(t('refresh.done', { time: '14:43:05' }))).toBeDefined()
  expect(ui.queryByRole('alert')).toBeNull()
})

it('still times out a newer refresh after an older one settles late', async () => {
  vi.useFakeTimers()
  const first = Promise.withResolvers<undefined>(), second = Promise.withResolvers<undefined>()
  const pending = [first.promise, second.promise]
  const ui = render(<Harness current={{ loading: false, stale: false }} refresh={async () => { await pending.shift() }} />)
  fireEvent.click(ui.getByRole('button', { name: 'go' }))
  fireEvent.click(ui.getByRole('button', { name: 'go' }))
  await act(async () => { first.resolve(undefined) })
  expect(ui.getByText(en['refresh.pending'])).toBeDefined()
  await act(async () => { vi.advanceTimersByTime(1000) })
  expect(ui.getByRole('alert').textContent).toBe(en['refresh.timeout'])
  await act(async () => { second.resolve(undefined) })
  expect(ui.getByText(t('refresh.done', { time: '14:43:05' }))).toBeDefined()
})
