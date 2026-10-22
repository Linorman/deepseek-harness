// @vitest-environment jsdom
/**
 * AppFrame interaction spec under the four-share props form: real layout
 * store instance (createLayoutStore().create() — the test-sanctioned engine
 * path), a recording renderSlot stub, and a render-prop SessionProvider stub
 * (the real one is framework-wired to the renderer host; its own behavior is
 * ui-renderer's spec territory). Drag sequences (pointer capture + rAF flush),
 * concession response to viewport change, and details staying mounted at
 * zero width are the preserved behavior assertions. jsdom has no layout
 * engine, so the frame width comes from a mocked getBoundingClientRect and
 * resizes are driven through the ResizeObserver stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AppFrame, chordKeys } from '@clocky/clocky-client-ui-layout/src/client/AppFrame.tsx'
import type { AppFrameProps } from '@clocky/clocky-client-ui-layout/src/client/AppFrame.tsx'
import { SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, CENTER_MIN, PANE_DEFAULT } from '@clocky/clocky-client-ui-layout/src/client/columns.ts'
import { createLayoutStore } from '@clocky/clocky-client-ui-layout/src/client/stores.ts'
import type {
  SessionId, SessionListState, WorkspaceListState,
} from '@clocky/clocky-client-runtime/client'

// Session selection controls for the SessionProvider and useSessions stubs.
const selectedSession = { current: 's-test' as SessionId | undefined }
const selectedSessionBlank = { current: false }
const baselinesReady = { current: true }
const connectionState = { current: undefined as undefined | 'connecting' | 'connected' | 'reconnecting' | 'unauthorized' }
const selectedTeamId = { current: undefined as string | undefined }
const commandFeed = {
  sections: [] as ReturnType<NonNullable<AppFrameProps['readCommands']>>,
  shortcuts: [] as ReturnType<NonNullable<AppFrameProps['readShortcuts']>>,
}

// Render-prop contract stub fed through the standard seat prop (the renderer
// injects the real one in production): session mode runs children(id), empty
// mode runs the empty branch — the frame must work against exactly this
// shape. Typed as the seat's own component type so the branded sessionId
// parameter stays contract-checked.
const SessionProviderStub: AppFrameProps['SessionProvider'] = ({ children, empty }) =>
  selectedSession.current === undefined ? <>{empty?.() ?? null}</> : <>{children(selectedSession.current)}</>


/** Observer stub: captures the callback so tests can fire resizes manually. */
let fireResize: (() => void) | null = null
class ResizeObserverStub {
  #cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.#cb = cb }
  observe(): void { fireResize = () => { this.#cb([], this) } }
  unobserve(): void {}
  disconnect(): void { fireResize = null }
}

let frameWidth = 1920

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S { return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot)) }
}

