/** Authored combobox over draft symbols or closed choices; cancelled edits never replace the original value. */
import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from '@clocky/clocky-client-ui-primitives'
import type { DraftSymbol } from './world-draft.ts'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/**
 * Filterable, IME-safe reference input.
 * @param props.value - Current symbol id.
 * @param props.symbols - Draft-declared symbols of the column's kind.
 * @param props.commit - Accept a value (selection or Enter).
 * @param props.cancel - Abandon editing (Escape).
 * @param props.label - Accessible name.
 * @param props.allowUnknown - Permit undeclared references; closed choices retain the original when no option matches.
 * @param props.showIds - Show symbol IDs alongside names; closed localized choices can omit them.
 * @param props.emptyLabel - Localized empty result sentence for the choice family.
 * @param props.invalid - Whether the original stored value violates its closed choice set.
 * @param props.description - Existing cell diagnostic element announced while editing.
 * @returns input with a listbox popup.
 */
export function ReferencePicker({ value, symbols, commit, cancel, label, t, autoFocus = true,
  allowUnknown = true, showIds = true, emptyLabel, invalid, description }: {
  value: string
  symbols: readonly DraftSymbol[]
  commit: (value: string, move?: 'next' | 'previous') => void
  cancel: () => void
  label: string
  t: WorldT
  autoFocus?: boolean
  allowUnknown?: boolean
  showIds?: boolean
  emptyLabel?: string | undefined
  invalid?: boolean | undefined
  description?: string | undefined
}) {
  const id = useId(), [query, setQuery] = useState(value), [active, setActive] = useState(() => {
    const index = symbols.findIndex(symbol => symbol.id === value)
    return index < 0 || index >= 50 ? 0 : index
  })
  const composing = useRef(false)
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null)
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setPortal(input.current?.closest<HTMLDialogElement>('dialog[open]') ?? document.body) }, [])
  const position = useAnchoredPosition({ open: portal !== null, anchorRef: input, panelRef: list, gap: 2, margin: 12 })
  const needle = query === value ? '' : query.trim().toLowerCase()
  const filtered = symbols.filter(symbol => needle === '' || symbol.id.toLowerCase().includes(needle)
    || symbol.name.toLowerCase().includes(needle))
  const prefix = filtered.slice(0, 50), selected = query === value ? filtered.find(symbol => symbol.id === value) : undefined
  const matches = selected !== undefined && !prefix.includes(selected) ? [selected, ...prefix.slice(0, 49)] : prefix
  useLayoutEffect(() => {
    const panel = list.current, option = panel?.children[active]
    if (panel === null || !(option instanceof HTMLElement)) return
    if (option.offsetTop < panel.scrollTop) panel.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > panel.scrollTop + panel.clientHeight)
      panel.scrollTop = option.offsetTop + option.offsetHeight - panel.clientHeight
  }, [active, query, portal])
  const accept = (move?: 'next' | 'previous') => {
    const selected = matches[active]
    if (selected !== undefined) commit(selected.id, move)
    else if (allowUnknown) commit(query.trim(), move)
    else if (move !== undefined) commit(value, move)
  }
  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(active + 1, matches.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(active - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); accept() }
    else if (event.key === 'Tab') { event.preventDefault(); accept(event.shiftKey ? 'previous' : 'next') }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
  }
  return <span className={css.picker}>
    <input ref={input} role="combobox" aria-label={label} aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list"
      aria-invalid={invalid || undefined} aria-describedby={description}
      aria-activedescendant={matches[active] === undefined ? undefined : `${id}-${String(active)}`}
      className={css.cellInput} value={query} autoFocus={autoFocus}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onFocus={(event) => { event.currentTarget.select() }}
      onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={key}
      onBlur={() => { if (allowUnknown) commit(query.trim()); else cancel() }} />
    {portal !== null && createPortal(<ul ref={list} id={`${id}-list`} role="listbox" className={css.pickerList} aria-label={label}
      style={position ?? { visibility: 'hidden' }} onClick={(event) => { event.stopPropagation() }}>
      {matches.length === 0 ? <li className={css.pickerEmpty} role="presentation">{emptyLabel ?? t('world.author.picker.empty')}</li>
        : matches.map((symbol, index) => <li key={symbol.id} id={`${id}-${String(index)}`} role="option" aria-selected={index === active}
          onMouseDown={(event) => { if (event.button !== 0) return; event.preventDefault(); commit(symbol.id) }}
          onMouseEnter={() => { setActive(index) }}>
          <span>{symbol.name}</span>{showIds && <code>{symbol.id}</code>}</li>)}
    </ul>, portal)}
  </span>
}
