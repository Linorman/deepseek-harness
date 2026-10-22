// @vitest-environment jsdom
/** Collection geometry derives bounded reads, exact object identity and accessible return from public snapshots. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { CollectionWorkspace } from '../src/client/CollectionWorkspace.tsx'
import { en } from '../src/client/locales.ts'
import type { SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const t = (key: keyof typeof en) => en[key]
const runId = 'run' as never
const entity = { id: 'entity' as never, name: { text: 'Buyer', truncated: false },
  kind: { text: 'buyer', truncated: false }, cognition: 'agent' as const, phase: 'active' as const, writer: 'released' as const }
const page = { runId, collection: 'entities' as const, snapshotRevision: 7, observedAt: 1, total: 3,
  nextCursor: 'next' as never, items: [entity] }
const data = { connected: true, generation: 1, authorizationVersion: 1,
  object: { loading: false, stale: false }, source: { loading: false, stale: false } } as SimulationRuntimeState
const emptyPage = { ...page, nextCursor: undefined, total: 0, items: [] }
const base = {
  runId, data, page, objectName: 'Buyer', current: { loading: false, stale: false },
  collection: { runId, collection: 'entities' as const, limit: 2 },
  selection: { runId, collection: 'entities' as const, id: entity.id, section: 'identity' as const },
  position: 31, rememberScroll: vi.fn(), navigate: vi.fn(), refresh: vi.fn(),
  readObjectPage: vi.fn(), openRetry: vi.fn(), date: String, t,
  pageSize: 2, watchSource: vi.fn(() => () => {}), inspectSource: vi.fn(async () => {}),
  refreshSource: vi.fn(async () => {}), navigateApplication: vi.fn(), browse: vi.fn(async () => {}),
  inspectObject: vi.fn(async () => {}),
}

it('keeps scroll memory separate from live scrolling and passes exact continuation inputs', () => {
  const view = render(<CollectionWorkspace {...base} view={{ runId: 'run', module: 'entities', search: '' }} />)
  expect(view.getByText(`${en.total}: 3 · ${en.revision}: 7`)).toBeDefined()
  const scroll = view.getByRole('table').parentElement
  if (scroll === null) throw new Error('Collection table has no scroll viewport')
  Object.defineProperties(scroll, { scrollTop: { configurable: true, value: 19 },
    getClientRects: { configurable: true, value: () => [{ width: 1, height: 1 }] } })
  fireEvent.scroll(scroll)
  expect(base.rememberScroll).toHaveBeenCalledWith(19)
  fireEvent.click(view.getByRole('button', { name: en.next }))
  expect(base.browse).toHaveBeenCalledWith({ ...base.collection, cursor: 'next' })
  expect(view.getByRole('button', { name: en.first }).hasAttribute('disabled')).toBe(false)
})

it('keeps read controls disabled while disconnected or a stale read is shown', () => {
  const view = render(<CollectionWorkspace {...base} view={{ runId: 'run', module: 'entities', search: '' }}
    current={{ loading: true, stale: true, error: 'network' }} />)
  expect(view.getByRole('button', { name: en.first }).hasAttribute('disabled')).toBe(true)
  expect(view.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
  view.rerender(<CollectionWorkspace {...base} page={emptyPage} view={{ runId: 'run', module: 'entities', search: '' }}
    current={{ loading: false, stale: true }} />)
  expect(view.getByText(en.emptyCollection)).toBeDefined()
  expect(view.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
})

it('allows a committed first-page refresh even when no page is displayed', () => {
  const view = render(<CollectionWorkspace {...base} collection={undefined}
    view={{ runId: 'run', module: 'entities', search: '' }} />)
  view.rerender(<CollectionWorkspace {...base} page={undefined} collection={undefined}
    view={{ runId: 'run', module: 'entities', search: '' }} />)
  fireEvent.click(view.getByRole('button', { name: en.first }))
  expect(base.refresh).toHaveBeenCalledOnce()
})

it('withholds continuation when the current collection selector is unavailable', () => {
  const browse = vi.fn(async () => {})
  const view = render(<CollectionWorkspace {...base} browse={browse} collection={undefined}
    view={{ runId: 'run', module: 'entities', search: '' }} />)
  expect(view.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en.next }))
  expect(browse).not.toHaveBeenCalled()
})

it('opens and returns to the exact object while preserving retained list scroll', () => {
  const object = { runId, snapshotRevision: 9, observedAt: 2,
    selection: { collection: 'entities' as const, id: entity.id, section: 'identity' as const },
    status: 'found' as const, value: { collection: 'entities' as const, section: 'identity' as const,
      id: entity.id, summary: entity, revision: 9, profileRevision: 4 } }
  const props = { ...base, object, data: { ...data, object: { value: object, loading: false, stale: false } } }
  const view = render(<CollectionWorkspace {...props}
    view={{ runId: 'run', module: 'entities', search: '', objectId: 'entity' }} />)
  expect(document.activeElement).toBe(view.getByRole('heading', { name: 'Buyer' }))
  expect(view.getByText(`${en.revision}: ${object.snapshotRevision}`)).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: en.refreshDetail }))
  expect(base.inspectObject).toHaveBeenCalledWith(base.selection)
  const detail = view.getByRole('navigation', { name: en.detailSections })
  fireEvent.click(within(detail).getByRole('button', { name: en.relationships }))
  expect(base.navigate).toHaveBeenCalledWith(expect.objectContaining({ section: 'relationships' }))
  fireEvent.click(within(detail).getByRole('button', { name: en.identity }))
  expect(base.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ section: undefined }))
  fireEvent.click(view.getByRole('button', { name: en.close }))
  expect(base.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ objectId: undefined, section: undefined,
    knowledgeId: undefined, knowledgeRevision: undefined }))
  expect(view.getByRole('button', { name: `${en.view}: Buyer (entity)` }).getAttribute('aria-current')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: `${en.view}: Buyer (entity)` }))
  expect(base.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ objectId: 'entity', section: undefined }))
})

it('reports exact empty states, missing reads and disabled continuation without inventing content', () => {
  const view = render(<CollectionWorkspace {...base} page={emptyPage}
    view={{ runId: 'run', module: 'entities', search: '', cognition: 'agent' }} />)
  expect(view.getByText(en.noMatchingRecords)).toBeDefined()
  expect(view.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
  const missing = { runId, snapshotRevision: 9, observedAt: 2,
    selection: { collection: 'entities' as const, id: entity.id, section: 'identity' as const }, status: 'missing' as const }
  view.rerender(<CollectionWorkspace {...base} object={missing}
    data={{ ...data, object: { value: missing, loading: false, stale: true } }}
    view={{ runId: 'run', module: 'entities', search: '', objectId: 'entity' }} />)
  expect(view.queryByText(en.stale)).toBeNull()
  expect(view.getByText(en.detailMissing)).toBeDefined()
  expect(view.queryByText(en.contextPart)).toBeNull()
})

it('keeps checkpoint paging and source details separate from the selected collection page', () => {
  const checkpointPage = { runId, collection: 'checkpoints' as const, snapshotRevision: 8, observedAt: 3, total: 2,
    nextCursor: 'checkpoint-next' as never, items: [{ id: 'checkpoint' as never, status: 'completed' as const,
      startedSequence: 1, finishedSequence: 2, latestSuccessful: true, sourceValidation: 'not-performed' as const }] }
  const view = render(<CollectionWorkspace {...base} page={checkpointPage}
    collection={{ runId, collection: 'checkpoints', limit: 2 }}
    view={{ runId: 'run', module: 'checkpoints', search: '' }} />)
  fireEvent.click(view.getByRole('button', { name: en.next }))
  expect(base.browse).toHaveBeenCalledWith({ runId, collection: 'checkpoints', limit: 2, cursor: 'checkpoint-next' })
  view.rerender(<CollectionWorkspace {...base} page={checkpointPage}
    collection={{ runId, collection: 'checkpoints', limit: 2 }}
    selection={{ runId, collection: 'checkpoints', id: 'checkpoint' as never, section: 'references', limit: 2 }}
    view={{ runId: 'run', module: 'checkpoints', search: '', objectId: 'checkpoint', sourceIndex: 0 }} />)
  expect(view.getByRole('region', { name: en.sourceTitle })).toBeDefined()
  expect(view.queryByRole('navigation', { name: en.detailSections })).toBeNull()
  expect(view.queryByText(`${en.revision}: 8`)).toBeNull()
  view.rerender(<CollectionWorkspace {...base} page={{ ...checkpointPage, nextCursor: undefined }}
    collection={{ runId, collection: 'checkpoints', limit: 2 }}
    view={{ runId: 'run', module: 'checkpoints', search: '' }} />)
  expect(view.getByRole('button', { name: `${en.view}: checkpoint` })).toBeDefined()
})

it('returns focus through the fallback filter when the originating row is gone', () => {
  const view = render(<CollectionWorkspace {...base} page={{ ...page, items: [] }}
    view={{ runId: 'run', module: 'entities', search: '' }} />)
  view.rerender(<CollectionWorkspace {...base} page={{ ...page, items: [] }}
    view={{ runId: 'run', module: 'entities', search: '', objectId: 'removed' }} />)
  view.rerender(<CollectionWorkspace {...base} page={{ ...page, items: [] }}
    view={{ runId: 'run', module: 'entities', search: '' }} />)
  expect(document.activeElement).toBe(view.getByRole('button', { name: en.filterStatus }))
})