function mountFrame() {
  window.innerWidth = frameWidth // first-render viewport source before the observer fires
  const instance = createLayoutStore().create()
  const slotCalls: { key: string; props: unknown }[] = []
  const renderSlot = ((key: string, owner: object) => {
    slotCalls.push({ key, props: owner })
    if (key === 'sidebar') return <div data-testid="sidebar-content" />
    if (key === 'conversation') return <div data-testid="center-content" />
    if (key === 'details') return <div data-testid="details-content" />
    if (key === 'conversation.empty') return <div data-testid="empty-content" />
    return <div data-testid="other-content" />
  }) as AppFrameProps['renderSlot']
  const useSessions = ((sel: (s: SessionListState) => unknown) => {
    const current = selectedSession.current
    const sessionState = {
      ids: current === undefined ? [] : [current],
      byId: current === undefined
        ? {}
        : { [current]: { id: current, displayTitle: 'Test', running: false, blank: selectedSessionBlank.current, updatedAt: 1 } },
      current,
      phase: 'ready',
    } as SessionListState
    return sel(sessionState)
  }) as never
  const workspaceState: WorkspaceListState = {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: baselinesReady.current, recentWorkspaceId: undefined,
  }
  const element = () => (
    <AppFrame
      t={((key: string) => key)}
      showTeams={() => { instance.actions.showWorkspace('team') }}
      closeSession={() => { selectedSession.current = undefined }}
      useStore={hookOf(instance)}
      actions={instance.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useWorkspaces={((sel: (s: WorkspaceListState) => unknown) => sel(workspaceState)) as never}
      SessionProvider={SessionProviderStub}
      readCommands={() => commandFeed.sections}
      readShortcuts={() => commandFeed.shortcuts}
      {...selectedTeamId.current === undefined ? {} : {
        useTeamTasks: ((sel: (s: { current: string; selected: undefined }) => unknown) =>
          sel({ current: selectedTeamId.current!, selected: undefined })) as never,
      }}
      {...connectionState.current === undefined ? {} : {
        useConnection: ((sel: (s: { state: typeof connectionState.current }) => unknown) =>
          sel({ state: connectionState.current })) as never,
      }}
    />
  )
  const utils = render(element())
  const frame = utils.container.firstElementChild as HTMLElement
  return { instance, frame, slotCalls, rerenderFrame: () => { utils.rerender(element()) }, ...utils }
}

function tracks(frame: HTMLElement): number[] {
  const sessionColumns = frame.querySelector<HTMLElement>('[data-session-columns]')!
  const details = / (\d+)px$/.exec(sessionColumns.style.gridTemplateColumns)?.[1]
  const m = /^(\d+)px minmax\(0, 1fr\) (\d+)px$/.exec(`${frame.style.gridTemplateColumns} ${details}px`)
  if (m === null) throw new Error(`unexpected template: ${frame.style.gridTemplateColumns}`)
  return [Number(m[1]), Number(m[2])]
}

function drag(handle: Element, fromX: number, toX: number): void {
  const down = new PointerEvent('pointerdown', { pointerId: 1, clientX: fromX, bubbles: true })
  const move = new PointerEvent('pointermove', { pointerId: 1, clientX: toX, bubbles: true })
  const up = new PointerEvent('pointerup', { pointerId: 1, clientX: toX, bubbles: true })
  act(() => { handle.dispatchEvent(down) })
  act(() => { handle.dispatchEvent(move); vi.advanceTimersByTime(20) })
  act(() => { handle.dispatchEvent(up) })
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  frameWidth = 1920
  selectedSession.current = 's-test' as SessionId
  selectedSessionBlank.current = false
  baselinesReady.current = true
  connectionState.current = undefined
  selectedTeamId.current = undefined
  commandFeed.sections = []
  commandFeed.shortcuts = []
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => { cb(0) }, 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (h: number) => { clearTimeout(h) })
  window.innerWidth = frameWidth
  Element.prototype.getBoundingClientRect = function () {
    return { width: frameWidth, height: 1080, top: 0, left: 0, right: frameWidth, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }
  }
  // jsdom lacks pointer capture: emulate per-element so hasPointerCapture gates pass.
  const captured = new WeakSet<Element>()
  Element.prototype.setPointerCapture = function () { captured.add(this) }
  Element.prototype.releasePointerCapture = function () { captured.delete(this) }
  Element.prototype.hasPointerCapture = function () { return captured.has(this) }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AppFrame', () => {
  it('keeps a requested Team failure reachable while no Team or Session has loaded', () => {
    selectedSession.current = undefined
    window.history.replaceState(null, '', '/?team=unavailable')
    const view = mountFrame()
    expect(view.queryByRole('dialog')).toBeNull()
    act(() => {
      window.history.pushState(null, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(view.getByRole('region', { name: 'newTeam' })).toBeDefined()
  })

  it('renders three tracks from store state', () => {
    const { frame } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
  })

  it('renders the session pair with empty owner shares (sessionId is framework-standard)', () => {
    const { slotCalls, getByTestId } = mountFrame()
    expect(getByTestId('center-content')).toBeTruthy()
    expect(getByTestId('details-content')).toBeTruthy()
    const keys = slotCalls.map(c => c.key)
    expect(keys).toContain('conversation')
    expect(keys).toContain('details')
    expect(keys).not.toContain('conversation.empty')
    expect(slotCalls.find(c => c.key === 'conversation')!.props).toEqual({})
    expect(slotCalls.find(c => c.key === 'details')!.props).toEqual({})
  })

  it('keeps the conversation slot mounted while no session is current', () => {
    // No current session: the session-maybe conversation shell owns the New
    // Session view itself — the center column renders it unconditionally.
    selectedSession.current = undefined
    const { slotCalls, getByTestId } = mountFrame()
    expect(getByTestId('center-content')).toBeTruthy()
    expect(slotCalls.map(c => c.key)).toContain('conversation')
  })

  it('renders both column occupants before baselines settle (no loading gate)', () => {
    // No loading gate: a bare loading status reads worse than the shell's own
    // pending rendering — both occupants mount from first paint.
    baselinesReady.current = false
    const { slotCalls } = mountFrame()
    expect(slotCalls.map(c => c.key)).toContain('conversation')
    expect(slotCalls.map(c => c.key)).toContain('details')
  })

  it('ignores unselected states and closes only when the Session id changes', () => {
    const { frame, instance, rerenderFrame } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])

    act(() => { instance.actions.openDetails() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 360])

    selectedSession.current = 's-next' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])

    act(() => { instance.actions.openDetails() })
    selectedSession.current = 's-blank' as SessionId
    selectedSessionBlank.current = true
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
    expect(instance.getSnapshot().details).toBe(360)

    selectedSession.current = 's-next' as SessionId
    selectedSessionBlank.current = false
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 360])

    selectedSession.current = undefined
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
    selectedSession.current = 's-test' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
  })

  it('keeps details closed when the first Session materializes', () => {
    selectedSession.current = undefined
    const { frame, instance, rerenderFrame } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
    expect(instance.getSnapshot().details).toBe(0)

    selectedSession.current = 's-first' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
  })

  it('sidebar slot receives live concession output as owner props', () => {
    const { slotCalls } = mountFrame()
    expect(slotCalls.find(c => c.key === 'sidebar')!.props).toEqual({ workspace: 'team', collapsed: false, width: SIDEBAR_DEFAULT })
  })

  it('sidebar drag widens through rAF-batched pointer moves', () => {
    const { frame } = mountFrame()
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[0]!, SIDEBAR_DEFAULT, 350)
    expect(tracks(frame)[0]).toBe(350)
  })

  it('details drag widens leftward (negative dx grows the panel)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[1]!, 1560, 1500)
    expect(tracks(frame)[1]).toBe(420)
  })

  it('drag base is the rendered (concession-clamped) width, not the preference', () => {
    frameWidth = SIDEBAR_DEFAULT + CENTER_MIN + 330 // step-2 squeeze: details renders 330 while preference is 360
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 330])
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[1]!, 920, 930) // shrink by 10 from the rendered width
    expect(instance.getSnapshot().details).toBe(320)
  })

  it('details column stays mounted at zero width', () => {
    const { frame, getByTestId } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
    expect(getByTestId('details-content')).toBeTruthy()
    expect(frame.hasAttribute('data-details-collapsed')).toBe(true)
    expect(getByTestId('details-content').closest('[hidden]')).not.toBeNull()
  })

  it('closed sidebar keeps its compact rail with mounted slot content and collapsed owner props', () => {
    const { frame, instance, slotCalls, getByTestId } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    expect(getByTestId('sidebar-content')).toBeTruthy()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    const lastSidebarCall = slotCalls.filter(c => c.key === 'sidebar').at(-1)!
    expect(lastSidebarCall.props).toEqual({ workspace: 'team', collapsed: true, width: SIDEBAR_COLLAPSED })
  })

  it('viewport shrink triggers the concession chain via ResizeObserver', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    frameWidth = SIDEBAR_DEFAULT + CENTER_MIN + 330
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 330])
    frameWidth = 1920
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 360])
  })

  it('drag handles disappear for collapsed columns', () => {
    const { frame, instance } = mountFrame()
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.openDetails() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(2)
    act(() => { instance.actions.closeDetails() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })
})

