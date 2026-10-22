/** Spreadsheet-style editor for one draft array: grid keyboard model, reference cells, row actions and inline undo. */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { Button, IconButton } from '@clocky/clocky-client-ui-primitives'
import type { Column, DraftSymbol, Json, SymbolKind, TableSpec } from './world-draft.ts'
import { asObject, getPath, scalarText, setPath, cellValue, decodeSyntax } from './world-draft.ts'
import { ReferencePicker } from './WorldReferencePicker.tsx'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** Diagnostic attached to one cell; `modified` diagnostics await another check. */
export interface CellDiagnostic { readonly row: number
  readonly column?: string | undefined
  readonly message: string
  readonly modified: boolean }
/** Locate request from the diagnostic list; a new generation re-runs focus and highlight. */
export interface CellLocate { readonly row: number; readonly column?: string | undefined; readonly generation: number }

interface Props {
  table: TableSpec
  rows: readonly Json[]
  symbols: (kind: SymbolKind) => readonly DraftSymbol[]
  readOnly: boolean
  diagnostics: readonly CellDiagnostic[]
  locate?: CellLocate | undefined
  /** Replace the whole array; the caller records undo history. */
  change: (rows: readonly Json[]) => void
  t: WorldT
}

const display = (column: Column, row: Json, t: WorldT, symbols: Props['symbols']): { text: ReactNode; dangling: boolean } => {
  const value = getPath(row, column.path)
  const raw = scalarText(value)
  switch (column.kind) {
    case 'choice': {
      const option = column.options.find(item => item.id === raw)
      return { text: option === undefined ? raw : t(option.label), dangling: false }
    }
    case 'ref': {
      if (raw === '') return { text: '', dangling: false }
      const symbol = symbols(column.symbol).find(item => item.id === raw)
      return symbol === undefined ? { text: <code>{raw}</code>, dangling: true }
        : { text: <><span>{symbol.name}</span>{symbol.name !== symbol.id && <code className={css.symbolId}>{symbol.id}</code>}</>
          , dangling: false }
    }
    case 'json': return value === undefined || value === null ? { text: '', dangling: false }
      : { text: <span className={css.jsonSummary} title={JSON.stringify(value, null, 2)}>{jsonSummary(value, t)}</span>, dangling: false }
    case 'nullable-time': return { text: raw === '' ? <span className={css.muted}>{t('world.untilNow')}</span> : raw, dangling: false }
    case 'text':
    case 'time':
    case 'longtext':
    case 'integer': return { text: raw, dangling: false }
    default: { const unreachable: never = column; throw new Error(`Unknown column ${JSON.stringify(unreachable)}`) }
  }
}

/**
 * Edit one table. Click selects, Enter or double-click edits, Escape cancels, Tab moves across, arrows move vertically.
 * @param props - Table spec, rows and caller-owned change callback.
 * @returns grid with an add-row control and an inline undo strip after deletion.
 */
