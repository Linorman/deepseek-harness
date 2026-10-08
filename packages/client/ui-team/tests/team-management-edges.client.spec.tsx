// @vitest-environment jsdom
/** Team management validates the exact selected member and channel before dispatch. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ChannelReadPageResult, TeamChannelAdmission, TeamChannelCatalogState, TeamManagementCommand } from '@clocky/clocky-client-runtime/client'
import { TeamManagementDialog } from '../src/client/TeamManagementDialog.tsx'
import type { ChannelComposerDraft } from '../src/client/channel-draft.ts'
import { en } from '../src/client/locales.ts'
import { workspaceState } from './workspace-fixtures.client.ts'

afterEach(cleanup)

const teamId = workspaceState().team.id
const senderId = 'sender' as never
const peerId = 'peer' as never
const participants = [
  { id: senderId, kind: 'human' as const, role: 'human', phase: 'active' as const, displayName: 'Sender' },
  { id: peerId, kind: 'human' as const, role: 'human', phase: 'active' as const, displayName: 'Peer' },
]
const state = { team: workspaceState().team, participants, tasks: [] }
const channel: ChannelReadPageResult['channel'] = { manifest: { id: 'managed-channel' as never, teamId,
  adapter: { type: 'direct', version: 4 }, participants: participants.map(member => ({ id: member.id, role: member.role })),
  limits: {} }, phase: 'active', cursor: 4 }
const translate = makeTranslate(en)

it('requires a name and role before inviting a manually configured member', async () => {
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockResolvedValue(undefined)
  const view = render(<TeamManagementDialog target={{ kind: 'memberInvite' }} state={state}
    channel={undefined} translate={translate} manage={manage} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: en['manage.memberInvite'] }))
  expect(view.getByRole('alert').textContent).toBe(en['manage.nameRequired'])
  fireEvent.change(view.getByLabelText(en['manage.name']), { target: { value: '  Release worker  ' } })
  fireEvent.change(view.getByLabelText(en['manage.role']), { target: { value: '' } })
  fireEvent.click(view.getByRole('button', { name: en['manage.memberInvite'] }))
  expect(view.getByRole('alert').textContent).toBe(en['manage.roleRequired'])
  fireEvent.change(view.getByLabelText(en['manage.role']), { target: { value: 'worker' } })
  fireEvent.click(view.getByRole('button', { name: en['manage.memberInvite'] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledWith({ operation: 'memberInvite', input: {
    expectedCursor: state.team.cursor, kind: 'local-agent', displayName: 'Release worker', role: 'worker',
    capabilities: [],
  } }, expect.any(AbortSignal)) })
})

it.each(['memberActivate', 'memberRemove', 'memberInterrupt'] as const)
('submits the exact %s target with its current Team cursor', async (kind) => {
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockResolvedValue(undefined)
  const view = render(<TeamManagementDialog target={{ kind, participantId: peerId }} state={state}
    channel={undefined} translate={translate} manage={manage} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: en[`manage.${kind}`] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledWith({ operation: kind,
    input: { participantId: peerId, expectedCursor: state.team.cursor } }, expect.any(AbortSignal)) })
})

it('requires message content, then uses the selected delivery mode and exact peer audience', async () => {
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockResolvedValue(undefined)
  const props = { target: { kind: 'channelPost' as const, channelId: channel.manifest.id },
    state, channel, senderId, translate, manage, onClose: vi.fn() }
  const view = render(<TeamManagementDialog {...props} />)
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  expect(view.getByRole('alert').textContent).toBe(en['channel.contentRequired'])
  fireEvent.click(view.getByRole('radio', { name: en['manage.delivery.context'] }))
  fireEvent.click(view.getByRole('radio', { name: en['manage.delivery.turn'] }))
  fireEvent.change(view.getByLabelText(en['manage.text']), { target: { value: 'Exact peer message' } })
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledTimes(1) })
  const command = manage.mock.calls[0]?.[0]
  if (command?.operation !== 'channelInput') throw new Error('Channel input was not dispatched')
  expect(command.input).toMatchObject({ channelId: channel.manifest.id, expectedCursor: channel.cursor,
    audience: [peerId], delivery: 'turn', content: [{ type: 'text', text: 'Exact peer message' }] })
})

it('refuses a message without an admitted sender identity', () => {
  const manage = vi.fn(async () => {})
  const view = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: channel.manifest.id }}
    state={state} channel={channel} translate={translate} manage={manage} onClose={vi.fn()} />)
  fireEvent.change(view.getByLabelText(en['manage.text']), { target: { value: 'Do not send this' } })
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  expect(view.getByRole('alert').textContent).toBe(en['channel.senderUnavailable'])
  expect(manage).not.toHaveBeenCalled()
})

it('keeps one channel command in flight and aborts it when the user stops waiting', async () => {
  let finish!: () => void
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockImplementation(async () => { await new Promise<void>((resolve) => { finish = resolve }) })
  const close = vi.fn()
  const view = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: channel.manifest.id }}
    state={state} channel={channel} senderId={senderId} translate={translate}
    manage={manage} onClose={close} />)
  fireEvent.change(view.getByLabelText(en['manage.text']), { target: { value: 'One retained message' } })
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  const form = view.getByRole('dialog').querySelector('form')
  if (form === null) throw new Error('Channel form is missing')
  fireEvent.submit(form)
  expect(manage).toHaveBeenCalledOnce()
  const signal = manage.mock.calls[0]?.[1]
  fireEvent.click(view.getAllByRole('button', { name: en.cancel })[0]!)
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: en['detail.cancelRead'] }))
  expect(signal?.aborted).toBe(true)
  expect(view.getByRole('alert').textContent).toBe(en['manage.cancelledRead'])
  await act(async () => { finish(); await Promise.resolve() })
  expect(close).not.toHaveBeenCalled()
})

it('requires a view and two selected members before opening a direct channel', async () => {
  const manage = vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>()
    .mockResolvedValue(undefined)
  const catalog = { loading: false, value: { adapters: [{ type: 'direct', version: 4 }],
    viewPolicies: [{ type: 'recent-window', version: 1 }] } }
  const view = render(<TeamManagementDialog target={{ kind: 'channelOpen' }} state={state}
    channel={undefined} catalog={catalog} translate={translate} manage={manage} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('radio', { name: en['channel.protocol.direct'] + ' v4' }))
  fireEvent.click(view.getByRole('button', { name: en['manage.channelOpen'] }))
  expect(view.getByRole('alert').textContent).toBe(en['channel.viewRequired'])
  fireEvent.click(view.getByRole('radio', { name: 'recent-window v1' }))
  fireEvent.click(view.getByRole('checkbox', { name: /Peer · human/ }))
  fireEvent.click(view.getByRole('button', { name: en['manage.channelOpen'] }))
  expect(view.getByRole('alert').textContent).toBe(en['manage.membersRequired'])
  fireEvent.click(view.getByRole('checkbox', { name: /Peer · human/ }))
  fireEvent.click(view.getByRole('button', { name: en['manage.channelOpen'] }))
  await waitFor(() => { expect(manage).toHaveBeenCalledWith({ operation: 'channelOpen', input: {
    expectedCursor: state.team.cursor, adapter: { type: 'direct', version: 4 },
    viewPolicy: { type: 'recent-window', version: 1 }, limits: {},
    participants: [{ id: senderId, role: 'human' }, { id: peerId, role: 'human' }],
  } }, expect.any(AbortSignal)) })
})

it('refuses an empty selected audience and a retained broadcast after a peer goes offline', () => {
  const manage = vi.fn(async () => {})
  const props = { target: { kind: 'channelPost' as const, channelId: channel.manifest.id },
    channel, senderId, translate, manage, onClose: vi.fn() }
  const view = render(<TeamManagementDialog {...props} state={state} />)
  fireEvent.change(view.getByLabelText(en['manage.text']), { target: { value: 'Audience changes' } })
  fireEvent.click(view.getByRole('checkbox', { name: /Peer · human/ }))
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  expect(view.getByRole('alert').textContent).toBe(en['manage.audienceRequired'])
  fireEvent.click(view.getByRole('checkbox', { name: /Peer · human/ }))
  fireEvent.click(view.getByRole('radio', { name: en['channel.broadcastAudience'] }))
  view.rerender(<TeamManagementDialog {...props} state={{ ...state,
    participants: [{ ...participants[0]! }, { ...participants[1]!, phase: 'left' }] }} />)
  expect(view.getByRole('radio', { name: en['channel.broadcastAudience'] }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  expect(view.getByRole('alert').textContent).toBe(en['channel.broadcastUnavailable'])
  expect(manage).not.toHaveBeenCalled()
})

it('blocks consult text until admission permits the speaker and redirects review requests', () => {
  const consult: ChannelReadPageResult['channel'] = { ...channel, manifest: { ...channel.manifest,
    adapter: { type: 'consult', version: 1 }, participants: [{ id: senderId, role: 'initiator' },
      { id: peerId, role: 'respondent' }] } }
  const manage = vi.fn(async () => {})
  const props = { target: { kind: 'channelPost' as const, channelId: channel.manifest.id },
    state, channel: consult, senderId, translate, manage, onClose: vi.fn() }
  const view = render(<TeamManagementDialog {...props} />)
  fireEvent.change(view.getByLabelText(en['manage.text']), { target: { value: 'Consult request' } })
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  expect(view.getByRole('alert').textContent).toBe(en['channel.waitForSpeaker'])
  const admission: TeamChannelAdmission = { channel: consult, invitations: [],
    expectedNext: { kind: 'participant', participantId: senderId },
    protocolStatus: { kind: 'consult', phase: 'response', request: {
      teamId, channelId: consult.manifest.id, envelopeId: 'review-envelope' as never,
      envelopeSequence: 1, taskId: 'review-task' as never, review: true,
    } } }
  view.rerender(<TeamManagementDialog {...props} admission={admission} />)
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  expect(view.getByRole('alert').textContent).toBe(en['channel.reviewSeparate'])
  expect(manage).not.toHaveBeenCalled()
})

it('refuses a stale channel identity after a close or send form outlives its original channel', () => {
  const manage = vi.fn(async () => {})
  const oldId = 'replaced-channel' as typeof channel.manifest.id
  const post = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: oldId }}
    state={state} channel={channel} senderId={senderId} translate={translate}
    manage={manage} onClose={vi.fn()} />)
  fireEvent.change(post.getByLabelText(en['manage.text']), { target: { value: 'Stale send' } })
  fireEvent.click(post.getByRole('button', { name: en['manage.channelPost'] }))
  expect(manage).not.toHaveBeenCalled()
  post.unmount()
  const close = render(<TeamManagementDialog target={{ kind: 'channelClose', channelId: oldId }}
    state={state} channel={channel} translate={translate} manage={manage} onClose={vi.fn()} />)
  fireEvent.click(close.getByRole('button', { name: en['manage.channelClose'] }))
  expect(manage).not.toHaveBeenCalled()
})

it('shows channel catalog loading and read errors before protocol choices arrive', () => {
  const catalog: TeamChannelCatalogState = { loading: true, error: 'Catalog temporarily offline' }
  const props = { target: { kind: 'channelOpen' as const }, state, channel: undefined,
    translate, manage: vi.fn(async () => {}), onClose: vi.fn() }
  const view = render(<TeamManagementDialog {...props} catalog={catalog} />)
  expect(view.getByRole('status').textContent).toBe(en['channel.catalogLoading'])
  expect(view.getByRole('alert').textContent).toBe('Catalog temporarily offline')
  view.rerender(<TeamManagementDialog {...props} catalog={{ loading: false, value: {
    adapters: [{ type: 'direct', version: 4 }], viewPolicies: [{ type: 'recent-window', version: 1 }],
  } }} />)
  expect(view.getByRole('radio', { name: en['channel.protocol.direct'] + ' v4' })).toBeTruthy()
})

it('retains the selected discussion order while labeling a departed member', () => {
  const catalog: TeamChannelCatalogState = { loading: false, value: {
    adapters: [{ type: 'discussion', version: 1 }], viewPolicies: [{ type: 'recent-window', version: 1 }],
  } }
  const props = { target: { kind: 'channelOpen' as const }, channel: undefined,
    catalog, translate, manage: vi.fn(async () => {}), onClose: vi.fn() }
  const view = render(<TeamManagementDialog {...props} state={state} />)
  fireEvent.click(view.getByRole('radio', { name: en['channel.protocol.discussion'] + ' v1' }))
  view.rerender(<TeamManagementDialog {...props} state={{ ...state, participants: [participants[0]!] }} />)
  expect(view.getByText(en['channel.unknownParticipant'])).toBeTruthy()
})

it.each([new Error('Draft storage failed'), 'Draft storage unavailable'])
('reports a retained composer write failure without replacing the saved draft: %s', (failure) => {
  const onDraftChange = vi.fn(() => { throw failure })
  const view = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: channel.manifest.id }}
    state={state} channel={channel} senderId={senderId} translate={translate}
    manage={vi.fn(async () => {})} onClose={vi.fn()} inline onDraftChange={onDraftChange} />)
  fireEvent.change(view.getByLabelText(en['manage.text']), { target: { value: 'Keep this draft' } })
  expect(view.getByRole('alert').textContent).toBe(failure instanceof Error ? failure.message : failure)
  expect((view.getByLabelText(en['manage.text']) as HTMLTextAreaElement).value).toBe('')
  expect(onDraftChange).toHaveBeenCalledOnce()
})

it.each([new Error('Command rejected'), 'Command response unavailable'])
('reports a rejected member operation while keeping the management form open: %s', async (failure) => {
  const manage = vi.fn(async () => { throw failure })
  const close = vi.fn()
  const view = render(<TeamManagementDialog target={{ kind: 'memberActivate', participantId: peerId }}
    state={state} channel={undefined} translate={translate} manage={manage} onClose={close} />)
  fireEvent.click(view.getByRole('button', { name: en['manage.memberActivate'] }))
  expect((await view.findByRole('alert')).textContent).toBe(failure instanceof Error ? failure.message : failure)
  expect(close).not.toHaveBeenCalled()
})

it('explains an accepted channel command whose refresh rejects without an Error object', async () => {
  const manage = vi.fn(async () => {})
  const close = vi.fn()
  const view = render(<TeamManagementDialog target={{ kind: 'channelClose', channelId: channel.manifest.id }}
    state={state} channel={channel} translate={translate} manage={manage} onClose={close}
    refreshChannel={vi.fn(async () => { throw 'Read service offline' })} />)
  fireEvent.click(view.getByRole('button', { name: en['manage.channelClose'] }))
  expect((await view.findByRole('alert')).textContent).toContain('Read service offline')
  expect(manage).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('requires text for an admitted consult turn before sending', () => {
  const consult: ChannelReadPageResult['channel'] = { ...channel, manifest: { ...channel.manifest,
    adapter: { type: 'consult', version: 1 } } }
  const admission: TeamChannelAdmission = { channel: consult, invitations: [],
    expectedNext: { kind: 'participant', participantId: senderId },
    protocolStatus: { kind: 'consult', phase: 'request' } }
  const manage = vi.fn(async () => {})
  const view = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: consult.manifest.id }}
    state={state} channel={consult} admission={admission} senderId={senderId}
    translate={translate} manage={manage} onClose={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: en['manage.channelPost'] }))
  expect(view.getByRole('alert').textContent).toBe(en['channel.contentRequired'])
  expect(manage).not.toHaveBeenCalled()
})

it('shows broadcast delivery in an inline composer and names an image without a filename', () => {
  const draft: ChannelComposerDraft = { text: '', selected: [peerId], audienceMode: 'selected', delivery: 'turn',
    retryKey: 'retained', retryFingerprint: undefined,
    content: [{ id: 'nameless-image', content: { type: 'image', mediaType: 'image/png', data: 'AA==' } }] }
  const view = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: channel.manifest.id }}
    state={state} channel={channel} senderId={senderId} translate={translate} draft={draft}
    manage={vi.fn(async () => {})} onClose={vi.fn()} inline />)
  expect(view.getByAltText(en['channel.image'])).toBeTruthy()
  view.unmount()
  const fresh = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: channel.manifest.id }}
    state={state} channel={channel} senderId={senderId} translate={translate}
    manage={vi.fn(async () => {})} onClose={vi.fn()} inline />)
  fireEvent.click(fresh.getByRole('radio', { name: en['channel.broadcastAudience'] }))
  expect(fresh.getByText((_, element) => element?.tagName === 'P'
    && element.textContent?.includes(en['channel.broadcastAudience']))).toBeTruthy()
})

it('treats a cancelled file selection as an empty import and explains an unsupported selected image', async () => {
  const view = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: channel.manifest.id }}
    state={state} channel={channel} senderId={senderId} translate={translate}
    manage={vi.fn(async () => {})} onClose={vi.fn()} />)
  const picker = view.getByLabelText(en['channel.addImages'], { selector: 'input' })
  fireEvent.change(picker, { target: { files: null } })
  expect(view.queryByRole('alert')).toBeNull()
  fireEvent.change(picker, { target: { files: [new File(['<svg/>'], 'vector.svg', { type: 'image/svg+xml' })] } })
  expect((await view.findByRole('alert')).textContent).toContain('Unsupported image media type')
})

it('replaces an in-progress image selection without reporting its cancellation', async () => {
  const view = render(<TeamManagementDialog target={{ kind: 'channelPost', channelId: channel.manifest.id }}
    state={state} channel={channel} senderId={senderId} translate={translate}
    manage={vi.fn(async () => {})} onClose={vi.fn()} />)
  const picker = view.getByLabelText(en['channel.addImages'], { selector: 'input' })
  fireEvent.change(picker, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } })
  fireEvent.change(picker, { target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] } })
  await view.findByAltText('second.png')
  expect(view.queryByAltText('first.png')).toBeNull()
  expect(view.queryByRole('alert')).toBeNull()
})
