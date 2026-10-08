// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { TaskBoard } from '../src/client/TaskBoard.tsx'
import { workspaceTask, workspaceTaskSummary } from './workspace-fixtures.client.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('keeps authoritative phase counts independent of the bounded loaded cards and opens the exact task', () => {
  const translate = makeTranslate(en)
  const openTask = vi.fn()
  const counts = { pending: 8, assigned: 2, running: 1, review: 0, completed: 0, failed: 0, cancelled: 0, deleted: 0 }
  const props: Omit<Parameters<typeof TaskBoard>[0], 'tasks'> = { counts, openTask, translate, ownerName: () => 'Actual worker' }
  const view = render(<TaskBoard {...props} tasks={[]} />)
  expect(view.getAllByText(en['board.notLoaded'])).toHaveLength(2)
  const rows = Array.from({ length: 5 }, (_, index) => workspaceTaskSummary(workspaceTask(`task-${String(index)}`)))
  const owned = { ...rows[0]!, ownerId: 'worker' as never, dependencyCount: 2, cancellationRequested: true }
  view.rerender(<TaskBoard {...props} tasks={[owned, ...rows.slice(1)]} />)
  expect(view.getAllByRole('button')).toHaveLength(4)
  expect(view.queryByRole('button', { name: 'task-4' })).toBeNull()
  expect(view.getByText('Actual worker')).toBeTruthy()
  expect(view.getAllByText(en['detail.task.unassigned'])).toHaveLength(3)
  expect(view.getByText(translate('board.dependencies', { count: 2 }))).toBeTruthy()
  expect(view.getByText(en['detail.task.phase.stopping'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'task-0' }))
  expect(openTask).toHaveBeenCalledExactlyOnceWith(owned.id)
  expect(view.getByRole('region', { name: `${en['board.pending']} 8` })).toBeTruthy()
})
