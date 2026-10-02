// @vitest-environment jsdom
/** Domain summaries remain independent facts and never require a detail request to label a row. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CollectionTable } from '../src/client/CollectionTable.tsx'
import { en, zh } from '../src/client/locales.ts'
afterEach(cleanup)
const base = { runId: 'run' as never, snapshotRevision: 2, observedAt: 1, total: 1 }
it.each([en, zh])('names entity actions from existing summaries and preserves the exact selection identity', (locale) => {
  const open = vi.fn()
  const view = render(<CollectionTable page={{ ...base, collection: 'entities', items: [{ id: 'opaque' as never,
    name: { text: '采购方', truncated: false }, kind: { text: 'buyer', truncated: false }, cognition: 'agent', phase: 'active', writer: 'reserved' }] }}
  selected="opaque" open={open} t={key => locale[key]} date={String} />)
  fireEvent.click(view.getByRole('button', { name: `${locale.view}: 采购方 (opaque)` }))
  expect(open).toHaveBeenCalledWith('opaque')
  expect(view.getByRole('columnheader', { name: locale.cognition })).toBeDefined()
  expect(view.getByText('buyer')).toBeDefined()
  expect(view.getByText(`${locale.writer}: ${locale.reserved}`)).toBeDefined()
})
it('keeps exact decision time and separates checkpoint saving from source verification', () => {
  const props = { open: vi.fn(), t: (key: keyof typeof en) => en[key], date: String }
  const view = render(<CollectionTable {...props} page={{ ...base, collection: 'decisions', items: [{ id: 'd' as never,
    entityId: 'e' as never, time: '9007199254740993' as never, slot: 's' as never, status: 'accepted', snapshotRevision: 1, operationCount: 3 }] }} />)
  expect(view.getByText('9007199254740993')).toBeDefined()
  expect(view.getByText(en.accepted)).toBeDefined()
  view.rerender(<CollectionTable {...props} page={{ ...base, collection: 'checkpoints', items: [{ id: 'c' as never,
    status: 'completed', startedSequence: 1, latestSuccessful: true, sourceValidation: 'not-performed' }] }} />)
  expect(view.getByText(en.validation)).toBeDefined()
  expect(view.getByText(en.latest)).toBeDefined()
  expect(view.getAllByText(en.unavailable)).toHaveLength(2)
})
