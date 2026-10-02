/** Domain columns consume only the bounded authorized summaries already present in the collection page. */
import type { ReactNode } from 'react'
import type { SimulationProductCollectionPage } from '@clocky/clocky-client-runtime/client'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * @param props - One bounded page, current selection and view-only navigation.
 * @returns semantic domain columns without requesting per-row details or inventing missing names.
 */
export function CollectionTable({ page, selected, open, t, date }: {
  page: SimulationProductCollectionPage
  selected?: string | undefined
  open: (id: string) => void
  t: (key: Key) => string
  date: (value: number) => string
}) {
  const identity = (id: string, label = id) => {
    const name = label === id ? id : `${label} (${id})`
    return <Button data-simulation-object={id} className={css.objectLink}
      aria-current={selected === id ? 'true' : undefined}
      aria-label={`${t('view')}: ${name}`} onClick={() => { open(id) }}>{label}</Button>
  }
  const row = (id: string, cells: ReactNode[]) => <tr key={id} data-selected={id === selected || undefined}>
    {cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>
  let headings: Key[]
  let rows: ReactNode[]
  switch (page.collection) {
    case 'entities':
      headings = ['entityName', 'kind', 'cognition', 'status']
      rows = page.items.map(item => row(item.id, [identity(item.id, item.name?.text ?? item.id), item.kind.text,
        t(item.cognition), <>{t(item.phase)}<small>{t('writer')}: {t(item.writer)}</small></>]))
      break
    case 'decisions':
      headings = ['decision', 'entity', 'time', 'status', 'operationCount']
      rows = page.items.map(item => row(item.id, [identity(item.id), <code>{item.entityId}</code>,
        <>{item.time}<small>{t('slot')}: {item.slot}</small></>, t(item.status), item.operationCount]))
      break
    case 'operations':
      headings = ['kind', 'entity', 'status', 'publication', 'delivery']
      rows = page.items.map(item => row(item.id, [identity(item.id, item.kind.text), <code>{item.entityId}</code>,
        t(item.status), t(item.publication), t(item.delivery)]))
      break
    case 'checkpoints':
      headings = ['checkpointId', 'status', 'time', 'collection.publishedAt', 'collection.validation']
      rows = page.items.map(item => row(item.id, [<>{identity(item.id)}{item.latestSuccessful && <small>{t('latest')}</small>}</>,
        t(item.status), item.time ?? t('unavailable'), item.publishedAt === undefined ? t('unavailable') : date(item.publishedAt), t('validation')]))
      break
    default: return assertNever(page)
  }
  return <table><thead><tr>{headings.map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead><tbody>{rows}</tbody></table>
}
function assertNever(value: never): never { throw new Error(`Unknown Simulation collection: ${String(value)}`) }
