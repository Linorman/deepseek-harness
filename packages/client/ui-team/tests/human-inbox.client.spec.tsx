// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamActionResponseInput, TeamActionResponseResult, TeamInboxPage, TeamInboxState } from '@clocky/clocky-client-runtime/client'
import { HumanActionCard } from '../src/client/HumanActionCard.tsx'
import { TeamInboxDialog, type TeamInboxControls } from '../src/client/TeamInboxDialog.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type Action = TeamActionResponseResult['action']
function action(kind: 'approval' | 'question' = 'approval'): Action {
  return { id: 'action' as Action['id'], teamId: 'team' as Action['teamId'], sessionId: 'session' as Action['sessionId'],
    participantId: 'worker' as Action['participantId'], sourceId: 'source' as Action['sourceId'],
    kind, phase: 'pending', createdAt: 1, updatedAt: 2,
    details: kind === 'approval' ? { toolName: 'bash', reason: 'Write the requested report.', callId: 'tool-call' }
      : { questions: [{ id: 'q', question: 'Which evidence?', multiSelect: true, options: [{ label: 'Tests' }, { label: 'Logs' }] }] },
  }
}
function accepted(request: Action, input: TeamActionResponseInput): TeamActionResponseResult {
  return { kind: 'accepted', action: { ...request, updatedAt: 3, response: {
    expectedUpdatedAt: input.expectedUpdatedAt, idempotencyKey: input.idempotencyKey,
    answer: input.answer, respondedBy: 'human' as Action['participantId'], acceptedAt: 3,
  } } }
}
function inboxState(items: TeamInboxState['items']): TeamInboxState {
  return { connectionGeneration: 0, items, phase: 'ready', displayCursor: -1, cursor: items.at(-1)?.sequence ?? -1,
    nextCursor: undefined, loadingMore: false, acknowledging: false, hasNewer: false, error: null }
}
function controls(request: Action): TeamInboxControls {
  return {
    refreshInbox: vi.fn(async () => {}), loadMoreInbox: vi.fn(async () => {}), acknowledgeInbox: vi.fn(async () => {}),
    watchInbox: vi.fn<TeamInboxControls['watchInbox']>(async signal => await new Promise<TeamInboxPage>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new DOMException('closed', 'AbortError')) }, { once: true })
    })),
    readAction: vi.fn(async () => request),
    respondAction: vi.fn<TeamInboxControls['respondAction']>(async (teamId, input) => accepted(request, { ...input, teamId })),
    openActionContext: vi.fn(async () => {}),
  }
}

it('admits one approval for the exact action revision without claiming execution completion', async () => {
  const request = action()
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} />)
  expect(view.getByText('Write the requested report.')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Allow once' }))
  await view.findByText('Answer accepted. Check the task records for subsequent execution.')
  expect(respond.mock.calls[0]?.[0]).toMatchObject({ teamId: request.teamId, actionId: request.id, expectedUpdatedAt: 2,
    answer: { kind: 'approval', outcome: 'allowed-once' } })
  expect(view.queryByRole('button', { name: 'Allow once' })).toBeNull()
})

it('keeps the same answer key after a transport failure and exposes unavailable continuation', async () => {
  const request = action()
  const respond = vi.fn<(input: TeamActionResponseInput, signal?: AbortSignal) => Promise<TeamActionResponseResult>>()
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ kind: 'unavailable', action: { ...request, phase: 'cancelled' } })
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} />)
  fireEvent.click(view.getByRole('button', { name: 'Reject' }))
  await view.findByText('offline')
  fireEvent.click(view.getByRole('button', { name: 'Reject' }))
  await view.findByText('The original request handler is unavailable. Check the Team state and its stall reason.')
  expect(respond.mock.calls[1]?.[0].idempotencyKey).toBe(respond.mock.calls[0]?.[0].idempotencyKey)
  expect(view.queryByRole('button', { name: 'Reject' })).toBeNull()
})

it('preserves multiple selections and custom text in a structured question answer', async () => {
  const request = action('question')
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} />)
  fireEvent.click(view.getByRole('button', { name: 'Submit answers' }))
  await view.findByRole('alert')
  expect(respond).not.toHaveBeenCalled()
  fireEvent.click(view.getByLabelText('Tests'))
  fireEvent.click(view.getByLabelText('Logs'))
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: '  Include screenshots.  ' } })
  fireEvent.click(view.getByRole('button', { name: 'Submit answers' }))
  await view.findByText('Answer accepted. Check the task records for subsequent execution.')
  expect(respond.mock.calls[0]?.[0].answer).toEqual({ kind: 'question', answers: [{ id: 'q', selected: ['Tests', 'Logs'], custom: 'Include screenshots.' }] })
})

it('requires a current action read before answering a historical pending revision', async () => {
  const request = action()
  const confirm = vi.fn(async () => request)
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} confirm={confirm} />)
  expect(view.queryByRole('button', { name: 'Allow once' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Allow once' })
  expect(confirm).toHaveBeenCalledWith(request, expect.any(AbortSignal))
  view.rerender(<HumanActionCard action={{ ...request, updatedAt: 4, phase: 'resolved' }} translate={makeTranslate(en)} respond={respond} confirm={confirm} />)
  expect(view.queryByRole('button', { name: 'Allow once' })).toBeNull()
  expect(view.getByText('Request answered')).toBeTruthy()
})

it('shows an unsupported details format without constructing a guessed question answer', () => {
  const request = { ...action('question'), details: { questions: [{ id: 'q', question: 'Choose', options: [{}] }] } }
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} />)
  expect(view.getByText('This request format is not supported here. Inspect its original Session.')).toBeTruthy()
  expect(view.queryByRole('button', { name: 'Submit answers' })).toBeNull()
})

