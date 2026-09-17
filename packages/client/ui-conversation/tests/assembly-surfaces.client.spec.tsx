// @vitest-environment jsdom
/** Conversation assembly acceptance independent of Tool presentation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@clocky/clocky-client-locale/client'
import type { ISession, SessionId, TeamTaskSelection } from '@clocky/clocky-client-runtime/client'
import type { PropsRenderSlots } from '@clocky/clocky-client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope } from '@clocky/clocky-client-test-runtime'
import { apply, inject } from '@clocky/clocky-client-ui-conversation/client'

usePinnedBrowserLanguages('zh-CN')

const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

type AppRootProps = PropsRenderSlots<'conversation' | 'details'>
function AppRoot({ renderSlot }: AppRootProps) {
  return <>{renderSlot('conversation', {})}</>
}

const LAYOUT_CHILDREN = {
  'conversation': { kind: 'single', scope: 'session-maybe' },
  'details': { kind: 'single', scope: 'session' },
} as const

async function bench(opts?: { blank?: boolean }) {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // The plugin injects both; these specs exercise no settings path.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
    snapshot: {
      nodes: [],
      ...(opts?.blank === true ? { blank: true, composerPhase: 'blank' as const } : {}),
    },
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
  await runtime.mount({ inject: [...inject], apply })
  return runtime
}

describe('resident composer', () => {
  it('starts a Team from the local task draft without opening its coordinator transcript', async () => {
    const coordinator = 'team-coordinator' as SessionId
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.sessions.add({
      id: coordinator,
      summary: { title: 'Coordinator', displayTitle: 'Coordinator', cwd: '/proj' },
      session: { loadOlder: vi.fn<ISession['loadOlder']>() },
    }, { current: false })
    const selection: TeamTaskSelection = {
      teamId: 'team-1' as TeamTaskSelection['teamId'],
      state: {} as TeamTaskSelection['state'],
      coordinatorSessionId: coordinator,
    }
    const start = vi.fn(async () => selection)
    runtime.teamTasks.stub('start', start)
    runtime.teamTasks.startDraft({ agentPreset: 'cordis' })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    const textarea = view.container.querySelector('textarea')!
    expect(textarea.disabled).toBe(false)
    expect(textarea.readOnly).toBe(false)

    fireEvent.change(textarea, { target: { value: 'Create the Team from this first input.' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        text: 'Create the Team from this first input.',
        agentPreset: 'cordis',
      }, expect.any(AbortSignal))
    })
    await waitFor(() => {
      expect(runtime.sessions.calls).toContainEqual({ method: 'refresh', args: [] })
      expect(runtime.sessions.calls).toContainEqual({ method: 'clear', args: [] })
      expect(runtime.sessions.calls).not.toContainEqual({ method: 'open', args: [coordinator] })
    })
    expect(runtime.workspaces.calls).toEqual([])
    await runtime.dispose()
  })

  it('keeps the no-session composer unavailable until a Team draft exists', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    const textarea = view.container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea!.disabled).toBe(true)
    expect(textarea!.placeholder).toBe('请从侧边栏新建任务')
    expect(textarea!.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(textarea!)
    fireEvent.keyDown(textarea!, { key: 'Enter' })
    expect(textarea!.value).toBe('')
    await runtime.dispose()
  })

  it('keeps the complete Hero tree mounted when the coordinator session appears', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.teamTasks.startDraft()
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    const root = view.container.querySelector('[data-phase="hero"]')!
    const scrollBody = view.container.querySelector('[data-conversation-scroll]')!
    const composerSeat = view.container.querySelector('[data-composer-seat]')!
    const textarea = view.container.querySelector('textarea')!
    expect(textarea.disabled).toBe(false)
    expect(textarea.readOnly).toBe(false)

    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj', blank: true },
      snapshot: { blank: true, composerPhase: 'blank' },
    })

    expect(view.container.querySelector('[data-phase="hero"]')).toBe(root)
    expect(view.container.querySelector('[data-conversation-scroll]')).toBe(scrollBody)
    expect(view.container.querySelector('[data-composer-seat]')).toBe(composerSeat)
    expect(view.container.querySelector('textarea')).toBe(textarea)
    expect(textarea.disabled).toBe(false)
    expect(textarea.readOnly).toBe(false)
    await runtime.dispose()
  })

  it('the textarea survives the blank→active conversion as the same DOM node', async () => {
    const runtime = await bench({ blank: true })
    const view = runtime.renderRoot()
    const hero = view.container.querySelector('textarea')
    expect(hero).not.toBeNull()
    expect(hero!.disabled).toBe(false)

    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.blank = false
      draft.composerPhase = 'active'
    })
    expect(view.container.querySelector('textarea')).toBe(hero)
    await runtime.dispose()
  })
})

describe('prompt rejection through the assembled composer', () => {
  it('renders the promptError alert strip and keeps the draft in the machine', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
    // The plugin injects both; these specs exercise no settings path.
    runtime.provide('remote', { $on: () => () => {} })
    runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.provide('locale', locale)
    runtime.slots.installLocale(locale)
    const prompt = vi.fn<ISession['prompt']>(async () => ({
      ok: false, error: { code: 'agent-busy', message: 'prompt rejected before acceptance', details: { reason: 'busy' } },
    }))
    await runtime.sessions.add({
      id: SID,
      summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
      session: { prompt, loadOlder: vi.fn<ISession['loadOlder']>() },
    })
    await runtime.root.declare(LAYOUT_CHILDREN, AppRoot)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    const composer = view.container.querySelector('textarea')!
    fireEvent.change(composer, { target: { value: 'do not lose this' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    await waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })

    await runtime.sessions.updateSnapshot(SID, (draft) => {
      draft.promptError = {
        op: 'send',
        error: { code: 'agent-busy', message: 'prompt rejected before acceptance', details: { reason: 'busy' } },
      }
    })
    const alert = await view.findByRole('alert')
    expect(alert.textContent).toContain('prompt rejected before acceptance (agent-busy)')
    await waitFor(() => {
      expect((view.container.querySelector('textarea'))!.value).toBe('do not lose this')
    })
    await runtime.dispose()
  })
})

describe('title projection across assembled surfaces', () => {
  it('one summary update re-labels the current-session title', async () => {
    const runtime = await bench()
    const view = runtime.renderRoot()
    expect(view.getByText('S')).toBeTruthy()

    await runtime.sessions.updateSummary(SID, { displayTitle: '修订标题', title: '修订标题' })
    await waitFor(() => {
      expect(view.getByText('修订标题')).toBeTruthy()
    })
    expect(view.queryByText('S')).toBeNull()
    await runtime.dispose()
  })
})
