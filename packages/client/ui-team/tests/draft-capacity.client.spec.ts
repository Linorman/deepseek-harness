import { Context } from '@clocky/cordis'
/** Capacity refusal is atomic and never evicts another channel's input. */
import { expect, it } from 'vitest'
import { createTeamWorkspaceStore, DraftCapacityError, Config } from '../src/client/workspace-store.ts'
import type { ChannelComposerDraft } from '../src/client/channel-draft.ts'
const draft = (text: string): ChannelComposerDraft => ({ text, content: [{ id: 'text', content: { type: 'text', text } }],
  selected: [], audienceMode: 'broadcast', delivery: 'turn', retryKey: 'retry', retryFingerprint: undefined })

it('treats repeated removal of absent input as a no-op without creating a Team view', () => {
  const store = createTeamWorkspaceStore().create()
  store.actions.discardChannelDraft('missing' as never, 'channel' as never)
  store.actions.discardActionDraft('missing' as never, 'action' as never)
  store.actions.discardTaskDraft('missing' as never, { kind: 'taskCreate' })
  expect(store.getSnapshot().byTeam).toEqual({})
  expect(store.getSnapshot().draftCount).toBe(0)
  expect(store.getSnapshot().draftBytes).toBe(0)
})

it('retains independent scroll positions only for a registered Team view', () => {
  const store = createTeamWorkspaceStore().create()
  store.actions.update('team' as never, {})
  store.actions.rememberScroll('team' as never, 'tasks', 50)
  store.actions.rememberScroll('team' as never, 'channels', 100)
  expect(store.getSnapshot().byTeam.team?.scroll).toEqual({ tasks: 50, channels: 100 })
})

it('commits map, order and counts before observers reenter at capacity without evicting pinned drafts', () => {
  const store = createTeamWorkspaceStore({ maxDrafts: 2, maxViewStates: 3 }).create()
  store.actions.setChannelDraft('a' as never, 'one' as never, draft('Pinned A'))
  store.actions.setActionDraft('b' as never, 'action' as never, { answers: {} })
  store.actions.update('old' as never, {})
  let reentered = false
  const off = store.subscribe(() => {
    const state = store.getSnapshot()
    expect(state.viewOrder.every(id => state.byTeam[id] !== undefined)).toBe(true)
    expect(state.draftCount).toBe(2)
    if (!reentered) { reentered = true; store.actions.update('inner' as never, {}) }
  })
  store.actions.update('outer' as never, {})
  off()
  expect(store.getSnapshot().byTeam.a?.channelDrafts.one?.text).toBe('Pinned A')
  expect(store.getSnapshot().byTeam.b?.actionDrafts.action).toEqual({ answers: {} })
  expect(store.getSnapshot().byTeam.old).toBeUndefined()
  expect(store.getSnapshot().byTeam.inner).toBeDefined()
  store.actions.discardActionDraft('b' as never, 'action' as never)
  expect(store.getSnapshot().draftCount).toBe(1)
  expect(store.getSnapshot().byTeam.b?.actionDrafts).toEqual({})
})

it('refuses oversized media before admitting or retaining a private channel draft', () => {
  const store = createTeamWorkspaceStore({ maxDraftBytes: 100 }).create()
  const value: ChannelComposerDraft = { ...draft(''), content: [{ id: 'image', content: {
    type: 'image' as const, mediaType: 'image/png', data: 'a'.repeat(101),
  } }] }
  const before = store.getSnapshot()
  expect(() => { store.actions.setChannelDraft('team' as never, 'channel' as never, value) }).toThrow('Retained channel draft bytes')
  expect(store.getSnapshot()).toBe(before)
})

it('rejects additional drafts atomically and frees capacity only through explicit removal', () => {
  const store = createTeamWorkspaceStore({ maxDrafts: 2, maxDraftBytes: 4096 }).create()
  store.actions.setChannelDraft('a' as never, 'first' as never, draft('one'))
  store.actions.setChannelDraft('b' as never, 'second' as never, draft('two'))
  const before = store.getSnapshot()
  expect(() =>{  store.actions.setChannelDraft('a' as never, 'third' as never, draft('three')) }).toThrow(DraftCapacityError)
  expect(store.getSnapshot()).toBe(before)
  store.actions.setChannelDraft('a' as never, 'first' as never, draft('edit retained'))
  store.actions.discardChannelDraft('b' as never, 'second' as never)
  store.actions.setChannelDraft('a' as never, 'third' as never, draft('three'))
  expect(store.getSnapshot().byTeam.a?.channelDrafts.first?.text).toBe('edit retained')
  expect(store.getSnapshot().byTeam.a?.channelDrafts.third?.text).toBe('three')
  expect(store.getSnapshot().draftCount).toBe(2)
  const expectedBytes = new TextEncoder().encode(JSON.stringify(['a', 'first', draft('edit retained')])).byteLength
    + new TextEncoder().encode(JSON.stringify(['a', 'third', draft('three')])).byteLength
  expect(store.getSnapshot().draftBytes).toBe(expectedBytes)
})

it('accounts for UTF-8 media and identifiers across Teams, preserving prior content on overflow', () => {
  const value = draft('甲😀')
  const bytes = new TextEncoder().encode(JSON.stringify(['team', 'channel', value])).byteLength
  const store = createTeamWorkspaceStore({ maxDrafts: 10, maxDraftBytes: bytes }).create()
  store.actions.setChannelDraft('team' as never, 'channel' as never, value)
  const before = store.getSnapshot()
  expect(() =>{  store.actions.setChannelDraft('team' as never, 'channel' as never, draft('甲😀x')) }).toThrow(DraftCapacityError)
  expect(() =>{  store.actions.setChannelDraft('other' as never, 'channel' as never, draft('')) }).toThrow(DraftCapacityError)
  expect(store.getSnapshot()).toBe(before)
  store.actions.discardChannelDraft('team' as never, 'channel' as never)
  expect(store.getSnapshot().byTeam.team?.channelDrafts).toEqual({})
})