describe('AppFrame — narrow-viewport auto-collapse', () => {
  it('mounts collapsed below the breakpoint with no sidebar handle', () => {
    frameWidth = 980
    const { frame, slotCalls } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    expect(slotCalls.filter(c => c.key === 'sidebar').at(-1)!.props).toEqual({ workspace: 'team', collapsed: true, width: SIDEBAR_COLLAPSED })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })

  it('narrow toggle re-expands over the squeezed center and back', () => {
    frameWidth = 980
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
  })

  it('opens a re-expanded sidebar as an overlay drawer below the drawer breakpoint and closes it on scrim or Escape', () => {
    frameWidth = 390
    const { frame, instance, slotCalls } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    // The grid keeps the rail, so the center keeps its width; the sidebar floats above a scrim.
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    const column = frame.querySelector('[data-clocky-navigation]')!
    expect(column.hasAttribute('data-drawer')).toBe(true)
    expect(slotCalls.filter(c => c.key === 'sidebar').at(-1)!.props).toEqual({ workspace: 'team', collapsed: false, width: SIDEBAR_DEFAULT })
    fireEvent.click(frame.querySelector('[data-sidebar-scrim]')!)
    expect(column.hasAttribute('data-drawer')).toBe(false)
    act(() => { instance.actions.toggleSidebar() })
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(frame.querySelector('[data-sidebar-scrim]')).toBeNull()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
  })

  it('keeps a re-expanded sidebar in the row above the drawer breakpoint', () => {
    frameWidth = 700
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.querySelector('[data-clocky-navigation]')!.hasAttribute('data-drawer')).toBe(false)
    expect(frame.querySelector('[data-sidebar-scrim]')).toBeNull()
  })

  it('a wide-closed preference re-expands at the contract default while narrow', () => {
    frameWidth = 1920
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() }) // close while wide: preference 0
    frameWidth = 980
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
    expect(instance.getSnapshot().sidebar).toBe(0) // preference untouched
  })

  it('shrinking across the breakpoint auto-collapses; re-widening restores the drag width', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.setSidebar(400) })
    frameWidth = 980
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    frameWidth = 1920
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([400, 0])
  })
})

