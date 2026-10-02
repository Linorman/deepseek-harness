// @vitest-environment jsdom
/** Bounded task input survives dialog replacement without acquiring current write authority. */
import { useCallback, useState, useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamManagementCommand, TeamTaskCapabilitiesInput } from '@clocky/clocky-client-runtime/client'
import { TeamTaskStartError } from '@clocky/clocky-client-runtime/client'
import { TeamTaskDialog } from '../src/client/TeamTaskDialog.tsx'
import { createTeamWorkspaceStore, DraftCapacityError } from '../src/client/workspace-store.ts'
import { createTaskFormDraft, taskDraftKey, hasTaskDraftInput, isPreviousTaskUpdateUnchanged,
  type TeamTaskDialogTarget } from '../src/client/task-draft.ts'
import { workspaceTask, workspaceState, workspaceTaskDetail } from './workspace-fixtures.client.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(en)

it('requires a semantic edit or reviewed revision change after a resolved update, ignoring replacement IDs and raw whitespace', () => {
  const task = workspaceTask('original')
  const initial = createTaskFormDraft({ kind: 'taskUpdate', taskId: task.id }, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'resolved' as never, expectedRevision: task.revision,
    subject: initial.fields.subject, description: initial.fields.description, blockedBy: initial.fields.blockedBy }
  const draft = { ...initial, previousUpdateInput: input }
  expect(isPreviousTaskUpdateUnchanged(initial)).toBe(false)
  expect(isPreviousTaskUpdateUnchanged(draft)).toBe(true)
  expect(isPreviousTaskUpdateUnchanged({ ...draft, previousUpdateInput: { ...input, commandId: 'another-id' as never },
    fields: { ...draft.fields, subject: ` ${input.subject} `, description: ` ${input.description} ` } })).toBe(true)
  expect(isPreviousTaskUpdateUnchanged({ ...draft, baselineRevision: task.revision + 1 })).toBe(false)
  for (const patch of [{ subject: 'Changed name' }, { description: 'Changed instructions' }, { blockedBy: ['dependency' as never] }]) {
    expect(isPreviousTaskUpdateUnchanged({ ...draft, fields: { ...draft.fields, ...patch } })).toBe(false)
  }
})

it('keeps independent operation and Team drafts within the shared count and UTF-8 quota', () => {
  const task = workspaceTask('source')
  const create = { kind: 'taskCreate' } as const
  const update = { kind: 'taskUpdate', taskId: task.id } as const
  const original = createTaskFormDraft(create, undefined, '')
  const input = { ...original, fields: { ...original.fields, subject: '甲😀', description: 'Unsent instructions' } }
  const bytes = new TextEncoder().encode(JSON.stringify([task.teamId, 'task', taskDraftKey(create), input])).byteLength
  const bounded = createTeamWorkspaceStore({ maxDraftBytes: bytes }).create()
  bounded.actions.setTaskDraft(task.teamId, create, input)
  const before = bounded.getSnapshot()
  expect(() =>{  bounded.actions.setTaskDraft(task.teamId, create, { ...input,
    fields: { ...input.fields, subject: '甲😀x' } }) }).toThrow(DraftCapacityError)
  expect(bounded.getSnapshot()).toBe(before)
  expect(hasTaskDraftInput(original)).toBe(false)
  expect(hasTaskDraftInput(input)).toBe(true)
  expect(hasTaskDraftInput(undefined)).toBe(false)
  const store = createTeamWorkspaceStore({ maxDrafts: 3, maxViewStates: 4 }).create()
  store.actions.setTaskDraft(task.teamId, create, input)
  store.actions.setTaskDraft(task.teamId, update, createTaskFormDraft(update, workspaceTaskDetail(task).record.value!.task, ''))
  store.actions.setActionDraft('other' as never, 'request' as never, { answers: {} })
  expect(() =>{  store.actions.setTaskDraft(task.teamId, { kind: 'taskReview', taskId: task.id }, input) }).toThrow(DraftCapacityError)
  for (let index = 0; index < 10; index++) store.actions.update(`clean-${index}` as never, {})
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(create)]?.fields.subject).toBe('甲😀')
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(update)]?.fields.subject).toBe('source')
  store.actions.clearFormDrafts()
  expect(store.getSnapshot().draftCount).toBe(0)
  expect(store.getSnapshot().draftBytes).toBe(0)
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts).toEqual({})
})

