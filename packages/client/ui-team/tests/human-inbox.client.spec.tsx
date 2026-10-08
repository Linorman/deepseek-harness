// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import { projectTeamProductSummary } from '@clocky/clocky-team/selection'
import type { TeamActionResponseInput, TeamActionResponseResult, TeamInboxPage, TeamInboxState } from '@clocky/clocky-client-runtime/client'
import { HumanActionCard } from '../src/client/HumanActionCard.tsx'
import { TeamInboxDialog, type TeamInboxControls } from '../src/client/TeamInboxDialog.tsx'
import { en } from '../src/client/locales.ts'
import { workspaceState } from './workspace-fixtures.client.ts'

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
  fireEvent.click(view.getByLabelText('Tests'))
  const testsChoice = view.getByLabelText('Tests')
  if (!(testsChoice instanceof HTMLInputElement)) throw new Error('Question option is not a checkbox')
  expect(testsChoice.checked).toBe(false)
  fireEvent.click(testsChoice)
  fireEvent.change(view.getByLabelText('Other answer'), { target: { value: '  Include screenshots.  ' } })
  fireEvent.click(view.getByRole('button', { name: 'Submit answers' }))
  await view.findByText('Answer accepted. Check the task records for subsequent execution.')
  expect(respond.mock.calls[0]?.[0].answer).toEqual({ kind: 'question', answers: [{ id: 'q', selected: ['Logs', 'Tests'], custom: 'Include screenshots.' }] })
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

it('triages entries from the keyboard and leaves J/K typed into an answer field alone', async () => {
  const request = action('question')
  const message = (sequence: number, teamId: string): TeamInboxPage['items'][number] => ({ kind: 'message', sequence,
    teamId: teamId as Action['teamId'], principalId: 'principal' as never, recipientId: 'human' as never, channelId: 'channel' as never,
    envelopeId: 'envelope' as never, envelope: {} as never, text: `note ${String(sequence)}` })
  const items = [message(0, 'team-a'), message(1, 'team-b'),
    { kind: 'action', sequence: 2, teamId: request.teamId, principalId: 'principal' as never, recipientId: 'human' as never,
      action: request, text: 'question' } as TeamInboxPage['items'][number]]
  const openTeam = vi.fn(async () => {})
  const onClose = vi.fn()
  const view = render(<TeamInboxDialog state={inboxState(items)} teams={[]} translate={makeTranslate(en)}
    onClose={onClose} openTeam={openTeam} {...controls(request)} />)
  const entries = view.baseElement.querySelectorAll<HTMLElement>('[data-inbox-entry]')
  expect(entries).toHaveLength(3)
  const list = view.baseElement.querySelector<HTMLElement>('[aria-keyshortcuts="J K Enter"]')
  if (list === null) throw new Error('Inbox triage list is missing')
  fireEvent.keyDown(list, { key: 'j' })
  expect(document.activeElement).toBe(entries[0])
  fireEvent.keyDown(view.getByText('note 0'), { key: 'j' })
  expect(document.activeElement).toBe(entries[1])
  fireEvent.keyDown(entries[1]!, { key: 'j' })
  fireEvent.keyDown(entries[2]!, { key: 'j' })
  expect(document.activeElement).toBe(entries[2])
  fireEvent.keyDown(entries[2]!, { key: 'k' })
  fireEvent.keyDown(entries[1]!, { key: 'k' })
  expect(document.activeElement).toBe(entries[0])
  fireEvent.keyDown(entries[0]!, { key: 'j', isComposing: true })
  expect(document.activeElement).toBe(entries[0])
  fireEvent.keyDown(entries[0]!, { key: 'Enter' })
  await waitFor(() => { expect(openTeam).toHaveBeenCalledWith('team-a') })

  fireEvent.click(view.getByRole('button', { name: 'Check current request' }))
  const answer = await view.findByLabelText('Other answer')
  answer.focus()
  fireEvent.keyDown(answer, { key: 'k' })
  expect(document.activeElement).toBe(answer)
})

