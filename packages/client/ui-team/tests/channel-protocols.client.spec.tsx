// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { ChannelReadPageResult, TeamChannelAdmission, TeamChannelCatalogState, TeamManagementCommand, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import { TeamManagementDialog } from '../src/client/TeamManagementDialog.tsx'
import { ChannelSummaryDialog } from '../src/client/ChannelSummaryDialog.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const capabilities = { allowedPolicies: ['summarized-window'], maxSourceEnvelopes: 10, maxSourceBytes: 65536, maxSummaryBytes: 4096, maxHistorySpan: 20 }
function fixture() {
  type Member = TeamTaskSelection['state']['participants'][number]
  type PrincipalId = Extract<NonNullable<Member['owner']>, { kind: 'product-principal' }>['principalId']
  const teamId = 'protocol-team' as TeamTaskSelection['teamId']
  const goal = { teamId, objective: 'Protocol forms', revision: 1, phase: 'active' as const, budgets: {} }
  const members: readonly Member[] = [
    { id: 'one' as Member['id'], teamId, kind: 'human', role: 'human', displayName: 'Human one', phase: 'active', capabilities: [], owner: { kind: 'product-principal', principalId: 'p1' as PrincipalId } },
    { id: 'two' as Member['id'], teamId, kind: 'human', role: 'human', displayName: 'Human two', phase: 'active', capabilities: [], owner: { kind: 'product-principal', principalId: 'p2' as PrincipalId } },
    { id: 'worker' as Member['id'], teamId, kind: 'local-agent', role: 'worker', displayName: 'Worker', phase: 'active', capabilities: [] },
  ]
  const state: TeamTaskSelection['state'] = { team: { id: teamId, goal, phase: 'active', depth: 0, maxTeamDepth: 2, cursor: 1, createdAt: 1, updatedAt: 1 },
    goal, rules: {}, budgets: {}, participants: members, activations: [], tasks: [], channelIds: ['protocol-channel' as never], workspaceAllocations: [] }
  const catalog: TeamChannelCatalogState = { loading: false, value: { adapters: [{ type: 'direct', version: 4 }, { type: 'consult', version: 1 },
    { type: 'discussion', version: 1 }, { type: 'workflow', version: 1 }], viewPolicies: [{ type: 'recent-window', version: 1 }, { type: 'summarized-window', version: 1 }], summary: capabilities } }
  return { state, catalog, target: { kind: 'channelOpen' as const }, channel: undefined,
    translate: makeTranslate(en), manage: vi.fn<(command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>>(async () => {}),
    refreshChannel: vi.fn(async () => {}), readCatalog: vi.fn(async () => {}), onClose: vi.fn() }
}

describe('catalog-driven channel creation', () => {
  it('allows a direct channel with two humans and no coordinator role', async () => {
    const props = fixture()
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.click(view.getByRole('radio', { name: 'Direct message v4' }))
    fireEvent.click(view.getByRole('radio', { name: 'recent-window v1' }))
    fireEvent.click(view.getByRole('checkbox', { name: /Worker/ }))
    fireEvent.click(view.getByRole('button', { name: 'Open channel' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledOnce() })
    expect(props.manage.mock.calls[0]?.[0]).toMatchObject({ operation: 'channelOpen', input: { adapter: { type: 'direct', version: 4 },
      viewPolicy: { type: 'recent-window', version: 1 }, participants: [{ id: 'one', role: 'human' }, { id: 'two', role: 'human' }] } })
  })

  it('requires explicit distinct consult endpoints', async () => {
    const props = fixture()
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.click(view.getByRole('radio', { name: 'Consult v1' }))
    fireEvent.click(view.getByRole('radio', { name: 'recent-window v1' }))
    fireEvent.click(view.getByRole('button', { name: 'Open channel' }))
    expect(props.manage).not.toHaveBeenCalled()
    fireEvent.click(within(view.getByRole('group', { name: 'Initiator' })).getByRole('radio', { name: 'Human two' }))
    fireEvent.click(within(view.getByRole('group', { name: 'Respondent' })).getByRole('radio', { name: 'Worker' }))
    fireEvent.click(view.getByRole('button', { name: 'Open channel' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledOnce() })
    expect(props.manage.mock.calls[0]?.[0]).toMatchObject({ operation: 'channelOpen', input: { participants: [{ id: 'two', role: 'initiator' }, { id: 'worker', role: 'respondent' }], limits: {} } })
  })

  it('requires discussion limits and preserves the selected participant order', async () => {
    const props = fixture()
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.click(view.getByRole('radio', { name: 'Discussion v1' }))
    fireEvent.click(view.getByRole('radio', { name: 'recent-window v1' }))
    fireEvent.click(view.getByRole('button', { name: 'Open channel' }))
    expect(props.manage).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('Maximum messages'), { target: { value: '3' } })
    fireEvent.click(view.getByRole('radio', { name: 'Free-form discussion' }))
    fireEvent.click(view.getByRole('button', { name: 'Move participant 3 up' }))
    fireEvent.click(view.getByRole('button', { name: 'Open channel' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledOnce() })
    const command = props.manage.mock.calls[0]?.[0]
    if (command?.operation !== 'channelOpen') throw new Error('Expected channel creation')
    expect(command.input.limits).toEqual({ maxTurns: 3, speakerPolicy: 'free-form' })
    expect(command.input.participants.map(member => member.id)).toEqual(['one', 'worker', 'two'])
  })

  it('refuses a registration removed while its creation form is open', () => {
    const props = fixture()
    const view = render(<TeamManagementDialog {...props} />)
    fireEvent.click(view.getByRole('radio', { name: 'Direct message v4' }))
    fireEvent.click(view.getByRole('radio', { name: 'recent-window v1' }))
    view.rerender(<TeamManagementDialog {...props} catalog={{ loading: false, value: { adapters: [], viewPolicies: [] } }} />)
    fireEvent.click(view.getByRole('button', { name: 'Open channel' }))
    expect(props.manage).not.toHaveBeenCalled()
    expect(view.getByRole('alert').textContent).toContain('currently available')
  })
})

describe('basic protocol text submission', () => {
  for (const protocol of ['consult', 'discussion'] as const) it(`sends ${protocol} text with its protocol-derived audience`, async () => {
    const props = fixture()
    const [sender, peer] = props.state.participants
    if (sender === undefined || peer === undefined) throw new Error('Missing fixture peers')
    const channel: ChannelReadPageResult['channel'] = { manifest: { id: props.state.channelIds[0]!, teamId: props.state.team.id,
      adapter: { type: protocol, version: 1 }, participants: [{ id: sender.id, role: 'initiator' }, { id: peer.id, role: 'respondent' }],
      limits: protocol === 'discussion' ? { maxTurns: 3, speakerPolicy: 'free-form' } : {} }, phase: 'active', cursor: 5 }
    const admission: TeamChannelAdmission = { channel, invitations: [], expectedNext: protocol === 'consult'
      ? { kind: 'participant', participantId: sender.id } : { kind: 'none' }, protocolStatus: protocol === 'consult'
      ? { kind: 'consult', phase: 'request' } : { kind: 'discussion', turnCount: 0, maxTurns: 3, speakerPolicy: 'free-form' } }
    const view = render(<TeamManagementDialog {...props} channel={channel} admission={admission} senderId={sender.id}
      target={{ kind: 'channelPost', channelId: channel.manifest.id }} />)
    expect(view.queryByRole('button', { name: 'Add images' })).toBeNull()
    expect(view.queryByRole('radio', { name: en['manage.delivery.steer'] })).toBeNull()
    fireEvent.change(view.getByLabelText('Message'), { target: { value: 'Protocol text' } })
    fireEvent.click(view.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledOnce() })
    expect(props.manage.mock.calls[0]?.[0]).toMatchObject({ operation: 'channelInput', input: {
      audience: protocol === 'consult' ? [peer.id] : null, delivery: 'turn', content: [{ type: 'text', text: 'Protocol text' }] } })
  })
})

function summaryFixture(gap = false): ChannelReadPageResult {
  const { state } = fixture()
  const [sender, other, worker] = state.participants
  if (sender === undefined || other === undefined || worker === undefined) throw new Error('Missing summary participants')
  const envelope = (sequence: number, audience: readonly (typeof sender.id)[] | null) => ({ type: 'channel/envelope' as const,
    envelope: { id: `message-${sequence}` as never, teamId: state.team.id, channelId: state.channelIds[0]!, sequence,
      senderId: sender.id, audience, kind: 'message', payload: { content: [{ type: 'text', text: 'Source text' }] },
      delivery: 'context' as const, priority: 'normal' as const, createdAt: sequence }, deliveryIntents: [] })
  return { channel: { manifest: { id: state.channelIds[0]!, teamId: state.team.id, adapter: { type: 'direct', version: 4 },
    participants: state.participants.map(member => ({ id: member.id, role: member.role })), limits: {}, viewPolicy: { type: 'summarized-window', version: 1 } }, phase: 'active', cursor: 12 },
  records: [envelope(10, null), ...gap ? [] : [{ type: 'channel/receipt' as const, sequence: 11, createdAt: 11, participantId: worker.id,
    envelopeId: 'message-10' as never, cursor: 10 }], envelope(12, [other.id])] }
}

describe('visible summary source selection', () => {
  it('keeps the displayed range and inputs after a text-only summary rejection', async () => {
    const props = fixture()
    props.manage.mockRejectedValueOnce(new Error('Extractive summaries require text-only source messages'))
    const original = summaryFixture()
    const page: ChannelReadPageResult = { ...original, records: original.records.map(record => record.type === 'channel/envelope' && record.envelope.sequence === 10
      ? { ...record, envelope: { ...record.envelope, payload: { content: [{ type: 'image', attachment: {
        attachmentId: `sha256:${'e'.repeat(64)}`, mediaType: 'image/png', bytes: 4, width: 1, height: 1,
      } }] } } } : record) }
    const view = render(<ChannelSummaryDialog page={page} capabilities={capabilities} translate={props.translate} manage={props.manage} onClose={props.onClose} />)
    fireEvent.change(view.getByLabelText('First record sequence'), { target: { value: '10' } })
    fireEvent.change(view.getByLabelText('Last record sequence'), { target: { value: '10' } })
    fireEvent.click(view.getByRole('button', { name: 'Create channel summary' }))
    await view.findByText('Extractive summaries require text-only source messages')
    expect((view.getByLabelText('First record sequence') as HTMLInputElement).value).toBe('10')
    expect((view.getByLabelText('Last record sequence') as HTMLInputElement).value).toBe('10')
    expect(view.getByText('Source records 10–12')).toBeTruthy()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(props.refreshChannel).not.toHaveBeenCalled()
  })

  it('enforces the actual summary capability and its configured history bound', () => {
    const props = fixture()
    const page = summaryFixture()
    const view = render(<ChannelSummaryDialog page={page} capabilities={undefined} translate={props.translate} manage={props.manage} onClose={props.onClose} />)
    fireEvent.change(view.getByLabelText('First record sequence'), { target: { value: '10' } })
    fireEvent.change(view.getByLabelText('Last record sequence'), { target: { value: '11' } })
    fireEvent.click(view.getByRole('button', { name: 'Create channel summary' }))
    expect(view.getByRole('alert').textContent).toContain('No summary capability')
    view.rerender(<ChannelSummaryDialog page={page} capabilities={{ ...capabilities, maxHistorySpan: 1 }} translate={props.translate}
      manage={props.manage} onClose={props.onClose} />)
    fireEvent.click(view.getByRole('button', { name: 'Create channel summary' }))
    expect(view.getByRole('alert').textContent).toContain('exceeds the current summary capability')
    expect(props.manage).not.toHaveBeenCalled()
  })

  it('rejects undisplayed, discontinuous and subset-only ranges without submitting them', () => {
    const props = fixture()
    const view = render(<ChannelSummaryDialog page={summaryFixture(true)} capabilities={capabilities} translate={props.translate} manage={props.manage} onClose={props.onClose} />)
    fireEvent.change(view.getByLabelText('First record sequence'), { target: { value: '10' } })
    fireEvent.change(view.getByLabelText('Last record sequence'), { target: { value: '12' } })
    fireEvent.click(view.getByRole('button', { name: 'Create channel summary' }))
    expect(props.manage).not.toHaveBeenCalled()
    expect(view.getByRole('alert').textContent).toContain('contiguous')
    fireEvent.change(view.getByLabelText('First record sequence'), { target: { value: '12' } })
    fireEvent.click(view.getByRole('button', { name: 'Create channel summary' }))
    expect(props.manage).not.toHaveBeenCalled()
    expect(view.getByRole('alert').textContent).toContain('only some participants')
  })

  it('retains the exact summary range key across a cursor-conflict retry', async () => {
    const props = fixture()
    props.manage.mockRejectedValueOnce(new Error('Channel cursor changed'))
    const page = summaryFixture()
    const view = render(<ChannelSummaryDialog page={page} capabilities={capabilities} translate={props.translate} manage={props.manage} onClose={props.onClose} />)
    fireEvent.change(view.getByLabelText('First record sequence'), { target: { value: '10' } })
    fireEvent.change(view.getByLabelText('Last record sequence'), { target: { value: '11' } })
    fireEvent.click(view.getByRole('button', { name: 'Create channel summary' }))
    await view.findByText('Channel cursor changed')
    view.rerender(<ChannelSummaryDialog page={{ ...page, channel: { ...page.channel, cursor: 13 } }} capabilities={capabilities} translate={props.translate}
      manage={props.manage} onClose={props.onClose} />)
    fireEvent.click(view.getByRole('button', { name: 'Create channel summary' }))
    await waitFor(() => { expect(props.manage).toHaveBeenCalledTimes(2) })
    const [first, second] = props.manage.mock.calls.map(call => call[0])
    if (first?.operation !== 'channelSummarize' || second?.operation !== 'channelSummarize') throw new Error('Expected summary commands')
    expect(second.input.coveredSequenceRange).toEqual({ from: 10, to: 11 })
    expect(second.input.idempotencyKey).toBe(first.input.idempotencyKey)
    expect(second.input.expectedCursor).toBe(13)
  })
})