it('preserves raw creation fields and retry identity through rejection and closing, then releases the admitted draft', async () => {
  const team = workspaceState().team
  const target = { kind: 'taskCreate' } as const
  const store = createTeamWorkspaceStore().create()
  const manage = vi.fn<(command: TeamManagementCommand) => Promise<void>>()
    .mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(undefined)
  const onClose = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(true)
    const snapshot = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    const [input, setInput] = useState<TeamTaskCapabilitiesInput>({ teamId: team.id, integration: false, readScopes: [], writeScopes: [] })
    const watch = useCallback((value: TeamTaskCapabilitiesInput) => { setInput(value); return () => {} }, [])
    return <><button onClick={() => { setOpen(true) }}>Reopen</button>{open && <TeamTaskDialog target={target}
      state={{ team, tasks: [], participants: [] }} translate={t} manage={manage}
      draft={snapshot.byTeam[team.id]?.taskDrafts[taskDraftKey(target)]}
      onDraftChange={(value) => { store.actions.setTaskDraft(team.id, target, value) }}
      onDraftDiscard={() => { store.actions.discardTaskDraft(team.id, target) }}
      onClose={() => { setOpen(false); onClose() }}
      watchTaskCapabilities={watch} taskCapabilities={{ input, loading: false, disconnected: false, value: {
        teamId: team.id, teamCursor: team.cursor, observationId: 'a'.repeat(64) as never, observedAt: 1,
        create: { allowed: true, reasons: [] }, maxAttempts: 100,
        workspaceModes: ['shared', 'worktree'].map(mode => ({ mode: mode as 'shared' | 'worktree', allowed: true, reasons: [] })),
        readScopes: { editable: true, accepted: true }, writeScopes: { editable: true, accepted: true },
      } }} />}</>
  }
  const view = render(<Harness />)
  fireEvent.change(view.getByLabelText('Task name'), { target: { value: 'Retained task' } })
  fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'Preserve all entered instructions.' } })
  fireEvent.click(view.getByText('Advanced execution options'))
  fireEvent.click(view.getByLabelText('Git worktree'))
  fireEvent.change(view.getByLabelText('Read scopes (one path per line)'), { target: { value: 'src/long folder\ndocs' } })
  fireEvent.change(view.getByLabelText('Total token budget (optional)'), { target: { value: '1200' } })
  fireEvent.click(view.getByRole('button', { name: 'Create task' }))
  await view.findByText('Lost response')
  fireEvent.click(view.getByRole('button', { name: 'Close and keep draft' }))
  fireEvent.click(view.getByRole('button', { name: 'Reopen' }))
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('Preserve all entered instructions.')
  expect((view.getByLabelText('Read scopes (one path per line)') as HTMLTextAreaElement).value).toBe('src/long folder\ndocs')
  expect((view.getByLabelText('Git worktree') as HTMLInputElement).checked).toBe(true)
  expect((view.getByLabelText('Total token budget (optional)') as HTMLInputElement).value).toBe('1200')
  fireEvent.click(view.getByRole('button', { name: 'Create task' }))
  await waitFor(() => { expect(manage).toHaveBeenCalledTimes(2) })
  expect(manage.mock.calls[1]?.[0]).toEqual(manage.mock.calls[0]?.[0])
  expect(onClose).toHaveBeenCalledTimes(2)
  expect(store.getSnapshot().byTeam[team.id]?.taskDrafts).toEqual({})
})

