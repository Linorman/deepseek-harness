/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CommandPalette, ConnectionBanner, Kbd, Modal } from '@clocky/clocky-client-ui-primitives'
import type { PaletteItem } from '@clocky/clocky-client-ui-primitives'
import { AmbientBackdrop } from '@clocky/clocky-client-ui-viz'
import type { CommandItem } from './commands.ts'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@clocky/clocky-client-ui-slots'
import { SessionStage } from './SessionStage.tsx'
import { WORKSPACE_NAVIGATION_EVENT } from './navigation.ts'
import { computeColumns, computePane, PANE_MAX, PANE_MIN, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay' | 'team.workspace' | 'simulation.workspace'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>
  & {
    closeSession: () => void
    showTeams: () => void
    retryAuthorization?: (() => void) | undefined
    /** Current palette sections from every registered provider. */
    readCommands?: (() => readonly { id: string; label: string; items: readonly CommandItem[] }[]) | undefined
    /** Registered shortcuts with display text resolved. */
    readShortcuts?: (() => readonly { id: string; chord: string; label: string; group: string }[]) | undefined
  }

/**
 * Key caps for a canonical chord.
 * @param chord - chord such as `mod+k`.
 * @param mac - whether `mod` is Command.
 * @returns one label per key.
 */
export function chordKeys(chord: string, mac: boolean): string[] {
  return chord.split('+').map((part) => {
    if (part === 'mod') return mac ? '⌘' : 'Ctrl'
    if (part === 'alt') return mac ? '⌥' : 'Alt'
    if (part === 'shift') return mac ? '⇧' : 'Shift'
    return part.length === 1 ? part.toUpperCase() : part
  })
}

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode; hidden: boolean }) {
  return <div className={css.detailsCol} hidden={props.hidden}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: {
  side: 'sidebar' | 'details' | 'pane'
  left: number
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
  /** Keyboard resizing for handles that own a focusable separator. */
  keyboard?: { label: string; value: number; min: number; max: number; onStep: (dx: number) => void } | undefined
}) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  const keyboard = props.keyboard
  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      {...keyboard === undefined ? {} : {
        role: 'separator',
        tabIndex: 0,
        'aria-orientation': 'vertical' as const,
        'aria-label': keyboard.label,
        'aria-valuenow': Math.round(keyboard.value),
        'aria-valuemin': keyboard.min,
        'aria-valuemax': keyboard.max,
        onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
          const step = event.shiftKey ? 64 : 16
          // dx follows pointer direction: moving the handle left is negative.
          if (event.key === 'ArrowLeft') keyboard.onStep(-step)
          else if (event.key === 'ArrowRight') keyboard.onStep(step)
          else return
          event.preventDefault()
        },
      }}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  useTeamTasks,
  useConnection,
  closeSession,
  showTeams,
  retryAuthorization,
  readCommands,
  readShortcuts,
  t,
  actions,
  renderSlot,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const connection = useConnection?.(s => s.state) ?? 'connected'
  const selectedTeam = useTeamTasks?.(s => s.current)
  const sessionId = useSessions(s => s.current)
  const sessionContext = useTeamTasks?.((s) => {
    const selected = s.selected
    if (selected === undefined) return undefined
    const objective = selected.state.metadata?.kind === 'available'
      ? selected.state.metadata.goal.objective : selected.state.goal.objective.text
    const coordinator = selected.state.coordinator
    return coordinator.kind === 'bound' && coordinator.binding.sessionId === sessionId
      ? `${objective} / ${coordinator.name.text}` : objective
  })
  const coordinatorConversation = useTeamTasks?.(state => state.selected !== undefined
    && state.current === state.selected.teamId && sessionId !== undefined && state.selected.coordinatorSessionId === sessionId
    && state.selected.state.readAccess === 'member' && state.selected.state.executionManagement !== 'simulation-managed'
    && !['completed', 'failed', 'cancelled'].includes(state.selected.state.team.phase)) ?? false
  const simulation = panels.workspace === 'simulation'
  const [requestedTeam, setRequestedTeam] = useState(() => new URLSearchParams(window.location.search).has('team'))
  const inspecting = (selectedTeam !== undefined || requestedTeam) && !simulation
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const restore = () => {
      const route = new URLSearchParams(window.location.search)
      setRequestedTeam(route.has('team'))
      actions.showWorkspace(route.get('workspace') === 'simulation' ? 'simulation' : 'team')
    }
    window.addEventListener('popstate', restore)
    window.addEventListener(WORKSPACE_NAVIGATION_EVENT, restore)
    return () => {
      window.removeEventListener('popstate', restore)
      window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, restore)
    }
  }, [actions])
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const detailsPreference = detailsSession === undefined ? 0 : panels.details
  // A Team page with an open Session shows the conversation as a pane inside
  // the center column; the details column then lives inside that pane.
  const paneOpen = inspecting && sessionId !== undefined
  const cols = computeColumns(viewport, sidebarPreference, paneOpen ? 0 : detailsPreference)
  const paneCols = paneOpen ? computePane(cols.center, panels.pane, detailsPreference, panels.paneExpanded) : undefined
  const detailsWidth = paneCols?.details ?? cols.details
  const colsRef = useRef(cols)
  colsRef.current = cols

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const paneBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const detailsWidthRef = useRef(detailsWidth)
  detailsWidthRef.current = detailsWidth
  const paneWidthRef = useRef(paneCols?.pane ?? 0)
  paneWidthRef.current = paneCols?.pane ?? 0
  const onDetailsStart = useCallback(() => { detailsBase.current = detailsWidthRef.current; setDragging(true) }, [])
  const onPaneStart = useCallback(() => { paneBase.current = paneWidthRef.current; setDragging(true) }, [])
  const onPaneDrag = useCallback((dx: number) => { actions.setPane(paneBase.current - dx) }, [actions])
  const closePane = useCallback(() => {
    actions.restorePane()
    closeSession()
  }, [actions, closeSession])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr)` }}
      data-team-workspace={inspecting || undefined}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={detailsWidth === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      <div className={css.sidebarCol} data-clocky-navigation>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). */}
        {renderSlot('sidebar', {
          workspace: panels.workspace,
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <div
          className={css.centerCol}
          data-pane={paneCols?.mode}
          style={paneCols?.mode === 'split' ? { gridTemplateColumns: `minmax(0, 1fr) ${String(paneCols.pane)}px` } : undefined}
        >
          {/* Each workspace stage carries one L0 backdrop tinted by its mode;
              the hidden stage's backdrop pauses with it. */}
          <div className={css.productStage} hidden={simulation} data-behind-pane={paneCols?.mode === 'expanded' || paneCols?.mode === 'sheet' || undefined}>
            {!simulation && <AmbientBackdrop mode="team" />}
            {renderSlot('team.workspace', {})}
          </div>
          <div className={css.productStage} hidden={!simulation} data-simulation-stage>
            {simulation && <AmbientBackdrop mode="simulation" />}
            {renderSlot('simulation.workspace', { visible: simulation }, { fallback: simulation
              ? <section className={css.unavailable} role="region" aria-label={t('simulationUnavailable')}>
                <p>{t('simulationUnavailable')}</p><button type="button" onClick={showTeams}>{t('backToTeams')}</button>
              </section> : null })}
          </div>
          <SessionStage inspecting={inspecting} visible={!simulation && (!inspecting || sessionId !== undefined)}
            mode={paneCols?.mode}
            title={t(!inspecting && sessionId === undefined ? 'newTeam' : coordinatorConversation ? 'coordinator' : 'session')}
            context={sessionContext} closeLabel={t('close')} expandLabel={t('expand')} restoreLabel={t('restore')}
            close={closePane} toggleExpanded={() => { actions.togglePaneExpanded() }}>
            <div className={css.sessionColumns} data-session-columns style={{ gridTemplateColumns: `minmax(0, 1fr) ${String(detailsWidth)}px` }}>
              <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
              <DetailsColumn hidden={detailsWidth === 0}>{renderSlot('details', {})}</DetailsColumn>
            </div>
          </SessionStage>
        </div>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        <ConnectionBanner state={connection} onRetry={retryAuthorization} labels={{
          reconnecting: t('connection.reconnecting'),
          unauthorized: t('connection.unauthorized'),
          unauthorizedHint: t('connection.unauthorizedHint'),
          retry: t('connection.retry'),
        }} />
        {renderSlot('shell.overlay', {})}
      </div>
      <ShellOverlays overlay={panels.overlay} close={() => { actions.setOverlay('none') }}
        readCommands={readCommands} readShortcuts={readShortcuts} t={t} />
      {/* The collapsed rail is fixed-width: no resize handle while closed. */}
      {!sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {(!inspecting || paneCols !== undefined) && detailsWidth > 0 && paneCols?.mode !== 'sheet'
        && <DragHandle side="details" left={viewport - detailsWidth} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
      {paneCols?.mode === 'split' && (
        <DragHandle side="pane" left={cols.sidebar + paneCols.team} onStart={onPaneStart} onDrag={onPaneDrag} onEnd={onDragEnd}
          keyboard={{ label: t('resizePane'), value: paneCols.pane, min: PANE_MIN, max: PANE_MAX,
            onStep: (dx) => { actions.setPane(paneCols.pane - dx) } }} />
      )}
    </div>
  )
}

/** The command palette and shortcut overlay, read from the shell registries when opened. */
function ShellOverlays({ overlay, close, readCommands, readShortcuts, t }: {
  overlay: 'none' | 'palette' | 'shortcuts'
  close: () => void
  readCommands: AppFrameProps['readCommands']
  readShortcuts: AppFrameProps['readShortcuts']
  t: AppFrameProps['t']
}) {
  // The palette closes after a selection; run the command afterwards so a
  // command that opens another overlay is not undone by that close.
  const pending = useRef<(() => void) | undefined>(undefined)
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const sections = overlay === 'palette' ? readCommands?.() ?? [] : []
  const runs = new Map<string, () => void>()
  const paletteSections = sections.map(section => ({
    id: section.id,
    label: section.label,
    items: section.items.map((item): PaletteItem => {
      const id = `${section.id}:${item.id}`
      runs.set(id, item.run)
      return { id, label: item.label, hint: item.hint, keywords: item.keywords, shortcut: item.shortcut }
    }),
  }))
  const shortcuts = overlay === 'shortcuts' ? readShortcuts?.() ?? [] : []
  const groups = [...new Set(shortcuts.map(item => item.group))]
  return <>
    <CommandPalette open={overlay === 'palette'} sections={paletteSections}
      onClose={() => { const run = pending.current; pending.current = undefined; close(); run?.() }}
      onSelect={(item) => { pending.current = runs.get(item.id) }}
      labels={{ title: t('palette.title'), placeholder: t('palette.placeholder'), empty: t('palette.empty') }} />
    <Modal open={overlay === 'shortcuts'} onClose={close} title={t('shortcuts.title')} closeLabel={t('shortcuts.close')}>
      {groups.map(group => <section key={group} className={css.shortcutGroup} aria-label={group}>
        <h3>{group}</h3>
        <dl>{shortcuts.filter(item => item.group === group).map(item => <div key={item.id}>
          <dt>{item.label}</dt><dd><Kbd keys={chordKeys(item.chord, mac)} /></dd>
        </div>)}</dl>
      </section>)}
    </Modal>
  </>
}
