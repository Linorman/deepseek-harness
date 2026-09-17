import { DraftCapacityError } from '../src/client/workspace-store.ts'
import { createHash } from 'node:crypto'
import type { TeamStateSnapshot } from '@clocky/clocky-client-connection/client'
// @vitest-environment jsdom
import { useState } from 'react'
import type { ChannelComposerDraft } from '../src/client/channel-draft.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ChannelReadPageResult, TeamManagementCommand, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import { TeamManagementDialog } from '../src/client/TeamManagementDialog.tsx'
import { channelDraftFingerprint, encodeChannelImage, encodeChannelImages } from '../src/client/channel-draft.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
function imageFile() { return new File([Uint8Array.from(atob(png), value => value.charCodeAt(0))], 'tiny.png', { type: 'image/png' }) }
function fixture(inactive = false) {
  const teamId = 'draft-team' as TeamTaskSelection['teamId']
  const goal = { teamId, objective: 'Send an ordered message', revision: 1, phase: 'active' as const, budgets: {} }
  type Participant = TeamStateSnapshot['participants'][number]
  type PrincipalId = Extract<NonNullable<Participant['owner']>, { kind: 'product-principal' }>['principalId']
  const roster = [
    { id: 'self-human', kind: 'human', role: 'human', displayName: 'Current person', phase: 'active' },
    { id: 'other-human', kind: 'human', role: 'human', displayName: 'Other person', phase: 'active' },
    { id: 'coordinator', kind: 'local-agent', role: 'coordinator', displayName: 'Coordinator', phase: 'active' },
    { id: 'offline', kind: 'human', role: 'human', displayName: 'Departed person', phase: 'left' },
    { id: 'outside', kind: 'local-agent', role: 'worker', displayName: 'Outside member', phase: 'active' },
  ] as const
  const participants = roster.map((participant): Participant => ({ ...participant, id: participant.id as Participant['id'], teamId, capabilities: [],
    ...participant.kind === 'human' ? { owner: { kind: 'product-principal', principalId: `principal:${participant.id}` as PrincipalId } } : {} }))
  const state: TeamStateSnapshot = { team: { id: teamId, goal, phase: 'active', depth: 0, maxTeamDepth: 2,
    cursor: 1, createdAt: 1, updatedAt: 1 }, goal, participants, rules: {}, budgets: {}, activations: [], tasks: [],
  channelIds: ['draft-channel' as never], workspaceAllocations: [] }
  const channel: ChannelReadPageResult['channel'] = { manifest: { id: state.channelIds[0]!, teamId,
    adapter: { type: 'direct', version: 4 }, limits: {}, participants: participants.filter(participant =>
      participant.id !== 'outside' && (inactive || participant.id !== 'offline')).map(participant => ({ id: participant.id, role: participant.role })) },
  phase: 'active', cursor: 7 }
  return { state, channel, senderId: participants[0]!.id, translate: makeTranslate(en),
    target: { kind: 'channelPost' as const, channelId: channel.manifest.id },
    manage: vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>(async () => {}),
    refreshChannel: vi.fn(async () => {}), onClose: vi.fn() }
}

