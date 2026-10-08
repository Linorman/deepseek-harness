// @vitest-environment jsdom
/** Team workspace preserves per-Team navigation, drafts and authenticated callbacks. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'
import type { HostDescription } from '@clocky/clocky-client-connection/client'
import type { SessionId, TeamActionInspection, TeamActionResponseResult, TeamId } from '@clocky/clocky-client-runtime/client'
import type { TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import { LocaleRuntime } from '@clocky/clocky-client-locale/client'
import { SlotTestRuntime } from '@clocky/clocky-client-test-runtime'
import { readWorkspaceSource } from '@clocky/clocky-client-ui-layout/client'
import { apply, inject } from '../src/client/index.ts'
import { WorkspaceNavigationError } from '../src/client/navigation-error.ts'
import { en } from '../src/client/locales.ts'
import { createTeamWorkspaceStore, type Config } from '../src/client/workspace-store.ts'
import { workspaceMemberSummary, workspaceSelection, workspaceState, workspaceTask, workspaceTaskDetail, workspaceTaskSummary } from './workspace-fixtures.client.ts'
import { taskDraftKey } from '../src/client/task-draft.ts'

const originalUrl = window.location.href
const runtimes: SlotTestRuntime[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  window.history.replaceState(null, '', originalUrl)
})

const description: HostDescription = { version: 'test', cwd: '/', attachedSessions: 0, home: '/',
  canOpenPath: false, authorizationScope: 'a'.repeat(64) as HostDescription['authorizationScope'] }

async function mounted(selected = workspaceState(), options: {
  connected?: boolean
  href?: string
  historyState?: unknown
  beforeMount?: (runtime: SlotTestRuntime) => void
  config?: Config
} = {}) {
  window.history.replaceState(options.historyState ?? null, '', options.href ?? '?workspace=team')
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const hostDescription = createSnapshotStore<HostDescription | undefined>(options.connected === false ? undefined : description)
  runtime.provide('connection', { hostDescription })
  const navigate = vi.fn()
  runtime.provide('layout', { showWorkspace: vi.fn(), toggleSidebar: vi.fn(), navigate,
    registerCommands: vi.fn(() => () => {}) })
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({ 'team.workspace': { kind: 'single', scope: 'root' } },
    ({ renderSlot }) => renderSlot('team.workspace', {}))
  runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: selected.team.id,
    selected: { teamId: selected.team.id, state: workspaceSelection(selected) } })
  options.beforeMount?.(runtime)
  await runtime.mount({ inject: [...inject], apply: (ctx) => { apply(ctx, options.config) } })
  const view = runtime.renderRoot()
  const workspace = runtime.storeOf('team.workspace') as ReturnType<ReturnType<typeof createTeamWorkspaceStore>['create']>
  return { runtime, view, workspace, hostDescription, navigate }
}

it('retains independent Team module and scroll choices while changing the selected Team', async () => {
  const first = workspaceState()
  const { runtime, view, workspace } = await mounted(first)
  fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
  const page = view.container.querySelector<HTMLElement>('[data-team-workspace-page]')
  if (page === null) throw new Error('Team workspace scroll viewport is missing')
  page.scrollTop = 135
  fireEvent.scroll(page)
  const secondId = 'second-team' as typeof first.team.id
  const second = { ...first, team: { ...first.team, id: secondId }, goal: { ...first.goal, teamId: secondId } }
  act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: secondId,
    selected: { teamId: secondId, state: workspaceSelection(second) } }) })
  expect(workspace.getSnapshot().byTeam[first.team.id]?.scroll.tasks).toBe(135)
  expect(view.getByRole('heading', { name: second.goal.objective })).toBeTruthy()
  act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: first.team.id,
    selected: { teamId: first.team.id, state: workspaceSelection(first) } }) })
  expect(view.getByRole('textbox', { name: en['taskView.search'] })).toBeTruthy()
  expect(workspace.getSnapshot().byTeam[secondId]?.view).toBe('overview')
})

it('withholds stale selection content and management from parent or Simulation inspections', async () => {
  const team = workspaceState()
  const { runtime, view } = await mounted(team)
  const selected = runtime.teamTasks.list.getSnapshot().selected
  if (selected === undefined) throw new Error('Selected Team fixture is missing')
  act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
    current: 'another-team' as TeamId }) })
  expect(view.container.querySelector('[data-team-workspace-page]')).toBeNull()
  act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
    current: team.team.id, selected: { ...selected,
      state: { ...selected.state, readAccess: 'parent-inspection' } } }) })
  expect(view.getByText(en['workspace.parentInspection'])).toBeTruthy()
  expect(view.queryByRole('button', { name: en['workspace.teamActions'] })).toBeNull()
  act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
    selected: { ...selected, state: { ...selected.state, executionManagement: 'simulation-managed' } } }) })
  expect(view.getByText(en['workspace.simulationManaged'])).toBeTruthy()
  expect(view.queryByRole('button', { name: en['workspace.teamActions'] })).toBeNull()
})

it('derives the shareable Session member from a bound coordinator or exact member inspection', async () => {
  const base = workspaceState()
  const coordinatorId = 'coordinator-member' as never
  const coordinatorSession = 'coordinator-session' as SessionId
  const full = { ...base, participants: [{ id: coordinatorId, teamId: base.team.id,
    kind: 'local-agent' as const, displayName: 'Coordinator', role: 'coordinator',
    capabilities: [], phase: 'active' as const }],
  activations: [{ activation: { id: 'coordinator-activation' as never, teamId: base.team.id,
    participantId: coordinatorId, status: 'idle' as const }, sessionId: coordinatorSession, provider: 'local' }] }
  const { runtime, view } = await mounted(full)
  expect(view.getByRole('button', { name: en['workspace.openCoordinator'] })).toBeTruthy()
  await runtime.sessions.add({ id: coordinatorSession, summary: { displayTitle: 'Coordinator' } }, { current: true })
  await waitFor(() => { expect(new URL(window.location.href).searchParams.get('participant')).toBe(coordinatorId) })
  expect(new URL(window.location.href).searchParams.get('session')).toBe(coordinatorSession)
  const memberId = 'member-session-owner' as never
  const memberSession = 'member-session' as SessionId
  act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
    memberSession: { teamId: base.team.id, participantId: memberId, sessionId: memberSession } }) })
  await runtime.sessions.add({ id: memberSession, summary: { displayTitle: 'Member' } }, { current: true })
  await waitFor(() => { expect(new URL(window.location.href).searchParams.get('participant')).toBe(memberId) })
  expect(new URL(window.location.href).searchParams.get('session')).toBe(memberSession)
})

it('keeps a forbidden deep link visible, clears its Team drafts and returns to its source', async () => {
  const deniedTeam = 'denied-team' as TeamId
  const target = new URL(`?workspace=team&team=${deniedTeam}&view=tasks`, originalUrl).href
  const source = new URL('?workspace=simulation&simulation=source-run&simulationObject=original-task', originalUrl).href
  const historyState = { clockyWorkspaceSource: source, clockyWorkspaceTarget: deniedTeam }
  const inspect = vi.fn(async () => { throw new WorkspaceNavigationError('forbidden', 'Access revoked') })
  const { runtime, view, workspace, hostDescription, navigate } = await mounted(workspaceState(), {
    connected: false, href: target, historyState,
    beforeMount: (runtime) => { runtime.teamTasks.stub('inspect', inspect) },
  })
  act(() => { workspace.actions.setActionDraft(deniedTeam, 'retained-answer' as never,
    { answers: { question: { selected: ['yes'], custom: '' } } }) })
  expect(workspace.getSnapshot().byTeam[deniedTeam]?.actionDrafts['retained-answer']).toBeDefined()
  act(() => { hostDescription.set(description) })
  const heading = await view.findByRole('heading', { name: en['workspace.targetUnavailable'] })
  expect(document.activeElement).toBe(heading)
  expect(view.getByRole('alert').textContent).toContain(en['workspace.navigation.forbidden'])
  expect(workspace.getSnapshot().byTeam[deniedTeam]?.actionDrafts).toEqual({})
  expect(view.getByText('source-run')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['workspace.returnToSource'] }))
  expect(navigate).toHaveBeenCalledWith(readWorkspaceSource(historyState, target))
  expect(inspect).toHaveBeenCalledOnce()
  Object.assign(runtime.teamTasks, { startDraft: () => { throw new Error('Cannot reset draft') } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.resetNavigation'] }))
  await waitFor(() => { expect(view.getByText('Cannot reset draft')).toBeTruthy() })
})

it('clears retained drafts after an authorization-scope change or invalid credentials', async () => {
  const team = workspaceState()
  const { runtime, workspace, hostDescription } = await mounted(team)
  const actionId = 'unsent-answer' as never
  const save = () => { workspace.actions.setActionDraft(team.team.id, actionId,
    { answers: { decision: { selected: ['allow'], custom: '' } } }) }
  act(save)
  const before = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(true)
  act(() => { hostDescription.set({ ...description,
    authorizationScope: 'b'.repeat(64) as HostDescription['authorizationScope'] }) })
  expect(workspace.getSnapshot().byTeam[team.team.id]?.actionDrafts).toEqual({})
  const after = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(after)
  expect(after.defaultPrevented).toBe(false)
  act(save)
  act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
    error: { code: 'PRODUCT_AUTH_INVALID', message: 'Sign in again', details: {} } }) })
  expect(workspace.getSnapshot().byTeam[team.team.id]?.actionDrafts).toEqual({})
})

it('restores a same-Team task URL and replaces only its search edit in browser history', async () => {
  const team = workspaceState()
  const inspect = vi.fn(async () => ({ teamId: team.team.id, state: workspaceSelection(team) }))
  const { view, workspace } = await mounted(team, { href: `?workspace=team&team=${team.team.id}&view=tasks&q=Original`,
    beforeMount: (runtime) => { runtime.teamTasks.stub('inspect', inspect) } })
  const input = await view.findByRole('textbox', { name: en['taskView.search'] })
  expect((input as HTMLInputElement).value).toBe('Original')
  expect(workspace.getSnapshot().byTeam[team.team.id]?.view).toBe('tasks')
  const replace = vi.spyOn(window.history, 'replaceState')
  fireEvent.change(input, { target: { value: 'Updated' } })
  await waitFor(() => { expect(new URL(window.location.href).searchParams.get('q')).toBe('Updated') })
  expect(replace).toHaveBeenCalled()
  replace.mockRestore()
  expect(inspect).toHaveBeenCalledWith(team.team.id, expect.any(AbortSignal))
})

it('leaves Simulation browser navigation untouched while the Team workspace remains mounted', async () => {
  const team = workspaceState()
  const inspect = vi.fn(async () => ({ teamId: team.team.id, state: workspaceSelection(team) }))
  const { view } = await mounted(team, { beforeMount: (runtime) => { runtime.teamTasks.stub('inspect', inspect) } })
  window.history.replaceState(null, '', '?workspace=simulation&simulation=active-run')
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
  expect(new URL(window.location.href).searchParams.get('workspace')).toBe('simulation')
  expect(inspect).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
  expect(new URL(window.location.href).searchParams.get('workspace')).toBe('simulation')
  expect(new URL(window.location.href).searchParams.has('team')).toBe(false)
})

it('ignores an aborted older browser restoration while a newer Team view is loading', async () => {
  const team = workspaceState()
  const selection: TeamTaskSelection = { teamId: team.team.id, state: workspaceSelection(team) }
  const settle: Array<{ resolve: (value: TeamTaskSelection) => void; reject: (reason: unknown) => void }> = []
  const inspect = vi.fn((_teamId: TeamId, _signal?: AbortSignal) => new Promise<TeamTaskSelection>((resolve, reject) => {
    settle.push({ resolve, reject })
  }))
  const { view } = await mounted(team, { beforeMount: (runtime) => { runtime.teamTasks.stub('inspect', inspect) } })
  window.history.pushState(null, '', `?workspace=team&team=${team.team.id}&view=tasks`)
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
  const oldSignal = inspect.mock.calls[0]?.[1]
  window.history.pushState(null, '', `?workspace=team&team=${team.team.id}&view=members`)
  act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
  expect(oldSignal?.aborted).toBe(true)
  await act(async () => { settle[0]?.reject(new Error('Previous route disappeared')); await Promise.resolve() })
  expect(view.queryByRole('heading', { name: en['workspace.targetUnavailable'] })).toBeNull()
  await act(async () => { settle[1]?.resolve(selection); await Promise.resolve() })
  await waitFor(() => { expect(view.getByRole('button', { name: en['workspace.members'] }).getAttribute('aria-current')).toBe('page') })
  expect(view.queryByRole('alert')).toBeNull()
})

it('rejects an exact historical Session mismatch even when the selected projection retires during inspection', async () => {
  const team = workspaceState()
  const selection: TeamTaskSelection = { teamId: team.team.id, state: workspaceSelection(team) }
  const { view } = await mounted(team, { href: `?team=${team.team.id}&view=overview&participant=member&session=stale-session`,
    beforeMount: (runtime) => {
      runtime.teamTasks.stub('inspect', async () => {
        runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), current: undefined })
        return selection
      })
      Object.assign(runtime.teamTasks, { participantSession: vi.fn(async () => 'published-session') })
    },
  })
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain(en['workspace.navigation.binding']) })
  expect(new URL(window.location.href).searchParams.get('session')).toBe('stale-session')
})

it('routes a Team task draft, collection refresh and confirmed deletion through the selected Team', async () => {
  const task = workspaceTask('Task to remove')
  const full = { ...workspaceState(), tasks: [task] }
  const manage = vi.fn(async () => {})
  const readCollections = vi.fn(async () => {})
  const deleteTask = vi.fn(async () => task)
  const { view, workspace } = await mounted(full, { beforeMount: (runtime) => {
    Object.assign(runtime.teamTasks, { manage, readCollections, deleteTask, readTaskDetail: vi.fn(async () => {}) })
    const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
    runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
      taskDetail: workspaceTaskDetail(task),
      collections: { teamId: task.teamId, members: empty,
        tasks: { ...empty, items: [workspaceTaskSummary(task)] }, workflowPlans: empty, artifacts: empty } })
  } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.refreshTasks'] }))
  expect(readCollections).toHaveBeenCalledWith(task.teamId, 'tasks', undefined, undefined)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskCreate'] }))
  const target = { kind: 'taskCreate' as const }
  fireEvent.change(within(view.getByRole('dialog')).getByLabelText(en['taskForm.subject']),
    { target: { value: 'Retained task input' } })
  expect(workspace.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.fields.subject).toBe('Retained task input')
  fireEvent.click(view.getByRole('button', { name: en['taskForm.discardDraft'] }))
  fireEvent.click(within(view.getAllByRole('dialog').at(-1)!).getByRole('button', { name: en['taskForm.discardAndClose'] }))
  expect(workspace.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]).toBeUndefined()
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.delete'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['detail.task.delete'] })).getByRole('button', { name: en['detail.task.delete'] }))
  await waitFor(() => { expect(deleteTask).toHaveBeenCalledWith(task.teamId, task.id, task.revision, expect.any(AbortSignal)) })
  expect(manage).not.toHaveBeenCalled()
})

it('reports a bounded task draft without overwriting retained input', async () => {
  const team = workspaceState()
  const { view, workspace } = await mounted(team, { config: { maxDraftBytes: 100 },
    beforeMount: (runtime) => { Object.assign(runtime.teamTasks, { manage: vi.fn(async () => {}) }) } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskCreate'] }))
  fireEvent.change(within(view.getByRole('dialog')).getByLabelText(en['taskForm.subject']),
    { target: { value: 'x'.repeat(300) } })
  expect(view.getByRole('alert').textContent).toContain(en['taskForm.draftCapacity'])
  expect(workspace.getSnapshot().byTeam[team.team.id]?.taskDrafts[taskDraftKey({ kind: 'taskCreate' })]).toBeUndefined()
})

it('reports a failed member Session and reads workflow and audit pages for the selected Team', async () => {
  const base = workspaceState()
  const member = { id: 'workspace-member' as never, teamId: base.team.id, kind: 'local-agent' as const,
    displayName: 'Workspace worker', role: 'worker', capabilities: [], phase: 'active' as const }
  const full = { ...base, participants: [member] }
  const participantSession = vi.fn<(_teamId: TeamId, _memberId: typeof member.id,
    _signal?: AbortSignal) => Promise<never>>()
    .mockRejectedValueOnce(new Error('Member Session unavailable'))
    .mockRejectedValueOnce('Member Session still unavailable')
  const readWorkflowDetail = vi.fn(async () => {})
  const readAudit = vi.fn(async () => ({ teamId: base.team.id, items: [] }))
  const { view } = await mounted(full, { beforeMount: (runtime) => {
    Object.assign(runtime.teamTasks, { participantSession, readWorkflowDetail, readAudit })
    const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
    runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
      collections: { teamId: base.team.id, members: { ...empty, items: [workspaceMemberSummary(member)] },
        tasks: empty, artifacts: empty, workflowPlans: { ...empty, items: [{ id: 'workspace-plan' as never,
          teamId: base.team.id, revision: 1, phase: 'compiling', name: { text: 'Workspace plan', truncated: false },
          taskCount: 1, boundTaskCount: 0 }] } } })
  } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.members'] }))
  fireEvent.click(within(view.getByText(member.displayName).closest('li')!).getByRole('button', { name: en['detail.openSession'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Member Session unavailable') })
  expect(participantSession).toHaveBeenCalledWith(base.team.id, member.id, expect.any(AbortSignal))
  fireEvent.click(within(view.getByText(member.displayName).closest('li')!).getByRole('button', { name: en['detail.openSession'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Member Session still unavailable') })
  fireEvent.click(view.getByRole('button', { name: en['workspace.more'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.workflows'] }))
  fireEvent.click(view.getByRole('button', { name: 'Workspace plan' }))
  expect(readWorkflowDetail).toHaveBeenCalledWith(base.team.id, 'workspace-plan', 'open')
  const modules = within(view.getByRole('navigation', { name: en['workspace.navigation'] }))
  fireEvent.click(modules.getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!)
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.audit'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  await waitFor(() => { expect(readAudit).toHaveBeenCalledWith(base.team.id, { limit: 64 }, expect.any(AbortSignal)) })
})

it('retains an inline channel draft and forwards its confirmed close command', async () => {
  const team = workspaceState()
  const channelId = 'workspace-channel' as never
  const participantId = 'channel-human' as never
  const channel = { manifest: { id: channelId, teamId: team.team.id,
    adapter: { type: 'direct', version: 4 }, participants: [{ id: participantId, role: 'human' }], limits: {} },
  phase: 'active' as const, cursor: 2 }
  const manage = vi.fn(async () => {})
  const acknowledgeChannel = vi.fn(async () => {})
  const readChannelCatalog = vi.fn(async () => {})
  const readChannelAttachment = vi.fn(async () => ({ attachment: {
    attachmentId: `sha256:${'a'.repeat(64)}` as never, mediaType: 'image/png' as const,
    bytes: 4, width: 1, height: 1 }, data: 'AA==' }))
  const { view, workspace } = await mounted(team, { beforeMount: (runtime) => {
    Object.assign(runtime.teamTasks, { manage, acknowledgeChannel, readChannelCatalog,
      readChannelAttachment, readChannels: vi.fn(async () => {}) })
    runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
      channel: { channelId, page: { channel, records: [] }, loading: false,
        acknowledging: false, hasNewer: false,
        invitation: { channel, invitation: { participantId, role: 'human', visibility: 'channel', required: true,
          deadline: 1700000000000, endpoint: { kind: 'human' }, revision: 1,
          manifestFingerprint: `sha256:${'b'.repeat(64)}` as never, status: 'pending' } } },
      channels: { teamId: team.team.id, items: [channel], loading: false,
        loadingMore: false, hasNewer: false },
      channelCatalog: { loading: false, value: { adapters: [{ type: 'direct', version: 4 }],
        viewPolicies: [] } } })
  } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.channels'] }))
  fireEvent.click(view.getByRole('button', { name: en['channel.acceptInvitation'] }))
  expect(acknowledgeChannel).toHaveBeenCalledWith(channelId)
  act(() => { workspace.actions.update(team.team.id, { channelDetails: true }) })
  fireEvent.click(view.getByText(en['channelHub.diagnostics']))
  fireEvent.click(view.getByRole('button', { name: en['channel.refreshCatalog'] }))
  expect(readChannelCatalog).toHaveBeenCalled()
  fireEvent.change(view.getByPlaceholderText(en['channelHub.placeholder']),
    { target: { value: 'Retained channel text' } })
  expect(workspace.getSnapshot().byTeam[team.team.id]?.channelDrafts[channelId]?.content[0]?.content).toEqual({
    type: 'text', text: 'Retained channel text',
  })
  fireEvent.click(view.getByRole('button', { name: en['channel.discardDraft'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['channel.discardDraft'] })).getByRole('button', { name: en['channel.discardDraft'] }))
  expect(workspace.getSnapshot().byTeam[team.team.id]?.channelDrafts[channelId]).toBeUndefined()
  fireEvent.click(view.getByRole('button', { name: en['channelHub.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['manage.channelClose'] }))
  fireEvent.change(within(view.getByRole('dialog', { name: en['manage.channelClose'] })).getByLabelText(en['manage.reason']),
    { target: { value: 'Completed discussion' } })
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['manage.channelClose'] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledWith(team.team.id,
    { operation: 'channelClose', input: { channelId, expectedCursor: 2, reason: 'Completed discussion' } },
    expect.any(AbortSignal)) })
})

it('confirms a Team cancellation and resumes only a stalled selected Team', async () => {
  const active = workspaceState()
  const cancel = vi.fn(async () => 'cancelled' as const)
  const first = await mounted(active, { beforeMount: (runtime) => {
    runtime.teamTasks.stub('cancel', cancel)
  } })
  fireEvent.click(first.view.getByRole('button', { name: en['workspace.teamActions'] }))
  fireEvent.click(first.view.getByRole('menuitem', { name: en['workspace.stopTeam'] }))
  fireEvent.click(within(first.view.getByRole('dialog', { name: en['workspace.stopTeam'] })).getByRole('button', { name: en['workspace.stopTeam'] }))
  await waitFor(() => { expect(cancel).toHaveBeenCalledWith(active.team.id, undefined) })
  first.view.unmount()
  const stalled = { ...active, team: { ...active.team, phase: 'stalled' as const } }
  const resume = vi.fn(async () => ({ teamId: stalled.team.id, state: workspaceSelection(stalled),
    coordinatorSessionId: 'resumed-coordinator' as never }))
  const second = await mounted(stalled, { beforeMount: (runtime) => { runtime.teamTasks.stub('resume', resume) } })
  fireEvent.click(second.view.getByRole('button', { name: en.resume }))
  await waitFor(() => { expect(resume).toHaveBeenCalledWith(stalled.team.id, undefined) })
})

it('stops a selected running task through its exact Team and revision', async () => {
  const task = workspaceTask('Running task', { phase: 'running', lease: {
    attemptId: 'running-attempt' as never, participantId: 'worker' as never,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2,
  } })
  const full = { ...workspaceState(), tasks: [task] }
  const cancelTask = vi.fn(async () => task)
  const { view } = await mounted(full, { beforeMount: (runtime) => {
    Object.assign(runtime.teamTasks, { cancelTask, readTaskDetail: vi.fn(async () => {}) })
    const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
    runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(), taskDetail: workspaceTaskDetail(task),
      collections: { teamId: task.teamId, members: empty,
        tasks: { ...empty, items: [workspaceTaskSummary(task)] }, workflowPlans: empty, artifacts: empty } })
  } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.stop'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['detail.task.stop'] })).getByRole('button', { name: en['detail.task.stop'] }))
  await waitFor(() => { expect(cancelTask).toHaveBeenCalledWith(task.teamId, task.id, task.revision,
    en['detail.task.stopReason'], expect.any(AbortSignal)) })
})

it('opens a retained child Team and an exact task artifact through their separate readers', async () => {
  const base = workspaceState()
  const childId = 'child-result-team' as TeamId
  const childTask = workspaceTask('Delegated child', { phase: 'running',
    execution: { kind: 'child-team', templateId: 'child', templateVersion: 1,
      authorityGrant: { operations: [], workspaceModes: [], readScopes: [], writeScopes: [], budgets: {} }, budget: {} },
    delegation: { id: 'child-run' as never, phase: 'active', requestedAt: 1, updatedAt: 2,
      childTeamId: childId } })
  const artifact = { id: 'result-report', provider: 'local', kind: 'report' as const,
    uri: 'artifact://result-report', visibility: 'team' as const }
  const artifactTask = workspaceTask('Artifact result', { phase: 'completed', attemptCount: 1,
    attemptHistory: [{ id: 'artifact-run' as never, teamId: base.team.id, taskId: 'Artifact result' as never,
      ordinal: 1, participantId: 'worker' as never, assignedAt: 1, leaseExpiresAt: 20, settledAt: 10,
      outcome: { kind: 'completed', result: { summary: 'Artifact available', artifacts: [artifact] } } }] })
  const full = { ...base, tasks: [childTask, artifactTask] }
  const inspect = vi.fn(async () => ({ teamId: childId, state: workspaceSelection({ ...base,
    team: { ...base.team, id: childId }, goal: { ...base.goal, teamId: childId } }) }))
  const readArtifact = vi.fn(async () => {})
  const { view } = await mounted(full, { beforeMount: (runtime) => {
    runtime.teamTasks.stub('inspect', inspect)
    Object.assign(runtime.teamTasks, { readArtifact,
      readTaskDetail: vi.fn(async (_teamId: TeamId, taskId: typeof childTask.id) => {
        const task = taskId === childTask.id ? childTask : artifactTask
        act(() => { runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
          taskDetail: workspaceTaskDetail(task) }) })
      }) })
    const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
    runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
      collections: { teamId: base.team.id, members: empty,
        tasks: { ...empty, items: [workspaceTaskSummary(childTask), workspaceTaskSummary(artifactTask)] },
        workflowPlans: empty, artifacts: { ...empty, items: [artifact] } } })
  } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.tasks'] }))
  fireEvent.click(view.getByRole('button', { name: childTask.subject }))
  const openChild = await view.findByRole('button', { name: en['detail.task.openChild'] })
  await act(async () => { fireEvent.click(openChild); await Promise.resolve() })
  await waitFor(() => { expect(inspect).toHaveBeenCalledWith(childId, undefined) })
  fireEvent.click(view.getByRole('button', { name: artifactTask.subject }))
  const openArtifact = await view.findByRole('button', { name: 'result-report' })
  await act(async () => { fireEvent.click(openArtifact); await Promise.resolve() })
  await waitFor(() => { expect(readArtifact).toHaveBeenCalledWith(base.team.id, artifact.id, undefined) })
})

it('opens an exact pending request, retains its answer, then submits under the selected Team', async () => {
  const team = workspaceState()
  const action: TeamActionResponseResult['action'] = { id: 'workspace-action' as never, teamId: team.team.id,
    sessionId: 'request-session' as never, participantId: 'worker' as never, sourceId: 'source' as never,
    kind: 'question', phase: 'pending', createdAt: 1, updatedAt: 2,
    details: { questions: [{ id: 'evidence', question: 'Which evidence?' }] } }
  const inspection: TeamActionInspection = { teamId: team.team.id, teamCursor: team.team.cursor,
    action, handling: { kind: 'actionable' } }
  const inspectAction = vi.fn(async () => inspection)
  const closeActionDetail = vi.fn()
  const respondAction = vi.fn(async () => ({ kind: 'accepted' as const, action: { ...action, updatedAt: 3,
    response: { expectedUpdatedAt: 2, idempotencyKey: 'answer-key' as never,
      answer: { kind: 'question' as const, answers: [] }, respondedBy: 'human' as never, acceptedAt: 3 } } }))
  const { view, workspace } = await mounted(team, { beforeMount: (runtime) => {
    Object.assign(runtime.teamTasks, { inspectAction, closeActionDetail, respondAction })
    const counts = { recovery: 0, humanActions: 1, reviews: 0, total: 1 }
    runtime.teamTasks.list.set({ ...runtime.teamTasks.list.getSnapshot(),
      actionDetail: { teamId: team.team.id, actionId: action.id, value: inspection,
        loading: false, hasNewer: false, disconnected: false },
      attention: { teamId: team.team.id, limit: 20, loading: false, hasNewer: false,
        disconnected: false, page: { teamId: team.team.id, teamCursor: team.team.cursor, counts,
          items: [{ kind: 'human-action', id: action.id, createdAt: 1, updatedAt: 2,
            actionKind: 'question', handling: { kind: 'actionable' } }] } } })
  } })
  fireEvent.click(view.getByRole('button', { name: en['workspace.more'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['workspace.attention'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.question'] }))
  expect(view.getByRole('dialog', { name: en['human.detail'] })).toBeTruthy()
  fireEvent.change(view.getByLabelText(en['human.customAnswer']), { target: { value: 'Browser and unit evidence' } })
  expect(workspace.getSnapshot().byTeam[team.team.id]?.actionDrafts[action.id]?.answers.evidence?.custom).toBe('Browser and unit evidence')
  fireEvent.click(view.getByRole('button', { name: en['human.refresh'] }))
  await waitFor(() => { expect(inspectAction).toHaveBeenCalledWith(team.team.id, action.id) })
  fireEvent.click(view.getByRole('button', { name: en['human.confirmCurrent'] }))
  await view.findByRole('button', { name: en['human.submitAnswer'] })
  fireEvent.click(view.getByRole('button', { name: en['human.submitAnswer'] }))
  await waitFor(() => { expect(respondAction).toHaveBeenCalledWith(team.team.id,
    expect.objectContaining({ actionId: action.id }), expect.any(AbortSignal)) })
  expect(workspace.getSnapshot().byTeam[team.team.id]?.actionDrafts[action.id]).toBeUndefined()
  fireEvent.click(view.getByRole('button', { name: en['human.closeKeepDraft'] }))
  expect(workspace.getSnapshot().byTeam[team.team.id]?.actionId).toBeUndefined()
  expect(closeActionDetail).toHaveBeenCalled()
})

it('reports a bounded human answer without replacing the retained request draft', async () => {
  const team = workspaceState()
  const action: TeamActionResponseResult['action'] = { id: 'bounded-answer' as never, teamId: team.team.id,
    sessionId: 'request-session' as never, participantId: 'worker' as never, sourceId: 'source' as never,
    kind: 'question', phase: 'pending', createdAt: 1, updatedAt: 2,
    details: { questions: [{ id: 'evidence', question: 'Which evidence?' }] } }
  const inspection: TeamActionInspection = { teamId: team.team.id, teamCursor: team.team.cursor,
    action, handling: { kind: 'actionable' } }
  const { runtime, view, workspace } = await mounted(team, { config: { maxDraftBytes: 100 },
    beforeMount: (testRuntime) => {
      Object.assign(testRuntime.teamTasks, { inspectAction: vi.fn(async () => inspection),
        closeActionDetail: vi.fn(), respondAction: vi.fn(async () => ({ kind: 'unavailable', action })) })
      testRuntime.teamTasks.list.set({ ...testRuntime.teamTasks.list.getSnapshot(),
        actionDetail: { teamId: team.team.id, actionId: action.id, value: inspection,
          loading: false, hasNewer: false, disconnected: false } })
    } })
  act(() => { workspace.actions.update(team.team.id, { actionId: action.id }) })
  expect(view.getByRole('dialog', { name: en['human.detail'] })).toBeTruthy()
  fireEvent.change(view.getByLabelText(en['human.customAnswer']), { target: { value: 'x'.repeat(300) } })
  expect(view.getByRole('alert').textContent).toContain(en['human.draftCapacity'])
  expect(workspace.getSnapshot().byTeam[team.team.id]?.actionDrafts[action.id]).toBeUndefined()
  expect(runtime.teamTasks.list.getSnapshot().actionDetail?.actionId).toBe(action.id)
})