it('reports a failed watch while keeping explicit refresh, history and loaded acknowledgement available', async () => {
  const request = action()
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Approval' }
  const owners = controls(request)
  const watchInbox = vi.fn<TeamInboxControls['watchInbox']>().mockRejectedValueOnce('Watch interrupted')
  const view = render(<TeamInboxDialog {...owners} watchInbox={watchInbox} state={inboxState([item])}
    teams={[]} translate={makeTranslate(en)} onClose={vi.fn()} openTeam={async () => {}} />)
  await view.findByText('Watch interrupted')
  expect(watchInbox).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: en['inbox.refresh'] }))
  fireEvent.click(view.getByRole('button', { name: en['inbox.history'] }))
  expect(owners.refreshInbox).toHaveBeenNthCalledWith(1, false, expect.any(AbortSignal))
  expect(owners.refreshInbox).toHaveBeenNthCalledWith(2, false, expect.any(AbortSignal))
  expect(owners.refreshInbox).toHaveBeenNthCalledWith(3, true, expect.any(AbortSignal))
  fireEvent.click(view.getByRole('button', { name: en['inbox.markLoaded'] }))
  expect(owners.acknowledgeInbox).toHaveBeenCalledWith(expect.any(AbortSignal))
})

it('shows a named watch failure without replacing the retained inbox rows', async () => {
  const request = action()
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Approval' }
  const watchInbox = vi.fn<TeamInboxControls['watchInbox']>().mockRejectedValueOnce(new Error('Watch offline'))
  const view = render(<TeamInboxDialog {...controls(request)} watchInbox={watchInbox} state={inboxState([item])}
    teams={[]} translate={makeTranslate(en)} onClose={vi.fn()} openTeam={async () => {}} />)
  await view.findByText('Watch offline')
  expect(view.getByRole('article', { name: en['detail.approval'] })).toBeTruthy()
  expect(view.getByRole('button', { name: en['inbox.openTeam'] })).toBeTruthy()
})

it.each(['items', 'continuation'] as const)('stops a successful inbox watch when it announces %s', async (kind) => {
  const request = action()
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Approval' }
  const watchInbox = vi.fn<TeamInboxControls['watchInbox']>(async () => ({
    items: kind === 'items' ? [item] : [], displayCursor: -1, cursor: 0,
    nextCursor: kind === 'continuation' ? 0 : undefined,
  }))
  const view = render(<TeamInboxDialog {...controls(request)} watchInbox={watchInbox} state={inboxState([])}
    teams={[]} translate={makeTranslate(en)} onClose={vi.fn()} openTeam={async () => {}} />)
  await waitFor(() => { expect(watchInbox).toHaveBeenCalledOnce() })
  await act(async () => { await Promise.resolve() })
  expect(watchInbox).toHaveBeenCalledOnce()
  expect(view.queryByRole('alert')).toBeNull()
})

it('continues a watch after an empty poll and stops when a real item is announced', async () => {
  const request = action()
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Approval' }
  const watchInbox = vi.fn<TeamInboxControls['watchInbox']>()
    .mockResolvedValueOnce({ items: [], displayCursor: -1, cursor: -1 })
    .mockResolvedValueOnce({ items: [item], displayCursor: -1, cursor: 0 })
  const view = render(<TeamInboxDialog {...controls(request)} watchInbox={watchInbox} state={inboxState([])}
    teams={[]} translate={makeTranslate(en)} onClose={vi.fn()} openTeam={async () => {}} />)
  await waitFor(() => { expect(watchInbox).toHaveBeenCalledTimes(2) })
  expect(view.queryByRole('alert')).toBeNull()
})

it('renders an empty final delivery and opens its loaded Team without borrowing action content', async () => {
  const base = workspaceState()
  const summary = projectTeamProductSummary(base.team, base.team.id, 512, {})
  const item: TeamInboxPage['items'][number] = { kind: 'final', sequence: 0,
    teamId: base.team.id, channelId: 'channel' as never, envelopeId: 'final-envelope' as never,
    envelopeSequence: 1, contentFingerprint: 'fingerprint' as never, idempotencyKey: 'final-key' as never,
    principalId: 'principal' as never, recipientId: 'human' as never, text: '' }
  const openTeam = vi.fn(async () => {}), onClose = vi.fn()
  const view = render(<TeamInboxDialog {...controls(action())} state={{ ...inboxState([item]), displayCursor: 0 }}
    teams={[summary]} translate={makeTranslate(en)} onClose={onClose} openTeam={openTeam} />)
  expect(view.getByText(en['inbox.final'])).toBeTruthy()
  expect(view.getByText(en['inbox.read'])).toBeTruthy()
  expect(view.getByText(en['inbox.nonText'])).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: base.goal.objective }))
  await waitFor(() => { expect(openTeam).toHaveBeenCalledExactlyOnceWith(base.team.id); expect(onClose).toHaveBeenCalledOnce() })
})

