/**
 * Registration: the General row, the settings section, and the header label
 * all come from one apply, and each defers until the slot it fills has been
 * declared. A pushed settings change refreshes the surfaces that are already
 * showing, so a default set from one converges the other.
 */

import { Context } from '@clocky/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@clocky/clocky-client-ui-slots'
import { SlotRegistry } from '@clocky/clocky-client-runtime/client'
import { LocaleRuntime } from '@clocky/clocky-client-locale/client'
import { TestRemote } from '@clocky/clocky-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@clocky/clocky-client-ui-settings/client'
import { apply, inject } from '@clocky/clocky-client-ui-agent-preset/client'
import { AgentPresetLabel } from '../src/client/AgentPresetLabel.tsx'
import type { AgentPresetLabelInjected } from '../src/client/AgentPresetLabel.tsx'
import { AgentPresetRow } from '../src/client/AgentPresetRow.tsx'
import type { AgentPresetRowInjected } from '../src/client/AgentPresetRow.tsx'
import { AgentPresetSection } from '../src/client/AgentPresetSection.tsx'
import type { AgentPresetSectionInjected } from '../src/client/AgentPresetSection.tsx'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); each bench stages zh explicitly on the locale instead.

const ROSTER_ONE = {
  rpcId: 'r',
  result: {
    ok: true as const,
    value: {
      presets: [{ id: 'standard', trust: 'system', isDefault: true }],
      authorable: true,
      hasDocument: true,
    },
  },
}

/** The roster after this browser copied one preset of its own. */
const ROSTER_AUTHORED = {
  rpcId: 'r',
  result: {
    ok: true as const,
    value: {
      presets: [
        { id: 'standard', trust: 'system', isDefault: true },
        { id: 'mine', trust: 'user', isDefault: false },
      ],
      authorable: true,
      hasDocument: true,
    },
  },
}

async function bench() {
  const ctx = new Context()
  // The host's answer moves when a preset copy mutates the roster.
  let ROSTER: typeof ROSTER_ONE | typeof ROSTER_AUTHORED = ROSTER_ONE
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  // The plugins inject `remote`; forwarded events reach them through the
  // same `$dispatch` handoff the connection sink makes.
  new TestRemote(ctx)
  const calls: string[] = []
  ctx.provide('connection', {
    api: {
      agentPresets: {
        list: () => { calls.push('list'); return Promise.resolve(ROSTER) },
        read: () => Promise.resolve({
          rpcId: 'r',
          result: { ok: true as const, value: { agentPreset: 'standard', trust: 'system', content: '' } },
        }),
        copy: (payload: { from: string; agentPreset: string }) => {
          calls.push(`copy:${payload.agentPreset}`)
          // The host's roster now contains it, which is the whole point of the
          // copy and what every surface must converge on.
          ROSTER = ROSTER_AUTHORED
          return Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: { agentPreset: payload.agentPreset } } })
        },
        openDocument: (payload: { agentPreset: string }) => {
          calls.push(`openDocument:${payload.agentPreset}`)
          return Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: { opened: true as const } } })
        },
        remove: () => Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: {} } }),
        select: (payload: { agentPreset: string }) => {
          calls.push(`select:${payload.agentPreset}`)
          return Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: { agentPreset: payload.agentPreset } } })
        },
      },
      settings: {
        // The row reads this to learn whether this browser may write at all.
        describe: () => Promise.resolve({
          rpcId: 'r',
          result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } },
        }),
        update: (payload: { patch: unknown }) => { calls.push(`settings:${JSON.stringify(payload.patch)}`); return Promise.resolve({ rpcId: 'r', result: { ok: true as const, value: {} } }) },
      },
    },
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, calls }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      conversation: { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
}

