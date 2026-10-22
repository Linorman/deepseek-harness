/** Bounded case windows preserve original facts and separate planning, execution and delivery. */
import { useEffect, useRef, useState } from 'react'
import { observationVersion, useObservedRefresh } from './useObservedRefresh.ts'
import { Button, IconChevronDownOutline14, Menu } from '@clocky/clocky-client-ui-primitives'
import type { SimulationRuntimeState, SimulationProductRunId, SimulationProductWorldCaseInput,
  SimulationProductWorldCasesInput, SimulationProductWorldCaseDetail, SimulationProductWorldCaseBody,
  SimulationProductWorldCasePost, SimulationProductWorldCaseWake } from '@clocky/clocky-client-runtime/client'
import type { Route } from './store.ts'
import type { CommandProps } from './command-props.ts'
import { CommandRecord } from './CommandRecord.tsx'
import { Feedback } from './Feedback.tsx'
import css from './Workspace.module.css'
import type { EngineRef, WorldCaseExtension, WorldWindow } from './world-domain.ts'
import { windowValue } from './world-domain.ts'
import { MutationSteps, StatusTrack, TrackLegend, TrackNode } from './WorldTracks.tsx'
import { WindowStatus, groupTime, CopyId, shortId } from './WorldFacts.tsx'
import worldCss from './World.module.css'
import { EngineRefLink, refText } from './WorldRefs.tsx'
import { caseTracks } from './case-tracks.ts'
import { InspectorDock, WorkspaceStage } from './WorldInspector.tsx'
import { BusinessAction, ResultLayers } from './DomainSummary.tsx'
import { DisclosedValue } from './DisclosedValue.tsx'

type Props = CommandProps & {
  runId: SimulationProductRunId
  view: Route
  data: SimulationRuntimeState
  connected: boolean
  authorizationVersion: number
  pageSize: number
  read: (input: SimulationProductWorldCasesInput) => Promise<void>
  inspect: (input: SimulationProductWorldCaseInput) => Promise<void>
  closeDetail: () => void
  navigate: (route: Route) => void
  /** World domain projection layered over each case (domain, tracks, evidence, sources); unpublished until the Host projects it. */
  extensions?: WorldWindow<readonly WorldCaseExtension[]> | undefined
  readExtensions?: ((requestIds: readonly string[]) => void) | undefined
  openRef?: ((ref: EngineRef) => void) | undefined
}
const statuses = ['open', 'awaiting-evidence', 'cancel-requested', 'cancelled', 'rejected', 'committed'] as const
const sections = ['request', 'plans', 'execution', 'notification'] as const
/** Sections backed by the World domain projection rather than the case inspection read. */
const domainSections = ['evidence', 'source'] as const
type DomainSection = typeof domainSections[number]
const isDomainSection = (value: string): value is DomainSection => (domainSections as readonly string[]).includes(value)

/**
 * Browse revision-bound cases and one separately authorized section without implicitly starting execution.
 * @param props - Original read windows, safe URL selection and explicit command operations.
 * @returns shared table/inspector geometry with exact original cancellation and source links.
 */