export function DraftTableEditor(props: Props) {
  const { table, rows, t } = props, id = useId()
  const [active, setActive] = useState<{ row: number; col: number }>({ row: 0, col: 0 })
  const [editing, setEditingState] = useState(false)
  // Commit and cancel close the editor synchronously; the blur that follows the editor's removal must not commit again.
  const editingRef = useRef(false)
  const setEditing = (next: boolean) => { editingRef.current = next; setEditingState(next) }
  const [value, setValue] = useState('')
  const [entering, setEntering] = useState<number>()
  const [removed, setRemoved] = useState<{ row: Json; index: number }>()
  const [flash, setFlash] = useState<{ row: number; col: number; generation: number }>()
  const grid = useRef<HTMLTableElement>(null)
  const undoTimer = useRef<number>()
  const composing = useRef(false)
  useEffect(() => () => { window.clearTimeout(undoTimer.current) }, [])
  const columns = table.columns
  const focusCell = (row: number, col: number) => {
    requestAnimationFrame(() => {
      // A rapid Enter can mount the editor before a selection's queued focus; never blur that active editor.
      if (editingRef.current) return
      grid.current?.querySelector<HTMLElement>(`[data-cell="${String(row)}:${String(col)}"]`)?.focus()
    })
  }
  useEffect(() => {
    const target = props.locate
    if (target === undefined) return
    const col = Math.max(columns.findIndex(column => column.id === target.column), 0)
    setActive({ row: target.row, col }); setEditing(false); setFlash({ row: target.row, col, generation: target.generation })
    grid.current?.querySelector(`[data-cell="${String(target.row)}:${String(col)}"]`)?.scrollIntoView({ block: 'center' })
    focusCell(target.row, col)
  }, [props.locate?.generation])
  const startEdit = (row: number, col: number) => {
    const column = columns[col], current = rows[row]
    if (props.readOnly || column === undefined || current === undefined) return
    const raw = getPath(current, column.path)
    setActive({ row, col })
    setValue(column.kind === 'json' && raw !== undefined && typeof raw === 'object' ? JSON.stringify(raw, null, 2) : scalarText(raw))
    setEditing(true)
  }
  const commit = (next: string, move?: 'next' | 'previous' | 'down') => {
    if (!editingRef.current) return
    const column = columns[active.col], row = rows[active.row]
    setEditing(false)
    if (column !== undefined && row !== undefined) {
      const typed = cellValue(column, next)
      const before = getPath(row, column.path)
      if (JSON.stringify(before) !== JSON.stringify(typed)) {
        props.change(rows.map((item, index) => index === active.row ? setPath(item, column.path, typed) : item))
      }
    }
    let { row: r, col: c } = active
    if (move === 'next') { c++; if (c >= columns.length) { c = 0; r = Math.min(r + 1, rows.length - 1) } }
    else if (move === 'previous') { c--; if (c < 0) { c = columns.length - 1; r = Math.max(r - 1, 0) } }
    else if (move === 'down') r = Math.min(r + 1, rows.length - 1)
    setActive({ row: r, col: c }); focusCell(r, c)
  }
  const cancel = () => {
    if (!editingRef.current) return
    setEditing(false); focusCell(active.row, active.col)
  }
  const navigate = (event: KeyboardEvent<HTMLTableElement>) => {
    if (editing) return
    const target = event.target as HTMLElement
    if (target.dataset.cell === undefined) return
    const { row, col } = active
    const move = (r: number, c: number) => { event.preventDefault(); setActive({ row: r, col: c }); focusCell(r, c) }
    switch (event.key) {
      case 'ArrowDown': move(Math.min(row + 1, rows.length - 1), col); break
      case 'ArrowUp': move(Math.max(row - 1, 0), col); break
      case 'ArrowRight': move(row, Math.min(col + 1, columns.length - 1)); break
      case 'ArrowLeft': move(row, Math.max(col - 1, 0)); break
      case 'Home': move(row, 0); break
      case 'End': move(row, columns.length - 1); break
      case 'Tab':
        if (event.shiftKey ? col > 0 : col < columns.length - 1) move(row, col + (event.shiftKey ? -1 : 1))
        break
      case 'Enter':
      case 'F2': event.preventDefault(); startEdit(row, col); break
      default: break
    }
  }
  const updateRows = (next: readonly Json[], focus?: number) => {
    props.change(next)
    if (focus !== undefined) { setActive({ row: focus, col: active.col }); focusCell(focus, active.col) }
  }
  const remove = (index: number) => {
    const row = rows[index]
    if (row === undefined) return
    updateRows(rows.filter((_, position) => position !== index))
    setRemoved({ row, index }); window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => { setRemoved(undefined) }, 5000)
    requestAnimationFrame(() => { grid.current?.parentElement?.querySelector<HTMLElement>('[data-undo-row]')?.focus() })
  }
  const add = () => {
    const next = [...rows, table.blank()]
    props.change(next); setEntering(next.length - 1)
    setActive({ row: next.length - 1, col: 0 }); setValue(''); setEditing(true)
  }
  const editor = (column: Column, label: string, description: string | undefined, invalid: boolean) => {
    if (column.kind === 'ref') return <ReferencePicker value={value} symbols={props.symbols(column.symbol)} label={label} t={t}
      commit={(next, move) => { commit(next, move) }} cancel={cancel} description={description} invalid={invalid} />
    if (column.kind === 'choice') return <ReferencePicker value={value} label={label} t={t}
      symbols={[...column.optional ? [{ id: '', name: t('world.preview.none') }] : [],
        ...column.options.map(option => ({ id: option.id, name: t(option.label) }))]}
      allowUnknown={false} showIds={false} emptyLabel={t('world.author.choice.empty')}
      invalid={invalid || !(column.optional && value === '') && !column.options.some(option => option.id === value)}
      description={description}
      commit={(next, move) => { commit(next, move) }} cancel={cancel} />
    const multiline = column.kind === 'longtext' || column.kind === 'json'
    const invalidJson = column.kind === 'json' && value !== '' && !decodeSyntax(value, 'json').ok
    const Tag = multiline ? 'textarea' : 'input'
    return <Tag className={multiline ? `${css.cellInput} ${css['resize-none']}` : css.cellInput}
      aria-label={label} autoFocus value={value} aria-invalid={invalidJson || invalid || undefined} aria-describedby={description}
      rows={multiline ? 3 : undefined}
      inputMode={column.kind === 'integer' || column.kind === 'time' || column.kind === 'nullable-time' ? 'numeric' : undefined}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onFocus={(event) => { event.currentTarget.select() }}
      onChange={(event) => { setValue(event.target.value) }} onBlur={(event) => { commit(event.target.value) }}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
        else if (event.key === 'Enter' && !(multiline && event.shiftKey)) { event.preventDefault(); commit(event.currentTarget.value, 'down') }
        else if (event.key === 'Tab') { event.preventDefault(); commit(event.currentTarget.value, event.shiftKey ? 'previous' : 'next') }
      }} />
  }
  return <div className={css.tableEditor} data-table={table.id}>
    <div className={css.tableScroll}>
      <table ref={grid} role="grid" aria-label={t(table.title)} aria-readonly={props.readOnly || undefined} onKeyDown={navigate}
        className={css.grid}>
        <thead><tr>{columns.map(column => <th key={column.id} scope="col">{t(column.label)}</th>)}
          <th scope="col"><span className={css.srOnly}>{t('world.author.row.actions')}</span></th></tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} data-entering={entering === rowIndex || undefined}
          onAnimationEnd={() => { if (entering === rowIndex) setEntering(undefined) }}>
          {columns.map((column, colIndex) => {
            const isActive = active.row === rowIndex && active.col === colIndex
            const label = `${t(column.label)} · ${String(rowIndex + 1)}`
            const issues = props.diagnostics.filter(item => item.row === rowIndex && (item.column === column.id
              || item.column === undefined && colIndex === 0))
            const shown = display(column, row, t, props.symbols)
            const described = issues.length > 0 ? `${id}-d-${String(rowIndex)}-${column.id}` : undefined
            return <td key={column.id} role="gridcell" data-cell={`${String(rowIndex)}:${String(colIndex)}`} data-label={t(column.label)}
              tabIndex={isActive && !editing ? 0 : -1} aria-selected={isActive || undefined}
              aria-describedby={described} data-issue={issues.some(item => !item.modified) || undefined}
              onFocus={(event) => {
                if (event.target === event.currentTarget && !editingRef.current && !isActive) setActive({ row: rowIndex, col: colIndex })
              }}
              data-dangling={shown.dangling || undefined} data-editing={isActive && editing || undefined}
              data-flash={flash !== undefined && flash.row === rowIndex && flash.col === colIndex ? flash.generation : undefined}
              onAnimationEnd={(event) => { if (event.animationName.includes('flash')) setFlash(undefined) }}
              onClick={() => { if (!(isActive && editing)) { setActive({ row: rowIndex, col: colIndex }); focusCell(rowIndex, colIndex) } }}
              onDoubleClick={() => { startEdit(rowIndex, colIndex) }}
              title={props.readOnly ? undefined : t('world.author.cell.edit')}>
              {isActive && editing ? editor(column, label, described, shown.dangling || issues.some(item => !item.modified))
                : <span className={css.cellValue}>{shown.text}
                  {shown.dangling && <span className={css.cellWarn} title={t('world.author.danglingRef')} aria-label={t('world.author.danglingRef')}>⚠</span>}
                  {issues.some(item => !item.modified) && !shown.dangling && <span className={css.cellWarn} aria-hidden="true">⚠</span>}</span>}
              {described !== undefined && <span id={described} className={css.srOnly}>{issues.map(item => item.message).join('; ')}</span>}
            </td>
          })}
          <td className={css.rowActions}>{!props.readOnly && <span>
            <IconButton size="sm" label={t('world.author.row.duplicate')} icon={<span aria-hidden="true">⧉</span>}
              onClick={() => { updateRows([...rows.slice(0, rowIndex + 1), row, ...rows.slice(rowIndex + 1)], rowIndex + 1) }} />
            <IconButton size="sm" label={t('world.author.row.up')} icon={<span aria-hidden="true">↑</span>} disabled={rowIndex === 0}
              onClick={() => { const next = [...rows]; [next[rowIndex - 1], next[rowIndex]] = [row, rows[rowIndex - 1] ?? null]
                updateRows(next, rowIndex - 1) }} />
            <IconButton size="sm" label={t('world.author.row.down')} icon={<span aria-hidden="true">↓</span>} disabled={rowIndex === rows.length - 1}
              onClick={() => { const next = [...rows]; [next[rowIndex + 1], next[rowIndex]] = [row, rows[rowIndex + 1] ?? null]
                updateRows(next, rowIndex + 1) }} />
            <IconButton size="sm" label={t('world.author.row.delete')} icon={<span aria-hidden="true">✕</span>}
              onClick={() => { remove(rowIndex) }} />
          </span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {Object.keys(asObject(rows[0] ?? null)).length === 0 && rows.length === 0 && <p className={css.muted}>{t('world.empty', { objects: t(table.title) })}</p>}
    {removed !== undefined && <div className={css.undoStrip} role="status">
      <span>{t('world.author.rowDeleted')}</span>
      <Button size="sm" variant="ghost" data-undo-row onClick={() => {
        const next = [...rows.slice(0, removed.index), removed.row, ...rows.slice(removed.index)]
        props.change(next); setRemoved(undefined); setEntering(removed.index); focusCell(removed.index, 0)
      }}>{t('world.author.undo')}</Button>
    </div>}
    {!props.readOnly && <Button size="sm" variant="ghost" className={css.addRow} onClick={add}>＋ {t('world.author.addRow')}</Button>}
  </div>
}