it('rejects invalid deployment limits', () => {
  expect(() => createTeamWorkspaceStore({ maxDrafts: 0 })).toThrow()
  expect(() => createTeamWorkspaceStore({ maxDraftBytes: -1 })).toThrow()
})

it('shares answer and channel limits, preserves retry identity and removes private answers on authority replacement', () => {
  const answer = { answers: { question: { selected: ['甲'], custom: '😀'.repeat(30) } }, retry: { fingerprint: 'payload', key: 'retry' as never } }
  const bytes = new TextEncoder().encode(JSON.stringify(['team', 'action', 'question', answer])).byteLength
  const store = createTeamWorkspaceStore({ maxDrafts: 1, maxDraftBytes: bytes, maxViewStates: 2 }).create()
  store.actions.setActionDraft('team' as never, 'question' as never, answer)
  store.actions.update('other' as never, {})
  store.actions.update('new' as never, {})
  expect(store.getSnapshot().byTeam.team?.actionDrafts.question).toEqual(answer)
  expect(store.getSnapshot().byTeam.other).toBeUndefined()
  const before = store.getSnapshot()
  expect(() => { store.actions.setChannelDraft('team' as never, 'channel' as never, draft('input')) }).toThrow(DraftCapacityError)
  expect(() => { store.actions.setActionDraft('team' as never, 'question' as never, { ...answer,
    answers: { question: { selected: ['甲'], custom: '😀'.repeat(30) + 'x' } } }) }).toThrow(DraftCapacityError)
  expect(store.getSnapshot()).toBe(before)
  store.actions.clearFormDrafts()
  expect(store.getSnapshot().draftBytes).toBe(0)
  expect(store.getSnapshot().draftCount).toBe(0)
  expect(store.getSnapshot().byTeam.team?.actionDrafts).toEqual({})
  store.actions.setChannelDraft('team' as never, 'channel' as never, draft(''))
  store.actions.clearFormDrafts()
  expect(store.getSnapshot().byTeam.team?.channelDrafts.channel).toBeUndefined()
  expect(store.getSnapshot().draftCount).toBe(0)
})

it('evicts old clean view preferences while preserving all unsent drafts', () => {
  const store = createTeamWorkspaceStore({ maxDrafts: 1, maxViewStates: 3 }).create()
  store.actions.setChannelDraft('pinned' as never, 'channel' as never, draft('Unsent'))
  for (let index = 0; index < 100; index++) {
    store.actions.update(`view-${index}` as never, { taskSearch: `filter ${index}` })
    expect(Object.keys(store.getSnapshot().byTeam)).toHaveLength(Math.min(index + 2, 3))
  }
  expect(store.getSnapshot().byTeam.pinned?.channelDrafts.channel?.text).toBe('Unsent')
  expect(store.getSnapshot().byTeam['view-0']).toBeUndefined()
  store.actions.rememberScroll('view-0' as never, 'tasks', 900)
  expect(store.getSnapshot().byTeam['view-0']).toBeUndefined()
  expect(store.getSnapshot().byTeam['view-99']).toBeDefined()
  expect(store.getSnapshot().viewOrder).toHaveLength(3)
  expect(() => createTeamWorkspaceStore({ maxDrafts: 3, maxViewStates: 3 })).toThrow(/must exceed/)
})

it('applies defaults when the browser Loader mounts the plugin without a config object', async () => {
  const ctx = new Context()
  let received: unknown
  try {
    await ctx.plugin({ Config, apply: (_ctx: Context, config: unknown) => { received = config } })
    expect(received).toEqual({ identityCacheCapacity: 512, identityBatchSize: 64, identityRefreshMs: 5000,
      readinessRefreshMs: 5000, capabilityRefreshMs: 5000, taskReferenceCapacity: 512,
      taskReferenceBatchSize: 64, taskReferenceRefreshMs: 5000, attentionRefreshMs: 5000, attentionPreviewLimit: 3, attentionPageLimit: 64,
      maxDrafts: 32, maxDraftBytes: 8 * 1024 * 1024, maxViewStates: 128 })
  } finally { await ctx.fiber.dispose() }
})

it.each([{ identityCacheCapacity: 0 }, { identityBatchSize: 0 }, { identityBatchSize: 1.5 },
  { identityRefreshMs: 0 }, { identityRefreshMs: 2_147_483_648 }])('rejects invalid identity reader limits: %j', (config) => {
  expect(() => Config.parse(config)).toThrow()
})

it('clears only the denied Team input and releases its channel capacity', () => {
  const store = createTeamWorkspaceStore({ maxDrafts: 2, maxDraftBytes: 4096 }).create()
  store.actions.setChannelDraft('source' as never, 'channel-a' as never, draft('Keep source input'))
  store.actions.setChannelDraft('target' as never, 'channel-b' as never, draft('Retire denied input'))
  store.actions.clearFormDrafts('target' as never)
  expect(store.getSnapshot().byTeam.source?.channelDrafts['channel-a']?.text).toBe('Keep source input')
  expect(store.getSnapshot().byTeam.target?.channelDrafts).toEqual({})
  expect(store.getSnapshot().draftCount).toBe(1)
  store.actions.clearFormDrafts()
  expect(store.getSnapshot().draftCount).toBe(0)
  expect(store.getSnapshot().draftBytes).toBe(0)
})
