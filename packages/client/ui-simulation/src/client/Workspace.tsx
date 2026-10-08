import { RunDirectory } from './RunDirectory.tsx'
import { CollectionWorkspace } from './CollectionWorkspace.tsx'
import { Feedback } from './Feedback.tsx'
import { OperationRetry } from './OperationRetry.tsx'
import { operationRetryDraftKey } from './store.ts'
import { NeedsYou } from './NeedsYou.tsx'
import { RunOverview } from './RunOverview.tsx'
import { RunStatus, driverStatus } from './RunStatus.tsx'
import { Moment, navigateWithTransition, transitionDirection, transitionName, useLiveTransition } from '@clocky/clocky-client-ui-viz'
import visualsCss from './Visuals.module.css'
import { TaskReviews } from './TaskReviews.tsx'
import { PersistentRequests } from './PersistentRequests.tsx'
import { TaskControls } from './TaskControls.tsx'
import { taskCancelDraftKey } from './store.ts'
import { RecordsView } from './RecordsView.tsx'
/** Simulation product pages consume framework-bound business snapshots and view-only store actions. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PropsRuntime, PropsStore, PropsLocale, PropsRenderSlots, SnapshotSelectorHook } from '@clocky/clocky-client-ui-slots'
import { Button, Menu, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import type { SimulationRuntimeState, SimulationProductRunId, SimulationProductBrowseInput,
  SimulationProductObjectInput, SimulationReadState, SimulationProductCursor, SimulationAdministrationState, SimulationCommandKey, SimulationCommand, SimulationCommandState, SimulationProductControl } from '@clocky/clocky-client-runtime/client'
import type { createSimulationStore, Module } from './store.ts'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import { CreationDialog } from './CreationDialog.tsx'
import { MaintenanceDialog } from './MaintenanceDialog.tsx'
import { Controls } from './Controls.tsx'
import { CommandRecord } from './CommandRecord.tsx'
import { route, writeRoute } from './store.ts'
import { collectionInput, objectInput } from './selection.ts'
import css from './Workspace.module.css'
import { WORKSPACE_NAVIGATION_EVENT } from '@clocky/clocky-client-ui-layout/client'

/** Narrow injected operations contain no services or custom hooks. */
export interface Injected {
  unknownOperations: (runId: SimulationProductRunId, limit: number) => Promise<void>
  runStatuses: (input: import('@clocky/clocky-client-runtime/client').SimulationProductRunStatusesInput) => Promise<void>
  listTaskReviews: (input: import('@clocky/clocky-client-runtime/client').SimulationProductTaskReviewListInput) => Promise<void>
  listTasks: (input: import('@clocky/clocky-client-runtime/client').SimulationProductTasksInput) => Promise<void>
  listRequests: (input: import('@clocky/clocky-client-runtime/client').SimulationProductRequestsInput) => Promise<void>
  navigateApplication: (href: string) => void
  watchSource: (input: import('@clocky/clocky-client-runtime/client').SimulationProductSourceInput) => () => void
  inspectSource: (input: import('@clocky/clocky-client-runtime/client').SimulationProductSourceInput) => Promise<void>
  refreshSource: () => Promise<void>
  readRecords: (input: import('@clocky/clocky-client-runtime/client').SimulationProductRecordsInput) => Promise<void>
  closeRecords: (originalOnly?: boolean) => void
  exportRecords: (input: Omit<import('@clocky/clocky-client-runtime/client').SimulationProductRecordsInput, 'cursor' | 'limit' | 'expectedRevision'>) => Promise<void>
  cancelExport: () => void
  useRecordsExport: SnapshotSelectorHook<import('@clocky/clocky-client-runtime/client').SimulationRecordExportState>
  useSimulation: SnapshotSelectorHook<SimulationRuntimeState>
  useAdministration: SnapshotSelectorHook<SimulationAdministrationState>
  maxDraftBytes: number
  controlRefreshMs: number
  observe: (runId: SimulationProductRunId) => () => void
  catalog: () => Promise<void>
  preflight: (input: import('@clocky/clocky-client-runtime/client').SimulationProductPreflightInput) => Promise<SimulationReadState<import('@clocky/clocky-client-runtime/client').SimulationProductPreflightResult> | undefined>
  closePreflight: () => void
  control: (runId: SimulationProductRunId) => Promise<void>
  retain: (command: SimulationCommand, authorizationVersion: number) => SimulationCommandKey
  submit: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  query: (key: SimulationCommandKey) => Promise<SimulationCommandState | undefined>
  release: (key: SimulationCommandKey) => boolean
  useFormatLocale: SnapshotSelectorHook<{ active: string }>
  pageSize: number
  directory: (search: string, cursor?: SimulationProductCursor) => Promise<void>
  inspect: (runId: SimulationProductRunId) => Promise<void>
  browse: (input: SimulationProductBrowseInput) => Promise<void>
  readRecovery: (input: Extract<SimulationProductObjectInput, { collection: 'checkpoints' }>) => Promise<void>
  closeRecovery: () => void
  inspectObject: (input: SimulationProductObjectInput) => Promise<void>
  closeObject: () => void
  pause: () => void
}
/** Framework shares derive visibility, translations and the view store. */
export type Props = PropsRuntime<'simulation.workspace'> & PropsStore<ReturnType<typeof createSimulationStore>>
  & PropsLocale<'simulation'> & PropsRenderSlots<'settings.model-setup'> & Injected
