// CommandPalette: a modal combobox over sectioned results. Data, matching
// providers, and actions come from the owner; this shell owns filtering,
// ranking, the keyboard model, and the preview slot.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Kbd } from './Kbd.tsx'
import css from './CommandPalette.module.css'

/** One selectable result. */
export interface PaletteItem {
  id: string
  label: string
  /** Secondary text, for example a folder or role. */
  hint?: string | undefined
  /** Extra match terms that are not displayed. */
  keywords?: readonly string[] | undefined
  icon?: ReactNode
  /** Shortcut keys shown at the row end, for example `['⌘', 'N']`. */
  shortcut?: readonly string[] | undefined
}

/** A titled group of results; sections render in the given order. */
export interface PaletteSection {
  id: string
  label: string
  items: readonly PaletteItem[]
}

/**
 * Score a fuzzy subsequence match: every query character must appear in
 * order. Contiguous runs and word starts score higher; earlier matches beat
 * later ones.
 * @param query - lower-cased query without surrounding spaces.
 * @param text - candidate text.
 * @returns a positive score, or null when the query does not match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 1
  const haystack = text.toLowerCase()
  let score = 0
  let from = 0
  let previous = -2
  for (const char of query) {
    const index = haystack.indexOf(char, from)
    if (index === -1) return null
    score += 1
    if (index === previous + 1) score += 3
    // A found nonzero index always has a preceding UTF-16 code unit.
    if (index === 0 || /[\s/_\-.·:]/.test(haystack[index - 1] as string)) score += 2
    previous = index
    from = index + char.length
  }
  return score - Math.min(previous, 50) / 100
}

/**
 * Filter and rank sections for a query; empty sections are dropped.
 * @param sections - all sections in display order.
 * @param query - raw query text.
 * @returns ranked sections.
 */
export function filterPalette(sections: readonly PaletteSection[], query: string): PaletteSection[] {
  const needle = query.trim().toLowerCase()
  const result: PaletteSection[] = []
  for (const section of sections) {
    const scored: { item: PaletteItem; score: number; order: number }[] = []
    section.items.forEach((item, order) => {
      const best = [item.label, item.hint ?? '', ...item.keywords ?? []]
        .map(text => fuzzyScore(needle, text))
        .reduce<number | null>((max, value) => value === null ? max : max === null ? value : Math.max(max, value), null)
      if (best !== null) scored.push({ item, score: best, order })
    })
    if (scored.length === 0) continue
    if (needle.length > 0) scored.sort((a, b) => b.score - a.score || a.order - b.order)
    result.push({ ...section, items: scored.map(entry => entry.item) })
  }
  return result
}

/** Owner-supplied words. */
export interface PaletteLabels {
  /** Accessible name of the dialog and combobox. */
  title: string
  placeholder: string
  empty: string
}

/**
 * Render the palette.
 * @param props.open - whether the palette shows.
 * @param props.onClose - Escape, scrim press, or after a selection.
 * @param props.sections - results grouped by provider.
 * @param props.onSelect - receives the chosen item; the palette closes afterwards.
 * @param props.renderPreview - optional preview pane for the active item.
 * @param props.labels - localized words.
 * @returns the portaled palette, or null when closed.
 */
export function CommandPalette({ open, onClose, sections, onSelect, renderPreview, labels, className }: {
  open: boolean
  onClose: () => void
  sections: readonly PaletteSection[]
  onSelect: (item: PaletteItem) => void
  renderPreview?: ((item: PaletteItem) => ReactNode) | undefined
  labels: PaletteLabels
  className?: string | undefined
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionPrefix = useId()
  const filtered = useMemo(() => filterPalette(sections, query), [sections, query])
  const flat = useMemo(() => filtered.flatMap(section => section.items), [filtered])
  const activeItem = flat[Math.min(active, flat.length - 1)]

  useEffect(() => { setActive(0) }, [query])

  useLayoutEffect(() => {
    if (!open) return
    // open renders the dialog unconditionally; refs attach before layout effects.
    const dialog = dialogRef.current as HTMLDialogElement
    const previous = document.activeElement
    dialog.showModal()
    inputRef.current?.focus()
    return () => {
      dialog.close()
      setQuery('')
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])

  useEffect(() => {
    if (activeItem === undefined) return
    document.getElementById(`${optionPrefix}-${activeItem.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeItem, optionPrefix])

  function choose(item: PaletteItem) {
    onSelect(item)
    onClose()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Composition keys belong to the input method, not to navigation.
    if (event.nativeEvent.isComposing || event.key === 'Process') return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (flat.length > 0) setActive(index => (index + 1) % flat.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (flat.length > 0) setActive(index => (index - 1 + flat.length) % flat.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeItem !== undefined) choose(activeItem)
    }
  }

  if (!open) return null
  let rowIndex = -1
  return createPortal((
    <div className={css.root} role="presentation">
      <div className={css.scrim} aria-hidden="true" onClick={onClose} />
      <dialog
        ref={dialogRef}
        className={clsx(css.palette, className)}
        aria-label={labels.title}
        aria-modal="true"
        onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
      >
        <input
          ref={inputRef}
          className={css.input}
          role="combobox"
          aria-label={labels.title}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeItem === undefined ? undefined : `${optionPrefix}-${activeItem.id}`}
          placeholder={labels.placeholder}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
          onKeyDown={onKeyDown}
        />
        <div className={css.content}>
          <div id={listId} role="listbox" aria-label={labels.title} className={css.list}>
            {filtered.length === 0 && <p className={css.empty} role="status">{labels.empty}</p>}
            {filtered.map(section => (
              <div key={section.id} role="group" aria-labelledby={`${listId}-${section.id}`} className={css.group}>
                <div id={`${listId}-${section.id}`} className={css.groupLabel} role="presentation">{section.label}</div>
                {section.items.map((item) => {
                  rowIndex += 1
                  const index = rowIndex
                  const selected = activeItem?.id === item.id
                  return (
                    <div
                      key={item.id}
                      id={`${optionPrefix}-${item.id}`}
                      role="option"
                      aria-selected={selected}
                      className={css.option}
                      onPointerMove={() => { if (!selected) setActive(index) }}
                      onClick={() => { choose(item) }}
                    >
                      {item.icon !== undefined && <span className={css.icon} aria-hidden="true">{item.icon}</span>}
                      <span className={css.optionLabel}>{item.label}</span>
                      {item.hint !== undefined && <span className={css.hint}>{item.hint}</span>}
                      {item.shortcut !== undefined && <Kbd keys={item.shortcut} className={css.shortcut} />}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {renderPreview !== undefined && activeItem !== undefined && (
            <aside className={css.preview} aria-live="polite">{renderPreview(activeItem)}</aside>
          )}
        </div>
      </dialog>
    </div>
  ), document.body)
}