/** The conversation declaration required by the header label and creator entry. */
function declareConversation(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'conversation',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

/** A Team-task double recording locally configured first-input drafts. */
function teamTasksDouble() {
  const starts: { agentPreset?: string }[] = []
  return {
    starts,
    startDraft: (options?: { agentPreset?: string }) => { starts.push(options ?? {}) },
  }
}

/** A sessions double whose list can be moved and whose changes are pushed. */
function sessionsDouble(state: {
  current?: string
  byId: Record<string, { id: string; blank: boolean; agentPreset?: string }>
}) {
  const listeners = new Set<() => void>()
  const clear = vi.fn()
  return {
    list: {
      getSnapshot: () => state,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    },
    noteAgentPreset: (sessionId: string, agentPreset: string) => {
      const summary = state.byId[sessionId]
      if (summary === undefined || summary.agentPreset === agentPreset) return
      summary.agentPreset = agentPreset
      for (const fn of listeners) fn()
    },
    clear,
    /** Push a list change the way the runtime's store does. */
    notify: () => { for (const fn of listeners) fn() },
  }
}

describe('ui-agent-preset apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers the General row and the settings section', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const row = slots.entries('settings.general.item')[0]!
    expect(row.component).toBe(AgentPresetRow)
    expect(row.options).toMatchObject({ id: 'agent-preset', order: -25 })
    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(AgentPresetSection)
    expect(section.options).toMatchObject({ id: 'agent-presets', order: 20 })
    // The nav label is a locale-following thunk; owners resolve it at read time.
    expect(resolveSlotLabel(section.options.label)).toBe('Agent 预设')
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('hands each surface its own store and actions', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const row = (slots.entries('settings.general.item')[0]!.inject as unknown as () => AgentPresetRowInjected)()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => AgentPresetSectionInjected)()

    expect(row.hooks.agentPreset).not.toBe(section.hooks.agentPresetSection)
    // Each thunk reaches its own controller: the row's load fills the row's
    // store, and the section's default write does not go through the row.
    await row.load()
    await row.select('standard')
    await section.makeDefault('standard')
    expect(row.hooks.agentPreset.getSnapshot().options).toEqual([{ id: 'standard', trust: 'system' }])
    expect(section.hooks.agentPresetSection.getSnapshot().rows)
      .toEqual([{ id: 'standard', trust: 'system', isDefault: true }])
  })

  it('routes the section actions to one controller', async () => {
    const { ctx, slots, calls } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => AgentPresetSectionInjected)()

    await section.load()
    section.beginCopy('standard')
    section.cancelCopy()
    section.beginCopy('standard')
    section.setCopyId('mine')
    section.setCopyName('我的模式')
    await section.confirmCopy()
    await section.view('standard')
    section.closeView()
    section.confirmDelete('mine')
    await Promise.all([section.openLocation('mine'), section.remove()])

    // One controller behind every action: the copy the dialog named is the
    // one the roster re-read reflects, and the delete the section confirmed
    // is the one its remove() sees.
    expect(calls).toContain('copy:mine')
    expect(calls.filter(call => call === 'openDocument:mine').length).toBeGreaterThan(0)
    expect(section.hooks.agentPresetSection.getSnapshot().rows).toHaveLength(2)
  })

  it('refreshes a showing surface when its namespace changes, and ignores others', async () => {
    const { ctx, slots, calls } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => AgentPresetSectionInjected)()
    await section.load()
    const before = calls.length

    ctx.remote.$dispatch('settings/document-updated', ['agent-presets', 1])
    await vi.waitFor(() => { expect(calls.length).toBe(before + 2) })
    const afterRelevant = calls.length

    ctx.remote.$dispatch('settings/document-updated', ['llm-test-adapter', 1])
    await Promise.resolve()

    // Both surfaces re-read on their own namespace; an unrelated one moves
    // neither, so this rules out a blanket refresh on every settings write.
    expect(calls.length).toBe(afterRelevant)
  })

  it('re-reads both surfaces when the connection comes back', async () => {
    const { ctx, slots, calls } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => AgentPresetSectionInjected)()
    await section.load()
    const before = calls.length

    ctx.emit('connection/reset')

    // A reconnect can land on a host whose roster changed under the browser.
    await vi.waitFor(() => { expect(calls.length).toBe(before + 2) })
  })

  it('leaves the section alone until it has been opened once', async () => {
    const { ctx, slots, calls } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const before = calls.length

    ctx.remote.$dispatch('settings/document-updated', ['agent-presets', 1])
    await vi.waitFor(() => { expect(calls.length).toBeGreaterThan(before) })

    // Only the General row reloads: a section nobody opened has nothing to
    // converge, and reading the roster for it would be a wasted round trip.
    expect(calls.length - before).toBe(1)
  })

  it('registers the header label and drops it on disposal', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const conversation = declareConversation(slots)
    ctx.provide('conversation', {} as never)
    const sessions = sessionsDouble({ byId: {} })
    ctx.provide('sessions', sessions as never)
    ctx.provide('teamTasks', teamTasksDouble() as never)
    const fiber = ctx.plugin({ inject: [...inject, 'conversation', 'sessions', 'teamTasks'], apply })
    await fiber.await()

    const label = slots.entries('conversation.session.header.actions')[0]!
    expect(label.component).toBe(AgentPresetLabel)
    expect(label.options).toMatchObject({ id: 'agent-preset', order: -10 })
    await fiber.dispose()
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(slots.entries('settings.section')).toHaveLength(0)
    conversation()
  })

  it('folds a remote preset commit into the shared session row', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    declareConversation(slots)
    ctx.provide('conversation', {} as never)
    const state = {
      current: 's1',
      byId: { s1: { id: 's1', blank: true, agentPreset: 'standard' } },
    }
    ctx.provide('sessions', sessionsDouble(state) as never)
    ctx.provide('teamTasks', teamTasksDouble() as never)
    await ctx.plugin({ inject: [...inject, 'conversation', 'sessions', 'teamTasks'], apply }).await()

    ctx.remote.$dispatch('agent-preset/selected', ['s1', 'minimal'])

    expect(state.byId.s1.agentPreset).toBe('minimal')
  })

  it('gives the header label the same roster the General row reads', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    declareConversation(slots)
    ctx.provide('conversation', {} as never)
    ctx.provide('sessions', sessionsDouble({ byId: {} }) as never)
    ctx.provide('teamTasks', teamTasksDouble() as never)
    await ctx.plugin({ inject: [...inject, 'conversation', 'sessions', 'teamTasks'], apply }).await()
    const label = (slots.entries('conversation.session.header.actions')[0]!
      .inject as unknown as () => AgentPresetLabelInjected)()
    const row = (slots.entries('settings.general.item')[0]!
      .inject as unknown as () => AgentPresetRowInjected)()

    await label.load()

    // One roster behind both: the label resolves a name the settings row's own
    // load already fetched, rather than issuing a second read per session.
    expect(label.hooks.agentPresets).toBe(row.hooks.agentPreset)
    expect(label.hooks.agentPresets.getSnapshot().options).toEqual([{ id: 'standard', trust: 'system' }])
  })

  it('starts a Team draft carrying the creator preset from the section', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const conversation = declareConversation(slots)
    ctx.provide('conversation', {} as never)
    const sessions = sessionsDouble({ byId: {} })
    ctx.provide('sessions', sessions as never)
    const teamTasks = teamTasksDouble()
    ctx.provide('teamTasks', teamTasks as never)
    await ctx.plugin({ inject: [...inject, 'conversation', 'sessions', 'teamTasks'], apply }).await()
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => AgentPresetSectionInjected)()

    section.startCreatorDraft?.()

    expect(section.startCreatorDraft).toBeDefined()
    expect(teamTasks.starts).toEqual([{ agentPreset: 'cordis' }])
    expect(sessions.clear).toHaveBeenCalledOnce()
    conversation()
  })

  it('offers no creator draft while the conversation flow is absent', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    // No conversation scope mounted: the face omits the affordance and the
    // section hides its button rather than staging into nowhere.
    const section = (slots.entries('settings.section')[0]!.inject as unknown as () => AgentPresetSectionInjected)()
    expect(section.startCreatorDraft).toBeUndefined()
  })
})