it('reopens an edited task at its retained baseline and requires current revision confirmation', async () => {
  const task = workspaceTask('original')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const original = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  let draft = { ...original, fields: { ...original.fields, description: 'My unsubmitted edit' } }
  const current = workspaceTask('original', { revision: 2, description: 'Another editor changed this' })
  const manage = vi.fn(async () => {})
  const close = vi.fn()
  const props = { target, state: { team: workspaceState().team, participants: [], tasks: [] }, inspection: workspaceTaskDetail(current),
    translate: t, manage, onClose: close }
  const view = render(<TeamTaskDialog {...props} draft={draft} onDraftChange={(next) => {
    draft = next
    view.rerender(<TeamTaskDialog {...props} draft={draft} onDraftChange={(value) => { draft = value }} />)
  }} />)
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('My unsubmitted edit')
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Use the reviewed latest version' }))
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await waitFor(() => { expect(close).toHaveBeenCalledOnce() })
  expect(manage).toHaveBeenCalledWith({ operation: 'taskUpdate', input: {
    commandId: expect.any(String) as unknown,
    taskId: task.id, expectedRevision: 2, subject: 'original', description: 'My unsubmitted edit', blockedBy: [],
  } }, expect.any(AbortSignal))
})

it('confirms actual input loss and leaves the retained form untouched after a quota rejection', async () => {
  const target: TeamTaskDialogTarget = { kind: 'taskCreate' }
  const original = createTaskFormDraft(target, undefined, '')
  const draft = { ...original, fields: { ...original.fields, subject: 'Retained input' } }
  const discard = vi.fn()
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={target} state={{ team: workspaceState().team, participants: [], tasks: [] }}
    translate={t} manage={async () => {}} draft={draft} onDraftChange={() => { throw new Error('Quota exhausted') }}
    onDraftDiscard={discard} onClose={close} />)
  fireEvent.change(view.getByLabelText('Task name'), { target: { value: 'Would overflow' } })
  await view.findByText('Quota exhausted')
  expect((view.getByLabelText('Task name') as HTMLInputElement).value).toBe('Retained input')
  fireEvent.click(view.getByRole('button', { name: 'Discard task draft' }))
  expect(discard).not.toHaveBeenCalled()
  const confirmation = within(view.getByRole('dialog', { name: 'Discard task draft' }))
  fireEvent.click(confirmation.getByRole('button', { name: 'Continue editing' }))
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Discard task draft' }))
  fireEvent.click(within(view.getByRole('dialog', { name: 'Discard task draft' })).getByRole('button', { name: 'Discard and close' }))
  expect(discard).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it.each(['taskReview', 'taskIntegrate'] as const)('retains independent %s input and the exact source attempt after reopening', async (kind) => {
  const base = workspaceTask('source')
  const attempt = { id: 'source-attempt' as never, teamId: base.teamId, taskId: base.id, ordinal: 1,
    participantId: 'worker' as never, assignedAt: 1, startedAt: 2, settledAt: 3, leaseExpiresAt: 20,
    outcome: { kind: 'completed' as const, result: { summary: 'Ready for review and integration.' } } }
  const task = workspaceTask('source', { revision: 4, phase: kind === 'taskReview' ? 'review' : 'completed',
    reviewPolicy: { kind: 'participant', reviewerId: 'human' as never }, attemptCount: 1, attemptHistory: [attempt] })
  const target = { kind, taskId: task.id }
  const store = createTeamWorkspaceStore().create()
  function Harness() {
    const [open, setOpen] = useState(true)
    const state = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    return <><button onClick={() => { setOpen(true) }}>Reopen</button>{open && <TeamTaskDialog target={target}
      state={{ team: workspaceState().team, participants: [], tasks: [] }} inspection={workspaceTaskDetail(task)}
      translate={t} manage={async () => {}} onClose={() => { setOpen(false) }}
      draft={state.byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]}
      onDraftChange={(value) => { store.actions.setTaskDraft(task.teamId, target, value) }} />}</>
  }
  const view = render(<Harness />)
  if (kind === 'taskReview') {
    fireEvent.click(view.getByLabelText('Request rework'))
    fireEvent.change(view.getByLabelText('Review reason'), { target: { value: 'Include reproduction evidence.' } })
  } else {
    fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'Verify before integration.' } })
    fireEvent.change(view.getByLabelText('Workspace provider'), { target: { value: 'shared' } })
    fireEvent.change(view.getByLabelText('Target branch or directory'), { target: { value: 'main' } })
    fireEvent.click(view.getByLabelText('Update target'))
    fireEvent.change(view.getByLabelText('Expected target version'), { target: { value: 'sha256:baseline' } })
  }
  fireEvent.click(view.getByRole('button', { name: 'Close and keep draft' }))
  fireEvent.click(view.getByRole('button', { name: 'Reopen' }))
  if (kind === 'taskReview') {
    expect((view.getByLabelText('Review reason') as HTMLTextAreaElement).value).toBe('Include reproduction evidence.')
    expect((view.getByLabelText('Request rework') as HTMLInputElement).checked).toBe(true)
  } else {
    expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('Verify before integration.')
    expect((view.getByLabelText('Workspace provider') as HTMLInputElement).value).toBe('shared')
    expect((view.getByLabelText('Expected target version') as HTMLInputElement).value).toBe('sha256:baseline')
    expect((view.getByLabelText('Update target') as HTMLInputElement).checked).toBe(true)
    expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.fields.sourceAttemptId).toBe(attempt.id)
  }
})

