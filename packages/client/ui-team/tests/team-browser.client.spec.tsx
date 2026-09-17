import type { TeamStateSnapshot } from '@clocky/clocky-client-connection/client'
// @vitest-environment jsdom
import { DEFAULT_TEAM_VIEW } from '../src/client/workspace-store.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Context } from '@clocky/cordis'
import type { IApiClient } from '@clocky/clocky-client-connection/client'
import { TeamTaskRuntime } from '../../runtime/src/client/teams/service.ts'
import { bindSnapshotSelector, makeTranslate } from '@clocky/clocky-client-test-runtime'
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'
import type { ChannelId, TeamCollectionsState, TeamId, TeamManagementCommand, TeamTaskListState, TeamChannelState, WorkspaceListState } from '@clocky/clocky-client-runtime/client'
import { TeamBrowser } from '../src/client/TeamBrowser.tsx'
import { TeamPage as SourceTeamPage, type TeamPageProps } from '../src/client/TeamPage.tsx'
import { TeamTaskDialog as SourceTaskDialog } from '../src/client/TeamTaskDialog.tsx'
import { workspaceWorkflowSummary, workspaceWorkflowDetail, workspaceMemberSummary, workspaceSelection, workspaceTask, workspaceTaskSummary, workspaceTaskDetail } from './workspace-fixtures.client.ts'
import type { TeamBrowserProps } from '../src/client/TeamBrowser.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('keeps the selected Team visible outside the current sidebar page and offers a first-page action', async () => {
  const firstTeamPage = vi.fn(async () => {})
  const f = props({ firstTeamPage })
  const full = pageState('selected-outside-page')
  const memberId = 'coordinator' as never
  const sessionId = 'selected-session' as never
  const selection = workspaceSelection({ ...full,
    participants: [{ id: memberId, teamId: full.team.id, kind: 'local-agent', role: 'coordinator',
      displayName: 'Coordinator', capabilities: [], phase: 'active' }],
    activations: [{ activation: { id: 'epoch' as never, teamId: full.team.id, participantId: memberId, status: 'idle' },
      sessionId, provider: 'local' }],
  })
  f.state.set({ ...f.state.getSnapshot(), items: [team('current-page', 'active')], startCursor: 'previous-page' as never,
    current: full.team.id, selected: { teamId: full.team.id, state: selection, coordinatorSessionId: sessionId } })
  const view = render(<TeamBrowser {...f.props} />)
  expect(view.getByRole('button', { name: /Objective selected-outside-page/ }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(view.getByRole('button', { name: 'First page' }))
  await waitFor(() => { expect(firstTeamPage).toHaveBeenCalledOnce() })
  expect(f.state.getSnapshot().items).toHaveLength(1)
  expect(view.getAllByRole('listitem')).toHaveLength(2)
})


function go(view: ReturnType<typeof render>, name: string): void {
  const navigation = within(view.getByRole('navigation', { name: 'Team modules' }))
  if (name === 'Workflows' || name === 'Audit') {
    fireEvent.click(navigation.getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!)
    fireEvent.click(view.getByRole('menuitem', { name }))
  } else fireEvent.click(navigation.getByRole('button', { name }))
}

function channelDetails(view: ReturnType<typeof render>): void {
  const button = view.getByRole('button', { name: 'Channel details' })
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button)
}

function taskMenu(view: ReturnType<typeof render>, subject: string): void {
  fireEvent.click(view.getByRole('button', { name: subject }))
  fireEvent.click(view.getByRole('button', { name: 'More actions' }))
}

/** Standalone module tests retain navigation locally, as the real workspace store does. */
function RawTeamPage(props: Omit<TeamPageProps, 'state'> & { state: TeamStateSnapshot }) {
  const [view, setView] = useState(props.view ?? 'channels')
  useEffect(() => { setView(props.view ?? 'channels') }, [props.view])
  const complete = (task: TeamStateSnapshot['tasks'][number]) => workspaceTask(String(task.id), { ...task, teamId: props.state.team.id })
  const tasks = props.state.tasks.map(complete)
  const [workflowId, setWorkflowId] = useState<string>()
  const workflow = props.state.workflowPlans?.find(plan => plan.id === workflowId)
  const [taskView, setTaskView] = useState({ ...DEFAULT_TEAM_VIEW, view })
  const selected = tasks.find(task => task.id === taskView.taskId)
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  return <SourceTeamPage {...props} state={workspaceSelection({ ...props.state, tasks })} humanActions={props.state.humanActions}
    view={view} onViewChange={setView}
    taskView={taskView} onTaskViewChange={(patch) => { setTaskView(current => ({ ...current, ...patch })) }}
    workflowDetail={workflow === undefined ? undefined : workspaceWorkflowDetail(workflow)}
    readWorkflowDetail={async (id) => { setWorkflowId(id) }} closeWorkflowDetail={() => { setWorkflowId(undefined) }}
    readTaskDetail={async () => {}} taskDetail={selected === undefined ? undefined : workspaceTaskDetail(selected)}
    collections={props.collections ?? { teamId: props.state.team.id,
      members: { ...empty, items: props.state.participants.map(workspaceMemberSummary) },
      tasks: { ...empty, items: tasks.map(workspaceTaskSummary) },
      workflowPlans: { ...empty, items: (props.state.workflowPlans ?? []).map(workspaceWorkflowSummary) },
      artifacts: { ...empty, items: [...tasks.flatMap(task => task.attemptHistory.flatMap(attempt => attempt.outcome.kind === 'completed'
        ? [...(attempt.outcome.result.artifacts ?? []),
          ...(attempt.outcome.result.integration?.proposalArtifact === undefined ? []
            : [attempt.outcome.result.integration.proposalArtifact]),
          ...(attempt.outcome.result.integration?.artifacts ?? [])] : [])),
      ...tasks.flatMap(task => task.delegation?.result?.artifacts ?? []),
      ...props.state.workspaceAllocations.flatMap(allocation => allocation.loss?.artifacts ?? [])].filter(artifact => artifact.visibility !== 'private') } }} />
}

/** Supply explicit preloaded task inspection to isolated form tests. */
function TeamTaskDialog(props: Omit<Parameters<typeof SourceTaskDialog>[0], 'state'> & { state: TeamStateSnapshot }) {
  const target = props.target
  const task = 'taskId' in target ? props.state.tasks.find(task => task.id === target.taskId) : undefined
  const inspection = task === undefined ? undefined : workspaceTaskDetail(workspaceTask(String(task.id),
    { ...task, teamId: props.state.team.id }))
  return <SourceTaskDialog {...props} inspection={inspection} />
}

/** Drive channel presentation from the same runtime owner as the assembled UI. */
function TeamPage(props: Omit<TeamPageProps, 'state'> & { state: TeamStateSnapshot }) {
  const latest = useRef(props)
  latest.current = props
  const [owner] = useState(() => {
    const ctx = new Context()
    const channelSnapshot = (id: ChannelId) => ({ manifest: { id, teamId: latest.current.state.team.id,
      adapter: { type: 'direct', version: 4 }, participants: [], limits: {} }, phase: 'closed', cursor: 1 })
    const api = { teams: {
      channelCatalog: async () => ({ result: { ok: true, value: { adapters: [{ type: 'direct', version: 4 }], viewPolicies: [{ type: 'directed', version: 1 }] } } }),
      channelList: async () => ({ result: { ok: true, value: { items: latest.current.state.channelIds.map(channelSnapshot) } } }),
      channelAdmission: async (input: { channelId: ChannelId }) => ({ result: { ok: true,
        value: { channel: channelSnapshot(input.channelId),
          invitations: [],

          expectedNext: { kind: 'none' }, protocolStatus: { kind: 'other' } } } }),
      channelRead: async (input: { channelId: ChannelId; afterCursor?: number }, signal?: AbortSignal) => {
        const page = await latest.current.readChannel!(input.channelId, input.afterCursor, signal)
        const channel = page.channel ?? { manifest: { id: input.channelId, teamId: latest.current.state.team.id,
          adapter: { type: 'direct', version: 4 }, participants: [], limits: {} }, phase: 'closed', cursor: 1 }
        return { result: { ok: true, value: { ...page, channel } } }
      },
      channelInvitation: async () => ({ result: { ok: false, error: { code: 'not-found', message: 'No test invitation', details: {} } } }),
      channelWatch: async (_input: unknown, signal: AbortSignal) => await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new DOMException('Observation cancelled', 'AbortError')) }, { once: true })
      }),
    } } as unknown as IApiClient
    const runtime = new TeamTaskRuntime(ctx, api)
    return { ctx, runtime, readChannels: async (id: TeamId, mode?: 'refresh' | 'next' | 'first') => { await runtime.readChannels(id, mode) } }
  })
  const snapshot = useSyncExternalStore(listener => owner.runtime.list.subscribe(listener), () => owner.runtime.list.getSnapshot())
  useEffect(() => () => { void owner.ctx.fiber.dispose() }, [owner])
  if (props.channelState !== undefined || props.channelListState !== undefined) return <RawTeamPage view="tasks" {...props} />
  return <RawTeamPage view="tasks" {...props} {...snapshot.channel === undefined ? {} : { channelState: { ...snapshot.channel, invitationError: undefined } }}
    {...snapshot.channels === undefined ? {} : { channelListState: snapshot.channels }} readChannels={owner.readChannels}
    {...props.readChannel === undefined ? {} : { readChannel: async (...args) => await owner.runtime.readChannel(...args) }} />
}

