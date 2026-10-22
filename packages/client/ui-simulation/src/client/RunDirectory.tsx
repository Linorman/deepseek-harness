/** Bounded run directory; its parent retains read subscriptions and navigation state. */
import { useRef, useState, type ReactNode } from 'react'
import { ConstellationGlyph, navigateWithTransition, PointerLight, transitionName, usePointerLight } from '@clocky/clocky-client-ui-viz'
import { Button, IconButton, IconEllipsisOutline16, Input, Menu, writeClipboard } from '@clocky/clocky-client-ui-primitives'
import type { AgentStatus } from '@clocky/clocky-client-ui-primitives'
import type { SimulationRuntimeState, SimulationProductRunId } from '@clocky/clocky-client-runtime/client'
import type { Injected } from './Workspace.tsx'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'
import { ModelPool } from './RunStatus.tsx'
import { RunDetails } from './RunDetails.tsx'
import { RunStateChip, runStateStatus } from './RunStateChip.tsx'
import { runState } from './run-state.ts'
import type { RunState } from './run-state.ts'
import { Feedback } from './Feedback.tsx'
import css from './Workspace.module.css'

/** Loaded-window filters over synthesized row states; they never read another page. */
type DirectoryFilter = 'all' | 'running' | 'attention' | 'paused' | 'unreadable'
const FILTERS: readonly DirectoryFilter[] = ['all', 'running', 'attention', 'paused', 'unreadable']

/**
 * Filter bucket of one row; stale or unobservable rows are unreadable regardless of their last observation.
 * @param state - Synthesized row state.
 * @returns the bucket that row belongs to.
 */
export function directoryBucket(state: RunState): Exclude<DirectoryFilter, 'all'> {
  if (state.freshness === 'stale') return 'unreadable'
  switch (state.kind) {
    case 'running': case 'stopping': case 'saving': case 'idle': return 'running'
    case 'attention': case 'blocked': case 'failed': return 'attention'
    case 'paused': case 'completed': return 'paused'
    case 'reconciling': case 'unknown': return 'unreadable'
    default: { const unreachable: never = state.kind; throw new Error(`Unknown run state ${String(unreachable)}`) }
  }
}

/**
 * @param props - Authorized directory window, matching status batch and view-only actions.
 * @returns searchable run rows without per-run inspection or a second polling owner.
 */