it('closes an idle inbox from its dialog chrome and shows explicit read progress', () => {
  const request = action()
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Approval' }
  const onClose = vi.fn()
  const base = inboxState([item])
  const view = render(<TeamInboxDialog {...controls(request)} state={{ ...base, phase: 'loading', loadingMore: true,
    acknowledging: true, nextCursor: 0 }} teams={[]} translate={makeTranslate(en)}
  onClose={onClose} openTeam={async () => {}} />)
  expect(view.getAllByText(en['inbox.loading']).length).toBeGreaterThan(1)
  expect(view.getByText(en['inbox.acknowledging'])).toBeTruthy()
  expect(view.getByRole('button', { name: en['inbox.markLoaded'] }).hasAttribute('disabled')).toBe(true)
  fireEvent(view.getByRole('dialog', { name: en['inbox.title'] }), new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledOnce()
})

it('closes discard confirmation from its dialog chrome while retaining the typed answer', async () => {
  const request = action('question')
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Question' }
  const onClose = vi.fn()
  const view = render(<TeamInboxDialog {...controls(request)} state={inboxState([item])} teams={[]}
    translate={makeTranslate(en)} onClose={onClose} openTeam={async () => {}} />)
  fireEvent.click(view.getByRole('button', { name: en['human.confirmCurrent'] }))
  await view.findByRole('button', { name: en['human.submitAnswer'] })
  fireEvent.change(view.getByLabelText(en['human.customAnswer']), { target: { value: 'Keep this answer' } })
  fireEvent.click(view.getByRole('button', { name: en['inbox.close'] }))
  const discard = view.getByRole('dialog', { name: en['inbox.discardTitle'] })
  fireEvent(discard, new Event('cancel', { cancelable: true }))
  expect(view.queryByRole('dialog', { name: en['inbox.discardTitle'] })).toBeNull()
  const answer = view.getByLabelText(en['human.customAnswer'])
  if (!(answer instanceof HTMLTextAreaElement)) throw new Error('Question answer is not editable')
  expect(answer.value).toBe('Keep this answer')
  expect(onClose).not.toHaveBeenCalled()
})

it('withholds Team opening while one inbox answer is pending and resumes it after cancellation', async () => {
  const request = action('question')
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Question' }
  const pending = Promise.withResolvers<TeamActionResponseResult>()
  const owners = { ...controls(request), respondAction: vi.fn(() => pending.promise) }
  const openTeam = vi.fn(async () => {}), onClose = vi.fn()
  const view = render(<TeamInboxDialog {...owners} state={inboxState([item])} teams={[]}
    translate={makeTranslate(en)} onClose={onClose} openTeam={openTeam} />)
  fireEvent.click(view.getByRole('button', { name: en['human.confirmCurrent'] }))
  await view.findByRole('button', { name: en['human.submitAnswer'] })
  fireEvent.click(view.getByLabelText('Tests'))
  fireEvent.click(view.getByRole('button', { name: en['human.submitAnswer'] }))
  expect(owners.respondAction).toHaveBeenCalledOnce()
  fireEvent.click(view.getByRole('button', { name: en['inbox.openTeam'] }))
  expect(openTeam).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  await act(async () => { pending.resolve({ kind: 'unavailable', action: { ...request, phase: 'cancelled' } }); await pending.promise })
  fireEvent.click(view.getByRole('button', { name: en['inbox.openTeam'] }))
  expect(openTeam).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['inbox.discard'] }))
  await waitFor(() => { expect(openTeam).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce() })
})