it('keeps a typed answer when new requests are advertised and asks before loading them', async () => {
  const request = action('question')
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'question' }
  const owners = controls(request)
  const onClose = vi.fn()
  const openTeam = async () => {}
  const state = inboxState([item])
  const view = render(<TeamInboxDialog state={state} teams={[]} translate={makeTranslate(en)}
    onClose={onClose} openTeam={openTeam} {...owners} />)
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: 'Keep my answer while new work arrives' } })
  view.rerender(<TeamInboxDialog state={{ ...state, hasNewer: true }} teams={[]} translate={makeTranslate(en)}
    onClose={onClose} openTeam={openTeam} {...owners} />)
  expect((view.getByLabelText('Other answer') as HTMLTextAreaElement).value).toBe('Keep my answer while new work arrives')
  expect(owners.loadMoreInbox).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Load new messages' }))
  expect(owners.loadMoreInbox).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Keep editing' }))
  expect((view.getByLabelText('Other answer') as HTMLTextAreaElement).value).toBe('Keep my answer while new work arrives')
})

it('requires confirmation before replacing an inbox page with unsent answers', async () => {
  const request = action('question')
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'question' }
  const owners = controls(request)
  const view = render(<TeamInboxDialog state={{ ...inboxState([item]), nextCursor: 0 }} teams={[]} translate={makeTranslate(en)}
    onClose={vi.fn()} openTeam={async () => {}} {...owners} />)
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: 'Preserve this answer' } })
  fireEvent.click(view.getByRole('button', { name: 'Next page' }))
  expect(owners.loadMoreInbox).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Keep editing' }))
  expect((view.getByLabelText('Other answer') as HTMLTextAreaElement).value).toBe('Preserve this answer')
  fireEvent.click(view.getByRole('button', { name: 'Next page' }))
  fireEvent.click(view.getByRole('button', { name: 'Discard and continue' }))
  await waitFor(() => { expect(owners.loadMoreInbox).toHaveBeenCalledOnce() })
})

it('folds append-only action revisions and confirms before discarding a typed answer', async () => {
  const request = action('question')
  const principalId = 'principal' as TeamInboxPage['items'][number]['principalId']
  const recipientId = 'human' as TeamInboxPage['items'][number]['recipientId']
  const state = inboxState([
    { kind: 'action', sequence: 0, principalId, recipientId, teamId: request.teamId,
      action: { ...request, updatedAt: 1 }, text: 'old' },
    { kind: 'action', sequence: 1, principalId, recipientId, teamId: request.teamId, action: request, text: 'current' },
  ])
  const owners = controls(request)
  const onClose = vi.fn()
  const view = render(<TeamInboxDialog state={state} teams={[]} translate={makeTranslate(en)}
    onClose={onClose} openTeam={async () => {}} {...owners} />)
  expect(view.getAllByRole('article', { name: 'Question' })).toHaveLength(1)
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: 'Keep this draft' } })
  fireEvent.click(view.getByRole('button', { name: 'Close inbox' }))
  const confirmation = within(view.getByRole('dialog', { name: 'Discard unsent answers?' }))
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(confirmation.getByRole('button', { name: 'Keep editing' }))
  expect((view.getByLabelText('Other answer') as HTMLTextAreaElement).value).toBe('Keep this draft')
  fireEvent.click(view.getByRole('button', { name: 'Close inbox' }))
  fireEvent.click(view.getByRole('button', { name: 'Discard and continue' }))
  await waitFor(() => { expect(onClose).toHaveBeenCalledOnce() })
  view.unmount()
  await act(async () => { await Promise.resolve() })
})

it('offers explicit retained-history recovery after an inbox compaction error', async () => {
  const request = action('question')
  const recoverInbox = vi.fn(async () => {})
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Question' }
  const state = { ...inboxState([item]), phase: 'error' as const,
    error: { code: 'team-inbox-compacted' as const, message: 'Earlier history is unavailable', details: { firstCursor: 8 } } }
  const view = render(<TeamInboxDialog {...controls(request)} recoverInbox={recoverInbox} state={state} teams={[]}
    translate={makeTranslate(en)} onClose={() => {}} openTeam={async () => {}} />)
  expect(recoverInbox).not.toHaveBeenCalled()
  expect(view.getByText('Earlier inbox history is no longer retained.')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  await view.findByRole('button', { name: 'Submit answers' })
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: 'Keep my answer' } })
  fireEvent.click(view.getByRole('button', { name: 'View retained history' }))
  expect(recoverInbox).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Keep editing' }))
  expect((view.getByLabelText('Other answer') as HTMLTextAreaElement).value).toBe('Keep my answer')
  fireEvent.click(view.getByRole('button', { name: 'View retained history' }))
  fireEvent.click(view.getByRole('button', { name: 'Discard and continue' }))
  await waitFor(() => { expect(recoverInbox).toHaveBeenCalledOnce() })
})
