/** World workspace stage and its non-modal inspector dock: heading focus on open, Escape returns to the row, `[`/`]` switch sections. */
import { useEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { IconButton, IconCloseOutline16 } from '@clocky/clocky-client-ui-primitives'
import { prefersReducedMotion, tokenDuration, useSlidingIndicator } from '@clocky/clocky-client-ui-viz'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** Remembered wide-screen inspector width; the handle shows only where the layout allows widening (≥1440px content). */
export interface InspectorSizing {
  readonly width?: number | undefined
  readonly maxWidth: number
  readonly resize: (width: number) => void
}
const MIN_WIDTH = 360

/**
 * Module body: the collection keeps the page scroll and the dock beside it sticks below the run command band with its own
 * scroll. Below 880px of module width the dock overlays the collection in the same cell, so closing it returns to the
 * collection exactly where it was.
 * @param props.detail - Whether an inspector dock is open.
 * @param props.children - Collection pane and optional dock.
 * @returns the stage element.
 */
export function WorkspaceStage({ detail, children }: { detail: boolean; children: ReactNode }) {
  return <div className={css.moduleBody} data-stage data-detail={detail || undefined}>{children}</div>
}

/**
 * Inspector dock shared by every World module.
 * @param props.title - Heading text; focus lands here on open.
 * @param props.identity - Changes when another object is selected (content cross-fades instead of sliding again).
 * @param props.sections - Optional section tabs with the current id.
 * @param props.close - Close and restore focus to the originating row.
 * @param props.sizing - Optional drag/keyboard resize between 360px and the configured maximum.
 * @returns aside with header, optional tabs and body.
 */
export function InspectorDock({ title, identity, eyebrow, sections, close, children, t, actions, sizing }: {
  title: ReactNode
  identity: string
  eyebrow?: ReactNode
  sections?: { readonly items: readonly { readonly id: string; readonly label: string }[]
    readonly current: string
    readonly select: (id: string) => void } | undefined
  close: () => void
  children: ReactNode
  actions?: ReactNode
  sizing?: InspectorSizing | undefined
  t: WorldT
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const dock = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const exit = useRef<Animation>()
  const opened = useRef(false)
  const section = useRef({ identity, current: sections?.current })
  const indicator = useSlidingIndicator(tabs, '[aria-current="true"]', sections?.current)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [identity])
  useEffect(() => { opened.current = true }, [])
  // Another selection supersedes a pending exit, so its delayed close can never dismiss the new object.
  useEffect(() => () => { exit.current?.cancel(); exit.current = undefined }, [identity])
  useEffect(() => {
    // M3: a section change within one object eases the body in from the direction of travel; a new object only cross-fades.
    const previous = section.current
    section.current = { identity, current: sections?.current }
    const element = body.current
    if (previous.identity !== identity || previous.current === sections?.current || sections === undefined
      || element === null || typeof element.animate !== 'function') return
    const order = sections.items.map(item => item.id)
    const offset = order.indexOf(sections.current) >= order.indexOf(previous.current ?? '') ? 4 : -4
    const reduced = prefersReducedMotion()
    element.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: `translateY(${String(offset)}px)` }, { opacity: 1, transform: 'none' }],
    { duration: tokenDuration(element, reduced ? '--clocky-duration-fade' : '--clocky-duration-fast', 140), easing: 'cubic-bezier(0.2, 0, 0, 1)' })
  }, [identity, sections])
  /** M4: the dock eases toward its edge before the close commits; reduced motion and missing WAAPI close at once. */
  const dismiss = () => {
    const element = dock.current
    if (exit.current !== undefined) return
    if (element === null || typeof element.animate !== 'function' || prefersReducedMotion()) { close(); return }
    const animation = element.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(8px)' }],
      { duration: tokenDuration(element, '--clocky-duration-fast', 140), easing: 'cubic-bezier(0.3, 0, 1, 1)', fill: 'forwards' })
    exit.current = animation
    animation.onfinish = () => { if (exit.current === animation) { exit.current = undefined; close() } }
  }
  const width = sizing?.width === undefined ? undefined : Math.min(sizing.maxWidth, Math.max(MIN_WIDTH, sizing.width))
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (sizing === undefined) return
    const handle = event.currentTarget, startX = event.clientX
    const startWidth = handle.parentElement?.getBoundingClientRect().width ?? width ?? MIN_WIDTH
    handle.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) => {
      sizing.resize(Math.min(sizing.maxWidth, Math.max(MIN_WIDTH, Math.round(startWidth - (next.clientX - startX)))))
    }
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up) }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up)
  }
  return <aside ref={dock} className={css.inspector} aria-label={typeof title === 'string' ? title : undefined} data-entered={opened.current || undefined}
    data-user-width={width === undefined ? undefined : true}
    style={width === undefined ? undefined : { '--inspector-user': `${String(width)}px` } as CSSProperties}
    onKeyDown={(event) => {
      const target = event.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
      if (event.key === 'Escape' && !typing) { event.preventDefault(); dismiss(); return }
      if (sections === undefined || typing || (event.key !== '[' && event.key !== ']')) return
      const index = sections.items.findIndex(item => item.id === sections.current)
      const next = sections.items[(index + (event.key === ']' ? 1 : -1) + sections.items.length) % sections.items.length]
      if (next !== undefined) { event.preventDefault(); sections.select(next.id) }
    }}>
    {sizing !== undefined && <div className={css.inspectorResize} role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={t('world.inspector.resize')} aria-valuemin={MIN_WIDTH} aria-valuemax={sizing.maxWidth} aria-valuenow={width}
      onPointerDown={drag} onKeyDown={(event) => {
        const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
        if (step === 0) return
        event.preventDefault(); event.stopPropagation()
        const current = width ?? event.currentTarget.parentElement?.getBoundingClientRect().width ?? MIN_WIDTH
        sizing.resize(Math.min(sizing.maxWidth, Math.max(MIN_WIDTH, Math.round(current) + step)))
      }} />}
    {/* Heading, actions and section tabs stay pinned while the dock body scrolls. */}
    <div className={css.dockHead}>
      <header className={css.inspectorHead}>
        <div>{eyebrow !== undefined && <span className={css.inspectorEyebrow}>{eyebrow}</span>}
          <h3 ref={heading} tabIndex={-1}>{title}</h3></div>
        <IconButton size="sm" label={t('world.close')} icon={<IconCloseOutline16 />} onClick={dismiss} aria-keyshortcuts="Escape" />
      </header>
      {actions !== undefined && <div className={css.inspectorActions}>{actions}</div>}
      {sections !== undefined && <div ref={tabs} className={css.sectionTabs} role="tablist" aria-keyshortcuts="[ ]">
        <span className={css.sectionIndicator} style={indicator.style} data-ready={indicator.ready || undefined} aria-hidden="true" />
        {sections.items.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === sections.current}
          aria-current={item.id === sections.current ? 'true' : undefined} onClick={() => { sections.select(item.id) }}>{item.label}</button>)}
      </div>}
    </div>
    <div ref={body} key={identity} className={css.inspectorBody}>{children}</div>
  </aside>
}

