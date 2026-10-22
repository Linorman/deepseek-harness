// @vitest-environment jsdom
/** Channel browsing keeps list, message, and management requests tied to the selected channel. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ChannelId, ChannelReadPageResult, TeamChannelAdmission, TeamChannelCatalogState, TeamChannelSummary } from '@clocky/clocky-client-runtime/client'
import { ChannelHub } from '../src/client/ChannelHub.tsx'
import { DEFAULT_TEAM_VIEW } from '../src/client/workspace-store.ts'
import { en } from '../src/client/locales.ts'
import { workspaceSelection, workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)

const state = { team: workspaceSelection(workspaceState()).team, participants: [], tasks: [] }
const channelId = 'selected-channel' as ChannelId
const channel = { manifest: { id: channelId, teamId: state.team.id, adapter: { type: 'direct', version: 4 },
  participants: [{ id: 'participant-one' as never, role: 'human' }], limits: {} }, phase: 'active' as const, cursor: 3 }

it('focuses the exact admitted Envelope without acknowledging or posting and retires the marker on explicit page navigation', () => {
  const scrollIntoView = vi.fn(), updateView = vi.fn(), acknowledgeChannel = vi.fn(async () => {})
  const readChannel = vi.fn(async () => ({ channel, records: [] }))
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
  try {
    const page: ChannelReadPageResult = { channel, records: [{ type: 'channel/envelope', envelope: {
      id: 'target-envelope' as never, teamId: state.team.id, channelId, sequence: 7, senderId: 'participant-one' as never,
      audience: null, kind: 'message', payload: { text: 'Exact original message' }, delivery: 'context', priority: 'normal', createdAt: 1,
    }, deliveryIntents: [] }] }
    const view = render(<ChannelHub state={state} translate={makeTranslate(en)} updateView={updateView}
      viewState={{ ...DEFAULT_TEAM_VIEW, channelEnvelope: 'target-envelope', channelEnvelopeSequence: 7 }}
      acknowledgeChannel={acknowledgeChannel} readChannel={readChannel}
      channelState={{ channelId, page, startCursor: 6, loading: false, acknowledging: false, hasNewer: false }} />)
    const envelope = view.container.querySelector('[data-channel-message="target-envelope"]')
    expect(document.activeElement).toBe(envelope)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(acknowledgeChannel).not.toHaveBeenCalled(); expect(readChannel).not.toHaveBeenCalled()
    fireEvent.click(within(view.getByLabelText(en['detail.readChannel'])).getByRole('button', { name: en['detail.firstPage'] }))
    expect(updateView).toHaveBeenCalledWith({ channelEnvelope: undefined, channelEnvelopeSequence: undefined })
  } finally {
    if (original === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    else Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
  }
})

it('filters loaded channels, pages and refreshes the list, then opens and refreshes the selected conversation', async () => {
  const readChannels = vi.fn(async () => {})
  const readChannel = vi.fn(async () => ({ channel, records: [], nextCursor: 7 }))
  const readChannelCatalog = vi.fn(async () => {})
  const updateView = vi.fn()
  const props = { state, translate: makeTranslate(en), viewState: DEFAULT_TEAM_VIEW, updateView,
    readChannels, readChannel, readChannelCatalog,
    channelListState: { teamId: state.team.id, items: [channel], startCursor: 1, nextCursor: 4,
      loading: false, loadingMore: false, hasNewer: true },
    channelState: { channelId, page: { channel, records: [], nextCursor: 7 }, startCursor: 1,
      loading: false, acknowledging: false, hasNewer: true } }
  const view = render(<ChannelHub {...props} />)
  await waitFor(() => { expect(readChannels).toHaveBeenCalledWith(state.team.id) })
  expect(readChannelCatalog).toHaveBeenCalledOnce()
  fireEvent.change(view.getByRole('textbox', { name: en['channelHub.search'] }), { target: { value: 'missing' } })
  expect(updateView).toHaveBeenCalledWith({ channelSearch: 'missing' })
  view.rerender(<ChannelHub {...props} viewState={{ ...DEFAULT_TEAM_VIEW, channelSearch: 'missing' }} />)
  expect(view.queryByRole('button', { name: 'Channel 1' })).toBeNull()
  view.rerender(<ChannelHub {...props} />)
  fireEvent.click(view.getByRole('button', { name: 'Channel 1' }))
  expect(readChannel).toHaveBeenLastCalledWith(channelId, -1, expect.any(AbortSignal))
  const list = within(view.getByRole('complementary', { name: en['channelHub.list'] }))
  fireEvent.click(list.getByRole('button', { name: en['detail.firstPage'] }))
  fireEvent.click(list.getByRole('button', { name: en['channel.loadMoreChannels'] }))
  fireEvent.click(list.getByRole('button', { name: en['channel.refreshList'] }))
  expect(readChannels.mock.calls).toEqual(expect.arrayContaining([
    [state.team.id, 'first'], [state.team.id, 'next'], [state.team.id],
  ]))
  fireEvent.click(view.getByRole('button', { name: en['channelHub.back'] }))
  expect(view.container.querySelector('[data-channel-hub]')?.getAttribute('data-mobile-list')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: en['detail.loadMore'] }))
  expect(readChannel).toHaveBeenLastCalledWith(channelId, 7, expect.any(AbortSignal))
  fireEvent.click(within(view.getByLabelText(en['detail.readChannel'])).getByRole('button', { name: en['detail.firstPage'] }))
  expect(readChannel).toHaveBeenLastCalledWith(channelId, -1, expect.any(AbortSignal))
  fireEvent.click(view.getByRole('button', { name: en['channel.newer'] }))
  expect(readChannel).toHaveBeenCalledTimes(4)
})

it('opens channel details and reports a failed catalogue refresh without closing the conversation', async () => {
  const readChannelCatalog = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Catalog offline'))
  const readChannel = vi.fn(async () => ({ channel, records: [] }))
  const view = render(<ChannelHub state={state} translate={makeTranslate(en)} viewState={DEFAULT_TEAM_VIEW}
    updateView={vi.fn()} readChannel={readChannel} readChannelCatalog={readChannelCatalog}
    channelState={{ channelId, page: { channel, records: [] }, loading: false, acknowledging: false, hasNewer: false }} />)
  fireEvent.click(view.getByRole('button', { name: en['channelHub.details'] }))
  // The host controls the durable disclosure preference.
  view.rerender(<ChannelHub state={state} translate={makeTranslate(en)} viewState={{ ...DEFAULT_TEAM_VIEW, channelDetails: true }}
    updateView={vi.fn()} readChannel={readChannel} readChannelCatalog={readChannelCatalog}
    channelState={{ channelId, page: { channel, records: [] }, loading: false, acknowledging: false, hasNewer: false }} />)
  const details = within(view.getByRole('complementary', { name: en['channelHub.details'] }))
  fireEvent.click(details.getByText(en['channelHub.diagnostics']))
  fireEvent.click(details.getByRole('button', { name: en['channel.refreshCatalog'] }))
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('Catalog offline') })
  fireEvent.click(details.getByRole('button', { name: en['channelHub.closeDetails'] }))
  expect(view.getByRole('heading', { name: en['workspace.channels'] })).toBeTruthy()
})

it('opens channel management and a summary only for a displayed message with an allowed view policy', () => {
  const senderId = 'message-author' as never
  const activeChannel = { ...channel, manifest: { ...channel.manifest,
    participants: [{ id: senderId, role: 'human' }], viewPolicy: { type: 'summarized-window', version: 1 } } }
  const page: ChannelReadPageResult = { channel: activeChannel, records: [{ type: 'channel/envelope',
    envelope: { id: 'message-one' as never, teamId: state.team.id, channelId, sequence: 1, senderId,
      audience: null, kind: 'message', payload: { content: [{ type: 'text', text: 'Source message' }] },
      delivery: 'context', priority: 'normal', createdAt: 1 }, deliveryIntents: [] }] }
  const channelCatalog: TeamChannelCatalogState = { loading: false, value: {
    adapters: [{ type: 'direct', version: 4 }], viewPolicies: [{ type: 'summarized-window', version: 1 }],
    summary: { allowedPolicies: ['summarized-window'], maxSourceEnvelopes: 10, maxSourceBytes: 65536,
      maxSummaryBytes: 4096, maxHistorySpan: 20 },
  } }
  const manage = vi.fn(async () => {})
  const onDraftChange = vi.fn()
  const onDraftDiscard = vi.fn()
  const props = { state, translate: makeTranslate(en), viewState: DEFAULT_TEAM_VIEW, updateView: vi.fn(),
    channelState: { channelId, page, loading: false, acknowledging: false, hasNewer: false }, channelCatalog, manage,
    onDraftChange, onDraftDiscard }
  const view = render(<ChannelHub {...props} />)
  const messages = view.getByLabelText(en['detail.readChannel'])
  fireEvent.scroll(messages)
  fireEvent.change(view.getByPlaceholderText(en['channelHub.placeholder']), { target: { value: 'Drafted message' } })
  expect(onDraftChange).toHaveBeenCalledWith(channelId, expect.objectContaining({ content: [expect.objectContaining({ content: { type: 'text', text: 'Drafted message' } })] }))
  fireEvent.click(view.getByRole('button', { name: en['channel.discardDraft'] }))
  fireEvent.click(within(view.getByRole('dialog', { name: en['channel.discardDraft'] })).getByRole('button', { name: en['channel.discardDraft'] }))
  expect(onDraftDiscard).toHaveBeenCalledWith(channelId)
  const actions = view.getByRole('button', { name: en['channelHub.actions'] })
  fireEvent.click(actions)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(view.queryByRole('menuitem', { name: en['channel.summarize'] })).toBeNull()
  fireEvent.click(actions)
  fireEvent.click(view.getByRole('menuitem', { name: en['detail.refresh'] }))
  fireEvent.click(actions)
  fireEvent.click(view.getByRole('menuitem', { name: en['channel.summarize'] }))
  expect(view.getByRole('dialog', { name: en['channel.summarize'] })).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en.cancel })[1]!)
  expect(view.queryByRole('dialog', { name: en['channel.summarize'] })).toBeNull()
  fireEvent.click(actions)
  fireEvent.click(view.getByRole('menuitem', { name: en['manage.channelClose'] }))
  expect(view.getByRole('dialog', { name: en['manage.channelClose'] })).toBeTruthy()
  fireEvent.click(within(view.getByRole('dialog')).getAllByRole('button', { name: en.cancel })[1]!)
  fireEvent.click(view.getByRole('button', { name: en['manage.channelOpen'] }))
  expect(view.getByRole('dialog', { name: en['manage.channelOpen'] })).toBeTruthy()
  expect(manage).not.toHaveBeenCalled()
})

it('reports an initial selected-channel read failure and preserves the channel selection', async () => {
  const readChannel = vi.fn(async () => ({ channel, records: [] })).mockRejectedValue(new Error('Channel history offline'))
  const view = render(<ChannelHub state={state} translate={makeTranslate(en)} viewState={DEFAULT_TEAM_VIEW}
    updateView={vi.fn()} readChannel={readChannel}
    channelState={{ channelId, loading: false, acknowledging: false, hasNewer: false }} />)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('Channel history offline') })
  expect(readChannel).toHaveBeenCalledWith(channelId, -1, expect.any(AbortSignal))
  expect(view.getByRole('button', { name: en['channelHub.actions'] })).toBeTruthy()
})

it('aborts an initial channel read when the conversation unmounts', async () => {
  let signal: AbortSignal | undefined
  const readChannel = vi.fn(async (_id: ChannelId, _cursor = -1, current?: AbortSignal) => {
    signal = current
    return await new Promise<ChannelReadPageResult>((_resolve, reject) => {
      current?.addEventListener('abort', () => { reject(new DOMException('Selection closed', 'AbortError')) }, { once: true })
    })
  })
  const view = render(<ChannelHub state={state} translate={makeTranslate(en)} viewState={DEFAULT_TEAM_VIEW}
    updateView={vi.fn()} readChannel={readChannel}
    channelState={{ channelId, loading: false, acknowledging: false, hasNewer: false }} />)
  expect(readChannel).toHaveBeenCalledWith(channelId, -1, expect.any(AbortSignal))
  view.unmount()
  await act(async () => { await Promise.resolve() })
  expect(signal?.aborted).toBe(true)
})

it('deduplicates the saved summary against the matching loaded record', () => {
  const summary: TeamChannelSummary = { type: 'channel/summary', sequence: 2, createdAt: 2,
    coveredSequenceRange: { from: 1, to: 1 }, sourceEnvelopeIds: ['message-one' as never],
    sourceFingerprint: `sha256:${'a'.repeat(64)}` as never, text: 'Saved source summary',
    policy: { type: 'summarized-window', version: 1 }, idempotencyKey: 'summary-once' as never }
  const view = render(<ChannelHub state={state} translate={makeTranslate(en)} viewState={DEFAULT_TEAM_VIEW}
    updateView={vi.fn()} channelState={{ channelId, page: { channel, records: [summary] },
      lastSummary: summary, loading: false, acknowledging: false, hasNewer: false }} />)
  expect(view.getAllByRole('region', { name: en['channel.savedSummary'] })).toHaveLength(1)
  expect(view.getByText('Saved source summary')).toBeTruthy()
})

it('shows admission, protocol progress and loaded raw records only after details are opened', () => {
  const participantId = channel.manifest.participants[0]!.id
  const detailedChannel = { ...channel, manifest: { ...channel.manifest,
    viewPolicy: { type: 'recent-window', version: 1 } } }
  const admission: TeamChannelAdmission = { channel: detailedChannel, expectedNext: { kind: 'participant', participantId },
    protocolStatus: { kind: 'discussion', turnCount: 1, maxTurns: 3, speakerPolicy: 'free-form' },
    invitations: [{ participantId, role: 'human', visibility: 'channel', required: false, deadline: 1700000000000,
      endpoint: { kind: 'human' }, revision: 1, manifestFingerprint: `sha256:${'b'.repeat(64)}` as never,
      acknowledgementKey: 'admitted' as never, status: 'acknowledged', settledAt: 1 }] }
  const view = render(<ChannelHub state={state} translate={makeTranslate(en)}
    viewState={{ ...DEFAULT_TEAM_VIEW, channelDetails: true }} updateView={vi.fn()}
    channelCatalog={{ loading: false, error: 'Catalog metadata unavailable' }}
    channelState={{ channelId, page: { channel: detailedChannel, view: { policy: 'recent-window' },
      records: [{ type: 'channel/closed', sequence: 3, createdAt: 3, phase: 'closed' }] },
    admission, loading: false, acknowledging: false, hasNewer: false }} />)
  const details = within(view.getByRole('complementary', { name: en['channelHub.details'] }))
  expect(details.getByRole('region', { name: en['channel.endpointStatus'] })).toBeTruthy()
  expect(details.getByText(/1 messages accepted; limit 3/)).toBeTruthy()
  expect(details.getByText(/Optional consent/)).toBeTruthy()
  expect(details.getByText('recent-window v1')).toBeTruthy()
  fireEvent.click(details.getByText(en['channelHub.diagnostics']))
  expect(details.getByRole('alert').textContent).toBe('Catalog metadata unavailable')
  fireEvent.click(details.getByText(en['channel.pageView']))
  expect(details.getByText(/"policy": "recent-window"/)).toBeTruthy()
  fireEvent.click(details.getByText(en['channel.rawRecords']))
  expect(details.getByText('channel/closed')).toBeTruthy()
})

it('shows the consultation review restriction and another speaker before accepting a new message', () => {
  const senderId = 'consult-initiator' as never
  const respondentId = 'consult-respondent' as never
  const consultChannel: ChannelReadPageResult['channel'] = { manifest: { id: channelId, teamId: state.team.id,
    adapter: { type: 'consult', version: 1 }, participants: [{ id: senderId, role: 'initiator' },
      { id: respondentId, role: 'respondent' }], limits: {} }, phase: 'active', cursor: 2 }
  const admission: TeamChannelAdmission = { channel: consultChannel, invitations: [],
    expectedNext: { kind: 'participant', participantId: respondentId },
    protocolStatus: { kind: 'consult', phase: 'response', request: {
      teamId: state.team.id, channelId, envelopeId: 'review-request' as never, envelopeSequence: 1,
      taskId: 'review-task' as never, review: true,
    } } }
  const props = { state, translate: makeTranslate(en), viewState: DEFAULT_TEAM_VIEW,
    updateView: vi.fn(), manage: vi.fn(async () => {}),
    channelState: { channelId, page: { channel: consultChannel, records: [] }, admission,
      invitation: { channel: consultChannel, invitation: { participantId: senderId, role: 'initiator',
        visibility: 'channel' as const, required: true, deadline: 1700000000000, endpoint: { kind: 'human' as const },
        revision: 1, manifestFingerprint: `sha256:${'c'.repeat(64)}` as never,
        acknowledgementKey: 'consult-admitted' as never, status: 'acknowledged' as const, settledAt: 1 } },
      loading: false, acknowledging: false, hasNewer: false } }
  const view = render(<ChannelHub {...props} />)
  expect(view.getByText(en['channel.waitForSpeaker'])).toBeTruthy()
  expect(view.getByText(en['channel.reviewSeparate'])).toBeTruthy()
  expect(view.getByRole('button', { name: en['manage.channelPost'] }).hasAttribute('disabled')).toBe(true)
  view.rerender(<ChannelHub {...props} viewState={{ ...DEFAULT_TEAM_VIEW, channelDetails: true }}
    channelState={{ ...props.channelState,
      invitation: { channel: consultChannel, invitation: { ...props.channelState.invitation.invitation,
        participantId: respondentId, role: 'respondent' } } }} />)
  expect(view.getByText(en['channel.reviewSeparate'])).toBeTruthy()
  expect(view.getByText(en['channel.consultPhase.response'])).toBeTruthy()
  view.rerender(<ChannelHub {...props} viewState={{ ...DEFAULT_TEAM_VIEW, channelDetails: true }}
    channelState={{ ...props.channelState, admission: { ...admission,
      protocolStatus: { kind: 'consult', phase: 'complete' } },
    invitation: { channel: consultChannel, invitation: { ...props.channelState.invitation.invitation,
      participantId: respondentId, role: 'respondent' } } }} />)
  expect(view.getByText(en['channel.consultPhase.complete'])).toBeTruthy()
})

it('shows a string list read failure alongside the retained list error', async () => {
  const readChannels = vi.fn(async () => {}).mockRejectedValue('Connection reset')
  const view = render(<ChannelHub state={state} translate={makeTranslate(en)} viewState={DEFAULT_TEAM_VIEW}
    updateView={vi.fn()} readChannels={readChannels}
    channelListState={{ teamId: state.team.id, items: [], loading: false, loadingMore: false,
      hasNewer: false, error: 'Cached list unavailable' }} />)
  await waitFor(() => { expect(view.getAllByRole('alert').map(item => item.textContent)).toContain('Connection reset') })
  expect(view.getAllByRole('alert').map(item => item.textContent)).toContain('Cached list unavailable')
})

it('retains disconnect and acknowledgement failure notices beside the conversation', () => {
  const view = render(<ChannelHub state={state} translate={makeTranslate(en)} viewState={DEFAULT_TEAM_VIEW}
    updateView={vi.fn()} channelState={{ channelId, page: { channel, records: [] }, loading: false,
      acknowledging: false, hasNewer: false, disconnected: true,
      acknowledgementError: 'Cannot acknowledge now' }} />)
  expect(view.getByText(en['channel.disconnected'])).toBeTruthy()
  expect(view.getByRole('alert').textContent).toBe('Cannot acknowledge now')
  expect(view.getByRole('button', { name: en['channelHub.actions'] })).toBeTruthy()
})
