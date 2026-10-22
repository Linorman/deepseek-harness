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
  // Summaries carry no entity name; a readable short form leads and the exact identity stays in the title and inspector.
  const entity = (id: string) => <span title={id} data-entity-id={id}>{readableId(id)}</span>
  /** Status words keep their text; the dot colour only reinforces the status role it names. */
  const pill = (state: string, text: string = t(state as Key)) => <span className={css.pill} data-tone={TONE[state]}>{text}</span>
  const row = (id: string, cells: ReactNode[]) => <tr key={id} data-selected={id === selected || undefined}>
    {/* Every collection supplies one cell per heading, so the narrow card layout labels each cell with its heading. */}
    {headings.map((heading, index) => <td key={heading} data-label={t(heading)}>{cells[index]}</td>)}</tr>
  let headings: Key[]
  let rows: ReactNode[]
  switch (page.collection) {
    case 'entities':
      headings = ['entityName', 'kind', 'cognition', 'status']
      rows = page.items.map(item => row(item.id, [identity(item.id, item.name?.text ?? item.id), <code>{item.kind.text}</code>,
        item.cognition === 'agent' ? <span className={css.pill} data-tone="agent">{t(item.cognition)}</span> : t(item.cognition),
        <>{pill(item.phase)}<small>{t('writer')}: {t(item.writer)}</small></>]))
      break
    case 'decisions':
      headings = ['decision', 'entity', 'time', 'status', 'operationCount']
      rows = page.items.map(item => row(item.id, [<>{identity(item.id, `${t('slot')} ${String(item.slot)}`)}<small><code>{item.id}</code></small></>,
        entity(item.entityId), item.time, pill(item.status), item.operationCount]))
      break
    case 'operations':
      headings = ['kind', 'entity', 'status', 'publication', 'delivery']
      rows = page.items.map(item => row(item.id, [identity(item.id, item.kind.text), entity(item.entityId),
        pill(item.status), t(item.publication), t(item.delivery)]))
      break
    case 'checkpoints':
      headings = ['checkpointId', 'status', 'time', 'collection.publishedAt', 'collection.validation']
      rows = page.items.map(item => row(item.id, [<>{identity(item.id)}{item.latestSuccessful && <small>{t('latest')}</small>}</>,
        pill(item.status), item.time ?? t('unavailable'), item.publishedAt === undefined ? t('unavailable') : date(item.publishedAt), t('validation')]))
      break
    default: return assertNever(page)
  }
  return <table><thead><tr>{headings.map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead><tbody>{rows}</tbody></table>
}
/** Status role per known collection state; unknown states keep a neutral dot. */
const TONE: Readonly<Record<string, string>> = {
  active: 'done', inactive: 'idle', terminated: 'failed',
  open: 'running', submitted: 'waiting', accepted: 'done', cancelled: 'idle',
  pending: 'waiting', applied: 'done', rejected: 'failed', 'blocked-authority': 'blocked', 'blocked-dependency': 'blocked', 'outcome-unknown': 'needs-you',
  'in-progress': 'running', failed: 'failed', completed: 'done',
}
/** A typed UUID identity such as `simulation-operation:<uuid>`. */
const TYPED_ID = /^([a-z][a-z-]*):([0-9a-f]{8})-[0-9a-f-]{27}$/i
/**
 * Readable short form of an opaque identity: a typed UUID keeps its type and first eight digits, a path keeps its last two parts.
 * @param id - Exact identity.
 * @returns display text; the caller keeps the exact identity available.
 */
export function readableId(id: string): string {
  if (TYPED_ID.test(id)) return id.replace(TYPED_ID, '$1 · $2')
  const parts = id.split('/')
  return parts.length > 2 ? parts.slice(-2).join(' ') : id
}
function assertNever(value: never): never { throw new Error(`Unknown Simulation collection: ${String(value)}`) }
