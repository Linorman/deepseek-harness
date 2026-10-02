// @vitest-environment jsdom
/** Request input survives dismissal while current authority controls every submission. */
import { useState, useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamActionDetailState, TeamActionInspection, TeamActionResponseInput, TeamActionResponseResult } from '@clocky/clocky-client-runtime/client'
import { TeamActionDialog } from '../src/client/TeamActionDialog.tsx'
import { createTeamWorkspaceStore } from '../src/client/workspace-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(en)
function inspection(): TeamActionInspection {
  return { teamId: 'team' as never, teamCursor: 2, handling: { kind: 'actionable' }, action: {
    id: 'request' as never, teamId: 'team' as never, kind: 'question', phase: 'pending', sourceId: 'source' as never,
    sessionId: 'session' as never, participantId: 'worker' as never, createdAt: 1, updatedAt: 2,
    details: { questions: [{ id: 'evidence', question: 'What evidence should be included?' }] },
  } }
}
function accepted(input: TeamActionResponseInput): TeamActionResponseResult {
  return { kind: 'accepted', action: { ...inspection().action, updatedAt: 3, response: {
    expectedUpdatedAt: input.expectedUpdatedAt, idempotencyKey: input.idempotencyKey, answer: input.answer,
    acceptedAt: 3, respondedBy: 'human' as never,
  } } }
}

it('retains input and the original retry key through transport failure, dismissal and reopening', async () => {
  const value = inspection()
  const store = createTeamWorkspaceStore().create()
  const respond = vi.fn<(input: TeamActionResponseInput) => Promise<TeamActionResponseResult>>()
    .mockRejectedValueOnce(new Error('Answer response lost')).mockImplementation(async input => accepted(input))
  const inspect = vi.fn(async () => value)
  function Harness() {
    const [open, setOpen] = useState(true)
    const state = useSyncExternalStore(store.subscribe.bind(store), store.getSnapshot.bind(store))
    return <><button onClick={() => { setOpen(true) }}>Reopen</button>{open && <TeamActionDialog
      teamId={value.teamId} actionId={value.action.id}
      detail={{ teamId: value.teamId, actionId: value.action.id, value, loading: false, hasNewer: false, disconnected: false }}
      draft={state.byTeam.team?.actionDrafts.request}
      changeDraft={(draft) => { store.actions.setActionDraft(value.teamId, value.action.id, draft) }}
      discardDraft={() => { store.actions.discardActionDraft(value.teamId, value.action.id) }} translate={t} inspect={inspect}
      closeDetail={() => {}} respond={respond} onClose={() => { setOpen(false) }} />}</>
  }
  const view = render(<Harness />)
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: 'Include the real browser evidence.' } })
  fireEvent.click(view.getByRole('button', { name: 'Submit answers' }))
  await view.findByText('Answer response lost')
  fireEvent.click(view.getByRole('button', { name: 'Close and keep draft' }))
  fireEvent.click(view.getByRole('button', { name: 'Reopen' }))
  expect((view.getByLabelText('Other answer') as HTMLTextAreaElement).value).toBe('Include the real browser evidence.')
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  fireEvent.click(view.getByRole('button', { name: 'Submit answers' }))
  await view.findByText('Answer accepted. Check the task records for subsequent execution.')
  expect(respond.mock.calls[1]?.[0]).toEqual(respond.mock.calls[0]?.[0])
  expect(store.getSnapshot().byTeam.team?.actionDrafts).toEqual({})
})

it('retains stale content with a precise waiting reason and refuses writes until current authority permits them', async () => {
  const value = inspection()
  let detail: TeamActionDetailState = { teamId: value.teamId, actionId: value.action.id, value,
    loading: false, hasNewer: false, disconnected: false }
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(input))
  const inspect = vi.fn(async () => value)
  const props = { teamId: value.teamId, actionId: value.action.id, changeDraft: vi.fn(), discardDraft: vi.fn(), translate: t,
    inspect, closeDetail: vi.fn(), respond, onClose: vi.fn() }
  const view = render(<TeamActionDialog {...props} detail={detail} />)
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  detail = { ...detail, hasNewer: true }
  view.rerender(<TeamActionDialog {...props} detail={detail} />)
  expect((view.getByRole('button', { name: 'Submit answers' }) as HTMLButtonElement).disabled).toBe(true)
  expect(view.getByText(en['human.changed'])).toBeTruthy()
  detail = { ...detail, hasNewer: false, value: { ...value, handling: { kind: 'waiting', reason: 'parent-inspection' } } }
  view.rerender(<TeamActionDialog {...props} detail={detail} />)
  expect(view.getByText(en['attention.wait.parent-inspection'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Submit answers' }))
  expect(respond).not.toHaveBeenCalled()
  detail = { ...detail, disconnected: true }
  view.rerender(<TeamActionDialog {...props} detail={detail} />)
  expect((view.getByRole('button', { name: 'Refresh request details' }) as HTMLButtonElement).disabled).toBe(true)
})

it('requires explicit discard confirmation and preserves existing input after capacity failure', async () => {
  const value = inspection()
  const discard = vi.fn()
  const view = render(<TeamActionDialog teamId={value.teamId} actionId={value.action.id}
    detail={{ teamId: value.teamId, actionId: value.action.id, value, loading: false, hasNewer: false, disconnected: false }}
    draft={{ answers: { evidence: { selected: [], custom: 'Retained answer' } } }}
    changeDraft={() => { throw new Error('Draft storage limit') }} discardDraft={discard} translate={t}
    inspect={async () => value} closeDetail={() => {}} respond={async input => accepted(input)} onClose={() => {}} />)
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: 'New input' } })
  await view.findByText('Draft storage limit')
  expect((view.getByLabelText('Other answer') as HTMLTextAreaElement).value).toBe('Retained answer')
  fireEvent.click(view.getByRole('button', { name: 'Discard answer draft' }))
  expect(discard).not.toHaveBeenCalled()
  const confirmation = view.getByRole('dialog', { name: 'Discard answer draft' })
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard answer draft' }))
  await waitFor(() => { expect(discard).toHaveBeenCalledOnce() })
})
