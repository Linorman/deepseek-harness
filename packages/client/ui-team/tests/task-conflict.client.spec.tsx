// @vitest-environment jsdom
/** Revision review compares the complete editable payload and keeps invalid dependencies explicit. */
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TaskReferencesState, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import { TeamTaskDialog } from '../src/client/TeamTaskDialog.tsx'
import { createTaskFormDraft, type TaskFormDraft } from '../src/client/task-draft.ts'
import { workspaceTask, workspaceState, workspaceTaskDetail } from './workspace-fixtures.client.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(en)
const oldId = 'old-dependency' as TeamTaskId
const nextId = 'new-dependency' as TeamTaskId
function references(taskIds: readonly TeamTaskId[]): TaskReferencesState {
  return { teamId: workspaceState().team.id, taskIds, loading: false, disconnected: false, hasNewer: false, teamCursor: 4,
    items: taskIds.map(taskId => ({ taskId, state: 'resolved', revision: 1, phase: 'pending', subject: { text: String(taskId), truncated: false } })) }
}

it('compares trimmed proposed names, complete instructions and exact dependency sets before confirmation', async () => {
  const original = workspaceTask('editable')
  const task = workspaceTask('editable', { revision: 2, subject: 'Current name', description: 'Current\ncomplete instructions', blockedBy: [oldId] })
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const baseline = createTaskFormDraft(target, workspaceTaskDetail(original).record.value!.task, '')
  const draft = { ...baseline, fields: { ...baseline.fields, subject: '  Proposed name  ', description: '  Proposed\ncomplete instructions  ', blockedBy: [nextId] } }
  const changed = vi.fn()
  const view = render(<TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
    inspection={workspaceTaskDetail(task)} draft={draft} onDraftChange={changed} translate={t} manage={async () => {}} onClose={() => {}}
    watchTaskReferences={() => () => {}} taskReferences={references([oldId, nextId])} />)
  const table = within(view.getByRole('table', { name: 'Current task and proposed fields' }))
  expect(table.getByText('Current name')).toBeTruthy()
  expect(table.getByText('Proposed name')).toBeTruthy()
  expect(table.getByText('Current complete instructions')).toBeTruthy()
  expect(table.getByText('Proposed complete instructions')).toBeTruthy()
  expect(table.getByText('old-dependency (old-dependency)')).toBeTruthy()
  expect(table.getByText('new-dependency (new-dependency)')).toBeTruthy()
  expect(table.getAllByText('This field will be replaced')).toHaveLength(3)
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Use the reviewed latest version' }))
  expect(changed).toHaveBeenCalledWith({ ...draft, baselineRevision: 2 })
})

it.each(['deleted', 'unavailable'] as const)('retains the exact %s dependency until the user removes it', async (status) => {
  const task = workspaceTask('editable')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const baseline = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const initial = { ...baseline, fields: { ...baseline.fields, blockedBy: [nextId] } }
  const snapshot: TaskReferencesState = { ...references([nextId]), items: status === 'deleted'
    ? [{ taskId: nextId, state: 'resolved', revision: 2, phase: 'deleted', subject: { text: 'Deleted work', truncated: false } }]
    : [{ taskId: nextId, state: 'unavailable' }] }
  const manage = vi.fn(async () => {})
  function Harness() {
    const [draft, setDraft] = useState<TaskFormDraft>(initial)
    return <TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
      inspection={workspaceTaskDetail(task)} draft={draft} onDraftChange={setDraft} translate={t} manage={manage} onClose={() => {}}
      watchTaskReferences={() => () => {}} taskReferences={snapshot} />
  }
  const view = render(<Harness />)
  const item = view.getByRole('checkbox', { name: `${status === 'deleted' ? 'Deleted' : 'Unavailable'} dependency: ${nextId}` })
  expect((item as HTMLInputElement).checked).toBe(true)
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText('Remove deleted or unavailable dependencies explicitly before submitting.')).toBeTruthy()
  expect(manage).not.toHaveBeenCalled()
  fireEvent.click(item)
  expect(view.getByText('No dependencies selected.')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await waitFor(() => { expect(manage).toHaveBeenCalledWith({ operation: 'taskUpdate', input: {
    commandId: expect.any(String) as unknown,
    taskId: task.id, expectedRevision: 1, subject: task.subject, description: task.description, blockedBy: [],
  } }, expect.any(AbortSignal)) })
})

it('keeps selected IDs removable after reference failure and exposes explicit revalidation', () => {
  const task = workspaceTask('editable', { blockedBy: [oldId] })
  const refresh = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id }}
    state={{ team: workspaceState().team, tasks: [], participants: [] }} inspection={workspaceTaskDetail(task)} translate={t}
    manage={async () => {}} onClose={() => {}} watchTaskReferences={() => () => {}} refreshTaskReferences={refresh}
    taskReferences={{ ...references([oldId]), error: 'Reference IO failed', hasNewer: true }} />)
  expect((view.getByRole('checkbox', { name: oldId }) as HTMLInputElement).disabled).toBe(false)
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText('Reference IO failed')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Check dependency status' }))
  expect(refresh).toHaveBeenCalledOnce()
})

it('refreshes unread current facts before showing them as the current version', () => {
  const task = workspaceTask('editable')
  const read = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id }}
    state={{ team: workspaceState().team, tasks: [], participants: [] }} inspection={{ ...workspaceTaskDetail(task), hasNewer: true }}
    translate={t} manage={async () => {}} onClose={() => {}} readTaskDetail={read} />)
  expect(view.queryByRole('table')).toBeNull()
  expect(view.getByText('Refresh the task before comparing its current version.')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Refresh details' }))
  expect(read).toHaveBeenCalledWith(task.teamId, task.id)
})

it.each(['same', 'newer', 'changed'] as const)('keeps a failed %s-version read retryable while preserving input and blocking confirmation', (mode) => {
  const original = workspaceTask('editable')
  const task = mode === 'changed' ? workspaceTask('editable', { revision: 2 }) : original
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const initial = createTaskFormDraft(target, workspaceTaskDetail(original).record.value!.task, '')
  const draft = { ...initial, fields: { ...initial.fields, description: 'My retained input' } }
  const inspection = workspaceTaskDetail(task)
  const read = vi.fn(async () => {})
  const manage = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
    inspection={{ ...inspection, hasNewer: mode === 'newer', record: { ...inspection.record, error: 'Current read failed' } }}
    draft={draft} translate={t} manage={manage} readTaskDetail={read} onClose={() => {}} />)
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('My retained input')
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.queryByRole('button', { name: 'Use the reviewed latest version' })).toBeNull()
  expect((view.getByRole('button', { name: 'Refresh details' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(view.getByRole('button', { name: 'Refresh details' }))
  expect(read).toHaveBeenCalledWith(task.teamId, task.id)
  expect(manage).not.toHaveBeenCalled()
})
