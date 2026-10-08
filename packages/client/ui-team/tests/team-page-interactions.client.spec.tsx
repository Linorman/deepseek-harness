// @vitest-environment jsdom
/** Team page owns module navigation and stops only the active attention observation. */
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { TeamPage } from '../src/client/TeamPage.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceSelection, workspaceState, workspaceTask, workspaceTaskSummary } from './workspace-fixtures.client.ts'

afterEach(cleanup)

it('opens a loaded overview task in the Team task module and preserves the selected identity', () => {
  const base = workspaceState()
  const task = workspaceTask('Review release')
  const state = workspaceSelection({ ...base, tasks: [task] })
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const collections = { teamId: base.team.id, members: empty,
    tasks: { ...empty, items: [workspaceTaskSummary(task)] }, workflowPlans: empty, artifacts: empty }
  const onViewChange = vi.fn()
  function Page() {
    const [selectedView, setSelectedView] = useState<'overview' | 'tasks'>('overview')
    return <TeamPage view={selectedView} state={state} collections={collections} translate={makeTranslate(en)}
      onViewChange={(next) => { onViewChange(next); if (next === 'overview' || next === 'tasks') setSelectedView(next) }} />
  }
  const view = render(<Page />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  expect(onViewChange).toHaveBeenCalledExactlyOnceWith('tasks')
  expect(view.getByRole('textbox', { name: en['taskView.search'] })).toBeTruthy()
  expect(view.getByRole('button', { name: task.subject }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: en['workspace.overview'] }))
  expect(view.getByText(en['overview.noMembers'])).toBeTruthy()
})

it('loads attention on entry and pauses its watch on departure', async () => {
  const state = workspaceSelection(workspaceState())
  const readAttention = vi.fn(async () => {})
  const pauseAttention = vi.fn()
  const watchAttention = vi.fn(() => vi.fn())
  const view = render(<TeamPage view="attention" state={state} translate={makeTranslate(en)}
    readAttention={readAttention} pauseAttention={pauseAttention} watchAttention={watchAttention} />)
  await waitFor(() => { expect(readAttention).toHaveBeenCalledExactlyOnceWith(state.team.id, 'first') })
  expect(watchAttention).not.toHaveBeenCalled()
  view.rerender(<TeamPage view="overview" state={state} translate={makeTranslate(en)}
    readAttention={readAttention} pauseAttention={pauseAttention} watchAttention={watchAttention} />)
  expect(pauseAttention).toHaveBeenCalledOnce()
  expect(watchAttention).toHaveBeenCalledExactlyOnceWith(state.team.id)
  view.unmount()
})
