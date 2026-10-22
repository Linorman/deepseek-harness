/** Compound authoring keeps incomplete text in the parent draft while retaining editor formatting between valid changes. */
import { useEffect, useRef, useState } from 'react'
import type { Json } from './world-draft.ts'
import { decodeSyntax, scalarText } from './world-draft.ts'
import css from './World.module.css'

/**
 * Edit one complete JSON value through the existing draft owner.
 * @param props - Current value, parent mutation, accessible field identity and read-only state.
 * @returns a plain textarea; invalid JSON remains exact raw text and never becomes an empty successful object.
 */
export function JsonField(props: { value: Json | undefined
  id: string
  path: string
  readOnly: boolean
  description?: string | undefined
  change: (value: Json | undefined) => boolean }) {
  const [text, setText] = useState(() => scalarText(props.value))
  const echoed = useRef<string | undefined>()
  useEffect(() => {
    const current = JSON.stringify(props.value)
    if (current !== echoed.current) setText(scalarText(props.value))
    echoed.current = current
  }, [props.value])
  const decoded = text === '' ? undefined : decodeSyntax(text, 'json')
  return <textarea id={props.id} data-path={props.path} className={`${css.textarea} ${css['resize-none']}`} rows={4} readOnly={props.readOnly}
    value={text} aria-invalid={decoded?.ok === false || undefined} aria-describedby={props.description}
    onChange={(event) => {
      const raw = event.target.value, parsed = raw === '' ? undefined : decodeSyntax(raw, 'json')
      const next = parsed === undefined ? undefined : parsed.ok ? parsed.value : raw
      if (!props.change(next)) return
      setText(raw)
      echoed.current = JSON.stringify(next)
    }} />
}
