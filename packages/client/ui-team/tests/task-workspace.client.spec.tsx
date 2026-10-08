// @vitest-environment jsdom
/** Task summaries retain authority, exact execution provenance, and list context. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
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
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: false })
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

it('omits deleted tasks from the loaded list while keeping the remaining task selectable', () => {
  const deleted = workspaceTask('Deleted task', { phase: 'deleted' })
  const pending = workspaceTask('Pending task')
  const view = render(<TaskView state={{ ...workspaceState(), tasks: [deleted, pending] }} tasks={[deleted, pending]} />)
  expect(view.queryByRole('button', { name: deleted.subject })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: pending.subject }))
  expect(view.getByRole('heading', { name: pending.subject })).toBeTruthy()
  view.rerender(<TaskView state={{ ...workspaceState(), tasks: [deleted, pending] }} tasks={[deleted, pending]}
    viewState={{ ...DEFAULT_TEAM_VIEW, taskPhase: 'review' }} />)
  expect(view.queryByRole('button', { name: pending.subject })).toBeNull()
})

it('loads disclosed attempt and review history, then pages each exact section independently', async () => {
  const task = workspaceTask('History task')
  const base = workspaceTaskDetail(task)
  const readDetail = vi.fn(async () => {})
  const props = { state: { team: workspaceState().team, participants: [], tasks: [task] },
    tasks: [workspaceTaskSummary(task)], viewState: { ...DEFAULT_TEAM_VIEW, taskId: task.id },
    updateView: vi.fn(), translate: makeTranslate(en), canManage: true, busy: false,
    onForm: vi.fn(), readDetail }
  const view = render(<TaskWorkspace {...props} detail={{ ...base,
    attempts: { loading: false, value: undefined }, reviews: { loading: false, value: undefined } }} />)
  const summary = within(view.getByRole('complementary', { name: en['taskView.summary'] }))
  fireEvent.click(summary.getByText(en['taskView.fullDetails']))
  await waitFor(() => {
    expect(readDetail).toHaveBeenCalledWith(task.teamId, task.id, 'attempts', 'first')
    expect(readDetail).toHaveBeenCalledWith(task.teamId, task.id, 'reviews', 'first')
  })
  readDetail.mockClear()
  const attempts = base.attempts.value, reviews = base.reviews.value
  if (attempts === undefined || reviews === undefined) throw new Error('Fixture history pages are missing')
  view.rerender(<TaskWorkspace {...props} detail={{ ...base,
    attempts: { loading: false, value: { ...attempts, nextCursor: 0 } },
    reviews: { loading: false, value: { ...reviews, nextCursor: 0 } } }} />)
  const disclosure = summary.getByText(en['taskView.fullDetails']).closest('details')
  if (disclosure === null) throw new Error('Task history disclosure is missing')
  const history = within(disclosure)
  for (const label of [en['detail.firstPage'], en['taskView.refresh'], en['taskView.nextHistory']]) {
    const buttons = history.getAllByRole('button', { name: label })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[0]!)
    fireEvent.click(buttons[1]!)
  }
  expect(readDetail).toHaveBeenCalledWith(task.teamId, task.id, 'attempts', 'next')
  expect(readDetail).toHaveBeenCalledWith(task.teamId, task.id, 'reviews', 'next')
})

it('does not replace stale or already-loading history when details are disclosed', async () => {
  const task = workspaceTask('History loading')
  const base = workspaceTaskDetail(task)
  const readDetail = vi.fn(async () => {})
  const props = { state: { team: workspaceState().team, participants: [], tasks: [task] },
    tasks: [workspaceTaskSummary(task)], viewState: { ...DEFAULT_TEAM_VIEW, taskId: task.id },
    updateView: vi.fn(), translate: makeTranslate(en), canManage: true, busy: false,
    onForm: vi.fn(), readDetail }
  const stale = { ...base, hasNewer: true,
    attempts: { loading: false, value: undefined }, reviews: { loading: false, value: undefined } }
  const view = render(<TaskWorkspace {...props} detail={stale} />)
  readDetail.mockClear()
  fireEvent.click(view.getByText(en['taskView.fullDetails']))
  await waitFor(() => { expect(view.getByText(en['taskView.fullDetails']).closest('details')?.open).toBe(true) })
  expect(readDetail).not.toHaveBeenCalled()
  const loading = { ...base, attempts: { loading: true, value: undefined },
    reviews: { loading: true, value: undefined } }
  view.rerender(<TaskWorkspace {...props} detail={loading} />)
  fireEvent.click(view.getByText(en['taskView.fullDetails']))
  fireEvent.click(view.getByText(en['taskView.fullDetails']))
  await waitFor(() => { expect(view.getByText(en['taskView.fullDetails']).closest('details')?.open).toBe(true) })
  expect(readDetail).not.toHaveBeenCalled()
})

it('commits a phase choice and resets retained table scroll only when the filter changes', () => {
  const state = { team: workspaceState().team, participants: [], tasks: [] }
  const updateView = vi.fn()
  const props = { state, tasks: [], viewState: DEFAULT_TEAM_VIEW, updateView,
    translate: makeTranslate(en), canManage: false, busy: false, onForm: vi.fn() }
  const view = render(<TaskWorkspace {...props} />)
  const filter = view.getByRole('button', { name: en['taskView.status'] })
  fireEvent.click(filter)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(filter.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(filter)
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.phase.review'] }))
  expect(updateView).toHaveBeenCalledWith({ taskSearch: '', taskPhase: 'review', taskListScroll: 0 })
  const scroll = view.container.querySelector<HTMLElement>('[data-task-scroll]')
  if (scroll === null) throw new Error('Task table scroll viewport is missing')
  Object.defineProperty(scroll, 'getClientRects', { configurable: true,
    value: () => [{ width: 200, height: 200 }] })
  scroll.scrollTop = 87
  fireEvent.scroll(scroll)
  view.rerender(<TaskWorkspace {...props} viewState={{ ...DEFAULT_TEAM_VIEW, taskPhase: 'review' }} />)
  expect(scroll.scrollTop).toBe(0)
  view.unmount()
  expect(updateView).toHaveBeenLastCalledWith({ taskListScroll: 0 })
})

it('reports a failed Session inspection without discarding the selected task', async () => {
  const task = workspaceTask('Worker task', { phase: 'running', lease: {
    attemptId: 'attempt' as never, participantId: 'worker' as never, activationId: 'activation' as never,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2,
  } })
  const state = { ...workspaceState(), tasks: [task] }
  const openParticipantSession = vi.fn(async () => { throw 'Session unavailable' })
  const view = render(<TaskView state={state} tasks={[task]} openParticipantSession={openParticipantSession} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(within(view.getByRole('complementary')).getByRole('button', { name: en['taskView.openSession'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Session unavailable') })
  expect(view.getByRole('complementary').textContent).toContain(task.subject)
})

it('reports an Error from a failed Session inspection with its message', async () => {
  const task = workspaceTask('Failed Session', { phase: 'running', lease: {
    attemptId: 'attempt' as never, participantId: 'worker' as never, activationId: 'activation' as never,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2,
  } })
  const view = render(<TaskView state={{ ...workspaceState(), tasks: [task] }} tasks={[task]}
    openParticipantSession={vi.fn(async () => { throw new Error('Session read failed') })} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.openSession'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Session read failed') })
})

it('opens a task from its dependency count, refreshes it and follows the exact parent reference', () => {
  const parent = workspaceTask('Parent task')
  const child = workspaceTask('Dependent task', { blockedBy: [parent.id] })
  const state = { ...workspaceState(), tasks: [parent, child] }
  const readDetail = vi.fn(async () => {})
  const view = render(<TaskView state={state} tasks={[parent, child]} readDetail={readDetail} />)
  fireEvent.click(view.getByRole('button', { name: en['taskView.inspectDependencies'].replace('{count}', '1') }))
  const inspector = within(view.getByRole('complementary', { name: en['taskView.summary'] }))
  expect(inspector.getByRole('heading', { name: child.subject })).toBeTruthy()
  fireEvent.click(inspector.getAllByRole('button', { name: en['taskView.refresh'] })[0]!)
  expect(readDetail).toHaveBeenLastCalledWith(child.teamId, child.id)
  fireEvent.click(inspector.getByRole('button', { name: parent.subject }))
  expect(inspector.getByRole('heading', { name: parent.subject })).toBeTruthy()
})

it('opens the pending edit from actions and closes the menu without changing the task', () => {
  const task = workspaceTask('Editable task')
  const onForm = vi.fn()
  const view = render(<TaskView state={{ ...workspaceState(), tasks: [task] }} tasks={[task]} onForm={onForm} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  const actions = view.getByRole('button', { name: en['taskView.actions'] })
  fireEvent.click(actions)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(actions.getAttribute('aria-expanded')).toBe('false')
  expect(onForm).not.toHaveBeenCalled()
  fireEvent.click(actions)
  fireEvent.click(view.getByRole('menuitem', { name: en['taskForm.taskUpdate'] }))
  expect(onForm).toHaveBeenCalledWith({ kind: 'taskUpdate', taskId: task.id })
})

it('offers assigned cancellation, review and integration from each task phase action menu', () => {
  const assigned = workspaceTask('Assigned action', { phase: 'assigned', lease: {
    attemptId: 'assigned-attempt' as never, participantId: 'worker' as never,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1,
  } })
  const review = workspaceTask('Review action', { phase: 'review' })
  const completed = workspaceTask('Integration action', { phase: 'completed', attemptCount: 1,
    attemptHistory: [{ id: 'integration-attempt' as never, teamId: workspaceState().team.id,
      taskId: 'Integration action' as never, ordinal: 1, participantId: 'worker' as never,
      assignedAt: 1, leaseExpiresAt: 20, settledAt: 10,
      outcome: { kind: 'completed', result: { summary: 'Integrated output' } } }] })
  const onStop = vi.fn(), onForm = vi.fn()
  const state = { ...workspaceState(), tasks: [assigned, review, completed] }
  const view = render(<TaskView state={state} tasks={state.tasks} onStop={onStop} onForm={onForm} />)
  fireEvent.click(view.getByRole('button', { name: assigned.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.stop'] }))
  expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ id: assigned.id }))
  fireEvent.click(view.getByRole('button', { name: review.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['taskForm.taskReview'] }))
  expect(onForm).toHaveBeenCalledWith({ kind: 'taskReview', taskId: review.id })
  fireEvent.click(view.getByRole('button', { name: completed.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['taskForm.taskIntegrate'] }))
  expect(onForm).toHaveBeenCalledWith({ kind: 'taskIntegrate', taskId: completed.id })
})

it('opens an available artifact and the exact session from disclosed attempt history', () => {
  const state = workspaceState()
  const participantId = 'artifact-worker' as never
  const artifact = { id: 'review-report', provider: 'local', kind: 'report' as const,
    uri: 'artifact://review-report/', visibility: 'team' as const }
  const attempt = { id: 'artifact-attempt' as never, teamId: state.team.id, taskId: 'Artifacts task' as never,
    ordinal: 1, participantId, activationId: 'artifact-activation' as never, assignedAt: 1,
    leaseExpiresAt: 20, settledAt: 10,
    outcome: { kind: 'completed' as const, result: { summary: 'Report ready', artifacts: [artifact] } } }
  const task = workspaceTask('Artifacts task', { phase: 'completed', attemptCount: 1, attemptHistory: [attempt],
    reviewHistory: [{ attemptId: attempt.id, reviewerId: participantId, nextPhase: 'completed',
      reason: 'Verified report', decidedAt: 11 }] })
  const openArtifact = vi.fn()
  const openParticipantSession = vi.fn(async () => {})
  const view = render(<TaskView state={{ ...state, tasks: [task] }} tasks={[task]}
    openArtifact={openArtifact} openParticipantSession={openParticipantSession} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: 'review-report' }))
  expect(openArtifact).toHaveBeenCalledWith(expect.objectContaining({ id: artifact.id }))
  fireEvent.click(view.getByText(en['taskView.fullDetails']))
  expect(view.getByText('Verified report')).toBeTruthy()
  const details = view.getByText(en['taskView.fullDetails']).closest('details')
  if (details === null) throw new Error('Attempt history disclosure is missing')
  fireEvent.click(within(details).getByRole('button', { name: en['detail.openSession'] }))
  expect(openParticipantSession).toHaveBeenCalledWith(participantId)
  view.rerender(<TaskView state={{ ...state, tasks: [task] }} tasks={[task]}
    openParticipantSession={openParticipantSession} />)
  expect(view.getByRole('button', { name: 'review-report' }).hasAttribute('disabled')).toBe(true)
})

it('keeps a task readable while its record, latest attempt and history sections change read state', () => {
  const task = workspaceTask('Read states')
  const base = workspaceTaskDetail(task)
  const props = { state: { team: workspaceState().team, participants: [], tasks: [task] },
    tasks: [workspaceTaskSummary(task)], viewState: { ...DEFAULT_TEAM_VIEW, taskId: task.id },
    updateView: vi.fn(), translate: makeTranslate(en), canManage: true, busy: false,
    onForm: vi.fn(), readDetail: vi.fn(async () => {}) }
  const view = render(<TaskWorkspace {...props} detail={{ ...base, record: { ...base.record, loading: true } }} />)
  expect(view.getByText(en['taskView.loading'])).toBeTruthy()
  view.rerender(<TaskWorkspace {...props} detail={{ ...base, record: { ...base.record, error: 'Record unavailable' },
    latest: { ...base.latest, loading: true, error: 'Latest attempt unavailable' },
    attempts: { ...base.attempts, loading: true, error: 'Attempts unavailable' },
    reviews: { ...base.reviews, loading: true, error: 'Reviews unavailable' },
    hasNewer: true, disconnected: true }} />)
  expect(view.getAllByRole('alert').map(element => element.textContent)).toEqual(expect.arrayContaining([
    'Record unavailable', 'Latest attempt unavailable', 'Attempts unavailable', 'Reviews unavailable',
  ]))
  expect(view.getByText(en['taskView.changed'])).toBeTruthy()
  expect(view.getByText(en['taskView.disconnected'])).toBeTruthy()
  expect(view.getAllByText(en['taskView.historyLoading'])).toHaveLength(2)
  expect(view.getByRole('heading', { name: task.subject })).toBeTruthy()
})

it('distinguishes an empty Team result from an empty filtered Team page', () => {
  const state = { team: workspaceState().team, participants: [], tasks: [] }
  const queryState = { teamId: state.team.id, query: { search: '' }, loading: false, disconnected: false, hasNewer: false,
    page: { kind: 'tasks' as const, teamId: state.team.id, teamCursor: 1, query: { search: '' }, sourceTotal: 0,
      total: 0, scanned: 0, items: [] } }
  const props = { state, tasks: [], searchScope: 'team' as const, queryState,
    viewState: DEFAULT_TEAM_VIEW, updateView: vi.fn(), translate: makeTranslate(en),
    canManage: false, busy: false, onForm: vi.fn() }
  const view = render(<TaskWorkspace {...props} />)
  expect(view.getByText(en['workspace.noTasks'])).toBeTruthy()
  view.rerender(<TaskWorkspace {...props} viewState={{ ...DEFAULT_TEAM_VIEW, taskSearch: 'unmatched' }} />)
  expect(view.getByText(en['taskView.noResults'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['taskView.clearFilters'] }))
  expect(props.updateView).toHaveBeenCalledWith({ taskSearch: '', taskPhase: 'all', taskListScroll: 0 })
})

it('shows a stopping row, blocks actions during an authority read, and ignores a hidden scroll event', () => {
  const task = workspaceTask('Stopping task', { phase: 'running', lease: {
    attemptId: 'stopping-attempt' as never, participantId: 'worker' as never, assignedAt: 1,
    expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2,
  } })
  const row = { ...workspaceTaskSummary(task), cancellationRequested: true }
  const base = workspaceTaskDetail(task)
  const onStop = vi.fn()
  const props = { state: { team: workspaceState().team, participants: [], tasks: [task] }, tasks: [row],
    detail: { ...base, record: { ...base.record, loading: true } },
    viewState: { ...DEFAULT_TEAM_VIEW, taskId: task.id }, updateView: vi.fn(),
    translate: makeTranslate(en), canManage: true, busy: true, onForm: vi.fn(),
    readDetail: vi.fn(async () => {}), onStop }
  const view = render(<TaskWorkspace {...props} />)
  expect(view.getByText(en['detail.task.phase.stopping'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  const stop = view.getByRole('menuitem', { name: en['detail.task.stop'] })
  expect(stop.hasAttribute('disabled')).toBe(true)
  fireEvent.click(stop)
  expect(onStop).not.toHaveBeenCalled()
  const scroll = view.container.querySelector<HTMLElement>('[data-task-scroll]')
  if (scroll === null) throw new Error('Task table scroll viewport is missing')
  scroll.scrollTop = 55
  fireEvent.scroll(scroll)
  view.unmount()
  expect(props.updateView).toHaveBeenCalledWith({ taskListScroll: 0 })
})

it('renders an unavailable parent reference, integration evidence and rework review history', () => {
  const state = workspaceState()
  const participantId = 'review-worker' as never
  const artifact = { id: 'proposal', provider: 'local', kind: 'patch' as const,
    uri: 'artifact://proposal', visibility: 'team' as const }
  const attempt = { id: 'review-attempt' as never, teamId: state.team.id, taskId: 'Review evidence' as never,
    ordinal: 1, participantId, assignedAt: 1, leaseExpiresAt: 20, settledAt: 10,
    outcome: { kind: 'completed' as const, result: { summary: 'Ready for review', verification: 'Verified against source',
      integration: { target: 'main', status: 'proposed' as const, proposalArtifact: artifact } } } }
  const task = workspaceTask('Review evidence', { phase: 'completed', blockedBy: ['off-page-task' as never],
    attemptCount: 1, attemptHistory: [attempt], reviewHistory: [{ attemptId: attempt.id,
      reviewerId: participantId, nextPhase: 'pending', reason: 'Need a smaller change', decidedAt: 11 }] })
  const view = render(<TaskView state={{ ...state, tasks: [task] }} tasks={[task]} openArtifact={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  expect(view.getByRole('button', { name: /off-page-task/ })).toBeTruthy()
  expect(view.getByRole('button', { name: 'proposal' })).toBeTruthy()
  fireEvent.click(view.getByText(en['taskView.fullDetails']))
  expect(view.getByText('Verified against source')).toBeTruthy()
  expect(view.getByText('Need a smaller change')).toBeTruthy()
  expect(view.getByText(en['taskView.rework'])).toBeTruthy()
})

it('keeps a failed child Team explanation visible in the selected task', () => {
  const task = workspaceTask('Delegated task', { execution: { kind: 'child-team', templateId: 'child', templateVersion: 1,
    authorityGrant: { operations: [], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} }, budget: {} }, phase: 'failed',
  delegation: { id: 'child-attempt' as never, phase: 'failed', requestedAt: 1, updatedAt: 2,
    failure: { code: 'CHILD_UNAVAILABLE', message: 'Child Team could not start' } } })
  const view = render(<TaskView state={{ ...workspaceState(), tasks: [task] }} tasks={[task]} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  expect(view.getByText('Child Team could not start')).toBeTruthy()
})