describe('AppFrame — guard branches', () => {
  it('pointer moves without capture are ignored (no width write)', () => {
    const { frame, instance } = mountFrame()
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    const before = instance.getSnapshot().sidebar
    // Move + up without a preceding pointerdown: hasPointerCapture is false.
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 500, bubbles: true }))
      vi.advanceTimersByTime(20)
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: 500, bubbles: true }))
    })
    expect(instance.getSnapshot().sidebar).toBe(before)
  })

  it('two moves inside one frame coalesce through the pending rAF', () => {
    const { frame, instance } = mountFrame()
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: SIDEBAR_DEFAULT, bubbles: true })) })
    act(() => {
      // Two moves before the frame flushes: the second must ride the pending
      // rAF (frame.current ??= guard), and the flush sees the latest x.
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 320, bubbles: true }))
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 340, bubbles: true }))
      vi.advanceTimersByTime(20)
    })
    act(() => { handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 340, bubbles: true })) })
    expect(instance.getSnapshot().sidebar).toBe(340)
  })

  it('pointerup with a pending rAF cancels it and commits the final position', () => {
    const { frame, instance } = mountFrame()
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: SIDEBAR_DEFAULT, bubbles: true })) })
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 360, bubbles: true }))
      // No timer advance: the rAF is still pending when pointerup arrives.
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 360, bubbles: true }))
    })
    expect(instance.getSnapshot().sidebar).toBe(360)
  })

  it('zero-width resize reports are ignored (display:none window)', () => {
    const { frame } = mountFrame()
    frameWidth = 0
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    // Track template still reflects the last non-zero viewport.
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
  })
})

describe('AppFrame — unmount with an in-flight resize frame', () => {
  it('cancels the pending rAF on unmount (no post-unmount setState)', () => {
    const { unmount } = mountFrame()
    frameWidth = 800
    act(() => { fireResize?.() }) // rAF scheduled, NOT flushed
    unmount()
    // Flushing after unmount must be a no-op (the frame was cancelled).
    expect(() => { vi.advanceTimersByTime(20) }).not.toThrow()
  })

  it('double resize inside one frame rides the pending rAF (??= guard)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    frameWidth = SIDEBAR_DEFAULT + CENTER_MIN + 330
    act(() => { fireResize?.(); fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 330])
  })
})

describe('AppFrame connection banner', () => {
  it('stays quiet while connected and without a connection feed', () => {
    const { queryByRole } = mountFrame()
    expect(queryByRole('alert')).toBeNull()
    expect(queryByRole('status')).toBeNull()
  })

  it('explains an expired credential in the shell overlay instead of inline transport text', () => {
    connectionState.current = 'unauthorized'
    const { getByRole, frame } = mountFrame()
    const alert = getByRole('alert')
    expect(frame.querySelector('[data-shell-overlay]')?.contains(alert)).toBe(true)
    expect(alert.textContent).toContain('connection.unauthorized')
    expect(alert.textContent).toContain('connection.unauthorizedHint')
  })

  it('reports reconnection as a status', () => {
    connectionState.current = 'reconnecting'
    const { getByRole } = mountFrame()
    expect(getByRole('status').textContent).toBe('connection.reconnecting')
  })
})

