// @vitest-environment jsdom
/** Journal selection keeps metadata, deliberate originals and exports on exact public scopes. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@clocky/clocky-client-test-runtime'
import { createSnapshotStore, simulationRecordsScope } from '@clocky/clocky-client-runtime/client'
import type { SimulationRecordExportState, SimulationRuntimeState } from '@clocky/clocky-client-runtime/client'
import { RecordsView } from '../src/client/RecordsView.tsx'
import { en } from '../src/client/locales.ts'
import { simulationRuntimeFixture } from './simulation-fixtures.client.ts'

afterEach(cleanup)
const runId = 'run' as never
const readVersion = 'policy' as never
const metadataInput = { runId, mode: 'metadata' as const, limit: 2 }
const metadata = { runId, snapshotRevision: 4, readVersion, observedAt: 1, mode: 'metadata' as const,
  bodyAccess: 'allowed' as const, selection: {}, totalRecords: 2, nextCursor: 'metadata-next' as never,
  items: [{ sequence: 7, kind: { text: 'run/created', truncated: false }, action: { text: 'Create', truncated: true },
    body: { status: 'withheld' as const } }] }
const originalInput = { runId, mode: 'original' as const, sequence: 7, limit: 2 }
const original = { ...metadata, mode: 'original' as const, selection: { sequence: 7 }, nextCursor: 'original-next' as never,
  items: [{ sequence: 7, kind: { text: 'vendor/custom', truncated: false }, body: { status: 'text' as const,
    text: '<script>ORIGINAL_RECORD()</script>', part: 0, parts: 2 } }] }

function setup(recordSequence?: number, recordKind?: string) {
  const state = createSnapshotStore<SimulationRuntimeState>(simulationRuntimeFixture({
    observation: { loading: false, stale: false, value: { runId, readVersion, cursor: 'watch' as never,
      status: 'changed' as const, observedAt: 1, world: { status: 'observed' as const, revision: 4 } } },
    records: { scope: simulationRecordsScope({ runId, mode: 'metadata', kind: recordKind }), loading: false, stale: false, value: metadata },
    record: { scope: simulationRecordsScope({ runId, mode: 'original', sequence: recordSequence }), loading: false, stale: false, value: original } }))
  const exportState = createSnapshotStore<SimulationRecordExportState>({ pending: false, records: 0, bytes: 0, status: 'idle' })
  const read = vi.fn(async () => {})
  const close = vi.fn()
  const navigate = vi.fn()
  const exportRecords = vi.fn(async () => {})
  const cancelExport = vi.fn()
  const view = render(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordKind, recordSequence }}
    data={state.getSnapshot()} pageSize={2} read={read} close={close} navigate={navigate}
    exportRecords={exportRecords} cancelExport={cancelExport} useExport={bindSnapshotSelector(exportState)}
    t={key => en[key]} />)
  return { state, exportState, read, close, navigate, exportRecords, cancelExport, view }
}

it('keeps exact filtered journal reads, extensions, inert originals and continuation fences separate', async () => {
  const h = setup()
  expect(h.read).toHaveBeenLastCalledWith(metadataInput)
  expect(h.view.getByText(en['recordType.created'])).toBeDefined()
  expect(h.view.getByText('run/created')).toBeDefined()
  fireEvent.click(h.view.getByRole('button', { name: `${en.recordOriginal}: 7` }))
  expect(h.navigate).toHaveBeenCalledWith(expect.objectContaining({ recordSequence: 7 }))
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record,
    scope: simulationRecordsScope({ runId, mode: 'original', sequence: 7 }) } }) })
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordSequence: 7 }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  expect(h.read).toHaveBeenLastCalledWith(originalInput)
  expect(h.view.getByText((_, element) => element?.textContent === `${en.contextPart}: 1 / 2`)).toBeDefined()
  expect(h.view.getByText(/ORIGINAL_RECORD/)).toBeDefined()
  expect(h.view.container.querySelector('script')).toBeNull()
  const inspector = h.view.getByRole('complementary', { name: en.recordOriginal })
  fireEvent.click(within(inspector).getByRole('button', { name: en.next }))
  expect(h.read).toHaveBeenLastCalledWith({ ...originalInput, cursor: 'original-next', expectedRevision: 4 })
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record, stale: true } }) })
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordSequence: 7 }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  expect(within(inspector).getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
})

it('commits exact kind selectors, clears stale filters, and exports only policy-authorized originals', () => {
  const h = setup()
  fireEvent.click(h.view.getByRole('button', { name: en['records.chooseType'] }))
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(h.view.getByRole('button', { name: en['records.chooseType'] }))
  fireEvent.click(h.view.getByRole('menuitem', { name: `${en['recordType.created']} · run/created` }))
  expect(h.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ recordKind: 'run/created', recordSequence: undefined }))
  fireEvent.click(h.view.getByRole('button', { name: en.exportOriginal }))
  expect(h.exportRecords).toHaveBeenCalledWith({ runId, mode: 'original', sequence: undefined })
  act(() => { h.exportState.set({ runId, pending: true, records: 3, bytes: 12, status: 'running' }) })
  fireEvent.click(h.view.getByRole('button', { name: en.exportCancel }))
  expect(h.cancelExport).toHaveBeenCalledOnce()
})

it('keeps route, runtime and export failure states public without leaking original bodies', async () => {
  const h = setup()
  const snapshot = () => h.state.getSnapshot()
  const rerender = () => { h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '' }}
    data={snapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />) }
  act(() => { h.state.set({ ...snapshot(), records: { ...snapshot().records, value: undefined, loading: true } }) })
  rerender()
  expect(h.view.getByText(en.loading)).toBeDefined()
  act(() => { h.state.set({ ...snapshot(), records: { ...snapshot().records, loading: false, stale: true } }) })
  rerender()
  expect(h.view.queryByText(en.stale)).toBeNull()
  act(() => { h.state.set({ ...snapshot(), records: { ...snapshot().records, stale: false, error: 'unavailable' } }) })
  rerender()
  expect(h.view.getByRole('alert').textContent).toBe(en.unavailable)
  act(() => {
    h.state.set({ ...snapshot(), records: { ...snapshot().records, error: undefined,
      value: { ...metadata, bodyAccess: 'withheld' as const, nextCursor: undefined, items: [] } } })
  })
  rerender()
  expect(h.view.getByText(en.recordWithheld)).toBeDefined()
  expect(h.view.getByText(en.emptyCollection)).toBeDefined()
  expect(h.view.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(true)
})

it('commits typed filters, clears them, and returns focus to the search field', () => {
  const h = setup()
  const input = h.view.getByLabelText(en.recordKind)
  fireEvent.change(input, { target: { value: 'vendor/custom' } })
  fireEvent.submit(input.closest('form')!)
  expect(h.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ recordKind: 'vendor/custom', recordSequence: undefined }))
  fireEvent.change(input, { target: { value: 'run/created' } })
  fireEvent.click(h.view.getByRole('button', { name: en.clearFilters }))
  expect(h.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ recordKind: undefined, recordSequence: undefined }))
  expect((input as HTMLInputElement).value).toBe('')
  expect(document.activeElement).toBe(input)
})

it('renders every export settlement and returns collection focus to the inspected row', () => {
  const h = setup()
  const origin = h.view.getByRole('button', { name: `${en.recordOriginal}: 7` })
  fireEvent.click(origin)
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record,
    scope: simulationRecordsScope({ runId, mode: 'original', sequence: 7 }) } }) })
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordSequence: 7 }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  expect(document.activeElement?.tagName).toBe('H2')
  fireEvent.click(h.view.getByRole('button', { name: en.close }))
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordSequence: undefined }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  expect(document.activeElement).toBe(origin)
  act(() => { h.exportState.set({ runId, pending: true, records: 3, bytes: 12, status: 'running' }) })
  expect(h.view.getByText(`${en.exportRunning} · 3 · 12 B`)).toBeDefined()
  act(() => { h.exportState.set({ runId, pending: false, records: 3, bytes: 12, status: 'completed' }) })
  expect(h.view.getByText(`${en.exportCompleted} · 3 · 12 B`)).toBeDefined()
  act(() => { h.exportState.set({ runId, pending: false, records: 3, bytes: 12, status: 'cancelled' }) })
  expect(h.view.getByText(`${en.exportCancelled} · 3 · 12 B`)).toBeDefined()
  act(() => { h.exportState.set({ runId, pending: false, records: 3, bytes: 12, status: 'failed', error: 'downloadFailed' }) })
  expect(h.view.getByText(`${en.exportFailed} · 3 · 12 B`)).toBeDefined()
  expect(h.view.getByRole('alert').textContent).toBe(en.downloadFailed)
  fireEvent.click(origin)
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record,
    scope: simulationRecordsScope({ runId, mode: 'original', sequence: 7 }) } }) })
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordSequence: 7 }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  act(() => { h.exportState.set({ runId, pending: true, records: 3, bytes: 12, status: 'running' }) })
  fireEvent.click(within(h.view.getByRole('complementary', { name: en.recordOriginal })).getByRole('button', { name: en.exportCancel }))
  expect(h.cancelExport).toHaveBeenCalledOnce()
})

it('rejects reads while blocked, replaces stale route scopes, and preserves detail focus fallbacks', () => {
  const h = setup(undefined, 'run/created')
  const rerender = (recordSequence?: number, recordKind = 'run/created') => { h.view.rerender(<RecordsView
    view={{ runId: 'run', module: 'records', search: '', recordKind, recordSequence }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />) }
  rerender()
  expect(h.view.queryByText(`${en.total}: 2`)).toBeNull()
  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records,
    scope: simulationRecordsScope({ runId, mode: 'metadata', kind: 'run/created' }),
    value: { ...metadata, nextCursor: 'metadata-next' as never } } }) })
  rerender()
  fireEvent.click(h.view.getByRole('button', { name: en.next }))
  expect(h.read).toHaveBeenLastCalledWith({ runId, mode: 'metadata', kind: 'run/created', limit: 2,
    cursor: 'metadata-next', expectedRevision: 4 })
  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records,
    value: { ...metadata, nextCursor: undefined, items: [] } } }) })
  rerender()
  expect(h.view.getByText(en.noMatchingRecords)).toBeDefined()
  fireEvent.click(h.view.getByRole('button', { name: en.first }))
  expect(h.read).toHaveBeenLastCalledWith({ runId, mode: 'metadata', kind: 'run/created', limit: 2 })
  fireEvent.click(h.view.getByRole('button', { name: en.exportMetadata }))
  expect(h.exportRecords).toHaveBeenLastCalledWith({ runId, mode: 'metadata', kind: 'run/created' })

  const input = h.view.getByLabelText(en.recordKind)
  fireEvent.change(input, { target: { value: 'vendor/custom' } })
  fireEvent.compositionStart(input)
  fireEvent.submit(input.closest('form')!)
  expect(h.navigate).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  fireEvent.submit(input.closest('form')!)
  expect(h.navigate).toHaveBeenCalledTimes(1)
  expect(h.navigate).not.toHaveBeenCalledWith(expect.objectContaining({ recordKind: undefined }))
  fireEvent.change(input, { target: { value: 'run/created' } })
  fireEvent.click(h.view.getByRole('button', { name: en['records.chooseType'] }))
  fireEvent.click(h.view.getByRole('menuitem', { name: en.all }))
  expect((input as HTMLInputElement).value).toBe('')
  fireEvent.submit(input.closest('form')!)
  expect(h.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ recordKind: undefined }))

  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records, value: undefined } }) })
  rerender(undefined)
  expect(h.view.queryByText(en.noMatchingRecords)).toBeNull()

  act(() => { h.state.set({ ...h.state.getSnapshot(), connected: false, observation: { ...h.state.getSnapshot().observation,
    value: undefined } }) })
  rerender(7, undefined)
  h.read.mockClear()
  expect(h.read).not.toHaveBeenCalled()
  expect(h.view.getByRole('button', { name: en.refreshDetail }).hasAttribute('disabled')).toBe(true)
  act(() => { h.state.set({ ...h.state.getSnapshot(), connected: true,
    observation: { ...h.state.getSnapshot().observation,
      value: { runId, readVersion, cursor: 'watch' as never, status: 'changed' as const, observedAt: 1,
        world: { status: 'observed' as const, revision: 4 } } },
    record: { ...h.state.getSnapshot().record, scope: simulationRecordsScope({ runId, mode: 'original', sequence: 7 }),
      value: { ...original, bodyAccess: 'withheld' as const, nextCursor: undefined, items: [{ sequence: 7,
        kind: { text: 'vendor/custom', truncated: false }, body: { status: 'withheld' as const } }] } } }) })
  rerender(7, undefined)
  expect(h.read).toHaveBeenLastCalledWith(originalInput)
  fireEvent.click(h.view.getByRole('button', { name: en.refreshDetail }))
  expect(h.read).toHaveBeenLastCalledWith(originalInput)
  expect(h.view.getAllByText(en.recordWithheld).length).toBeGreaterThan(0)

  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records, value: undefined } }) })
  rerender(7, undefined)
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record, loading: true } }) })
  rerender(7, undefined)
  expect(within(h.view.getByRole('complementary', { name: en.recordOriginal })).queryByText(en.loading)).toBeNull()
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record, loading: false, stale: true } }) })
  rerender(7, undefined)
  expect(within(h.view.getByRole('complementary', { name: en.recordOriginal })).queryByText(en.stale)).toBeNull()
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record,
    stale: false, value: { ...original, items: [] } } }) })
  rerender(7, undefined)
  expect(within(h.view.getByRole('complementary', { name: en.recordOriginal })).getByText(en.detailMissing)).toBeDefined()
  act(() => { h.state.set({ ...h.state.getSnapshot(), record: { ...h.state.getSnapshot().record,
    value: { ...original, nextCursor: undefined, items: [{ sequence: 7, action: { text: 'Restore', truncated: false },
      kind: { text: 'run/created', truncated: false }, body: { status: 'text' as const, text: 'final record', part: 1, parts: 2 } }] } } }) })
  rerender(7, undefined)
  expect(within(h.view.getByRole('complementary', { name: en.recordOriginal })).getByText('final record')).toBeDefined()
  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records,
    value: { ...metadata, nextCursor: undefined } } }) })
  rerender(7)
  const sequenceButton = h.view.getByRole('button', { name: `${en.recordOriginal}: 7` })
  fireEvent.click(sequenceButton)
  rerender(7)
  expect(sequenceButton.getAttribute('aria-current')).toBe('true')
  rerender(undefined)
  const currentRow = h.view.queryByRole('button', { name: `${en.recordOriginal}: 7` })
  expect(document.activeElement).toBe(currentRow ?? h.view.getByLabelText(en.recordKind))
})

it('restores focus to the kind filter when an inspected row leaves the current page', () => {
  const h = setup(7)
  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records,
    value: { ...metadata, items: [], nextCursor: undefined } } }) })
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '' }} data={h.state.getSnapshot()}
    pageSize={2} read={h.read} close={h.close} navigate={h.navigate} exportRecords={h.exportRecords}
    cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  expect(h.view.queryByRole('button', { name: `${en.recordOriginal}: 7` })).toBeNull()
  expect(document.activeElement).toBe(h.view.getByLabelText(en.recordKind))
})

it('shows extension record kinds and absent actions without inventing a built-in label', () => {
  const h = setup(undefined, 'vendor/custom')
  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records,
    value: { ...metadata, items: [{ sequence: 7, kind: { text: 'vendor/custom', truncated: false },
      body: { status: 'withheld' as const } }] } } }) })
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordKind: 'vendor/custom' }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  expect(h.view.getByText('vendor/custom')).toBeDefined()
  expect(h.view.getByText(en.none)).toBeDefined()
  expect(h.view.queryByText(en.truncate)).toBeNull()
  act(() => { h.state.set({ ...h.state.getSnapshot(), records: { ...h.state.getSnapshot().records,
    value: { ...metadata, items: [{ sequence: 7, kind: { text: 'vendor/custom', truncated: true },
      body: { status: 'withheld' as const } }] } } }) })
  h.view.rerender(<RecordsView view={{ runId: 'run', module: 'records', search: '', recordKind: 'vendor/custom' }}
    data={h.state.getSnapshot()} pageSize={2} read={h.read} close={h.close} navigate={h.navigate}
    exportRecords={h.exportRecords} cancelExport={h.cancelExport} useExport={bindSnapshotSelector(h.exportState)} t={key => en[key]} />)
  expect(h.view.getByText(en.truncate)).toBeDefined()
})
