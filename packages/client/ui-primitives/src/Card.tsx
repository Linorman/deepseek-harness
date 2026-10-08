// Card and Section: titled containers with an action slot. A section that has
// nothing to show collapses to one line instead of reserving its full size.

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronRightOutline14 } from './icons/index.tsx'
import css from './Card.module.css'

/** Heading level for titled containers; pages decide the outline. */
export type HeadingLevel = 2 | 3 | 4

function Heading({ level, id, children }: { level: HeadingLevel; id: string; children: ReactNode }) {
  const Tag = `h${String(level)}` as 'h2' | 'h3' | 'h4'
  return <Tag id={id} className={css.title}>{children}</Tag>
}

/**
 * Render a surface card, optionally titled.
 * @param props.title - heading text; the card becomes a labeled region.
 * @param props.actions - trailing header controls.
 * @param props.level - heading level (default 3).
 * @param props.padded - inner padding (default true); tables and lists may opt out.
 * @returns the card element.
 */
export function Card({ title, actions, level = 3, padded = true, className, children }: {
  title?: ReactNode
  actions?: ReactNode
  level?: HeadingLevel
  padded?: boolean
  className?: string | undefined
  children?: ReactNode
}) {
  const id = useId()
  return (
    <section
      className={clsx(css.card, padded && css.padded, className)}
      aria-labelledby={title === undefined ? undefined : id}
    >
      {(title !== undefined || actions !== undefined) && (
        <header className={css.header}>
          {title !== undefined && <Heading level={level} id={id}>{title}</Heading>}
          {actions !== undefined && <div className={css.actions}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/**
 * Render a page section. When `empty` is set, the body is replaced by a single
 * muted line so empty modules never occupy full height. A `collapsible`
 * section toggles its body with a disclosure button in the heading.
 * @param props.title - section heading.
 * @param props.count - optional count shown beside the heading.
 * @param props.empty - one-line empty message; replaces the body when set.
 * @param props.collapsible - render the heading as a disclosure toggle.
 * @param props.defaultOpen - initial disclosure state (default true).
 * @returns the section element.
 */
export function Section({
  title, count, actions, empty, collapsible = false, defaultOpen = true, level = 2, className, children,
}: {
  title: ReactNode
  count?: number | undefined
  actions?: ReactNode
  empty?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  level?: HeadingLevel
  className?: string | undefined
  children?: ReactNode
}) {
  const id = useId()
  const bodyId = useId()
  const [open, setOpen] = useState(defaultOpen)
  const showBody = !collapsible || open
  const heading = (
    <>
      {collapsible && <IconChevronRightOutline14 size={14} className={css.chevron} />}
      <span>{title}</span>
      {count !== undefined && <>{' '}<span className={css.count}>{count}</span></>}
    </>
  )
  const toggle = (
    <button type="button" className={css.toggle} aria-expanded={open} aria-controls={bodyId}
      onClick={() => { setOpen(value => !value) }}>
      {heading}
    </button>
  )
  return (
    <section className={clsx(css.section, className)} aria-labelledby={id} data-empty={empty !== undefined || undefined}>
      <header className={css.header}>
        <Heading level={level} id={id}>
          {collapsible ? toggle : heading}
        </Heading>
        {actions !== undefined && <div className={css.actions}>{actions}</div>}
      </header>
      {showBody && (
        <div id={bodyId} className={css.body}>
          {empty !== undefined ? <p className={css.emptyLine}>{empty}</p> : children}
        </div>
      )}
    </section>
  )
}
