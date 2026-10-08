// @vitest-environment jsdom
/** Exact cancellation requires current canonical selection and preserves private drafts across uncertain outcomes. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { SimulationProductTasksPage, SimulationCommand, SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import { TaskControls } from '../src/client/TaskControls.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import { taskCancelDraftKey } from '../src/client/store.ts'
import type { SimulationTaskCancelDraft } from '../src/client/store.ts'

afterEach(cleanup)
const page: SimulationProductTasksPage = { runId: 'run' as never, snapshotRevision: 12, observedAt: 1, total: 1,
  items: [{ operationId: 'source' as never, taskId: 'task' as never, teamId: 'team' as never, taskRevision: 4, phase: 'running',
    attemptCount: 1, maxAttempts: 2, expectedAttemptId: 'attempt' as never, cancel: { allowed: true, reason: 'ready' } }] }
const draft: SimulationTaskCancelDraft = { runId: page.runId, operationId: 'source', expectedRevision: 4,
  expectedAttemptId: 'attempt' as never, reason: 'Stop this attempt' }
const key = taskCancelDraftKey(draft)

it.each([en, zh])('requires explicit current-task cancellation and retains the original across later reason edits', async (locale) => {
  let original: SimulationCommand | undefined
  const retained = vi.fn((command: SimulationCommand) => { original = command; return simulationCommandKey(command) })
  const sends: SimulationCommand[] = []
  function Harness() {
    const [drafts, update] = useState<Record<string, SimulationTaskCancelDraft>>({ [key]: draft })
    const [target, select] = useState<typeof draft | undefined>(draft)
    const [commands, records] = useState<Record<string, SimulationCommandState>>({})
    const submit = async () => {
      if (original === undefined) throw new Error('Original cancellation is missing')
      sends.push(original)
      const record: SimulationCommandState = { command: original, pending: false, unknown: true, notFound: false, error: 'network' }
      records({ [simulationCommandKey(original)]: record }); return record
    }
    return <TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
      value={{ value: page, loading: false, stale: false }} read={async () => {}} drafts={drafts} target={target}
      change={(key, value) => { update((current) => {
        const { [key]: _old, ...next } = current
        return value === undefined ? next : { ...next, [key]: value }
      }) }} select={(value) => { select(value === undefined ? undefined : { ...draft, ...value }) }} commands={commands}
      retain={retained} submit={submit} query={async () => undefined} t={(key: Key) => locale[key]} />
  }
  const view = render(<Harness />), dialog = within(view.getByRole('dialog', { name: locale['taskControl.open'] }))
  expect(retained).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: locale['taskControl.confirm'] }))
  await dialog.findByText(locale['commandError.network'])
  expect(original).toMatchObject({ kind: 'cancel-task', input: { runId: page.runId, operationId: 'source',
    expectedRevision: 4, expectedAttemptId: 'attempt', reason: draft.reason } })
  fireEvent.change(dialog.getByLabelText(locale['taskControl.reason']), { target: { value: 'Later reason' } })
  fireEvent.click(dialog.getByRole('button', { name: locale.retryOriginal }))
  await waitFor(() => { expect(sends).toHaveLength(2) })
  expect(sends[1]).toBe(sends[0]); expect(retained).toHaveBeenCalledOnce()
  expect(dialog.getByLabelText<HTMLTextAreaElement>(locale['taskControl.reason']).value).toBe('Later reason')
})

it('preserves a stale task fence until explicit current-revision confirmation and refuses draft capacity before retain', async () => {
  const retain = vi.fn(() => 'key' as never), change = vi.fn()
  const base = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 1,
    value: { value: page, loading: false, stale: false }, read: async () => {}, drafts: { [key]: { ...draft, expectedRevision: 3 } },
    target: draft, change, select: vi.fn(), commands: {}, retain, submit: async () => undefined,
    query: async () => undefined, t: (key: Key) => en[key] }
  const view = render(<TaskControls {...base} />), dialog = within(view.getByRole('dialog', { name: en['taskControl.open'] }))
  expect(dialog.getByRole<HTMLButtonElement>('button', { name: en['taskControl.confirm'] }).disabled).toBe(true)
  fireEvent.click(dialog.getByRole('button', { name: en['taskControl.confirmFence'] }))
  expect(change).toHaveBeenCalledWith(key, expect.objectContaining({ expectedRevision: 4, expectedAttemptId: 'attempt' }))
  const refused = vi.fn(() => { throw new Error('No capacity') })
  view.rerender(<TaskControls {...base} drafts={{ [key]: draft }} change={refused} />)
  fireEvent.click(dialog.getByRole('button', { name: en['taskControl.confirm'] }))
  await dialog.findByText(en.commandCapacity)
  expect(retain).not.toHaveBeenCalled()
})

it('treats null as an exact lease-free fence and does not allow IME composition to submit', () => {
  const retain = vi.fn(() => 'key' as never)
  const leaseFree = { ...draft, expectedAttemptId: null }, value = { ...page,
    items: [{ ...page.items[0]!, phase: 'review' as const, expectedAttemptId: null }] }
  const view = render(<TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
    value={{ value, loading: false, stale: false }} read={async () => {}} drafts={{ [key]: leaseFree }} target={leaseFree}
    change={vi.fn()} select={vi.fn()} commands={{}} retain={retain} submit={async () => undefined}
    query={async () => undefined} t={(key: Key) => en[key]} />)
  const dialog = within(view.getByRole('dialog', { name: en['taskControl.open'] }))
  expect(dialog.getByText(en['taskControl.noLease'], { exact: false })).toBeDefined()
  fireEvent.compositionStart(dialog.getByLabelText(en['taskControl.reason']))
  fireEvent.click(dialog.getByRole('button', { name: en['taskControl.confirm'] }))
  expect(retain).not.toHaveBeenCalled()
  fireEvent.compositionEnd(dialog.getByLabelText(en['taskControl.reason']))
})

it('discards an unneeded cancellation draft explicitly and closes it', () => {
  const change = vi.fn(), select = vi.fn()
  const view = render(<TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
    value={{ value: page, loading: false, stale: false }} read={async () => {}} drafts={{ [key]: draft }} target={draft}
    change={change} select={select} commands={{}} retain={vi.fn(() => 'key' as never)} submit={async () => undefined}
    query={async () => undefined} t={(text: Key) => en[text]} />)
  const dialog = within(view.getByRole('dialog', { name: en['taskControl.open'] }))
  fireEvent.click(dialog.getAllByRole('button', { name: en.discardDraft })[0]!)
  fireEvent.click(within(view.getByRole('dialog', { name: en.discardDraft })).getAllByRole('button', { name: en.keepEditing })[1]!)
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(dialog.getAllByRole('button', { name: en.discardDraft })[0]!)
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft }).at(-1)!)
  expect(change).toHaveBeenCalledWith(key, undefined)
  expect(select).toHaveBeenCalledWith(undefined)
})


it('reports retain capacity failure before submission and shows pending cancellation state', async () => {
  const view = render(<TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
    value={{ value: { ...page, items: [{ ...page.items[0]!, cancellation: { requestedAt: 1, target: 'pending' } }] },
      loading: false, stale: false } } read={async () => {}} drafts={{ [key]: draft }} target={draft} commands={{}}
    change={vi.fn()} select={vi.fn()} retain={vi.fn(() => { throw new Error('No capacity') })}
    submit={async () => undefined} query={async () => undefined} t={(text: Key) => en[text]} />)
  expect(view.getByText(en['taskControl.cancelPending'])).toBeDefined()
  fireEvent.click(view.getByRole('button', { name: en['taskControl.open'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['taskControl.open'] })).getByRole('button', { name: en['taskControl.confirm'] }))
  await view.findByText(en.commandCapacity)
})

it('reads an exact continuation and creates or reopens only the selected cancellation draft', () => {
  const read = vi.fn(async () => {})
  const change = vi.fn()
  const select = vi.fn()
  const nextPage = { ...page, nextCursor: 'next-tasks' as never }
  const base = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 1,
    value: { value: nextPage, loading: false, stale: false }, read, target: undefined, change, select,
    commands: {}, retain: vi.fn(() => 'key' as never), submit: async () => undefined,
    query: async () => undefined, t: (text: Key) => en[text] }
  const view = render(<TaskControls {...base} drafts={{}} />)
  fireEvent.click(view.getByRole('button', { name: en.next }))
  expect(read).toHaveBeenLastCalledWith({ runId: page.runId, limit: 1, cursor: 'next-tasks', expectedRevision: 12 })
  fireEvent.click(view.getByRole('button', { name: en['taskControl.refresh'] }))
  expect(read).toHaveBeenLastCalledWith({ runId: page.runId, limit: 1 })
  fireEvent.click(view.getByRole('button', { name: en['taskControl.open'] }))
  expect(change).toHaveBeenCalledWith(key, { runId: page.runId, operationId: 'source', expectedRevision: 4,
    expectedAttemptId: 'attempt', reason: '' })
  expect(select).toHaveBeenCalledWith({ runId: page.runId, operationId: 'source' })
  view.rerender(<TaskControls {...base} drafts={{ [key]: draft }} />)
  fireEvent.click(view.getByRole('button', { name: `${en['taskControl.openDraft']} · source` }))
  expect(select).toHaveBeenLastCalledWith(draft)
})

it('reports a draft storage failure without opening a cancellation form', () => {
  const select = vi.fn()
  const view = render(<TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
    value={{ value: page, loading: false, stale: false }} read={async () => {}} drafts={{}}
    change={() => { throw new Error('Draft storage full') }} select={select} commands={{}}
    retain={vi.fn(() => 'key' as never)} submit={async () => undefined} query={async () => undefined}
    t={(text: Key) => en[text]} />)
  fireEvent.click(view.getByRole('button', { name: en['taskControl.open'] }))
  expect(view.getByRole('alert').textContent).toBe(en.commandCapacity)
  expect(select).not.toHaveBeenCalled()
})

it('clears a matching draft only after the original cancellation receipt is completed', async () => {
  const command: SimulationCommand = { kind: 'cancel-task', input: { runId: page.runId, commandId: 'original' as never,
    operationId: 'source' as never, expectedRevision: 4, expectedAttemptId: 'attempt' as never, reason: draft.reason } }
  const retained: SimulationTaskCancelDraft = { ...draft, commandKey: 'original' as never,
    submitted: { reason: draft.reason, expectedRevision: 4, expectedAttemptId: 'attempt' as never } }
  const record: SimulationCommandState = { command, pending: false, unknown: true, notFound: false }
  const completed: SimulationCommandState = { ...record, unknown: false, receipt: { kind: 'request', value: {
    runId: page.runId, commandId: 'original' as never, kind: 'cancel-task', acceptedAt: 1, status: 'completed',
  } } }
  const change = vi.fn(), select = vi.fn(), query = vi.fn(async () => completed), read = vi.fn(async () => {})
  const view = render(<TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
    value={{ value: page, loading: false, stale: false }} read={read} drafts={{ [key]: retained }} target={retained}
    change={change} select={select} commands={{ original: record }} retain={vi.fn(() => 'new' as never)}
    submit={async () => undefined} query={query} t={(text: Key) => en[text]} />)
  fireEvent.click(within(view.getByRole('dialog', { name: en['taskControl.open'] })).getByRole('button', { name: en['taskControl.refresh'] }))
  expect(read).toHaveBeenLastCalledWith({ runId: page.runId, limit: 1 })
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  await waitFor(() => { expect(change).toHaveBeenCalledWith(key, undefined) })
  expect(select).toHaveBeenCalledWith(undefined)
  expect(query).toHaveBeenCalledWith('original')
})

it('keeps a failed original cancellation disabled until its reason changes', () => {
  const command: SimulationCommand = { kind: 'cancel-task', input: { runId: page.runId, commandId: 'original' as never,
    operationId: 'source' as never, expectedRevision: 4, expectedAttemptId: 'attempt' as never, reason: draft.reason } }
  const failed: SimulationCommandState = { command, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request', value: { runId: page.runId, commandId: 'original' as never,
      kind: 'cancel-task', acceptedAt: 1, status: 'failed', failure: 'cancel-task-failed' } } }
  const base = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 1,
    value: { value: page, loading: false, stale: false }, read: async () => {}, target: draft,
    change: vi.fn(), select: vi.fn(), commands: { original: failed }, retain: vi.fn(() => 'new' as never),
    submit: async () => undefined, query: async () => undefined, t: (text: Key) => en[text] }
  const selected = { ...draft, commandKey: 'original' as never }
  const view = render(<TaskControls {...base} drafts={{ [key]: selected }} />)
  const confirm = within(view.getByRole('dialog', { name: en['taskControl.open'] }))
    .getByRole<HTMLButtonElement>('button', { name: en['taskControl.confirm'] })
  expect(confirm.disabled).toBe(true)
  view.rerender(<TaskControls {...base} drafts={{ [key]: { ...selected, reason: 'Changed reason' } }} />)
  expect(confirm.disabled).toBe(false)
})

it('stops applying a late query result after the cancellation dialog is closed', async () => {
  const command: SimulationCommand = { kind: 'cancel-task', input: { runId: page.runId, commandId: 'original' as never,
    operationId: 'source' as never, expectedRevision: 4, expectedAttemptId: 'attempt' as never, reason: draft.reason } }
  const record: SimulationCommandState = { command, pending: false, unknown: true, notFound: false }
  const completed: SimulationCommandState = { ...record, unknown: false, receipt: { kind: 'request', value: {
    runId: page.runId, commandId: 'original' as never, kind: 'cancel-task', acceptedAt: 1, status: 'completed',
  } } }
  const answer = Promise.withResolvers<SimulationCommandState>()
  const query = vi.fn(() => answer.promise), change = vi.fn(), select = vi.fn(), read = vi.fn(async () => {})
  const selected: SimulationTaskCancelDraft = { ...draft, commandKey: 'original' as never,
    submitted: { reason: draft.reason, expectedRevision: 4, expectedAttemptId: 'attempt' as never } }
  const base = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 1,
    value: { value: page, loading: false, stale: false }, read, drafts: { [key]: selected }, change, select,
    commands: { original: record }, retain: vi.fn(() => 'new' as never), submit: async () => undefined,
    query, t: (text: Key) => en[text] }
  const view = render(<TaskControls {...base} target={selected} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledOnce()
  view.rerender(<TaskControls {...base} target={undefined} />)
  await act(async () => { answer.resolve(completed); await answer.promise })
  expect(change).not.toHaveBeenCalled()
  expect(select).not.toHaveBeenCalled()
})

it('keeps a revised cancellation draft when an older original completes', async () => {
  const command: SimulationCommand = { kind: 'cancel-task', input: { runId: page.runId, commandId: 'original' as never,
    operationId: 'source' as never, expectedRevision: 4, expectedAttemptId: 'attempt' as never, reason: draft.reason } }
  const record: SimulationCommandState = { command, pending: false, unknown: true, notFound: false }
  const completed: SimulationCommandState = { ...record, unknown: false, receipt: { kind: 'request', value: {
    runId: page.runId, commandId: 'original' as never, kind: 'cancel-task', acceptedAt: 1, status: 'completed',
  } } }
  const answer = Promise.withResolvers<SimulationCommandState>()
  const change = vi.fn(), select = vi.fn(), query = vi.fn(() => answer.promise)
  const selected: SimulationTaskCancelDraft = { ...draft, commandKey: 'original' as never,
    submitted: { reason: draft.reason, expectedRevision: 4, expectedAttemptId: 'attempt' as never } }
  const base = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 1,
    value: { value: page, loading: false, stale: false }, read: vi.fn(async () => {}), change, select,
    commands: { original: record }, retain: vi.fn(() => 'new' as never), submit: async () => undefined,
    query, t: (text: Key) => en[text] }
  const view = render(<TaskControls {...base} drafts={{ [key]: selected }} target={selected} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  const revised = { ...selected, reason: 'Changed after querying' }
  view.rerender(<TaskControls {...base} drafts={{ [key]: revised }} target={revised} />)
  await act(async () => { answer.resolve(completed); await answer.promise })
  expect(change).not.toHaveBeenCalledWith(key, undefined)
  expect(select).not.toHaveBeenCalledWith(undefined)
  expect(base.read).toHaveBeenCalledTimes(2)
})

it('retains the current draft when a textarea edit exceeds storage capacity', () => {
  const change = vi.fn(() => { throw new Error('Draft storage full') })
  const view = render(<TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
    value={{ value: page, loading: false, stale: false }} read={async () => {}} drafts={{ [key]: draft }} target={draft}
    change={change} select={vi.fn()} commands={{}} retain={vi.fn(() => 'new' as never)} submit={async () => undefined}
    query={async () => undefined} t={(text: Key) => en[text]} />)
  const dialog = within(view.getByRole('dialog', { name: en['taskControl.open'] }))
  fireEvent.change(dialog.getByLabelText(en['taskControl.reason']), { target: { value: 'Changed text' } })
  expect(dialog.getByRole('alert').textContent).toBe(en.commandCapacity)
  expect(dialog.getByLabelText<HTMLTextAreaElement>(en['taskControl.reason']).value).toBe(draft.reason)
})

it('shows loading, stale and empty task pages without exposing an active cancellation', () => {
  const empty = { ...page, total: 0, items: [] }
  const base = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 1,
    read: async () => {}, drafts: {}, target: undefined, change: vi.fn(), select: vi.fn(), commands: {},
    retain: vi.fn(() => 'new' as never), submit: async () => undefined,
    query: async () => undefined, t: (text: Key) => en[text] }
  const view = render(<TaskControls {...base} value={{ value: empty, loading: true, stale: true }} />)
  expect(view.getByText(en.loading)).toBeDefined()
  expect(view.getByText(en.stale)).toBeDefined()
  expect(view.queryByText(en['taskControl.empty'])).toBeNull()
  view.rerender(<TaskControls {...base} value={{ value: empty, loading: false, stale: false }} />)
  expect(view.getByText(en['taskControl.empty'])).toBeDefined()
  expect(view.getByRole('region', { name: en['taskControl.title'] }).getAttribute('data-empty')).toBe('true')
})

it('explains a blocked cancellation with current stale data and a terminal Host reason', () => {
  const denied = { ...page, items: [{ ...page.items[0]!, cancel: { allowed: false, reason: 'terminal' as const } }] }
  const view = render(<TaskControls runId={page.runId} ready connected authorizationVersion={1} pageSize={1}
    value={{ value: denied, loading: false, stale: true }} read={async () => {}} drafts={{ [key]: draft }} target={draft}
    change={vi.fn()} select={vi.fn()} commands={{}} retain={vi.fn(() => 'new' as never)}
    submit={async () => undefined} query={async () => undefined} t={(text: Key) => en[text]} />)
  const dialog = within(view.getByRole('dialog', { name: en['taskControl.open'] }))
  expect(dialog.getByText(en['reviews.stale'])).toBeDefined()
  expect(dialog.getByText(en['taskControl.reason.terminal'])).toBeDefined()
  expect(dialog.getByRole<HTMLButtonElement>('button', { name: en['taskControl.confirm'] }).disabled).toBe(true)
})
