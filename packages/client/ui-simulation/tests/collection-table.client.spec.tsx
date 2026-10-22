// @vitest-environment jsdom
/** Domain summaries remain independent facts and never require a detail request to label a row. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CollectionTable } from '../src/client/CollectionTable.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { SimulationProductCollectionPage } from '@clocky/clocky-client-runtime/client'
afterEach(cleanup)
const base = { runId: 'run' as never, snapshotRevision: 2, observedAt: 1, total: 1 }
it('labels unnamed entities with exact ids and keeps operation publication separate from delivery', () => {
  const props = { open: vi.fn(), t: (key: keyof typeof en) => en[key], date: String }
  const ui = render(<CollectionTable {...props} page={{ ...base, collection: 'entities', items: [{ id: 'entity' as never,
    kind: { text: 'external', truncated: false }, cognition: 'none', phase: 'inactive', writer: 'released' }] }} />)
  expect(ui.getByRole('button', { name: `${en.view}: entity` })).toBeDefined()
  ui.rerender(<CollectionTable {...props} page={{ ...base, collection: 'operations', items: [{ id: 'operation' as never,
    entityId: 'entity' as never, decisionId: 'decision' as never, index: 0, status: 'outcome-unknown', publication: 'published',
    delivery: 'not-applicable', task: 'not-applicable', kind: { text: 'Communication', truncated: false } }] }} />)
  expect(ui.getByText(en['outcome-unknown'])).toBeDefined()
  expect(ui.getByText(en.published)).toBeDefined()
  expect(ui.getByText(en['not-applicable'])).toBeDefined()
  ui.rerender(<CollectionTable {...props} page={{ ...base, collection: 'checkpoints', items: [{ id: 'checkpoint' as never,
    status: 'completed', startedSequence: 1, latestSuccessful: false, sourceValidation: 'not-performed', time: '3' as never,
    publishedAt: 4 }] }} />)
  expect(ui.getByText('4')).toBeDefined()
  expect(ui.queryByText(en.latest)).toBeNull()
})
it('rejects unsupported public collection kinds instead of choosing misleading columns', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(() => render(<CollectionTable page={{ collection: 'future' } as unknown as SimulationProductCollectionPage}
      open={vi.fn()} t={key => en[key]} date={String} />)).toThrow('Unknown Simulation collection')
  } finally { error.mockRestore() }
})
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

it('leads decision and operation rows with readable identities and keeps the exact ones available', async () => {
  const { readableId } = await import('../src/client/CollectionTable.tsx')
  expect(readableId('world-person:3f2a9c10-1234-4abc-8def-0123456789ab')).toBe('world-person · 3f2a9c10')
  expect(readableId('world/1/decision/0')).toBe('decision 0')
  expect(readableId('buyer')).toBe('buyer')
})
