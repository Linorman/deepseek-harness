/** Journal metadata and deliberate original inspection share runtime-owned pages, never React business caches. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { observationVersion, useObservedRefresh } from './useObservedRefresh.ts'
import { Button, Input, Menu, IconChevronDownOutline14, IconButton, IconCloseOutline16 } from '@clocky/clocky-client-ui-primitives'
import { simulationRecordsScope } from '@clocky/clocky-client-runtime/client'
import type { SimulationRuntimeState, SimulationProductRecordsInput, SimulationProductRunId, SimulationReadState,
  SimulationRecordExportState } from '@clocky/clocky-client-runtime/client'
import type { SnapshotSelectorHook } from '@clocky/clocky-client-ui-slots'
import type { Route } from './store.ts'
import type { Key } from './locales.ts'
import css from './Workspace.module.css'
import { InfoHint } from './WorldFacts.tsx'
import { recordKinds, recordKindLabel } from './record-kinds.ts'
type Query = Omit<SimulationProductRecordsInput, 'limit' | 'cursor' | 'expectedRevision'>

/**
 * @param props - Exact URL selection, framework snapshots and bounded read/export callbacks.
 * @returns metadata table, optional original text inspector and explicit all-matching export controls.
 */
export function RecordsView({ view, data, pageSize, read, close, navigate, exportRecords, cancelExport, useExport, t }: {
  view: Route
  data: SimulationRuntimeState
  pageSize: number
  read: (input: SimulationProductRecordsInput) => Promise<void>
  close: (originalOnly?: boolean) => void
  navigate: (route: Route) => void
  exportRecords: (input: Query) => Promise<void>
  cancelExport: () => void
  useExport: SnapshotSelectorHook<SimulationRecordExportState>
  t: (key: Key) => string
}) {
  const runId = view.runId as SimulationProductRunId
  const [kind, setKind] = useState(view.recordKind ?? '')
  const [kindMenu, setKindMenu] = useState(false)
  const inspector = useRef<HTMLElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const previous = useRef<number>()
  const composing = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const progress = useExport(value => value)
  const exported: SimulationRecordExportState = progress.runId === runId ? progress : { pending: false, status: 'idle', records: 0, bytes: 0 }
  const policy = data.observation.value?.runId === runId ? data.observation.value.readVersion : undefined
  const query: Query = { runId, mode: 'metadata', kind: view.recordKind }
  const original: Query = { runId, mode: 'original', sequence: view.recordSequence }
  const list = data.records.scope === simulationRecordsScope(query) ? data.records : undefined
  const detail = data.record.scope === simulationRecordsScope(original) ? data.record : undefined
  const blocked = !data.connected || policy === undefined
  useObservedRefresh(observationVersion(data, runId), list?.loading === true, () => {
    if (!blocked) void read({ ...query, limit: pageSize })
  }, list?.stale)
  useEffect(() => { setKind(view.recordKind ?? '') }, [view.recordKind])
  useEffect(() => {
    if (!blocked) void read({ runId, mode: 'metadata', kind: view.recordKind, limit: pageSize })
  }, [blocked, data.generation, runId, view.recordKind, policy, pageSize, read])
  useEffect(() => {
    if (view.recordSequence === undefined) { close(true); return }
    if (!blocked) void read({ runId, mode: 'original', sequence: view.recordSequence, limit: pageSize })
  }, [blocked, data.generation, runId, view.recordSequence, policy, pageSize, read, close])
  useEffect(() => () => { cancelExport(); close() }, [runId, view.recordKind, close, cancelExport])
  useLayoutEffect(() => {
    if (view.recordSequence !== undefined) inspector.current?.querySelector('h2')?.focus()
    else if (previous.current !== undefined) {
      // This scroll region is always rendered; React attaches its ref before layout effects.
      const origin = [...(rows.current as HTMLDivElement).querySelectorAll<HTMLButtonElement>('[data-record-sequence]')]
        .find(button => button.dataset.recordSequence === String(previous.current))
      ;(origin ?? form.current?.querySelector('input'))?.focus()
    }
    previous.current = view.recordSequence
  }, [runId, view.recordSequence])
  const first = () => read({ ...query, limit: pageSize })
  const readOriginal = (next = false) => read({ ...original, limit: pageSize,
    ...!next ? {} : { cursor: detail?.value?.nextCursor, expectedRevision: detail?.value?.snapshotRevision } })
  return <div className={css.body} data-detail={view.recordSequence !== undefined || undefined}>
    <section className={css.tablePanel} aria-label={t('records')}>
      <form className={css.search} ref={form} noValidate onSubmit={(event) => {
        event.preventDefault(); if (composing.current) return
        navigate({ ...view, recordKind: kind || undefined, recordSequence: undefined })
      }}>
        <Menu open={kindMenu} portal selectedId={view.recordKind ?? '@all'}
          items={[{ id: '@all', label: t('all') }, ...recordKinds.map(([id, key]) => ({ id, label: `${t(key)} · ${id}` }))]}
          anchor={<Button variant="secondary" aria-expanded={kindMenu} onClick={() => { setKindMenu(!kindMenu) }}>
            {t('records.chooseType')}<IconChevronDownOutline14 /></Button>}
          onClose={() => { setKindMenu(false) }} onSelect={(id) => {
            setKindMenu(false); setKind(id === '@all' ? '' : id)
            navigate({ ...view, recordKind: id === '@all' ? undefined : id, recordSequence: undefined })
          }} />
        <label htmlFor="simulation-record-kind">{t('recordKind')}</label>
        <Input id="simulation-record-kind" value={kind} maxLength={128} onChange={(event) => { setKind(event.target.value) }}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} />
        <Button type="submit" disabled={blocked}>{t('searchButton')}</Button>
        {kind !== '' && <Button onClick={() => {
          setKind(''); navigate({ ...view, recordKind: undefined, recordSequence: undefined }); form.current?.querySelector('input')?.focus()
        }}>{t('clearFilters')}</Button>}
        <InfoHint label={t('world.hint')} text={t('recordOrder')} />
      </form>

      {list?.value !== undefined && <p>{t('total')}: {list.value.totalRecords} · {t('revision')}: {list.value.snapshotRevision}</p>}
      <RecordFeedback value={list} t={t} />
      <div className={css.scroll} ref={rows}>
        <table><thead><tr><th>{t('recordSequence')}</th><th>{t('recordKind')}</th><th>{t('recordAction')}</th><th>{t('view')}</th></tr></thead>
          <tbody>{list?.value?.items.map(item => <tr key={item.sequence} data-selected={item.sequence === view.recordSequence || undefined}><td>{item.sequence}</td><td>{recordKindLabel(item.kind.text, t, item.kind.truncated)}{recordKindLabel(item.kind.text, t, item.kind.truncated) !== item.kind.text && <small><code>{item.kind.text}</code></small>}{item.kind.truncated && <small>{t('truncate')}</small>}</td>
            <td>{item.action?.text ?? t('none')}{item.action?.truncated && <small>{t('truncate')}</small>}</td><td><Button data-record-sequence={item.sequence} aria-current={item.sequence === view.recordSequence ? 'true' : undefined} aria-label={`${t('recordOriginal')}: ${item.sequence}`}
              onClick={() => { navigate({ ...view, recordSequence: item.sequence }) }}>{t('recordOriginal')}</Button></td></tr>)}</tbody>
        </table>
        {list?.value?.items.length === 0 && list.error === undefined && <p>{t(view.recordKind === undefined ? 'emptyCollection' : 'noMatchingRecords')}</p>}
      </div>
      <footer className={css.pagination}><Button disabled={blocked || list?.loading} onClick={() => { void first() }}>{t('first')}</Button>
        <Button disabled={blocked || list?.loading || list?.stale || list?.error !== undefined || list?.value?.nextCursor === undefined}
          onClick={() => { void read({ ...query, limit: pageSize, cursor: list?.value?.nextCursor, expectedRevision: list?.value?.snapshotRevision }) }}>{t('next')}</Button></footer>
      <section className={css.exportCard} aria-label={t('exportMetadata')}><div className={css.actions}>
        <Button disabled={blocked || exported.pending} onClick={() => { void exportRecords(query) }}>{t('exportMetadata')}</Button>
        <Button disabled={blocked || exported.pending || list?.stale || list?.error !== undefined
          || list?.value?.readVersion !== policy || list.value.bodyAccess !== 'allowed'}
        onClick={() => { void exportRecords({ ...query, mode: 'original' }) }}>{t('exportOriginal')}</Button>
        {exported.pending && <Button onClick={cancelExport}>{t('exportCancel')}</Button>}
      </div>
      <p className={css.muted}>{t('exportScope')}</p>
      {list?.value?.bodyAccess === 'withheld' && <p>{t('recordWithheld')}</p>}
      <div aria-live="polite">
        {exported.status !== 'idle' && <p>{t(exported.status === 'running' ? 'exportRunning' : exported.status === 'completed'
          ? 'exportCompleted' : exported.status === 'cancelled' ? 'exportCancelled' : 'exportFailed')} · {exported.records} · {exported.bytes} B</p>}
        {exported.error !== undefined && <p role="alert">{t(exported.error)}</p>}
      </div></section>
    </section>
    {view.recordSequence !== undefined && <aside ref={inspector} className={css.inspector} aria-label={t('recordOriginal')}>
      <header className={css.objectHeading}><div className={css.objectHeadingTop}><p className={css.objectDomain}>{t('records')}</p>
        <IconButton size="sm" label={t('close')} icon={<IconCloseOutline16 />} onClick={() => { navigate({ ...view, recordSequence: undefined }) }} /></div>
      <h2 tabIndex={-1}>{t('recordSequence')}: {view.recordSequence}</h2></header>
      {exported.pending && <Button onClick={cancelExport}>{t('exportCancel')}</Button>}
      <RecordFeedback value={detail} t={t} />
      <Button disabled={blocked || detail?.loading} onClick={() => { void readOriginal() }}>{t('refreshDetail')}</Button>
      {detail?.value?.bodyAccess === 'withheld' && <p>{t('recordWithheld')}</p>}
      {detail?.value?.items.length === 0 && <p>{t('detailMissing')}</p>}
      {detail?.value?.items.map(item => <div key={`${item.sequence}:${item.body.status === 'text' ? item.body.part : 'withheld'}`}>
        <p>{recordKindLabel(item.kind.text, t, item.kind.truncated)} · <code>{item.kind.text}</code>{item.action === undefined ? '' : ` · ${item.action.text}`}</p>
        {item.body.status === 'text' && <><p>{t('contextPart')}: {item.body.part + 1} / {item.body.parts}</p>
          <pre className={css.contextText}>{item.body.text}</pre></>}
      </div>)}
      <Button disabled={blocked || detail?.loading || detail?.stale || detail?.error !== undefined
        || detail?.value?.nextCursor === undefined}
      onClick={() => { void readOriginal(true) }}>{t('next')}</Button>
    </aside>}
  </div>
}
function RecordFeedback({ value, t }: { value?: SimulationReadState<unknown> | undefined; t: (key: Key) => string }) {
  return <div aria-live="polite">{value?.error !== undefined ? <p role="alert">{t(value.error)}</p>
    : value?.loading && value.value === undefined ? <p>{t('loading')}</p> : null}</div>
}
