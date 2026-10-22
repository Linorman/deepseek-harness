/** Shared collection geometry, paging and inspector focus; domain rows remain in CollectionTable. */
import { useLayoutEffect, useRef } from 'react'
import type { SimulationProductCollectionPage, SimulationProductObjectInspection, SimulationProductBrowseInput,
  SimulationProductObjectInput, SimulationProductRunId, SimulationRuntimeState, SimulationReadState,
  SimulationProductCursor } from '@clocky/clocky-client-runtime/client'
import { restoreWorkspaceFocus } from '@clocky/clocky-client-ui-layout/client'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { Injected } from './Workspace.tsx'
import type { Route, Module } from './store.ts'
import type { Key } from './locales.ts'
import { CollectionTable } from './CollectionTable.tsx'
import { CollectionFilters } from './CollectionFilters.tsx'
import { ObjectHeading } from './ObjectHeading.tsx'
import { ObjectDetails } from './ObjectDetails.tsx'
import { SourceDetails } from './SourceDetails.tsx'
import { Feedback } from './Feedback.tsx'
import { prefersReducedMotion, tokenDuration, ViewSwitch } from '@clocky/clocky-client-ui-viz'
import { CheckpointRail, EffectsView, TimelineView, WorldView } from './Visuals.tsx'
import css from './Workspace.module.css'

type Props = Pick<Injected, 'pageSize' | 'watchSource' | 'inspectSource' | 'refreshSource' | 'navigateApplication' | 'inspectObject' | 'browse'> & {
  view: Route & { module: Exclude<Module, 'overview' | 'records' | 'requests' | 'cases' | 'organization' | 'governance' | 'external'> }
  runId: SimulationProductRunId
  data: SimulationRuntimeState
  page?: SimulationProductCollectionPage | undefined
  object?: SimulationProductObjectInspection | undefined
  objectName: string
  current: SimulationReadState<unknown>
  collection?: SimulationProductBrowseInput | undefined
  selection?: SimulationProductObjectInput | undefined
  position: number
  rememberScroll: (value: number) => void
  navigate: (view: Route) => void
  refresh: () => void
  readObjectPage: (cursor?: SimulationProductCursor) => void
  openRetry: (id: string, attempts: number) => void
  date: (value: number) => string
  t: (key: Key, vars?: Record<string, unknown>) => string
}

const visualLabel = { entities: 'visual.entities', decisions: 'visual.decisions', operations: 'visual.operations',
  checkpoints: 'visual.checkpoints' } as const satisfies Record<string, Key>

const detailSections = { entities: ['identity', 'relationships', 'knowledge'], decisions: ['execution', 'context', 'knowledge'],
  operations: ['execution', 'attempts'], checkpoints: ['references'] } as const

/**
 * @param props - Scoped reads and view-only navigation from the workspace owner.
 * @returns one collection frame with accessible detail return.
 */
