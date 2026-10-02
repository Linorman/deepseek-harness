/** Bounded run directory; its parent retains read subscriptions and navigation state. */
import { useRef } from 'react'
import { Button, Input } from '@clocky/clocky-client-ui-primitives'
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
  navigate, refresh, readDirectory, runStatuses, t, date }: {
  directory: SimulationRuntimeState['directory']
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
  return <>
    <form ref={searchForm} className={css.search} noValidate onSubmit={(event) => {
      event.preventDefault(); if (composing.current) return
      navigate({ module: 'overview', search: draftSearch.trim() })
    }}>
      <label htmlFor="simulation-search">{t('search')}</label>
      <Input id="simulation-search" value={draftSearch}
        onChange={(event) => { searchDraft(event.target.value) }}
        onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
      <Button variant="outline" type="submit" disabled={!connected}>{t('searchButton')}</Button>
      {draftSearch !== '' && <Button aria-label={t('clear')} onClick={() => {
        navigate({ module: 'overview', search: '' }); searchForm.current?.querySelector('input')?.focus()
      }}>{t('clear')}</Button>}
    </form>
    <div className={css.scroll}>
      <Feedback value={statuses} t={t} />
      <Button disabled={!connected || statuses.loading || directoryIds.length === 0}
        onClick={() => { void runStatuses({ runIds: directoryIds }) }}>{t('status.refresh')}</Button>
      <ul className={css.runs}>
        {directory.value?.items.map(item => <li key={item.id}>
          <button type="button" className={css.run} onClick={() => { navigate({ runId: item.id, module: 'overview', search: search }) }}>
            <strong>{item.name.text}</strong>
            {item.name.truncated && <small>{t('truncate')}</small>}
          </button>
          <RunStatus value={statuses.value?.items.find(status => status.run.id === item.id)} connected={connected}
            stale={statuses.stale || statuses.error !== undefined} t={t} />
          <details className={css.diagnostics}><summary>{t('object.technical')}</summary>
            <code>{item.id}</code><p>{t('registration')}: {date(item.registeredAt)}</p>
          </details>
        </li>)}
      </ul>
      {!directory.loading && directory.error === undefined && directory.value?.items.length === 0
        && <p className={css.empty}>{t(search ? 'noResults' : 'directory.empty')}</p>}
      <details className={css.diagnostics}><summary>{t('directory.hostResources')}</summary><ModelPool value={statuses.value?.modelPool} t={t} /></details>
    </div>
    <footer className={css.pagination}><Button disabled={!connected || directory.loading} onClick={refresh}>{t('first')}</Button>
      <Button disabled={!connected || directory.loading || directory.stale || directory.error !== undefined
        || directory.value?.nextCursor === undefined}
      onClick={() => { void readDirectory(search, directory.value?.nextCursor) }}>{t('next')}</Button></footer>
  </>
}
