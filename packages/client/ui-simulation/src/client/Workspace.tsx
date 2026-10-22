import { simulationProductWorldManagementSubmitInputSchema } from '@clocky/clocky-simulation-product/world-management-schema'
import { WorldCreationDialog } from './WorldCreationDialog.tsx'
import { OperationRetry } from './OperationRetry.tsx'
import { operationRetryDraftKey, taskCancelDraftKey, route, writeRoute } from './store.ts'
import { driverStatus } from './RunStatus.tsx'
import { pulseAmbient, useAmbientScene, useLiveTransition } from '@clocky/clocky-client-ui-viz'
import type { SimulationWorldActionDraft } from './store.ts'
import type { EngineRef, WorldDomainReads, WorldDomainState, PersonDetailView } from './world-domain.ts'
import { ActionFlow } from './WorldActionFlow.tsx'
import { AuthorWorkbench } from './WorldAuthorWorkbench.tsx'
import { NewWorldChooser } from './WorldChooser.tsx'
import type { ChooserResult } from './WorldChooser.tsx'
import type { WorldTemplateView, WorldWindow } from './world-domain.ts'
import { V0_SECTIONS, SECTIONS, asObject, blankModel, createDraft } from './world-draft.ts'
import type { Json } from './world-draft.ts'
import worldCss from './World.module.css'
/** Simulation product pages consume framework-bound business snapshots and view-only store actions. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsRuntime, PropsStore, PropsLocale, PropsRenderSlots, SnapshotSelectorHook } from '@clocky/clocky-client-ui-slots'
import { Button } from '@clocky/clocky-client-ui-primitives'
import type { SimulationRuntimeState, SimulationProductRunId, SimulationProductBrowseInput,
  SimulationProductObjectInput, SimulationReadState, SimulationProductCursor, SimulationAdministrationState, SimulationCommandKey, SimulationCommand, SimulationCommandState } from '@clocky/clocky-client-runtime/client'
import type { createSimulationStore } from './store.ts'
import { simulationCommandKey } from '@clocky/clocky-client-runtime/client'
import { CreationDialog } from './CreationDialog.tsx'
import { MaintenanceDialog } from './MaintenanceDialog.tsx'
import { CommandRecord } from './CommandRecord.tsx'
import { DirectoryPage } from './DirectoryPage.tsx'
import { RunPage } from './RunPage.tsx'
import { useRunReads } from './useRunReads.ts'
import css from './Workspace.module.css'
import { WORKSPACE_NAVIGATION_EVENT, teamInspectionUrl } from '@clocky/clocky-client-ui-layout/client'
/** Narrow injected operations contain no services or custom hooks. */
export interface Injected {
  listWorldCases: (input: import('@clocky/clocky-client-runtime/client').SimulationProductWorldCasesInput) => Promise<void>
  inspectWorldCase: (input: import('@clocky/clocky-client-runtime/client').SimulationProductWorldCaseInput) => Promise<void>
  closeWorldCase: () => void
  exportWorldDefinition: (input: { runId: SimulationProductRunId; format: 'json' | 'yaml'; name: string }) => Promise<void>
  /** World domain windows (reserved seam; unpublished until the Client runtime projects these reads). */
  useWorldDomain: SnapshotSelectorHook<WorldDomainState>
  worldReads: WorldDomainReads
  /** Save authored text as a user-controlled file. */
  downloadText: (name: string, text: string, type: string) => void
  maxWorldDraftBytes: number
  maxWorldDrafts: number
  undoDepth: number
  inspectorMaxWidth: number
  useCalendar: SnapshotSelectorHook<import('@clocky/clocky-client-runtime/client').SimulationCalendarState>
  /** Original stop-target command for the open run. */
  useRunControl: SnapshotSelectorHook<import('@clocky/clocky-client-runtime/client').SimulationRunControlState>
  /** Submit a stop target or `null` to clear it; never starts scheduling. */
  updateRunControl: (runId: SimulationProductRunId, target: import('./StopTargetDialog.tsx').StopTargetInput | null) => Promise<void>
  /** Resend the exact original stop-target command after an unknown outcome. */
  retryRunControl: () => Promise<void>
  /** Dismiss a settled stop-target command. */
  dismissRunControl: () => boolean
  /** Deployment default drain budget offered in the stop-target form. */
  stopDrain: import('./StopTargetDialog.tsx').StopDrainDefaults
  previewCalendar: (input: import('@clocky/clocky-client-runtime/client').SimulationProductCalendarInput) => Promise<void>
  submitCalendar: () => Promise<void>
  closeCalendar: () => boolean
  recoverCalendar?: ((runId: string) => Promise<void>) | undefined
  cancelCalendar?: (() => Promise<void>) | undefined
  saveScenarioDraft: (input: import('@clocky/clocky-client-runtime/client').ScenarioDraftSave) => Promise<import('@clocky/clocky-client-runtime/client').ScenarioDraftSaveResult>
  readScenarioDraft: (input: import('@clocky/clocky-client-runtime/client').ScenarioDraftRead) => Promise<import('@clocky/clocky-client-runtime/client').ScenarioDraftReadResult>
  preflightWorld: (input: import('@clocky/clocky-client-runtime/client').SimulationProductWorldPreflightInput) =>
  Promise<SimulationReadState<import('@clocky/clocky-client-runtime/client').SimulationProductWorldPreflightResult> | undefined>
  closeWorldPreflight: () => void
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
  /** Real milliseconds after which a run observation is shown as "last observed". */
  staleAfterMs: number
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

/**
 * Route dispatch and dialog mounting; pages own their layout and `useRunReads` owns every automatic read.
 * @param props - Framework shares plus bounded runtime reads and original commands.
 * @returns one product workspace with explicit original management requests.
 */
export function Workspace(props: Props) {
  const view = props.useStore(state => state)
  const data = props.useSimulation(state => state)
  const calendar = props.useCalendar(state => state)
  const world = props.useWorldDomain(state => state)
  const listedWorldTemplates: readonly WorldTemplateView[] | undefined = data.catalog.value?.worldTemplates?.map(template => ({
    id: template.id, name: template.name, definition: template.definition,
    domains: [...new Set(template.definition.domains.map(value => value.domain))],
    people: template.definition.entities.filter(value => value.kind === 'person').length,
    committees: template.definition.governance.committees.length,
  }))
  const worldTemplates: WorldWindow<readonly WorldTemplateView[]> = data.catalog.error !== undefined
    ? { status: 'error', message: data.catalog.error, previous: listedWorldTemplates }
    : data.catalog.loading ? { status: 'loading', previous: listedWorldTemplates }
      : listedWorldTemplates === undefined ? world.templates : { status: 'ready', value: listedWorldTemplates, stale: data.catalog.stale }

  const administration = props.useAdministration(state => state)
  const worldActionCommand = view.worldAction?.commandKey === undefined ? undefined
    : administration.commands[view.worldAction.commandKey]
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
  const [chooserError, setChooserError] = useState<string>()
  const scroll = useRef<HTMLDivElement>(null)
  const runIdentity = useRef<HTMLElement>(null)
  const reads = useRunReads(props, view, data, world)
  const { runId, collectionModule } = reads
  const t = props.t
  const authorized = view.authorizationVersion === data.authorizationVersion
  const retained = authorized ? Object.entries(administration.commands).filter(([, record]) => runId === undefined
    || record.command.kind !== 'create' && record.command.kind !== 'world-create'
      && record.command.input.runId === runId
    || record.receipt?.kind === 'request' && record.receipt.value.runId === runId
    || record.requestObservation?.runId === runId) : []
  const creation = authorized ? view.creation : undefined
  const worldCreation = authorized ? view.worldCreation : undefined
  useEffect(() => { props.actions.authorization(data.authorizationVersion) }, [data.authorizationVersion, props.actions])
  useEffect(() => {
    const hasInput = creation !== undefined && (Object.values(creation).some(value => typeof value === 'string' && value !== '')
      || Object.values(creation.limits ?? {}).some(value => value !== ''))
    const hasEntityInput = Object.values(view.inputDrafts).some(draft => Object.values(draft)
      .some(value => typeof value === 'string' && value !== ''))
    const hasWorldInput = worldCreation !== undefined && (worldCreation.name !== '' || worldCreation.json !== '')
      || Object.keys(view.worldDrafts).length > 0 || view.worldAction !== undefined
      || calendar.status === 'ready' || calendar.status === 'submitting' || calendar.status === 'unknown'
    if (!hasWorldInput && !hasInput && !hasEntityInput && Object.keys(view.reviewDrafts).length === 0
      && Object.keys(view.operationRetryDrafts).length === 0 && Object.keys(view.cancelDrafts).length === 0
      && !Object.values(administration.commands).some(record => record.unknown || record.requestObservationUnavailable
        || record.requestObservation?.comparison === 'conflict')) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', protect)
    return () => { window.removeEventListener('beforeunload', protect) }
  }, [creation, worldCreation, view.worldDrafts, view.worldAction, view.inputDrafts, view.reviewDrafts,
    view.operationRetryDrafts, view.cancelDrafts,
    administration.commands, authorized, calendar.status])
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
  useLayoutEffect(() => {
    if (scroll.current !== null) scroll.current.scrollTop = runId === undefined ? view.directoryScroll
      : collectionModule === undefined ? view.collectionScroll : 0
  }, [runId, view.module, view.status, view.cognition, view.entityId, view.decisionId, props.visible])
  const navigate = (next: Parameters<typeof writeRoute>[0]) => { writeRoute(next); props.actions.restore(next) }
  const openRef = (ref: EngineRef) => {
    if (runId === undefined) return
    switch (ref.kind) {
      case 'entity': navigate({ runId, module: 'entities', objectId: ref.id, search: view.search }); break
      case 'decision': navigate({ runId, module: 'decisions', objectId: ref.id, search: view.search }); break
      case 'operation': navigate({ runId, module: 'operations', objectId: ref.id, search: view.search }); break
      case 'checkpoint': navigate({ runId, module: 'checkpoints', objectId: ref.id, search: view.search }); break
      case 'record': navigate({ runId, module: 'records', recordSequence: ref.sequence, search: view.search }); break
      case 'team-task':
        props.navigateApplication(teamInspectionUrl(window.location.href, { kind: 'task', teamId: ref.teamId, taskId: ref.id }))
        break
      case 'envelope':
        if (ref.decisionId !== undefined && ref.sourceIndex !== undefined) {
          navigate({ runId, module: 'decisions', objectId: ref.decisionId, sourceIndex: ref.sourceIndex,
            section: 'context', search: view.search })
        } else {
          // Reference strings select a route only; the destination independently checks Team membership and the exact Envelope.
          props.navigateApplication(teamInspectionUrl(window.location.href, { kind: 'channel', teamId: ref.teamId,
            channelId: ref.channelId, envelopeId: ref.envelopeId, envelopeSequence: ref.envelopeSequence }))
        }
        break
      default: { const unreachable: never = ref; throw new Error(`Unknown engine reference ${JSON.stringify(unreachable)}`) }
    }
  }
  const startAction = (draft: SimulationWorldActionDraft) => {
    try { props.actions.worldAction(draft) } catch { return }
    void props.worldReads.actionFields({ runId: draft.runId, action: draft.action, targetId: draft.targetId })
  }
  const personTarget = (person: PersonDetailView) => {
    const tenure = person.tenures.at(-1)
    return `${person.name.text}${tenure === undefined ? '' : ` · ${tenure.positionName.text} · #${tenure.id}`}`
  }
  const chooseWorld = (result: ChooserResult) => {
    if (result.kind === 'continue') { props.actions.choosingWorld(false); navigate({ module: 'overview', search: view.search, author: result.slot }); return }
    const slot = crypto.randomUUID()
    const draft = result.kind === 'template' ? createDraft(slot, result.template.name, result.template.definition as Json)
      : result.kind === 'import' ? createDraft(slot, result.name, blankModel(), { text: result.text, format: result.format })
        : createDraft(slot, '', blankModel())
    try { props.actions.worldDraft(slot, draft) } catch { setChooserError(t('world.author.capacityRefused')); return }
    setChooserError(undefined); props.actions.choosingWorld(false)
    navigate({ module: 'overview', search: view.search, author: slot })
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
  // The ambient field behind this stage shows the open run's terrain at full tone only while its driver is observed working.
  useAmbientScene(scroll, props.visible ? runId : undefined, driverStatus(observedDriver) === 'running' ? 'full' : 'muted')
  const ignited = igniteGeneration.current
  useEffect(() => { if (ignited > 0) pulseAmbient(runIdentity.current) }, [ignited])
  if (!props.visible) return null
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
  const renderOriginal = (record: SimulationCommandState, history = false) => {
    const key = simulationCommandKey(record.command)
    const receipt = record.receipt
    return <div key={key}>
      <CommandRecord value={record} alwaysQuery={history} connected={data.connected} t={t}
        query={() => props.query(key)} retry={() => props.submit(key)}
        navigate={(next) => {
          if (view.worldAction?.commandKey === key) {
            props.worldReads.closeActionPreview()
            props.actions.worldAction({ ...view.worldAction, open: false })
          }
          navigate(next)
        }} navigateApplication={props.navigateApplication} />
      {record.command.kind !== 'create' && record.command.kind !== 'manage' && record.command.kind !== 'review'
            && record.command.kind !== 'world-create' && record.command.kind !== 'world-prepare' && record.command.kind !== 'cancel-world-case' && record.command.kind !== 'world-management'
            && record.command.kind !== 'retry-operation' && record.command.kind !== 'retry-request' && record.command.kind !== 'cancel-task' && <Button onClick={() => {
        /* v8 ignore next -- This button renders only for the remaining maintenance command kinds. */
        if (record.command.kind === 'create' || record.command.kind === 'world-create' || record.command.kind === 'world-prepare'
          || record.command.kind === 'cancel-world-case' || record.command.kind === 'world-management' || record.command.kind === 'manage' || record.command.kind === 'review'
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
  if (runId === undefined && view.author !== undefined) {
    const slot = view.author, authorDraft = authorized ? view.worldDrafts[slot] : undefined
    return <main className={`${css.root} ${worldCss.authorRoot}`} data-simulation-workspace-page data-author ref={scroll}>
      {authorDraft === undefined ? <div className={worldCss.missingDraft}>
        <h2>{t('world.author.missingTitle')}</h2>
        <p className={css.muted}>{t('world.author.missing')}</p>
        <div className={css.actions}>
          <Button variant="primary" disabled={!data.connected || !authorized} onClick={() => {
            navigate({ module: 'overview', search: view.search }); props.actions.choosingWorld(true)
          }}>{t('world.new')}</Button>
          <Button variant="secondary" onClick={() => { navigate({ module: 'overview', search: view.search }) }}>← {t('world.author.back')}</Button>
        </div>
      </div> : <AuthorWorkbench draft={authorDraft} maxBytes={props.maxWorldDraftBytes} supportedSections={asObject(authorDraft.model).apiVersion === 'clocky.world/v1' ? SECTIONS : V0_SECTIONS}
        change={(next) => { props.actions.worldDraft(slot, next) }} undoDepth={props.undoDepth}
        saveDraft={props.saveScenarioDraft} readDraft={props.readScenarioDraft}
        validation={data.worldPreflight} preflight={props.preflightWorld} connected={data.connected}
        authorizationVersion={data.authorizationVersion}
        command={authorDraft.commandKey === undefined ? undefined : administration.commands[authorDraft.commandKey]}
        retain={props.retain} submit={props.submit} query={props.query}
        inspectorWidth={view.authorInspectorWidth} resizeInspector={props.actions.authorInspector}
        back={() => { navigate({ module: 'overview', search: view.search }) }}
        openRun={(id) => { navigate({ runId: id, module: 'overview', search: view.search }) }}
        discard={() => { props.actions.worldDraft(slot, undefined); props.closeWorldPreflight(); navigate({ module: 'overview', search: view.search }) }}
        download={(name, text, format) => { props.downloadText(name, text, format === 'json' ? 'application/json' : 'application/yaml') }} t={t} />}
    </main>
  }
  const run = data.run.value?.run.id === runId ? data.run.value : undefined
  const control: SimulationReadState<import('@clocky/clocky-client-runtime/client').SimulationProductControl> = data.control.scope === JSON.stringify(['control', runId])
    && (data.control.value === undefined || data.control.value.runId === runId)
    ? data.control : { loading: false, stale: false }
  return <main className={css.root} data-detail={view.objectId !== undefined || view.recordSequence !== undefined || undefined}
    data-directory={runId === undefined || undefined} data-simulation-workspace-page ref={scroll}
    style={{ '--world-inspector-max': `${String(props.inspectorMaxWidth)}px` } as CSSProperties}
    onScroll={(event) => {
      if (runId === undefined || collectionModule === undefined) {
        props.actions.scroll(runId === undefined ? 'directory' : 'collection', event.currentTarget.scrollTop)
      }
    }}>
    {runId === undefined ? <DirectoryPage workspace={props} view={view} data={data} reads={reads} authorized={authorized}
      retained={retained} navigate={navigate} renderOriginal={renderOriginal} date={date} locale={locale} />
      : <RunPage workspace={props} runId={runId} view={view} data={data} world={world} calendar={calendar}
        administration={administration} reads={reads} authorized={authorized} retained={retained} navigate={navigate}
        openRef={openRef} startAction={startAction} personTarget={personTarget} openRetry={openRetry}
        renderOriginal={renderOriginal} date={date} locale={locale} root={scroll} identity={runIdentity}
        igniteGeneration={igniteGeneration.current} />}
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
    {authorized && runId === undefined && view.choosingWorld && <NewWorldChooser templates={worldTemplates}
      drafts={Object.values(view.worldDrafts).reverse()} maxBytes={props.maxWorldDraftBytes} maxSlots={props.maxWorldDrafts}
      slotsFull={Object.keys(view.worldDrafts).length >= props.maxWorldDrafts} choose={chooseWorld}
      error={chooserError} close={() => { setChooserError(undefined); props.actions.choosingWorld(false) }} t={t} />}
    {authorized && view.worldAction !== undefined && view.worldAction.runId === runId && view.worldAction.open && <ActionFlow
      key={`${view.worldAction.action}:${view.worldAction.targetId}`} action={view.worldAction.action} target={view.worldAction.target}
      expectedRevision={view.worldAction.expectedRevision} fields={world.actionFields} preview={world.actionPreview}
      values={view.worldAction.values} connected={data.connected}
      change={(values) => { if (view.worldAction !== undefined) { try { props.actions.worldAction({ ...view.worldAction, values }) }
      catch { /* Capacity refusal keeps the previous values visible. */ } } }}
      requestPreview={(values) => {
        const draft = view.worldAction
        if (draft !== undefined) void props.worldReads.previewAction({ runId: draft.runId, action: draft.action, targetId: draft.targetId,
          expectedRevision: draft.expectedRevision, values })
      }}
      original={worldActionCommand === undefined ? undefined : renderOriginal(worldActionCommand)}
      submit={world.actionPreview.status !== 'ready' || world.actionPreview.value.original === undefined ? undefined : (preview) => {
        const draft = view.worldAction, quote = preview.original
        if (draft === undefined || quote === undefined || draft.commandKey !== undefined) return false
        try {
          const command: SimulationCommand = { kind: 'world-management', input: simulationProductWorldManagementSubmitInputSchema.parse({
            runId: draft.runId, commandId: crypto.randomUUID(), draft: quote.input,
            previewRevision: quote.snapshotRevision, previewHash: quote.previewHash }) }
          const key = props.retain(command, data.authorizationVersion)
          props.actions.worldAction({ ...draft, commandKey: key })
          void props.submit(key)
          return true
        } catch { return false /* Retain/capacity refusal preserves the complete draft for review. */ }
      }}
      openObligations={() => {
        const draft = view.worldAction
        if (draft === undefined) return
        props.actions.worldAction({ ...draft, open: false })
        navigate({ runId: draft.runId, module: 'organization', lens: 'people', objectId: draft.targetId, worldSection: 'obligations', search: view.search })
      }}
      openRef={(ref) => { if (view.worldAction !== undefined) props.actions.worldAction({ ...view.worldAction, open: false })
        openRef(ref) }}
      close={() => {
        props.worldReads.closeActionPreview()
        if (view.worldAction === undefined) return
        if (Object.values(view.worldAction.values).some(value => value !== '')) props.actions.worldAction({ ...view.worldAction, open: false })
        else props.actions.worldAction(undefined)
      }} t={t} />}
    {authorized && view.creatingWorld && <WorldCreationDialog draft={worldCreation} validation={data.worldPreflight}
      preflight={props.preflightWorld} closePreflight={props.closeWorldPreflight} connected={data.connected}
      authorizationVersion={data.authorizationVersion} maxDraftBytes={props.maxDraftBytes}
      command={worldCreation?.commandKey === undefined ? undefined : administration.commands[worldCreation.commandKey]}
      change={props.actions.worldCreation} close={() => { props.actions.creatingWorld(false) }}
      openRun={(id) => { props.actions.creatingWorld(false); navigate({ runId: id, module: 'overview', search: view.search }) }}
      retain={props.retain} submit={props.submit} query={props.query} t={t} />}
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