export function CollectionWorkspace(props: Props) {
  const { view, runId, data, page, object, objectName, current, collection, selection,
    navigate, refresh, readObjectPage, openRetry, t, date } = props
  const listScroll = useRef<HTMLDivElement>(null)
  const inspector = useRef<HTMLElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const previousObject = useRef<{ runId: string | undefined; module: Module; id: string }>()
  useLayoutEffect(() => {
    /* v8 ignore next -- The scroll div is rendered unconditionally before layout effects run. */
    if (listScroll.current !== null) listScroll.current.scrollTop = props.position
  },
  [runId, view.module, view.status, view.cognition, view.entityId, view.decisionId])
  useLayoutEffect(() => {
    if (view.objectId !== undefined && view.sourceIndex === undefined) inspector.current?.querySelector('h2')?.focus()
    else if (view.objectId === undefined && previousObject.current !== undefined && previousObject.current.runId === runId
      && previousObject.current.module === view.module) {
      const scroll = listScroll.current
      /* v8 ignore next -- Return focus runs while the same mounted scroll div remains present. */
      if (scroll === null) return
      scroll.scrollTop = props.position
      const origin = [...scroll.querySelectorAll<HTMLButtonElement>(`[data-simulation-object="${previousObject.current.id}"]`)][0]
      const fallback = frame.current?.querySelector<HTMLButtonElement>('[data-simulation-filters] button')
      ;(origin ?? fallback)?.focus()
    }
    previousObject.current = view.objectId === undefined ? undefined : { runId, module: view.module, id: view.objectId }
  }, [runId, view.module, view.objectId])
  useLayoutEffect(() => {
    if (view.sourceIndex === undefined && !data.object.loading
      && (object !== undefined || data.object.error !== undefined) && frame.current !== null) restoreWorkspaceFocus(frame.current)
  }, [view.sourceIndex, object, data.object.loading, data.object.error])
  // The switch crossfade plays only after the user toggles; restored routes paint settled.
  const switched = useRef(false)
  useLayoutEffect(() => {
    const scroll = listScroll.current
    if (!switched.current || scroll === null || typeof scroll.animate !== 'function') return
    const reduced = prefersReducedMotion()
    scroll.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: tokenDuration(scroll, reduced ? '--clocky-duration-fade' : '--clocky-duration-base', 200), easing: 'cubic-bezier(0, 0, 0, 1)' })
  }, [view.display])
  const openObject = (objectId: string) => { navigate({ ...view, objectId, section: undefined }) }
  const visual = (current: SimulationProductCollectionPage) => {
    const world = data.run.value?.run.id === runId ? data.run.value.world : undefined
    switch (current.collection) {
      case 'entities': return <WorldView page={current} runId={runId} selected={view.objectId} open={openObject} t={t} />
      case 'decisions': return <TimelineView page={current} now={world?.time} unit={world?.tickUnit.text} selected={view.objectId} open={openObject} t={t} />
      case 'operations': return <EffectsView page={current} selected={view.objectId} open={openObject} t={t} />
      case 'checkpoints': return <CheckpointRail page={current} selected={view.objectId} open={openObject} date={date} t={t} />
      default: {
        const unreachable: never = current
        throw new Error(`Unknown Simulation collection: ${String(unreachable)}`)
      }
    }
  }
  return <div ref={frame} className={css.body} style={{ viewTransitionName: 'clocky-module' }} data-detail={view.objectId !== undefined || view.recordSequence !== undefined || undefined}>
    <div className={css.tablePanel}>
      <CollectionFilters key={`${runId}:${view.module}`} view={view} change={navigate} t={t} />
      <div className={css.collectionMeta}>
        {page !== undefined && <p className={css.count}>{t('total')}: {page.total} · {t('revision')}: {page.snapshotRevision}</p>}
        <ViewSwitch label={t('visual.switch')} value={view.display ?? 'table'}
          options={[{ id: 'table', label: t('visual.table') }, { id: 'visual', label: t(visualLabel[view.module]) }]}
          onChange={(display) => { switched.current = true; navigate({ ...view, display: display === 'visual' ? 'visual' : undefined }) }} />
      </div>
      <div className={css.scroll} ref={listScroll}
        onScroll={(event) => { props.rememberScroll(event.currentTarget.scrollTop) }}>
        {page !== undefined && (view.display === 'visual' ? visual(page) : <CollectionTable page={page} selected={view.objectId} t={t} date={date}
          open={(objectId) => { navigate({ ...view, objectId, section: undefined }) }} />)}
        {current.error === undefined && page?.items.length === 0 && <p className={css.empty}>{t(view.status !== undefined || view.cognition !== undefined || view.entityId !== undefined || view.decisionId !== undefined ? 'noMatchingRecords' : 'emptyCollection')}</p>}
      </div>
      <footer className={css.pagination}><Button disabled={!data.connected || current.loading} onClick={refresh}>{t('first')}</Button>
        <Button disabled={!data.connected || current.loading || current.stale || current.error !== undefined || collection === undefined
              || page?.nextCursor === undefined}
        onClick={() => {
          /* v8 ignore next -- The continuation button is disabled without a collection selector. */
          if (collection !== undefined) void props.browse({ ...collection, cursor: page?.nextCursor })
        }}>{t('next')}</Button></footer>
    </div>
    {view.objectId !== undefined && <aside ref={inspector} className={css.inspector} aria-label={t('view')}>
      <ObjectHeading key={`${runId}:${view.module}:${view.objectId}`} name={objectName} domain={t(view.module)} t={t}
        close={() => { navigate({ ...view, objectId: undefined, section: undefined,
          knowledgeId: undefined, knowledgeRevision: undefined }) }} />
      {view.sourceIndex !== undefined ? <SourceDetails view={{ ...view, runId, objectId: view.objectId, sourceIndex: view.sourceIndex }}
        data={data} pageSize={props.pageSize}
        watch={props.watchSource} read={props.inspectSource} refresh={props.refreshSource} navigate={navigate}
        navigateApplication={props.navigateApplication} t={t} date={date} /> : <>
        {detailSections[view.module].length > 1 && <nav className={css.segmented} aria-label={t('detailSections')}>
          {detailSections[view.module].map(section => <Button key={section}
            aria-current={(view.section ?? detailSections[view.module][0]) === section ? 'page' : undefined}
            onClick={() => { navigate({ ...view, section: section === 'identity' || section === 'execution' || section === 'references'
              ? undefined : section }) }}>{t(section === 'context' ? 'contextView' : section)}</Button>)}
        </nav>}
        <Feedback value={data.object} t={t} />
        <Button size="sm" variant="ghost" className={css.detailRefresh} disabled={!data.connected || data.object.loading || selection === undefined}
          onClick={() => {
            /* v8 ignore next -- The refresh button is disabled without an exact object selector. */
            if (selection !== undefined) void props.inspectObject(selection)
          }}>{t('refreshDetail')}</Button>
        {object !== undefined && <p className={css.count}>{t('revision')}: {object.snapshotRevision}</p>}
        {object?.status === 'missing' && <p>{t('detailMissing')}</p>}
        {object?.value !== undefined && <ObjectDetails key={`${object.selection.collection}:${object.selection.id}:${object.selection.section}`}
          value={object.value} t={t} date={date} view={view} navigate={navigate} readPage={readObjectPage}
          navigateApplication={props.navigateApplication} openRetry={openRetry}
          blocked={!data.connected || data.object.loading} canContinue={!data.object.stale && data.object.error === undefined} />}
      </>}
    </aside>}
  </div>
}