it('retires a pending inbox watch before its late failure settles', async () => {
  const request = action()
  let signal: AbortSignal | undefined
  const pending = Promise.withResolvers<TeamInboxPage>()
  const watchInbox = vi.fn<TeamInboxControls['watchInbox']>((watchSignal) => { signal = watchSignal; return pending.promise })
  const view = render(<TeamInboxDialog {...controls(request)} watchInbox={watchInbox} state={inboxState([])}
    teams={[]} translate={makeTranslate(en)} onClose={vi.fn()} openTeam={async () => {}} />)
  await waitFor(() => { expect(watchInbox).toHaveBeenCalledOnce() })
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { pending.reject(new Error('Late watch failure')); await pending.promise.catch(() => {}) })
})

it('reports a Team-open failure without losing the entry and succeeds on explicit retry', async () => {
  const request = action()
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Approval' }
  const openTeam = vi.fn().mockRejectedValueOnce('Team unavailable')
    .mockRejectedValueOnce(new Error('Host refused Team access')).mockResolvedValueOnce(undefined)
  const onClose = vi.fn()
  const view = render(<TeamInboxDialog {...controls(request)} state={inboxState([item])} teams={[]}
    translate={makeTranslate(en)} onClose={onClose} openTeam={openTeam} />)
  fireEvent.click(view.getByRole('button', { name: en['inbox.openTeam'] }))
  await view.findByText('Team unavailable')
  expect(onClose).not.toHaveBeenCalled()
  expect(view.getByRole('button', { name: en['inbox.openTeam'] })).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: en['inbox.openTeam'] }))
  await view.findByText('Host refused Team access')
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['inbox.openTeam'] }))
  await waitFor(() => { expect(openTeam).toHaveBeenCalledTimes(3); expect(onClose).toHaveBeenCalledOnce() })
})

it.each([
  ['absent list', null],
  ['empty list', []],
  ['non-object question', [null]],
  ['missing id', [{ question: 'Choose' }]],
  ['duplicate ids', [{ id: 'q', question: 'One' }, { id: 'q', question: 'Two' }]],
  ['non-text detail', [{ id: 'q', question: 'Choose', detail: 4 }]],
  ['non-text header', [{ id: 'q', question: 'Choose', header: 4 }]],
  ['non-boolean multi-select', [{ id: 'q', question: 'Choose', multiSelect: 'yes' }]],
  ['non-array options', [{ id: 'q', question: 'Choose', options: 'Tests' }]],
  ['non-object option', [{ id: 'q', question: 'Choose', options: [null] }]],
  ['option without a text label', [{ id: 'q', question: 'Choose', options: [{ label: 4 }] }]],
  ['non-text option description', [{ id: 'q', question: 'Choose', options: [{ label: 'Tests', description: 4 }] }]],
] as const)('rejects %s from extension-owned question details', (_description, questions) => {
  const request = { ...action('question'), details: { questions } }
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} />)
  expect(view.getByText(en['human.unsupported'])).toBeTruthy()
  expect(view.queryByRole('button', { name: en['human.submitAnswer'] })).toBeNull()
  expect(respond).not.toHaveBeenCalled()
})

it('shows valid optional question detail and option descriptions without changing their answer identity', () => {
  const request = { ...action('question'), details: { questions: [{ id: 'q', question: 'Choose evidence',
    detail: 'Use the retained test report.', header: 'Evidence', multiSelect: false,
    options: [{ label: 'Tests', description: 'Passing suite' }] }] } }
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} />)
  expect(view.getByText('Use the retained test report.')).toBeTruthy()
  expect(view.getByText('Passing suite')).toBeTruthy()
  const choice = view.getByRole('radio', { name: /Tests/ })
  if (!(choice instanceof HTMLInputElement)) throw new Error('Question choice is not a radio input')
  fireEvent.click(choice)
  expect(choice.checked).toBe(true)
})

