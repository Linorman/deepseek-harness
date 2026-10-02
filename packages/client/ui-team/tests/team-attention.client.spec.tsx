// @vitest-environment jsdom
/** Pending navigation survives preview/list failures without borrowing principal inbox rows. */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { TeamAttention } from '../src/client/TeamAttention.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { TeamAttentionState, TeamAttentionItem } from '@clocky/clocky-client-runtime/client'

afterEach(cleanup)
const teamId = 'pending-team' as TeamAttentionState['teamId']
const counts = { recovery: 1, humanActions: 2, reviews: 3, total: 6 }
function state(items: readonly TeamAttentionItem[] = []): TeamAttentionState {
  return { teamId, limit: 3, loading: false, hasNewer: false, disconnected: false,
    page: { teamId, teamCursor: 1, counts, items } }
}
function props() { return { translate: makeTranslate(en), openTask: vi.fn(), openRecovery: vi.fn(), read: vi.fn(async () => {}) } }

it('keeps all-pending navigation when a nonzero authoritative preview failed or returned no rows', () => {
  const h = props()
  const viewAll = vi.fn()
  const view = render(<TeamAttention {...h} preview state={{ ...state(), error: 'Preview unavailable' }} counts={counts} viewAll={viewAll} />)
  expect(view.getByRole('alert').textContent).toContain('Preview unavailable')
  fireEvent.click(view.getByRole('button', { name: 'View all pending items' }))
  expect(viewAll).toHaveBeenCalledOnce()
  view.rerender(<TeamAttention {...h} preview state={state()} counts={counts} viewAll={viewAll} />)
  expect(view.getByRole('button', { name: 'View all pending items' })).toBeTruthy()
  expect(view.getByText('No pending items on this page. Refresh from the beginning.')).toBeTruthy()
})

it('distinguishes unknown, loading, successful empty, disconnected and stale pages', () => {
  const h = props()
  const view = render(<TeamAttention {...h} />)
  expect(view.getByText('Loading pending items…')).toBeTruthy()
  expect(view.queryByText('Nothing needs your attention')).toBeNull()
  const empty = { recovery: 0, humanActions: 0, reviews: 0, total: 0 }
  view.rerender(<TeamAttention {...h} state={{ ...state(), page: { ...state().page!, counts: empty } }} counts={empty} />)
  expect(view.getByText('Nothing needs your attention')).toBeTruthy()
  view.rerender(<TeamAttention {...h} state={{ ...state(), disconnected: true, hasNewer: true }} counts={counts} />)
  expect(view.getByText('Disconnected; showing the last authorized content.')).toBeTruthy()
  expect(view.getByText('Pending items changed. Refresh before continuing.')).toBeTruthy()
  expect(view.getByRole('button', { name: 'Next pending page' }).hasAttribute('disabled')).toBe(true)
})

it('opens exact responsibility targets and explains waiting permissions without dropping readable rows', async () => {
  const h = props()
  const openAction = vi.fn(async () => { throw new Error('Request changed') })
  const items: TeamAttentionItem[] = [
    { kind: 'team-recovery', id: teamId, createdAt: 1, reason: { code: 'unknown', message: { text: 'Writer outcome unknown', truncated: false } }, handling: { kind: 'waiting', reason: 'not-authorized' } },
    { kind: 'task-review', id: 'review' as never, createdAt: 2, revision: 1, subject: { text: 'Review exact task', truncated: false }, reviewerId: 'reader' as never, handling: { kind: 'waiting', reason: 'reviewer-required' } },
    { kind: 'human-action', id: 'question' as never, createdAt: 3, updatedAt: 3, actionKind: 'question', handling: { kind: 'actionable' } },
  ]
  const view = render(<TeamAttention {...h} state={state(items)} counts={counts} openAction={openAction} />)
  fireEvent.click(view.getByRole('button', { name: 'Inspect Team blocker' }))
  expect(h.openRecovery).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: 'Review exact task' }))
  expect(h.openTask).toHaveBeenCalledWith('review')
  expect(view.getByText(/Waiting for permission/)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Question' }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Request changed') })
  expect(openAction).toHaveBeenCalledWith('question')
})

it('localizes controls and advances only a current available continuation', () => {
  const h = props()
  const item: TeamAttentionItem = { kind: 'human-action', id: 'approval' as never, createdAt: 1, updatedAt: 1,
    actionKind: 'approval', handling: { kind: 'waiting', reason: 'response-accepted' } }
  const base = state([item])
  const current = { ...base, page: { ...base.page!, nextCursor: { teamId, teamCursor: 1, order: 'attention-priority-time-id-v1' as const,
    position: { kind: 'human-action' as const, id: item.id, createdAt: 1 } } } }
  const view = render(<TeamAttention {...h} translate={makeTranslate(zh)} state={current} counts={counts} />)
  expect(view.getByText(/回答已受理，等待收尾/)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: '下一页待处理' }))
  expect(h.read).toHaveBeenCalledWith('next')
  fireEvent.click(view.getByRole('button', { name: '刷新并返回首页' }))
  expect(h.read).toHaveBeenCalledWith('first')
})
