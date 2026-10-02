// @vitest-environment jsdom
/** Overview previews must not alter full-Team counts or silently fetch every journal page. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { TeamOverview as SourceTeamOverview } from '../src/client/TeamOverview.tsx'
import { TeamActivity as SourceTeamActivity } from '../src/client/TeamActivity.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceMemberSummary, workspaceSelection, workspaceTaskSummary, workspaceState, workspaceTask } from './workspace-fixtures.client.ts'
import type { TeamAuditList } from '@clocky/clocky-client-runtime/client'

function TeamOverview(props: Omit<Parameters<typeof SourceTeamOverview>[0], 'state'> & { state: ReturnType<typeof workspaceState> }) {
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  return <SourceTeamOverview {...props} state={workspaceSelection(props.state)}
    collections={{ teamId: props.state.team.id, members: { ...empty, items: props.state.participants.map(workspaceMemberSummary) },
      tasks: { ...empty, items: props.state.tasks.map(workspaceTaskSummary) }, workflowPlans: empty, artifacts: empty }} />
}
function TeamActivity(props: Omit<Parameters<typeof SourceTeamActivity>[0], 'state'> & { state: ReturnType<typeof workspaceState> }) {
  return <SourceTeamActivity {...props} state={workspaceSelection(props.state)} />
}

afterEach(cleanup)

it('labels a Simulation Team read-only while retaining explicit Session inspection', async () => {
  const { TeamHeader } = await import('../src/client/TeamHeader.tsx')
  const original = workspaceState()
  const state = workspaceSelection({ ...original, rules: { simulationRunId: 'run' },
    team: { ...original.team, phase: 'stalled' } })
  const onResume = vi.fn(async () => {})
  const onCancel = vi.fn(async () => {})
  const openCoordinator = vi.fn(async () => {})
  const view = render(<TeamHeader state={state} view="overview" translate={makeTranslate(en)}
    onResume={onResume} onCancel={onCancel} openCoordinator={openCoordinator} />)
  expect(view.getByText(en['workspace.simulationManaged'])).toBeTruthy()
  expect(view.queryByRole('button', { name: 'Resume' })).toBeNull()
  expect(view.queryByRole('button', { name: en['workspace.teamActions'] })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en['workspace.inspectCoordinator'] }))
  await waitFor(() => { expect(openCoordinator).toHaveBeenCalledOnce() })
  expect(onResume).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
})

it('keeps an off-page owner assigned when its member name is unavailable', () => {
  const task = workspaceTask('Assigned work', { phase: 'assigned', lease: { attemptId: 'attempt' as never, participantId: 'off-page-member' as never, activationId: 'activation' as never, assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1 } })
  const view = render(<TeamOverview state={{ ...workspaceState(), tasks: [task] }} translate={makeTranslate(en)}
    artifacts={[]} openTask={vi.fn()} navigate={vi.fn()} inspectActivity={vi.fn()} />)
  expect(view.getByRole('cell', { name: 'Assigned · off-page-member' })).toBeTruthy()
  expect(view.queryByText('Unassigned')).toBeNull()
})

it('counts the full Team while limiting task previews and opens the exact selected task', () => {
  const tasks = Array.from({ length: 9 }, (_, index) => workspaceTask(`Work ${index}`, { phase: index === 0 ? 'completed' : 'pending' }))
  const deleted = workspaceTask('Removed work', { phase: 'deleted' })
  const state = { ...workspaceState(), tasks: [...tasks, deleted] }
  const openTask = vi.fn()
  const navigate = vi.fn()
  const view = render(<TeamOverview
    state={state}
    translate={makeTranslate(en)}
    artifacts={[]}
    openTask={openTask}
    navigate={navigate}
    inspectActivity={vi.fn()} />)
  expect(view.getByText('Tasks completed').parentElement?.textContent).toBe('Tasks completed1 / 9')
  expect(view.getAllByRole('row')).toHaveLength(7)
  expect(view.queryByText('Removed work')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Work 1' }))
  expect(openTask).toHaveBeenCalledWith(tasks[1]!.id)
  expect(view.getByText('Nothing needs your attention')).toBeTruthy()
  expect(view.getByText('No published artifacts')).toBeTruthy()
})

it('keeps unavailable usage distinct from zero and includes cache usage without currency claims', () => {
  const base = workspaceState()
  const props = { translate: makeTranslate(en), artifacts: [], openTask: vi.fn(), navigate: vi.fn(), inspectActivity: vi.fn() }
  const view = render(<TeamOverview {...props} state={base} />)
  expect(view.getByText('Tokens').parentElement?.textContent).toContain('—')
  view.rerender(<TeamOverview
    {...props}
    state={{ ...base,
      usage: { inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 40,
        cacheWriteTokens: 10,
        turns: 2,
        costUnits: 3,
        updatedAt: 1 } }} />)
  const usage = view.getByText('Tokens').closest('details')
  expect(usage?.textContent).toContain('170')
  expect(usage?.textContent).toContain('Includes child Teams')
  expect(usage?.textContent).toContain('Cost units3')
  expect(usage?.textContent).not.toMatch(/[$¥]/)
})

it('reads a bounded recent suffix once, retains its display across updates, and refreshes from the latest cursor', async () => {
  const base = workspaceState()
  const state = { ...base, team: { ...base.team, cursor: 100 } }
  const page: TeamAuditList = { teamId: state.team.id, items: Array.from({ length: 7 }, (_, index) => ({
    teamId: state.team.id, stream: 'team', cursor: 94 + index, type: 'task/changed', createdAt: index + 1, facts: {},
  })) }
  const readAudit = vi.fn(async () => page)
  const inspect = vi.fn()
  const view = render(<TeamActivity state={state} translate={makeTranslate(en)} readAudit={readAudit} inspect={inspect} />)
  await waitFor(() => { expect(view.getAllByRole('listitem')).toHaveLength(5) })
  expect(readAudit).toHaveBeenCalledWith({ afterCursor: 92, limit: 8 }, expect.any(AbortSignal))
  view.rerender(<TeamActivity
    state={{ ...state,
      team: { ...state.team,
        cursor: 101 } }}
    translate={makeTranslate(en)}
    readAudit={readAudit}
    inspect={inspect} />)
  expect(readAudit).toHaveBeenCalledOnce()
  fireEvent.click(view.getAllByRole('button', { name: 'Execution task updated' })[0]!)
  expect(inspect).toHaveBeenCalledWith(100)
  fireEvent.click(view.getByRole('button', { name: 'Refresh activity' }))
  await waitFor(() => { expect(readAudit).toHaveBeenCalledTimes(2) })
  expect(readAudit).toHaveBeenLastCalledWith({ afterCursor: 93, limit: 8 }, expect.any(AbortSignal))
})

it('offers an explicit resume action for an offline coordinator without treating inspection as execution', async () => {
  const { TeamHeader } = await import('../src/client/TeamHeader.tsx')
  const state = workspaceState()
  const participantId = 'coordinator' as never
  const onResume = vi.fn(async () => {})
  const view = render(<TeamHeader state={workspaceSelection({ ...state,
    participants: [{ id: participantId, teamId: state.team.id, kind: 'local-agent', displayName: 'Coordinator', role: 'coordinator', capabilities: [], phase: 'active' }],
    activations: [{ activation: { id: 'offline-epoch' as never, teamId: state.team.id, participantId, status: 'offline' }, sessionId: 'offline-session' as never, provider: 'local' }],
  })} view="overview" translate={makeTranslate(en)} onResume={onResume} />)
  expect(onResume).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Resume' }))
  await waitFor(() => { expect(onResume).toHaveBeenCalledOnce() })
})

it('keeps aggregate counts independent from the one loaded task page', () => {
  const all = Array.from({ length: 9 }, (_, index) => workspaceTask(`Paged work ${index}`, { phase: index < 4 ? 'completed' : 'pending' }))
  const full = { ...workspaceState(), tasks: all }
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const view = render(<SourceTeamOverview state={workspaceSelection(full)} translate={makeTranslate(en)} artifacts={[]}
    collections={{ teamId: full.team.id, members: empty, workflowPlans: empty, artifacts: empty,
      tasks: { ...empty, items: [workspaceTaskSummary(all[0]!)], nextCursor: 0 } }}
    openTask={vi.fn()} navigate={vi.fn()} inspectActivity={vi.fn()} />)
  expect(view.getByText('Tasks completed').parentElement?.textContent).toContain('4 / 9')
  expect(view.getByText('Paged work 0')).toBeTruthy()
  expect(view.queryByText('Paged work 1')).toBeNull()
})

it('does not count a delivered action again on top of the authoritative pending total', () => {
  const state = workspaceState()
  const view = render(<SourceTeamOverview state={{ ...workspaceSelection(state), pendingHumanActionCount: 2,
    attentionCounts: { recovery: 0, humanActions: 2, reviews: 0, total: 2 } }}
  translate={makeTranslate(en)} artifacts={[]} openTask={vi.fn()} navigate={vi.fn()} inspectActivity={vi.fn()} />)
  expect(view.getByText('Needs your attention', { selector: 'dt' }).parentElement?.textContent).toContain('2')
})