it('projects an accepted question answer and releases its matching retained retry draft', () => {
  const request = action('question')
  const responseInput: TeamActionResponseInput = { teamId: request.teamId, actionId: request.id,
    expectedUpdatedAt: request.updatedAt, idempotencyKey: 'question-retry' as never,
    answer: { kind: 'question', answers: [{ id: 'q', selected: ['Tests'] }] } }
  const settled = accepted(request, responseInput).action
  const onAccepted = vi.fn()
  const view = render(<HumanActionCard action={settled} translate={makeTranslate(en)}
    respond={vi.fn(async () => accepted(request, responseInput))} onAccepted={onAccepted}
    draft={{ answers: {}, retry: { fingerprint: 'question-answer', key: responseInput.idempotencyKey } }} />)
  const choice = view.getByRole('checkbox', { name: 'Tests' })
  if (!(choice instanceof HTMLInputElement)) throw new Error('Accepted choice is not a checkbox')
  expect(choice.checked).toBe(true)
  expect(view.getByText(en['human.accepted'])).toBeTruthy()
  expect(onAccepted).toHaveBeenCalledOnce()
  expect(view.queryByRole('button', { name: en['human.submitAnswer'] })).toBeNull()
})

it('keeps cancelled and resolved request states distinct from an accepted answer', () => {
  const request = action()
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={{ ...request, phase: 'cancelled' }}
    translate={makeTranslate(en)} respond={respond} />)
  expect(view.getByText(en['human.cancelled'])).toBeTruthy()
  view.rerender(<HumanActionCard action={{ ...request, phase: 'resolved' }} translate={makeTranslate(en)} respond={respond} />)
  expect(view.getByText(en['human.resolved'])).toBeTruthy()
  expect(respond).not.toHaveBeenCalled()
})

it('cancels an in-flight current-request check without enabling stale answer controls', async () => {
  const request = action()
  let resolveCurrent!: (value: Action) => void
  const confirm = vi.fn<(_action: Action, _signal?: AbortSignal) => Promise<Action>>(() =>
    new Promise<Action>((resolve) => { resolveCurrent = resolve }))
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} confirm={confirm} />)
  fireEvent.click(view.getByRole('button', { name: en['human.confirmCurrent'] }))
  const signal = confirm.mock.calls[0]?.[1]
  expect(signal).toBeInstanceOf(AbortSignal)
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  expect(signal?.aborted).toBe(true)
  resolveCurrent(request)
  await act(async () => { await Promise.resolve() })
  expect(view.queryByRole('button', { name: en['human.allowOnce'] })).toBeNull()
  expect(respond).not.toHaveBeenCalled()
})

it('ignores a late answer after the user cancels an in-flight submission', async () => {
  const request = action()
  let resolveAnswer!: (value: TeamActionResponseResult) => void
  const respond = vi.fn((_input: TeamActionResponseInput, _signal?: AbortSignal) =>
    new Promise<TeamActionResponseResult>((resolve) => { resolveAnswer = resolve }))
  const onAccepted = vi.fn()
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)}
    respond={respond} onAccepted={onAccepted} />)
  fireEvent.click(view.getByRole('button', { name: en['human.allowOnce'] }))
  const signal = respond.mock.calls[0]?.[1]
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  expect(signal?.aborted).toBe(true)
  resolveAnswer(accepted(request, respond.mock.calls[0]![0]))
  await act(async () => { await Promise.resolve() })
  expect(onAccepted).not.toHaveBeenCalled()
  expect(view.queryByText(en['human.accepted'])).toBeNull()
  expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead'])
})

it('reports bounded draft-store refusal before attempting an approval', async () => {
  const request = action()
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond}
    onDraftChange={() => { throw new Error('Draft storage full') }} />)
  fireEvent.click(view.getByRole('button', { name: en['human.reject'] }))
  expect(view.getByRole('alert').textContent).toBe('Draft storage full')
  expect(respond).not.toHaveBeenCalled()
})

