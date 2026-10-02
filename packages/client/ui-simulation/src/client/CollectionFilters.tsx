/** Committed metadata filters reuse the shared Menu and existing Host query enums. */
import { useState } from 'react'
import { Button, Menu, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import type { Route } from './store.ts'
import { statuses } from './selection.ts'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'

/**
 * @param props - View-only committed filters and navigation; no collection snapshots are copied.
 * @returns status/cognition filters and explicit linked-object scope removal.
 */
export function CollectionFilters({ view, change, t }: { view: Route; change: (next: Route) => void; t: (key: Key) => string }) {
  const [open, setOpen] = useState<'status' | 'cognition'>()
  const select = (patch: Partial<Route>) => { change({ ...view, ...patch, objectId: undefined, section: undefined }); setOpen(undefined) }
  const active = view.status !== undefined || view.cognition !== undefined || view.entityId !== undefined || view.decisionId !== undefined
  return <div data-simulation-filters className={css.actions} aria-label={t('filters')}>
    <Menu open={open === 'status'} portal selectedId={view.status ?? 'all'}
      items={['all', ...statuses[view.module]].map(id => ({ id, label: t(id as Key) }))}
      anchor={<Button aria-label={t('filterStatus')} aria-expanded={open === 'status'}
        onClick={() => { setOpen(open === 'status' ? undefined : 'status') }}>{t('status')}: {t((view.status ?? 'all') as Key)}<IconChevronDownOutline14 /></Button>}
      onClose={() => { setOpen(undefined) }} onSelect={(id) => { select({ status: id === 'all' ? undefined : id }) }} />
    {view.module === 'entities' && <Menu open={open === 'cognition'} portal selectedId={view.cognition ?? 'all'}
      items={(['all', 'none', 'agent'] as const).map(id => ({ id, label: t(id) }))}
      anchor={<Button aria-label={t('filterCognition')} aria-expanded={open === 'cognition'}
        onClick={() => { setOpen(open === 'cognition' ? undefined : 'cognition') }}>{t('cognition')}: {t(view.cognition ?? 'all')}<IconChevronDownOutline14 /></Button>}
      onClose={() => { setOpen(undefined) }} onSelect={(id) => { select({ cognition: id === 'all' ? undefined : id as 'none' | 'agent' }) }} />}
    {view.entityId !== undefined && <span>{t('entity')}: <code>{view.entityId}</code></span>}
    {view.decisionId !== undefined && <span>{t('decision')}: <code>{view.decisionId}</code></span>}
    {active && <Button onClick={() => { select({ status: undefined, cognition: undefined, entityId: undefined, decisionId: undefined }) }}>{t('clearFilters')}</Button>}
  </div>
}