it('waits for the exact runtime inspection before exposing restored task fields', async () => {
  const task = workspaceTask('private task')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const read = vi.fn(async () => {})
  const view = render(<TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
    inspection={{ ...workspaceTaskDetail(task), teamId: 'other-team' as never }}
    draft={createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')}
    readTaskDetail={read} translate={t} manage={async () => {}} onClose={() => {}} />)
  await waitFor(() => { expect(read).toHaveBeenCalledWith(task.teamId, task.id) })
  expect(view.queryByLabelText('Instructions')).toBeNull()
  expect(view.getByText('Loading task details…')).toBeTruthy()
})

it.each(['query', 'retry'] as const)('keeps an original uncertain update while editing and confirms it before a fresh command (%s)', async (mode) => {
  const task = workspaceTask('original')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const store = createTeamWorkspaceStore().create()
  const manage = vi.fn<(command: TeamManagementCommand) => Promise<void>>()
    .mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue(undefined)
  const lookup = vi.fn<NonNullable<import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async input => ({ kind: 'not-found', ...input }))
  const closed = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState(task)
    const snapshot = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    return <TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
      inspection={workspaceTaskDetail(current)} translate={t} manage={manage} lookupTaskUpdate={lookup}
      readTaskDetail={async () => { setCurrent(workspaceTask('original', { revision: 2, description: 'First edit' })) }}
      draft={snapshot.byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]}
      onDraftChange={(value) => { store.actions.setTaskDraft(task.teamId, target, value) }}
      onDraftDiscard={() => { store.actions.discardTaskDraft(task.teamId, target) }} onClose={closed} />
  }
  const view = render(<Harness />)
  fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'First edit' } })
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await view.findByText('Response lost')
  const original = manage.mock.calls[0]?.[0]
  if (original?.operation !== 'taskUpdate') throw new Error('Update draft test requires its original command')
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.updateRetry?.input).toEqual(original.input)
  fireEvent.change(view.getByLabelText('Instructions'), { target: { value: 'Second edit' } })
  fireEvent.click(view.getByRole('button', { name: 'Query original update' }))
  await waitFor(() => { expect(lookup).toHaveBeenCalledTimes(1) })
  expect(manage).toHaveBeenCalledTimes(1)
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.updateRetry?.input).toEqual(original.input)
  lookup.mockResolvedValue({ kind: 'applied', receipt: { teamId: task.teamId, taskId: task.id,
    commandId: original.input.commandId, expectedRevision: 1, appliedRevision: 2, appliedAt: 20 } })
  fireEvent.click(view.getByRole('button', { name: mode === 'query' ? 'Query original update' : 'Retry original update' }))
  await waitFor(() => { expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.updateRetry).toBeUndefined() })
  expect(closed).not.toHaveBeenCalled()
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('Second edit')
  if (mode === 'retry') expect(manage.mock.calls[1]?.[0]).toEqual(original)
  await waitFor(() => { expect(view.getByRole('button', { name: 'Use the reviewed latest version' })).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: 'Use the reviewed latest version' }))
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await waitFor(() => { expect(closed).toHaveBeenCalledTimes(1) })
  const next = manage.mock.calls.at(-1)?.[0]
  expect(next).toMatchObject({ operation: 'taskUpdate', input: { taskId: task.id, expectedRevision: 2, description: 'Second edit' } })
  expect(next?.operation === 'taskUpdate' && next.input.commandId).not.toBe(original.input.commandId)
})