describe('AppFrame conversation pane', () => {
  it('opens the Session beside the Team page instead of a modal, keeping the page visible at 1280px', () => {
    frameWidth = 1280
    selectedTeamId.current = 'team-1'
    const { frame, getByRole } = mountFrame()
    const center = frame.querySelector<HTMLElement>('[data-pane]')!
    expect(center.dataset.pane).toBe('split')
    expect(center.style.gridTemplateColumns).toBe(`minmax(0, 1fr) ${String(PANE_DEFAULT)}px`)
    expect(frame.querySelector('dialog')).toBeNull()
    const pane = getByRole('region', { name: 'session' })
    expect(pane.getAttribute('data-conversation-pane')).toBe('split')
    expect(frame.querySelector('[data-behind-pane]')).toBeNull()
  })

  it('resizes the pane from its keyboard separator and expands across the center column', () => {
    frameWidth = 1600
    selectedTeamId.current = 'team-1'
    const { frame, getByRole, instance, rerenderFrame } = mountFrame()
    const separator = getByRole('separator', { name: 'resizePane' })
    act(() => { separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(instance.store.getSnapshot().pane).toBe(PANE_DEFAULT + 16)
    act(() => { getByRole('button', { name: 'expand' }).click() })
    rerenderFrame()
    expect(frame.querySelector<HTMLElement>('[data-pane]')!.dataset.pane).toBe('expanded')
    expect(frame.querySelector('[data-behind-pane]')).not.toBeNull()
    act(() => { getByRole('button', { name: 'close' }).click() })
    expect(instance.store.getSnapshot().paneExpanded).toBe(false)
  })

  it('presents a sheet on narrow viewports', () => {
    frameWidth = 900
    selectedTeamId.current = 'team-1'
    const { frame } = mountFrame()
    expect(frame.querySelector<HTMLElement>('[data-pane]')!.dataset.pane).toBe('sheet')
    expect(frame.querySelector('[role="separator"]')).toBeNull()
  })
})

describe('AppFrame command palette and shortcut overlay', () => {
  beforeEach(() => {
    // jsdom has no layout; the palette keeps its active row in view.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('lists provider commands, runs the chosen one after closing, and returns to no overlay', () => {
    const order: string[] = []
    commandFeed.sections = [{ id: 'teams', label: 'Teams', items: [
      { id: 'a', label: 'Alpha review', run: () => { order.push('run') } },
      { id: 'b', label: 'Beta cleanup', run: vi.fn() },
    ] }]
    const { instance, getByRole, queryByRole } = mountFrame()
    act(() => { instance.actions.setOverlay('palette') })
    const input = getByRole('combobox', { name: 'palette.title' })
    expect(getByRole('option', { name: /Alpha review/ })).toBeTruthy()
    instance.store.subscribe(() => { order.push(instance.store.getSnapshot().overlay) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(order).toEqual(['none', 'run'])
    expect(queryByRole('combobox')).toBeNull()
  })

  it('groups registered shortcuts with platform key caps', () => {
    commandFeed.shortcuts = [
      { id: 'layout.palette', chord: 'mod+k', label: 'Open palette', group: 'Shell' },
      { id: 'team.inbox', chord: 'g', label: 'Inbox', group: 'Team' },
    ]
    const { instance, getByRole } = mountFrame()
    act(() => { instance.actions.setOverlay('shortcuts') })
    const dialog = getByRole('dialog', { name: 'shortcuts.title' })
    expect([...dialog.querySelectorAll('section')].map(section => section.getAttribute('aria-label'))).toEqual(['Shell', 'Team'])
    expect(dialog.textContent).toContain('Open palette')
    expect(chordKeys('mod+shift+k', true)).toEqual(['⌘', '⇧', 'K'])
    expect(chordKeys('mod+k', false)).toEqual(['Ctrl', 'K'])
  })
})
