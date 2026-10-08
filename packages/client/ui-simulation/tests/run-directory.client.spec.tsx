// @vitest-environment jsdom
/** The bounded directory keeps search, batch status recovery and run identity actions public. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { RunDirectory } from '../src/client/RunDirectory.tsx'
import { en } from '../src/client/locales.ts'
import type { SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'

afterEach(cleanup)
const run = { id: 'run' as never, name: { text: 'Registered run', truncated: true }, registeredAt: 1,
  observation: 'not-observed' as const }
const props = {
  catalog: { loading: false, stale: false },
  create: vi.fn(),
  directory: { loading: false, stale: false, value: { items: [run], nextCursor: 'next' as never } },
  statuses: { loading: false, stale: false, value: { items: [{ run, status: 'missing' as const }],
    modelPool: { status: 'observed' as const, clock: 'real' as const, observedAt: 2, active: 1, queued: 2,
      limit: 4, queueLimit: 8 } } },
  directoryIds: [run.id],
  connected: true,
  search: '',
  draftSearch: '',
  searchDraft: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
  readDirectory: vi.fn(async () => {}),
  runStatuses: vi.fn(async () => {}),
  t: (key: keyof typeof en) => en[key],
  date: (value: number) => `date:${value}`,
} satisfies Omit<Parameters<typeof RunDirectory>[0], 'directory' | 'statuses'> & {
  directory: SimulationRuntimeState['directory']
  statuses: SimulationRuntimeState['statuses']
}

it('commits exact search text, IME drafts and cleared searches through public navigation', () => {
  const ui = render(<RunDirectory {...props} draftSearch="  Registered  " />)
  const input = ui.getByLabelText(en.search)
  fireEvent.change(input, { target: { value: '  Registered   ' } })
  fireEvent.compositionStart(input)
  fireEvent.submit(input.closest('form')!)
  expect(props.navigate).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  fireEvent.submit(input.closest('form')!)
  expect(props.navigate).toHaveBeenLastCalledWith({ module: 'overview', search: 'Registered' })
  expect(props.searchDraft).toHaveBeenLastCalledWith('  Registered   ')

  fireEvent.click(ui.getByRole('button', { name: en.clear }))
  expect(props.navigate).toHaveBeenLastCalledWith({ module: 'overview', search: '' })
  expect(document.activeElement).toBe(input)
  fireEvent.click(ui.getByRole('button', { name: /^Registered run/ }))
  expect(props.navigate).toHaveBeenLastCalledWith({ runId: run.id, module: 'overview', search: '' })
  expect(ui.getByText(en.truncate)).toBeDefined()
  expect([...ui.container.querySelectorAll('small')].at(-1)?.textContent).toBe(`${en.registration}: date:1`)
  expect(ui.getByText('1 / 4')).toBeDefined()
})

it('separates directory paging, exact status recovery and ID copying from run navigation', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  const ui = render(<RunDirectory {...props} />)
  fireEvent.click(ui.getByRole('button', { name: en.next }))
  expect(props.readDirectory).toHaveBeenLastCalledWith('', 'next')
  fireEvent.click(ui.getByRole('button', { name: en.first }))
  expect(props.refresh).toHaveBeenCalledOnce()

  fireEvent.click(ui.getByRole('button', { name: en['directory.actions'] }))
  fireEvent.click(ui.getByRole('menuitem', { name: en['status.refresh'] }))
  expect(props.runStatuses).toHaveBeenLastCalledWith({ runIds: [run.id] })

  fireEvent.click(ui.getByRole('button', { name: `${en['directory.runActions']} ${run.name.text}` }))
  fireEvent.click(ui.getByRole('menuitem', { name: en.copyId }))
  await Promise.resolve()
  expect(writeText).toHaveBeenCalledWith(run.id)
})

it('does not issue directory or status recovery work while disconnected or during loading', () => {
  const ui = render(<RunDirectory {...props} connected={false}
    directory={{ ...props.directory, loading: true, value: undefined, error: undefined }} />)
  expect(ui.getByRole('button', { name: en.first }).hasAttribute('disabled')).toBe(true)
  expect(ui.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(ui.getByRole('button', { name: en['directory.actions'] }))
  expect(ui.getByRole('menuitem', { name: en['status.refresh'] }).hasAttribute('disabled')).toBe(true)
})

it('reports read failure and an unfiltered empty directory without inventing a run', () => {
  const ui = render(<RunDirectory {...props} directory={{ ...props.directory, value: { items: [] } }} />)
  expect(ui.getByText(en['directory.empty'])).toBeDefined()
  ui.rerender(<RunDirectory {...props} search="missing"
    directory={{ ...props.directory, loading: false, stale: true, error: 'forbidden', value: undefined }}
    statuses={{ ...props.statuses, value: undefined }} />)
  expect(ui.queryByRole('alert')).toBeNull()
  expect(ui.queryByText(en.noResults)).toBeNull()
  expect(ui.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
})

it('closes recovery menus with Escape and shows a filtered empty result', () => {
  const ui = render(<RunDirectory {...props} search="missing" directory={{ ...props.directory, value: { items: [] } }} />)
  expect(ui.getByText(en.noResults)).toBeDefined()
  ui.rerender(<RunDirectory {...props} />)
  const actions = ui.getByRole('button', { name: en['directory.actions'] })
  fireEvent.click(actions)
  expect(actions.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(actions.getAttribute('aria-expanded')).toBe('false')
  const rowActions = ui.getByRole('button', { name: `${en['directory.runActions']} ${run.name.text}` })
  fireEvent.click(rowActions)
  expect(rowActions.getAttribute('aria-expanded')).toBe('true')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(rowActions.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(rowActions)
  fireEvent.click(rowActions)
  expect(rowActions.getAttribute('aria-expanded')).toBe('false')
})
