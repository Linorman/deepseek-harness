// KeyValue: a description list of labeled facts.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import css from './KeyValue.module.css'

/** One labeled fact. */
export interface KeyValueItem {
  id: string
  label: ReactNode
  value: ReactNode
}

/**
 * Render facts as a `dl`, in a grid of label/value rows or as inline pairs.
 * @param props.items - facts in display order.
 * @param props.layout - `rows` (default) or `inline` for header strips.
 * @returns the description list.
 */
export function KeyValue({ items, layout = 'rows', className }: {
  items: readonly KeyValueItem[]
  layout?: 'rows' | 'inline'
  className?: string | undefined
}) {
  return (
    <dl className={clsx(css.list, css[layout], className)}>
      {items.map(item => (
        <div key={item.id} className={css.item}>
          <dt className={css.label}>{item.label}</dt>
          <dd className={css.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
