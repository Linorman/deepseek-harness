/** A long object name remains readable without consuming the narrow inspector's first screen. */
import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/** @param props - Authorized display text, domain label and close navigation. @returns the inspector identity and return action. */
export function ObjectHeading({ name, domain, close, t }: {
  name: string
  domain: string
  close: () => void
  t: (key: Key) => string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const element = heading.current
    if (element === null) return
    const measure = () => { setClipped(element.scrollHeight > element.clientHeight + 1) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [name, expanded])
  return <header className={css.objectHeading}>
    <Button onClick={close}>{t('close')}</Button>
    <p className={css.muted}>{domain}</p>
    <h2 ref={heading} tabIndex={-1} data-expanded={expanded || undefined}>{name}</h2>
    {(clipped || expanded) && <Button size="sm" aria-expanded={expanded} onClick={() => { setExpanded(!expanded) }}>
      {t(expanded ? 'object.collapseName' : 'object.expandName')}
    </Button>}
  </header>
}