/**
 * Restore keyboard focus to the row that opened an inspector, or the first row when it left the page.
 * @param container - Table container.
 * @param id - Row identity written as `data-row`.
 */
export function focusRow(container: HTMLElement | null, id: string | undefined): void {
  requestAnimationFrame(() => {
    const rows = Array.from(container?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
    ;(rows.find(row => row.dataset.row === id) ?? rows[0])?.focus()
  })
}

/**
 * Roving tab stop for a keyboard-navigable table: the selected row when visible, otherwise the first row.
 * @param ids - Row identities in display order.
 * @param selected - Selected row identity.
 * @returns the identity that receives `tabIndex=0`.
 */
export function tabStop(ids: readonly string[], selected: string | undefined): string | undefined {
  return selected !== undefined && ids.includes(selected) ? selected : ids[0]
}

/**
 * Table keyboard: j/k or arrows move row focus, Enter opens, `/` focuses the filter; ignored while typing.
 * @param event - Keydown on the table container.
 * @param open - Open the focused row.
 * @param filter - Focus the filter control.
 */
export function tableKeys(event: KeyboardEvent<HTMLElement>, open: (id: string) => void, filter?: () => void): void {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-row]'))
  const index = rows.findIndex(row => row === target || row.contains(target))
  if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); rows[Math.min(index + 1, rows.length - 1)]?.focus() }
  else if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); rows[Math.max(index - 1, 0)]?.focus() }
  else if (event.key === 'Enter' && index >= 0 && target === rows[index]) { event.preventDefault(); const id = rows[index].dataset.row; if (id !== undefined) open(id) }
  else if (event.key === '/' && filter !== undefined) { event.preventDefault(); filter() }
}