const modules: Module[] = ['overview', 'entities', 'decisions', 'operations', 'checkpoints', 'records', 'requests']


/**
 * @param props - Framework shares plus bounded runtime reads and original commands.
 * @returns one product workspace with explicit original management requests.
 */
export function Workspace(props: Props) {
  const view = props.useStore(state => state)
  const data = props.useSimulation(state => state)
  const administration = props.useAdministration(state => state)
  const creationContext = useRef({ visible: props.visible, data, view })
  creationContext.current = { visible: props.visible, data, view }
  const returnFromModelSetup = () => {
    const authorizationVersion = data.authorizationVersion
    void props.catalog().then(() => {
      const latest = creationContext.current
      if (!latest.visible || !latest.data.connected || latest.data.authorizationVersion !== authorizationVersion) return
      if (latest.view.creation !== undefined) props.actions.creation({ ...latest.view.creation, recheckAfterModelSetup: true })
      props.actions.creating(true)
    })
  }
  const locale = props.useFormatLocale(state => state.active) === 'zh' ? 'zh-CN' : 'en-US'
  const date = (value: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  const [moduleMenu, setModuleMenu] = useState(false)
  const [moreMenu, setMoreMenu] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const runId = view.runId as SimulationProductRunId | undefined
  const collection = runId === undefined || (view.module === 'overview' || view.module === 'records' || view.module === 'requests') ? undefined
    : collectionInput({ ...view, runId, module: view.module }, props.pageSize)
  const selection = runId === undefined || view.module === 'overview' || view.module === 'records' || view.module === 'requests' || view.objectId === undefined ? undefined
    : objectInput({ ...view, runId, module: view.module, objectId: view.objectId }, props.pageSize)
  const contextVersion = selection?.section === 'context' ? data.observation.value?.readVersion
    : selection?.section === 'knowledge' ? `${data.observation.value?.readVersion}:${data.observation.value?.world.status === 'observed'
      ? data.observation.value.world.revision : 'unavailable'}` : undefined
  const collectionQuery = collection === undefined ? undefined : JSON.stringify(Object.entries(collection)
    .filter(([key]) => key !== 'limit').sort(([a], [b]) => a.localeCompare(b)))
  const directoryIds = data.directory.value?.items.map(item => item.id) ?? []
  const directoryStatusScope = JSON.stringify(['statuses', directoryIds])
  const statuses: SimulationReadState<import('@clocky/clocky-client-runtime/client').SimulationProductRunStatusesPage> = data.statuses.scope === directoryStatusScope ? data.statuses : { loading: false, stale: false }
  useEffect(() => {
    if (!props.visible || !data.connected || runId !== undefined || directoryIds.length === 0) return
    const timer = window.setInterval(() => { void props.runStatuses({ runIds: directoryIds }) }, props.controlRefreshMs)
    return () => { window.clearInterval(timer) }
  }, [props.visible, data.connected, data.authorizationVersion, runId, directoryStatusScope, props.runStatuses, props.controlRefreshMs])
  const unknownCount = data.run.value !== undefined && data.run.value.run.id === runId
    ? data.run.value.world?.metrics?.unknownOperationCount : undefined
  useEffect(() => {
    if (props.visible && data.connected && runId !== undefined && unknownCount !== undefined && unknownCount > 0
      && data.run.scope === JSON.stringify(['run', runId])) void props.unknownOperations(runId, props.pageSize)
  }, [props.visible, data.connected, data.authorizationVersion, data.generation, runId, unknownCount, data.run.scope,
    props.unknownOperations, props.pageSize])
  const t = props.t
  const authorized = view.authorizationVersion === data.authorizationVersion
  const retained = authorized ? Object.entries(administration.commands).filter(([, record]) => runId === undefined
    || record.command.kind !== 'create' && record.command.input.runId === runId
    || record.receipt?.kind === 'request' && record.receipt.value.runId === runId
    || record.requestObservation?.runId === runId) : []
  const creation = authorized ? view.creation : undefined
  useEffect(() => { props.actions.authorization(data.authorizationVersion) }, [data.authorizationVersion, props.actions])
  useEffect(() => {
    const hasInput = creation !== undefined && (Object.values(creation).some(value => typeof value === 'string' && value !== '')
      || Object.values(creation.limits ?? {}).some(value => value !== ''))
    const hasEntityInput = Object.values(view.inputDrafts).some(draft => Object.values(draft)
      .some(value => typeof value === 'string' && value !== ''))
    if (!hasInput && !hasEntityInput && Object.keys(view.reviewDrafts).length === 0
      && Object.keys(view.operationRetryDrafts).length === 0 && Object.keys(view.cancelDrafts).length === 0
      && !Object.values(administration.commands).some(record => record.unknown || record.requestObservationUnavailable
        || record.requestObservation?.comparison === 'conflict')) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', protect)
    return () => { window.removeEventListener('beforeunload', protect) }
  }, [creation, view.inputDrafts, view.reviewDrafts, view.operationRetryDrafts, view.cancelDrafts, administration.commands, authorized])
  useEffect(() => {
    if (!props.visible || !data.connected || runId === undefined) return
    void props.control(runId)
    const timer = window.setInterval(() => { void props.control(runId) }, props.controlRefreshMs)
    return () => { window.clearInterval(timer) }
  }, [props.visible, data.connected, data.authorizationVersion, runId, props.control, props.controlRefreshMs])
  useEffect(() => {
    if (props.visible && data.connected && runId !== undefined && (view.module === 'overview' || view.module === 'requests')
      && data.run.scope === JSON.stringify(['run', runId])) void props.listRequests({ runId, limit: props.pageSize })
  }, [props.visible, data.connected, data.authorizationVersion, data.generation, runId, view.module, data.run.scope,
    props.listRequests, props.pageSize])
  useEffect(() => {
    if (props.visible && (view.creating || runId === undefined) && data.connected) void props.catalog()
  }, [props.visible, view.creating, runId, data.connected, data.authorizationVersion, props.catalog])
  useEffect(() => {
    props.actions.active(props.visible)
    if (!props.visible) { props.pause(); return }
    const restore = () => {
      if (new URL(window.location.href).searchParams.get('workspace') === 'simulation') props.actions.restore(route())
    }
    restore()
    window.addEventListener('popstate', restore)
    window.addEventListener(WORKSPACE_NAVIGATION_EVENT, restore)
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, restore); props.pause() }
  }, [props.visible, props.actions, props.pause])
  useEffect(() => {
    if (!props.visible || !data.connected || runId === undefined) return
    return props.observe(runId)
  }, [props.visible, data.connected, data.generation, runId, props.observe])
  useEffect(() => {
    if (!props.visible || !data.connected) return
    if (runId === undefined) void props.directory(view.search)
    else {
      void props.inspect(runId)
      if (collection !== undefined) void props.browse(collection)
    }
  }, [props.visible, data.connected, data.generation, runId, view.module, view.search, view.status, view.cognition,
    view.entityId, view.decisionId, props.pageSize,
    props.directory, props.inspect, props.browse])
  useEffect(() => {
    if (!props.visible || !data.connected || runId === undefined || view.objectId === undefined || view.module === 'overview') {
      props.closeObject(); return
    }
    /* v8 ignore next -- Normalized object routes in a collection module always produce a selection. */
    if (selection === undefined) return
    if ((selection.section === 'context' || selection.section === 'knowledge') && data.observation.value?.runId !== runId) return
    void props.inspectObject(selection)
  }, [props.visible, data.connected, data.generation, contextVersion, runId, view.objectId,
    view.module, view.section, view.knowledgeId, view.knowledgeRevision, props.pageSize,
    props.inspectObject, props.closeObject])
  useLayoutEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = runId === undefined ? view.directoryScroll
      : view.module === 'overview' || view.module === 'records' || view.module === 'requests' ? view.collectionScroll : 0
  }, [runId, view.module, view.status, view.cognition, view.entityId, view.decisionId, props.visible])
  const navigate = (next: Parameters<typeof writeRoute>[0]) => { writeRoute(next); props.actions.restore(next) }
  const refresh = () => {
    if (runId === undefined) void props.directory(view.search)
    else if (view.module === 'overview') { void props.inspect(runId); void props.control(runId) }
    else if (view.module === 'requests') void props.listRequests({ runId, limit: props.pageSize })
    else if (view.module === 'records') void props.readRecords({ runId, mode: 'metadata', kind: view.recordKind, limit: props.pageSize })
    else {
      /* v8 ignore next -- Every remaining module is one of the four collection modules. */
      if (collection === undefined) return
      void props.browse(collection)
    }
  }
  // Ignite (L3): the driver was observed starting while this run stayed open.
  // Each new control observation counts as one step; the first is settled.
  const controlObservation = useRef<{ value: unknown; count: number }>({ value: undefined, count: 0 })
  if (data.control.value !== controlObservation.current.value) {
    controlObservation.current = { value: data.control.value, count: controlObservation.current.count + 1 }
  }
  const observedDriver = data.control.value?.runId === runId ? data.control.value?.driver : undefined
  const ignition = useLiveTransition(runId ?? '', controlObservation.current.count, driverStatus(observedDriver) === 'running')
  const igniteGeneration = useRef(0)
  if (ignition.live && ignition.previous === false && driverStatus(observedDriver) === 'running') igniteGeneration.current = ignition.generation
  if (!props.visible) return null
  const current = runId === undefined ? data.directory : view.module === 'overview' ? data.run : view.module === 'records' ? data.records : view.module === 'requests' ? data.persistentRequests : data.collection
  const run = data.run.value?.run.id === runId ? data.run.value : undefined
  const page = data.collection.value?.runId === runId && data.collection.value?.collection === view.module
    && data.collection.scope === collectionQuery
    ? data.collection.value : undefined
  const control: SimulationReadState<SimulationProductControl> = data.control.scope === JSON.stringify(['control', runId])
    && (data.control.value === undefined || data.control.value.runId === runId)
    ? data.control : { loading: false, stale: false }
  const object = data.object.value?.runId === runId && data.object.value?.selection.id === view.objectId
    && data.object.value?.selection.collection === selection?.collection && data.object.value?.selection.section === selection?.section
    && (selection?.collection !== 'decisions' || selection.section !== 'knowledge' || data.object.value?.selection.collection === 'decisions'
      && data.object.value.selection.section === 'knowledge' && data.object.value.selection.reference?.id === selection.reference?.id
      && data.object.value.selection.reference?.revision === selection.reference?.revision)
    ? data.object.value : undefined
  const selectedRow = page?.items.find(row => row.id === view.objectId)
  const summary = object?.value !== undefined && 'summary' in object.value ? object.value.summary : undefined
  const objectName = summary !== undefined && 'name' in summary && summary.name !== undefined ? summary.name.text
    : selectedRow !== undefined && 'name' in selectedRow && selectedRow.name !== undefined ? selectedRow.name.text : view.objectId ?? ''
  const retryTarget = authorized && view.operationRetryTarget?.runId === runId ? view.operationRetryTarget : undefined
  const retryDraft = retryTarget === undefined ? undefined : view.operationRetryDrafts[operationRetryDraftKey(retryTarget)]
  const openRetry = (operationId: string, expectedAttemptCount: number) => {
    /* v8 ignore next -- Retry actions render only inside a selected run. */
    if (runId === undefined) return
    const target = { runId, operationId }
    const key = operationRetryDraftKey(target)
    if (view.operationRetryDrafts[key] === undefined) props.actions.operationRetry(key, { ...target, expectedAttemptCount, reason: '' })
    props.actions.operationRetryTarget(target)
    navigate({ runId, module: 'operations', objectId: operationId, search: view.search })
  }
  const readObjectPage = (cursor?: SimulationProductCursor) => {
    /* v8 ignore next -- Object pagination is rendered only for an exact selected object. */
    if (selection === undefined) return
    /* v8 ignore next -- Every paginated object section carries a limit in its selector. */
    if ('limit' in selection) {
      void props.inspectObject({ ...selection, cursor, expectedRevision: cursor === undefined ? undefined : object?.snapshotRevision })
    }
  }
  const scenario = control.value?.versions?.scenario ?? run?.operational?.scenario
  const supportsTasks = scenario?.status !== 'observed' || scenario.execution === 'automatic-tasks'
  const reviewCount = runId !== undefined && data.reviews.value?.runId === runId
    ? data.reviews.value.items.filter(item => item.phase === 'review').length : 0
  const reviewNeeded = reviewCount > 0
  const lookupCount = retained.filter(([, record]) => record.unknown || record.requestObservationUnavailable
    || record.requestObservation?.comparison === 'conflict').length
  const overviewPanels = runId === undefined ? [] : [
    supportsTasks && <TaskReviews key={`reviews:${runId}`} runId={runId} ready={data.run.scope === JSON.stringify(['run', runId])} value={data.reviews}
      connected={data.connected} authorizationVersion={data.authorizationVersion}
      pageSize={props.pageSize} read={props.listTaskReviews} drafts={authorized ? view.reviewDrafts : {}}
      target={authorized ? view.reviewTarget : undefined} select={props.actions.reviewTarget} change={props.actions.review}
      commands={administration.commands} retain={props.retain} submit={props.submit} query={props.query} t={t} />,
    <RunOverview key="progress" value={run} pool={control.value?.modelPool} t={t} />,
  ]
  if (!reviewNeeded) overviewPanels.reverse()
  const renderOriginal = (record: SimulationCommandState, history = false) => {
    const key = simulationCommandKey(record.command)
    const receipt = record.receipt
    return <div key={key}>
      <CommandRecord value={record} alwaysQuery={history} connected={data.connected} t={t}
        query={() => props.query(key)} retry={() => props.submit(key)}
        navigate={navigate} navigateApplication={props.navigateApplication} />
      {record.command.kind !== 'create' && record.command.kind !== 'manage' && record.command.kind !== 'review'
            && record.command.kind !== 'retry-operation' && record.command.kind !== 'retry-request' && record.command.kind !== 'cancel-task' && <Button onClick={() => {
        /* v8 ignore next -- This button renders only for the remaining maintenance command kinds. */
        if (record.command.kind === 'create' || record.command.kind === 'manage' || record.command.kind === 'review'
              || record.command.kind === 'retry-operation' || record.command.kind === 'retry-request' || record.command.kind === 'cancel-task') return
        navigate({ runId: record.command.input.runId, module: 'overview', search: view.search })
        props.actions.maintenance({ runId: record.command.input.runId, kind: record.command.kind, commandKey: key })
      }}>{t('inspectOriginal')}</Button>}
      {record.command.kind === 'retry-operation' && <Button onClick={() => {
        /* v8 ignore next -- Only retry-operation records render this button. */
        if (record.command.kind !== 'retry-operation') return
        const input = record.command.input
        const target = { runId: input.runId, operationId: input.operationId }, draftKey = operationRetryDraftKey(target)
        if (view.operationRetryDrafts[draftKey] === undefined) props.actions.operationRetry(draftKey, { ...target,
          expectedAttemptCount: input.expectedAttemptCount, reason: input.reason, commandKey: key,
          submitted: { reason: input.reason, expectedAttemptCount: input.expectedAttemptCount } })
        props.actions.operationRetryTarget(target)
        navigate({ runId: input.runId, module: 'operations', objectId: input.operationId, search: view.search })
      }}>{t('inspectOriginal')}</Button>}
      {record.command.kind === 'cancel-task' && <Button onClick={() => {
        /* v8 ignore next -- Only cancel-task records render this button. */
        if (record.command.kind !== 'cancel-task') return
        const input = record.command.input, target = { runId: input.runId, operationId: input.operationId }
        const draftKey = taskCancelDraftKey(target)
        if (view.cancelDrafts[draftKey] === undefined) props.actions.cancel(draftKey, { ...target,
          expectedRevision: input.expectedRevision, expectedAttemptId: input.expectedAttemptId,
          reason: input.reason, commandKey: key, submitted: { reason: input.reason,
            expectedRevision: input.expectedRevision, expectedAttemptId: input.expectedAttemptId } })
        props.actions.cancelTarget(target); navigate({ runId: input.runId, module: 'overview', search: view.search })
      }}>{t('inspectOriginal')}</Button>}
      {record.command.kind === 'review' && <Button onClick={() => {
        /* v8 ignore next -- Only review records render this button. */
        if (record.command.kind !== 'review') return
        const input = record.command.input
        const target = { runId: input.runId, operationId: input.operationId, attemptId: input.attemptId }
        const draftKey = JSON.stringify([input.runId, input.operationId, input.attemptId])
        if (view.reviewDrafts[draftKey] === undefined) props.actions.review(draftKey, { ...target,
          expectedRevision: input.expectedRevision, reason: input.reason, nextPhase: input.nextPhase, commandKey: key,
          submitted: { reason: input.reason, nextPhase: input.nextPhase, expectedRevision: input.expectedRevision } })
        props.actions.reviewTarget(target)
        navigate({ runId: input.runId, module: 'overview', search: view.search })
      }}>{t('inspectOriginal')}</Button>}
      {receipt?.kind === 'request' && <Button onClick={() => {
        navigate({ runId: receipt.value.runId, module: 'overview', search: view.search })
      }}>{t('openCreatedRun')}</Button>}
      {!record.unknown && !record.requestObservationUnavailable && record.requestObservation?.comparison !== 'conflict' && record.receipt !== undefined && (record.receipt.kind === 'ingress'
        ? record.receipt.value.status === 'consumed' || record.receipt.value.status === 'cancelled'
        : record.receipt.value.status === 'completed' || record.receipt.value.status === 'failed')
          && <Button variant="ghost" disabled={record.pending} onClick={() => { props.release(key) }}>{t('acknowledgeReceipt')}</Button>}
    </div>
  }
  return <main className={css.root} data-detail={view.objectId !== undefined || view.recordSequence !== undefined || undefined}
    data-directory={runId === undefined || undefined} data-simulation-workspace-page ref={scroll}
    onScroll={(event) => {
      if (runId === undefined || view.module === 'overview' || view.module === 'records' || view.module === 'requests') {
        props.actions.scroll(runId === undefined ? 'directory' : 'collection', event.currentTarget.scrollTop)
      }
    }}>
    {/* The directory header continues the launch tile; a run header continues its directory card. */}
    <header className={css.header} style={{ viewTransitionName: runId === undefined ? 'clocky-mode-simulation' : transitionName('clocky-run', runId) }}>
      <div>{runId !== undefined && <Button onClick={() => { navigateWithTransition(() => { navigate({ module: 'overview', search: view.search }) }) }}>
        {t('back')}</Button>}
      <span className={css.eyebrow}>{t('mode.eyebrow')}</span>
      <h1>{runId === undefined ? t('title') : run?.run.name.text ?? runId}</h1>
      {runId === undefined && <p className={css.muted}>{t('readOnly')}</p>}</div>
      <div className={css.actions}>{runId === undefined && <Button variant="primary" disabled={!data.connected || !authorized}
        onClick={() => { props.actions.creating(true) }}>{t('createTitle')}</Button>}
      <Button variant="secondary" disabled={!data.connected || current.loading} onClick={refresh} aria-busy={current.loading}>{t('refresh')}</Button></div>
    </header>
    {runId !== undefined && <Moment kind="ignite" generation={igniteGeneration.current} className={visualsCss.consoleMoment}><div className={css.runBar}>
      <RunStatus value={run} control={control} connected={data.connected}
        stale={data.run.stale || data.run.error !== undefined
          || control.value !== undefined && (control.stale || control.error !== undefined)} header t={t} />
      <Controls compact key={`${runId}:${data.authorizationVersion}`} name={run?.run.name.text ?? runId} value={control}
        connected={data.connected} authorizationVersion={data.authorizationVersion} retain={props.retain} submit={props.submit}
        refresh={() => props.control(runId)} openMaintenance={(kind) => { props.actions.maintenance({ runId, kind }) }}
        blockedMaintenance={retained.flatMap(([, record]) => record.command.kind !== 'create' && record.command.kind !== 'manage'
            && record.command.kind !== 'review' && record.command.kind !== 'retry-operation' && record.command.kind !== 'retry-request' && record.command.kind !== 'cancel-task'
            && (record.unknown || record.pending || record.receipt?.value.status === 'accepted') ? [record.command.kind] : [])}
        blockedPhases={retained.flatMap(([, record]) => record.command.kind === 'manage'
            && (record.unknown || record.pending || record.receipt?.value.status === 'in-progress') ? [record.command.input.phase] : [])} t={t} />
    </div></Moment>}
    {!data.connected && <p className={css.notice} role="status">{t('connection')}</p>}
    {runId !== undefined && <Feedback value={data.observation} t={t} />}
    {view.module !== 'requests' && <Feedback value={current} t={t} />}
    {runId === undefined ? <RunDirectory directory={data.directory} statuses={statuses} directoryIds={directoryIds}
      catalog={data.catalog} create={() => { props.actions.creating(true) }}
      connected={data.connected} search={view.search} draftSearch={view.draftSearch} searchDraft={props.actions.searchDraft}
      navigate={navigate} refresh={refresh} readDirectory={props.directory} runStatuses={props.runStatuses} t={t} date={date} /> : <>
      <nav className={css.moduleNavigation} aria-label={t('modules')}>
        <div className={css.tabs}>{modules.filter(module => module !== 'requests').map(module => <Button key={module}
          aria-current={view.module === module ? 'page' : undefined}
          onClick={() => {
            const direction = transitionDirection(modules, view.module, module)
            navigateWithTransition(() => { navigate({ runId, module, search: view.search }) }, direction)
          }}>{t(module)}</Button>)}
        <Menu open={moreMenu} portal items={[{ id: 'requests', label: t('requests') }]}
          selectedId={view.module === 'requests' ? 'requests' : undefined}
          anchor={<Button variant="secondary" aria-label={`${t('modules.more')}${view.module === 'requests' ? `: ${t('requests')}` : ''}`}
            aria-expanded={moreMenu} aria-current={view.module === 'requests' ? 'page' : undefined}
            onClick={() => { setMoreMenu(!moreMenu) }}>{t(view.module === 'requests' ? 'requests' : 'more')}<IconChevronDownOutline14 /></Button>}
          onClose={() => { setMoreMenu(false) }} onSelect={() => {
            setMoreMenu(false); navigate({ runId, module: 'requests', search: view.search })
          }} />
        </div>
        <div className={css.modulePicker}><Menu open={moduleMenu} portal selectedId={view.module}
          items={modules.map(id => ({ id, label: t(id) }))}
          anchor={<Button variant="secondary" aria-label={`${t('modules')}: ${t(view.module)}`} aria-expanded={moduleMenu}
            onClick={() => { setModuleMenu(!moduleMenu) }}>{t(view.module)}<IconChevronDownOutline14 /></Button>}
          onClose={() => { setModuleMenu(false) }} onSelect={(id) => {
            const module = modules.find(value => value === id)
            /* v8 ignore next -- The menu emits only IDs from the closed modules array above. */
            if (module !== undefined) navigate({ runId, module, search: view.search })
            setModuleMenu(false)
          }} /></div>
      </nav>
      {view.module === 'requests' ? <>
        <PersistentRequests key={`${runId}:${data.authorizationVersion}`} runId={runId} ready={data.run.scope === JSON.stringify(['run', runId])}
          value={data.persistentRequests} connected={data.connected} authorizationVersion={data.authorizationVersion}
          pageSize={props.pageSize} read={props.listRequests} refreshRun={async () => {
            await props.inspect(runId); await props.control(runId)
          }} commands={administration.commands} retain={props.retain} submit={props.submit} query={props.query} t={t} date={date}
          renderOriginal={renderOriginal} originals={retained.map(([, record]) => record)} />
      </> : view.module === 'records' ? <RecordsView key={runId} view={view} data={data} read={props.readRecords} close={props.closeRecords}
        exportRecords={props.exportRecords} cancelExport={props.cancelExport} useExport={props.useRecordsExport}
        pageSize={props.pageSize} navigate={navigate} t={t} /> : view.module === 'overview' ? <div className={css.scroll} style={{ viewTransitionName: 'clocky-module' }}>
        <NeedsYou t={t} items={[
          { id: 'reviews', count: reviewCount, open: () => {
            document.querySelector<HTMLElement>('[data-simulation-reviews]')?.scrollIntoView({ block: 'start' })
          } },
          { id: 'unknown', count: unknownCount ?? 0, open: () => {
            navigate({ runId, module: 'operations', search: view.search, status: 'outcome-unknown' })
          } },
          { id: 'requests', count: lookupCount, open: () => { navigate({ runId, module: 'requests', search: view.search }) } },
        ]} />
        {unknownCount !== undefined && unknownCount > 0 && <section aria-label={t('operationRetry.unknownWork')}>
          <h2>{t('operationRetry.unknownWork')} · {unknownCount}</h2><p>{t('operationRetry.unknownNotice')}</p>
          <Button onClick={() => { navigate({ runId, module: 'operations', search: view.search, status: 'outcome-unknown' }) }}>{t('operationRetry.viewUnknown')}</Button>
          <Feedback value={data.unknownOperations} t={t} />
          {data.unknownOperations.value?.runId === runId && data.unknownOperations.value.collection === 'operations'
            && data.unknownOperations.value.items.map(operation => <Button key={operation.id} onClick={() => {
              navigate({ runId, module: 'operations', objectId: operation.id, search: view.search })
            }}>{t('operationRetry.viewExact')} · {operation.id}</Button>)}
        </section>}
        {Object.entries(view.operationRetryDrafts).filter(([, draft]) => draft.runId === runId).map(([key, draft]) => <Button
          key={key} onClick={() => { openRetry(draft.operationId, draft.expectedAttemptCount) }}>{t('operationRetry.openDraft')} · {draft.operationId}</Button>)}
        {view.inputDrafts[runId] !== undefined && <Button onClick={() => { props.actions.maintenance({ runId, kind: 'ingress' }) }}>{t('resumeInput')}</Button>}

        {!supportsTasks && <p className={css.muted}>{t('cognitionOnly')}</p>}
        {overviewPanels}
        {supportsTasks && <TaskControls key={`tasks:${runId}`} runId={runId} ready={data.run.scope === JSON.stringify(['run', runId])}
          value={data.tasks} connected={data.connected} authorizationVersion={data.authorizationVersion} pageSize={props.pageSize}
          read={props.listTasks} drafts={authorized ? view.cancelDrafts : {}} target={authorized ? view.cancelTarget : undefined}
          change={props.actions.cancel} select={props.actions.cancelTarget} commands={administration.commands}
          retain={props.retain} submit={props.submit} query={props.query} t={t} />}
        <Button variant="secondary" onClick={() => { navigate({ runId, module: 'requests', search: view.search }) }}>
          {t('requests.open')}{retained.some(([, record]) => record.unknown || record.requestObservationUnavailable
            || record.requestObservation?.comparison === 'conflict') ? ` · ${t('requests.needsLookup')}` : ''}
        </Button>
        {run?.status === 'missing'  && <p className={css.empty}>{t('missing')}</p>}
      </div> : <CollectionWorkspace view={{ ...view, module: view.module }} runId={runId} data={data} page={page}
        object={object} objectName={objectName} current={current} collection={collection} selection={selection}
        pageSize={props.pageSize} position={view.collectionScroll} rememberScroll={(value) => { props.actions.scroll('collection', value) }}
        refresh={refresh} navigate={navigate} t={t} date={date} browse={props.browse} inspectObject={props.inspectObject}
        watchSource={props.watchSource} inspectSource={props.inspectSource} refreshSource={props.refreshSource}
        navigateApplication={props.navigateApplication} readObjectPage={readObjectPage} openRetry={openRetry} />}
    </>}
    {runId !== undefined && view.module !== 'overview' && view.module !== 'requests' && retained.length > 0
      && <Button onClick={() => { navigate({ runId, module: 'requests', search: view.search }) }}>{t('requests.open')}</Button>}
    {runId === undefined && retained.length > 0 && <details className={css.operations}>
      <summary>{t('operationsRetained')} · {retained.length}</summary>
      <div>{retained.map(([, record]) => renderOriginal(record))}</div>
    </details>}
    {retryDraft !== undefined && <OperationRetry key={operationRetryDraftKey(retryDraft)} draft={retryDraft} detail={data.object}
      connected={data.connected} authorizationVersion={data.authorizationVersion} commands={administration.commands}
      change={props.actions.operationRetry} close={() => { props.actions.operationRetryTarget(undefined) }}
      refresh={async () => { await props.inspectObject({ runId: retryDraft.runId, collection: 'operations', id: retryDraft.operationId as never,
        section: 'execution' }); await props.control(retryDraft.runId) }} retain={props.retain} submit={props.submit} query={props.query} t={t} />}
    {authorized && view.maintenance !== undefined && view.maintenance.runId === runId && <MaintenanceDialog
      key={`${runId}:${view.maintenance.kind}:${data.authorizationVersion}`} target={view.maintenance} name={run?.run.name.text ?? runId}
      recovery={data.recovery} readRecovery={props.readRecovery} closeRecovery={props.closeRecovery} pageSize={props.pageSize}
      control={control} connected={data.connected} authorizationVersion={data.authorizationVersion}
      draft={view.inputDrafts[runId]} commands={administration.commands}
      input={(draft) => { props.actions.input(runId, draft) }} close={() => { props.actions.maintenance(undefined) }}
      retain={props.retain} submit={props.submit} query={props.query} t={t} date={date}
      navigate={(next) => { props.actions.maintenance(undefined); navigate(next) }}
      navigateApplication={(href) => { props.actions.maintenance(undefined); props.navigateApplication(href) }} />}
    {authorized && view.creating && <CreationDialog draft={creation} catalog={data.catalog} validation={data.preflight}
      preflight={props.preflight} closePreflight={props.closePreflight} connected={data.connected}
      authorizationVersion={data.authorizationVersion} maxDraftBytes={props.maxDraftBytes}
      renderSlot={props.renderSlot} returnFromModelSetup={returnFromModelSetup}
      command={creation?.commandKey === undefined ? undefined : administration.commands[creation.commandKey]}
      change={props.actions.creation} close={() => { props.actions.creating(false) }}
      openRun={(id) => { props.actions.creating(false); navigate({ runId: id, module: 'overview', search: view.search }) }}
      refreshCatalog={props.catalog} retain={props.retain} release={props.release} submit={props.submit} query={props.query} t={t} />}
  </main>
}