it.each(['direct', 'query', 'retry'] as const)('keeps rejected input through %s confirmation and closing, then submits a corrected new command', async (mode) => {
  const task = workspaceTask('editable')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const dependencyId = 'cycle-candidate' as never
  const store = createTeamWorkspaceStore().create()
  const initial = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  store.actions.setTaskDraft(task.teamId, target, { ...initial, fields: { ...initial.fields, blockedBy: [dependencyId] } })
  let original: Extract<TeamManagementCommand, { operation: 'taskUpdate' }>['input'] | undefined
  const refusal = () => {
    if (original === undefined) throw new Error('Refusal fixture needs the original update input')
    return { teamId: task.teamId, taskId: task.id, commandId: original.commandId, expectedRevision: 1,
      observedRevision: 1, rejectedAt: 20, reason: 'invalid-edit' as const }
  }
  const error = () => new TeamTaskStartError('Task dependency cycle', {
    code: 'team-task-update-rejected', message: 'Task dependency cycle', details: { rejection: refusal() },
  })
  const manage = vi.fn<(command: TeamManagementCommand) => Promise<void>>().mockImplementation(async (command) => {
    if (command.operation !== 'taskUpdate') throw new Error('Rejected edit fixture accepts task updates only')
    if (original === undefined) { original = command.input; throw mode === 'direct' ? error() : new Error('Response lost') }
    if (command.input.commandId === original.commandId) throw error()
  })
  const lookup = vi.fn<NonNullable<import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async () => ({ kind: 'rejected', rejection: refusal() }))
  const closed = vi.fn()
  const watch = () => () => {}
  function Harness() {
    const [open, setOpen] = useState(true)
    const snapshot = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    return <><button onClick={() => { setOpen(true) }}>Reopen</button>{open && <TeamTaskDialog target={target}
      state={{ team: workspaceState().team, tasks: [], participants: [] }} inspection={workspaceTaskDetail(task)}
      translate={t} manage={manage} lookupTaskUpdate={lookup} watchTaskReferences={watch}
      taskReferences={{ teamId: task.teamId, taskIds: [dependencyId], items: [{ taskId: dependencyId, state: 'resolved',
        subject: { text: 'Cycle candidate', truncated: false }, revision: 1, phase: 'pending' }],
      teamCursor: workspaceState().team.cursor, loading: false, hasNewer: false, disconnected: false }}
      draft={snapshot.byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]}
      onDraftChange={(value) => { store.actions.setTaskDraft(task.teamId, target, value) }}
      onDraftDiscard={() => { store.actions.discardTaskDraft(task.teamId, target) }}
      onClose={() => { setOpen(false); closed() }} />}</>
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await waitFor(() => { expect(manage).toHaveBeenCalledTimes(1) })
  if (mode !== 'direct') {
    await view.findByText('Response lost')
    fireEvent.click(view.getByRole('button', { name: mode === 'query' ? 'Query original update' : 'Retry original update' }))
  }
  await view.findByText(mode === 'query' ? 'The original update was rejected. Correct selected dependencies or other edit fields; input is preserved.'
    : 'Task dependency cycle')
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.updateRetry).toBeUndefined()
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.previousUpdateInput).toEqual(original)
  if (mode === 'retry') expect(manage.mock.calls[1]?.[0]).toEqual(manage.mock.calls[0]?.[0])
  fireEvent.click(view.getByRole('button', { name: 'Close and keep draft' }))
  fireEvent.click(view.getByRole('button', { name: 'Reopen' }))
  fireEvent.click(view.getByRole('checkbox', { name: 'Cycle candidate' }))
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await waitFor(() => { expect(closed).toHaveBeenCalledTimes(2) })
  const command = manage.mock.calls.at(-1)?.[0]
  expect(command).toMatchObject({ operation: 'taskUpdate', input: { taskId: task.id, expectedRevision: 1, blockedBy: [] } })
  expect(command?.operation === 'taskUpdate' && command.input.commandId).not.toBe(original?.commandId)
  expect(store.getSnapshot().draftCount).toBe(0)
})