/**
 * Readable one-line summary of a compound cell; the exact JSON stays in the cell title and the editor.
 * @param value - Compound JSON value.
 * @param t - Namespace translator.
 * @returns short human text: the `kind`/`name`/`id` of objects, the joined scalars of short lists, or a count.
 */
export function jsonSummary(value: Json, t: WorldT): string {
  if (value === null || typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    const items = value as readonly Json[]
    if (items.length === 0) return t('world.json.none')
    if (items.every(item => item === null || typeof item !== 'object')) {
      const text = items.map(String).join(', ')
      return text.length <= 48 ? text : t('world.json.items', { count: items.length })
    }
    const first = jsonSummary(items[0] ?? null, t)
    return items.length === 1 ? first : `${first} ${t('world.json.more', { count: items.length - 1 })}`
  }
  const object = value as { readonly [key: string]: Json }
  const head = [object.kind, object.name, object.id, object.domain].find(item => typeof item === 'string' && item !== '') as string | undefined
  const detail = [object.personId, object.positionId, object.operation, typeof object.version === 'string' || typeof object.version === 'number' ? `v${object.version}` : undefined]
    .filter((item): item is string => typeof item === 'string' && item !== '')
  if (head !== undefined) return [head, ...detail].join(' · ')
  const keys = Object.keys(object)
  return keys.length === 0 ? t('world.json.none') : t('world.json.fields', { count: keys.length })
}