it('preserves a question choice when the draft store refuses it and reports a context read failure', async () => {
  const request = action('question')
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const openContext = vi.fn().mockRejectedValueOnce('Context unavailable')
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond}
    onDraftChange={() => { throw 'Draft quota reached' }} openContext={openContext} />)
  fireEvent.click(view.getByLabelText('Tests'))
  expect(view.getByRole('alert').textContent).toBe('Draft quota reached')
  const choice = view.getByLabelText('Tests')
  if (!(choice instanceof HTMLInputElement)) throw new Error('Question option is not a checkbox')
  expect(choice.checked).toBe(false)
  fireEvent.click(view.getByRole('button', { name: en['human.context'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Context unavailable') })
  expect(respond).not.toHaveBeenCalled()
})

it('keeps a cancelled current-request check from displaying a late rejection', async () => {
  const request = action()
  let rejectCurrent!: (reason: Error) => void
  const confirm = vi.fn<(_action: Action, _signal?: AbortSignal) => Promise<Action>>(() =>
    new Promise<Action>((_resolve, reject) => { rejectCurrent = reject }))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} confirm={confirm}
    respond={vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))} />)
  fireEvent.click(view.getByRole('button', { name: en['human.confirmCurrent'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  await act(async () => { rejectCurrent(new Error('Late confirmation refusal')); await Promise.resolve() })
  expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead'])
  expect(view.queryByText('Late confirmation refusal')).toBeNull()
})

it('reports a non-Error current-request check failure without enabling answer controls', async () => {
  const request = action()
  const confirm = vi.fn().mockRejectedValueOnce('Current request cannot be read')
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} confirm={confirm} />)
  fireEvent.click(view.getByRole('button', { name: en['human.confirmCurrent'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Current request cannot be read') })
  expect(view.queryByRole('button', { name: en['human.allowOnce'] })).toBeNull()
  expect(respond).not.toHaveBeenCalled()
})

it('shows a non-Error answer refusal but ignores a late refusal after cancellation', async () => {
  const request = action()
  let rejectAnswer!: (reason: unknown) => void
  const respond = vi.fn((_input: TeamActionResponseInput, _signal?: AbortSignal) =>
    new Promise<TeamActionResponseResult>((_resolve, reject) => { rejectAnswer = reject }))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond} />)
  fireEvent.click(view.getByRole('button', { name: en['human.reject'] }))
  await act(async () => { rejectAnswer('Answer rejected'); await Promise.resolve() })
  expect(view.getByRole('alert').textContent).toBe('Answer rejected')
  fireEvent.click(view.getByRole('button', { name: en['human.reject'] }))
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  await act(async () => { rejectAnswer(new Error('Late answer refusal')); await Promise.resolve() })
  expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead'])
})

it('reports non-Error draft refusal and an Error from opening original context', async () => {
  const request = action()
  const respond = vi.fn(async (input: TeamActionResponseInput) => accepted(request, input))
  const view = render(<HumanActionCard action={request} translate={makeTranslate(en)} respond={respond}
    onDraftChange={() => { throw 'Draft capacity exceeded' }}
    openContext={vi.fn(async () => { throw new Error('Original Session unavailable') })} />)
  fireEvent.click(view.getByRole('button', { name: en['human.allowOnce'] }))
  expect(view.getByRole('alert').textContent).toBe('Draft capacity exceeded')
  expect(respond).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['human.context'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Original Session unavailable') })
})

it('sends one exact principal-wide answer and opens its original Session context', async () => {
  const request = action('question')
  const item: TeamInboxPage['items'][number] = { kind: 'action', sequence: 0, teamId: request.teamId,
    principalId: 'principal' as never, recipientId: 'human' as never, action: request, text: 'Question' }
  const owners = controls(request)
  const onClose = vi.fn()
  const view = render(<TeamInboxDialog {...owners} state={inboxState([item])} teams={[]}
    translate={makeTranslate(en)} onClose={onClose} openTeam={async () => {}} />)
  fireEvent.click(view.getByRole('button', { name: en['human.confirmCurrent'] }))
  await view.findByRole('button', { name: en['human.submitAnswer'] })
  fireEvent.click(view.getByLabelText('Tests'))
  fireEvent.click(view.getByRole('button', { name: en['human.submitAnswer'] }))
  await waitFor(() => { expect(owners.respondAction).toHaveBeenCalledOnce() })
  expect(owners.respondAction).toHaveBeenCalledWith(request.teamId,
    expect.objectContaining({ actionId: request.id, expectedUpdatedAt: request.updatedAt,
      answer: { kind: 'question', answers: [{ id: 'q', selected: ['Tests'] }] } }), expect.any(AbortSignal))
  await view.findByText(en['human.accepted'])
  fireEvent.click(view.getByRole('button', { name: en['human.context'] }))
  await waitFor(() => { expect(owners.openActionContext).toHaveBeenCalledWith(request); expect(onClose).toHaveBeenCalledOnce() })
})