it('keeps a stale-revision refusal editable only after explicit current-version review', async () => {
  const task = workspaceTask('original')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const store = createTeamWorkspaceStore().create()
  const initial = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  store.actions.setTaskDraft(task.teamId, target, { ...initial, fields: { ...initial.fields, description: 'My retained edit' } })
  const manage = vi.fn<(command: TeamManagementCommand) => Promise<void>>().mockImplementationOnce(async (command) => {
    if (command.operation !== 'taskUpdate') throw new Error('Stale fixture requires a task update')
    throw new TeamTaskStartError('Revision is stale', { code: 'team-task-update-rejected', message: 'Revision is stale', details: {
      rejection: { teamId: task.teamId, taskId: task.id, commandId: command.input.commandId, expectedRevision: 1,
        observedRevision: 2, rejectedAt: 20, reason: 'stale-revision' },
    } })
  }).mockResolvedValue(undefined)
  const closed = vi.fn()
  function Harness() {
    const [current, setCurrent] = useState(task)
    const snapshot = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    return <TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
      inspection={workspaceTaskDetail(current)} translate={t} manage={manage}
      readTaskDetail={async () => { setCurrent(workspaceTask('peer changed task', { id: task.id, revision: 2 })) }}
      draft={snapshot.byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]}
      onDraftChange={(value) => { store.actions.setTaskDraft(task.teamId, target, value) }}
      onDraftDiscard={() => { store.actions.discardTaskDraft(task.teamId, target) }} onClose={closed} />
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await view.findByText('The original update was rejected for a stale revision. Input is preserved; review the current revision before resubmitting.')
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('My retained edit')
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: 'Use the reviewed latest version' }))
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(view.getByRole('button', { name: 'Edit task' }))
  await waitFor(() => { expect(closed).toHaveBeenCalledTimes(1) })
  expect(manage.mock.calls[1]?.[0]).toMatchObject({ operation: 'taskUpdate', input: { expectedRevision: 2, description: 'My retained edit' } })
})

it.each(['workflow-owned', 'active-execution'] as const)('preserves safe input after an original %s refusal without resubmitting it', async (reason) => {
  const task = workspaceTask('original')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const initial = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'original-refused' as never, expectedRevision: task.revision,
    subject: task.subject, description: 'Retained unsent instructions', blockedBy: [] }
  const store = createTeamWorkspaceStore().create()
  store.actions.setTaskDraft(task.teamId, target, { ...initial,
    fields: { ...initial.fields, description: input.description }, updateRetry: { input } })
  const manage = vi.fn<(command: TeamManagementCommand) => Promise<void>>()
  const lookup = vi.fn<NonNullable<import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async selection => ({ kind: 'rejected', rejection: { ...selection,
      expectedRevision: task.revision, observedRevision: task.revision, rejectedAt: 20, reason } }))
  function Harness() {
    const snapshot = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    return <TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
      inspection={workspaceTaskDetail(task)} translate={t} manage={manage} lookupTaskUpdate={lookup}
      draft={snapshot.byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]}
      onDraftChange={(draft) => { store.actions.setTaskDraft(task.teamId, target, draft) }} onClose={() => {}} />
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: 'Query original update' }))
  await view.findByText(en[`taskForm.rejected.${reason}`])
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe(input.description)
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.updateRetry).toBeUndefined()
  expect(store.getSnapshot().byTeam[task.teamId]?.taskDrafts[taskDraftKey(target)]?.previousUpdateInput).toEqual(input)
  expect(manage).not.toHaveBeenCalled()
})

it.each(['applied', 'rejected'] as const)('retains uncertain input when the %s lookup reports a different original revision', async (kind) => {
  const task = workspaceTask('original')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const initial = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'original-command' as never, expectedRevision: 1,
    subject: task.subject, description: 'Retained edit', blockedBy: [] }
  const draft = { ...initial, fields: { ...initial.fields, description: input.description }, updateRetry: { input } }
  const lookup = vi.fn<NonNullable<import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async value => kind === 'applied'
      ? { kind: 'applied', receipt: { ...value, expectedRevision: 2, appliedRevision: 3, appliedAt: 20 } }
      : { kind: 'rejected', rejection: { ...value, expectedRevision: 2, observedRevision: 3, rejectedAt: 20, reason: 'stale-revision' } })
  const publish = vi.fn()
  const close = vi.fn()
  const view = render(<TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
    inspection={workspaceTaskDetail(task)} translate={t} manage={async () => {}} lookupTaskUpdate={lookup}
    draft={draft} onDraftChange={publish} onClose={close} />)
  fireEvent.click(view.getByRole('button', { name: 'Query original update' }))
  await view.findByText('The original result does not match the retained request. Input is preserved; query again.')
  expect(publish).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect((view.getByLabelText('Instructions') as HTMLTextAreaElement).value).toBe('Retained edit')
})

