// @vitest-environment jsdom
/** Exact cancellation requires current canonical selection and preserves private drafts across uncertain outcomes. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
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
  expect((dialog.getByLabelText(locale['taskControl.reason']) as HTMLTextAreaElement).value).toBe('Later reason')
})

it('preserves a stale task fence until explicit current-revision confirmation and refuses draft capacity before retain', async () => {
  const retain = vi.fn(() => 'key' as never), change = vi.fn()
  const base = { runId: page.runId, ready: true, connected: true, authorizationVersion: 1, pageSize: 1,
    value: { value: page, loading: false, stale: false }, read: async () => {}, drafts: { [key]: { ...draft, expectedRevision: 3 } },
    target: draft, change, select: vi.fn(), commands: {}, retain, submit: async () => undefined,
    query: async () => undefined, t: (key: Key) => en[key] }
  const view = render(<TaskControls {...base} />), dialog = within(view.getByRole('dialog', { name: en['taskControl.open'] }))
  expect((dialog.getByRole('button', { name: en['taskControl.confirm'] }) as HTMLButtonElement).disabled).toBe(true)
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
})
