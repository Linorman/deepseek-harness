// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ChannelReadPageResult, TeamManagementCommand, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import { TeamManagementDialog } from '../src/client/TeamManagementDialog.tsx'
import { encodeChannelImage } from '../src/client/channel-draft.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC'
function imageFile() { return new File([Uint8Array.from(atob(png), value => value.charCodeAt(0))], 'tiny.png', { type: 'image/png' }) }
function fixture(inactive = false) {
  const teamId = 'draft-team' as TeamTaskSelection['teamId']
  const goal = { teamId, objective: 'Send an ordered message', revision: 1, phase: 'active' as const, budgets: {} }
  type Participant = TeamTaskSelection['state']['participants'][number]
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
  const state: TeamTaskSelection['state'] = { team: { id: teamId, goal, phase: 'active', depth: 0, maxTeamDepth: 2,
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

  it('rejects unsupported file content types and cancels an active native reader', async () => {
    await expect(encodeChannelImage(new File(['x'], 'script.svg', { type: 'image/svg+xml' }), new AbortController().signal)).rejects.toThrow('Unsupported image media type')
    const controller = new AbortController()
    const pending = encodeChannelImage(imageFile(), controller.signal)
    controller.abort(new Error('Draft closed'))
    await expect(pending).rejects.toThrow('Draft closed')
  })
})
