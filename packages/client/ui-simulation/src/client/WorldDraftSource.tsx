/** Native textarea source editor with a synchronized line gutter, current-line tint and diagnostic markers. */
import { useEffect, useId, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import type { CSSProperties } from 'react'
import type { ScenarioSourceFormat } from '@clocky/clocky-simulation-scenario'
import type { WorldT } from './WorldFacts.tsx'
import css from './World.module.css'

/** One gutter marker; `modified` markers render muted until the next check. */
export interface SourceMarker { readonly line: number; readonly severity: 'error' | 'warning'; readonly message: string }
/** Imperative locate handle used by the diagnostic list. */
export interface SourceEditorHandle { locate: (line: number, column: number) => void }

interface Props {
  text: string
  format: ScenarioSourceFormat
  markers: readonly SourceMarker[]
  readOnly: boolean
  change: (text: string) => void
  /** Ctrl/Cmd+Enter. */
  check: () => void
  /** F8 / Shift+F8 diagnostic stepping. */
  stepDiagnostic: (direction: 1 | -1) => void
  t: WorldT
}

const LINE_HEIGHT = 20

/**
 * Edit raw JSON/YAML. IME composition is never interrupted; locating selects the token at line:column.
 * @param props - Raw text, markers and commands.
 * @returns gutter plus textarea sharing one scroll position.
 */
export const DraftSourceEditor = forwardRef<SourceEditorHandle, Props>(function DraftSourceEditor(props, handle) {
  const { t } = props, id = useId()
  const area = useRef<HTMLTextAreaElement>(null), gutter = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const [caretLine, setCaretLine] = useState(1)
  const lines = props.text.split('\n').length
  const updateCaret = () => {
    const element = area.current
    if (element === null) return
    setCaretLine(element.value.slice(0, element.selectionStart).split('\n').length)
  }
  useImperativeHandle(handle, () => ({
    locate: (line, column) => {
      const element = area.current
      if (element === null) return
      const rows = element.value.split('\n')
      let offset = 0
      for (let index = 0; index < Math.min(line - 1, rows.length); index++) offset += (rows[index]?.length ?? 0) + 1
      const row = rows[line - 1] ?? ''
      const start = offset + Math.min(Math.max(column - 1, 0), row.length)
      const token = /^("(?:[^"\\]|\\.)*"|[^\s,:{}[\]]+)/.exec(row.slice(start - offset))
      element.focus()
      element.setSelectionRange(start, start + (token?.[0].length ?? 0))
      element.scrollTop = Math.max((line - 4) * LINE_HEIGHT, 0)
      setScroll(element.scrollTop); setCaretLine(line)
    },
  }), [])
  useEffect(() => { if (gutter.current !== null) gutter.current.scrollTop = scroll }, [scroll])
  const byLine = new Map<number, SourceMarker>()
  for (const marker of props.markers) {
    const existing = byLine.get(marker.line)
    if (existing === undefined || existing.severity === 'warning' && marker.severity === 'error') byLine.set(marker.line, marker)
  }
  return <div className={css.source} data-read-only={props.readOnly || undefined} style={{ '--line-height': `${String(LINE_HEIGHT)}px` } as CSSProperties}>
    <div ref={gutter} className={css.gutter} aria-label={t('world.author.lineNumbers')} role="presentation">
      <div style={{ height: lines * LINE_HEIGHT }}>{Array.from({ length: lines }, (_, index) => {
        const marker = byLine.get(index + 1)
        return <span key={index} data-current={caretLine === index + 1 || undefined} data-marker={marker?.severity}
          title={marker?.message}>{index + 1}</span>
      })}</div>
    </div>
    <div className={css.sourceBody}>
      <span className={css.currentLine} aria-hidden="true" style={{ transform: `translateY(${String((caretLine - 1) * LINE_HEIGHT - scroll)}px)` }} />
      <textarea ref={area} id={id} className={`${css.sourceText} ${css['resize-none']}`} value={props.text} readOnly={props.readOnly} spellCheck={false}
        aria-label={t('world.author.sourceLabel', { format: props.format.toUpperCase() })} aria-describedby={`${id}-keys`}
        aria-keyshortcuts="Control+Enter Meta+Enter F8 Shift+F8" wrap="off"
        autoCapitalize="off" autoCorrect="off"
        onScroll={(event) => { setScroll(event.currentTarget.scrollTop) }}
        onSelect={updateCaret} onClick={updateCaret} onKeyUp={updateCaret}
        onChange={(event) => { props.change(event.target.value); updateCaret() }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); props.check() }
          else if (event.key === 'F8') { event.preventDefault(); props.stepDiagnostic(event.shiftKey ? -1 : 1) }
          else if (event.key === 'Tab' && !props.readOnly && !event.shiftKey && !event.altKey) {
            // Two-space indent; Escape-then-Tab still leaves the editor for keyboard users.
            if (event.currentTarget.dataset.escaped === 'true') { event.currentTarget.dataset.escaped = ''; return }
            event.preventDefault()
            const element = event.currentTarget, start = element.selectionStart, end = element.selectionEnd
            props.change(`${element.value.slice(0, start)}  ${element.value.slice(end)}`)
            requestAnimationFrame(() => { element.setSelectionRange(start + 2, start + 2) })
          } else if (event.key === 'Escape') event.currentTarget.dataset.escaped = 'true'
        }} />
      <span id={`${id}-keys`} className={css.srOnly}>{t('world.author.sourceKeys')}</span>
    </div>
  </div>
})
