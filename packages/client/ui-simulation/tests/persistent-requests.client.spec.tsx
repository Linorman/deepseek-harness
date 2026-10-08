// @vitest-environment jsdom
/** Cold discovery preserves original identity and does not restore private authoring input. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { SimulationProductRequestsPage, SimulationCommand, SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import { CommandRecord } from '../src/client/CommandRecord.tsx'
import { PersistentRequests } from '../src/client/PersistentRequests.tsx'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'

afterEach(cleanup)
const page: SimulationProductRequestsPage = { runId: 'run' as never, snapshotRevision: 1, total: 1, items: [
  { runId: 'run' as never, commandId: 'original' as never, kind: 'create', acceptedAt: 1, status: 'accepted' },
] }
const selector: SimulationCommand = { kind: 'retry-request', input: { runId: page.runId, commandId: page.items[0]!.commandId } }
const key = simulationCommandKey(selector)
function props() {
  const query = vi.fn(async (_key: string) => undefined), submit = vi.fn(async (_key: string) => undefined)
  return { runId: page.runId, ready: true, connected: true, authorizationVersion: 2, pageSize: 1,
    value: { value: page, loading: false, stale: false }, commands: {}, read: vi.fn(async () => {}),
    refreshRun: vi.fn(async () => {}), retain: vi.fn((_command: SimulationCommand, _version: number) => key),
    submit, query, renderOriginal: (record: SimulationCommandState) => <CommandRecord value={record} connected alwaysQuery
      query={() => query(simulationCommandKey(record.command))} retry={() => submit(simulationCommandKey(record.command))}
      t={key => en[key]} />,
    t: (key: Key) => en[key], date: (time: number) => String(time) }
}

it('discovers after a fresh authorization and queries a cold selector without allocating or executing a new request', async () => {
  const base = props(), view = render(<PersistentRequests {...base} />)
  expect(base.read).not.toHaveBeenCalled()
  expect(base.retain).not.toHaveBeenCalled(); expect(base.submit).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['requests.query'] }))
  await waitFor(() => { expect(base.query).toHaveBeenCalledWith(key) })
  expect(base.retain).toHaveBeenCalledWith(selector, 2)
  expect(base.submit).not.toHaveBeenCalled(); expect(base.refreshRun).not.toHaveBeenCalled()
})

it('uses an already retained full original for an explicit retry and disables unknown/stale-page retry', async () => {
  const base = props()
  const original: SimulationCommandState = { command: { kind: 'create', input: { commandId: page.items[0]!.commandId,
    templateId: 'company' as never, templateVersion: '1', expectedModel: { provider: 'company', name: 'scripted' }, name: 'Private original',
    parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } } },
  pending: false, unknown: true, notFound: false }
  const view = render(<PersistentRequests {...base} commands={{ [key]: original }} />)
  fireEvent.click(view.getByRole('button', { name: en.retryOriginal }))
  await waitFor(() => { expect(base.submit).toHaveBeenCalledWith(key) })
  expect(base.retain).not.toHaveBeenCalled()
  expect(view.queryByText('Private original')).toBeNull()
  view.rerender(<PersistentRequests {...base} value={{ value: page, loading: false, stale: true }} />)
  expect((view.getByRole('button', { name: en['requests.retry'] }) as HTMLButtonElement).disabled).toBe(true)
})

it('does not replace a newly selected run with the result of a retry after this panel leaves', async () => {
  const base = props(), pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const submit = vi.fn(async () => pending.promise)
  const view = render(<PersistentRequests {...base} submit={submit} />)
  fireEvent.click(view.getByRole('button', { name: en['requests.retry'] }))
  view.unmount()
  pending.resolve({ command: selector, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request', value: { ...page.items[0]!, status: 'completed' } } })
  await pending.promise
  await Promise.resolve()
  await Promise.resolve()
  expect(base.refreshRun).not.toHaveBeenCalled(); expect(base.read).not.toHaveBeenCalled()
})

it('contains a late original lookup failure after its request panel leaves', async () => {
  const base = props(), pending = Promise.withResolvers<SimulationCommandState | undefined>()
  const query = vi.fn(() => pending.promise)
  const view = render(<PersistentRequests {...base} query={query} />)
  fireEvent.click(view.getByRole('button', { name: en['requests.query'] }))
  expect(query).toHaveBeenCalledWith(key)
  view.unmount()
  pending.reject(new Error('Late lookup failed'))
  await expect(pending.promise).rejects.toThrow('Late lookup failed')
  await Promise.resolve()
  expect(base.read).not.toHaveBeenCalled()
})

it('keeps terminal original lookup, metadata and failure feedback without offering another retry', () => {
  const base = props(), completed: SimulationProductRequestsPage = { ...page,
    items: [{ ...page.items[0]!, status: 'completed' }] }
  const view = render(<PersistentRequests {...base} value={{ value: completed, loading: false, stale: true, error: 'network' }} />)
  expect(view.getByText('original')).toBeDefined()
  expect(view.getByRole('button', { name: en['requests.query'] })).toBeDefined()
  expect(view.queryByRole('button', { name: en['requests.retry'] })).toBeNull()
  expect(view.getByRole('alert').textContent).toBe(en.network)
})

it('explains a completed journal beside an older receipt and leaves only original lookup available', () => {
  const base = props(), completed: SimulationProductRequestsPage = { ...page, snapshotRevision: 2,
    items: [{ ...page.items[0]!, status: 'completed' }] }
  const record: SimulationCommandState = { command: selector, pending: false, unknown: true, notFound: false,
    receipt: { kind: 'request', value: page.items[0]! }, requestObservation: { runId: page.runId,
      status: 'completed', journalRevision: 2, comparison: 'receipt-older', stale: false } }
  const view = render(<PersistentRequests {...base} value={{ value: completed, loading: false, stale: false }}
    commands={{ [key]: record }} />)
  expect(view.getByText(en['requests.comparison.receipt-older'])).toBeDefined()
  expect(view.queryByText(en.commandUnknown)).toBeNull()
  expect(view.queryByRole('button', { name: en.retryOriginal })).toBeNull()
  expect(view.queryByRole('button', { name: en['requests.retry'] })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(base.query).toHaveBeenCalledWith(key)
  expect(base.submit).not.toHaveBeenCalled()
})

it('exposes a capacity reconciliation problem with lookup and no misleading retry', () => {
  const base = props()
  const record: SimulationCommandState = { command: selector, pending: false, unknown: true, notFound: false,
    receipt: { kind: 'request', value: page.items[0]! }, requestObservationUnavailable: true }
  const view = render(<PersistentRequests {...base} commands={{ [key]: record }} />)
  expect(view.getByText(en['requests.capacity'])).toBeDefined()
  expect(view.queryByRole('button', { name: en.retryOriginal })).toBeNull()
  expect(view.queryByRole('button', { name: en['requests.retry'] })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(base.query).toHaveBeenCalledWith(key)
  expect(base.submit).not.toHaveBeenCalled()
})

it('shows each warm original once and keeps off-page originals independently recoverable', () => {
  const base = props()
  const onPage: SimulationCommandState = { command: selector, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request', value: page.items[0]! } }
  const offPage: SimulationCommandState = { ...onPage, command: { kind: 'retry-request',
    input: { runId: page.runId, commandId: 'off-page' as never } } }
  const renderOriginal = (record: SimulationCommandState) => <button
    onClick={() => { void base.query(simulationCommandKey(record.command)) }}>
    {simulationCommandKey(record.command)}
  </button>
  const view = render(<PersistentRequests {...base} commands={{ [key]: onPage }} originals={[onPage, offPage]}
    renderOriginal={renderOriginal} />)
  expect(view.getAllByRole('button', { name: key })).toHaveLength(1)
  expect(view.queryByRole('button', { name: en['requests.query'] })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: simulationCommandKey(offPage.command) }))
  expect(base.query).toHaveBeenCalledWith(simulationCommandKey(offPage.command))
  expect(base.submit).not.toHaveBeenCalled()
  view.rerender(<PersistentRequests {...base} value={{ value: { ...page, items: [], total: 2 }, loading: false, stale: false }}
    commands={{ [key]: onPage }} originals={[onPage, offPage]} renderOriginal={renderOriginal} />)
  expect(view.getAllByRole('button', { name: key })).toHaveLength(1)
  expect(view.getByRole('region', { name: en['requests.local'] })).toBeDefined()
})

it('renders unresolved ingress and maintenance originals without leaking their private input', () => {
  const query = vi.fn(async () => undefined)
  const ingress: SimulationCommandState = { command: { kind: 'ingress', input: { runId: page.runId,
    ingressId: 'ingress' as never, entityId: 'entity' as never, text: 'PRIVATE INGRESS', availableAt: '2' as never } },
  pending: true, unknown: false, notFound: false, receipt: { kind: 'ingress', value: { runId: page.runId,
    ingressId: 'ingress' as never, entityId: 'entity' as never, eventId: 'event' as never, availableAt: '2' as never,
    assignedAt: '3' as never, sequence: 1, status: 'pending', decisionId: 'decision' as never } } }
  const restore: SimulationCommandState = { command: { kind: 'restore', input: { runId: page.runId,
    commandId: 'restore' as never, checkpointId: 'checkpoint' as never } }, pending: false, unknown: false, notFound: false,
  receipt: { kind: 'request', value: { runId: page.runId, commandId: 'restore' as never, kind: 'restore', acceptedAt: 1,
    status: 'failed', failure: 'recovery-required', checkpointId: 'checkpoint' as never,
    diagnostic: { stage: 'restore', code: 'history-incomplete', subject: { kind: 'run' } } } } }
  const view = render(<>{[ingress, restore].map(record => <CommandRecord key={simulationCommandKey(record.command)}
    value={record} connected query={query} retry={async () => undefined} t={key => en[key]} />)}</>)
  expect(view.getByText(en.commandPending)).toBeDefined()
  expect(view.getByText('decision')).toBeDefined()
  expect(view.getAllByText(`${en.checkpointId}:`)).toHaveLength(2)
  expect(view.container.textContent).not.toContain('PRIVATE INGRESS')
  fireEvent.click(view.getAllByRole('button', { name: en.queryOriginal }).at(-1)!)
  expect(query).toHaveBeenCalledOnce()
})

it('renders empty, loading and stale persistent-request pages distinctly', () => {
  const base = props()
  const empty: SimulationProductRequestsPage = { runId: page.runId, snapshotRevision: 1, total: 0, items: [] }
  const view = render(<PersistentRequests {...base} value={{ value: empty, loading: true, stale: false }} />)
  expect(view.getByRole('status').textContent).toBe(en.loading)
  view.rerender(<PersistentRequests {...base} value={{ value: empty, loading: false, stale: true }} />)
  expect(view.getByText(en.stale)).toBeDefined()
  expect(view.getByText(en['requests.empty'])).toBeDefined()
})

it('paginates to a next page and refreshes with an exact first-page selector', () => {
  const base = props(), read = vi.fn(async () => {})
  const next: SimulationProductRequestsPage = { runId: page.runId, snapshotRevision: 2, total: 2,
    items: page.items, nextCursor: 'next' as never }
  const view = render(<PersistentRequests {...base} value={{ value: next, loading: false, stale: false }} read={read} />)
  fireEvent.click(view.getByRole('button', { name: en.next }))
  expect(read).toHaveBeenLastCalledWith({ runId: page.runId, limit: 1, cursor: 'next', expectedRevision: 2 })
  fireEvent.click(view.getByRole('button', { name: en['requests.refresh'] }))
  expect(read).toHaveBeenLastCalledWith({ runId: page.runId, limit: 1 })
})

it('labels a checkpoint receipt and disables query and retry while disconnected', () => {
  const base = props()
  const checkpoint: SimulationProductRequestsPage = { runId: page.runId, snapshotRevision: 1, total: 1,
    items: [{ runId: page.runId, commandId: 'checkpoint' as never, kind: 'checkpoint', acceptedAt: 1,
      status: 'accepted', checkpointId: 'checkpoint' as never }] }
  const view = render(<PersistentRequests {...base} value={{ value: checkpoint, loading: false, stale: false }} connected={false} />)
  expect(view.getByText(`${en.checkpointId}:`)).toBeDefined()
  expect((view.getByRole('button', { name: en['requests.query'] }) as HTMLButtonElement).disabled).toBe(true)
})

it('ignores a page from a different run and triggers refreshRun only after a retry receipt completes', async () => {
  const base = props()
  const other: SimulationProductRequestsPage = { ...page, runId: 'other' as never }
  const view = render(<PersistentRequests {...base} value={{ value: other, loading: false, stale: false }} />)
  expect(view.queryByText(en['requests.empty'])).toBeNull()
  view.rerender(<PersistentRequests {...base} />)
  const submit = vi.fn(async () => ({ command: selector, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request', value: { ...page.items[0]!, status: 'completed' } } })) as never
  view.rerender(<PersistentRequests {...base} submit={submit} />)
  fireEvent.click(view.getByRole('button', { name: en['requests.retry'] }))
  await waitFor(() => { expect(base.refreshRun).toHaveBeenCalledOnce() })
})

it('reports a command capacity error when retry retain throws', async () => {
  const base = props()
  const view = render(<PersistentRequests {...base} retain={vi.fn(() => { throw new Error('No capacity') })} />)
  fireEvent.click(view.getByRole('button', { name: en['requests.retry'] }))
  await view.findByText(en.commandCapacity)
})
