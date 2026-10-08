/** The list-view contract, a segmented view switch, and its sliding indicator. */
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import type { LoadedCount, VizItem } from './interaction/describe.ts'
import { elementByData } from './interaction/dom.ts'
import css from './Views.module.css'

/** Localized words for {@link VizListView}. */
export interface ListWords {
  readonly loaded: (loaded: number, total: number | undefined) => string
  readonly ghost: string
  readonly stale: string
}

/**
 * The list equivalent of a visualization: the same items, in the same
 * order the owner supplies, with the same loaded/total statement.
 * @param props.label - Accessible name, matching the visualization's.
 * @param props.items - Items the visualization draws.
 * @param props.count - Loaded versus total counts.
 * @param props.selectedId - Selected item.
 * @param props.onSelect - Select one item (click, Enter, or Space).
 * @param props.words - Localized words.
 * @returns a keyboard-traversable list.
 */
export function VizListView({ label, items, count, selectedId, onSelect, words }: {
  label: string
  items: readonly VizItem[]
  count: LoadedCount
  selectedId?: string | undefined
  onSelect?: ((id: string) => void) | undefined
  words: ListWords
}) {
  const list = useRef<HTMLUListElement>(null)
  const [focused, setFocused] = useState<string>()
  const tabStop = items.some(item => item.id === focused) ? focused : items.some(item => item.id === selectedId) ? selectedId : items[0]?.id
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    const target = items[Math.max(0, Math.min(items.length - 1, next))]
    if (target === undefined) return
    setFocused(target.id)
    elementByData(list.current, 'item-id', target.id)?.focus()
  }
  return <div data-viz-list>
    <p className={css.listMeta}>{words.loaded(count.loaded, count.total)}</p>
    <ul ref={list} className={css.list} aria-label={label}>
      {items.map((item, index) => <li key={item.id}>
        <button type="button" className={css.row} data-item-id={item.id} data-ghost={item.ghost || undefined}
          data-stale={item.stale || undefined} tabIndex={item.id === tabStop ? 0 : -1} aria-pressed={item.id === selectedId}
          onFocus={() => { setFocused(item.id) }} onClick={() => { onSelect?.(item.id) }} onKeyDown={(event) => { move(event, index) }}>
          <span className={css.dot} data-state={item.state} data-ghost={item.ghost || undefined} aria-hidden="true" />
          <span className={css.rowText}>
            <strong>{item.label}</strong>
            {item.detail !== undefined && <small>{item.detail}</small>}
          </span>
          <span className={css.rowState}>
            {item.ghost === true ? words.ghost : item.stale === true ? `${item.stateLabel} · ${words.stale}` : item.stateLabel}
          </span>
        </button>
      </li>)}
    </ul>
  </div>
}

/**
 * Track the active element inside a container with a sliding indicator.
 * The indicator snaps on first placement and slides (L2) afterwards.
 * @param container - Element holding the options.
 * @param selector - Selector of the active option.
 * @param key - Changes whenever the active option may have moved.
 * @returns style and readiness for the indicator element.
 */
export function useSlidingIndicator(container: RefObject<HTMLElement>, selector: string, key: unknown):
{ style: CSSProperties; ready: boolean } {
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number }>()
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const element = container.current
    if (element === null) return
    const measure = () => {
      const target = element.querySelector<HTMLElement>(selector)
      if (target === null) { setBox(undefined); return }
      setBox({ x: target.offsetLeft, y: target.offsetTop, width: target.offsetWidth, height: target.offsetHeight })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [container, selector, key])
  useLayoutEffect(() => {
    if (box === undefined || ready) return
    // Enable the transition one frame after the first placement so it does not slide in from the origin.
    const frame = requestAnimationFrame(() => { setReady(true) })
    return () => { cancelAnimationFrame(frame) }
  }, [box, ready])
  return {
    ready,
    style: box === undefined ? { '--indicator-opacity': '0' } as CSSProperties : {
      '--indicator-x': `${String(box.x)}px`, '--indicator-y': `${String(box.y)}px`,
      '--indicator-width': `${String(box.width)}px`, '--indicator-height': `${String(box.height)}px`, '--indicator-opacity': '1',
    } as CSSProperties,
  }
}

/**
 * Segmented switch between equivalent views (graph, lanes, list).
 * @param props.label - Accessible group name.
 * @param props.options - Options in display order.
 * @param props.value - Selected option.
 * @param props.onChange - Choose another option.
 * @returns a radio group with a sliding indicator.
 */
export function ViewSwitch<T extends string>({ label, options, value, onChange }: {
  label: string
  options: readonly { readonly id: T; readonly label: string; readonly disabled?: boolean | undefined }[]
  value: T
  onChange: (value: T) => void
}) {
  const group = useRef<HTMLDivElement>(null)
  const indicator = useSlidingIndicator(group, 'button[aria-checked="true"]', value)
  const enabled = options.filter(option => option.disabled !== true)
  const step = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = enabled.findIndex(option => option.id === value)
    const next = enabled[(index + delta + enabled.length) % enabled.length]
    if (next === undefined) return
    onChange(next.id)
    elementByData(group.current, 'option', next.id)?.focus()
  }
  return <div ref={group} className={css.switch} role="radiogroup" aria-label={label}>
    <span className={css.indicator} data-ready={indicator.ready || undefined} style={indicator.style}
      data-motion-tier={indicator.ready ? 'L2' : undefined} aria-hidden="true" />
    {options.map(option => <button key={option.id} type="button" role="radio" data-option={option.id}
      aria-checked={option.id === value} tabIndex={option.id === value ? 0 : -1} disabled={option.disabled}
      onClick={() => { onChange(option.id) }} onKeyDown={step}>{option.label}</button>)}
  </div>
}

/** Class names a host can use to style its own sliding indicator and segmented container. */
export const segmentedClassNames = { indicator: css.indicator, switch: css.switch }
