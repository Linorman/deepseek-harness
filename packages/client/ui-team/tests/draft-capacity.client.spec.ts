import { Context } from '@clocky/cordis'
/** Capacity refusal is atomic and never evicts another channel's input. */
import { expect, it } from 'vitest'
import { createTeamWorkspaceStore, DraftCapacityError, Config } from '../src/client/workspace-store.ts'
import type { ChannelComposerDraft } from '../src/client/channel-draft.ts'
const draft = (text: string): ChannelComposerDraft => ({ text, content: [{ id: 'text', content: { type: 'text', text } }],
  selected: [], audienceMode: 'broadcast', delivery: 'turn', retryKey: 'retry', retryFingerprint: undefined })

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
    expect(received).toEqual({ maxDrafts: 32, maxDraftBytes: 8 * 1024 * 1024, maxViewStates: 128 })
  } finally { await ctx.fiber.dispose() }
})