it.each(['applied', 'rejected'] as const)('queries a retained update in a deleted task and read-only Team without submitting (%s)', async (kind) => {
  const original = workspaceTask('retained-task')
  const deleted = workspaceTask(original.id, { phase: 'deleted', revision: 3 })
  const target = { kind: 'taskUpdate', taskId: original.id } as const
  const initial = createTaskFormDraft(target, workspaceTaskDetail(original).record.value!.task, '')
  const input = { taskId: original.id, commandId: 'pending-original' as never, expectedRevision: 1,
    subject: original.subject, description: 'Original submitted input', blockedBy: [] }
  const store = createTeamWorkspaceStore().create()
  store.actions.setTaskDraft(original.teamId, target, { ...initial, fields: { ...initial.fields, description: input.description },
    updateRetry: { input } })
  const lookup = vi.fn<NonNullable<import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async value => kind === 'applied'
      ? { kind: 'applied', receipt: { ...value, expectedRevision: 1, appliedRevision: 2, appliedAt: 20 } }
      : { kind: 'rejected', rejection: { ...value, expectedRevision: 1, observedRevision: 3, rejectedAt: 20, reason: 'stale-revision' } })
  const manage = vi.fn(async () => {})
  const close = vi.fn()
  function Harness() {
    const snapshot = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    return <TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
      inspection={workspaceTaskDetail(deleted)} translate={t} manage={manage} canSubmit={false} lookupTaskUpdate={lookup}
      draft={snapshot.byTeam[original.teamId]?.taskDrafts[taskDraftKey(target)]}
      onDraftChange={(value) => { store.actions.setTaskDraft(original.teamId, target, value) }}
      onDraftDiscard={() => { store.actions.discardTaskDraft(original.teamId, target) }} onClose={close} />
  }
  const view = render(<Harness />)
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: 'Retry original update' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText('Edits are unavailable for this Team. Input is preserved; the original update can still be queried.')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Query original update' }))
  await waitFor(() => { expect(lookup).toHaveBeenCalledTimes(1) })
  expect(manage).not.toHaveBeenCalled()
  if (kind === 'applied') await waitFor(() => { expect(close).toHaveBeenCalledTimes(1) })
  else {
    await view.findByText('The original update was rejected for a stale revision. Input is preserved; review the current revision before resubmitting.')
    expect(store.getSnapshot().byTeam[original.teamId]?.taskDrafts[taskDraftKey(target)]?.previousUpdateInput).toEqual(input)
    expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  }
})

it('keeps the original lookup available when the deployment exposes no management callback', async () => {
  const task = workspaceTask('query-only')
  const target = { kind: 'taskUpdate', taskId: task.id } as const
  const initial = createTaskFormDraft(target, workspaceTaskDetail(task).record.value!.task, '')
  const input = { taskId: task.id, commandId: 'pending-original' as never, expectedRevision: 1,
    subject: task.subject, description: task.description, blockedBy: [] }
  const lookup = vi.fn<NonNullable<import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']>>()
    .mockImplementation(async value => ({ kind: 'not-found', ...value }))
  const view = render(<TeamTaskDialog target={target} state={{ team: workspaceState().team, tasks: [], participants: [] }}
    inspection={workspaceTaskDetail(task)} translate={t} lookupTaskUpdate={lookup} onClose={() => {}}
    draft={{ ...initial, updateRetry: { input } }} />)
  fireEvent.click(view.getByRole('button', { name: 'Query original update' }))
  await view.findByText('No original receipt was found at this read. The update may still commit; retry the same original request.')
  expect((view.getByRole('button', { name: 'Edit task' }) as HTMLButtonElement).disabled).toBe(true)
  expect((view.getByRole('button', { name: 'Retry original update' }) as HTMLButtonElement).disabled).toBe(true)
})
