// @vitest-environment jsdom
/** Activity keeps a bounded readable suffix and offers explicit recovery after a failed read. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamAuditList } from '@clocky/clocky-client-runtime/client'
import { TeamActivity } from '../src/client/TeamActivity.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceSelection, workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)

function props() {
  const state = workspaceSelection(workspaceState())
  return { state, translate: makeTranslate(en), inspect: vi.fn() }
}

function page(state: ReturnType<typeof props>['state']): TeamAuditList {
  return { teamId: state.team.id, items: [
    { teamId: state.team.id, stream: 'team', cursor: 1, type: 'task/changed', createdAt: 1,
      facts: { task: { subject: 'Review migration' } } },
    { teamId: state.team.id, stream: 'team', cursor: 2, type: 'participant/changed', createdAt: 2,
      facts: { participant: { displayName: 'Coordinator' } } },
    { teamId: state.team.id, stream: 'team', cursor: 3, type: 'custom/event', createdAt: 3,
      facts: { task: [], participant: { displayName: 4 } } },
  ] }
}

it('shows unavailability when this deployment has no audit reader', () => {
  const view = render(<TeamActivity {...props()} />)
  expect(view.getByText('Unavailable')).toBeTruthy()
  expect(view.queryByRole('button', { name: 'Activity actions' })).toBeNull()
})

it('labels task and member facts and reloads after a failed read', async () => {
  const p = props()
  const readAudit = vi.fn().mockRejectedValueOnce('Audit offline').mockResolvedValueOnce(page(p.state))
    .mockRejectedValueOnce(new Error('Reload failed'))
  const view = render(<TeamActivity {...p} readAudit={readAudit} />)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Audit offline') })
  fireEvent.click(view.getByRole('button', { name: 'Activity actions' }))
  fireEvent.click(view.getByText('Reload from server'))
  await waitFor(() => { expect(view.getAllByRole('listitem')).toHaveLength(3) })
  expect(view.getByRole('button', { name: 'Review migration · Execution task updated' })).toBeTruthy()
  expect(view.getByRole('button', { name: 'Coordinator · Team member updated' })).toBeTruthy()
  expect(view.getByRole('button', { name: 'Team state updated' })).toBeTruthy()
  expect(view.queryByRole('alert')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Coordinator · Team member updated' }))
  expect(p.inspect).toHaveBeenCalledWith(2)
  fireEvent.click(view.getByRole('button', { name: 'Activity actions' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.getByRole('button', { name: 'Activity actions' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(view.getByRole('button', { name: 'Activity actions' }))
  fireEvent.click(view.getByText('Reload from server'))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Reload failed') })
  expect(view.getAllByRole('listitem')).toHaveLength(3)
})

it('aborts an in-flight audit read when the card leaves the screen', async () => {
  const p = props()
  let finish!: (value: TeamAuditList) => void
  const readAudit = vi.fn((_input?: unknown, _signal?: AbortSignal) => new Promise<TeamAuditList>((resolve) => { finish = resolve }))
  const view = render(<TeamActivity {...p} readAudit={readAudit} />)
  await waitFor(() => { expect(readAudit).toHaveBeenCalledOnce() })
  const signal = readAudit.mock.calls[0]![1]
  expect(signal?.aborted).toBe(false)
  view.unmount()
  expect(signal?.aborted).toBe(true)
  finish(page(p.state))
})

it('ignores a late read failure after the card leaves the screen', async () => {
  const p = props()
  let rejectRead!: (reason: Error) => void
  const readAudit = vi.fn((_input?: unknown, _signal?: AbortSignal) => new Promise<TeamAuditList>((_resolve, reject) => {
    rejectRead = reject
  }))
  const view = render(<TeamActivity {...p} readAudit={readAudit} />)
  await waitFor(() => { expect(readAudit).toHaveBeenCalledOnce() })
  const signal = readAudit.mock.calls[0]![1]
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { rejectRead(new Error('Too late')); await Promise.resolve() })
})