function team(id: string, phase: TeamTaskListState['items'][number]['phase']): TeamTaskListState['items'][number] {
  const teamId = id as TeamId
  const goal = { teamId, revision: 1, objective: `Objective ${id}`, phase: 'active' as const, budgets: {} }
  return {
    id: teamId,
    depth: 0,
    maxTeamDepth: 4,
    goal,
    phase,
    cursor: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function props(overrides: Partial<TeamBrowserProps> = {}) {
  const state = createSnapshotStore<TeamTaskListState>({
    items: [], current: undefined, selected: undefined, phase: 'ready', state: 'idle', error: null, draft: undefined,
  })
  const openTeam = vi.fn(() => Promise.resolve())
  const archiveTeam = vi.fn(() => Promise.resolve())
  const expandSidebar = vi.fn()
  return {
    state,
    openTeam,
    archiveTeam,
    expandSidebar,
    props: {
      wide: true,
      expandSidebar,
      openTeam,
      archiveTeam,
      useTasks: bindSnapshotSelector(state),
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
      t: makeTranslate(en),
      ...overrides,
    } satisfies TeamBrowserProps,
  }
}

function pageState(id: string, phase: TeamTaskListState['items'][number]['phase'] = 'active'): TeamStateSnapshot {
  const teamId = id as TeamId
  const goal = { teamId, revision: 1, objective: `Objective ${id}`, phase: 'active' as const, budgets: {} }
  return {
    team: { ...team(id, phase), goal },
    goal,
    rules: {},
    budgets: {},
    participants: [],
    activations: [],
    tasks: [],
    channelIds: [],
    workspaceAllocations: [],
  }
}

describe('TeamBrowser', () => {
  it('keeps the draft workspace selector out of the task list while retaining Add workspace', async () => {
    const pickDirectory = vi.fn(async () => '/tmp/project')
    const b = props({ pickDirectory })
    b.state.set({
      ...b.state.getSnapshot(),
      draft: { idempotencyKey: 'draft-ui' as never, phase: 'ready', error: undefined, message: undefined },
    })
    const view = render(<TeamBrowser {...b.props} />)

    expect(view.queryByText('Project folder')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Add workspace' }))
    await waitFor(() => {
      expect(pickDirectory).toHaveBeenCalledOnce()
    })
  })

  it('groups Teams under registered Workspaces and starts a draft in one folder', async () => {
    const workspace = {
      workspaceId: 'workspace-one' as never,
      path: '/tmp/project',
      title: 'Project one',
      sessionIds: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
    const workspaces = createSnapshotStore<WorkspaceListState>({
      items: [workspace], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: workspace.workspaceId,
    })
    const startDraft = vi.fn()
    const b = props({
      useWorkspaces: bindSnapshotSelector(workspaces),
      startDraft,
    })
    b.state.set({
      ...b.state.getSnapshot(),
      items: [{ ...team('one', 'active'), workspacePath: workspace.path }],
    })
    const view = render(<TeamBrowser {...b.props} />)
    expect(view.getByRole('region', { name: 'Project one' })).toBeTruthy()
    expect(view.getByText('Objective one')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'New task in this workspace Project one' }))
    expect(startDraft).toHaveBeenCalledWith({ cwd: workspace.path })
  })

  it('uses the collapsed rail control to request sidebar expansion', () => {
    const b = props({ wide: false })
    const view = render(<TeamBrowser {...b.props} />)
    fireEvent.click(view.getByRole('button', { name: 'Expand task list' }))
    expect(b.expandSidebar).toHaveBeenCalledOnce()
  })

  it('distinguishes a pending list baseline from an empty ready list', () => {
    const b = props()
    b.state.set({ ...b.state.getSnapshot(), phase: 'pending' })
    const view = render(<TeamBrowser {...b.props} />)
    expect(view.getByText('Loading tasks…')).toBeTruthy()
    act(() => { b.state.set({ ...b.state.getSnapshot(), phase: 'ready' }) })
    expect(view.getByText('No tasks yet')).toBeTruthy()
  })

  it('renders every Team phase and resolves selection once while an open is pending', async () => {
    const b = props()
    const teams = [
      team('one', 'provisioning'), team('two', 'active'), team('three', 'quiescing'),
      team('four', 'completed'), team('five', 'failed'), team('six', 'cancelled'),
    ]
    b.state.set({ ...b.state.getSnapshot(), items: teams, current: teams[1]!.id })
    let release!: () => void
    b.openTeam.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    const view = render(<TeamBrowser {...b.props} />)

    for (const label of ['Preparing', 'In progress', 'Finishing', 'Completed', 'Failed', 'Cancelled']) {
      expect(view.getByText(label)).toBeTruthy()
    }
    expect(view.getByText('Objective two').closest('button')?.getAttribute('aria-current')).toBe('page')
    fireEvent.click(view.getByText('Objective one'))
    fireEvent.click(view.getByText('Objective two'))
    expect(b.openTeam).toHaveBeenCalledWith(teams[0]!.id)
    expect(b.openTeam).toHaveBeenCalledOnce()
    release()
    await waitFor(() => {
      expect(view.getByText('Objective two').closest('button')?.hasAttribute('disabled')).toBe(false)
    })
  })

  it('keeps an open failure beside the Team list', async () => {
    const b = props()
    const item = team('one', 'active')
    b.state.set({ ...b.state.getSnapshot(), items: [item] })
    b.openTeam.mockRejectedValueOnce(new Error('coordinator unavailable'))
    const view = render(<TeamBrowser {...b.props} />)
    fireEvent.click(view.getByText('Objective one'))
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toContain('coordinator unavailable')
    })
  })

  it('archives only terminal Teams through the injected owner', async () => {
    const b = props()
    const active = team('active', 'active')
    const completed = team('completed', 'completed')
    b.state.set({ ...b.state.getSnapshot(), items: [active, completed] })
    const view = render(<TeamBrowser {...b.props} />)
    expect(view.queryByRole('button', { name: 'Archive Objective active' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Archive Objective completed' }))
    await waitFor(() => { expect(b.archiveTeam).toHaveBeenCalledWith(completed.id) })
  })

  it('reports archive and mutation failures while clearing their busy state', async () => {
    const cancelTeam = vi.fn(async () => { throw new Error('cancel failed') })
    const resumeTeam = vi.fn(async () => {})
    const b = props({ cancelTeam, resumeTeam })
    const stalled = team('stalled', 'stalled')
    const active = team('active', 'active')
    const completed = team('completed', 'completed')
    b.state.set({ ...b.state.getSnapshot(), items: [stalled, active, completed] })
    b.archiveTeam.mockRejectedValueOnce(new Error('archive failed'))
    const view = render(<TeamBrowser {...b.props} />)

    fireEvent.click(view.getByRole('button', { name: 'Resume Objective stalled' }))
    await waitFor(() => { expect(resumeTeam).toHaveBeenCalledWith(stalled.id) })
    fireEvent.click(view.getByRole('button', { name: 'Cancel Objective active' }))
    await waitFor(() => { expect(cancelTeam).toHaveBeenCalledWith(active.id) })
    expect(view.getByRole('alert').textContent).toContain('cancel failed')
    fireEvent.click(view.getByRole('button', { name: 'Archive Objective completed' }))
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('archive failed') })
  })

  it('runs stalled-Team actions and renders durable human-attention states', async () => {
    const base = pageState('action-team', 'stalled')
    const taskId = 'review-task' as never
    const state = {
      ...base,
      team: {
        ...base.team,
        stallReason: { code: 'RECOVERY_REQUIRED', message: 'Coordinator needs recovery.' },
        cancellation: { idempotencyKey: 'cancel-action-team', requestedAt: 2, reason: { code: 'USER_CANCELLED', message: 'Cancellation requested.' } },
      },
      budgets: { inputTokens: 10 },
      usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, turns: 1, costUnits: 4, updatedAt: 1 },
      participants: [
        { id: 'human-attention-participant' as never, teamId: base.team.id, kind: 'remote-agent', displayName: 'Worker', role: 'worker', capabilities: [], phase: 'active' },
        { id: 'unbound-attention-participant' as never, teamId: base.team.id, kind: 'human', displayName: 'Human', role: 'human', capabilities: [], phase: 'active' },
      ],
      activations: [
        { activation: { id: 'attention-activation-1' as never, teamId: base.team.id, participantId: 'human-attention-participant' as never, status: 'running' }, sessionId: 'attention-session-1' as never, provider: 'sdk' },
        { activation: { id: 'attention-activation-2' as never, teamId: base.team.id, participantId: 'human-attention-participant' as never, status: 'idle' }, sessionId: 'attention-session-2' as never, provider: 'sdk' },
      ],
      tasks: [{
        id: taskId,
        teamId: base.team.id,
        revision: 1,
        subject: 'Review the patch',
        description: 'Wait for human review.',
        phase: 'review',
        blockedBy: ['dependency-task' as never],
        attemptCount: 1,
        maxAttempts: 2,
        attemptHistory: [{ outcome: { kind: 'failed' } }],
      }],
    } as unknown as TeamStateSnapshot
    const onResume = vi.fn(async () => {})
    const onCancel = vi.fn(async () => {})
    const readAudit = vi.fn(async () => ({ teamId: base.team.id, items: [] } as never))
    const pendingActions = [
      { kind: 'approval', requestId: 'approval-1', toolName: 'delete-file', taskId },
      { kind: 'question', requestId: 'question-1', questions: [{}] },
    ] as never
    const view = render(<TeamPage view="overview"
      state={state}
      translate={makeTranslate(en)}
      onResume={onResume}
      onCancel={onCancel}
      readAudit={readAudit}
      pendingActions={pendingActions}
    />)

    expect(view.getByText('Coordinator needs recovery.')).toBeTruthy()
    expect(view.getByText('Cancellation requested.')).toBeTruthy()
    expect(view.getAllByText('Review the patch').length).toBeGreaterThan(0)
    expect(view.getByText(/Approval.*delete-file/)).toBeTruthy()
    expect(view.getByText('Question')).toBeTruthy()
    expect(view.queryByText('No Session available')).toBeNull()
    expect(view.getByRole('region', { name: 'Team members' })).toBeTruthy()
    expect(view.getByText('Tokens').parentElement?.textContent).toContain('Tokens5')

    fireEvent.click(view.getByRole('button', { name: 'Resume' }))
    await waitFor(() => { expect(onResume).toHaveBeenCalledOnce() })
    expect(view.queryByRole('button', { name: 'Team actions' })).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
    go(view, 'Audit')
    fireEvent.click(view.getByRole('button', { name: 'Audit timeline' }))
    await waitFor(() => {
      expect(readAudit).toHaveBeenCalledWith({ limit: 64 }, expect.any(AbortSignal))
      expect(view.getByText('No audit records')).toBeTruthy()
    })
  })

  it('keeps task details compact and deletes a lease-free task after confirmation', async () => {
    const teamId = 'compact-task-team' as TeamId
    const taskId = 'compact-task' as never
    const state = {
      ...pageState('compact-task-team'),
      participants: [],
      activations: [],
      budgets: {},
      usage: undefined,
      tasks: [{
        id: taskId,
        teamId,
        revision: 2,
        subject: 'Remove stale task',
        description: 'This task no longer needs to be retained.',
        phase: 'pending' as const,
        blockedBy: [],
        attemptCount: 0,
        maxAttempts: 1,
        attemptHistory: [],
      }],
      channelIds: [],
    } as unknown as TeamStateSnapshot
    const deleteTask = vi.fn(async () => {})
    const view = render(<TeamPage state={state} translate={makeTranslate(en)} deleteTask={deleteTask} />)

    expect(view.queryByText('compact-task-team')).toBeNull()
    expect(view.queryByText('Attempts')).toBeNull()
    expect(view.queryByText('Limits')).toBeNull()
    expect(view.queryByRole('region', { name: 'Human attention' })).toBeNull()
    expect(view.queryByRole('region', { name: 'Artifacts' })).toBeNull()
    taskMenu(view, 'Remove stale task')
    fireEvent.click(view.getByRole('menuitem', { name: 'Delete task' }))
    const dialog = view.getByRole('dialog', { name: 'Delete task' })
    expect(within(dialog).getByText(/Remove stale task/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    await waitFor(() => {
      expect(deleteTask).toHaveBeenCalledWith(taskId, 2, expect.any(AbortSignal))
      expect(view.queryByRole('dialog', { name: 'Delete task' })).toBeNull()
      expect(view.queryByText('Remove stale task')).toBeNull()
    })
  })

  it('projects an admitted child-Team result and opens the retained child Team', () => {
    const teamId = 'parent-team' as TeamId
    const childTeamId = 'child-team' as TeamId
    const artifact = { id: 'child-report', provider: 'local', kind: 'report' as const, uri: 'artifact://child-report', visibility: 'team' as const }
    const state = {
      ...pageState('parent-team'),
      tasks: [{
        id: 'delegated-task' as never,
        teamId,
        revision: 4,
        subject: 'Delegate the investigation',
        description: 'Run the investigation in a child Team.',
        phase: 'completed' as const,
        blockedBy: [],
        attemptCount: 1,
        maxAttempts: 1,
        attemptHistory: [],
        execution: { kind: 'child-team' as const },
        delegation: {
          id: 'delegation-1',
          phase: 'completed' as const,
          requestedAt: 1,
          updatedAt: 5,
          childTeamId,
          result: { text: 'Child result retained.', artifacts: [artifact] },
        },
      }],
      channelIds: [],
    } as unknown as TeamStateSnapshot
    const openTeam = vi.fn(async () => {})
    const view = render(<TeamPage state={state} translate={makeTranslate(en)} openTeam={openTeam} />)

    fireEvent.click(view.getByRole('button', { name: state.tasks[0]!.subject }))
    expect(view.getByText('Child task · Completed')).toBeTruthy()
    expect(view.getByText('Child result retained.')).toBeTruthy()
    go(view, 'Artifacts')
    expect(view.getByText('child-report')).toBeTruthy()
    go(view, 'Tasks')
    fireEvent.click(view.getByRole('button', { name: state.tasks[0]!.subject }))
    fireEvent.click(view.getByRole('button', { name: 'Open child task' }))
    expect(openTeam).toHaveBeenCalledWith(childTeamId)
  })

  it('overlays newer selected child facts onto an already loaded bounded task row', () => {
    const teamId = 'parent-overlay-team' as TeamId
    const childTeamId = 'child-overlay-team' as TeamId
    const stale = {
      id: 'overlay-task' as never, teamId, revision: 1, subject: 'Overlay child', description: 'Refresh child facts.', phase: 'running' as const,
      blockedBy: [], attemptCount: 1, maxAttempts: 1, attemptHistory: [], execution: { kind: 'child-team' as const },
      delegation: { id: 'overlay-delegation', phase: 'active' as const, requestedAt: 1, updatedAt: 2 },
    }
    const current = { ...stale, revision: 2, delegation: { ...stale.delegation, childTeamId } }
    const state = { ...pageState(String(teamId)), tasks: [current] } as unknown as TeamStateSnapshot
    const collections: TeamCollectionsState = {
      teamId,
      members: { items: [], loading: false, loadingMore: false, hasNewer: false },
      tasks: { items: [workspaceTaskSummary(stale as never)], loading: false, loadingMore: false, hasNewer: false },
      workflowPlans: { items: [], loading: false, loadingMore: false, hasNewer: false },
      artifacts: { items: [], loading: false, loadingMore: false, hasNewer: false },
    }
    const openTeam = vi.fn(async () => {})
    const view = render(<TeamPage state={state} collections={collections} translate={makeTranslate(en)} openTeam={openTeam} />)

    fireEvent.click(view.getByRole('button', { name: 'Overlay child' }))
    fireEvent.click(view.getByRole('button', { name: 'Open child task' }))
    expect(openTeam).toHaveBeenCalledWith(childTeamId)
  })

  it('renders bounded member/task collections and requests explicit continuation pages', () => {
    const teamId = 'paged-team' as TeamId
    const worker = { id: 'paged-worker' as never, teamId, kind: 'local-agent' as const, displayName: 'Paged worker', role: 'worker', capabilities: [], phase: 'active' as const }
    const collections: TeamCollectionsState = {
      teamId,
      members: { items: [workspaceMemberSummary(worker)], nextCursor: 0, loading: false, loadingMore: false, hasNewer: false },
      tasks: { items: [], nextCursor: 0, loading: false, loadingMore: false, hasNewer: false },
      workflowPlans: { items: [], nextCursor: 0, loading: false, loadingMore: false, hasNewer: false },
      artifacts: { items: [], nextCursor: 0, loading: false, loadingMore: false, hasNewer: false },
    }
    const readCollections = vi.fn(async () => {})
    const view = render(<TeamPage view="members" state={pageState('paged-team')} collections={collections}
      translate={makeTranslate(en)} readCollections={readCollections} />)

    expect(view.getByText('Paged worker')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Next member page' }))
    go(view, 'Tasks')
    fireEvent.click(view.getByRole('button', { name: 'Next task page' }))
    go(view, 'Artifacts')
    fireEvent.click(view.getByRole('button', { name: 'Next artifact page' }))
    expect(readCollections).toHaveBeenNthCalledWith(1, 'members', 'next')
    expect(readCollections).toHaveBeenNthCalledWith(2, 'tasks', 'next')
    expect(readCollections).toHaveBeenNthCalledWith(3, 'artifacts', 'next')
    view.rerender(<TeamPage view="artifacts" state={pageState('paged-team')}
      collections={{ ...collections, artifacts: { ...collections.artifacts, startCursor: 0, nextCursor: undefined } }}
      translate={makeTranslate(en)} readCollections={readCollections} />)
    fireEvent.click(view.getByRole('button', { name: 'First page' }))
    expect(readCollections).toHaveBeenLastCalledWith('artifacts', 'first')
  })

  it.each([false, true])('keeps all four bounded collections visible when a read fails=%s', (failed) => {
    const state = pageState('retained-collections')
    const member = (id: string, displayName: string) => ({ id: id as never, teamId: state.team.id, displayName,
      kind: 'local-agent' as const, role: 'worker', phase: 'active' as const, capabilities: [] })
    const task = (id: string, subject: string) => ({ id: id as never, teamId: state.team.id, revision: 1, subject,
      description: subject, phase: 'pending', blockedBy: [], attemptCount: 0, maxAttempts: 1, attemptHistory: [] }) as never
    const workflow = (id: string, name: string) => ({ id: id as never, teamId: state.team.id, revision: 1,
      idempotencyKey: id as never, phase: 'ready', taskBindings: [], plan: { version: 1, name, tasks: [],
        bounds: { maxTasks: 0, maxParallelism: 1, maxTotalAttempts: 0 },
        channel: { participantRoles: [], graph: { initial: { kind: 'terminate' }, transitions: [], maxTurns: 1 } },
        result: { kind: 'task-results', taskTemplateIds: [] } } }) as never
    const page = { loading: false, loadingMore: false, hasNewer: true, nextCursor: 0,
      ...failed ? { error: 'collection unavailable' } : {} }
    const collections: TeamCollectionsState = {
      teamId: state.team.id,
      members: { ...page, items: [workspaceMemberSummary(member('retained-member', 'Retained member'))] },
      tasks: { ...page, items: [workspaceTaskSummary(task('retained-task', 'Retained task'))] },
      workflowPlans: { ...page, items: [workspaceWorkflowSummary(workflow('retained-plan', 'Retained workflow'))] },
      artifacts: { ...page, items: [{ id: 'retained-artifact', kind: 'report', visibility: 'team' } as never] },
    }
    const view = render(<TeamPage view="members" state={{ ...state, participants: [member('unpaged-member', 'Unpaged member')],
      tasks: [task('unpaged-task', 'Unpaged task')], workflowPlans: [workflow('unpaged-plan', 'Unpaged workflow')],
      workspaceAllocations: [{ id: 'unpaged-loss', loss: { artifacts: [{ id: 'unpaged-artifact', kind: 'report', visibility: 'team' }] } } as never] }}
    collections={collections} translate={makeTranslate(en)} readCollections={vi.fn(async () => {})} />)
    for (const [module, label, absent] of [['Members', 'Retained member', 'Unpaged member'], ['Tasks', 'Retained task', 'Unpaged task'], ['Workflows', 'Retained workflow', 'Unpaged workflow'], ['Artifacts', 'retained-artifact', 'unpaged-artifact']]) {
      go(view, module!)
      expect(view.getByText(label!)).toBeTruthy()
      expect(view.queryByText(absent!)).toBeNull()
      expect(view.queryAllByRole('alert')).toHaveLength(failed ? 1 : 0)
    }
  })

  it.each(['newer', 'failed'])('offers explicit per-collection refresh for %s empty pages', (reason) => {
    const teamId = 'newer-collections-team' as TeamId
    const page = { items: [], loading: false, loadingMore: false, hasNewer: reason === 'newer',
      ...reason === 'failed' ? { error: 'page unavailable' } : {} }
    const collections: TeamCollectionsState = {
      teamId,
      members: page,
      tasks: page,
      workflowPlans: page,
      artifacts: page,
    }
    const readCollections = vi.fn(async () => {})
    const view = render(<TeamPage view="members" state={pageState(teamId)} collections={collections}
      translate={makeTranslate(en)} readCollections={readCollections} />)

    fireEvent.click(view.getByRole('button', { name: 'Refresh members' }))
    go(view, 'Tasks')
    fireEvent.click(view.getByRole('button', { name: 'Refresh tasks' }))
    go(view, 'Workflows')
    fireEvent.click(view.getByRole('button', { name: 'Refresh workflows' }))
    go(view, 'Artifacts')
    fireEvent.click(view.getByRole('button', { name: 'Refresh artifacts' }))
    expect(readCollections.mock.calls).toEqual([['members'], ['tasks'], ['workflowPlans'], ['artifacts']])
  })

  it('keeps an explicit task refresh action available for a loaded bounded page', () => {
    const teamId = 'task-refresh-team' as TeamId
    const task = { id: 'task-refresh-row' as never, teamId, revision: 1, subject: 'Refresh row', description: 'Refresh it.', phase: 'running' as const,
      blockedBy: [], attemptCount: 1, maxAttempts: 1, attemptHistory: [] } as never
    const collections: TeamCollectionsState = {
      teamId,
      members: { items: [], loading: false, loadingMore: false, hasNewer: false },
      tasks: { items: [workspaceTaskSummary(task)], loading: false, loadingMore: false, hasNewer: false },
      workflowPlans: { items: [], loading: false, loadingMore: false, hasNewer: false },
      artifacts: { items: [], loading: false, loadingMore: false, hasNewer: false },
    }
    const readCollections = vi.fn(async () => {})
    const view = render(<TeamPage state={pageState(String(teamId))} collections={collections}
      translate={makeTranslate(en)} readCollections={readCollections} />)

    go(view, 'Tasks')
    fireEvent.click(view.getByRole('button', { name: 'Refresh tasks' }))
    expect(readCollections).toHaveBeenCalledWith('tasks')
  })

  it('projects a read-only workflow plan with dependency links and terminal failure', () => {
    const base = pageState('workflow-page')
    const taskId = 'workflow-task' as never
    const state = {
      ...base,
      tasks: [{ id: taskId, teamId: base.team.id, revision: 1, subject: 'Build report', description: 'Build it.', phase: 'failed', blockedBy: [],
        attemptCount: 1, maxAttempts: 1, attemptHistory: [] }],
      workflowPlans: [{
        id: 'workflow-plan' as never, teamId: base.team.id, revision: 2, idempotencyKey: 'workflow-key' as never,
        plan: { version: 1, name: 'Quarterly workflow', tasks: [
          { id: 'prepare' as never, subject: 'Prepare data', description: 'Prepare it.', blockedBy: [], requiredCapabilities: [], priority: 0,
            readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 },
          { id: 'report' as never, subject: 'Build report', description: 'Build it.', blockedBy: ['prepare' as never], requiredCapabilities: [], priority: 0,
            readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 },
        ], bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 }, channel: { participantRoles: [], graph: { initial: { kind: 'terminate' }, transitions: [], maxTurns: 1 } }, result: { kind: 'task-results', taskTemplateIds: [] } },
        phase: 'failed', taskBindings: [{ templateId: 'report' as never, taskId }], failure: { code: 'WORKFLOW_FAILED', message: 'The report task failed.' },
      }],
    } as unknown as TeamStateSnapshot
    const view = render(<TeamPage view="workflows" state={state} translate={makeTranslate(en)} />)

    const workflow = view.getByRole('region', { name: 'Workflow plans' })
    expect(within(workflow).getByText('Quarterly workflow')).toBeTruthy()
    expect(within(workflow).getByText('Failed')).toBeTruthy()
    fireEvent.click(within(workflow).getByRole('button', { name: 'Quarterly workflow' }))
    expect(within(workflow).getByText('Build report')).toBeTruthy()
    expect(within(workflow).getByText(/Depends on:/).textContent).toMatch(/Depends on:\s+Prepare data/)
    expect(within(workflow).getByText(/Failure: The report task failed\./)).toBeTruthy()
    expect(view.getByRole('link', { name: 'Build report' }).getAttribute('href')).toBe(`#team-task-${String(taskId)}`)
  })

  it('projects every durable workflow lifecycle phase and a completed result count', () => {
    const base = pageState('workflow-lifecycle-page')
    const plan = {
      version: 1,
      name: 'Lifecycle workflow',
      tasks: [],
      bounds: { maxTasks: 0, maxParallelism: 1, maxTotalAttempts: 0 },
      channel: { participantRoles: [], graph: { initial: { kind: 'terminate' }, transitions: [], maxTurns: 1 } },
      result: { kind: 'task-results', taskTemplateIds: [] },
    }
    const common = {
      teamId: base.team.id,
      revision: 1,
      idempotencyKey: 'lifecycle-key' as never,
      plan,
      taskBindings: [],
    }
    const state = {
      ...base,
      workflowPlans: [
        { ...common, id: 'compiling-plan' as never, phase: 'compiling' as const },
        { ...common, id: 'ready-plan' as never, phase: 'ready' as const },
        { ...common, id: 'completed-plan' as never, phase: 'completed' as const,
          result: { kind: 'task-results' as const, tasks: [] } },
        { ...common, id: 'cancelled-plan' as never, phase: 'cancelled' as const,
          cancellation: { code: 'TEAM_CANCELLED', message: 'The Team was cancelled by the owner.' } },
      ],
    } as unknown as TeamStateSnapshot
    const view = render(<TeamPage view="workflows" state={state} translate={makeTranslate(en)} />)
    const workflow = view.getByRole('region', { name: 'Workflow plans' })

    expect(within(workflow).getByText('Compiling')).toBeTruthy()
    expect(within(workflow).getByText('Ready')).toBeTruthy()
    expect(within(workflow).getByText('Completed')).toBeTruthy()
    expect(within(workflow).getByText('Cancelled')).toBeTruthy()
    fireEvent.click(within(workflow).getAllByRole('button', { name: 'Lifecycle workflow' })[3]!)
    expect(within(workflow).getByText(/Cancellation: The Team was cancelled by the owner\./)).toBeTruthy()
    fireEvent.click(within(workflow).getAllByRole('button', { name: 'Lifecycle workflow' })[2]!)
    expect(within(workflow).getByText('Result tasks: 0')).toBeTruthy()
  })

  it('opens off-page workflow tasks using the loaded plan revision', () => {
    const state = pageState('workflow-task-focus')
    const task = (id: string) => ({ id: id as never, teamId: state.team.id, revision: 1, subject: id,
      description: 'Task details', phase: 'pending', blockedBy: [], attemptCount: 0, maxAttempts: 1, attemptHistory: [] }) as never
    const plan = { id: 'focus-plan' as never, teamId: state.team.id, revision: 1, phase: 'compiling',
      idempotencyKey: 'focus-plan' as never, taskBindings: [{ templateId: 'first', taskId: 'off-page-first' },
        { templateId: 'second', taskId: 'off-page-second' }],
      plan: { version: 1, name: 'Focus workflow', tasks: [{ id: 'first', subject: 'First task', blockedBy: [] },
        { id: 'second', subject: 'Second task', blockedBy: ['first'] }],
      bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 } } } as never
    const collections: TeamCollectionsState = {
      teamId: state.team.id,
      members: { items: [], loading: false, loadingMore: false, hasNewer: false },
      tasks: { items: [workspaceTaskSummary(task('loaded-task'))], nextCursor: 0, loading: false, loadingMore: false, hasNewer: false },
      workflowPlans: { items: [workspaceWorkflowSummary(plan)], loading: false, loadingMore: false, hasNewer: false },
      artifacts: { items: [], loading: false, loadingMore: false, hasNewer: false },
    }
    const currentPlan = { ...(plan as NonNullable<TeamStateSnapshot['workflowPlans']>[number]), revision: 2, phase: 'ready' as const }
    const view = render(<TeamPage view="workflows" state={{ ...state,
      tasks: [task('loaded-task'), task('off-page-first'), task('off-page-second')], workflowPlans: [currentPlan] }}
    collections={collections} translate={makeTranslate(en)} />)
    const row = (id: string) => view.container.querySelector(`[id="team-task-${id}"]`)
    expect(view.getByText('Compiling')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Focus workflow' }))
    expect(row('off-page-first')).toBeNull()
    fireEvent.click(view.getAllByRole('link', { name: 'First task' })[0]!, { ctrlKey: true })
    expect(row('off-page-first')).toBeNull()
    fireEvent.click(view.getAllByRole('link', { name: 'First task' })[0]!)
    expect(row('loaded-task')).not.toBeNull()
    expect(row('off-page-first')).toBeNull()
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Close task summary' }))
    expect(row('off-page-second')).toBeNull()
    go(view, 'Workflows')
    fireEvent.click(view.getByRole('link', { name: 'Second task' }))
    expect(row('off-page-second')).toBeNull()
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Close task summary' }))
    expect(row('off-page-first')).toBeNull()
    go(view, 'Workflows')
    fireEvent.click(view.getAllByRole('link', { name: 'First task' })[1]!)
    expect(row('off-page-first')).toBeNull()
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Close task summary' }))
    expect(row('off-page-second')).toBeNull()
  })

  it('stops a running task after confirmation without hiding the task state', async () => {
    const teamId = 'stop-task-team' as TeamId
    const taskId = 'running-task' as never
    const state = {
      ...pageState('stop-task-team'),
      participants: [{ id: 'worker-stop' as never, teamId, kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [], phase: 'active' }],
      activations: [{ activation: { id: 'activation-stop' as never, teamId, participantId: 'worker-stop' as never, status: 'running' }, sessionId: 'session-stop' as never, provider: 'in-process' }],
      tasks: [{
        id: taskId,
        teamId,
        revision: 2,
        subject: 'Stop running work',
        description: 'This worker is currently processing the task.',
        phase: 'running' as const,
        blockedBy: [],
        attemptCount: 1,
        maxAttempts: 1,
        attemptHistory: [],
        lease: { attemptId: 'attempt-stop' as never, participantId: 'worker-stop' as never, activationId: 'activation-stop' as never },
      }],
      channelIds: [],
    } as unknown as TeamStateSnapshot
    const cancelTask = vi.fn(async () => {})
    const view = render(<TeamPage state={state} translate={makeTranslate(en)} cancelTask={cancelTask} />)

    taskMenu(view, 'Stop running work')
    fireEvent.click(view.getByRole('menuitem', { name: 'Stop task' }))
    const dialog = view.getByRole('dialog', { name: 'Stop task' })
    expect(within(dialog).getByText(/Stop running work/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop task' }))
    await waitFor(() => {
      expect(cancelTask).toHaveBeenCalledWith(taskId, 2, 'Stopped from task details.', expect.any(AbortSignal))
      expect(view.queryByRole('dialog', { name: 'Stop task' })).toBeNull()
      expect(view.getAllByText('Stop running work')).not.toHaveLength(0)
    })
  })

  it('exposes participant, channel, task, and audit details through durable owners', async () => {
    const teamId = 'detail-team' as TeamId
    const participantId = 'detail-participant' as never
    const channelId = 'detail-channel' as never
    const state = {
      team: team('detail-team', 'active'),
      workspaceAllocations: [],
      goal: { teamId, revision: 1, objective: 'Inspect durable work', phase: 'active', budgets: {} },
      rules: {},
      budgets: {},
      participants: [{ id: participantId, teamId, kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [], phase: 'active' }],
      activations: [{ activation: { id: 'detail-activation' as never, teamId, participantId, status: 'idle' }, sessionId: 'detail-session' as never, provider: 'in-process' }],
      tasks: [{
        id: 'detail-task' as never, teamId, revision: 1, subject: 'Inspect files', description: 'Read the changed files.', phase: 'completed', blockedBy: [],
        requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' },
        reviewHistory: [], maxAttempts: 1, attemptCount: 1, attemptHistory: [{
          id: 'detail-attempt' as never, ordinal: 1, participantId, activationId: 'detail-activation' as never, assignedAt: 1, settledAt: 2,
          outcome: { kind: 'completed', result: {
            summary: 'Files inspected.',
            evidence: ['Channel read.'],
            verification: 'Unit test',
            integration: {
              target: 'main',
              status: 'proposed',
              proposalArtifact: { id: 'integration-proposal', provider: 'local', kind: 'patch', uri: 'artifact://proposal', visibility: 'team' },
              artifacts: [
                { id: 'integration-artifact', provider: 'local', kind: 'report', uri: 'artifact://integration', visibility: 'human' },
                { id: 'private-artifact', provider: 'local', kind: 'report', uri: 'artifact://private', visibility: 'private' },
              ],
            },
          } },
        }],
      }],
      channelIds: [channelId],
      humanActions: [],
    } as unknown as TeamStateSnapshot
    const openParticipantSession = vi.fn(async () => {})
    const readChannel = vi.fn(async () => ({ records: [{ type: 'channel/opened', sequence: 0, createdAt: 1, manifest: {} }] } as never))
    const readAudit = vi.fn(async () => ({ teamId, items: [{ teamId, stream: 'team', cursor: 0, type: 'team/created', createdAt: 1, facts: {} }] } as never))
    const readArtifact = vi.fn(async (artifactId: string) => ({
      artifact: { id: artifactId, provider: 'local', kind: 'report' as const, uri: 'artifact://read', visibility: 'team' as const },
      bytes: 4,
      data: 'dGVzdA==',
    } as never))
    const view = render(<TeamPage
      state={state}
      translate={makeTranslate(en)}
      openParticipantSession={openParticipantSession}
      readChannel={readChannel}
      readAudit={readAudit}
      readArtifact={readArtifact}
    />)

    expect(view.getByText('Inspect files')).toBeTruthy()
    expect(view.getAllByText('Worker').length).toBeGreaterThan(0)
    go(view, 'Artifacts')
    expect(view.getByText('integration-proposal')).toBeTruthy()
    expect(view.getByText('integration-artifact')).toBeTruthy()
    expect(view.queryByText('private-artifact')).toBeNull()
    fireEvent.click(view.getAllByRole('button', { name: 'Read artifact' })[0]!)
    await view.findByText('test')
    expect(readArtifact).toHaveBeenCalledWith('integration-proposal', expect.any(AbortSignal))
    go(view, 'Members')
    fireEvent.click(view.getByRole('button', { name: 'Open Session' }))
    expect(openParticipantSession).toHaveBeenCalledWith(participantId)
    go(view, 'Channels')
    fireEvent.click(await view.findByRole('button', { name: 'Channel 1' }))
    await view.findByRole('button', { name: 'Channel details' })
    channelDetails(view)
    await view.findByText('channel/opened')
    expect(readChannel).toHaveBeenCalledWith(channelId, -1, expect.any(AbortSignal))
    go(view, 'Audit')
    fireEvent.click(view.getByRole('button', { name: 'Audit timeline' }))
    await view.findByText('team/created')
    expect(readAudit).toHaveBeenCalledWith({ limit: 64 }, expect.any(AbortSignal))

    const durableState = {
      ...state,
      humanActions: [
        { id: 'durable-approval', kind: 'approval', sessionId: 'durable-session', phase: 'pending' },
        { id: 'durable-question', kind: 'question', sessionId: 'durable-session', phase: 'pending' },
      ],
    } as unknown as TeamStateSnapshot
    view.rerender(<TeamPage view="overview"
      state={durableState}
      translate={makeTranslate(en)}
    />)
    expect(view.getByText('Approval', { selector: 'summary' }).parentElement?.textContent).toContain('Pending')
    expect(view.getByText('Question', { selector: 'summary' }).parentElement?.textContent).toContain('Pending')
  })

  it('keeps the settled worker owner and assigns review status to the reviewer', () => {
    const teamId = 'review-status-team' as TeamId
    const workerId = 'review-status-worker' as never
    const reviewerId = 'review-status-reviewer' as never
    const state = {
      ...pageState('review-status-team'),
      participants: [
        { id: workerId, teamId, kind: 'local-agent', displayName: 'Worker', role: 'worker', capabilities: [], phase: 'active' },
        { id: reviewerId, teamId, kind: 'local-agent', displayName: 'Reviewer', role: 'reviewer', capabilities: [], phase: 'active' },
      ],
      activations: [
        { activation: { id: 'review-status-worker-activation' as never, teamId, participantId: workerId, status: 'idle' }, sessionId: 'review-status-worker-session' as never, provider: 'in-process' },
        { activation: { id: 'review-status-reviewer-activation' as never, teamId, participantId: reviewerId, status: 'running' }, sessionId: 'review-status-reviewer-session' as never, provider: 'in-process' },
      ],
      tasks: [{
        id: 'review-status-task' as never,
        teamId,
        revision: 2,
        subject: 'Review worker output',
        description: 'Review the worker output.',
        phase: 'review' as const,
        blockedBy: [],
        attemptCount: 1,
        maxAttempts: 1,
        attemptHistory: [{ participantId: workerId, outcome: { kind: 'completed', result: { summary: 'Worker output ready.' } } }],
        reviewPolicy: { kind: 'participant' as const, reviewerId },
      }],
      channelIds: [],
    } as unknown as TeamStateSnapshot
    const view = render(<TeamPage view="members" state={state} translate={makeTranslate(en)} />)

    expect(view.getAllByText('Worker').length).toBeGreaterThan(0)
    expect(view.getByText('Reviewer · Reviewing')).toBeTruthy()
    expect(view.getByText('Worker · Active')).toBeTruthy()
  })

  it('cancels artifact reads when the selected Team changes or the detail unmounts', async () => {
    const teamId = 'artifact-team' as TeamId
    const artifact = { id: 'local:artifact', provider: 'local', kind: 'report' as const, uri: 'artifact://report', visibility: 'team' as const }
    const state = {
      team: team('artifact-team', 'active'),
      goal: { teamId, revision: 1, objective: 'Read artifact', phase: 'active', budgets: {} },
      participants: [], activations: [], tasks: [{
        id: 'artifact-task' as never,
        subject: 'Read artifact', description: 'Read one artifact.', phase: 'completed', blockedBy: [], attemptCount: 1, maxAttempts: 1,
        attemptHistory: [{ outcome: { kind: 'completed', result: { artifacts: [artifact] } } }],
      }],
      channelIds: [], rules: {}, budgets: {}, humanActions: [], workspaceAllocations: [],
    } as unknown as TeamStateSnapshot
    const pending = Promise.withResolvers<never>()
    let signal!: AbortSignal
    const readArtifact = vi.fn(async (_artifactId: string, nextSignal?: AbortSignal) => {
      if (nextSignal === undefined) throw new Error('artifact read signal was not provided')
      signal = nextSignal
      return await pending.promise
    })
    const view = render(<TeamPage view="artifacts" state={state} translate={makeTranslate(en)} readArtifact={readArtifact} />)
    fireEvent.click(view.getByRole('button', { name: 'Read artifact' }))
    await waitFor(() => { expect(signal.aborted).toBe(false) })
    const replacement = {
      ...state,
      team: { ...state.team, id: 'replacement-team' as TeamId },
      goal: { ...state.goal, teamId: 'replacement-team' as TeamId },
      tasks: [],
    } as unknown as TeamStateSnapshot
    view.rerender(<TeamPage view="artifacts" state={replacement} translate={makeTranslate(en)} readArtifact={readArtifact} />)
    expect(signal.aborted).toBe(true)
    pending.resolve(undefined as never)
    await act(async () => { await Promise.resolve() })
    expect(view.queryByText('local:artifact')).toBeNull()
    view.unmount()
  })

  it('recovers channel, audit, and artifact reads with bounded previews and downloads', async () => {
    const base = pageState('read-team')
    const channelId = 'read-channel' as never
    const file = { id: 'file-without-provider', kind: 'file' as const, uri: 'file:///tmp/read', visibility: 'team' as const }
    const report = { id: 'report-artifact', provider: 'local', kind: 'report' as const, uri: 'artifact://report', visibility: 'team' as const }
    const screenshot = { id: 'screenshot-artifact', provider: 'local', kind: 'screenshot' as const, uri: 'artifact://screenshot', visibility: 'team' as const }
    const state = {
      ...base,
      participants: [],
      tasks: [{
        id: 'read-task' as never,
        teamId: base.team.id,
        revision: 1,
        subject: 'Read outputs',
        description: 'Inspect retained artifacts.',
        phase: 'completed',
        blockedBy: [],
        attemptCount: 1,
        maxAttempts: 1,
        attemptHistory: [{ outcome: { kind: 'completed', result: { summary: 'done', artifacts: [file, report, screenshot] } } }],
      }],
      channelIds: [channelId],
    } as unknown as TeamStateSnapshot
    let channelCalls = 0
    let auditCalls = 0
    let artifactCalls = 0
    const readChannel = vi.fn(async () => {
      channelCalls += 1
      if (channelCalls === 1) throw new Error('channel read failed')
      if (channelCalls === 2) return { records: [] } as never
      return { records: [{ type: 'channel/envelope', envelope: { id: 'read-envelope', createdAt: 1, payload: { text: 'hello' } } }] } as never
    })
    const readAudit = vi.fn(async () => {
      auditCalls += 1
      if (auditCalls === 1) throw new Error('audit read failed')
      return { teamId: base.team.id, items: [] } as never
    })
    const largeText = 'x'.repeat(128 * 1024 + 1)
    const largeData = btoa(largeText)
    const readArtifact = vi.fn(async (artifactId: string) => {
      artifactCalls += 1
      if (artifactCalls === 1) throw new Error('artifact read failed')
      if (artifactId === screenshot.id) {
        return { artifact: screenshot, bytes: 1, data: 'AA==' } as never
      }
      return { artifact: report, bytes: largeText.length, data: largeData } as never
    })
    const view = render(<TeamPage view="artifacts"
      state={state}
      translate={makeTranslate(en)}
      readChannel={readChannel}
      readAudit={readAudit}
      readArtifact={readArtifact}
    />)

    expect(view.getByText('Bytes unavailable')).toBeTruthy()
    go(view, 'Channels')
    fireEvent.click(await view.findByRole('button', { name: 'Channel 1' }))
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('channel read failed') })
    fireEvent.click(await view.findByRole('button', { name: 'Channel 1' }))
    await waitFor(() => { expect(view.getByText('No channel records')).toBeTruthy() })
    fireEvent.click(await view.findByRole('button', { name: 'Channel 1' }))
    await view.findByText('hello')
    channelDetails(view)
    expect(view.getByText('channel/envelope')).toBeTruthy()

    go(view, 'Audit')
    fireEvent.click(view.getByRole('button', { name: 'Audit timeline' }))
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('audit read failed') })
    fireEvent.click(view.getByRole('button', { name: 'Audit timeline' }))
    await waitFor(() => { expect(view.getByText('No audit records')).toBeTruthy() })

    go(view, 'Artifacts')
    const artifactButtons = view.getAllByRole('button', { name: 'Read artifact' })
    expect(artifactButtons).toHaveLength(2)
    fireEvent.click(artifactButtons[0]!)
    await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('artifact read failed') })
    fireEvent.click(view.getAllByRole('button', { name: 'Read artifact' })[0]!)
    await waitFor(() => { expect(view.container.textContent).toContain('…') })

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:team-artifact')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(view.getByRole('button', { name: 'Download' }))
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(anchorClick).toHaveBeenCalledOnce()
    await waitFor(() => { expect(revokeObjectURL).toHaveBeenCalledWith('blob:team-artifact') })

    fireEvent.click(view.getAllByRole('button', { name: 'Read artifact' })[1]!)
    await waitFor(() => { expect(view.getByText('Binary artifact; download it to inspect.')).toBeTruthy() })
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    anchorClick.mockRestore()
  })
})