describe('ordered channel message draft', () => {
  it('selects active channel recipients by the exact sender identity, including another human', async () => {
    const props = fixture(true)
    const view = render(<TeamManagementDialog {...props} />)
    expect(view.queryByRole('checkbox', { name: /Current person/ })).toBeNull()
    expect(view.getByRole('checkbox', { name: /Other person/ })).toBeTruthy()
    expect(view.queryByRole('checkbox', { name: /Departed person|Outside member/ })).toBeNull()
    expect(view.getByRole('radio', { name: 'Broadcast to other channel members' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Hello selected people' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledOnce() })
    expect(props.manage.mock.calls[0]?.[0]).toMatchObject({ operation: 'channelInput', input: {
      audience: ['other-human', 'coordinator'], content: [{ type: 'text', text: 'Hello selected people' }] } })
  })

  it('preserves text/image order through movement, removal and ambiguous retries while sending explicit broadcast', async () => {
    const props = fixture()
    props.manage.mockRejectedValueOnce(new Error('Response interrupted'))
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.click(view.getByRole('radio', { name: 'Broadcast to other channel members' }))
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Before image' } })
    fireEvent.change(view.getByLabelText('Add images', { selector: 'input' }), { target: { files: [imageFile()] } })
    await view.findByAltText('tiny.png')
    fireEvent.click(view.getByRole('button', { name: 'Add text' }))
    fireEvent.change(view.getByLabelText('Text content 3'), { target: { value: 'After image' } })
    fireEvent.click(view.getByRole('button', { name: 'Move content item 2 up' }))
    fireEvent.click(view.getByRole('button', { name: 'Move content item 1 down' }))
    fireEvent.click(view.getByRole('button', { name: 'Add text' }))
    fireEvent.click(view.getByRole('button', { name: 'Remove content item 4' }))
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await view.findByText('Response interrupted')
    const first = props.manage.mock.calls[0]?.[0]
    expect(first).toMatchObject({ operation: 'channelInput', input: { audience: null, expectedCursor: 7,
      content: [{ type: 'text', text: 'Before image' }, { type: 'image', mediaType: 'image/png', data: png, name: 'tiny.png' },
        { type: 'text', text: 'After image' }] } })
    view.rerender(<TeamManagementDialog {...props} channel={{ ...props.channel, cursor: 8 }} />)
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledTimes(2) })
    const second = props.manage.mock.calls[1]?.[0]
    if (first?.operation !== 'channelInput' || second?.operation !== 'channelInput') throw new Error('Expected encoded channel input')
    expect(second.input.idempotencyKey).toBe(first.input.idempotencyKey)
    expect(second.input.content).toEqual(first.input.content)
    expect(second.input.expectedCursor).toBe(8)
  })

  it('keeps the original retry identity after edits are reverted before resubmission', async () => {
    const props = fixture()
    props.manage.mockRejectedValueOnce(new Error('Ambiguous response'))
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Original' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await view.findByText('Ambiguous response')
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Edited' } })
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Original' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledTimes(2) })
    const [first, second] = props.manage.mock.calls.map(call => call[0])
    if (first?.operation !== 'channelInput' || second?.operation !== 'channelInput') throw new Error('Expected channel input')
    expect(second.input.idempotencyKey).toBe(first.input.idempotencyKey)
  })

  it('uses a fixed-size fingerprint for large media and distinguishes ordered content and delivery', () => {
    const request = { content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'A'.repeat(1024 * 1024) },
      { type: 'text' as const, text: '甲😀' }], audience: null, delivery: 'turn' as const }
    const fingerprint = channelDraftFingerprint(request)
    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(fingerprint.length).toBe(71)
    expect(fingerprint).toBe(`sha256:${createHash('sha256').update(JSON.stringify(request)).digest('hex')}`)
    expect(channelDraftFingerprint({ ...request, content: [...request.content].reverse() })).not.toBe(fingerprint)
    expect(channelDraftFingerprint({ ...request, delivery: 'context' })).not.toBe(fingerprint)
    expect(channelDraftFingerprint({ ...request, content: structuredClone(request.content) })).toBe(fingerprint)
  })

  it('releases accepted content before a slow channel refresh settles', async () => {
    const props = fixture()
    const refreshing = Promise.withResolvers<undefined>()
    props.refreshChannel.mockReturnValue(refreshing.promise)
    const view = render(<TeamManagementDialog {...props} inline />)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Already accepted' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(props.refreshChannel).toHaveBeenCalledOnce() })
    expect((view.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('')
    refreshing.resolve(undefined)
    await waitFor(() => { expect(view.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false) })
  })

  it('clears accepted media even if channel refresh fails, without refreshing twice', async () => {
    const props = fixture()
    props.refreshChannel.mockRejectedValue(new Error('Refresh unavailable'))
    const view = render(<TeamManagementDialog {...props} inline />)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Accepted text' } })
    fireEvent.change(view.getByLabelText('Add images', { selector: 'input' }), { target: { files: [imageFile()] } })
    await view.findByAltText('tiny.png')
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await view.findByText('Operation accepted, but channel refresh failed: Refresh unavailable')
    expect((view.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('')
    expect(view.queryByAltText('tiny.png')).toBeNull()
    expect(props.manage).toHaveBeenCalledOnce()
    expect(props.refreshChannel).toHaveBeenCalledOnce()
  })

  it('preserves an ambiguous send and its original error when the follow-up refresh also fails', async () => {
    const props = fixture()
    props.manage.mockRejectedValueOnce(new Error('Send response lost'))
    props.refreshChannel.mockRejectedValueOnce(new Error('Refresh unavailable'))
    const view = render(<TeamManagementDialog {...props} inline />)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Keep until accepted' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await view.findByText('Send response lost')
    expect((view.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Keep until accepted')
    expect(props.refreshChannel).toHaveBeenCalledOnce()
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledTimes(2) })
    expect(props.manage.mock.calls[1]?.[0]).toEqual(props.manage.mock.calls[0]?.[0])
  })

  it('refuses submission when retry identity cannot be retained and preserves existing input', async () => {
    const props = fixture()
    function LimitedComposer() {
      const [draft, setDraft] = useState<ChannelComposerDraft>()
      return <TeamManagementDialog {...props} inline draft={draft} onDraftChange={(value) => {
        if (value.retryFingerprint !== undefined) throw new DraftCapacityError('limit')
        setDraft(value)
      }} />
    }
    const view = render(<LimitedComposer />)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Retain this input' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await view.findByText('Draft storage is full. Discard an unneeded channel draft or reduce its content.')
    expect(props.manage).not.toHaveBeenCalled()
    expect((view.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Retain this input')
  })

  it('requires an explicit discard confirmation before clearing retained content', async () => {
    const props = fixture()
    const discard = vi.fn()
    const view = render(<TeamManagementDialog {...props} inline onDraftDiscard={discard} />)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Unsent input' } })
    fireEvent.click(view.getByRole('button', { name: 'Discard this draft' }))
    expect(discard).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Keep editing' }))
    expect((view.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Unsent input')
    fireEvent.click(view.getByRole('button', { name: 'Discard this draft' }))
    const buttons = view.getAllByRole('button', { name: 'Discard this draft' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => { expect(discard).toHaveBeenCalledOnce() })
    expect((view.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('')
  })

  it('uses a new retry identity after the draft changes', async () => {
    const props = fixture()
    props.manage.mockRejectedValueOnce(new Error('Retry this message'))
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Original text' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await view.findByText('Retry this message')
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Changed text' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledTimes(2) })
    const [first, second] = props.manage.mock.calls.map(call => call[0])
    if (first?.operation !== 'channelInput' || second?.operation !== 'channelInput') throw new Error('Expected encoded channel input')
    expect(second.input.idempotencyKey).not.toBe(first.input.idempotencyKey)
  })

  it('refuses an oversized configured import before reading files and preserves the existing text', async () => {
    const props = fixture()
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    try {
      const view = render(<TeamManagementDialog {...props} maxDraftBytes={1024} />)
      fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Keep my text' } })
      const file = new File(['x'.repeat(800)], 'large.png', { type: 'image/png' })
      fireEvent.change(view.getByLabelText('Add images', { selector: 'input' }), { target: { files: [file] } })
      await view.findByText(makeTranslate(en)('channel.draftCapacity'))
      expect(read).not.toHaveBeenCalled()
      expect((view.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Keep my text')
      expect(props.manage).not.toHaveBeenCalled()
      fireEvent.change(view.getByLabelText('Add images', { selector: 'input' }), { target: { files: [imageFile()] } })
      await view.findByAltText('tiny.png')
      expect(read).toHaveBeenCalledOnce()
    } finally { read.mockRestore() }
  })

  it('budgets the entire encoded batch including existing content and filename metadata before any read', async () => {
    const draft: ChannelComposerDraft = { text: '', content: [], selected: [], audienceMode: 'selected', delivery: 'turn',
      retryKey: 'retry', retryFingerprint: undefined }
    const files = [new File(['ab'], '', { type: 'image/jpeg' }), new File(['cd'], '圖.png', { type: 'image/png' })]
    const signal = new AbortController().signal
    const rows = await encodeChannelImages(files, draft, 4096, signal)
    const exact = new TextEncoder().encode(JSON.stringify({ ...draft, content: rows })).byteLength
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
    try {
      await expect(encodeChannelImages(files, draft, exact - 1, signal)).rejects.toThrow('configured draft byte limit')
      expect(read).not.toHaveBeenCalled()
      expect(await encodeChannelImages(files, draft, exact, signal)).toMatchObject([
        { content: { data: 'YWI=', mediaType: 'image/jpeg' } }, { content: { data: 'Y2Q=', name: '圖.png' } },
      ])
      read.mockClear()
      await expect(encodeChannelImages(files, { ...draft, content: rows }, exact, signal)).rejects.toThrow('configured draft byte limit')
      expect(read).not.toHaveBeenCalled()
    } finally { read.mockRestore() }
  })

  it('aborts image encoding when its form leaves without submitting', () => {
    const props = fixture()
    const abort = vi.spyOn(FileReader.prototype, 'abort')
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.change(view.getByLabelText('Add images', { selector: 'input' }), { target: { files: [imageFile()] } })
    view.unmount()
    expect(abort).toHaveBeenCalled()
    expect(props.manage).not.toHaveBeenCalled()
    abort.mockRestore()
  })

  it.each([null, new DOMException('File became unreadable', 'NotReadableError')])(
    'rejects native read failures and releases callbacks (%s)', async (failure) => {
      const readers: FileReader[] = []
      const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
        readers.push(this)
        Object.defineProperty(this, 'error', { value: failure })
        this.dispatchEvent(new ProgressEvent('error'))
      })
      try {
        await expect(encodeChannelImage(imageFile(), new AbortController().signal)).rejects.toThrow(
          failure?.message ?? 'Image file could not be read')
        expect(readers[0]?.onerror).toBeNull()
        expect(readers[0]?.onload).toBeNull()
        expect(readers[0]?.onabort).toBeNull()
      } finally { read.mockRestore() }
    })

  it('rejects a load callback without encoded text instead of publishing invalid media', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent('load'))
    })
    try {
      await expect(encodeChannelImage(imageFile(), new AbortController().signal)).rejects.toThrow('Image file did not encode as text')
    } finally { read.mockRestore() }
  })

  it('normalizes a non-Error cancellation reason without returning partial image content', async () => {
    const controller = new AbortController()
    const pending = encodeChannelImage(imageFile(), controller.signal)
    controller.abort('Composer closed')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Image import cancelled' })
  })

  it('rejects unsupported file content types and cancels an active native reader', async () => {
    await expect(encodeChannelImage(new File(['x'], 'script.svg', { type: 'image/svg+xml' }), new AbortController().signal)).rejects.toThrow('Unsupported image media type')
    const controller = new AbortController()
    const pending = encodeChannelImage(imageFile(), controller.signal)
    controller.abort(new Error('Draft closed'))
    await expect(pending).rejects.toThrow('Draft closed')
  })
})


it('retains an inline channel draft and ambiguous retry identity across unmounts, then clears only an accepted send', async () => {
  const props = fixture()
  props.manage.mockRejectedValueOnce(new Error('Response interrupted'))
  let retained: ChannelComposerDraft | undefined
  function InlineComposer() {
    const [draft, setDraft] = useState(retained)
    return <TeamManagementDialog {...props} inline draft={draft} onDraftChange={(value) => { retained = value; setDraft(value) }} />
  }
  const first = render(<InlineComposer />)
  expect(first.queryByRole('dialog')).toBeNull()
  fireEvent.change(first.getByLabelText('Message'), { target: { value: 'Keep this channel draft' } })
  fireEvent.change(first.getByLabelText('Add images', { selector: 'input' }), { target: { files: [imageFile()] } })
  await first.findByAltText('tiny.png')
  fireEvent.click(first.getByRole('button', { name: 'Send message' }))
  await first.findByText('Response interrupted')
  const saved = (): ChannelComposerDraft | undefined => retained
  expect(saved()?.retryFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u)
  expect(saved()?.retryFingerprint).not.toContain(png)
  const original = props.manage.mock.calls[0]?.[0]
  first.unmount()
  const second = render(<InlineComposer />)
  expect((second.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Keep this channel draft')
  expect(second.getByAltText('tiny.png')).toBeTruthy()
  fireEvent.click(second.getByRole('button', { name: 'Send message' }))
  await waitFor(() => { expect(props.manage).toHaveBeenCalledTimes(2) })
  expect(props.manage.mock.calls[1]?.[0]).toEqual(original)
  await waitFor(() => { expect((second.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('') })
  expect(second.queryByAltText('tiny.png')).toBeNull()
  expect(props.onClose).not.toHaveBeenCalled()
})

it('keeps inline text editable while authority is pending and refuses keyboard submission until authority resolves', async () => {
  const props = fixture()
  const view = render(<TeamManagementDialog {...props} inline channelPending />)
  const message = view.getByLabelText('Message')
  fireEvent.change(message, { target: { value: 'Send when admitted' } })
  fireEvent.keyDown(message, { key: 'Enter', ctrlKey: true })
  expect(props.manage).not.toHaveBeenCalled()
  view.rerender(<TeamManagementDialog {...props} inline channelPending={false} />)
  fireEvent.keyDown(message, { key: 'Enter', ctrlKey: true, isComposing: true })
  expect(props.manage).not.toHaveBeenCalled()
  fireEvent.keyDown(message, { key: 'Enter', ctrlKey: true })
  await waitFor(() => { expect(props.manage).toHaveBeenCalledOnce() })
})
