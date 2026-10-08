// @vitest-environment jsdom
/** Task authoring keeps advanced policy input and dependency searches under explicit user control. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ITeamTasks, TeamManagementCommand, TeamTaskCapabilitiesState } from '@clocky/clocky-client-runtime/client'
import { TeamTaskDialog } from '../src/client/TeamTaskDialog.tsx'
import { en } from '../src/client/locales.ts'
import { createTaskFormDraft, type TaskFormDraft } from '../src/client/task-draft.ts'
import { workspaceState, workspaceTask, workspaceTaskDetail, workspaceTaskSummary } from './workspace-fixtures.client.ts'

afterEach(cleanup)

const teamId = workspaceState().team.id
const member = { id: 'reviewer' as never, kind: 'local-agent' as const, phase: 'active' as const,
  role: 'reviewer', displayName: 'Reviewer' }
const state = { team: workspaceState().team, participants: [member], tasks: [] }

function capabilities(integration = false): TeamTaskCapabilitiesState {
  return { input: { teamId, integration, readScopes: [], writeScopes: [] },
    loading: false, disconnected: false, value: { teamId, teamCursor: 1,
      observationId: 'a'.repeat(64) as never, observedAt: 1,
      create: { allowed: true, reasons: [] }, maxAttempts: 5,
      workspaceModes: [{ mode: 'shared', allowed: true, reasons: [] },
        { mode: 'sandbox', allowed: true, reasons: [] }],
      readScopes: { editable: true, accepted: true }, writeScopes: { editable: true, accepted: true },
    } }
}

it('retains advanced workspace, placement, budget and reviewer choices until explicit discard', () => {
  const close = vi.fn(), discard = vi.fn()
  const watchTaskCapabilities = vi.fn(() => vi.fn())
  const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }} state={state}
    translate={makeTranslate(en)} taskCapabilities={capabilities()}
    watchTaskCapabilities={watchTaskCapabilities} manage={vi.fn(async () => {})}
    onClose={close} onDraftDiscard={discard} />)
  fireEvent.click(view.getByText(en['taskForm.advanced']))
  fireEvent.click(view.getByText(en['taskForm.placement']))
  fireEvent.click(view.getByLabelText(en['taskForm.workspace.sandbox']))
  fireEvent.click(within(view.getByRole('group', { name: en['taskForm.placementMembers'] }))
    .getByRole('checkbox', { name: member.displayName }))
  fireEvent.click(within(view.getByRole('group', { name: en['taskForm.placementMembers'] }))
    .getByRole('checkbox', { name: member.displayName }))
  fireEvent.click(view.getByLabelText(/Reviewer · reviewer/))
  fireEvent.click(view.getByLabelText(en['taskForm.noReview']))
  for (const [label, value] of [
    [en['taskForm.placementRoles'], 'reviewer, worker'],
    [en['taskForm.placementProviders'], 'local, remote'],
    [en['taskForm.placementPresets'], 'fast'],
    [en['taskForm.placementModels'], 'model-a'],
    [en['manage.capabilities'], 'search, write'],
    [en['taskForm.priority'], '3'], [en['taskForm.maxAttempts'], '2'],
    [en['taskForm.maxTokens'], '1200'], [en['taskForm.maxTurns'], '6'],
    [en['taskForm.readScopes'], 'src/one\nsrc/two'],
    [en['taskForm.writeScopes'], 'out/report'],
  ] as const) fireEvent.change(view.getByLabelText(label), { target: { value } })
  expect((view.getByLabelText(en['taskForm.placementRoles']) as HTMLInputElement).value).toBe('reviewer, worker')
  expect((view.getByLabelText(en['taskForm.maxTokens']) as HTMLInputElement).value).toBe('1200')
  expect(watchTaskCapabilities).toHaveBeenCalledWith({ teamId, integration: false,
    readScopes: ['src/one', 'src/two'], writeScopes: ['out/report'] })
  const form = view.getByRole('dialog').querySelector('form')
  if (form === null) throw new Error('Task form is missing')
  fireEvent.compositionStart(form)
  fireEvent.keyDown(form, { key: 'Enter', isComposing: true })
  fireEvent.compositionEnd(form)
  fireEvent.click(view.getAllByRole('button', { name: en.cancel })[1]!)
  expect(view.getByRole('dialog', { name: en['taskForm.discardDraft'] })).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog', { name: en['taskForm.discardDraft'] }))
    .getAllByRole('button', { name: en.cancel })[0]!)
  expect(view.queryByRole('dialog', { name: en['taskForm.discardDraft'] })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: en['taskForm.discardDraft'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['taskForm.discardDraft'] }))
    .getByRole('button', { name: en['taskForm.continueEditing'] }))
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['taskForm.discardDraft'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['taskForm.discardDraft'] }))
    .getByRole('button', { name: en['taskForm.discardAndClose'] }))
  expect(discard).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('lets the user clear retained scopes when capability policy later makes them read-only', () => {
  const initial = capabilities()
  const props = { target: { kind: 'taskCreate' as const }, state, translate: makeTranslate(en),
    watchTaskCapabilities: vi.fn(() => vi.fn()), manage: vi.fn(async () => {}), onClose: vi.fn() }
  const view = render(<TeamTaskDialog {...props} taskCapabilities={initial} />)
  fireEvent.click(view.getByText(en['taskForm.advanced']))
  fireEvent.change(view.getByLabelText(en['taskForm.readScopes']), { target: { value: 'src/' } })
  fireEvent.change(view.getByLabelText(en['taskForm.writeScopes']), { target: { value: 'out/' } })
  const options = initial.value
  if (options === undefined) throw new Error('Capability fixture is missing')
  view.rerender(<TeamTaskDialog {...props} taskCapabilities={{ ...initial, value: { ...options,
    readScopes: { editable: false, accepted: false }, writeScopes: { editable: false, accepted: false } } }} />)
  expect(view.getByLabelText(en['taskForm.readScopes']).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.clearReadScopes'] }))
  fireEvent.click(view.getByRole('button', { name: en['taskForm.clearWriteScopes'] }))
  expect((view.getByLabelText(en['taskForm.readScopes']) as HTMLTextAreaElement).value).toBe('')
  expect((view.getByLabelText(en['taskForm.writeScopes']) as HTMLTextAreaElement).value).toBe('')
})

it('shows a current authoring blocker and refreshes the registered capability observation', () => {
  const available = capabilities()
  const options = available.value
  if (options === undefined) throw new Error('Capability fixture is missing')
  const refreshTaskCapabilities = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }} state={state}
    translate={makeTranslate(en)} manage={vi.fn(async () => {})}
    taskCapabilities={{ ...available, value: { ...options,
      create: { allowed: false, reasons: ['task-limit'] } } }}
    watchTaskCapabilities={vi.fn(() => vi.fn())}
    refreshTaskCapabilities={refreshTaskCapabilities} onClose={vi.fn()} />)
  expect(view.getByText(en['taskForm.blocker.task-limit'])).toBeTruthy()
  expect(view.getByRole('button', { name: en['taskForm.taskCreate'] }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.optionsRefresh'] }))
  expect(refreshTaskCapabilities).toHaveBeenCalledOnce()
})

it('keeps capability loading, disconnect and rejected scope reasons visible without submitting', () => {
  const original = capabilities()
  const options = original.value
  if (options === undefined) throw new Error('Capability fixture is missing')
  const props = { target: { kind: 'taskCreate' as const }, state, translate: makeTranslate(en),
    manage: vi.fn(async () => {}), watchTaskCapabilities: vi.fn(() => vi.fn()), onClose: vi.fn() }
  const view = render(<TeamTaskDialog {...props} taskCapabilities={{ ...original,
    loading: true, value: undefined }} />)
  expect(view.getByText(en['taskForm.optionsLoading'])).toBeTruthy()
  view.rerender(<TeamTaskDialog {...props} taskCapabilities={{ ...original, disconnected: true,
    error: 'Capability catalog offline', value: { ...options,
      create: { allowed: false, reasons: ['provider-unavailable'] },
      workspaceModes: [{ mode: 'shared', allowed: false, reasons: ['provider-unavailable'] }],
      readScopes: { editable: false, accepted: false }, writeScopes: { editable: false, accepted: false },
    } }} />)
  expect(view.getByText(en['taskForm.optionsDisconnected'])).toBeTruthy()
  expect(view.getByText(en['taskForm.noExecutionMode'])).toBeTruthy()
  expect(view.getByText(en['taskForm.scopesRejected'])).toBeTruthy()
  expect(view.getByText(en['taskForm.blocker.provider-unavailable'])).toBeTruthy()
  expect(view.getAllByRole('alert').map(item => item.textContent)).toContain('Capability catalog offline')
  expect(props.manage).not.toHaveBeenCalled()
})

it('retries one fully specified creation with its original command identity', async () => {
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockRejectedValueOnce('Response lost').mockResolvedValueOnce(undefined)
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }} state={state}
    translate={makeTranslate(en)} manage={manage} onClose={close}
    taskCapabilities={capabilities()} watchTaskCapabilities={vi.fn(() => vi.fn())} />)
  fireEvent.change(view.getByLabelText(en['taskForm.subject']), { target: { value: '  Release task  ' } })
  fireEvent.change(view.getByLabelText(en['taskForm.description']), { target: { value: '  Verify release  ' } })
  fireEvent.click(view.getByText(en['taskForm.advanced']))
  fireEvent.click(view.getByText(en['taskForm.placement']))
  fireEvent.click(within(view.getByRole('group', { name: en['taskForm.placementMembers'] }))
    .getByRole('checkbox', { name: member.displayName }))
  fireEvent.click(view.getByLabelText(/Reviewer · reviewer/))
  for (const [label, value] of [
    [en['taskForm.placementRoles'], 'reviewer, reviewer'],
    [en['taskForm.placementProviders'], 'local'],
    [en['taskForm.placementPresets'], 'fast'],
    [en['taskForm.placementModels'], 'model-a'],
    [en['manage.capabilities'], 'search, search, write'],
    [en['taskForm.priority'], '3'], [en['taskForm.maxAttempts'], '2'],
    [en['taskForm.maxTokens'], '1200'], [en['taskForm.maxTurns'], '6'],
  ] as const) fireEvent.change(view.getByLabelText(label), { target: { value } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskCreate'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Response lost') })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskCreate'] }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  const first = manage.mock.calls[0]?.[0], second = manage.mock.calls[1]?.[0]
  if (first?.operation !== 'taskCreate' || second?.operation !== 'taskCreate') throw new Error('Creation command is missing')
  expect(second.input.idempotencyKey).toBe(first.input.idempotencyKey)
  expect(first.input).toMatchObject({ subject: 'Release task', description: 'Verify release',
    priority: 3, maxAttempts: 2, budget: { maxTotalTokens: 1200, maxTurns: 6 },
    requiredCapabilities: ['search', 'write'],
    placement: { participantIds: [member.id], roles: ['reviewer'], providers: ['local'], presets: ['fast'], models: ['model-a'] },
    reviewPolicy: { kind: 'participant', reviewerId: member.id } })
})

it('retries the exact task record from the loading guard when its read failed', () => {
  const task = workspaceTask('Missing record')
  const base = workspaceTaskDetail(task)
  const readTaskDetail = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id }} state={state}
    inspection={{ ...base, record: { ...base.record, value: undefined, error: 'Record unavailable' } }}
    readTaskDetail={readTaskDetail} translate={makeTranslate(en)} onClose={vi.fn()} />)
  expect(view.getByRole('alert').textContent).toBe('Record unavailable')
  fireEvent.click(view.getByRole('button', { name: en['taskView.refresh'] }))
  expect(readTaskDetail).toHaveBeenCalledWith(teamId, task.id)
})

it('withholds a restored edit until the latest attempt read settles', () => {
  const task = workspaceTask('Latest attempt pending')
  const detail = workspaceTaskDetail(task)
  const view = render(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id }} state={state}
    inspection={{ ...detail, latest: { loading: true, value: undefined } }}
    translate={makeTranslate(en)} onClose={vi.fn()} />)
  expect(view.getByText(en['taskView.loading'])).toBeTruthy()
  expect(view.queryByLabelText(en['taskForm.description'])).toBeNull()
})

it('refuses a form submission event when Team management is unavailable', () => {
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }} state={state}
    translate={makeTranslate(en)} onClose={close} />)
  fireEvent.change(view.getByLabelText(en['taskForm.subject']), { target: { value: 'Unsent name' } })
  fireEvent.change(view.getByLabelText(en['taskForm.description']), { target: { value: 'Unsent instructions' } })
  const form = view.getByRole('dialog').querySelector('form')
  if (form === null) throw new Error('Task form is missing')
  fireEvent.submit(form)
  expect(view.getByText(en['taskForm.readOnlyRecovery'])).toBeTruthy()
  expect((view.getByLabelText(en['taskForm.subject']) as HTMLInputElement).value).toBe('Unsent name')
  expect(close).not.toHaveBeenCalled()
})

it('withholds a review after its task leaves review phase', () => {
  const task = workspaceTask('Late review', { phase: 'completed' })
  const view = render(<TeamTaskDialog target={{ kind: 'taskReview', taskId: task.id }} state={state}
    inspection={workspaceTaskDetail(task)} translate={makeTranslate(en)}
    manage={vi.fn(async () => {})} onClose={vi.fn()} />)
  expect(view.getByText(en['taskForm.unavailable'])).toBeTruthy()
  expect(view.getByRole('button', { name: en['taskForm.taskReview'] }).hasAttribute('disabled')).toBe(true)
})

it('keeps a completed integration source visible after an attempt-history read fails', () => {
  const task = workspaceTask('Retained integration', { phase: 'completed', attemptCount: 1,
    attemptHistory: [{ id: 'retained-attempt' as never, teamId, taskId: 'Retained integration' as never,
      ordinal: 1, participantId: member.id, assignedAt: 1, leaseExpiresAt: 20, settledAt: 10,
      outcome: { kind: 'completed', result: { summary: 'Source retained' } } }] })
  const detail = workspaceTaskDetail(task)
  const view = render(<TeamTaskDialog target={{ kind: 'taskIntegrate', taskId: task.id }} state={state}
    inspection={{ ...detail, attempts: { ...detail.attempts, error: 'Attempt page unavailable' } }}
    readTaskDetail={vi.fn(async () => {})} translate={makeTranslate(en)}
    manage={vi.fn(async () => {})} onClose={vi.fn()} />)
  expect(view.getAllByRole('alert').map(item => item.textContent)).toContain('Attempt page unavailable')
  expect(view.getByLabelText('retained-attempt')).toBeTruthy()
})

it('keeps blocked dependencies and a failed candidate page visible for correction', () => {
  const candidate = workspaceTask('Unavailable dependency')
  const target = { kind: 'taskCreate' as const }
  const original = createTaskFormDraft(target, undefined, '')
  const draft = { ...original, fields: { ...original.fields, blockedBy: [candidate.id] } }
  const query = { search: 'missing' }
  const taskReferences = { teamId, taskIds: [candidate.id], loading: true, disconnected: true,
    hasNewer: true, error: 'References stale', items: [{ taskId: candidate.id, state: 'unavailable' as const }] }
  const dependencyQuery = { teamId, query, loading: false, disconnected: true, hasNewer: true,
    error: 'Candidates unavailable', page: { kind: 'tasks' as const, teamId, teamCursor: 1,
      query, sourceTotal: 0, total: 0, scanned: 0, items: [] } }
  const props = { target, state, draft, translate: makeTranslate(en),
    manage: vi.fn(async () => {}), onClose: vi.fn(), taskReferences }
  const view = render(<TeamTaskDialog {...props} dependencyQuery={dependencyQuery} />)
  expect(view.getByText(en['taskForm.referencesUnavailable'])).toBeTruthy()
  expect(view.getByText(en['taskForm.referencesLoading'])).toBeTruthy()
  expect(view.getByText(en['taskForm.referencesChanged'])).toBeTruthy()
  expect(view.getByText(en['taskForm.removeUnavailable'])).toBeTruthy()
  expect(view.getByText(en['taskForm.dependenciesDisconnected'])).toBeTruthy()
  expect(view.getAllByRole('alert').map(item => item.textContent)).toEqual(expect.arrayContaining([
    'References stale', 'Candidates unavailable',
  ]))
  view.rerender(<TeamTaskDialog {...props} dependencyQuery={{ ...dependencyQuery,
    disconnected: false, hasNewer: false, error: undefined }} />)
  expect(view.getByText(en['taskForm.dependenciesNoResults'])).toBeTruthy()
  view.rerender(<TeamTaskDialog {...props} taskReferences={{ ...taskReferences,
    loading: false, disconnected: false, hasNewer: false, error: undefined,
    items: [{ taskId: candidate.id, state: 'resolved', revision: 2,
      phase: 'deleted', subject: { text: candidate.subject, truncated: false } }] }}
  dependencyQuery={{ ...dependencyQuery, disconnected: false, hasNewer: false, error: undefined }} />)
  expect(view.getByText(en['taskForm.deletedDependency'].replace('{taskId}', candidate.id))).toBeTruthy()
  view.rerender(<TeamTaskDialog {...props} taskReferences={{ ...taskReferences,
    loading: false, disconnected: false, hasNewer: false, error: undefined, items: [] }}
  dependencyQuery={{ ...dependencyQuery, disconnected: false, hasNewer: false, error: undefined }} />)
  expect(view.getByText(en['taskForm.unloadedDependency'].replace('{taskId}', candidate.id))).toBeTruthy()
})

it('searches and pages independent dependency candidates before adding a task reference', () => {
  const candidate = workspaceTask('Candidate dependency')
  const row = workspaceTaskSummary(candidate)
  const readDependencies = vi.fn(async () => {})
  const closeDependencies = vi.fn()
  const query = { search: '' }
  const dependencyQuery = { teamId, query, loading: false, disconnected: false, hasNewer: false,
    page: { kind: 'tasks' as const, teamId, teamCursor: 1, query, sourceTotal: 1, total: 1,
      scanned: 1, items: [row], nextQueryCursor: { teamId, teamCursor: 1, query,
        order: 'task-insertion-v1' as const, afterCursor: 0 } } }
  const props = { target: { kind: 'taskCreate' as const }, state, translate: makeTranslate(en),
    readDependencies, closeDependencies, manage: vi.fn(async () => {}), onClose: vi.fn() }
  const view = render(<TeamTaskDialog {...props} dependencyQuery={dependencyQuery} />)
  expect(readDependencies).toHaveBeenCalledWith(teamId, { search: '' }, 'first')
  const search = view.getByLabelText(en['taskForm.searchDependencies'])
  fireEvent.change(search, { target: { value: 'Candidate' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.search'] }))
  expect(readDependencies).toHaveBeenCalledWith(teamId, { search: 'Candidate' }, 'first')
  fireEvent.click(view.getByRole('button', { name: en['taskForm.refreshDependencies'] }))
  fireEvent.click(view.getByRole('button', { name: en['taskForm.nextDependencies'] }))
  expect(readDependencies).toHaveBeenCalledWith(teamId, { search: '' }, 'next')
  fireEvent.keyDown(search, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(search, { key: 'Enter', isComposing: false })
  fireEvent.keyDown(search, { key: 'a' })
  expect(readDependencies).toHaveBeenLastCalledWith(teamId, { search: 'Candidate' }, 'first')
  fireEvent.click(view.getByRole('button', { name: en['taskForm.clearSearch'] }))
  expect(document.activeElement).toBe(search)
  fireEvent.click(view.getByLabelText(candidate.subject))
  expect(view.getByText(en['taskForm.referencesUnavailable'])).toBeTruthy()
  fireEvent.click(view.getByLabelText(candidate.subject))
  expect(view.getByText(en['taskForm.noDependencies'])).toBeTruthy()
  view.rerender(<TeamTaskDialog {...props} dependencyQuery={{ ...dependencyQuery,
    loading: true, disconnected: true, hasNewer: true, error: 'Candidate page stale' }} />)
  expect(view.getByText(en['taskForm.dependenciesLoading'])).toBeTruthy()
  expect(view.getByRole('alert').textContent).toContain('Candidate page stale')
  view.unmount()
  expect(closeDependencies).toHaveBeenCalled()
  const unavailable = render(<TeamTaskDialog {...props} />)
  fireEvent.change(unavailable.getByLabelText(en['taskForm.searchDependencies']), { target: { value: 'Loose' } })
  fireEvent.click(unavailable.getByRole('button', { name: en['taskForm.refreshDependencies'] }))
  expect(readDependencies).toHaveBeenLastCalledWith(teamId, { search: 'Loose' }, 'first')
})

it('shows evidence from the completed attempt while submitting an exact review decision', async () => {
  const task = workspaceTask('Review evidence', { phase: 'review', attemptCount: 1,
    attemptHistory: [{ id: 'review-attempt' as never, teamId, taskId: 'Review evidence' as never,
      ordinal: 1, participantId: member.id, assignedAt: 1, leaseExpiresAt: 20, settledAt: 10,
      outcome: { kind: 'completed', result: { summary: 'Patch ready', evidence: ['Browser replay passed'],
        verification: 'Unit suite passed' } } }] })
  const manage = vi.fn(async () => {})
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={{ kind: 'taskReview', taskId: task.id }} state={state}
    inspection={workspaceTaskDetail(task)} translate={makeTranslate(en)} manage={manage} onClose={close} />)
  expect(view.getByText('Browser replay passed')).toBeTruthy()
  expect(view.getByText(/Unit suite passed/)).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskReview'] }))
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.reasonRequired'])
  expect(manage).not.toHaveBeenCalled()
  fireEvent.click(view.getByLabelText(en['taskForm.rework']))
  fireEvent.change(view.getByLabelText(en['taskForm.reason']), { target: { value: 'Add a release note' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskReview'] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledWith({ operation: 'taskReview', input: {
    taskId: task.id, expectedRevision: task.revision, decision: 'rework', reason: 'Add a release note',
  } }, expect.any(AbortSignal)) })
  expect(close).toHaveBeenCalledOnce()
})

it('cancels a pending review submission without closing or accepting its late completion', async () => {
  const task = workspaceTask('Review cancellation', { phase: 'review' })
  let finish!: () => void
  const manage = vi.fn<(_command: unknown, signal?: AbortSignal) => Promise<void>>().mockImplementation(async () => {
    await new Promise<void>((resolve) => { finish = resolve })
  })
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={{ kind: 'taskReview', taskId: task.id }} state={state}
    inspection={workspaceTaskDetail(task)} translate={makeTranslate(en)} manage={manage} onClose={close} />)
  fireEvent.change(view.getByLabelText(en['taskForm.reason']), { target: { value: 'Needs verification' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskReview'] }))
  expect(view.getByText(en['manage.pending'])).toBeTruthy()
  fireEvent.click(view.getAllByRole('button', { name: en.cancel })[0]!)
  expect(view.getByRole('dialog', { name: en['taskForm.taskReview'] })).toBeTruthy()
  const signal = manage.mock.calls[0]?.[1]
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  expect(signal?.aborted).toBe(true)
  expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead'])
  await act(async () => { finish(); await Promise.resolve() })
  expect(close).not.toHaveBeenCalled()
})

it('does not replace cancellation feedback with an aborted review rejection', async () => {
  const task = workspaceTask('Rejected after cancel', { phase: 'review' })
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockImplementation(async (_command, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('Late review failure')) }, { once: true })
      })
    })
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={{ kind: 'taskReview', taskId: task.id }} state={state}
    inspection={workspaceTaskDetail(task)} translate={makeTranslate(en)} manage={manage} onClose={close} />)
  fireEvent.change(view.getByLabelText(en['taskForm.reason']), { target: { value: 'Needs evidence' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskReview'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead']) })
  expect(close).not.toHaveBeenCalled()
})

it('suppresses a stale original-update lookup result after the user cancels its read', async () => {
  const task = workspaceTask('Uncertain update')
  const target = { kind: 'taskUpdate' as const, taskId: task.id }
  const current = workspaceTaskDetail(task)
  const original = createTaskFormDraft(target, current.record.value!.task, '')
  const input = { taskId: task.id, commandId: 'uncertain-command' as never,
    expectedRevision: task.revision, subject: task.subject, description: 'Submitted edit', blockedBy: [] }
  const draft = { ...original, fields: { ...original.fields, description: input.description },
    updateRetry: { input } }
  type Outcome = Awaited<ReturnType<NonNullable<ITeamTasks['lookupTaskUpdate']>>>
  let finish!: (outcome: Outcome) => void
  const lookupTaskUpdate = vi.fn<NonNullable<ITeamTasks['lookupTaskUpdate']>>().mockImplementation(async () =>
    await new Promise<Outcome>((resolve) => { finish = resolve }))
  const view = render(<TeamTaskDialog target={target} state={state} inspection={current}
    translate={makeTranslate(en)} draft={draft} manage={vi.fn(async () => {})}
    lookupTaskUpdate={lookupTaskUpdate} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.queryOriginal'] }))
  const signal = lookupTaskUpdate.mock.calls[0]?.[1]
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish({ kind: 'not-found', teamId, taskId: task.id,
    commandId: input.commandId }); await Promise.resolve() })
  expect(view.queryByText(en['taskForm.originalNotFound'])).toBeNull()
  expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead'])
})

it('does not replace cancellation feedback with a late original-lookup rejection', async () => {
  const task = workspaceTask('Rejected lookup after cancel')
  const target = { kind: 'taskUpdate' as const, taskId: task.id }
  const original = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'lookup-after-cancel' as never,
    expectedRevision: task.revision, subject: task.subject, description: 'Submitted edit', blockedBy: [] }
  const draft = { ...original, fields: { ...original.fields, description: input.description }, updateRetry: { input } }
  const lookupTaskUpdate = vi.fn<NonNullable<ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async (_input, signal) => await new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new Error('Late lookup failure')) }, { once: true })
    }))
  const view = render(<TeamTaskDialog target={target} state={state} inspection={workspaceTaskDetail(task)}
    draft={draft} translate={makeTranslate(en)} lookupTaskUpdate={lookupTaskUpdate}
    manage={vi.fn(async () => {})} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.queryOriginal'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead']) })
})

it('keeps the original update retry after a receipt-draft failure and reports a later detail-read failure', async () => {
  const task = workspaceTask('Refused original')
  const target = { kind: 'taskUpdate' as const, taskId: task.id }
  const detail = workspaceTaskDetail(task)
  const original = createTaskFormDraft(target, detail.record.value!.task, '')
  const input = { taskId: task.id, commandId: 'refused-original' as never,
    expectedRevision: task.revision, subject: task.subject, description: 'Retained edit', blockedBy: [] }
  const draft = { ...original, fields: { ...original.fields, description: input.description },
    updateRetry: { input } }
  const lookupTaskUpdate = vi.fn<NonNullable<ITeamTasks['lookupTaskUpdate']>>()
    .mockResolvedValue({ kind: 'rejected', rejection: { teamId, taskId: task.id,
      commandId: input.commandId, expectedRevision: task.revision, observedRevision: 2,
      rejectedAt: 20, reason: 'stale-revision' } })
  let rejectReceipt = true
  const onDraftChange = vi.fn((next: TaskFormDraft) => {
    if (rejectReceipt && next.previousUpdateInput !== undefined) throw new Error('Receipt draft is full')
  })
  const readTaskDetail = vi.fn<NonNullable<ITeamTasks['readTaskDetail']>>()
    .mockRejectedValueOnce('Task detail offline')
    .mockRejectedValueOnce(new Error('Task detail still offline'))
  const view = render(<TeamTaskDialog target={target} state={state} inspection={detail}
    translate={makeTranslate(en)} draft={draft} manage={vi.fn(async () => {})}
    onDraftChange={onDraftChange} lookupTaskUpdate={lookupTaskUpdate}
    readTaskDetail={readTaskDetail} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.queryOriginal'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Receipt draft is full') })
  expect(readTaskDetail).not.toHaveBeenCalled()
  rejectReceipt = false
  fireEvent.click(view.getByRole('button', { name: en['taskForm.queryOriginal'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Task detail offline') })
  expect(readTaskDetail).toHaveBeenCalledWith(teamId, task.id)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.queryOriginal'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Task detail still offline') })
})

it('reports original-update query and retry failures while retaining the same command', async () => {
  const task = workspaceTask('Failed original lookup')
  const target = { kind: 'taskUpdate' as const, taskId: task.id }
  const original = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'failed-original' as never,
    expectedRevision: task.revision, subject: task.subject, description: 'Saved edit', blockedBy: [] }
  const draft = { ...original, fields: { ...original.fields, description: input.description },
    updateRetry: { input } }
  const lookupTaskUpdate = vi.fn<NonNullable<ITeamTasks['lookupTaskUpdate']>>()
    .mockRejectedValueOnce(new Error('Lookup offline'))
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockRejectedValueOnce('Original retry refused')
  const view = render(<TeamTaskDialog target={target} state={state} inspection={workspaceTaskDetail(task)}
    draft={draft} translate={makeTranslate(en)} lookupTaskUpdate={lookupTaskUpdate}
    manage={manage} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.queryOriginal'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Lookup offline') })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.retryOriginal'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Original retry refused') })
  expect(manage.mock.calls[0]?.[0]).toEqual({ operation: 'taskUpdate', input })
})

it('keeps a changed edit when applying the original receipt cannot retain its cleared retry', async () => {
  const task = workspaceTask('Applied original')
  const target = { kind: 'taskUpdate' as const, taskId: task.id }
  const original = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'applied-original' as never,
    expectedRevision: task.revision, subject: task.subject, description: 'Submitted instructions', blockedBy: [] }
  const draft = { ...original, fields: { ...original.fields, description: 'Newer unsent instructions' },
    updateRetry: { input } }
  const lookupTaskUpdate = vi.fn<NonNullable<ITeamTasks['lookupTaskUpdate']>>()
    .mockResolvedValue({ kind: 'applied', receipt: { teamId, taskId: task.id,
      commandId: input.commandId, expectedRevision: task.revision, appliedRevision: 2, appliedAt: 20 } })
  const onDraftChange = vi.fn((next: TaskFormDraft) => {
    if (next.updateRetry === undefined) throw new Error('Cannot clear uncertain retry')
  })
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={target} state={state} inspection={workspaceTaskDetail(task)}
    draft={draft} translate={makeTranslate(en)} lookupTaskUpdate={lookupTaskUpdate}
    onDraftChange={onDraftChange} manage={vi.fn(async () => {})} onClose={close} />)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.queryOriginal'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Cannot clear uncertain retry') })
  expect(close).not.toHaveBeenCalled()
  expect((view.getByLabelText(en['taskForm.description']) as HTMLTextAreaElement).value).toBe('Newer unsent instructions')
})

it('does not accept a late retry response after the original command read is cancelled', async () => {
  const task = workspaceTask('Cancelled retry')
  const target = { kind: 'taskUpdate' as const, taskId: task.id }
  const original = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'cancelled-original' as never,
    expectedRevision: task.revision, subject: task.subject, description: 'Saved edit', blockedBy: [] }
  const draft = { ...original, fields: { ...original.fields, description: input.description },
    updateRetry: { input } }
  let finish!: () => void
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockImplementation(async () => { await new Promise<void>((resolve) => { finish = resolve }) })
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={target} state={state} inspection={workspaceTaskDetail(task)}
    draft={draft} translate={makeTranslate(en)} lookupTaskUpdate={vi.fn<NonNullable<ITeamTasks['lookupTaskUpdate']>>()}
    manage={manage} onClose={close} />)
  fireEvent.click(view.getByRole('button', { name: en['taskForm.retryOriginal'] }))
  const signal = manage.mock.calls[0]?.[1]
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish(); await Promise.resolve() })
  expect(close).not.toHaveBeenCalled()
  expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead'])
})

it('pages source attempts and submits the selected integration target with its version', async () => {
  const attempts = ['first-attempt', 'second-attempt'].map((id, index) => ({
    id: id as never, teamId, taskId: 'Integrate task' as never,
    ordinal: index + 1, participantId: member.id, assignedAt: 1 + index,
    leaseExpiresAt: 20, settledAt: 10 + index,
    outcome: { kind: 'completed' as const, result: { summary: `Output ${index + 1}` } },
  }))
  const task = workspaceTask('Integrate task', { phase: 'completed', attemptCount: 2, attemptHistory: attempts })
  const base = workspaceTaskDetail(task)
  const page = base.attempts.value
  if (page === undefined) throw new Error('Fixture attempt page is missing')
  const readTaskDetail = vi.fn(async () => {})
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockResolvedValue(undefined)
  const view = render(<TeamTaskDialog target={{ kind: 'taskIntegrate', taskId: task.id }} state={state}
    inspection={{ ...base, attempts: { ...base.attempts, value: { ...page, nextCursor: 0 } } }}
    readTaskDetail={readTaskDetail} translate={makeTranslate(en)} manage={manage}
    taskCapabilities={capabilities(true)} watchTaskCapabilities={vi.fn(() => vi.fn())}
    taskReferences={{ teamId, taskIds: [task.id], teamCursor: 1, loading: false,
      disconnected: false, hasNewer: false, items: [{ taskId: task.id, state: 'resolved',
        revision: task.revision, phase: task.phase, subject: { text: task.subject, truncated: false } }] }}
    watchTaskReferences={vi.fn(() => vi.fn())}
    onClose={vi.fn()} />)
  const history = within(view.getByRole('group', { name: en['taskForm.sourceAttempt'] }))
  fireEvent.click(history.getByRole('button', { name: en['detail.firstPage'] }))
  fireEvent.click(history.getByRole('button', { name: en['taskView.nextHistory'] }))
  expect(readTaskDetail).toHaveBeenCalledWith(teamId, task.id, 'attempts', 'first')
  expect(readTaskDetail).toHaveBeenCalledWith(teamId, task.id, 'attempts', 'next')
  fireEvent.click(history.getByLabelText('first-attempt'))
  fireEvent.change(view.getByLabelText(en['taskForm.description']), { target: { value: 'Integrate verified output' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskIntegrate'] }))
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.providerRequired'])
  fireEvent.change(view.getByLabelText(en['taskForm.integrationProvider']), { target: { value: 'git' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskIntegrate'] }))
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.targetRequired'])
  fireEvent.change(view.getByLabelText(en['taskForm.integrationTarget']), { target: { value: 'main' } })
  fireEvent.click(view.getByLabelText(en['taskForm.integrate']))
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskIntegrate'] }))
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.versionRequired'])
  fireEvent.change(view.getByLabelText(en['taskForm.expectedTarget']), { target: { value: 'sha256:base' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskIntegrate'] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledTimes(1) })
  const integrated = manage.mock.calls[0]?.[0]
  if (integrated?.operation !== 'taskCreate') throw new Error('Integration command is missing')
  expect(integrated.input.integration).toEqual({ sourceTaskId: task.id,
    sourceAttemptId: attempts[0]!.id, provider: 'git', target: 'main',
    mode: 'integrate', expectedTarget: 'sha256:base' })
  fireEvent.click(view.getByLabelText(en['taskForm.proposal']))
  fireEvent.change(view.getByLabelText(en['taskForm.expectedTarget']), { target: { value: '' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskIntegrate'] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledTimes(2) })
  const proposal = manage.mock.calls[1]?.[0]
  if (proposal?.operation !== 'taskCreate') throw new Error('Integration proposal is missing')
  expect(proposal.input.integration).toMatchObject({ mode: 'proposal', target: 'main' })
  expect(proposal.input.integration).not.toHaveProperty('expectedTarget')
})

it('requires a completed source attempt before integrating an otherwise completed task', () => {
  const task = workspaceTask('No source attempt', { phase: 'completed' })
  const manage = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={{ kind: 'taskIntegrate', taskId: task.id }} state={state}
    inspection={workspaceTaskDetail(task)} translate={makeTranslate(en)} manage={manage}
    taskCapabilities={capabilities(true)} watchTaskCapabilities={vi.fn(() => vi.fn())}
    taskReferences={{ teamId, taskIds: [task.id], teamCursor: 1, loading: false,
      disconnected: false, hasNewer: false, items: [{ taskId: task.id, state: 'resolved',
        revision: task.revision, phase: task.phase, subject: { text: task.subject, truncated: false } }] }}
    watchTaskReferences={vi.fn(() => vi.fn())} onClose={vi.fn()} />)
  fireEvent.change(view.getByLabelText(en['taskForm.description']), { target: { value: 'Inspect missing source' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskIntegrate'] }))
  expect(view.getByRole('alert').textContent).toBe(en['taskForm.attemptRequired'])
  expect(manage).not.toHaveBeenCalled()
})

it('preserves edited input when quota rejects the command identity before task update', () => {
  const task = workspaceTask('Quota update')
  const manage = vi.fn(async () => {})
  const onDraftChange = vi.fn((draft: TaskFormDraft) => {
    if (draft.updateRetry !== undefined) throw new Error('Cannot retain update identity')
  })
  const view = render(<TeamTaskDialog target={{ kind: 'taskUpdate', taskId: task.id }} state={state}
    inspection={workspaceTaskDetail(task)} translate={makeTranslate(en)} manage={manage}
    onDraftChange={onDraftChange} onClose={vi.fn()} />)
  fireEvent.change(view.getByLabelText(en['taskForm.description']), { target: { value: 'Keep this edit' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskUpdate'] }))
  expect(view.getByRole('alert').textContent).toBe('Cannot retain update identity')
  expect((view.getByLabelText(en['taskForm.description']) as HTMLTextAreaElement).value).toBe('Keep this edit')
  expect(manage).not.toHaveBeenCalled()
})

it('keeps a stale edit unchanged when its reviewed revision cannot be retained', () => {
  const original = workspaceTask('Revision task')
  const current = workspaceTask(original.id, { revision: 2, description: 'Current instructions' })
  const target = { kind: 'taskUpdate' as const, taskId: original.id }
  const draft = createTaskFormDraft(target, workspaceTaskDetail(original).record.value!.task, '')
  const retained = { ...draft, fields: { ...draft.fields, description: 'Proposed instructions' } }
  const onDraftChange = vi.fn((next: TaskFormDraft) => {
    if (next.baselineRevision === 2) throw new Error('Cannot retain reviewed revision')
  })
  const manage = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={target} state={state} draft={retained}
    inspection={workspaceTaskDetail(current)} translate={makeTranslate(en)}
    onDraftChange={onDraftChange} manage={manage} onClose={vi.fn()} />)
  expect(view.getByText(en['taskForm.changed'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['taskForm.useLatest'] }))
  expect(view.getByRole('alert').textContent).toBe('Cannot retain reviewed revision')
  expect((view.getByLabelText(en['taskForm.description']) as HTMLTextAreaElement).value).toBe('Proposed instructions')
  expect(manage).not.toHaveBeenCalled()
})

it('compares resolved dependency names on a changed task revision', () => {
  const parents = [workspaceTask('first-parent'), workspaceTask('second-parent')]
  const original = workspaceTask('Dependency revision', { blockedBy: parents.map(parent => parent.id) })
  const current = workspaceTask(original.id, { revision: 2, blockedBy: parents.map(parent => parent.id) })
  const target = { kind: 'taskUpdate' as const, taskId: original.id }
  const draft = createTaskFormDraft(target, workspaceTaskDetail(original).record.value!.task, '')
  const props = { target, state, draft, inspection: workspaceTaskDetail(current), translate: makeTranslate(en),
    watchTaskReferences: vi.fn(() => vi.fn()), manage: vi.fn(async () => {}), onClose: vi.fn() }
  const references = { teamId, taskIds: parents.map(parent => parent.id), loading: false,
    disconnected: false, hasNewer: false, items: parents.map((parent, index) => ({ taskId: parent.id,
      state: 'resolved' as const, revision: 1, phase: 'pending' as const,
      subject: { text: parent.subject, truncated: index === 0 } })) }
  const view = render(<TeamTaskDialog {...props} taskReferences={references} />)
  expect(view.getByRole('table', { name: en['taskForm.comparison'] }).textContent).toContain('first-parent…')
  expect(view.getByRole('table', { name: en['taskForm.comparison'] }).textContent).toContain('second-parent')
  view.rerender(<TeamTaskDialog {...props} taskReferences={{ ...references, items: [] }} />)
  expect(view.getByRole('table', { name: en['taskForm.comparison'] }).textContent).toContain(parents[0]!.id)
})

it('does not refocus a trigger removed while the task dialog was open', () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }} state={state}
    translate={makeTranslate(en)} onClose={vi.fn()} />)
  trigger.remove()
  view.unmount()
  expect(trigger.isConnected).toBe(false)
})

it('shows a failed latest read and then withholds edits when the selected task starts running', () => {
  const pending = workspaceTask('Task status')
  const target = { kind: 'taskUpdate' as const, taskId: pending.id }
  const readTaskDetail = vi.fn(async () => {})
  const base = workspaceTaskDetail(pending)
  const props = { target, state, translate: makeTranslate(en),
    readTaskDetail, manage: vi.fn(async () => {}), onClose: vi.fn() }
  const view = render(<TeamTaskDialog {...props} inspection={{ ...base,
    latest: { ...base.latest, error: 'Latest attempt offline' } }} />)
  expect(view.getByRole('alert').textContent).toBe('Latest attempt offline')
  fireEvent.click(view.getByRole('button', { name: en['taskView.refresh'] }))
  expect(readTaskDetail).toHaveBeenCalledWith(teamId, pending.id)
  const running = workspaceTask(pending.id, { phase: 'running', revision: 2,
    lease: { attemptId: 'running-attempt' as never, participantId: member.id,
      assignedAt: 1, expiresAt: 100, assignedRevision: 1, ordinal: 1, durationMs: 99, renewedAt: 1, startedAt: 2 } })
  view.rerender(<TeamTaskDialog {...props} inspection={workspaceTaskDetail(running)} />)
  expect(view.getByText(en['taskForm.updateUnavailable'])).toBeTruthy()
  expect(view.getByRole('button', { name: en['taskForm.taskUpdate'] }).hasAttribute('disabled')).toBe(true)
})

it('preserves a new task when quota rejects its creation retry identity', () => {
  const manage = vi.fn(async () => {})
  const onDraftChange = vi.fn((draft: TaskFormDraft) => {
    if (draft.createRetry !== undefined) throw 'Cannot retain creation identity'
  })
  const view = render(<TeamTaskDialog target={{ kind: 'taskCreate' }} state={state}
    translate={makeTranslate(en)} manage={manage} onDraftChange={onDraftChange}
    taskCapabilities={capabilities()} watchTaskCapabilities={vi.fn(() => vi.fn())} onClose={vi.fn()} />)
  fireEvent.change(view.getByLabelText(en['taskForm.subject']), { target: { value: 'Keep new task' } })
  fireEvent.change(view.getByLabelText(en['taskForm.description']), { target: { value: 'Retained instructions' } })
  fireEvent.click(view.getByRole('button', { name: en['taskForm.taskCreate'] }))
  expect(view.getByRole('alert').textContent).toBe('Cannot retain creation identity')
  expect((view.getByLabelText(en['taskForm.subject']) as HTMLInputElement).value).toBe('Keep new task')
  expect(manage).not.toHaveBeenCalled()
})