export function WorldCases(props: Props) {
  const { t, view, runId, data } = props, [filter, setFilter] = useState(false), [cancel, setCancel] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const busy = useRef(false)
  const table = useRef<HTMLTableElement>(null)
  const returnFocus = useRef<HTMLButtonElement | null>(null)
  const [error, setError] = useState<string>()
  const requestId = view.objectId as SimulationProductWorldCaseInput['requestId'] | undefined
  const selectedSection = view.caseSection ?? 'request'
  const section = isDomainSection(selectedSection) ? 'request' : selectedSection
  const scope = JSON.stringify(['worldCases', view.status === undefined ? { runId } : { runId, status: view.status }])
  const state: SimulationRuntimeState['worldCases'] = data.worldCases.scope === scope ? data.worldCases : { loading: false, stale: false }
  const page = state.value?.runId === runId ? state.value : undefined
  const detailScope = JSON.stringify(['worldCase', runId, requestId, section])
  const detailState: SimulationRuntimeState['worldCase'] = data.worldCase.scope === detailScope ? data.worldCase : { loading: false, stale: false }
  const detail = detailState.value?.runId === runId && detailState.value.requestId === requestId
    && detailState.value.section === section ? detailState.value : undefined
  const input = { runId, limit: props.pageSize, status: view.status as SimulationProductWorldCasesInput['status'] }
  const refresh = () => props.read(input)
  const liveVersion = observationVersion(data, runId)
  useObservedRefresh(liveVersion, state.loading, () => { void refresh() }, state.stale)
  useObservedRefresh(liveVersion, detailState.loading, () => {
    if (requestId !== undefined) void props.inspect({ runId, requestId, section, limit: props.pageSize })
  }, detailState.stale)
  useEffect(() => {
    if (props.connected) void props.read({ runId, limit: props.pageSize, status: view.status as SimulationProductWorldCasesInput['status'] })
  }, [props.connected, data.generation, data.authorizationVersion, data.observation.value?.readVersion,
    runId, view.status, props.read, props.pageSize])
  useEffect(() => {
    if (requestId === undefined || !props.connected) { props.closeDetail(); return }
    void props.inspect({ runId, requestId, section, limit: props.pageSize })
    return () => { props.closeDetail() }
  }, [props.connected, data.generation, data.authorizationVersion, runId, requestId, section, data.observation.value?.readVersion,
    props.inspect, props.closeDetail, props.pageSize])
  useEffect(() => { setCancel(false) }, [requestId])
  const value = detail?.value
  const extensions = props.extensions === undefined ? undefined : windowValue(props.extensions)?.value
  const extension = extensions?.find(item => item.requestId === requestId)
  const pageIds = page?.items.map(item => item.requestId).join('\n') ?? ''
  // The owner passes a fresh callback each render; read once per committed page and revision instead.
  const readExtensions = useRef(props.readExtensions)
  readExtensions.current = props.readExtensions
  const extensionScope = `${String(page?.snapshotRevision)}:${String(data.authorizationVersion)}:${pageIds}`
  useEffect(() => {
    if (props.connected && pageIds !== '') readExtensions.current?.(pageIds.split('\n'))
  }, [props.connected, extensionScope])
  // Continuations are opaque, so the position is counted here: Next advances it, any other new page starts at one.
  const [start, setStart] = useState(0)
  const nextStart = useRef<number>()
  useEffect(() => { setStart(nextStart.current ?? 0); nextStart.current = undefined }, [page])
  const domains = [...new Set(page?.items.map(item => item.domain) ?? [])]
  const visible = page?.items.filter((item) => {
    if (view.domain !== undefined && item.domain !== view.domain) return false
    if (view.needsAction === true && item.status !== 'awaiting-evidence'
      && !caseTracks(item, t).some(track => track.steps.at(-1)?.state === 'unknown' || track.steps.at(-1)?.state === 'blocked')) return false
    return true
  })
  const [domainMenu, setDomainMenu] = useState(false)
  const domainLabel = (domain: string) => {
    const key = `world.nav.${domain}` as Parameters<typeof t>[0]
    const text = t(key)
    return text === key ? t('world.cases.unknownDomain', { domain }) : text
  }
  const original = Object.entries(props.commands).findLast(([, record]) => record.command.kind === 'cancel-world-case'
    && record.command.input.runId === runId && record.command.input.requestId === requestId)
  const cancelPreview = value?.summary.cancel.preview
  const canCancel = props.connected && !detailState.loading && !detailState.stale && detailState.error === undefined
    && value?.summary.cancel.allowed === true && cancelPreview !== undefined
    && cancelPreview.snapshotRevision === detail?.snapshotRevision && original === undefined
  const confirmCancel = () => {
    if (!canCancel || busy.current || requestId === undefined) return
    busy.current = true
    try {
      const key = props.retain({ kind: 'cancel-world-case', input: { runId, requestId,
        previewRevision: cancelPreview.snapshotRevision, previewHash: cancelPreview.previewHash,
        commandId: crypto.randomUUID() as import('@clocky/clocky-client-runtime/client').SimulationProductCommandId } }, props.authorizationVersion)
      setCancel(false); void props.submit(key).then(() => {
        if (!alive.current) return
        void refresh(); void props.inspect({ runId, requestId, section })
      })
    } catch { setError(t('draftCapacity')) }
    finally { busy.current = false }
  }
  const navigate = (next: Partial<Route>) =>{  props.navigate({ ...view, ...next, runId }) }
  const link = (module: 'entities' | 'operations', id: string) => <button type="button" className={worldCss.refLink} title={id} onClick={() => {
    navigate({ module, objectId: id, caseSection: undefined })
  }}><code>{id}</code> ↗</button>
  const body = (value: SimulationProductWorldCaseBody) => value.status === 'withheld'
    ? <DisclosedValue state="withheld" label="cases.withheld" t={t} /> : <><p className={css.contextText}>{value.text.text}</p>
      {value.text.truncated && <p className={css.muted}>{t('truncate')}</p>}</>
  const post = (value: SimulationProductWorldCasePost) => <div>
    {link('operations', value.operationId)}<p>{t(`cases.publication.${value.publication}`)} · {t(`cases.delivery.${value.delivery}`)}</p>
    <code>{value.channelId}</code>{value.envelopeId !== undefined && <p><code>{value.envelopeId}</code></p>}
  </div>
  const wake = (value: SimulationProductWorldCaseWake) => <p>{t('cases.wake')}: {t(`cases.wake.${value.status}`)}</p>
  const render = (value: SimulationProductWorldCaseDetail) => {
    switch (value.section) {
      case 'request': return <>{value.source.kind === 'decision' ? link('operations', value.source.operationId)
        : <p>{t('cases.authenticatedUser')} · <code>{value.source.commandId}</code></p>}<h3>{t('cases.description')}</h3>{body(value.description)}
      {value.evidence !== undefined && <section>
        <h3>{t('cases.evidence.title')}</h3><p>{t('cases.evidence.inputRevision')}: {value.evidence.inputRevision}</p>
        {value.evidence.latestChallenge !== undefined && <>
          <p>{t(`cases.evidence.${value.evidence.latestChallenge.status}`)}</p>
          <p>{t('cases.evidence.round')}: {value.evidence.latestChallenge.round}</p>
          <p>{t('cases.evidence.deadline')}: {value.evidence.latestChallenge.deadline}</p>
          <p>{t('cases.evidence.attempts')}: {value.evidence.latestChallenge.attemptsUsed} / {value.evidence.latestChallenge.maxAttempts}</p>
          <ul>{value.evidence.latestChallenge.fields.map(field => <li key={field.code}>
            <code>{field.code}</code>: {field.description.text}{field.description.truncated && <span> · {t('truncate')}</span>}
          </li>)}</ul>
        </>}
        {value.evidence.latestRevision !== undefined && <>
          <h4>{t('cases.evidence.answers')}</h4>{link('entities', value.evidence.latestRevision.actorId)}
          {value.evidence.latestRevision.answers.status === 'withheld' ? <DisclosedValue state="withheld" label="cases.withheld" t={t} />
            : <ul>{value.evidence.latestRevision.answers.items.map(answer => <li key={answer.field}>
              <code>{answer.field}</code>: {answer.text.text}{answer.text.truncated && <span> · {t('truncate')}</span>}
            </li>)}</ul>}
        </>}
      </section>}
      </>
      case 'plans': return <>
        <p>{t('total')}: {value.total}</p><p className={css.notice}>{t('cases.planNotice')}</p>
        {value.items.map(plan => <section key={plan.id} className={css.detail}>
          <h3>{t(`cases.plan.${plan.status}`)} · {t(`cases.resolution.${plan.resolution}`)}</h3><code>{plan.id}</code>
          {plan.operationId === null ? <p>{t('cases.userPlan')}</p> : link('operations', plan.operationId)}<p>{t('cases.hash')}: <code>{plan.hash}</code></p>
          {plan.predecessor !== null && <p>{t('cases.predecessor')}: <code>{plan.predecessor}</code></p>}
          {plan.stale !== undefined && <p role="status">{t(`cases.stale.${plan.stale.reason}`)}</p>}
          <h4>{t('cases.rationale')}</h4>{body(plan.rationale)}<h4>{t('cases.persona')}</h4>
          {plan.persona.status === 'allowed' ? <><p>{plan.persona.name.text}</p><ul>
            {[...plan.persona.skills, ...plan.persona.traits, ...plan.persona.goals].map((text, index) => <li key={index}>
              {text.text}{text.truncated && ` · ${t('truncate')}`}</li>)}</ul></> : <DisclosedValue state={plan.persona.status}
            label={plan.persona.status === 'withheld' ? 'cases.withheld' : 'cases.notApplicable'} t={t} />}
        </section>)}
        {value.nextCursor !== undefined && <Button disabled={!props.connected || detailState.loading || detailState.stale}
          onClick={() => { if (requestId !== undefined) void props.inspect({ runId, requestId, section: 'plans', limit: props.pageSize,
            expectedRevision: detail?.snapshotRevision, readVersion: detail?.readVersion, cursor: value.nextCursor }) }}>{t('next')}</Button>}
      </>
      case 'execution': return <>
        <CaseExecutionState value={value} t={t} openPlan={() => { navigate({ caseSection: 'plans' }) }}
          openRecovery={() => { navigate({ module: 'overview', objectId: undefined, caseSection: undefined }) }} />
        {value.summary.domain === 'organization' && value.summary.operation === 'generate-and-hire' && value.summary.version === '1' && <>
          <h3>{t('cases.execution.identity')}</h3>
          {value.reservation === undefined ? <p>{t('cases.noReservation')}</p> : <>
            <p>{t(`cases.reservation.${value.reservation.status}`)}</p>{link('entities', value.reservation.newborn.entityId)}
            <p>{t('cases.readiness')}: {value.reservation.newborn.readiness}</p>
            <p>{t('cases.assignment')}: <code>{value.reservation.assignment.relationId}</code> · {value.reservation.assignment.status}</p>
            {value.reservation.cleanup !== undefined && <p>{t('cases.cleanup')}: {value.reservation.cleanup.participant}</p>}
          </>}</>}
        <h3>{t('cases.execution.business')}</h3>{value.result === undefined ? <p>{t('cases.noResult')}</p> : <>
          <p>{t(`cases.status.${value.result.outcome.kind}`)}</p><code>{value.result.id}</code>
          {value.result.source.kind === 'evidence-deadline' && <p>{t('cases.evidence.deadlineResult')}</p>}
          {value.result.source.kind === 'evidence-exhausted' && <p>{t('cases.evidence.exhaustedResult')}</p>}
          {value.result.outcome.kind === 'rejected' && <p>{t(`cases.reject.${value.result.outcome.reason}`)}</p>}
        </>}
      </>
      case 'notification': return <>
        <p className={css.notice}>{t('cases.notificationNotice')}</p><h3>{t('cases.requestNotification')}</h3>
        {value.request === null ? <p>{t(value.summary.origin.kind === 'authenticated-user' ? 'cases.userNoRequestPost' : 'cases.scenarioNoRequestPost')}</p> : post(value.request)}
        <h3>{t('cases.resultNotification')}</h3>{value.result === undefined ? <p>{t('cases.noResult')}</p> : <>
          {wake(value.result.wake)}{value.result.post === undefined ? <p>{t(value.request === null
            ? 'cases.scenarioNoResultPost' : 'cases.noPost')}</p> : post(value.result.post)}</>}
        {value.firstAction !== undefined && <><h3>{t('cases.firstAction')}</h3>{wake(value.firstAction.wake)}
          {value.firstAction.post === undefined ? <p>{t('cases.noPost')}</p> : post(value.firstAction.post)}</>}
      </>
      default: return assertNever(value)
    }
  }
  const closeDock = () => {
    navigate({ objectId: undefined, caseSection: undefined }); props.closeDetail()
    requestAnimationFrame(() => {
      if (!alive.current) return
      const target = returnFocus.current?.isConnected ? returnFocus.current
        : Array.from(table.current?.querySelectorAll<HTMLButtonElement>('button[data-world-case-request]') ?? [])
          .find(button => button.dataset.worldCaseRequest === requestId)
      target?.focus()
    })
  }
  const open = (id: string, origin?: HTMLButtonElement) => {
    returnFocus.current = origin ?? null
    navigate({ module: 'cases', objectId: id, caseSection: 'request' })
  }
  const selected = page?.items.find(item => item.requestId === requestId) ?? value?.summary
  const sectionItems = [...sections, ...props.extensions === undefined ? [] : domainSections].map(item =>
    ({ id: item, label: isDomainSection(item) ? t(`world.cases.section.${item}`) : t(`cases.section.${item}`) }))
  // A business-key column whose loaded rows are all withheld folds into one page summary instead of repeating the sentence.
  const keys = visible?.map(item => extensions?.find(entry => entry.requestId === item.requestId)?.businessKey.state) ?? []
  const keysWithheld = extensions !== undefined && keys.length > 1 && keys.every(state => state === 'withheld')
  const showKey = extensions !== undefined && !keysWithheld
  // A column empty on every loaded row says nothing; it returns once any row carries a value.
  const showUpdated = extensions !== undefined && visible?.some(item =>
    extensions.find(entry => entry.requestId === item.requestId)?.updatedAt !== undefined) === true
  const shownRows = visible?.length ?? 0
  return <div className={worldCss.module}>
    <div className={worldCss.moduleBar}>
      <h2 className={worldCss.moduleTitle}>{props.extensions === undefined ? t('cases') : t('world.nav.cases')}</h2>
      <Menu open={filter} selectedId={view.status ?? ''} portal onClose={() => { setFilter(false) }}
        anchor={<Button size="sm" variant="secondary" aria-expanded={filter} onClick={() => { setFilter(!filter) }}>{view.status === undefined
          ? t('cases.all') : t(`cases.status.${view.status}` as Parameters<typeof t>[0])}<IconChevronDownOutline14 /></Button>}
        items={[{ id: '', label: t('cases.all') }, ...statuses.map(status => ({ id: status, label: t(`cases.status.${status}`) }))]}
        onSelect={(status) => {
          setFilter(false); navigate({ module: 'cases', status: status || undefined, objectId: undefined })
        }} />
      {page !== undefined && <>
        <Menu open={domainMenu} selectedId={view.domain ?? ''} portal onClose={() => { setDomainMenu(false) }}
          anchor={<Button size="sm" variant="secondary" aria-expanded={domainMenu} disabled={domains.length === 0} onClick={() => { setDomainMenu(!domainMenu) }}>
            {view.domain === undefined ? t('world.cases.domainFilter') : domainLabel(view.domain)}<IconChevronDownOutline14 /></Button>}
          items={[{ id: '', label: t('world.cases.domainFilter') }, ...domains.map(domain => ({ id: domain, label: domainLabel(domain) }))]}
          onSelect={(domain) => { setDomainMenu(false); navigate({ module: 'cases', domain: domain || undefined, objectId: undefined }) }} />
        <label className={worldCss.toggle}><input type="checkbox" checked={view.needsAction === true}
          onChange={(event) => { navigate({ module: 'cases', needsAction: event.target.checked || undefined, objectId: undefined }) }} />
        {t('world.cases.needsAction')}</label>
        {props.extensions?.status === 'unpublished' && <WindowStatus window={props.extensions} compact t={t} />}
        <p className={worldCss.coverage}>{t('total')}: <span className={worldCss.figure}>{page.total}</span> · {t('revision')}: <span
          className={worldCss.figure}>{page.snapshotRevision}</span></p>
      </>}
    </div>
    <Feedback value={state} t={t} />
    <WorkspaceStage detail={requestId !== undefined}>
      <div className={worldCss.tablePane}>
        {keysWithheld && <p className={worldCss.columnSummary}>{t('world.columns.summary', { count: keys.length,
          facts: t('world.columns.fact', { label: t('world.cases.businessKey'), value: t('world.withheld') }) })}</p>}
        <table ref={table} className={`${worldCss.dataTable} ${worldCss.matterTable}`}
          aria-label={props.extensions === undefined ? t('cases') : t('world.nav.cases')}><thead><tr>
            {showUpdated && <th className={worldCss.updatedCol}>{t('world.cases.time')}</th>}
            <th className={worldCss.routeCol}>{t('cases.requester')} → {t('world.cases.target')}</th>
            <th>{t('world.cases.action')}</th>{showKey && <th>{t('world.cases.businessKey')}</th>}
            <th>{t('world.cases.result')}</th>
          </tr></thead><tbody>{visible?.map((item) => {
            const ext = extensions?.find(entry => entry.requestId === item.requestId)
            const business = item.businessSummary
            return <tr key={item.requestId} data-selected={item.requestId === requestId || undefined}
              aria-selected={item.requestId === requestId} onClick={(event) => {
                if ((event.target as HTMLElement).closest('button') === null) open(item.requestId)
              }}>
              {showUpdated && <td className={`${worldCss.time} ${worldCss.updatedCol}`} data-empty={ext?.updatedAt === undefined || undefined}>{ext?.updatedAt === undefined ? '—' : groupTime(ext.updatedAt)}</td>}
              <td className={`${worldCss.cellTight} ${worldCss.routeCol}`}><span className={worldCss.route}>{item.requesterEntityId ?? t('cases.authenticatedUser')}
                <span aria-hidden="true">→</span>{ext?.target?.text ?? item.targetEntityId}</span></td>
              {/* The request identity is copyable in the inspector; the row leads with the business action. */}
              <td><button type="button" className={worldCss.matterOpen} data-world-case-request={item.requestId}
                aria-label={item.requestId} title={item.requestId}
                onClick={(event) => { open(item.requestId, event.currentTarget) }}>
                <span className={worldCss.matterLine}>
                  <span className={worldCss.domainTag} data-domain={item.domain}>{domainLabel(item.domain)}</span>
                  <BusinessAction summary={business} operation={`${item.operation} v${item.version}`} t={t} /></span></button></td>
              {showKey && <td>{ext === undefined ? '—' : ext.businessKey.state === 'allowed'
                ? <code className={worldCss.keyCode}>{ext.businessKey.value.text}</code>
                : <DisclosedValue state={ext.businessKey.state} compact t={t} />}</td>}
              <td className={worldCss.trackCell}>{business.status === 'allowed' ? <ResultLayers value={business.value} compact t={t} />
                : <span className={worldCss.trackWithLabel}>
                  <StatusTrack tracks={caseTracks(item, t)} compact t={t} />
                  <span className={worldCss.flowStatus} data-status={item.status}>
                    <span className={css.visuallyHidden}>{t('world.cases.technicalStatus')}: </span>{t(`cases.status.${item.status}`)}</span></span>}</td>
            </tr>
          })}</tbody></table>
        {state.error === undefined && page?.items.length === 0 && <p className={worldCss.muted}>{t('cases.empty')}</p>}
        {shownRows > 0 && <TrackLegend t={t} />}
        <footer className={css.pagination}>
          {page !== undefined && page.items.length > 0 && <span className={worldCss.coverage} data-page-position>{t('world.cases.position', {
            start: start + 1, end: start + page.items.length, total: page.total })}</span>}
          <Button size="sm" disabled={!props.connected || state.loading} onClick={() => { nextStart.current = 0; void refresh() }}>{t('first')}</Button>
          <Button size="sm" disabled={!props.connected || state.loading || state.stale || page?.nextCursor === undefined} onClick={() => {
            if (page === undefined || page.nextCursor === undefined) return
            nextStart.current = start + page.items.length
            void props.read({ ...input, expectedRevision: page.snapshotRevision, cursor: page.nextCursor })
          }}>{t('next')}</Button>
        </footer>
      </div>
      {requestId !== undefined && <InspectorDock identity={requestId} t={t} close={closeDock}
        title={selected === undefined ? shortId(requestId) : `${selected.operation} v${selected.version}`}
        eyebrow={selected === undefined ? t('cases.detail') : <>{domainLabel(selected.domain)} · {t(`cases.status.${selected.status}`)}</>}
        sections={{ items: sectionItems, current: selectedSection, select: (id) => { navigate({ caseSection: id as Route['caseSection'] }) } }}>
        <p className={worldCss.hashLine}><CopyId value={requestId} compact t={t} />
          {selected !== undefined && <span className={worldCss.route}>
            {selected.requesterEntityId ?? t('cases.authenticatedUser')}<span aria-hidden="true">→</span>{selected.targetEntityId}</span>}</p>
        {value !== undefined && value.summary.businessSummary.status === 'allowed'
          && <p className={worldCss.inspectorLayers}><strong>{value.summary.businessSummary.value.label}</strong>
            <ResultLayers value={value.summary.businessSummary.value} t={t} /></p>}
        {value !== undefined && value.summary.businessSummary.status !== 'allowed'
          && <p className={css.muted}>{t(`world.cases.summary.${value.summary.businessSummary.status}`)}</p>}
        {value !== undefined && <StatusTrack tracks={caseTracks(value.summary, t)} t={t} open={(kind) => {
          navigate({ caseSection: kind === 'plan' ? 'plans' : kind })
        }} />}
        <Feedback value={detailState} t={t} />{detail?.status === 'missing' && <p>{t('cases.missing')}</p>}
        {error !== undefined && <p role="alert">{error}</p>}
        <div className={worldCss.caseBody}>
          {isDomainSection(selectedSection) ? <DomainSection section={selectedSection} extension={extension}
            window={props.extensions} openRef={props.openRef} t={t} /> : value !== undefined && render(value)}
        </div>
        {!isDomainSection(selectedSection) && selectedSection === 'execution' && extension?.mutation !== undefined
          && <MutationSteps phase={extension.mutation.phase} blocked={extension.mutation.blocked}
            cancelRequested={extension.mutation.cancelRequested} t={t} />}
        <div className={worldCss.caseActions}>
          {value !== undefined && <p className={css.muted}>{t(`cases.cancel.${value.summary.cancel.reason}`)}</p>}
          {original === undefined ? <Button variant="secondary" disabled={!canCancel} onClick={() => {
            setCancel(true); void props.inspect({ runId, requestId, section })
          }}>{t('cases.cancel')}</Button>
            : <CommandRecord connected={props.connected} value={original[1]} t={t} query={() => props.query(original[0] as never)}
              retry={() => props.submit(original[0] as never)} />}
        </div>
        {cancel && <section role="group" aria-label={t('cases.cancelConfirm')} className={worldCss.cancelConfirm}>
          <p>{t('cases.cancelNotice')}</p>
          {cancelPreview !== undefined && <>
            <dl className={worldCss.keyValue}>
              <div><dt>{t('world.action.nativeRevision')}</dt><dd>#{cancelPreview.snapshotRevision}</dd></div>
              <div><dt>{t('world.track.request')}</dt><dd>{t(`cases.status.${cancelPreview.impact.requestStatus}`)}</dd></div>
            </dl>
            {(['planIds', 'hiringReservationIds', 'personnelReservationIds', 'representativeReservationIds',
              'unconfirmedExecutionPlanIds'] as const).map(kind => <section key={kind}>
              <strong>{t(`cases.cancelImpact.${kind}`)}: {cancelPreview.impact[kind].length}</strong>
              <ul>{cancelPreview.impact[kind].map(id => <li key={id}><CopyId value={id} compact t={t} /></li>)}</ul>
            </section>)}
            <p className={worldCss.hashLine}>{t('world.action.previewHash')} <CopyId value={cancelPreview.previewHash} compact t={t} /></p>
          </>}
          <div className={css.actions}>
            <Button onClick={() => { setCancel(false) }}>{t('keepEditing')}</Button>
            <Button variant="primary" disabled={!canCancel} onClick={confirmCancel}>{t('cases.cancelConfirm')}</Button>
          </div>
        </section>}
      </InspectorDock>}
    </WorkspaceStage>
  </div>
}
function assertNever(value: never): never { throw new Error(`Unknown World case section: ${String(value)}`) }

