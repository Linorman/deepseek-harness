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
import css from './Workspace.module.css'

type Props = Pick<Injected, 'pageSize' | 'watchSource' | 'inspectSource' | 'refreshSource' | 'navigateApplication' | 'inspectObject' | 'browse'> & {
  view: Route & { module: Exclude<Module, 'overview' | 'records' | 'requests'> }
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
  t: (key: Key) => string
}

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
    if (listScroll.current !== null) listScroll.current.scrollTop = props.position
  }, [runId, view.module, view.status, view.cognition, view.entityId, view.decisionId])
  useLayoutEffect(() => {
    if (view.objectId !== undefined && view.sourceIndex === undefined) inspector.current?.querySelector('h2')?.focus()
    else if (view.objectId === undefined && previousObject.current !== undefined && previousObject.current.runId === runId
      && previousObject.current.module === view.module) {
      if (listScroll.current !== null) listScroll.current.scrollTop = props.position
      const buttons = listScroll.current?.querySelectorAll<HTMLButtonElement>('[data-simulation-object]')
      const origin = [...buttons ?? []].find(button => button.dataset.simulationObject === previousObject.current?.id)
      const fallback = frame.current?.querySelector<HTMLButtonElement>('[data-simulation-filters] button')
      ;(origin ?? fallback)?.focus()
    }
    previousObject.current = view.objectId === undefined ? undefined : { runId, module: view.module, id: view.objectId }
  }, [runId, view.module, view.objectId])
  useLayoutEffect(() => {
    if (view.sourceIndex === undefined && frame.current !== null && !data.object.loading
      && (object !== undefined || data.object.error !== undefined)) restoreWorkspaceFocus(frame.current)
  }, [view.sourceIndex, object, data.object.loading, data.object.error])
  return <div ref={frame} className={css.body} data-detail={view.objectId !== undefined || view.recordSequence !== undefined || undefined}>
    <div className={css.tablePanel}>
      <CollectionFilters key={`${runId}:${view.module}`} view={view} change={navigate} t={t} />
      {page !== undefined && <p className={css.count}>{t('total')}: {page.total} · {t('revision')}: {page.snapshotRevision}</p>}
      <div className={css.scroll} ref={listScroll} onScroll={(event) => {
        if (event.currentTarget.getClientRects().length > 0) props.rememberScroll(event.currentTarget.scrollTop)
      }}>
        {page !== undefined && <CollectionTable page={page} selected={view.objectId} t={t} date={date}
          open={(objectId) => { navigate({ ...view, objectId, section: undefined }) }} />}
        {!current.loading && current.error === undefined && page?.items.length === 0 && <p className={css.empty}>{t(view.status !== undefined || view.cognition !== undefined || view.entityId !== undefined || view.decisionId !== undefined ? 'noMatchingRecords' : 'emptyCollection')}</p>}
      </div>
      <footer className={css.pagination}><Button disabled={!data.connected || current.loading} onClick={refresh}>{t('first')}</Button>
        <Button disabled={!data.connected || current.loading || current.stale || current.error !== undefined
              || page?.nextCursor === undefined}
        onClick={() => { if (collection !== undefined) void props.browse({ ...collection, cursor: page?.nextCursor }) }}>{t('next')}</Button></footer>
    </div>
    {view.objectId !== undefined && <aside ref={inspector} className={css.inspector} aria-label={t('view')}>
      <ObjectHeading key={`${runId}:${view.module}:${view.objectId}`} name={objectName} domain={t(view.module)} t={t}
        close={() => { navigate({ ...view, objectId: undefined, section: undefined,
          knowledgeId: undefined, knowledgeRevision: undefined }) }} />
      {view.sourceIndex !== undefined ? <SourceDetails view={{ ...view, runId, objectId: view.objectId, sourceIndex: view.sourceIndex }}
        data={data} pageSize={props.pageSize}
        watch={props.watchSource} read={props.inspectSource} refresh={props.refreshSource} navigate={navigate}
        navigateApplication={props.navigateApplication} t={t} date={date} /> : <>
        {detailSections[view.module].length > 1 && <nav className={css.actions} aria-label={t('detailSections')}>
          {detailSections[view.module].map(section => <Button key={section}
            aria-current={(view.section ?? detailSections[view.module][0]) === section ? 'page' : undefined}
            onClick={() => { navigate({ ...view, section: section === 'attempts' || section === 'relationships' || section === 'context' || section === 'knowledge' ? section : undefined }) }}>{t(section === 'context' ? 'contextView' : section)}</Button>)}
        </nav>}
        <Feedback value={data.object} t={t} />
        <Button disabled={!data.connected || data.object.loading} onClick={() => {
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
