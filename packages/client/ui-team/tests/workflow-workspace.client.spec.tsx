// @vitest-environment jsdom
/** Workflow paging preserves the selected detail and exposes explicit retry controls. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamWorkflowDetailState, TeamWorkflowSummary } from '@clocky/clocky-client-runtime/client'
import { WorkflowWorkspace } from '../src/client/WorkflowWorkspace.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const teamId = 'team' as TeamWorkflowSummary['teamId']
const id = 'plan' as TeamWorkflowSummary['id']
const summary: TeamWorkflowSummary = { id, teamId, revision: 1, phase: 'compiling',
  name: { text: 'Plan', truncated: false }, taskCount: 2, boundTaskCount: 1 }
function detail(): TeamWorkflowDetailState {
  return { teamId, planId: id, loading: false, hasNewer: false, disconnected: false, value: {
    record: { id, teamId, revision: 1, phase: 'compiling', name: 'Plan', bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 } },
    teamCursor: 1, startCursor: -1, total: 2, scanned: 4, nextCursor: 0,
    items: [{ templateId: 'first' as never, subject: { text: 'First task', truncated: false }, blockedBy: [
      { templateId: 'dependency' as never, taskId: 'bound-dependency' as never, subject: { text: 'Off-page dependency', truncated: false } },
    ] }],
  } }
}

it('opens only the requested workflow and retains its detail outside the list page', () => {
  const read = vi.fn(async () => {})
  const close = vi.fn()
  const openTask = vi.fn()
  const props = { plans: [summary], read, close, openTask, translate: makeTranslate(en) }
  const view = render(<WorkflowWorkspace {...props} />)
  expect(view.queryByRole('region', { name: 'Workflow details' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Plan' }))
  expect(read).toHaveBeenCalledWith(id, 'open')
  view.rerender(<WorkflowWorkspace {...props} plans={[]} detail={detail()} />)
  expect(view.getByRole('heading', { name: 'Plan' })).toBeTruthy()
  fireEvent.click(view.getByRole('link', { name: 'Off-page dependency' }))
  expect(openTask).toHaveBeenCalledWith(expect.anything(), 'bound-dependency')
  fireEvent.click(view.getByRole('button', { name: 'Next page' }))
  expect(read).toHaveBeenCalledWith(id, 'next')
  fireEvent.click(view.getByRole('button', { name: 'Close workflow details' }))
  expect(close).toHaveBeenCalledOnce()
})

it('keeps failed or stale detail readable and requires refresh before continuation', () => {
  const read = vi.fn(async () => {})
  const view = render(<WorkflowWorkspace plans={[summary]} detail={{ ...detail(), error: 'Read unavailable', hasNewer: true }}
    read={read} close={vi.fn()} openTask={vi.fn()} translate={makeTranslate(en)} />)
  expect(view.getByText('First task')).toBeTruthy()
  expect(view.getByRole('alert').textContent).toBe('Read unavailable')
  expect((view.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Refresh workflow details' }))
  expect(read).toHaveBeenCalledWith(id, 'refresh')
})
