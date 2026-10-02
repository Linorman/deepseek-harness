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
import { createTaskFormDraft, taskDraftKey } from '../src/client/task-draft.ts'

afterEach(cleanup)

function TaskView(props: { state: ReturnType<typeof workspaceState>; tasks: ReturnType<typeof workspaceState>['tasks'] } & Omit<Partial<TaskWorkspaceProps>, 'state' | 'tasks'>) {
  const [viewState, setViewState] = useState(DEFAULT_TEAM_VIEW)
  const task = props.state.tasks.find(task => task.id === viewState.taskId)
  return <TaskWorkspace translate={makeTranslate(en)} viewState={viewState}
    updateView={(patch) => { setViewState(current => ({ ...current, ...patch })) }}
    busy={false} canManage onForm={vi.fn()} readDetail={async () => {}} {...props}
    tasks={props.tasks.map(workspaceTaskSummary)} detail={task === undefined ? undefined : workspaceTaskDetail(task)} />
}

it.each(['assigned', 'running', 'cancelled', 'deleted'] as const)('opens retained edit input from a %s task without offering a new edit', (phase) => {
  const original = workspaceTask('retained-task')
  const current = workspaceTask(original.id, { phase, revision: 3,
    ...phase === 'assigned' || phase === 'running' ? { attemptCount: 1, lease: {
      attemptId: 'active-attempt' as never, participantId: 'worker' as never, assignedAt: 1, expiresAt: 100,
      assignedRevision: 2, ordinal: 1, durationMs: 99, renewedAt: 1,
      ...phase === 'running' ? { startedAt: 2 } : {},
    } } : {} })
  const target = { kind: 'taskUpdate', taskId: current.id } as const
  const draft = createTaskFormDraft(target, workspaceTaskDetail(original).record.value!.task, '')
  const onForm = vi.fn()
  const preferences = { ...DEFAULT_TEAM_VIEW, taskId: current.id, taskDrafts: {
    [taskDraftKey(target)]: { ...draft, fields: { ...draft.fields, description: 'Retained input' } },
  } }
  const props = { state: { team: workspaceState().team, participants: [], tasks: [] }, tasks: [],
    detail: workspaceTaskDetail(current), viewState: preferences, updateView: vi.fn(), translate: makeTranslate(en),
    canManage: false, busy: false, onForm, readDetail: async () => {} }
  const view = render(<TaskWorkspace {...props} />)
  fireEvent.click(view.getByRole('button', { name: 'Open edit draft' }))
  expect(onForm).toHaveBeenCalledWith(target)
  expect(view.queryByRole('button', { name: 'More actions' })).toBeNull()
  view.rerender(<TaskWorkspace {...props} viewState={{ ...preferences, taskDrafts: {} }} />)
  expect(view.queryByRole('button', { name: 'Open edit draft' })).toBeNull()
})

