// Tabs: a WAI-ARIA tablist with roving focus, optional counts, and overflow
// into a "More" menu. Selection is owner-controlled; panels are the owner's.

import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import clsx from 'clsx'
import { Menu } from './Menu.tsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import css from './Tabs.module.css'

/** One tab. */
export interface TabItem {
  /** Stable id passed to `onChange`; also forms the tab and panel element ids. */
  id: string
  label: string
  /** Count badge; omitted renders no badge, `0` renders a muted badge. */
  count?: number | undefined
  disabled?: boolean | undefined
}

/** Props for {@link Tabs}. */
export interface TabsProps {
  items: readonly TabItem[]
  /** Selected tab id. */
  value: string
  onChange: (id: string) => void
  /** Accessible name of the tablist. */
  label: string
  /** `underline` for page navigation, `segmented` for view toggles. */
  variant?: 'underline' | 'segmented'
  /**
   * Show at most this many tabs; the rest move into a "More" menu. The
   * selected tab always stays visible by taking the last visible slot.
   */
  maxVisible?: number | undefined
  /** Label of the overflow trigger (default `更多`). */
  moreLabel?: string | undefined
  /** Prefix for `id`/`aria-controls`, so panels can point back with `aria-labelledby`. */
  idPrefix?: string | undefined
  className?: string | undefined
}

/**
 * Split items into the visible row and the overflow menu, keeping the
 * selected item visible.
 * @param items - all tabs in order.
 * @param value - selected id.
 * @param maxVisible - visible slot count, or undefined for no overflow.
 * @returns visible and overflow tabs, each in original order.
 */
export function splitTabs(items: readonly TabItem[], value: string, maxVisible: number | undefined): {
  visible: TabItem[]
  overflow: TabItem[]
} {
  if (maxVisible === undefined || items.length <= maxVisible) return { visible: [...items], overflow: [] }
  const slots = Math.max(1, maxVisible)
  const visible = items.slice(0, slots)
  const selected = items.find(item => item.id === value)
  if (selected !== undefined && !visible.includes(selected)) visible[slots - 1] = selected
  return { visible, overflow: items.filter(item => !visible.includes(item)) }
}

/**
 * Render a tablist. Arrow keys move focus and selection together (automatic
 * activation); Home/End jump to the ends; disabled tabs are skipped.
 * @returns the tablist element.
 */
export function Tabs({
  items, value, onChange, label, variant = 'underline', maxVisible, moreLabel = '更多', idPrefix = 'tabs', className,
}: TabsProps) {
  const [moreOpen, setMoreOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { visible, overflow } = splitTabs(items, value, maxVisible)
  const enabled = visible.filter(item => item.disabled !== true)

  function focusTab(id: string) {
    const tabs = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []
    for (const tab of tabs) if (tab.dataset.tabId === id) tab.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return
    const current = enabled.findIndex(item => item.id === (event.target as HTMLElement).dataset.tabId)
    if (current === -1) return
    let next: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % enabled.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + enabled.length) % enabled.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = enabled.length - 1
    const target = next === undefined ? undefined : enabled[next]
    if (target === undefined) return
    event.preventDefault()
    onChange(target.id)
    focusTab(target.id)
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={clsx(css.tabs, css[variant], className)}
      onKeyDown={onKeyDown}
    >
      {visible.map((item) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            aria-selected={selected}
            aria-label={item.count === undefined ? undefined : `${item.label} ${item.count}`}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled === true}
            data-tab-id={item.id}
            className={css.tab}
            onClick={() => { onChange(item.id) }}
          >
            <span className={css.label}>{item.label}</span>
            {item.count !== undefined && (
              <span className={css.count} data-zero={item.count === 0 || undefined}>{item.count}</span>
            )}
          </button>
        )
      })}
      {overflow.length > 0 && (
        <Menu
          open={moreOpen}
          onClose={() => { setMoreOpen(false) }}
          onSelect={(id) => { setMoreOpen(false); onChange(id) }}
          items={overflow.map(item => ({
            id: item.id,
            label: item.count === undefined ? item.label : `${item.label} · ${item.count}`,
            disabled: item.disabled === true,
          }))}
          portal
          anchor={(
            <button
              type="button"
              className={clsx(css.tab, css.more)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => { setMoreOpen(open => !open) }}
            >
              <span className={css.label}>{moreLabel}</span>
              <IconChevronDownOutline14 size={12} />
            </button>
          )}
        />
      )}
    </div>
  )
}
