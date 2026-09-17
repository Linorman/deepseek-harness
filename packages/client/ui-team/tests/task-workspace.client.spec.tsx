// @vitest-environment jsdom
/** Task summaries retain authority, exact execution provenance, and list context. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { TaskWorkspace, type TaskWorkspaceProps } from '../src/client/TaskWorkspace.tsx'
import { createTeamWorkspaceStore, DEFAULT_TEAM_VIEW } from '../src/client/workspace-store.ts'
import { en } from '../src/client/locales.ts'
import { workspaceState, workspaceTask, workspaceTaskSummary, workspaceTaskDetail } from './workspace-fixtures.client.ts'

afterEach(cleanup)

function TaskView(props: { state: ReturnType<typeof workspaceState>; tasks: ReturnType<typeof workspaceState>['tasks'] } & Omit<Partial<TaskWorkspaceProps>, 'state' | 'tasks'>) {
  const [viewState, setViewState] = useState(DEFAULT_TEAM_VIEW)
  const task = props.state.tasks.find(task => task.id === viewState.taskId)
  return <TaskWorkspace translate={makeTranslate(en)} viewState={viewState}
    updateView={(patch) => { setViewState(current => ({ ...current, ...patch })) }}
    busy={false} canManage onForm={vi.fn()} readDetail={async () => {}} {...props}
    tasks={props.tasks.map(workspaceTaskSummary)} detail={task === undefined ? undefined : workspaceTaskDetail(task)} />
}

it('filters only loaded tasks and opens one compact summary without revealing all instructions in the list', () => {
  const tasks = [workspaceTask('API migration'), workspaceTask('Release notes', { phase: 'review' })]
  const state = { ...workspaceState(), tasks: [...tasks, workspaceTask('Unloaded item')] }
  const view = render(<TaskView state={state} tasks={tasks} />)
  expect(view.queryByRole('complementary')).toBeNull()
  expect(view.queryByText('Instructions for API migration')).toBeNull()
  fireEvent.change(view.getByRole('textbox', { name: 'Search loaded tasks only' }), { target: { value: 'unloaded' } })
  expect(view.getByText('No matching tasks')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Clear filters' }))
  fireEvent.click(view.getByRole('button', { name: 'API migration' }))
  expect(view.getAllByRole('complementary')).toHaveLength(1)
  expect(view.getByRole('complementary').textContent).toContain('Instructions for API migration')
  expect(view.queryByText('Instructions for Release notes')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Close task summary' }))
  expect(document.activeElement).toBe(view.getByRole('button', { name: 'API migration' }))
})

it('opens the settled attempt owner without needing a full activation list', () => {
  const state = workspaceState()
  const participantId = 'worker' as never
  const task = workspaceTask('API migration', { phase: 'completed', attemptCount: 1, attemptHistory: [{
    id: 'attempt-1' as never, teamId: state.team.id, taskId: 'API migration' as never, ordinal: 1, participantId,
    activationId: 'old-epoch' as never, assignedAt: 1, leaseExpiresAt: 20, settledAt: 10,
    outcome: { kind: 'completed', result: { summary: 'Migration verified', evidence: ['Detailed verification evidence'] } },
  }] })
  const withExecution = { ...state, tasks: [task], participants: [{ id: participantId, teamId: state.team.id,
    kind: 'local-agent' as const, displayName: 'Worker A', role: 'worker', capabilities: [], phase: 'active' as const }],
  activations: [] }
  const openParticipantSession = vi.fn(async () => {})
  const view = render(<TaskView state={withExecution} tasks={[task]} openParticipantSession={openParticipantSession} />)
  fireEvent.click(view.getByRole('button', { name: 'API migration' }))
  const summary = within(view.getByRole('complementary'))
  expect(summary.getByText('Worker A')).toBeTruthy()
  fireEvent.click(summary.getByRole('button', { name: 'View execution record' }))
  expect(openParticipantSession).toHaveBeenCalledWith(participantId)
  expect(summary.getByText('Detailed verification evidence').closest('details')?.open).toBe(false)
})

it('uses the newest revision for actions and never resurrects a deleted task from an older loaded page', () => {
  const original = workspaceTask('API migration')
  const current = { ...original, revision: 4 }
  const onDelete = vi.fn()
  const state = { ...workspaceState(), tasks: [current] }
  const view = render(<TaskView state={state} tasks={[original]} onDelete={onDelete} />)
  fireEvent.click(view.getByRole('button', { name: original.subject }))
  fireEvent.click(view.getByRole('button', { name: 'More actions' }))
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete task' }))
  expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: current.id, revision: 4 }))
  view.rerender(<TaskView state={{ ...state, tasks: [{ ...current, phase: 'deleted', revision: 5 }] }} tasks={[original]} onDelete={onDelete} />)
  expect(view.getByRole('complementary').textContent).toContain('This task was deleted.')
})

it('keeps review separate from task deletion and provides the review operation', () => {
  const task = workspaceTask('Release notes', { phase: 'review' })
  const onForm = vi.fn()
  const onDelete = vi.fn()
  const view = render(<TaskView state={{ ...workspaceState(), tasks: [task] }} tasks={[task]} onForm={onForm} onDelete={onDelete} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: 'Review task' }))
  expect(onForm).toHaveBeenCalledWith({ kind: 'taskReview', taskId: task.id })
  fireEvent.click(view.getByRole('button', { name: 'More actions' }))
  expect(view.queryByRole('menuitem', { name: 'Delete task' })).toBeNull()
  expect(onDelete).not.toHaveBeenCalled()
})

it('retains independent Team filters, selections, and module scroll positions', () => {
  const workspace = createTeamWorkspaceStore().create()
  const teamId = workspaceState().team.id
  const task = workspaceTask('API migration')
  workspace.actions.update(teamId, { view: 'tasks', taskId: task.id, taskSearch: 'API', taskPhase: 'pending' })
  workspace.actions.rememberScroll(teamId, 'tasks', 360)
  workspace.actions.update('another-team' as never, { view: 'channels' })
  workspace.actions.update(teamId, { view: 'overview' })
  workspace.actions.update(teamId, { view: 'tasks' })
  expect(workspace.getSnapshot().byTeam[teamId]).toMatchObject({ taskId: task.id, taskSearch: 'API', taskPhase: 'pending', scroll: { tasks: 360 } })
  expect(workspace.getSnapshot().byTeam['another-team']?.view).toBe('channels')
})