/** Original callback and preparation responsibilities remain independent of business outcome and delivery. */
function CaseExecutionState({ value, t, openPlan, openRecovery }: {
  value: Extract<SimulationProductWorldCaseDetail, { section: 'execution' }>
  t: CommandProps['t']
  openPlan: () => void
  openRecovery: () => void
}) {
  const observation = value.observation
  return <section aria-label={t('cases.execution.title')}>
    <h3>{t('cases.execution.title')}</h3>
    {observation === undefined ? <p className={css.muted}>{t('cases.execution.absent')}</p> : <>
      <p><TrackNode state={observation.status === 'settled' ? 'done' : observation.status === 'blocked' ? 'blocked' : 'unknown'} />
        {' '}{t(`cases.execution.${observation.status}`)}</p>
      {observation.reason !== null && <p>{t(`status.stop.${observation.reason}`)}</p>}
      <p className={css.notice}>{t(observation.status === 'settled' ? 'cases.execution.settledNotice'
        : observation.status === 'blocked' ? 'cases.execution.blockedNotice' : 'cases.execution.unknownNotice')}</p>
      <p>{t('cases.execution.plan')}: <code>{observation.planId}</code></p>
      <p>{t('cases.execution.position')}: {observation.sequence} · {t('cases.execution.time')}: {groupTime(observation.time)}</p>
      <div className={css.actions}>
        <Button variant="secondary" onClick={openPlan}>{t('cases.execution.viewPlan')}</Button>
        {observation.status !== 'settled' && <Button variant="secondary" onClick={openRecovery}>{t('cases.execution.viewRecovery')}</Button>}
      </div>
    </>}
    {value.responsibilities !== undefined && <section aria-label={t('cases.execution.duties')}>
      <h4>{t('cases.execution.duties')}</h4>
      {value.responsibilities.map(duty => <div key={`${duty.kind}:${duty.id}`} className={css.detail}>
        <p>{t(`cases.duty.kind.${duty.kind}`)} · {t(`cases.duty.${duty.status}`)}</p>
        <code>{duty.id}</code><p>{t('cases.execution.plan')}: <code>{duty.planId}</code></p>
        <p>{t('cases.execution.position')}: {duty.updatedSequence}</p>
      </div>)}
    </section>}
  </section>
}

