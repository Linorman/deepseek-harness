// @vitest-environment jsdom
/** Review UI preserves exact original intent and later authored text across uncertain receipts and stale attempts. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { TaskReviews } from '../src/client/TaskReviews.tsx'
import { reviewDraftKey } from '../src/client/store.ts'
import type { SimulationReviewDraft, SimulationReviewTarget } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import type { Key } from '../src/client/locales.ts'
import type { SimulationProductTaskReviewPage, SimulationCommand, SimulationCommandState } from '@clocky/clocky-client-runtime/client'

const page: SimulationProductTaskReviewPage = { runId: 'run' as never, snapshotRevision: 5, observedAt: 1, total: 1,
  items: [{ operationId: 'operation' as never, teamId: 'team' as never, taskId: 'task' as never, attemptId: 'attempt' as never,
    taskRevision: 2, reviewerEntityId: 'buyer' as never, phase: 'review', attemptCount: 1, maxAttempts: 2,
    action: { allowed: true, reason: 'ready' }, evidence: { inventoryTransfer: { operationId: 'transfer' as never, status: 'applied',
      quantity: '1' }, report: { operationId: 'report' as never, delivery: 'persisted' } } }] }
const t = (key: Key) => en[key]
afterEach(cleanup)

it.each([['Original reason', 'Later reason'], ['  Original reason  ', '  Original reason   ']])(
  'queries and retries normalized originals while preserving later raw input (%s)', async (rawReason, laterReason) => {
    let original: SimulationCommand | undefined
    const retain = vi.fn((command: SimulationCommand) => { original = structuredClone(command); return 'original' as never })
    const submit = vi.fn(), query = vi.fn()
    function Harness() {
      const [drafts, setDrafts] = useState<Record<string, SimulationReviewDraft>>({})
      const [target, select] = useState<SimulationReviewTarget>()
      const [commands, setCommands] = useState<Record<string, SimulationCommandState>>({})
      const uncertain = () => {
        if (original === undefined) throw new Error('Review original missing')
        const record = { command: original, unknown: true, pending: false, notFound: false, error: 'network' as const }
        setCommands({ original: record }); return record
      }
      submit.mockImplementation(async () => uncertain())
      query.mockImplementation(async () => {
        if (original?.kind !== 'review') throw new Error('Review original missing')
        const record: SimulationCommandState = { command: original, unknown: false, pending: false, notFound: false,
          receipt: { kind: 'request', value: { runId: page.runId, commandId: original.input.commandId,
            kind: 'review', acceptedAt: 1, status: 'completed' } } }
        setCommands({ original: record }); return record
      })
      return <TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
        value={{ value: page, loading: false, stale: false }} read={async () => {}} drafts={drafts} target={target} select={select}
        change={(key, value) => { setDrafts((current) => {
          const { [key]: _removed, ...retained } = current
          return value === undefined ? retained : { ...retained, [key]: value }
        }) }} commands={commands} retain={retain} submit={submit} query={query} t={t} />
    }
    const view = render(<Harness />)
    fireEvent.click(view.getByRole('button', { name: en['reviews.open'] }))
    let dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
    fireEvent.change(dialog.getByLabelText(en['reviews.reason']), { target: { value: rawReason } })
    fireEvent.click(dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1)!)
    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
    expect(original).toMatchObject({ kind: 'review', input: { operationId: 'operation', attemptId: 'attempt', expectedRevision: 2,
      reason: 'Original reason', nextPhase: 'completed' } })
    fireEvent.change(dialog.getByLabelText(en['reviews.reason']), { target: { value: laterReason } })
    fireEvent.click(dialog.getByRole('button', { name: en.closeKeepDraft }))
    fireEvent.click(view.getByRole('button', { name: /Open review draft/ }))
    dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
    expect((dialog.getByLabelText<HTMLTextAreaElement>(en['reviews.reason'])).value).toBe(laterReason)
    fireEvent.click(dialog.getByRole('button', { name: en.retryOriginal }))
    await waitFor(() => { expect(submit).toHaveBeenCalledTimes(2) })
    expect(retain).toHaveBeenCalledOnce()
    fireEvent.click(dialog.getByRole('button', { name: en.queryOriginal }))
    await waitFor(() => { expect(query).toHaveBeenCalledOnce() })
    expect((dialog.getByLabelText<HTMLTextAreaElement>(en['reviews.reason'])).value).toBe(laterReason)
    expect(original?.kind === 'review' && original.input.reason).toBe('Original reason')
  })

it('keeps a changed or replacement attempt read-only until the original target is explicitly checked', () => {
  const original = { runId: page.runId, operationId: 'operation', attemptId: 'attempt', expectedRevision: 1,
    reason: 'Retained reason', nextPhase: 'pending' as const }
  const retain = vi.fn(() => 'key' as never), change = vi.fn()
  const props = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 2,
    drafts: { [reviewDraftKey(original)]: original }, target: original, select: vi.fn(), change,
    commands: {}, retain, submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), read: vi.fn(async () => {}), t }
  const view = render(<TaskReviews {...props} value={{ value: page, loading: false, stale: false }} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  expect((dialog.getAllByRole('button', { name: en['reviews.rework'] }).at(-1) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(dialog.getByRole('button', { name: en['reviews.confirmRevision'] }))
  expect(change).toHaveBeenCalledWith(reviewDraftKey(original), { ...original, expectedRevision: 2, commandKey: undefined })
  view.rerender(<TaskReviews {...props} value={{ value: { ...page, items: [{ ...page.items[0]!, attemptId: 'replacement' as never }] },
    loading: false, stale: false }} />)
  expect(dialog.getByText(en['reviews.targetUnavailable'])).toBeDefined()
  expect(dialog.queryByRole('button', { name: en['reviews.confirmRevision'] })).toBeNull()
  expect(retain).not.toHaveBeenCalled()
})

it('requires a semantic change after terminal refusal and keeps original lookup available on stale pages', () => {
  const command: SimulationCommand = { kind: 'review', input: { runId: page.runId, commandId: 'failed' as never,
    operationId: page.items[0]!.operationId, attemptId: page.items[0]!.attemptId, expectedRevision: 2,
    nextPhase: 'completed', reason: 'Original reason' } }
  const draft = { runId: page.runId, operationId: 'operation', attemptId: 'attempt', expectedRevision: 2,
    reason: '  Original reason  ', nextPhase: 'completed' as const, commandKey: 'failed' as never }
  const record: SimulationCommandState = { command, pending: false, unknown: false, notFound: false,
    receipt: { kind: 'request', value: { runId: page.runId, commandId: 'failed' as never, kind: 'review',
      acceptedAt: 1, status: 'failed', failure: 'review-failed' } } }
  const query = vi.fn(async () => record)
  const props = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 2,
    drafts: { [reviewDraftKey(draft)]: draft }, target: draft, select: vi.fn(), change: vi.fn(), commands: { failed: record },
    retain: vi.fn(() => 'new' as never), submit: vi.fn(async () => undefined), query, read: vi.fn(async () => {}), t }
  const view = render(<TaskReviews {...props} value={{ value: page, loading: false, stale: false }} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  expect(dialog.getByText(en['reviews.failedSameIntent'])).toBeDefined()
  expect((dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1) as HTMLButtonElement).disabled).toBe(true)
  const changed = { ...draft, reason: 'Corrected original reason' }
  view.rerender(<TaskReviews {...props} drafts={{ [reviewDraftKey(draft)]: changed }}
    value={{ value: page, loading: false, stale: false }} />)
  expect((dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1) as HTMLButtonElement).disabled).toBe(false)
  view.rerender(<TaskReviews {...props} drafts={{ [reviewDraftKey(draft)]: changed }} value={{ value: page, loading: false, stale: true,
    error: 'stale' }} />)
  expect((dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(dialog.getByRole('button', { name: en.queryOriginal }))
  expect(query).toHaveBeenCalledWith('failed')
  expect(props.retain).not.toHaveBeenCalled()
})

it('does not erase a reopened draft when the closed dialog receives a late completed query', async () => {
  const row = page.items[0]!
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: row.operationId, attemptId: row.attemptId,
    expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Original', commandKey: 'original' as never,
    submitted: { reason: 'Original', nextPhase: 'completed', expectedRevision: row.taskRevision } }
  const command: SimulationCommand = { kind: 'review', input: { runId: page.runId, commandId: 'command' as never,
    operationId: row.operationId, attemptId: row.attemptId, expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Original' } }
  const record: SimulationCommandState = { command, pending: false, unknown: true, notFound: false }
  const pending = Promise.withResolvers<SimulationCommandState | undefined>()
  let currentDraft: SimulationReviewDraft | undefined = draft
  const change = vi.fn((_key: string, value?: SimulationReviewDraft) => { currentDraft = value })
  const read = vi.fn(async () => {})
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value: page, loading: false, stale: false }} read={read} drafts={{ [reviewDraftKey(draft)]: draft }} target={draft}
    select={() => {}} change={change} commands={{ original: record }} retain={() => 'original' as never}
    submit={async () => undefined} query={() => pending.promise} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  view.unmount()
  currentDraft = { ...draft, reason: 'Input changed after reopening' }
  read.mockClear(); change.mockClear()
  pending.resolve({ ...record, unknown: false, receipt: { kind: 'request', value: {
    commandId: 'command' as never, runId: page.runId, kind: 'review', acceptedAt: 1, status: 'completed' } } })
  await pending.promise
  expect(currentDraft.reason).toBe('Input changed after reopening')
  expect(change).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})

it('discards a stale review draft explicitly and closes the dialog', () => {
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: 'operation', attemptId: 'attempt',
    expectedRevision: 2, nextPhase: 'completed', reason: 'Private review reason' }
  const change = vi.fn(), select = vi.fn()
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value: page, loading: false, stale: false }} read={vi.fn(async () => {})}
    drafts={{ [reviewDraftKey(draft)]: draft }} target={draft} select={select} change={change} commands={{}}
    retain={vi.fn(() => 'original' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  fireEvent.click(dialog.getAllByRole('button', { name: en.discardDraft })[0]!)
  fireEvent.click(view.getAllByRole('button', { name: en.discardDraft }).at(-1)!)
  expect(change).toHaveBeenCalledWith(reviewDraftKey(draft), undefined)
  expect(select).toHaveBeenCalledWith(undefined)
})

it('confirms the current task revision before allowing a fresh original review', () => {
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: 'operation', attemptId: 'attempt',
    expectedRevision: 1, nextPhase: 'completed', reason: 'Private review reason' }
  const change = vi.fn()
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value: page, loading: false, stale: false }} read={vi.fn(async () => {})}
    drafts={{ [reviewDraftKey(draft)]: draft }} target={draft} select={vi.fn()} change={change} commands={{}}
    retain={vi.fn(() => 'original' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  expect(dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1)!.hasAttribute('disabled')).toBe(true)
  fireEvent.click(dialog.getByRole('button', { name: en['reviews.confirmRevision'] }))
  expect(change).toHaveBeenCalledWith(reviewDraftKey(draft), expect.objectContaining({ expectedRevision: 2, commandKey: undefined }))
})

it('keeps bounded paging usable when retaining a selected review draft exceeds capacity', async () => {
  const read = vi.fn(async () => {})
  const select = vi.fn()
  const value = { ...page, nextCursor: 'next' as never, items: [{ ...page.items[0]!, evidence: undefined }] }
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value, loading: false, stale: false }} read={read} drafts={{}} select={select}
    change={() => { throw new Error('Draft quota reached') }} commands={{}}
    retain={() => 'original' as never} submit={async () => undefined} query={async () => undefined} t={t} />)
  expect(view.getByText(en['reviews.noEvidence'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['reviews.open'] }))
  expect(view.getByRole('alert').textContent).toBe(en.commandCapacity)
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en.next }))
  await waitFor(() => { expect(read).toHaveBeenLastCalledWith({ runId: page.runId,
    cursor: 'next', expectedRevision: page.snapshotRevision, limit: 2 }) })
})

it('finds a retained original without a local command key and keeps later review choices editable', async () => {
  const row = page.items[0]!
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: row.operationId,
    attemptId: row.attemptId, expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Later reason' }
  const originalInput = { runId: page.runId,
    commandId: 'original' as never, operationId: row.operationId, attemptId: row.attemptId,
    expectedRevision: row.taskRevision, nextPhase: 'completed' as const, reason: 'Original reason' }
  const original: SimulationCommandState = { command: { kind: 'review', input: originalInput },
    pending: false, unknown: true, notFound: false }
  const unrelated: SimulationCommandState = { command: { kind: 'review', input: { ...originalInput,
    operationId: 'another-operation' as never } }, pending: false, unknown: true, notFound: false }
  const change = vi.fn(), read = vi.fn(async () => {}), select = vi.fn()
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value: page, loading: false, stale: false }} read={read}
    drafts={{ [reviewDraftKey(draft)]: draft }} target={draft} select={select} change={change}
    commands={{ unrelated, original }} retain={() => 'new' as never}
    submit={async () => undefined} query={async () => undefined} t={t} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  expect(dialog.getByText(`${en['reviews.originalReason']}: Original reason`)).toBeTruthy()
  fireEvent.click(dialog.getByRole('button', { name: en['reviews.rework'] }))
  expect(change).toHaveBeenCalledWith(reviewDraftKey(draft), { ...draft, nextPhase: 'pending' })
  fireEvent.click(dialog.getByRole('button', { name: en['reviews.refresh'] }))
  await waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
  fireEvent.click(dialog.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(view.getAllByRole('button', { name: en.closeKeepDraft }).at(-1)!)
  expect(change).not.toHaveBeenCalledWith(reviewDraftKey(draft), undefined)
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: en.discardDraft }))
  fireEvent.click(within(view.getByRole('dialog', { name: en.discardDraft }))
    .getAllByRole('button', { name: en.closeKeepDraft })[0]!)
  expect(view.queryByRole('dialog', { name: en.discardDraft })).toBeNull()
})

it('lets the reviewer switch to approval and reports command capacity without losing the draft', async () => {
  const row = page.items[0]!
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: row.operationId,
    attemptId: row.attemptId, expectedRevision: row.taskRevision, nextPhase: 'pending', reason: 'Verified evidence' }
  const change = vi.fn()
  const retain = vi.fn(() => { throw new Error('No command capacity') })
  const props = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 2,
    value: { value: page, loading: false, stale: false }, read: vi.fn(async () => {}),
    drafts: { [reviewDraftKey(draft)]: draft }, target: draft, select: vi.fn(), change, commands: {},
    retain, submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), t }
  const view = render(<TaskReviews {...props} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  fireEvent.click(dialog.getAllByRole('button', { name: en['reviews.approve'] })[0]!)
  expect(change).toHaveBeenCalledWith(reviewDraftKey(draft), { ...draft, nextPhase: 'completed' })
  view.rerender(<TaskReviews {...props} drafts={{ [reviewDraftKey(draft)]: { ...draft, nextPhase: 'completed' } }} />)
  fireEvent.click(dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1)!)
  await waitFor(() => { expect(dialog.getByRole('alert').textContent).toBe(en.commandCapacity) })
  expect(retain).toHaveBeenCalledOnce()
  expect(props.select).not.toHaveBeenCalled()
})

it('closes an unchanged completed review only after checking its exact original receipt', async () => {
  const row = page.items[0]!
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: row.operationId, attemptId: row.attemptId,
    expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Verified', commandKey: 'original' as never,
    submitted: { reason: 'Verified', nextPhase: 'completed', expectedRevision: row.taskRevision } }
  const record: SimulationCommandState = { command: { kind: 'review', input: { runId: page.runId,
    commandId: 'command' as never, operationId: row.operationId, attemptId: row.attemptId,
    expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Verified' } },
  pending: false, unknown: false, notFound: false,
  receipt: { kind: 'request', value: { runId: page.runId, commandId: 'command' as never,
    kind: 'review', acceptedAt: 1, status: 'completed' } } }
  const change = vi.fn(), select = vi.fn(), read = vi.fn(async () => {}), query = vi.fn(async () => record)
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value: page, loading: false, stale: false }} read={read}
    drafts={{ [reviewDraftKey(draft)]: draft }} target={draft} select={select} change={change}
    commands={{ original: record }} retain={() => 'new' as never}
    submit={async () => undefined} query={query} t={t} />)
  fireEvent.click(view.getByRole('button', { name: en.queryOriginal }))
  await waitFor(() => { expect(query).toHaveBeenCalledExactlyOnceWith('original') })
  expect(change).toHaveBeenCalledExactlyOnceWith(reviewDraftKey(draft), undefined)
  expect(select).toHaveBeenCalledExactlyOnceWith(undefined)
})

it('separates pending and empty review pages from a denied exact attempt', () => {
  const props = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 2,
    read: vi.fn(async () => {}), drafts: {}, select: vi.fn(), change: vi.fn(), commands: {},
    retain: vi.fn(() => 'key' as never), submit: vi.fn(async () => undefined), query: vi.fn(async () => undefined), t }
  const view = render(<TaskReviews {...props} value={{ loading: true, stale: false }} />)
  expect(view.getByRole('status').textContent).toBe(en.loading)
  view.rerender(<TaskReviews {...props} value={{ value: { ...page, items: [], total: 0 }, loading: false, stale: false }} />)
  expect(view.getByText(en['reviews.empty'])).toBeTruthy()
  const row = { ...page.items[0]!, action: { allowed: false, reason: 'recovery-required' as const } }
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: row.operationId, attemptId: row.attemptId,
    expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Evidence' }
  view.rerender(<TaskReviews {...props} value={{ value: { ...page, items: [row] }, loading: false, stale: false }}
    drafts={{ [reviewDraftKey(draft)]: draft }} target={draft} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  expect(dialog.getByText(en['reviews.reason.recovery-required'])).toBeTruthy()
  expect(dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1)!.hasAttribute('disabled')).toBe(true)
})

it('admits only one review command across repeated clicks before its first receipt settles', async () => {
  const row = page.items[0]!
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: row.operationId, attemptId: row.attemptId,
    expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Verified' }
  let complete!: (value: SimulationCommandState | undefined) => void
  const submit = vi.fn(() => new Promise<SimulationCommandState | undefined>((resolve) => { complete = resolve }))
  const retain = vi.fn(() => 'original' as never)
  const read = vi.fn(async () => {})
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value: page, loading: false, stale: false }} read={read}
    drafts={{ [reviewDraftKey(draft)]: draft }} target={draft} select={vi.fn()} change={vi.fn()}
    commands={{}} retain={retain} submit={submit} query={vi.fn(async () => undefined)} t={t} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  const approve = dialog.getAllByRole('button', { name: en['reviews.approve'] }).at(-1)!
  fireEvent.click(approve)
  fireEvent.click(approve)
  expect(retain).toHaveBeenCalledOnce()
  expect(submit).toHaveBeenCalledOnce()
  complete(undefined)
  await waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
})

it('keeps the authored review reason when bounded draft storage rejects an edit', () => {
  const row = page.items[0]!
  const draft: SimulationReviewDraft = { runId: page.runId, operationId: row.operationId, attemptId: row.attemptId,
    expectedRevision: row.taskRevision, nextPhase: 'completed', reason: 'Original reason' }
  const view = render(<TaskReviews runId={page.runId} ready connected authorizationVersion={1} pageSize={2}
    value={{ value: page, loading: false, stale: false }} read={vi.fn(async () => {})}
    drafts={{ [reviewDraftKey(draft)]: draft }} target={draft} select={vi.fn()}
    change={() => { throw new Error('Draft quota reached') }} commands={{}}
    retain={vi.fn(() => 'key' as never)} submit={vi.fn(async () => undefined)} query={vi.fn(async () => undefined)} t={t} />)
  const dialog = within(view.getByRole('dialog', { name: en['reviews.open'] }))
  fireEvent.change(dialog.getByLabelText(en['reviews.reason']), { target: { value: 'Later edit' } })
  expect(dialog.getByRole('alert').textContent).toBe(en.commandCapacity)
  const reason = dialog.getByLabelText(en['reviews.reason'])
  if (!(reason instanceof HTMLTextAreaElement)) throw new Error('Review reason is not a text area')
  expect(reason.value).toBe('Original reason')
})