it('preserves an assigned identity across member pages and in the task summary before an attempt exists', () => {
  const task = workspaceTask('Assigned work', { phase: 'assigned', lease: { attemptId: 'attempt' as never, participantId: 'off-page-member' as never, activationId: 'activation' as never, assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1 } })
  const state = { ...workspaceState(), tasks: [task] }
  const view = render(<TaskView state={state} tasks={[task]} />)
  expect(view.getByRole('cell', { name: 'Assigned · off-page-member' })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  expect(within(view.getByRole('complementary')).getByText('Assigned · off-page-member')).toBeTruthy()
  view.rerender(<TaskView state={{ ...state, participants: [{ id: task.lease!.participantId, teamId: state.team.id,
    kind: 'local-agent', displayName: 'Resolved worker', role: 'worker', capabilities: [], phase: 'active' }] }} tasks={[task]} />)
  expect(view.getByRole('cell', { name: 'Resolved worker' })).toBeTruthy()
  view.rerender(<TaskView state={state} tasks={[task]} />)
  expect(view.queryByText('Unassigned')).toBeNull()
})

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

it('keeps a resolved off-page owner and removes the name when identity access is refused', () => {
  const task = workspaceTask('Named reference', { phase: 'assigned', lease: { attemptId: 'attempt' as never,
    participantId: 'off-page' as never, activationId: 'activation' as never, assignedAt: 1, expiresAt: 100,
    assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1 } })
  const state = { ...workspaceState(), tasks: [task] }
  const identities = { teamId: state.team.id, items: [{ participantId: 'off-page' as never, state: 'resolved' as const,
    displayName: { text: 'Former worker', truncated: false }, phase: 'left' as const }],
  loading: false, disconnected: false, forbidden: false }
  const view = render(<TaskView state={state} tasks={[task]} identities={identities} />)
  expect(view.getByRole('cell', { name: 'Former worker · Left' })).toBeTruthy()
  view.rerender(<TaskView state={state} tasks={[task]} identities={{ ...identities, disconnected: true, error: 'Network unavailable' }} />)
  expect(view.getByRole('cell', { name: 'Former worker · Left' })).toBeTruthy()
  view.rerender(<TaskView state={state} tasks={[task]} identities={{ ...identities, forbidden: true, items: [] }} />)
  expect(view.queryByText('Former worker · Left')).toBeNull()
  expect(view.getByRole('cell', { name: 'Member identity unavailable' })).toBeTruthy()
})

it('opens the exact off-page owner through the shared identity control', () => {
  const task = workspaceTask('Inspect owner', { phase: 'assigned', lease: { attemptId: 'attempt' as never,
    participantId: 'off-page-owner' as never, activationId: 'activation' as never, assignedAt: 1, expiresAt: 100,
    assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1 } })
  const state = { ...workspaceState(), tasks: [task] }
  const inspectMember = vi.fn()
  const view = render(<TaskView state={state} tasks={[task]} inspectMember={inspectMember} />)
  fireEvent.click(view.getByRole('button', { name: 'Assigned · off-page-owner' }))
  expect(inspectMember).toHaveBeenCalledWith('off-page-owner')
  view.rerender(<TaskView state={state} tasks={[task]} inspectMember={inspectMember} identities={{ teamId: state.team.id,
    items: [{ participantId: 'off-page-owner' as never, state: 'unavailable' }], loading: false, disconnected: false, forbidden: false }} />)
  expect(view.queryByRole('button', { name: 'Member identity unavailable' })).toBeNull()
})

it('commits whole-Team search explicitly, guards IME composition and clears with input focus', () => {
  const state = workspaceState()
  const updateView = vi.fn()
  const view = render(<TaskView state={state} tasks={[]} searchScope="team" updateView={updateView} />)
  const input = view.getByRole('textbox', { name: 'Search all tasks in this Team' })
  fireEvent.change(input, { target: { value: '调查任务' } })
  expect(updateView).not.toHaveBeenCalled()
  fireEvent.compositionStart(input)
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.submit(input.closest('form')!)
  expect(updateView).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  fireEvent.submit(input.closest('form')!)
  expect(updateView).toHaveBeenLastCalledWith({ taskSearch: '调查任务', taskPhase: 'all', taskListScroll: 0 })
  fireEvent.click(view.getByRole('button', { name: 'Clear task search' }))
  expect(updateView).toHaveBeenLastCalledWith({ taskSearch: '', taskPhase: 'all', taskListScroll: 0 })
  expect(document.activeElement).toBe(input)
})

it('keeps authoritative matches whose displayed title prefix does not contain the search term', () => {
  const task = workspaceTask('A long title with hidden search text', { subject: 'A long title with hidden search text' })
  const row = { ...workspaceTaskSummary(task), subject: { text: 'A long title', truncated: true } }
  const state = { team: workspaceState().team, participants: [], tasks: [] }
  const view = render(<TaskWorkspace state={state} tasks={[row]} searchScope="team"
    queryState={{ teamId: state.team.id, query: { search: 'hidden' }, loading: false, disconnected: false, hasNewer: false,
      page: { teamId: state.team.id, kind: 'tasks', teamCursor: 1, query: { search: 'hidden' }, sourceTotal: 20, total: 12, scanned: 20, items: [row] } }}
    viewState={{ ...DEFAULT_TEAM_VIEW, taskSearch: 'hidden' }} updateView={vi.fn()} translate={makeTranslate(en)}
    canManage={false} busy={false} onForm={vi.fn()} />)
  expect(view.getByRole('button', { name: 'A long title…' })).toBeTruthy()
  expect(view.getByText('Matching tasks: 12 · On this page: 1')).toBeTruthy()
})