/**
 * Evidence and source sections come from the World domain projection.
 * @param props.section - Domain-backed section.
 * @param props.extension - Projection for the selected case, when loaded.
 * @returns evidence requirement timeline or exact engine links.
 */
function DomainSection({ section, extension, window, openRef, t }: {
  section: DomainSection
  extension: WorldCaseExtension | undefined
  window: WorldWindow<readonly WorldCaseExtension[]> | undefined
  openRef: ((ref: EngineRef) => void) | undefined
  t: CommandProps['t']
}) {
  if (extension === undefined) return window === undefined ? null : <WindowStatus window={window} t={t} />
  switch (section) {
    case 'evidence': {
      const evidence = extension.evidence
      if (evidence === undefined) return <p className={worldCss.muted}>{t('world.cases.evidence.none')}</p>
      return <>
        <p className={worldCss.warning}>{t('world.cases.evidence.missing', { fields: evidence.fields.join('、'),
          responder: evidence.responders.map(item => item.text).join('、'), deadline: groupTime(evidence.deadline) })}</p>
        <p>{t('world.cases.evidence.remaining', { count: evidence.remainingAttempts })}</p>
        <h4>{t('world.cases.evidence.history')}</h4>
        <ol className={worldCss.revisionList}>{evidence.revisions.map((revision, index) => <li key={index}>
          <span className={worldCss.time}>{groupTime(revision.at)}</span> {revision.summary.text}</li>)}</ol>
      </>
    }
    case 'source': return extension.sources.length === 0 ? <p className={worldCss.muted}>{t('world.cases.source.none')}</p>
      : <ul className={worldCss.sourceLinks}>{extension.sources.map((ref, index) => <li key={index}>
        <EngineRefLink value={ref} open={openRef} t={t}><span className={worldCss.kindTag}>{t(`world.ref.kind.${ref.kind}`)}</span>
          <code>{refText(ref)}</code>{ref.label !== undefined && <span>{ref.label}</span>}</EngineRefLink></li>)}</ul>
    default: return assertNever(section)
  }
}
