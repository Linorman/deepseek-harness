// @vitest-environment jsdom
/** Retained edit navigation remains readable after current management eligibility ends. */
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { TeamPage } from '../src/client/TeamPage.tsx'
import { createTeamWorkspaceStore } from '../src/client/workspace-store.ts'
import { createTaskFormDraft } from '../src/client/task-draft.ts'
import { workspaceState, workspaceTask, workspaceTaskDetail, workspaceSelection, workspaceTaskSummary } from './workspace-fixtures.client.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it.each(['parent', 'terminal', 'stalled', 'quiescing'] as const)
('opens a retained edit through the actual %s Team page and queries it without mutation', async (mode) => {
  const task = workspaceTask('retained-input')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const store = createTeamWorkspaceStore().create()
  const draft = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'original-update' as never, expectedRevision: 1,
    subject: task.subject, description: 'Submitted input', blockedBy: [] }
  store.actions.update(task.teamId, { view: 'tasks', taskId: task.id })
  store.actions.setTaskDraft(task.teamId, target, { ...draft,
    fields: { ...draft.fields, description: input.description }, updateRetry: { input } })
  const full = { ...workspaceState(), tasks: [task] }
  if (mode === 'terminal') full.team = { ...full.team, phase: 'cancelled' }
  if (mode === 'stalled' || mode === 'quiescing') full.team = { ...full.team, phase: mode }
  const selection = { ...workspaceSelection(full), ...mode === 'parent' ? { readAccess: 'parent-inspection' as const } : {} }
  const manage = vi.fn(async () => {})
  const lookup = vi.fn<NonNullable<import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async value => ({ kind: 'applied', receipt: { ...value, expectedRevision: 1, appliedRevision: 2, appliedAt: 20 } }))
  function Harness() {
    const snapshot = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    const preferences = snapshot.byTeam[task.teamId]
    if (preferences === undefined) throw new Error('Draft entry fixture requires retained Team preferences')
    return <TeamPage state={selection} translate={makeTranslate(en)}
      view="tasks" taskView={preferences}
      onTaskViewChange={(patch) => { store.actions.update(task.teamId, patch) }}
      onTaskDraftChange={(target, value) => { store.actions.setTaskDraft(task.teamId, target, value) }}
      onTaskDraftDiscard={(target) => { store.actions.discardTaskDraft(task.teamId, target) }}
      manage={manage} lookupTaskUpdate={lookup}
      taskDetail={workspaceTaskDetail(task)} readTaskDetail={async () => {}}
      collections={{ teamId: task.teamId,
        tasks: { items: [workspaceTaskSummary(task)], loading: false, loadingMore: false, hasNewer: false },
        members: { items: [], loading: false, loadingMore: false, hasNewer: false },
        workflowPlans: { items: [], loading: false, loadingMore: false, hasNewer: false },
        artifacts: { items: [], loading: false, loadingMore: false, hasNewer: false } }} />
  }
  const view = render(<Harness />)
  expect(view.queryByRole('button', { name: 'Create task' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Open edit draft' }))
  expect(view.getByText(en['taskForm.readOnlyTeam'])).toBeTruthy()
  expect((view.getByRole('button', { name: 'Retry original update' }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Query original update' }))
  await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
  expect(lookup).toHaveBeenCalledWith({ teamId: task.teamId, taskId: task.id, commandId: input.commandId }, expect.any(AbortSignal))
  expect(manage).not.toHaveBeenCalled()
})
