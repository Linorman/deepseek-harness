// @vitest-environment jsdom
/** Team page coordinates independently paged modules and their durable read owners. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamArtifactReference, TeamAttentionItem, TeamAttentionState, TeamAuditList, TeamMemberReadinessState, TeamWorkflowDetailState } from '@clocky/clocky-client-runtime/client'
import { TeamPage, type TeamPageProps } from '../src/client/TeamPage.tsx'
import { DEFAULT_TEAM_VIEW } from '../src/client/workspace-store.ts'
import { createTaskFormDraft, taskDraftKey } from '../src/client/task-draft.ts'
import { en } from '../src/client/locales.ts'
import { workspaceMemberSummary, workspaceSelection, workspaceState, workspaceTask, workspaceTaskSummary, workspaceTaskDetail } from './workspace-fixtures.client.ts'

afterEach(cleanup)

function taskCollections(task: ReturnType<typeof workspaceTask>) {
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  return { teamId: task.teamId, members: empty, tasks: { ...empty, items: [workspaceTaskSummary(task)] },
    workflowPlans: empty, artifacts: empty }
}

it('uses the matching server task query, pages it and refreshes a changed phase', async () => {
  const base = workspaceState()
  const task = workspaceTask('Server matched task', { phase: 'review' })
  const state = workspaceSelection({ ...base, tasks: [task] })
  const row = workspaceTaskSummary(task)
  const page = { kind: 'tasks' as const, teamId: base.team.id, teamCursor: 1,
    query: { search: '' }, sourceTotal: 1, total: 1, scanned: 1, items: [row],
    nextQueryCursor: 'next-page' as never }
  const readTaskQuery = vi.fn(async () => {})
  const pauseTaskQuery = vi.fn()
  const props = { view: 'tasks' as const, state, translate: makeTranslate(en), readTaskQuery, pauseTaskQuery,
    taskQuery: { teamId: base.team.id, query: { search: '' }, page, startCursor: 'prior-page' as never,
      loading: false, disconnected: false, hasNewer: false } }
  const view = render(<TeamPage {...props} />)
  expect(view.getByRole('button', { name: task.subject })).toBeTruthy()
  fireEvent.click(within(view.getByRole('region', { name: en['detail.tasks'] })).getByRole('button', { name: en['detail.firstPage'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.loadTasks'] }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.refreshQuery'] }))
  const search = view.getByRole('textbox', { name: en['taskView.searchTeam'] })
  fireEvent.submit(search.closest('form')!)
  expect(readTaskQuery.mock.calls).toEqual(expect.arrayContaining([
    [base.team.id, { search: '' }, 'first'], [base.team.id, { search: '' }, 'next'],
  ]))
  view.rerender(<TeamPage {...props} taskView={{ ...DEFAULT_TEAM_VIEW, taskPhase: 'review' }} />)
  await waitFor(() => { expect(readTaskQuery).toHaveBeenCalledWith(base.team.id, { search: '', phase: 'review' }) })
  expect(pauseTaskQuery).toHaveBeenCalled()
  expect(view.queryByRole('button', { name: task.subject })).toBeNull()
  view.rerender(<TeamPage {...props} taskView={{ ...DEFAULT_TEAM_VIEW, taskPhase: 'review' }}
    taskQuery={{ ...props.taskQuery, query: { search: '', phase: 'review' },
      page: { ...page, query: { search: '', phase: 'review' } }, loading: true,
      hasNewer: true, disconnected: true, error: 'Query page expired' }} />)
  expect(view.getByText(en['detail.tasksLoading'])).toBeTruthy()
  expect(view.getByText(en['taskView.queryChanged'])).toBeTruthy()
  expect(view.getByText(en['taskView.queryDisconnected'])).toBeTruthy()
  expect(view.getByRole('alert').textContent).toBe('Query page expired')
  view.rerender(<TeamPage {...props} taskView={{ ...DEFAULT_TEAM_VIEW, taskPhase: 'review' }}
    taskQuery={{ ...props.taskQuery, query: { search: '', phase: 'review' },
      page: { ...page, query: { search: '', phase: 'review' } } }} />)
  fireEvent.click(view.getByRole('button', { name: en['taskView.refreshQuery'] }))
  expect(readTaskQuery).toHaveBeenLastCalledWith(base.team.id, { search: '', phase: 'review' }, 'first')
})

it('uses the retained task view when no external module controls are installed', async () => {
  const state = workspaceSelection(workspaceState())
  const readTaskQuery = vi.fn(async () => {})
  const view = render(<TeamPage state={state} translate={makeTranslate(en)} readTaskQuery={readTaskQuery}
    taskView={{ ...DEFAULT_TEAM_VIEW, view: 'tasks' }} />)
  expect(view.getByRole('textbox', { name: en['taskView.searchTeam'] })).toBeTruthy()
  await waitFor(() => { expect(readTaskQuery).toHaveBeenCalledWith(state.team.id, { search: '' }) })
})

it('keeps audit metadata unavailable distinct from an empty budget and routes coordinator inspection', () => {
  const state = { ...workspaceSelection(workspaceState()),
    metadata: { kind: 'unavailable' as const, reason: 'too-large' as const } }
  const openCoordinator = vi.fn(async () => {})
  const view = render(<TeamPage view="audit" state={state} translate={makeTranslate(en)}
    openCoordinator={openCoordinator} />)
  expect(view.queryByRole('region', { name: en['detail.budget'] })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en['workspace.openCoordinator'] }))
  expect(openCoordinator).toHaveBeenCalledOnce()
})

it('pages members and opens the exact management action for each eligible role and phase', () => {
  const base = workspaceState()
  const participants = [
    { id: 'invited-worker' as never, teamId: base.team.id, kind: 'local-agent' as const,
      displayName: 'Invited worker', role: 'worker', capabilities: [], phase: 'invited' as const },
    { id: 'active-worker' as never, teamId: base.team.id, kind: 'local-agent' as const,
      displayName: 'Active worker', role: 'worker', capabilities: [], phase: 'active' as const },
    { id: 'coordinator' as never, teamId: base.team.id, kind: 'local-agent' as const,
      displayName: 'Coordinator', role: 'coordinator', capabilities: [], phase: 'active' as const },
  ]
  const state = workspaceSelection({ ...base, participants })
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const collections = { teamId: base.team.id, members: { ...empty, items: participants.map(workspaceMemberSummary),
    startCursor: 1, nextCursor: 2 }, tasks: empty, workflowPlans: empty, artifacts: empty }
  const readCollections = vi.fn(async () => {})
  const watchMemberReadiness = vi.fn(() => vi.fn())
  const refreshMemberReadiness = vi.fn(async () => {})
  const readMemberDetail = vi.fn(async () => {})
  const closeMemberDetail = vi.fn()
  const memberReadiness: TeamMemberReadinessState = { input: { teamId: base.team.id,
    participantIds: participants.map(participant => participant.id) }, loading: false, disconnected: false,
  value: { teamId: base.team.id, teamCursor: state.team.cursor, items: [{ participantId: participants[1]!.id,
    participation: 'active', state: 'ready', reasons: [], observationId: 'member-ready' as never, observedAt: 1 }] } }
  const props = { view: 'members' as const, state, collections, translate: makeTranslate(en),
    readCollections, watchMemberReadiness, refreshMemberReadiness, memberReadiness,
    readMemberDetail, closeMemberDetail, manage: vi.fn(async () => {}) }
  const view = render(<TeamPage {...props} />)
  expect(watchMemberReadiness).toHaveBeenCalledWith({ teamId: base.team.id,
    participantIds: participants.map(participant => participant.id) })
  fireEvent.click(view.getByRole('button', { name: en['detail.firstPage'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.loadMembers'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.refreshMembers'] }))
  expect(readCollections.mock.calls).toEqual(expect.arrayContaining([
    ['members', 'first'], ['members', 'next'], ['members'],
  ]))
  fireEvent.click(view.getByRole('button', { name: en['readiness.refresh'] }))
  expect(refreshMemberReadiness).toHaveBeenCalledOnce()
  const invited = within(view.getByText('Invited worker').closest('li')!)
  fireEvent.click(invited.getByRole('button', { name: en['manage.memberActivate'] }))
  expect(view.getByRole('dialog', { name: en['manage.memberActivate'] })).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en.cancel })[1]!)
  const active = within(view.getByText('Active worker').closest('li')!)
  fireEvent.click(active.getByRole('button', { name: en['manage.memberRemove'] }))
  expect(view.getByRole('dialog', { name: en['manage.memberRemove'] })).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en.cancel })[1]!)
  const coordinator = within(view.getByText('Coordinator').closest('li')!)
  expect(coordinator.queryByRole('button', { name: en['manage.memberRemove'] })).toBeNull()
  fireEvent.click(coordinator.getByRole('button', { name: en['manage.memberInterrupt'] }))
  expect(view.getByRole('dialog', { name: en['manage.memberInterrupt'] })).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en.cancel })[1]!)
  fireEvent.click(active.getByRole('button', { name: en['memberDetail.open'] }))
  expect(view.getByRole('dialog', { name: en['memberDetail.title'] })).toBeTruthy()
  expect(readMemberDetail).toHaveBeenCalledWith(base.team.id, participants[1]!.id, 'first')
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['memberDetail.refresh'] }))
  expect(readMemberDetail).toHaveBeenCalledWith(base.team.id, participants[1]!.id, 'refresh')
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en.cancel }))
  expect(closeMemberDetail).toHaveBeenCalledOnce()
  view.rerender(<TeamPage {...props} memberReadiness={{ ...memberReadiness, loading: true,
    disconnected: true, error: 'Readiness offline', value: undefined }}
  collections={{ ...collections, members: { ...collections.members, loading: true, error: 'Member page stale' } }} />)
  expect(view.getByText(en['detail.membersLoading'])).toBeTruthy()
  expect(view.getByText(en['readiness.loading'])).toBeTruthy()
  expect(view.getByText(en['readiness.disconnected'])).toBeTruthy()
  expect(view.getAllByRole('alert').map(item => item.textContent)).toEqual(expect.arrayContaining([
    'Member page stale', 'Readiness offline',
  ]))
})

it('labels a custom member role without counting it as an active worker', () => {
  const base = workspaceState()
  const member = { id: 'custom-member' as never, teamId: base.team.id, kind: 'local-agent' as const,
    displayName: 'Specialist', role: 'specialist', capabilities: [], phase: 'active' as const }
  const numbered = { id: 'numbered-worker' as never, teamId: base.team.id, kind: 'local-agent' as const,
    displayName: 'Numbered worker', role: 'worker-2', capabilities: [], phase: 'active' as const }
  const running = workspaceTask('In progress', { phase: 'running', lease: {
    attemptId: 'member-attempt' as never, participantId: numbered.id,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2,
  } })
  const state = workspaceSelection({ ...base, participants: [member, numbered], tasks: [running] })
  const view = render(<TeamPage view="members" state={state} translate={makeTranslate(en)}
    collections={{ teamId: base.team.id,
      members: { items: [workspaceMemberSummary(member), workspaceMemberSummary(numbered)],
        loading: false, loadingMore: false, hasNewer: false },
      tasks: { items: [], loading: false, loadingMore: false, hasNewer: false },
      workflowPlans: { items: [], loading: false, loadingMore: false, hasNewer: false },
      artifacts: { items: [], loading: false, loadingMore: false, hasNewer: false } }} />)
  expect(view.getByText('Specialist').closest('li')?.textContent).toContain(en['detail.participant.role.other'])
  expect(view.getByText('Numbered worker').closest('li')?.textContent).toContain(en['detail.participant.role.worker'])
  expect(view.getByRole('region', { name: en['detail.participants'] }).textContent).toContain(`1 ${en['detail.activeTask.one']}`)
})

it('retries a failed Team audit read and pages the exact retained journal', async () => {
  const state = workspaceSelection(workspaceState())
  const entry = { teamId: state.team.id, stream: 'team' as const, cursor: 0,
    type: 'team/created', createdAt: 1, facts: { objective: 'Release preparation' } }
  const readAudit = vi.fn<NonNullable<TeamPageProps['readAudit']>>()
    .mockRejectedValueOnce(new Error('Audit source offline'))
    .mockRejectedValueOnce('Audit source still offline')
    .mockResolvedValueOnce({ teamId: state.team.id, items: [entry], nextCursor: 1 })
    .mockResolvedValueOnce({ teamId: state.team.id, items: [] })
  const view = render(<TeamPage view="audit" state={state} translate={makeTranslate(en)} readAudit={readAudit} />)
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Audit source offline') })
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Audit source still offline') })
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  await waitFor(() => { expect(view.getByText('team/created')).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: en['detail.loadMore'] }))
  await waitFor(() => { expect(view.getByText(en['detail.auditEmpty'])).toBeTruthy() })
  expect(readAudit).toHaveBeenNthCalledWith(1, { limit: 64 }, expect.any(AbortSignal))
  expect(readAudit).toHaveBeenNthCalledWith(4, { limit: 64, afterCursor: 1 }, expect.any(AbortSignal))
})

it('cancels a pending audit read without publishing its late rejection', async () => {
  const state = workspaceSelection(workspaceState())
  let signal: AbortSignal | undefined
  const readAudit = vi.fn<NonNullable<TeamPageProps['readAudit']>>().mockImplementation(async (_options, current) => {
    signal = current
    return await new Promise((_resolve, reject) => {
      current?.addEventListener('abort', () => { reject(new DOMException('Read cancelled', 'AbortError')) }, { once: true })
    })
  })
  const view = render(<TeamPage view="audit" state={state} translate={makeTranslate(en)} readAudit={readAudit} />)
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  expect(view.getByText(en['detail.auditLoading'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  await waitFor(() => { expect(signal?.aborted).toBe(true) })
  expect(view.queryByRole('alert')).toBeNull()
  expect(view.queryByText(en['detail.auditLoading'])).toBeNull()
})

it('ignores a successful audit page delivered after its read was cancelled', async () => {
  const state = workspaceSelection(workspaceState())
  let finish!: (page: TeamAuditList) => void
  const readAudit = vi.fn<NonNullable<TeamPageProps['readAudit']>>().mockImplementation(async () =>
    await new Promise<TeamAuditList>((resolve) => { finish = resolve }))
  const view = render(<TeamPage view="audit" state={state} translate={makeTranslate(en)} readAudit={readAudit} />)
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  const signal = readAudit.mock.calls[0]?.[1]
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish({ teamId: state.team.id, items: [{ teamId: state.team.id,
    stream: 'team', cursor: 1, type: 'team/created', createdAt: 1, facts: {} }] }); await Promise.resolve() })
  expect(view.queryByText('team/created')).toBeNull()
})

it('keeps a new Team audit read active when the previous Team read settles late', async () => {
  const first = workspaceSelection(workspaceState())
  const otherId = 'other-audit-team' as never
  const original = workspaceState()
  const second = workspaceSelection({ ...original, team: { ...original.team, id: otherId },
    goal: { ...original.goal, teamId: otherId } })
  const resolve: Array<(page: TeamAuditList) => void> = []
  const readAudit = vi.fn<NonNullable<TeamPageProps['readAudit']>>().mockImplementation(async () =>
    await new Promise<TeamAuditList>((finish) => { resolve.push(finish) }))
  const props = { view: 'audit' as const, translate: makeTranslate(en), readAudit }
  const view = render(<TeamPage {...props} state={first} />)
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  const firstSignal = readAudit.mock.calls[0]?.[1]
  view.rerender(<TeamPage {...props} state={second} />)
  expect(firstSignal?.aborted).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['detail.audit'] }))
  const secondSignal = readAudit.mock.calls[1]?.[1]
  expect(secondSignal?.aborted).toBe(false)
  await act(async () => { resolve[0]?.({ teamId: first.team.id, items: [{ teamId: first.team.id,
    stream: 'team', cursor: 1, type: 'old/record', createdAt: 1, facts: {} }] }); await Promise.resolve() })
  expect(view.queryByText('old/record')).toBeNull()
  expect(view.getByText(en['detail.auditLoading'])).toBeTruthy()
  await act(async () => { resolve[1]?.({ teamId: second.team.id, items: [{ teamId: second.team.id,
    stream: 'team', cursor: 1, type: 'new/record', createdAt: 2, facts: {} }] }); await Promise.resolve() })
  expect(view.getByText('new/record')).toBeTruthy()
})

it('shows bounded Team budgets and usage on the audit module', () => {
  const base = workspaceState()
  const state = { ...workspaceSelection(base), metadata: { kind: 'available' as const, goal: base.goal,
    budgets: { maxTotalTokens: 100 }, usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 3,
      cacheWriteTokens: 2, turns: 1, costUnits: 4, updatedAt: 1 } } }
  const view = render(<TeamPage view="audit" state={state} translate={makeTranslate(en)} />)
  const budget = within(view.getByRole('region', { name: en['detail.budget'] }))
  expect(budget.getByText(/17 tokens/)).toBeTruthy()
  fireEvent.click(budget.getByText(en['detail.budgetLimits']))
  expect(budget.getByText(/maxTotalTokens/)).toBeTruthy()
})

it('retains a task after delete failure and removes it only after a confirmed retry', async () => {
  const task = workspaceTask('Delete retry')
  const state = workspaceSelection({ ...workspaceState(), tasks: [task] })
  const deleteTask = vi.fn(async () => {}).mockRejectedValueOnce(new Error('Delete rejected'))
    .mockRejectedValueOnce('Delete still rejected')
  const view = render(<TeamPage view="tasks" state={state} collections={taskCollections(task)}
    taskDetail={workspaceTaskDetail(task)} readTaskDetail={async () => {}}
    translate={makeTranslate(en)} deleteTask={deleteTask} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.delete'] }))
  const dialog = within(view.getByRole('dialog', { name: en['detail.task.delete'] }))
  fireEvent.click(dialog.getAllByRole('button', { name: en['detail.task.deleteCancel'] })[1]!)
  expect(view.queryByRole('dialog')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.delete'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.delete'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Delete rejected') })
  expect(view.getByRole('button', { name: task.subject })).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.delete'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Delete still rejected') })
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.delete'] }))
  await waitFor(() => { expect(view.queryByRole('button', { name: task.subject })).toBeNull() })
  expect(deleteTask).toHaveBeenCalledTimes(3)
})

it('keeps a new Team deletion pending while an aborted previous Team deletion settles', async () => {
  const original = workspaceState()
  const firstTask = workspaceTask('First deletion')
  const first = workspaceSelection({ ...original, tasks: [firstTask] })
  const otherId = 'other-delete-team' as never
  const secondTask = workspaceTask('Second deletion', { teamId: otherId })
  const second = workspaceSelection({ ...original, team: { ...original.team, id: otherId },
    goal: { ...original.goal, teamId: otherId }, tasks: [secondTask] })
  const finish: Array<() => void> = []
  const deleteTask = vi.fn<NonNullable<TeamPageProps['deleteTask']>>().mockImplementation(async () => {
    await new Promise<void>((resolve) => { finish.push(resolve) })
  })
  const props = { view: 'tasks' as const, translate: makeTranslate(en), deleteTask,
    readTaskDetail: async () => {} }
  const view = render(<TeamPage {...props} state={first} collections={taskCollections(firstTask)}
    taskDetail={workspaceTaskDetail(firstTask)} />)
  fireEvent.click(view.getByRole('button', { name: firstTask.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.delete'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.delete'] }))
  expect(view.getByText(en['detail.task.deleteLoading'])).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en['detail.task.deleteCancel'] })[0]!)
  expect(view.getByRole('dialog', { name: en['detail.task.delete'] })).toBeTruthy()
  const oldSignal = deleteTask.mock.calls[0]?.[2]
  view.rerender(<TeamPage {...props} state={second} collections={taskCollections(secondTask)}
    taskDetail={workspaceTaskDetail(secondTask)} />)
  expect(oldSignal?.aborted).toBe(true)
  fireEvent.click(view.getByRole('button', { name: secondTask.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.delete'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.delete'] }))
  await act(async () => { finish[0]?.(); await Promise.resolve() })
  expect(view.getByRole('dialog', { name: en['detail.task.delete'] })).toBeTruthy()
  expect(view.getByRole('button', { name: secondTask.subject })).toBeTruthy()
  await act(async () => { finish[1]?.(); await Promise.resolve() })
  expect(view.queryByRole('button', { name: secondTask.subject })).toBeNull()
})

it('suppresses a deletion failure after its Team page unmounts', async () => {
  const task = workspaceTask('Unmounted deletion')
  const state = workspaceSelection({ ...workspaceState(), tasks: [task] })
  let fail!: (reason: unknown) => void
  const deleteTask = vi.fn<NonNullable<TeamPageProps['deleteTask']>>().mockImplementation(async () => {
    await new Promise<void>((_resolve, reject) => { fail = reject })
  })
  const view = render(<TeamPage view="tasks" state={state} collections={taskCollections(task)}
    taskDetail={workspaceTaskDetail(task)} readTaskDetail={async () => {}}
    translate={makeTranslate(en)} deleteTask={deleteTask} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.delete'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.delete'] }))
  const signal = deleteTask.mock.calls[0]?.[2]
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { fail(new Error('Late delete failure')); await Promise.resolve() })
})

it('retains a running task after stop failure and clears the dialog after a confirmed retry', async () => {
  const task = workspaceTask('Stop retry', { phase: 'running', lease: {
    attemptId: 'stop-attempt' as never, participantId: 'worker' as never,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2,
  } })
  const state = workspaceSelection({ ...workspaceState(), tasks: [task] })
  const cancelTask = vi.fn(async () => {}).mockRejectedValueOnce('Stop rejected')
    .mockRejectedValueOnce(new Error('Stop still rejected'))
  const view = render(<TeamPage view="tasks" state={state} collections={taskCollections(task)}
    taskDetail={workspaceTaskDetail(task)} readTaskDetail={async () => {}}
    translate={makeTranslate(en)} cancelTask={cancelTask} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.stop'] }))
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en['detail.task.stopCancel'] })[1]!)
  expect(view.queryByRole('dialog')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.stop'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.stop'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Stop rejected') })
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.stop'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Stop still rejected') })
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.stop'] }))
  await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
  expect(cancelTask).toHaveBeenCalledTimes(3)
  expect(view.getByRole('button', { name: task.subject })).toBeTruthy()
})

it('keeps a new Team stop pending while an aborted previous Team stop settles', async () => {
  const original = workspaceState()
  const lease = { attemptId: 'pending-stop' as never, participantId: 'worker' as never,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2 }
  const firstTask = workspaceTask('First stop', { phase: 'running', lease })
  const first = workspaceSelection({ ...original, tasks: [firstTask] })
  const otherId = 'other-stop-team' as never
  const secondTask = workspaceTask('Second stop', { teamId: otherId, phase: 'running', lease })
  const second = workspaceSelection({ ...original, team: { ...original.team, id: otherId },
    goal: { ...original.goal, teamId: otherId }, tasks: [secondTask] })
  const finish: Array<() => void> = []
  const cancelTask = vi.fn<NonNullable<TeamPageProps['cancelTask']>>().mockImplementation(async () => {
    await new Promise<void>((resolve) => { finish.push(resolve) })
  })
  const props = { view: 'tasks' as const, translate: makeTranslate(en), cancelTask,
    readTaskDetail: async () => {} }
  const view = render(<TeamPage {...props} state={first} collections={taskCollections(firstTask)}
    taskDetail={workspaceTaskDetail(firstTask)} />)
  fireEvent.click(view.getByRole('button', { name: firstTask.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.stop'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.stop'] }))
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en['detail.task.stopCancel'] })[0]!)
  expect(view.getByRole('dialog', { name: en['detail.task.stop'] })).toBeTruthy()
  const oldSignal = cancelTask.mock.calls[0]?.[3]
  view.rerender(<TeamPage {...props} state={second} collections={taskCollections(secondTask)}
    taskDetail={workspaceTaskDetail(secondTask)} />)
  expect(oldSignal?.aborted).toBe(true)
  fireEvent.click(view.getByRole('button', { name: secondTask.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.stop'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.stop'] }))
  await act(async () => { finish[0]?.(); await Promise.resolve() })
  expect(view.getByRole('dialog', { name: en['detail.task.stop'] })).toBeTruthy()
  await act(async () => { finish[1]?.(); await Promise.resolve() })
  expect(view.queryByRole('dialog')).toBeNull()
  expect(view.getByRole('button', { name: secondTask.subject })).toBeTruthy()
})

it('suppresses a stop failure after its Team page unmounts', async () => {
  const task = workspaceTask('Unmounted stop', { phase: 'running', lease: {
    attemptId: 'unmounted-attempt' as never, participantId: 'worker' as never,
    assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2,
  } })
  const state = workspaceSelection({ ...workspaceState(), tasks: [task] })
  let fail!: (reason: unknown) => void
  const cancelTask = vi.fn<NonNullable<TeamPageProps['cancelTask']>>().mockImplementation(async () => {
    await new Promise<void>((_resolve, reject) => { fail = reject })
  })
  const view = render(<TeamPage view="tasks" state={state} collections={taskCollections(task)}
    taskDetail={workspaceTaskDetail(task)} readTaskDetail={async () => {}}
    translate={makeTranslate(en)} cancelTask={cancelTask} />)
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: en['taskView.actions'] }))
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.task.stop'] }))
  fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: en['detail.task.stop'] }))
  const signal = cancelTask.mock.calls[0]?.[3]
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { fail(new Error('Late stop failure')); await Promise.resolve() })
})

it('opens a selected workflow inspection and pages the independently loaded workflow list', async () => {
  const state = workspaceSelection(workspaceState())
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const collections = { teamId: state.team.id, members: empty, tasks: empty, artifacts: empty,
    workflowPlans: { ...empty, startCursor: 1, nextCursor: 2, items: [{ id: 'selected-plan' as never,
      teamId: state.team.id, revision: 1, phase: 'compiling' as const,
      name: { text: 'Listed plan', truncated: false }, taskCount: 1, boundTaskCount: 0 }] } }
  const readCollections = vi.fn(async () => {})
  const readWorkflowDetail = vi.fn(async () => {})
  const props = { state, collections, view: 'workflows' as const, translate: makeTranslate(en),
    readCollections, readWorkflowDetail, taskView: { ...DEFAULT_TEAM_VIEW, workflowPlanId: 'selected-plan' as never } }
  const view = render(<TeamPage {...props} />)
  await waitFor(() => { expect(readWorkflowDetail).toHaveBeenCalledWith('selected-plan', 'open') })
  fireEvent.click(view.getByRole('button', { name: 'Listed plan' }))
  expect(readWorkflowDetail).toHaveBeenCalledTimes(2)
  fireEvent.click(view.getByRole('button', { name: en['detail.firstPage'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.loadWorkflowPlans'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.refreshWorkflowPlans'] }))
  expect(readCollections.mock.calls).toEqual(expect.arrayContaining([
    ['workflowPlans', 'first'], ['workflowPlans', 'next'], ['workflowPlans'],
  ]))
  view.rerender(<TeamPage {...props} readWorkflowDetail={undefined} />)
  expect(view.getByRole('button', { name: 'Listed plan' }).hasAttribute('disabled')).toBe(true)
})

it('routes exact attention items to task, recovery and human-action owners', async () => {
  const state = workspaceSelection(workspaceState())
  const counts = { recovery: 1, humanActions: 1, reviews: 1, total: 3 }
  const items: TeamAttentionItem[] = [
    { kind: 'team-recovery', id: state.team.id, createdAt: 1,
      reason: { code: 'stalled', message: { text: 'Inspect blocked Team', truncated: false } },
      handling: { kind: 'actionable' } },
    { kind: 'task-review', id: 'attention-task' as never, createdAt: 2, revision: 1,
      subject: { text: 'Review exact task', truncated: false }, reviewerId: 'reviewer' as never,
      handling: { kind: 'actionable' } },
    { kind: 'human-action', id: 'attention-action' as never, createdAt: 3, updatedAt: 3,
      actionKind: 'approval', handling: { kind: 'actionable' } },
  ]
  const attention: TeamAttentionState = { teamId: state.team.id, limit: 20,
    loading: false, hasNewer: false, disconnected: false,
    page: { teamId: state.team.id, teamCursor: state.team.cursor, counts, items } }
  const onViewChange = vi.fn(), onTaskViewChange = vi.fn()
  const openPendingAction = vi.fn(async () => {})
  const readAttention = vi.fn(async () => {})
  const view = render(<TeamPage view="attention" state={state} translate={makeTranslate(en)}
    attention={attention} onViewChange={onViewChange} onTaskViewChange={onTaskViewChange}
    openPendingAction={openPendingAction} readAttention={readAttention} />)
  expect(readAttention).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['attention.refresh'] }))
  expect(readAttention).toHaveBeenCalledWith(state.team.id, 'first')
  fireEvent.click(view.getByRole('button', { name: 'Review exact task' }))
  expect(onTaskViewChange).toHaveBeenCalledWith({ view: 'tasks', taskId: 'attention-task' })
  fireEvent.click(view.getByRole('button', { name: en['attention.teamRecovery'] }))
  expect(onViewChange).toHaveBeenCalledWith('audit')
  fireEvent.click(view.getByRole('button', { name: en['detail.approval'] }))
  await waitFor(() => { expect(openPendingAction).toHaveBeenCalledWith(state.team.id, 'attention-action') })
  view.rerender(<TeamPage view="attention" state={state} translate={makeTranslate(en)} attention={attention} />)
  expect(view.getByText(en['attention.unavailable'])).toBeTruthy()
})

it('watches channel endpoint identities and retries a failed identity observation', () => {
  const state = workspaceSelection(workspaceState())
  const participantId = 'off-page-channel-member' as never
  const channel = { manifest: { id: 'identity-channel' as never, teamId: state.team.id,
    adapter: { type: 'direct', version: 4 }, participants: [{ id: participantId, role: 'human' }],
    limits: {} }, phase: 'active' as const, cursor: 1 }
  const watchIdentities = vi.fn(() => vi.fn())
  const refreshIdentities = vi.fn(async () => {})
  const view = render(<TeamPage view="channels" state={state} translate={makeTranslate(en)}
    channelListState={{ teamId: state.team.id, items: [channel], loading: false, loadingMore: false,
      hasNewer: false }} watchIdentities={watchIdentities} refreshIdentities={refreshIdentities}
    identities={{ teamId: state.team.id, items: [], loading: false, disconnected: true,
      forbidden: false, error: 'Identity directory offline' }} />)
  expect(watchIdentities).toHaveBeenCalledWith(state.team.id, [participantId])
  expect(view.getByRole('alert').textContent).toContain('Identity directory offline')
  fireEvent.click(view.getByRole('button', { name: en['identity.retry'] }))
  expect(refreshIdentities).toHaveBeenCalledOnce()
})

it('forwards a selected channel draft and catalog controls through the Team page', () => {
  const state = workspaceSelection(workspaceState())
  const channelId = 'draft-channel' as never
  const participantId = 'channel-member' as never
  const channel = { manifest: { id: channelId, teamId: state.team.id,
    adapter: { type: 'direct', version: 4 }, participants: [{ id: participantId, role: 'human' }], limits: {} },
  phase: 'active' as const, cursor: 1 }
  const envelopeId = 'draft-source' as never
  const record = { type: 'channel/envelope' as const, envelope: { id: envelopeId,
    teamId: state.team.id, channelId, sequence: 1, senderId: participantId,
    audience: null, kind: 'message', payload: { content: [{ type: 'text', text: 'Source content' }] },
    delivery: 'context' as const, priority: 'normal' as const, createdAt: 1 }, deliveryIntents: [] }
  const onChannelDraftChange = vi.fn(), onChannelDraftDiscard = vi.fn()
  const readChannels = vi.fn(async () => {})
  const readChannelCatalog = vi.fn(async () => {})
  const closeChannelView = vi.fn()
  const readChannelAttachment = vi.fn<NonNullable<TeamPageProps['readChannelAttachment']>>()
    .mockRejectedValue(new Error('No attachment'))
  const renderSlot: NonNullable<TeamPageProps['renderSlot']> = (_key, owner, options) => {
    // The generic renderer erases the key-specific owner until dispatch chooses this message slot.
    const message = owner as unknown as { loadAttachment: (id: string) => Promise<unknown> }
    void message.loadAttachment('missing-attachment').catch(() => {})
    return options?.fallback
  }
  const readMemberDetail = vi.fn(async () => {}), closeMemberDetail = vi.fn()
  const view = render(<TeamPage view="channels" state={state} translate={makeTranslate(en)}
    manage={vi.fn(async () => {})} onChannelDraftChange={onChannelDraftChange}
    onChannelDraftDiscard={onChannelDraftDiscard}
    taskView={{ ...DEFAULT_TEAM_VIEW, channelDetails: true }}
    readMemberDetail={readMemberDetail} closeMemberDetail={closeMemberDetail}
    channelState={{ channelId, page: { channel, records: [record] }, loading: false,
      acknowledging: false, hasNewer: false }}
    channelListState={{ teamId: state.team.id, items: [channel], loading: false,
      loadingMore: false, hasNewer: false }}
    readChannels={readChannels} readChannel={vi.fn(async () => ({ channel, records: [record] }))}
    channelCatalog={{ loading: false, value: { adapters: [{ type: 'direct', version: 4 }],
      viewPolicies: [] } }} readChannelCatalog={readChannelCatalog}
    readChannelAttachment={readChannelAttachment} renderSlot={renderSlot}
    acknowledgeChannel={vi.fn(async () => {})} closeChannelView={closeChannelView} />)
  expect(readChannels).toHaveBeenCalledWith(state.team.id)
  expect(readChannelCatalog).toHaveBeenCalledOnce()
  expect(view.getByText('Source content')).toBeTruthy()
  expect(readChannelAttachment).toHaveBeenCalledWith({ teamId: state.team.id, channelId,
    envelopeId, envelopeSequence: 1, attachmentId: 'missing-attachment' }, undefined)
  fireEvent.click(within(view.getByRole('complementary', { name: en['channelHub.details'] })).getByRole('button', { name: /channel-member/ }))
  expect(readMemberDetail).toHaveBeenCalledWith(state.team.id, participantId, 'first')
  fireEvent.click(within(view.getByRole('dialog', { name: en['memberDetail.title'] })).getByRole('button', { name: en.cancel }))
  fireEvent.change(view.getByPlaceholderText(en['channelHub.placeholder']), { target: { value: 'Retained Team draft' } })
  expect(onChannelDraftChange).toHaveBeenCalledWith(channelId,
    expect.objectContaining({ content: [expect.objectContaining({ content: { type: 'text', text: 'Retained Team draft' } })] }))
  fireEvent.click(view.getByRole('button', { name: en['channel.discardDraft'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['channel.discardDraft'] })).getByRole('button', { name: en['channel.discardDraft'] }))
  expect(onChannelDraftDiscard).toHaveBeenCalledWith(channelId)
  view.unmount()
  expect(closeChannelView).toHaveBeenCalledOnce()
})

it('routes overview task, activity, artifact and inventory actions through the selected Team', async () => {
  const base = workspaceState()
  const task = workspaceTask('Overview task')
  const member = { id: 'overview-member' as never, teamId: base.team.id, kind: 'local-agent' as const,
    displayName: 'Overview worker', role: 'worker', capabilities: [], phase: 'active' as const }
  const state = workspaceSelection({ ...base, tasks: [task], participants: [member] })
  const artifact: TeamArtifactReference = { id: 'report-one', provider: 'local', kind: 'report',
    uri: 'artifact://report-one', visibility: 'team' }
  const empty = { items: [], loading: false, loadingMore: false, hasNewer: false }
  const collections = { teamId: base.team.id, members: { ...empty, items: [workspaceMemberSummary(member)] },
    tasks: { ...empty, items: [workspaceTaskSummary(task)] }, workflowPlans: empty,
    artifacts: { ...empty, items: [artifact] } }
  const entry = { teamId: base.team.id, stream: 'team' as const, cursor: 5,
    type: 'team/created', createdAt: 1, facts: {} }
  const readAudit = vi.fn<NonNullable<TeamPageProps['readAudit']>>().mockResolvedValue({ teamId: base.team.id, items: [entry] })
  const readArtifact = vi.fn(async () => {})
  const readMemberDetail = vi.fn(async () => {}), closeMemberDetail = vi.fn()
  const onViewChange = vi.fn(), onTaskViewChange = vi.fn()
  const view = render(<TeamPage view="overview" state={state} collections={collections} translate={makeTranslate(en)}
    readAudit={readAudit} readArtifact={readArtifact} readMemberDetail={readMemberDetail}
    closeMemberDetail={closeMemberDetail} onViewChange={onViewChange}
    onTaskViewChange={onTaskViewChange} />)
  fireEvent.click(within(view.getByRole('region', { name: en['overview.members'] })).getByRole('button', { name: 'Overview worker' }))
  expect(readMemberDetail).toHaveBeenCalledWith(base.team.id, member.id, 'first')
  fireEvent.click(within(view.getByRole('dialog', { name: en['memberDetail.title'] })).getByRole('button', { name: en.cancel }))
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  expect(onTaskViewChange).toHaveBeenCalledWith({ taskId: task.id, view: 'tasks', taskSearch: '', taskPhase: 'all' })
  for (const [region, destination] of [
    [en['workspace.execution'], 'tasks'], [en['overview.members'], 'members'],
    [en['overview.artifacts'], 'artifacts'],
  ] as const) {
    fireEvent.click(within(view.getByRole('region', { name: region })).getByRole('button', { name: en['overview.viewAll'] }))
    expect(onViewChange).toHaveBeenLastCalledWith(destination)
  }
  fireEvent.click(within(view.getByRole('region', { name: en['overview.artifacts'] })).getByRole('button', { name: 'report-one' }))
  await waitFor(() => { expect(readArtifact).toHaveBeenCalledWith(artifact.id) })
  await waitFor(() => { expect(view.getByTitle('team/created')).toBeTruthy() })
  fireEvent.click(view.getByTitle('team/created'))
  expect(onViewChange).toHaveBeenLastCalledWith('audit')
  await waitFor(() => { expect(readAudit).toHaveBeenCalledWith({ limit: 64, afterCursor: 4 }, expect.any(AbortSignal)) })
})

it('opens task creation and routes its form draft through the Team workspace owner', () => {
  const state = workspaceSelection(workspaceState())
  const onTaskDraftChange = vi.fn<NonNullable<TeamPageProps['onTaskDraftChange']>>()
  const view = render(<TeamPage view="tasks" state={state} translate={makeTranslate(en)}
    manage={vi.fn(async () => {})} onTaskDraftChange={onTaskDraftChange} />)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskCreate'] }))
  const dialog = within(view.getByRole('dialog', { name: en['taskForm.taskCreate'] }))
  fireEvent.change(dialog.getByLabelText(en['taskForm.subject']), { target: { value: 'New child task' } })
  expect(onTaskDraftChange.mock.calls[0]?.[0]).toEqual({ kind: 'taskCreate' })
  expect(onTaskDraftChange.mock.calls[0]?.[1].fields.subject).toBe('New child task')
  fireEvent.click(dialog.getByRole('button', { name: en.cancel }))
  expect(view.queryByRole('dialog')).toBeNull()
})

it('keeps a retained creation draft readable while Team management is unavailable', () => {
  const state = workspaceSelection(workspaceState())
  const target = { kind: 'taskCreate' as const }
  const original = createTaskFormDraft(target, undefined, '')
  const draft = { ...original, fields: { ...original.fields, subject: 'Unsent release task' } }
  const view = render(<TeamPage view="tasks" state={state} translate={makeTranslate(en)}
    taskView={{ ...DEFAULT_TEAM_VIEW, taskForm: target, taskDrafts: { [taskDraftKey(target)]: draft } }} />)
  const dialog = within(view.getByRole('dialog', { name: en['taskForm.taskCreate'] }))
  expect(dialog.getByLabelText<HTMLInputElement>(en['taskForm.subject']).value).toBe('Unsent release task')
  expect(dialog.getByRole('button', { name: en['taskForm.taskCreate'] }).hasAttribute('disabled')).toBe(true)
})

it('pages loaded tasks and opens an available result artifact from its selected summary', async () => {
  const base = workspaceState()
  const artifact: TeamArtifactReference = { id: 'task-report', provider: 'local', kind: 'report',
    uri: 'artifact://task-report', visibility: 'team' }
  const task = workspaceTask('Artifact task', { phase: 'completed', attemptCount: 1,
    attemptHistory: [{ id: 'artifact-attempt' as never, teamId: base.team.id, taskId: 'Artifact task' as never,
      ordinal: 1, participantId: 'worker' as never, assignedAt: 1, leaseExpiresAt: 20, settledAt: 10,
      outcome: { kind: 'completed', result: { summary: 'Report prepared', artifacts: [artifact] } } }] })
  const state = workspaceSelection({ ...base, tasks: [task] })
  const collection = taskCollections(task)
  const readCollections = vi.fn(async () => {})
  const readArtifact = vi.fn(async () => {})
  const readMemberDetail = vi.fn(async () => {}), closeMemberDetail = vi.fn()
  const onViewChange = vi.fn()
  const loaded = { ...collection, tasks: { ...collection.tasks, startCursor: 1 } }
  const props = { view: 'tasks' as const, state, taskDetail: workspaceTaskDetail(task),
    readTaskDetail: async () => {}, readCollections, readArtifact, onViewChange,
    readMemberDetail, closeMemberDetail, translate: makeTranslate(en) }
  const view = render(<TeamPage {...props}
    collections={{ ...loaded, tasks: { ...loaded.tasks, loading: true } }} />)
  expect(view.getByText(en['detail.tasksLoading'])).toBeTruthy()
  view.rerender(<TeamPage {...props} collections={loaded} />)
  fireEvent.click(view.getByRole('button', { name: en['detail.firstPage'] }))
  expect(readCollections).toHaveBeenCalledWith('tasks', 'first')
  fireEvent.click(view.getByRole('button', { name: task.subject }))
  fireEvent.click(view.getByRole('button', { name: 'task-report' }))
  await waitFor(() => { expect(readArtifact).toHaveBeenCalledWith(artifact.id) })
  expect(onViewChange).toHaveBeenCalledWith('artifacts')
})

it('follows a workflow dependency into tasks and closes the exact workflow inspection', () => {
  const state = workspaceSelection(workspaceState())
  const planId = 'inspection-plan' as never
  const workflowDetail: TeamWorkflowDetailState = { teamId: state.team.id, planId,
    loading: false, hasNewer: false, disconnected: false, value: {
      record: { id: planId, teamId: state.team.id, revision: 1, phase: 'compiling',
        name: 'Inspection plan', bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 } },
      teamCursor: 1, startCursor: -1, total: 1, scanned: 1, items: [{ templateId: 'first' as never,
        subject: { text: 'First task', truncated: false }, blockedBy: [{ templateId: 'parent' as never,
          taskId: 'bound-parent' as never, subject: { text: 'Bound parent', truncated: false } }] }],
    } }
  const closeWorkflowDetail = vi.fn(), onTaskViewChange = vi.fn(), onViewChange = vi.fn()
  const view = render(<TeamPage view="workflows" state={state} translate={makeTranslate(en)}
    workflowDetail={workflowDetail} readWorkflowDetail={vi.fn(async () => {})}
    closeWorkflowDetail={closeWorkflowDetail} onTaskViewChange={onTaskViewChange}
    onViewChange={onViewChange} />)
  fireEvent.click(view.getByRole('link', { name: 'Bound parent' }))
  expect(onTaskViewChange).toHaveBeenCalledWith({ taskId: 'bound-parent', view: 'tasks', taskSearch: '', taskPhase: 'all' })
  expect(onViewChange).toHaveBeenCalledWith('tasks')
  fireEvent.click(view.getByRole('button', { name: en['workflowView.close'] }))
  expect(closeWorkflowDetail).toHaveBeenCalledOnce()
  expect(onTaskViewChange).toHaveBeenCalledWith({ workflowPlanId: undefined })
})

it('focuses the exact loaded task row after a workflow dependency opens the task module', () => {
  const task = workspaceTask('bound-parent')
  const state = workspaceSelection({ ...workspaceState(), tasks: [task] })
  const planId = 'focus-plan' as never
  const workflowDetail: TeamWorkflowDetailState = { teamId: state.team.id, planId,
    loading: false, hasNewer: false, disconnected: false, value: {
      record: { id: planId, teamId: state.team.id, revision: 1, phase: 'compiling',
        name: 'Focus plan', bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 } },
      teamCursor: 1, startCursor: -1, total: 1, scanned: 1, items: [{ templateId: 'first' as never,
        subject: { text: 'Dependent task', truncated: false }, blockedBy: [{ templateId: 'dependency' as never,
          taskId: task.id, subject: { text: 'Bound parent', truncated: false } }] }],
    } }
  function Page() {
    const [view, setView] = useState<'workflows' | 'tasks'>('workflows')
    return <TeamPage view={view} onViewChange={(next) => { if (next === 'tasks' || next === 'workflows') setView(next) }}
      state={state} collections={taskCollections(task)} translate={makeTranslate(en)}
      workflowDetail={workflowDetail} readWorkflowDetail={vi.fn(async () => {})} />
  }
  const view = render(<Page />)
  const link = view.getByRole('link', { name: 'Bound parent' })
  fireEvent.click(link, { ctrlKey: true })
  expect(view.getByRole('link', { name: 'Bound parent' })).toBeTruthy()
  fireEvent.click(link)
  expect(document.activeElement).toBe(view.getByRole('button', { name: task.subject }))
})