export function RunDirectory({ directory, statuses, directoryIds, connected, search, draftSearch, searchDraft,
  navigate, refresh, readDirectory, runStatuses, t, date, catalog, create, newWorld, invalidatedRuns = {},
  refreshMs = 2000, staleAfterMs = 30000, locale = 'zh-CN', now = Date.now }: {
  directory: SimulationRuntimeState['directory']
  catalog: SimulationRuntimeState['catalog']
  /** Open World authoring; offered as the first step when no procurement template is installed. */
  newWorld?: (() => void) | undefined
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
  t: (key: Key, params?: Record<string, string>) => string
  date: (value: number) => string
  /** Runs whose retained status a terminal command receipt superseded. */
  invalidatedRuns?: Readonly<Record<string, number>> | undefined
  refreshMs?: number | undefined
  staleAfterMs?: number | undefined
  locale?: string | undefined
  /** Real clock for observation age; tests pin it. */
  now?: (() => number) | undefined
}) {
  const searchForm = useRef<HTMLFormElement>(null)
  const composing = useRef(false)
  const [listMenu, setListMenu] = useState(false)
  const [rowMenu, setRowMenu] = useState<string>()
  const [filter, setFilter] = useState<DirectoryFilter>('all')
  const batchFailed = statuses.error !== undefined || statuses.stale
  const time = now()
  const rows = (directory.value?.items ?? []).map((item) => {
    const status = statuses.value?.items.find(value => value.run.id === item.id)
    const state = runState({ native: status, nativeFailed: batchFailed || invalidatedRuns[item.id] !== undefined,
      connected, now: time, refreshMs, staleAfterMs })
    return { item, status, state }
  })
  const shown = filter === 'all' ? rows : rows.filter(row => directoryBucket(row.state) === filter)
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
        {statuses.error !== undefined && <p role="alert" className={css.listAlert}><span>{t('directory.statusFailed')}</span>
          <Button size="sm" variant="secondary" disabled={!connected || statuses.loading}
            onClick={() => { void runStatuses({ runIds: directoryIds }) }}>{t('directory.retryStatuses')}</Button></p>}
        {directoryIds.length > 0 && <div className={css.directoryFilters} role="group" aria-label={t('directory.filter')}>
          {FILTERS.map(value => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'}
            aria-pressed={filter === value} onClick={() => { setFilter(value) }}>
            {t(`directory.filter.${value}`)}{value === 'all' ? '' : ` · ${String(rows.filter(row => directoryBucket(row.state) === value).length)}`}
          </Button>)}</div>}
        {directoryIds.length > 0 && <Menu open={listMenu} portal align="end" onClose={() => { setListMenu(false) }}
          anchor={<IconButton size="sm" label={t('directory.actions')} aria-expanded={listMenu} icon={<IconEllipsisOutline16 />}
            onClick={() => { setListMenu(open => !open) }} />}
          items={[{ id: 'refresh', label: t('status.refresh'), disabled: !connected || statuses.loading || directoryIds.length === 0 }]}
          onSelect={() => { setListMenu(false); void runStatuses({ runIds: directoryIds }) }} />}
      </div>
      <ul className={css.runs}>
        {shown.map(({ item, status, state }) => <RunCard key={item.id} phase={runStateStatus(state)}>
          <RunStateChip state={state} locale={locale} t={t} />
          <div className={css.runHead} style={{ viewTransitionName: transitionName('clocky-run', item.id) }}>
            <button type="button" className={css.run}
              onClick={() => { navigateWithTransition(() => { navigate({ runId: item.id, module: 'overview', search: search }) }) }}>
              <strong>{item.name.text}</strong>
              {item.name.truncated && <small>{t('truncate')}</small>}
            </button>
            {state.unavailable !== undefined && <small>{t(`state.unavailable.${state.unavailable}`)}</small>}
          </div>
          <div className={css.runFooter}>
            <small>{t('registration')}: {date(item.registeredAt)}</small>
            {status !== undefined && <RunDetails value={status} connected={connected} locale={locale} t={t} />}
            <Menu open={rowMenu === item.id} portal align="end" onClose={() => { setRowMenu(undefined) }}
              anchor={<IconButton size="sm" label={`${t('directory.runActions')} ${item.name.text}`} aria-expanded={rowMenu === item.id}
                icon={<IconEllipsisOutline16 />} onClick={() => { setRowMenu(open => open === item.id ? undefined : item.id) }} />}
              items={[{ id: 'copy', label: t('copyId') }]}
              onSelect={() => { setRowMenu(undefined); void writeClipboard(item.id) }} />
          </div>
        </RunCard>)}
      </ul>
      {rows.length > 0 && shown.length === 0 && <p className={css.empty}>{t('directory.filterEmpty')}</p>}
      {!directory.loading && directory.error === undefined && directory.value?.items.length === 0 && search !== ''
        && <p className={css.empty}>{t('noResults')}</p>}
      {!search && directory.value?.items.length === 0 && catalog.value === undefined && !catalog.loading
        && <p className={css.empty}>{t('directory.empty')}</p>}
      {/* The empty directory is a stage, not a line of grey text: what a run is, then the ways to start one. */}
      {!search && directory.value?.items.length === 0 && catalog.value !== undefined && <section className={css.emptyStage} aria-label={t('template')}>
        <span className={css.emptyGlyph}><ConstellationGlyph points={EMPTY_STARS} label={t('directory.emptyTitle')} size={128} /></span>
        <div className={css.emptyBody}>
          <h2>{t('directory.emptyTitle')}</h2>
          {catalog.value.items.length === 0 ? newWorld === undefined ? <p role="alert">{t('noTemplates')}</p>
            : <><p>{t('world.directory.empty')}</p>
              <div className={css.actions}><Button variant="primary" disabled={!connected} onClick={newWorld}>{t('world.new')}</Button></div></> : <>
            <p>{t('directory.empty')}</p>
            <ul className={css.templateCards}>{catalog.value.items.map(template => <li key={template.id}>
              <strong>{template.name.text}</strong>
              <span className={css.readiness} data-ready={template.readiness.status === 'ready' || undefined}>{template.readiness.status === 'ready'
                ? `${template.readiness.model.provider}/${template.readiness.model.name}`
                : t(template.readiness.status === 'needs-model' ? 'readiness.needs-model' : `readiness.${template.readiness.reason}`)}</span>
            </li>)}</ul>
            <div className={css.actions}><Button variant="primary" disabled={!connected} onClick={create}>{t('createTitle')}</Button>
              {newWorld !== undefined && <Button variant="secondary" disabled={!connected} onClick={newWorld}>{t('world.new')}</Button>}</div>
          </>}
        </div>
      </section>}
      <details className={css.diagnostics}><summary>{t('directory.hostResources')}</summary><ModelPool value={statuses.value?.modelPool} t={t} /></details>
    </div>
    <footer className={css.pagination}><Button disabled={!connected || directory.loading} onClick={refresh}>{t('first')}</Button>
      <Button disabled={!connected || directory.loading || directory.stale || directory.error !== undefined
        || directory.value?.nextCursor === undefined}
      onClick={() => { void readDirectory(search, directory.value?.nextCursor) }}>{t('next')}</Button></footer>
  </>
}

/** Decorative stars for the empty directory; they stand for nothing loaded. */
const EMPTY_STARS = Array.from({ length: 9 }, (_, index) => ({ id: `star-${String(index)}` }))

/** One run row; the pointer light follows a fine pointer across it and a thin edge echoes the synthesized state. */
function RunCard({ children, phase }: { children: ReactNode; phase: AgentStatus | undefined }) {
  const card = useRef<HTMLLIElement>(null)
  usePointerLight(card)
  return <li ref={card} data-phase={phase}><PointerLight />{children}</li>
}
