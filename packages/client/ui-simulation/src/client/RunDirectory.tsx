/** Bounded run directory; its parent retains read subscriptions and navigation state. */
import { useRef, useState, type ReactNode } from 'react'
import { navigateWithTransition, PointerLight, transitionName, usePointerLight } from '@clocky/clocky-client-ui-viz'
import { Button, IconButton, IconEllipsisOutline16, Input, Menu, writeClipboard } from '@clocky/clocky-client-ui-primitives'
import type { SimulationRuntimeState, SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
import type { Injected } from './Workspace.tsx'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'
import { RunStatus, ModelPool } from './RunStatus.tsx'
import { Feedback } from './Feedback.tsx'
import css from './Workspace.module.css'

/**
 * @param props - Authorized directory window, matching status batch and view-only actions.
 * @returns searchable run rows without per-run inspection or a second polling owner.
 */
export function RunDirectory({ directory, statuses, directoryIds, connected, search, draftSearch, searchDraft,
  navigate, refresh, readDirectory, runStatuses, t, date, catalog, create }: {
  directory: SimulationRuntimeState['directory']
  catalog: SimulationRuntimeState['catalog']
  create: () => void
  statuses: SimulationRuntimeState['statuses']
  directoryIds: SimulationProductRunId[]
  connected: boolean
  search: string
  draftSearch: string
  searchDraft: (value: string) => void
  navigate: (route: Route) => void
  refresh: () => void
  readDirectory: Injected['directory']
  runStatuses: Injected['runStatuses']
  t: (key: Key) => string
  date: (value: number) => string
}) {
  const searchForm = useRef<HTMLFormElement>(null)
  const composing = useRef(false)
  const [listMenu, setListMenu] = useState(false)
  const [rowMenu, setRowMenu] = useState<string>()
  return <>
    <form ref={searchForm} className={css.search} noValidate onSubmit={(event) => {
      event.preventDefault(); if (composing.current) return
      navigate({ module: 'overview', search: draftSearch.trim() })
    }}>
      <label htmlFor="simulation-search">{t('search')}</label>
      <Input id="simulation-search" value={draftSearch} placeholder={t('search')}
        onChange={(event) => { searchDraft(event.target.value) }}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
      <Button variant="secondary" type="submit" disabled={!connected}>{t('searchButton')}</Button>
      {draftSearch !== '' && <Button aria-label={t('clear')} onClick={() => {
        navigate({ module: 'overview', search: '' }); searchForm.current?.querySelector('input')?.focus()
      }}>{t('clear')}</Button>}
    </form>
    <div className={css.scroll}>
      {/* Statuses refresh on the control interval; an explicit reread is a
          recovery action in the list menu. */}
      <div className={css.listHeader}>
        <Feedback value={statuses} t={t} />
        <Menu open={listMenu} portal align="end" onClose={() => { setListMenu(false) }}
          anchor={<IconButton size="sm" label={t('directory.actions')} aria-expanded={listMenu} icon={<IconEllipsisOutline16 />}
            onClick={() => { setListMenu(open => !open) }} />}
          items={[{ id: 'refresh', label: t('status.refresh'), disabled: !connected || statuses.loading || directoryIds.length === 0 }]}
          onSelect={() => { setListMenu(false); void runStatuses({ runIds: directoryIds }) }} />
      </div>
      <ul className={css.runs}>
        {directory.value?.items.map(item => <RunCard key={item.id}>
          <div className={css.runHead} style={{ viewTransitionName: transitionName('clocky-run', item.id) }}>
            {/* Identity sigil from the name, like an avatar; it carries no run data. */}
            <span className={css.sigil} aria-hidden="true">{Array.from(item.name.text)[0] ?? '?'}</span>
            <button type="button" className={css.run}
              onClick={() => { navigateWithTransition(() => { navigate({ runId: item.id, module: 'overview', search: search }) }) }}>
              <strong>{item.name.text}</strong>
              {item.name.truncated && <small>{t('truncate')}</small>}
            </button>
          </div>
          <RunStatus value={statuses.value?.items.find(status => status.run.id === item.id)} connected={connected}
            stale={statuses.stale || statuses.error !== undefined} t={t} />
          <div className={css.runFooter}>
            <small>{t('registration')}: {date(item.registeredAt)}</small>
            <Menu open={rowMenu === item.id} portal align="end" onClose={() => { setRowMenu(undefined) }}
              anchor={<IconButton size="sm" label={`${t('directory.runActions')} ${item.name.text}`} aria-expanded={rowMenu === item.id}
                icon={<IconEllipsisOutline16 />} onClick={() => { setRowMenu(open => open === item.id ? undefined : item.id) }} />}
              items={[{ id: 'copy', label: t('copyId') }]}
              onSelect={() => { setRowMenu(undefined); void writeClipboard(item.id) }} />
          </div>
        </RunCard>)}
      </ul>
      {!directory.loading && directory.error === undefined && directory.value?.items.length === 0
        && (search !== '' || catalog.value?.items.length !== 0)
        && <p className={css.empty}>{t(search ? 'noResults' : 'directory.empty')}</p>}
      {!search && directory.value?.items.length === 0 && catalog.value !== undefined && <section aria-label={t('template')}>
        {catalog.value.items.length === 0 ? <p role="alert">{t('noTemplates')}</p> : <>
          {catalog.value.items.map(template => <p key={template.id}>
            <strong>{template.name.text}</strong> · {template.readiness.status === 'ready'
              ? `${template.readiness.model.provider}/${template.readiness.model.name}`
              : t(template.readiness.status === 'needs-model' ? 'readiness.needs-model' : `readiness.${template.readiness.reason}`)}
          </p>)}
          <Button variant="primary" disabled={!connected} onClick={create}>{t('createTitle')}</Button>
        </>}
      </section>}
      <details className={css.diagnostics}><summary>{t('directory.hostResources')}</summary><ModelPool value={statuses.value?.modelPool} t={t} /></details>
    </div>
    <footer className={css.pagination}><Button disabled={!connected || directory.loading} onClick={refresh}>{t('first')}</Button>
      <Button disabled={!connected || directory.loading || directory.stale || directory.error !== undefined
        || directory.value?.nextCursor === undefined}
      onClick={() => { void readDirectory(search, directory.value?.nextCursor) }}>{t('next')}</Button></footer>
  </>
}

/** One run card; the pointer light follows a fine pointer across it. */
function RunCard({ children }: { children: ReactNode }) {
  const card = useRef<HTMLLIElement>(null)
  usePointerLight(card)
  return <li ref={card}><PointerLight />{children}</li>
}
