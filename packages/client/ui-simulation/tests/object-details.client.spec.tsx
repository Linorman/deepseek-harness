// @vitest-environment jsdom
/** Metadata navigation and continuation retain exact identities without implying execution or content grants. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ObjectDetails } from '../src/client/ObjectDetails.tsx'
import { CollectionFilters } from '../src/client/CollectionFilters.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationProductObjectDetail } from '@clocky/clocky-client-runtime/client'
afterEach(cleanup)

it.each([en, zh])('keeps publication outcomes and independent continuation controls accessible in each locale', (locale) => {
  const readPage = vi.fn(), navigate = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'operations', section: 'attempts', id: 'operation' as never,
    attempts: { total: 3, items: [{ number: 1, outcome: 'uncertain', startedAt: 100, finishedAt: 200 }], nextCursor: 'next' as never } }
  const props = { value, view: { runId: 'run', module: 'operations' as const, search: '', objectId: 'operation', section: 'attempts' as const },
    navigate, readPage, blocked: false, canContinue: true, t: (key: Key) => locale[key], date: String }
  const view = render(<ObjectDetails {...props} />)
  expect(view.getByText(locale.uncertain)).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: locale.next }))
  expect(readPage).toHaveBeenLastCalledWith('next')
  view.rerender(<ObjectDetails {...props} canContinue={false} />)
  expect((view.getByRole('button', { name: locale.next }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: locale.first }))
  expect(readPage).toHaveBeenLastCalledWith()
  expect(view.getByText(locale.uncertain)).toBeDefined()
  view.rerender(<ObjectDetails {...props} value={{ ...value, attempts: { total: 0, items: [] } }} />)
  expect(view.getByText(locale.emptyCollection)).toBeDefined()
})

it('preserves exact decision time and links entity and operation scopes without copying hidden context', () => {
  const navigate = vi.fn()
  const value: SimulationProductObjectDetail = { collection: 'decisions', section: 'execution', id: 'decision' as never,
    summary: { id: 'decision' as never, entityId: 'entity' as never, slot: '9007199254740994' as never, time: '9007199254740993' as never,
      snapshotRevision: 4, status: 'accepted', operationCount: 2 },
    context: { status: 'prepared', retainedBytes: 40, maxBytes: 100, knowledgeCount: 1, sourceCount: 2, sectionCount: 3, content: 'withheld' },
    inference: { startedAt: 100, deadline: 200, expiredAt: 200 }, cancellation: 'timeout' }
  const view = render(<ObjectDetails value={value} view={{ runId: 'run', module: 'decisions', search: 'saved' }} navigate={navigate}
    readPage={vi.fn()} blocked={false} canContinue t={key => en[key]} date={String} />)
  expect(view.getByText('9007199254740993')).toBeDefined()
  expect(view.getByText(en.withheld)).toBeDefined()
  expect(view.getByText(en['cancellation.timeout'])).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: 'entity' }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'entities', search: 'saved', objectId: 'entity' })
  fireEvent.click(view.getByRole('button', { name: en.decisionOperations }))
  expect(navigate).toHaveBeenLastCalledWith({ runId: 'run', module: 'operations', search: 'saved', decisionId: 'decision' })
})

it('clears a linked-object filter together with selection while retaining the selected run', () => {
  const change = vi.fn()
  const view = render(<CollectionFilters view={{ runId: 'run', module: 'operations', search: '', status: 'pending', entityId: 'entity',
    objectId: 'operation', section: 'attempts' }} change={change} t={key => en[key]} />)
  fireEvent.click(view.getByRole('button', { name: en.clearFilters }))
  expect(change).toHaveBeenCalledWith({ runId: 'run', module: 'operations', search: '', status: undefined, cognition: undefined,
    entityId: undefined, decisionId: undefined, objectId: undefined, section: undefined })
})