describe('Team management and continuation pages', () => {
  it('blocks ACK and basic sending during authority refresh, then keeps sending blocked on metadata failure', () => {
    const base = pageState('authority-refresh')
    const state = { ...base, participants: ['Current person', 'Other person'].map((displayName, index) => ({
      id: `authority-human-${index}` as TeamStateSnapshot['participants'][number]['id'], teamId: base.team.id,
      kind: 'human' as const, role: 'human', displayName, phase: 'active' as const, capabilities: [],
      owner: { kind: 'product-principal' as const, principalId: `principal-${index}` as never },
    })) }
    const id = 'authority-channel' as ChannelId
    const channel = { manifest: { id, teamId: state.team.id, adapter: { type: 'discussion', version: 1 },
      participants: state.participants.map(member => ({ id: member.id, role: member.role })), limits: { maxTurns: 3, speakerPolicy: 'free-form' } },
    phase: 'active' as const, cursor: 5 }
    const own = { participantId: state.participants[0]!.id, role: 'human', visibility: 'channel' as const, required: false,
      deadline: 1000, endpoint: { kind: 'human' as const }, revision: 1, manifestFingerprint: `sha256:${'a'.repeat(64)}` as never, status: 'pending' as const }
    const source: TeamChannelState = { channelId: id, page: { channel, records: [] }, invitation: { channel, invitation: own },
      admission: { channel, invitations: [own, { ...own, participantId: state.participants[1]!.id, required: true,
        status: 'acknowledged', acknowledgementKey: 'peer-ack' as never, settledAt: 2 }], expectedNext: { kind: 'none' },
      protocolStatus: { kind: 'discussion', turnCount: 0, maxTurns: 3, speakerPolicy: 'free-form' } },
      loading: true, acknowledging: false, hasNewer: false }
    const controls = { state,
      translate: makeTranslate(en),
      readChannel: async () => source.page!,
      manage: vi.fn(async () => {
      }),
      acknowledgeChannel: vi.fn(async () => {
      }) }
    const view = render(<RawTeamPage {...controls} channelState={source} />)
    expect(view.getByRole('button', { name: 'Accept channel invitation' }).hasAttribute('disabled')).toBe(true)
    const accepted = { ...source, invitation: { channel, invitation: { ...own, status: 'acknowledged' as const, acknowledgementKey: 'own-ack' as never, settledAt: 3 } } }
    view.rerender(<RawTeamPage {...controls} channelState={accepted} />)
    expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
    view.rerender(<RawTeamPage {...controls} channelState={{ ...accepted, loading: false, admissionError: 'Metadata unavailable' }} />)
    expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
    view.rerender(<RawTeamPage {...controls} channelState={{ ...accepted, loading: false }} />)
    expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false)
  })

  it('renders only the explicitly loaded channel page and requests continuation on click', () => {
    const state = { ...pageState('channel-pages-ui'), channelIds: ['visible' as never, 'hidden' as never] }
    const listed = { manifest: { id: 'visible' as ChannelId, teamId: state.team.id, adapter: { type: 'direct', version: 4 },
      participants: [], limits: {} }, phase: 'active' as const, cursor: 0 }
    const readChannels = vi.fn(async () => {})
    const view = render(<RawTeamPage state={state} translate={makeTranslate(en)} readChannels={readChannels}
      channelListState={{ teamId: state.team.id, items: [listed], nextCursor: 0, loading: false, loadingMore: false, hasNewer: true }} />)
    expect(view.getByRole('button', { name: 'Channel 1' })).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Channel 2' })).toBeNull()
    expect(view.queryByText('hidden')).toBeNull()
    expect(readChannels).toHaveBeenCalledWith(state.team.id)
    fireEvent.click(view.getByRole('button', { name: 'Next channel page' }))
    expect(readChannels).toHaveBeenLastCalledWith(state.team.id, 'next')
  })

  it('shows all endpoint names and consent status without exposing proof fields or borrowing another invitation', () => {
    const base = pageState('channel-metadata-ui')
    const state = { ...base, participants: [{ id: 'other-human' as never, teamId: base.team.id, kind: 'human' as const,
      displayName: 'Another person', role: 'human', capabilities: [], phase: 'active' as const,
      owner: { kind: 'product-principal' as const, principalId: 'other-principal' as never } }] }
    const id = 'private-runtime-channel-id' as ChannelId
    const channel = { manifest: { id, teamId: state.team.id, adapter: { type: 'direct', version: 4 },
      participants: [{ id: state.participants[0]!.id, role: 'human' }], limits: {} }, phase: 'pending' as const, cursor: 0 }
    const acknowledgeChannel = vi.fn(async () => {})
    const view = render(<RawTeamPage state={state} translate={makeTranslate(en)} acknowledgeChannel={acknowledgeChannel}
      channelState={{ channelId: id, page: { channel, records: [] }, loading: false, acknowledging: false, hasNewer: false,
        admission: { channel, expectedNext: { kind: 'none' }, protocolStatus: { kind: 'other' }, invitations: [{ participantId: state.participants[0]!.id, role: 'human', visibility: 'channel',
          required: true, deadline: 1700000000000, endpoint: { kind: 'human' }, revision: 1,
          manifestFingerprint: `sha256:${'b'.repeat(64)}` as never, acknowledgementKey: 'hidden-ack-key' as never, status: 'acknowledged', settledAt: 1 }] } }} />)
    channelDetails(view)
    const metadata = within(view.getByRole('region', { name: 'Participant admission status' }))
    expect(metadata.getByText('Another person')).toBeTruthy()
    expect(metadata.getByText(/Required consent.*Acknowledged/)).toBeTruthy()
    expect(metadata.getByText(/Consent deadline/)).toBeTruthy()
    expect(view.queryByText(`sha256:${'b'.repeat(64)}`, { exact: false })).toBeNull()
    expect(view.queryByText(/hidden-ack-key|private-runtime-channel-id/)).toBeNull()
    expect(view.queryByRole('button', { name: 'Accept channel invitation' })).toBeNull()
    expect(acknowledgeChannel).not.toHaveBeenCalled()
  })

  it('shows explicit principal consent and prevents another click while it is being acknowledged', () => {
    const base = pageState('consent')
    const state = { ...base, channelIds: ['consent-channel' as never], participants: [{ id: 'consent-human' as never,
      teamId: base.team.id, kind: 'human' as const, displayName: 'Invited person', role: 'human', capabilities: [],
      phase: 'active' as const, owner: { kind: 'product-principal' as const, principalId: 'consent-principal' as never } }] }
    const channelId = state.channelIds[0]!
    const channel = { manifest: { id: channelId, teamId: state.team.id, adapter: { type: 'direct', version: 4 },
      participants: [{ id: state.participants[0]!.id, role: 'human' }], limits: {} }, phase: 'pending' as const, cursor: 4 }
    const channelState = { channelId, page: { channel, records: [] }, loading: false, acknowledging: false, hasNewer: false,
      invitation: { channel, invitation: { participantId: state.participants[0]!.id, role: 'human', visibility: 'channel', required: true,
        deadline: 1000, endpoint: { kind: 'human' }, revision: 2, manifestFingerprint: `sha256:${'a'.repeat(64)}`, status: 'pending' } } } as never
    const acknowledgeChannel = vi.fn(async () => {})
    const view = render(<RawTeamPage
      state={state}
      translate={makeTranslate(en)}
      channelState={channelState}
      acknowledgeChannel={acknowledgeChannel} />)
    expect(acknowledgeChannel).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Accept channel invitation' }))
    expect(acknowledgeChannel).toHaveBeenCalledWith(channelId)
    view.rerender(<RawTeamPage state={state} translate={makeTranslate(en)}
      channelState={{ ...(channelState as import('@clocky/clocky-client-runtime/client').TeamChannelState), acknowledging: true }} acknowledgeChannel={acknowledgeChannel} />)
    expect(view.getByRole('button', { name: 'Accept channel invitation' }).hasAttribute('disabled')).toBe(true)
  })

  it('cancels pending opening through the current channel cursor and keeps unrelated read failures nonblocking', async () => {
    const state = { ...pageState('pending-close'), channelIds: ['pending-channel' as never] }
    const channelId = state.channelIds[0]!
    const page = { channel: { manifest: { id: channelId, teamId: state.team.id, adapter: { type: 'direct', version: 4 },
      participants: [], limits: {} }, phase: 'pending' as const, cursor: 7 }, records: [] }
    const manage = vi.fn(async () => {})
    const view = render(<RawTeamPage state={state} translate={makeTranslate(en)} manage={manage}
      readChannel={async () => page} channelState={{ channelId, page, loading: false, acknowledging: false,
        hasNewer: false, invitationError: 'This channel has no invitation for this principal' }} />)
    expect(view.queryByRole('alert')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Channel actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Cancel opening' }))
    const dialog = view.getByRole('dialog', { name: 'Cancel opening' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel opening' }))
    await waitFor(() => { expect(manage).toHaveBeenCalledWith({ operation: 'channelClose',
      input: { channelId, expectedCursor: 7 } }, expect.any(AbortSignal)) })
  })

  it('replaces channel and audit pages and preserves the current window after a failed continuation', async () => {
    const state = { ...pageState('pages'), channelIds: ['channel-pages' as never] }
    const record = (sequence: number) => ({ type: 'channel/phase', sequence, phase: 'active' })
    let failNext = true
    const readChannel = vi.fn(async (_channelId: ChannelId, cursor?: number) => {
      if (cursor === 2 && failNext) { failNext = false; throw new Error('connection interrupted') }
      return cursor === 2 ? { records: [record(2), record(3)] } as never : { records: [record(1), record(2)], nextCursor: 2 } as never
    })
    const auditEntry = (cursor: number) => ({ stream: 'team', cursor, type: `event-${cursor}`, facts: {} })
    const readAudit = vi.fn(async (options?: { afterCursor?: number; limit?: number }) => options?.afterCursor === 4
      ? { teamId: state.team.id, items: [auditEntry(4), auditEntry(5)] } as never
      : { teamId: state.team.id, items: [auditEntry(3), auditEntry(4)], nextCursor: 4 } as never)
    const view = render(<TeamPage view="channels" state={state} translate={makeTranslate(en)} readChannel={readChannel} readAudit={readAudit} />)
    fireEvent.click(await view.findByRole('button', { name: 'Channel 1' }))
    await view.findByRole('button', { name: 'Channel details' })
    channelDetails(view)
    const channelSection = within(view.getByRole('region', { name: 'Channels' }))
    fireEvent.click(await channelSection.findByRole('button', { name: 'Next page' }))
    await channelSection.findByText('connection interrupted')
    expect(channelSection.getAllByText('channel/phase')).toHaveLength(2)
    fireEvent.click(channelSection.getByRole('button', { name: 'Next page' }))
    await waitFor(() => { expect(channelSection.getAllByText('channel/phase')).toHaveLength(2) })
    expect(channelSection.queryByRole('button', { name: 'Next page' })).toBeNull()
    expect(readChannel.mock.calls.map(call => call[1])).toEqual([-1, 2, 2])
    go(view, 'Audit')
    fireEvent.click(view.getByRole('button', { name: 'Audit timeline' }))
    const auditSection = within(view.getByRole('region', { name: 'Audit timeline' }))
    fireEvent.click(await auditSection.findByRole('button', { name: 'Next page' }))
    await auditSection.findByText('event-5')
    expect(auditSection.getAllByText('event-4')).toHaveLength(1)
    expect(auditSection.queryByText('event-3')).toBeNull()
    expect(readAudit).toHaveBeenLastCalledWith({ limit: 64, afterCursor: 4 }, expect.any(AbortSignal))
  })

  it('ignores a replaced channel response even when its transport resolves after abort', async () => {
    const state = { ...pageState('stale-pages'), channelIds: ['first' as never, 'second' as never] }
    let resolveFirst!: (value: never) => void
    let firstSignal!: AbortSignal
    const readChannel = vi.fn(async (channelId: ChannelId, _cursor?: number, signal?: AbortSignal) => {
      if (signal === undefined) throw new Error('read must carry cancellation')
      if (channelId === 'first') { firstSignal = signal; return await new Promise<never>((resolve) => { resolveFirst = resolve }) }
      return { records: [{ type: 'channel/phase', sequence: 1, marker: 'current-channel' }] } as never
    })
    const view = render(<TeamPage view="channels" state={state} translate={makeTranslate(en)} readChannel={readChannel} />)
    fireEvent.click(await view.findByRole('button', { name: 'Channel 1' }))
    fireEvent.click(await view.findByRole('button', { name: 'Channel 2' }))
    await view.findByRole('button', { name: 'Channel details' })
    channelDetails(view)
    await view.findByText(/current-channel/)
    expect(firstSignal.aborted).toBe(true)
    await act(async () => { resolveFirst({ records: [{ type: 'channel/phase', sequence: 1, marker: 'old-channel' }] } as never) })
    expect(view.queryByText(/old-channel/)).toBeNull()
    expect(view.getByText(/current-channel/)).toBeTruthy()
  })

  it('keeps an invite draft after a conflict and submits against the refreshed Team cursor', async () => {
    const initial = pageState('management')
    const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>().mockRejectedValueOnce(new Error('Team changed; retry with the current cursor')).mockResolvedValue(undefined)
    const view = render(<TeamPage view="members" state={initial} translate={makeTranslate(en)} manage={manage} />)
    fireEvent.click(view.getByRole('button', { name: 'Invite member' }))
    const dialog = within(view.getByRole('dialog', { name: 'Invite member' }))
    fireEvent.change(dialog.getByLabelText('Display name'), { target: { value: 'Researcher' } })
    fireEvent.change(dialog.getByLabelText('Capabilities (comma separated)'), { target: { value: 'search, read, search' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Invite member' }))
    await dialog.findByRole('alert')
    const next = { ...initial, team: { ...initial.team, cursor: 9 } }
    view.rerender(<TeamPage view="members" state={next} translate={makeTranslate(en)} manage={manage} />)
    expect(dialog.getByLabelText<HTMLInputElement>('Display name').value).toBe('Researcher')
    fireEvent.click(dialog.getByRole('button', { name: 'Invite member' }))
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    expect(manage).toHaveBeenLastCalledWith({ operation: 'memberInvite', input: {
      expectedCursor: 9, kind: 'local-agent', displayName: 'Researcher', role: 'worker', capabilities: ['search', 'read'],
    } }, expect.any(AbortSignal))
  })
})


describe('Task authoring, review, and integration', () => {
  it('creates a task with explicit placement, budget, workspace, and review choices', async () => {
    const base = pageState('task-author')
    const workerId = 'selected-worker' as never
    const state = { ...base, participants: [{ id: workerId, kind: 'local-agent', phase: 'active', displayName: 'Research worker', role: 'worker' }] } as unknown as TeamStateSnapshot
    const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>(async () => {})
    const onClose = vi.fn()
    const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }} state={state} translate={makeTranslate(en)} manage={manage} onClose={onClose} />)
    fireEvent.change(view.getByLabelText('Task name'), { target: { value: 'Inspect source' } })
    fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'Read the project and report evidence.' } })
    fireEvent.change(view.getByLabelText('Total token budget (optional)'), { target: { value: '12000' } })
    fireEvent.change(view.getByLabelText('Read scopes (one path per line)'), { target: { value: 'src/long folder\ndocs' } })
    fireEvent.click(view.getByLabelText('Git worktree'))
    fireEvent.click(within(view.getByRole('group', { name: 'Eligible members (none selected means unrestricted)' })).getByRole('checkbox', { name: 'Research worker' }))
    fireEvent.change(view.getByLabelText('Eligible roles (comma separated)'), { target: { value: 'worker, analyst' } })
    fireEvent.click(view.getByRole('button', { name: 'Create task' }))
    await waitFor(() => { expect(onClose).toHaveBeenCalledOnce() })
    expect(manage.mock.calls[0]?.[0]).toMatchObject({ operation: 'taskCreate', input: {
      subject: 'Inspect source', description: 'Read the project and report evidence.', expectedCursor: 1,
      workspaceMode: 'worktree', readScopes: ['src/long folder', 'docs'],
      placement: { participantIds: [workerId], roles: ['worker', 'analyst'] }, budget: { maxTotalTokens: 12000 }, reviewPolicy: { kind: 'none' },
    } })
  })

  it('retains dependency edits on rejection and reviews with the current task revision', async () => {
    const base = pageState('task-revisions')
    const task = { id: 'task-edit', phase: 'pending', revision: 2, subject: 'Initial task', description: 'Original instructions', blockedBy: [], attemptHistory: [] }
    const dependency = { ...task, id: 'task-dependency', subject: 'Gather evidence' }
    const state = { ...base, tasks: [task, dependency] } as unknown as TeamStateSnapshot
    const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>().mockRejectedValueOnce(new Error('Dependency would create a cycle')).mockResolvedValue(undefined)
    const onClose = vi.fn()
    const view = render(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id as never }} state={state} translate={makeTranslate(en)} manage={manage} onClose={onClose} />)
    fireEvent.click(view.getByLabelText('Gather evidence'))
    fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
    await view.findByRole('alert')
    expect((view.getByLabelText('Gather evidence') as HTMLInputElement).checked).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    view.unmount()
    const reviewState = { ...state, tasks: [{ ...task, phase: 'review', revision: 7 }] } as unknown as TeamStateSnapshot
    const review = render(<TeamTaskDialog target={{ kind: 'taskReview', taskId: task.id as never }} state={reviewState} translate={makeTranslate(en)} manage={manage} onClose={onClose} />)
    fireEvent.click(review.getByLabelText('Request rework'))
    fireEvent.change(review.getByLabelText('Review reason'), { target: { value: 'Add reproduction evidence.' } })
    fireEvent.click(review.getByRole('button', { name: 'Review task' }))
    await waitFor(() => { expect(onClose).toHaveBeenCalledOnce() })
    expect(manage).toHaveBeenLastCalledWith({ operation: 'taskReview', input: {
      taskId: task.id, expectedRevision: 7, decision: 'rework', reason: 'Add reproduction evidence.',
    } }, expect.any(AbortSignal))
  })

  it('requires a target version for integration and retains the exact source attempt', async () => {
    const task = {
      id: 'source-task', revision: 4, phase: 'completed', subject: 'Implement change', description: 'Source work', blockedBy: [],
      attemptHistory: [{ id: 'source-attempt', outcome: { kind: 'completed', result: { summary: 'Patch ready' } } }],
    }
    const state = { ...pageState('integrate'), tasks: [task] } as unknown as TeamStateSnapshot
    const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>(async () => {})
    const onClose = vi.fn()
    const view = render(<TeamTaskDialog target={{ kind: 'taskIntegrate', taskId: task.id as never }} state={state} translate={makeTranslate(en)} manage={manage} onClose={onClose} />)
    fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'Apply and verify the source patch.' } })
    fireEvent.change(view.getByLabelText('Workspace provider'), { target: { value: 'shared' } })
    fireEvent.change(view.getByLabelText('Target branch or directory'), { target: { value: 'target' } })
    fireEvent.click(view.getByLabelText('Update target'))
    fireEvent.click(view.getByRole('button', { name: 'Integrate artifacts' }))
    await view.findByText('Specify the expected target version before updating a target.')
    expect(manage).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('Expected target version'), { target: { value: 'sha256:target-baseline' } })
    fireEvent.click(view.getByRole('button', { name: 'Integrate artifacts' }))
    await waitFor(() => { expect(onClose).toHaveBeenCalledOnce() })
    expect(manage.mock.calls[0]?.[0]).toMatchObject({ operation: 'taskCreate', input: {
      blockedBy: [task.id], integration: {
        sourceTaskId: task.id, sourceAttemptId: 'source-attempt', provider: 'shared', target: 'target', expectedTarget: 'sha256:target-baseline', mode: 'integrate',
      },
    } })
  })
})


it('loads another Team list page only from its continuation control', async () => {
  const loadMoreTeams = vi.fn(async () => {})
  const fixture = props({ loadMoreTeams })
  fixture.state.set({ ...fixture.state.getSnapshot(), nextCursor: 'next' as never, items: [team('first-page', 'active')] })
  const view = render(<TeamBrowser {...fixture.props} />)
  expect(view.getByText('Tasks loaded: 1')).toBeTruthy()
  expect(loadMoreTeams).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Next page' }))
  await waitFor(() => { expect(loadMoreTeams).toHaveBeenCalledOnce() })
  act(() => { fixture.state.set({ ...fixture.state.getSnapshot(), loadingMore: true }) })
  expect(view.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true)
})


it('requires explicit review of a newer task revision before retaining and submitting edits', async () => {
  const task = { id: 'concurrent-edit', revision: 1, phase: 'pending', subject: 'Original name', description: 'Original instructions', blockedBy: [], attemptHistory: [] }
  const initial = { ...pageState('concurrent-team'), tasks: [task] } as unknown as TeamStateSnapshot
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>(async () => {})
  const onClose = vi.fn()
  const view = render(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id as never }} state={initial} translate={makeTranslate(en)} manage={manage} onClose={onClose} />)
  fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'My unsent instructions' } })
  const current = { ...initial, tasks: [{ ...task, revision: 2, description: 'Another editor changed this' }] } as unknown as TeamStateSnapshot
  view.rerender(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id as never }} state={current} translate={makeTranslate(en)} manage={manage} onClose={onClose} />)
  expect(view.getByRole('button', { name: 'Edit task' }).hasAttribute('disabled')).toBe(true)
  expect(view.getByText(/Another editor changed this/)).toBeTruthy()
  const instructions = view.getByLabelText('Instructions')
  if (!(instructions instanceof HTMLTextAreaElement)) throw new Error('Task instructions must be a textarea')
  expect(instructions.value).toBe('My unsent instructions')
  fireEvent.click(view.getByRole('button', { name: 'Use the reviewed latest version' }))
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await waitFor(() => { expect(onClose).toHaveBeenCalledOnce() })
  expect(manage).toHaveBeenCalledWith({ operation: 'taskUpdate', input: {
    taskId: task.id, expectedRevision: 2, subject: 'Original name', description: 'My unsent instructions', blockedBy: [],
  } }, expect.any(AbortSignal))
})


it('reads visible artifacts retained after workspace loss without exposing private references', async () => {
  const saved = { id: 'loss-artifact', provider: 'local', kind: 'report', uri: 'artifact://loss-artifact', visibility: 'team' }
  const state = { ...pageState('lost-world'), workspaceAllocations: [{
    id: 'lost-allocation', loss: { artifacts: [saved, { ...saved, id: 'private-loss', visibility: 'private' }] },
  }] } as unknown as TeamStateSnapshot
  const readArtifact = vi.fn(async () => ({ artifact: saved, bytes: 18, data: btoa('saved partial work') }) as never)
  const view = render(<TeamPage view="artifacts" state={state} translate={makeTranslate(en)} readArtifact={readArtifact} />)
  expect(view.getByText('loss-artifact')).toBeTruthy()
  expect(view.queryByText('private-loss')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Read artifact' }))
  await view.findByText('saved partial work')
  expect(readArtifact).toHaveBeenCalledWith(saved.id, expect.any(AbortSignal))
})
