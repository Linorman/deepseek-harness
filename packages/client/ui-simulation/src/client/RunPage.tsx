/** Selected run page: shared run header and command band, module navigation and the module body. */
import { useState } from 'react'
import { FailureCard } from './FailureCard.tsx'
import { DomainBusinessCard, latestBusinessSummary, peopleNotApplicable } from './DomainSummary.tsx'
import { StopProgress, StopTargetChip, StopTargetDialog } from './StopTargetDialog.tsx'
import { tickUnitLabel } from './RunStateChip.tsx'
import type { ReactNode, RefObject } from 'react'
import { Button, Menu, IconChevronDownOutline14 } from '@clocky/clocky-client-ui-primitives'
import { Moment, navigateWithTransition, transitionDirection } from '@clocky/clocky-client-ui-viz'
import type { SimulationRuntimeState, SimulationProductRunId, SimulationReadState, SimulationAdministrationState,
  SimulationCommandState, SimulationProductControl, SimulationProductCursor, SimulationCalendarState } from '@clocky/clocky-client-runtime/client'
import { WorldCases } from './WorldCases.tsx'
import { CollectionWorkspace } from './CollectionWorkspace.tsx'
import { Feedback, RefreshFeedback } from './Feedback.tsx'
import { observedClock } from './RunStateChip.tsx'
import { useRefreshOutcome } from './useRefreshOutcome.ts'
import { NeedsYou } from './NeedsYou.tsx'
import { RunOverview } from './RunOverview.tsx'
import { RunDetails } from './RunDetails.tsx'
import { RunStateChip } from './RunStateChip.tsx'
import { RunStateBanner } from './RunStateBanner.tsx'
import { runState } from './run-state.ts'
import { RunCommandBar } from './RunCommandBar.tsx'
import { TaskReviews } from './TaskReviews.tsx'
import { PersistentRequests } from './PersistentRequests.tsx'
import { TaskControls } from './TaskControls.tsx'
import { RecordsView } from './RecordsView.tsx'
import { Controls } from './Controls.tsx'
import { WorldOverview } from './WorldOverview.tsx'
import { OrganizationModule } from './WorldOrganization.tsx'
import type { OrganizationRoute } from './WorldOrganization.tsx'
import { GovernanceModule } from './WorldGovernance.tsx'
import type { GovernanceRoute } from './WorldGovernance.tsx'
import { ExternalModule } from './WorldExternal.tsx'
import type { ExternalRoute } from './WorldExternal.tsx'
import { ENGINE_MODULES, WORLD_MODULES, writeRoute } from './store.ts'
import type { Module, Route, SimulationViewState, SimulationWorldActionDraft } from './store.ts'
import type { EngineRef, PersonDetailView, WorldDomainState } from './world-domain.ts'
import type { Props } from './Workspace.tsx'
import type { RunReads } from './useRunReads.ts'
import visualsCss from './Visuals.module.css'
import worldCss from './World.module.css'
import css from './Workspace.module.css'

const modules: Module[] = ['overview', 'entities', 'decisions', 'operations', 'checkpoints', 'records', 'requests', 'cases']

/**
 * @param props - Workspace reads and snapshots for one selected run, plus page-level navigation callbacks.
 * @returns run header, module navigation and the selected module; dialogs stay with the Workspace.
 */
export function RunPage({ workspace, runId, view, data, world, calendar, administration, reads, authorized, retained,
  navigate, openRef, startAction, personTarget, openRetry, renderOriginal, date, locale, root, identity, igniteGeneration }: {
  workspace: Props
  runId: SimulationProductRunId
  view: SimulationViewState
  data: SimulationRuntimeState
  world: WorldDomainState
  calendar: SimulationCalendarState
  administration: SimulationAdministrationState
  reads: RunReads
  authorized: boolean
  retained: readonly (readonly [string, SimulationCommandState])[]
  navigate: (next: Route) => void
  openRef: (ref: EngineRef) => void
  startAction: (draft: SimulationWorldActionDraft) => void
  personTarget: (person: PersonDetailView) => string
  openRetry: (operationId: string, expectedAttemptCount: number) => void
  renderOriginal: (record: SimulationCommandState) => ReactNode
  date: (value: number) => string
  locale: string
  root: RefObject<HTMLElement>
  identity: RefObject<HTMLElement>
  igniteGeneration: number
}) {
  const props = workspace, t = workspace.t
  const { worldRun, scenario, unknownCount, collection, selection, collectionQuery, refresh } = reads
  const [moduleMenu, setModuleMenu] = useState(false)
  const [moreMenu, setMoreMenu] = useState(false)
  const [engineMenu, setEngineMenu] = useState(false)
  const [startRequest, setStartRequest] = useState(0)
  const [editingTarget, setEditingTarget] = useState(false)
  const runControlState = props.useRunControl(value => value)
  // Another run's original command never shows here.
  const stopCommand = runControlState.input?.runId === runId ? runControlState : { status: 'idle' as const }
  // Automatic rereads stay quiet; this row reports actual read failures.
  const worldModule = worldRun && (WORLD_MODULES as readonly string[]).includes(view.module)
  const current = view.module === 'overview' ? data.run : view.module === 'records' ? data.records : view.module === 'requests' ? data.persistentRequests : view.module === 'cases' ? data.worldCases : data.collection
  const run = data.run.value?.run.id === runId ? data.run.value : undefined
  const page = data.collection.value?.runId === runId && data.collection.value.collection === view.module
    && data.collection.scope === collectionQuery
    ? data.collection.value : undefined
  const control: SimulationReadState<SimulationProductControl> = data.control.scope === JSON.stringify(['control', runId])
    && (data.control.value === undefined || data.control.value.runId === runId)
    ? data.control : { loading: false, stale: false }
  const object = data.object.value?.runId === runId && data.object.value.selection.id === view.objectId
    && data.object.value.selection.collection === selection?.collection && data.object.value.selection.section === selection.section
    && (selection.collection !== 'decisions' || selection.section !== 'knowledge' || data.object.value.selection.collection === 'decisions'
      && data.object.value.selection.section === 'knowledge' && data.object.value.selection.reference?.id === selection.reference?.id
      && data.object.value.selection.reference?.revision === selection.reference?.revision)
    ? data.object.value : undefined
  const state = runState({ native: run, control: control.value, nativeFailed: data.run.error !== undefined,
    nativeWatched: data.observation.error === undefined && data.observation.value?.runId === runId,
    controlFailed: control.stale || control.error !== undefined && control.error !== 'forbidden' && control.error !== 'unavailable',
    connected: data.connected, now: Date.now(), refreshMs: props.controlRefreshMs, staleAfterMs: props.staleAfterMs })
  // The overview also refreshes scheduling; a refused control grant is not a failed refresh.
  const controlFailure = control.error === 'forbidden' || control.error === 'unavailable' ? undefined : control.error
  const refreshed = useRefreshOutcome(view.module === 'overview' ? { ...current, error: current.error ?? controlFailure } : current,
    data.connected, props.staleAfterMs, `${runId}:${view.module}`)
  const refreshState = () => { refreshed.start(Promise.all([refresh(), props.control(runId)]).then(() => {})) }
  const activeTarget = control.value?.stopTarget !== undefined && control.value.stopTarget.target !== null && control.value.stopTarget.state !== 'cleared'
  const unit = tickUnitLabel(control.value?.versions?.tickUnit.text ?? run?.world?.tickUnit.text ?? '', t)
  const now = run?.world === undefined ? undefined : String(run.world.time)
  const stopProps = control.value === undefined ? undefined : { state: stopCommand, now, defaults: props.stopDrain,
    update: (target: Parameters<typeof props.updateRunControl>[1]) => { void props.updateRunControl(runId, target) },
    retry: () => { void props.retryRunControl() } }
  const selectedRow = page?.items.find(row => row.id === view.objectId)
  const summary = object?.value !== undefined && 'summary' in object.value ? object.value.summary : undefined
  const objectName = summary !== undefined && 'name' in summary && summary.name !== undefined ? summary.name.text
    : selectedRow !== undefined && 'name' in selectedRow && selectedRow.name !== undefined ? selectedRow.name.text : view.objectId ?? ''
  const readObjectPage = (cursor?: SimulationProductCursor) => {
    /* v8 ignore next -- Object pagination is rendered only for an exact selected object. */
    if (selection === undefined) return
    /* v8 ignore next -- Every paginated object section carries a limit in its selector. */
    if ('limit' in selection) {
      void props.inspectObject({ ...selection, cursor, expectedRevision: cursor === undefined ? undefined : object?.snapshotRevision })
    }
  }
  const businessSummaries = data.worldCases.value?.runId === runId ? data.worldCases.value.items.map(item => item.businessSummary) : []
  const supportsTasks = scenario?.status !== 'observed' || scenario.execution === 'automatic-tasks'
  const reviewCount = data.reviews.value?.runId === runId
    ? data.reviews.value.items.filter(item => item.phase === 'review').length : 0
  const reviewNeeded = reviewCount > 0
  const lookupCount = retained.filter(([, record]) => record.unknown || record.requestObservationUnavailable
    || record.requestObservation?.comparison === 'conflict').length
  const overviewPanels = [
    supportsTasks && <TaskReviews key={`reviews:${runId}`} runId={runId} ready={data.run.scope === JSON.stringify(['run', runId])} value={data.reviews}
      connected={data.connected} authorizationVersion={data.authorizationVersion}
      pageSize={props.pageSize} read={reads.readTaskReviews} drafts={authorized ? view.reviewDrafts : {}}
      target={authorized ? view.reviewTarget : undefined} select={props.actions.reviewTarget} change={props.actions.review}
      commands={administration.commands} retain={props.retain} submit={props.submit} query={props.query} t={t} />,
    !worldRun && <RunOverview key="progress" value={run} pool={control.value?.modelPool} budget={control.value?.budget} t={t} />,
  ]
  if (!reviewNeeded) overviewPanels.reverse()
  const moduleLabel = (module: Module) => module === 'organization' || module === 'governance' || module === 'external'
    || worldRun && (module === 'overview' || module === 'cases') ? t(`world.nav.${module as 'overview'}`) : t(module)
  const navModules: readonly Module[] = worldRun ? WORLD_MODULES : modules.filter(module => module !== 'requests')
  const engineSelected = worldRun && (ENGINE_MODULES as readonly Module[]).includes(view.module)
  const worldFallback = !worldRun && scenario !== undefined && scenario.status !== 'observed'
  const sizing = { width: view.moduleInspectorWidth, maxWidth: props.inspectorMaxWidth, resize: props.actions.moduleInspector }
  // Module navigation rides in the sticky command band below the run identity.
  const moduleNavigation = <>
    <nav className={css.moduleNavigation} aria-label={t('modules')}>
      <div className={css.tabs} aria-label={worldRun ? t('world.nav.label') : undefined}>{navModules.map(module => <Button key={module}
        aria-current={view.module === module ? 'page' : undefined}
        onClick={() => {
          const direction = transitionDirection(navModules, view.module, module)
          navigateWithTransition(() => { navigate({ runId, module, search: view.search }) }, direction)
        }}>{moduleLabel(module)}</Button>)}
      {worldRun ? <Menu open={engineMenu} portal items={ENGINE_MODULES.map(id => ({ id, label: t(id) }))}
        selectedId={engineSelected ? view.module : undefined}
        anchor={<Button variant="secondary" aria-label={engineSelected ? t('world.nav.engineCurrent', { module: t(view.module as 'entities') }) : t('world.nav.engine')}
          aria-expanded={engineMenu} aria-current={engineSelected ? 'page' : undefined}
          onClick={() => { setEngineMenu(!engineMenu) }}>{engineSelected ? t('world.nav.engineCurrent', { module: t(view.module as 'entities') })
            : t('world.nav.engine')}<IconChevronDownOutline14 /></Button>}
        onClose={() => { setEngineMenu(false) }} onSelect={(id) => {
          setEngineMenu(false)
          const module = ENGINE_MODULES.find(value => value === id)
          if (module !== undefined) navigateWithTransition(() => { navigate({ runId, module, search: view.search }) })
        }} /> : <Menu open={moreMenu} portal items={[{ id: 'requests', label: t('requests') }]}
        selectedId={view.module === 'requests' ? 'requests' : undefined}
        anchor={<Button variant="secondary" aria-label={`${t('modules.more')}${view.module === 'requests' ? `: ${t('requests')}` : ''}`}
          aria-expanded={moreMenu} aria-current={view.module === 'requests' ? 'page' : undefined}
          onClick={() => { setMoreMenu(!moreMenu) }}>{t(view.module === 'requests' ? 'requests' : 'more')}<IconChevronDownOutline14 /></Button>}
        onClose={() => { setMoreMenu(false) }} onSelect={() => {
          setMoreMenu(false); navigate({ runId, module: 'requests', search: view.search })
        }} />}
      <div className={worldCss.navStatus} data-nav-status>
        <Feedback value={worldModule ? { ...data.observation, stale: false } : data.observation} t={t} />
        {view.module !== 'requests' && <Feedback value={worldModule ? { ...current, stale: false } : current} t={t} />}</div>
      </div>
      <div className={css.modulePicker}><Menu open={moduleMenu} portal selectedId={view.module}
        items={worldRun ? [...WORLD_MODULES.map(id => ({ id, label: moduleLabel(id) })), { type: 'separator' as const, id: 'engine-separator' },
          { type: 'label' as const, id: 'engine-label', text: t('world.nav.engine') }, ...ENGINE_MODULES.map(id => ({ id, label: t(id) }))]
          : modules.map(id => ({ id, label: moduleLabel(id) }))}
        anchor={<Button variant="secondary" aria-label={`${t('modules')}: ${moduleLabel(view.module)}`} aria-expanded={moduleMenu}
          onClick={() => { setModuleMenu(!moduleMenu) }}>{moduleLabel(view.module)}<IconChevronDownOutline14 /></Button>}
        onClose={() => { setModuleMenu(false) }} onSelect={(id) => {
          const module = [...modules, ...WORLD_MODULES].find(value => value === id)
          /* v8 ignore next -- The menu emits only IDs from the closed modules array above. */
          if (module !== undefined) navigate({ runId, module, search: view.search })
          setModuleMenu(false)
        }} /></div>
    </nav>
  </>
  // One request-history entry; World runs show it inside Run management, other runs below the overview.
  const requestsButton = <Button variant="secondary" onClick={() => {
    navigate({ runId, module: 'requests', search: view.search }) }}>
    {t('requests.open')}{retained.some(([, record]) => record.unknown || record.requestObservationUnavailable
      || record.requestObservation?.comparison === 'conflict') ? ` · ${t('requests.needsLookup')}` : ''}
  </Button>
  return <>
    <RunCommandBar runId={runId} name={run?.run.name.text ?? runId} world={worldRun}
      back={() => { navigateWithTransition(() => { navigate({ module: 'overview', search: view.search }) }) }}
      refresh={() => { refreshed.start(refresh()) }} refreshDisabled={!data.connected}
      refreshOutcome={<RefreshFeedback value={refreshed.outcome} time={at => observedClock(at, locale)} t={t} />}
      root={root} identity={identity} t={t}>
      <Moment kind="ignite" generation={igniteGeneration} className={visualsCss.consoleMoment}><div className={css.runBar}>
        <section aria-label={t('status.header')} className={css.statusHeader}>
          <RunStateChip state={state} locale={locale} t={t} />
          <StopTargetChip stop={control.value?.stopTarget} unit={unit} edit={() => { setEditingTarget(true) }} t={t} />
          <RunDetails value={run} control={control.value} connected={data.connected} header locale={locale} t={t} />
        </section>
        <Controls compact state={state} refreshState={refreshState} startRequest={startRequest} runControl={stopProps}
          attribution={run?.world?.metrics?.tokenAttribution}
          editTarget={() => { setEditingTarget(true) }}
          review={() => { navigate({ runId, module: 'overview', search: view.search }) }} key={`${runId}:${data.authorizationVersion}`} name={run?.run.name.text ?? runId} value={control}
          scheduledWakes={worldRun ? (world.overview.status === 'ready' ? world.overview.value.upcoming.length : undefined) : undefined}
          connected={data.connected} authorizationVersion={data.authorizationVersion} retain={props.retain} submit={props.submit}
          refresh={() => props.control(runId)} openMaintenance={(kind) => { props.actions.maintenance({ runId, kind }) }}
          blockedMaintenance={retained.flatMap(([, record]) => record.command.kind !== 'create' && record.command.kind !== 'manage'
            && record.command.kind !== 'review' && record.command.kind !== 'world-create' && record.command.kind !== 'world-prepare' && record.command.kind !== 'cancel-world-case' && record.command.kind !== 'world-management'
            && record.command.kind !== 'retry-operation' && record.command.kind !== 'retry-request' && record.command.kind !== 'cancel-task'
            && (record.unknown || record.pending || record.receipt?.value.status === 'accepted') ? [record.command.kind] : [])}
          blockedPhases={retained.flatMap(([, record]) => record.command.kind === 'manage'
            && (record.unknown || record.pending || record.receipt?.value.status === 'in-progress') ? [record.command.input.phase] : [])} t={t} />
      </div></Moment>
      <RunStateBanner state={state} t={t} next={activeTarget && <StopProgress stop={control.value.stopTarget} t={t}
        retrySave={control.value.administration.actions.checkpoint.allowed ? () => { props.actions.maintenance({ runId, kind: 'checkpoint' }) } : undefined} />} />
      {moduleNavigation}
    </RunCommandBar>
    {!data.connected && <p className={css.notice} role="status">{t('connection')}</p>}
    {editingTarget && control.value !== undefined && stopProps !== undefined && <StopTargetDialog control={control.value} {...stopProps}
      connected={data.connected} t={t} close={() => { setEditingTarget(false); props.dismissRunControl() }} />}
    {state.failure !== undefined && (state.kind === 'failed' || state.kind === 'blocked') && <FailureCard failure={state.failure}
      state={state} resume={() => { setStartRequest(value => value + 1) }} time={at => date(at)} t={t}
      history={() => { navigate({ runId, module: 'records', search: view.search }) }}
      details={() => {
        const details = root.current?.querySelector<HTMLDetailsElement>('details[data-run-details]')
        if (details === null || details === undefined) return
        details.open = true
        details.querySelector('summary')?.focus()
      }} />}
    {worldFallback && <p className={css.notice} role="status">{t('world.nav.fallback')}</p>}
    {view.worldAction !== undefined && view.worldAction.runId === runId && !view.worldAction.open && <div className={worldCss.resumeBar} role="status">
      <span>{t('world.action.retainedDraft', { action: t(`world.action.${view.worldAction.action}`), target: view.worldAction.target })}</span>
      <Button size="sm" variant="secondary" onClick={() => {
        if (view.worldAction !== undefined) startAction({ ...view.worldAction, open: true })
      }}>{t('world.action.resume')}</Button></div>}
    {view.module === 'cases' ? <WorldCases runId={runId} view={view} data={data} connected={data.connected}
      authorizationVersion={data.authorizationVersion} pageSize={props.pageSize} read={props.listWorldCases}
      inspect={props.inspectWorldCase} closeDetail={props.closeWorldCase} navigate={navigate} commands={administration.commands}
      retain={props.retain} submit={props.submit} query={props.query} t={t}
      {...worldRun ? { extensions: world.caseExtensions, openRef,
        readExtensions: (requestIds: readonly string[]) => { void props.worldReads.caseExtensions({ runId, requestIds }) } } : {}} />
      : view.module === 'organization' ? <OrganizationModule reviewPersona={(positionId, revision, command) => {
        startAction({ runId, action: 'hiring-market', targetId: positionId, target: positionId,
          expectedRevision: revision, values: { command }, open: true })
      }} market={world.hiringMarket}
      readMarket={(family, cursor) => { void props.worldReads.hiringMarket({ runId, family, cursor }) }}
      t={t} sizing={sizing} connected={data.connected} window={world.organization} person={world.person}
      route={{ lens: (view.lens ?? 'structure') as OrganizationRoute['lens'], at: view.at, objectId: view.objectId,
        section: view.worldSection as OrganizationRoute['section'], filter: view.status }}
      navigate={(next, push = true) => {
        const target = { ...view, runId, module: 'organization' as const, ...'lens' in next ? { lens: next.lens } : {}, ...'at' in next ? { at: next.at } : {},
          ...'objectId' in next ? { objectId: next.objectId } : {}, ...'section' in next ? { worldSection: next.section } : {},
          ...'filter' in next ? { status: next.filter } : {} }
        if (push) navigate(target); else { writeRoute(target, false); props.actions.restore(target) }
      }}
      reload={(cursor) => { void props.worldReads.organization({ runId, lens: (view.lens ?? 'structure') as OrganizationRoute['lens'], at: view.at, cursor }) }}
      openRef={openRef} reloadDetail={reads.readPerson}
      openAction={(person, hint) => { startAction({ runId, action: hint.action, targetId: person.personId, target: personTarget(person),
        expectedRevision: person.revision, values: {}, open: true }) }}
      dispose={(person, obligation, disposition) => {
        if (obligation.ref !== undefined) { openRef(obligation.ref); return }
        startAction({ runId, action: 'dispose-obligation', targetId: obligation.id,
          target: `${personTarget(person)} · ${obligation.label.text}`, expectedRevision: obligation.revision, values: { disposition }, open: true }) }} />
        : view.module === 'governance' ? <GovernanceModule t={t} sizing={sizing} connected={data.connected} window={world.governance} proposal={world.proposal} norm={world.norm}
          route={{ lens: (view.lens ?? 'proposals') as GovernanceRoute['lens'], at: view.at, objectId: view.objectId,
            section: view.worldSection as GovernanceRoute['section'] }}
          navigate={(next, push = true) => {
            const target = { ...view, runId, module: 'governance' as const, ...'lens' in next ? { lens: next.lens } : {}, ...'at' in next ? { at: next.at } : {},
              ...'objectId' in next ? { objectId: next.objectId } : {}, ...'section' in next ? { worldSection: next.section } : {} }
            if (push) navigate(target); else { writeRoute(target, false); props.actions.restore(target) }
          }}
          reload={(cursor) => { void props.worldReads.governance({ runId, at: view.at, cursor, lens: (view.lens ?? 'proposals') as GovernanceRoute['lens'] }) }} reloadDetail={reads.readGovernanceDetail} previewImpact={input => props.worldReads.proposal({ runId, proposalId: view.objectId ?? '',
            section: 'impact', normImpact: input })} openRef={openRef} />
          : view.module === 'external' ? <ExternalModule t={t} sizing={sizing} connected={data.connected} window={world.external} identity={world.identity}
            route={{ objectId: view.objectId, section: view.worldSection as ExternalRoute['section'] }}
            navigate={(next, push = true) => {
              const target = { ...view, runId, module: 'external' as const, ...'objectId' in next ? { objectId: next.objectId } : {},
                ...'section' in next ? { worldSection: next.section } : {} }
              if (push) navigate(target); else { writeRoute(target, false); props.actions.restore(target) }
            }}
            reload={(cursor) => { void props.worldReads.external({ runId, cursor }) }} reloadDetail={reads.readIdentity}
            openRef={openRef} />
            : view.module === 'requests' ? <>
              <PersistentRequests key={`${runId}:${data.authorizationVersion}`} runId={runId} ready={data.run.scope === JSON.stringify(['run', runId])}
                value={data.persistentRequests} connected={data.connected} authorizationVersion={data.authorizationVersion}
                pageSize={props.pageSize} read={props.listRequests} refreshRun={async () => {
                  await props.inspect(runId); await props.control(runId)
                }} commands={administration.commands} retain={props.retain} submit={props.submit} query={props.query} t={t} date={date}
                renderOriginal={renderOriginal} originals={retained.map(([, record]) => record)} />
            </> : view.module === 'records' ? <RecordsView key={runId} view={view} data={data} read={props.readRecords} close={props.closeRecords}
              exportRecords={props.exportRecords} cancelExport={props.cancelExport} useExport={props.useRecordsExport}
              pageSize={props.pageSize} navigate={navigate} t={t} /> : view.module === 'overview' ? <div className={css.scroll} style={{ viewTransitionName: 'clocky-module' }}>
              {worldRun ? <WorldOverview runId={runId} calendar={calendar} previewCalendar={props.previewCalendar}
                submitCalendar={props.submitCalendar}
                closeCalendar={props.closeCalendar} recoverCalendar={props.recoverCalendar} cancelCalendar={props.cancelCalendar}
                t={t} window={world.overview} connected={data.connected}
                exporting={data.worldExport.loading}
                people={{ ...data.run, value: run?.world?.people,
                  stale: data.run.stale || !data.connected || data.run.error !== undefined }}
                refreshPeople={() => { void props.inspect(runId) }}
                reload={(cursor) => { void props.worldReads.overview({ runId, cursor }) }}
                exportDefinition={(format) => { void props.exportWorldDefinition({ runId, format, name: run?.run.name.text ?? runId }) }}
                business={<DomainBusinessCard summaries={businessSummaries}
                  loaded={data.worldCases.value?.runId === runId} open={() => { navigate({ runId, module: 'cases', search: view.search }) }} t={t} />}
                peopleApplicable={!peopleNotApplicable(latestBusinessSummary(businessSummaries))}
                budget={<RunOverview value={run} pool={control.value?.modelPool} budget={control.value?.budget} t={t} />}
                extras={<>{!supportsTasks && <p className={css.muted}>{t('cognitionOnly')}</p>}{requestsButton}</>}
                engine={[{ id: 'reviews', count: reviewCount, open: () => {
                  document.querySelector<HTMLElement>('[data-simulation-reviews]')?.scrollIntoView({ block: 'start' })
                } }, { id: 'unknown', count: unknownCount ?? 0, open: () => {
                  navigate({ runId, module: 'operations', search: view.search, status: 'outcome-unknown' })
                } }, { id: 'requests', count: lookupCount, open: () => { navigate({ runId, module: 'requests', search: view.search }) } },
                { id: 'scheduler', count: control.value?.driver === 'failed'
                  || (control.value?.phase ?? run?.world?.phase) === 'stalled' ? 1 : 0, open: () => {
                  const maintenance = document.querySelector<HTMLDetailsElement>('[data-simulation-maintenance]')
                  if (maintenance === null) return
                  maintenance.open = true
                  maintenance.scrollIntoView({ block: 'nearest' })
                } }]}
                links={{
                  attention: (id) => {
                    if (id === 'handoffRequired') navigate({ runId, module: 'organization', lens: 'people', status: 'handoff-required', search: view.search })
                    else if (id === 'retirementUnconfirmed') navigate({ runId, module: 'organization', lens: 'people', status: 'retirement-unconfirmed', search: view.search })
                    else if (id === 'outcomeUnknown') navigate({ runId, module: 'operations', status: 'outcome-unknown', search: view.search })
                    else if (id === 'evidenceRequired') navigate({ runId, module: 'cases', needsAction: true, search: view.search })
                    else navigate({ runId, module: 'records', search: view.search })
                  },
                  module: (module) => { navigate({ runId, module, search: view.search }) },
                  caseStatus: (status) => { navigate({ runId, module: 'cases', status, search: view.search }) },
                  proposal: (id) => { navigate({ runId, module: 'governance', lens: 'proposals', objectId: id, search: view.search }) },
                  records: () => { navigate({ runId, module: 'records', search: view.search }) },
                }} /> : <NeedsYou t={t} items={[
                { id: 'reviews', count: reviewCount, open: () => {
                  document.querySelector<HTMLElement>('[data-simulation-reviews]')?.scrollIntoView({ block: 'start' })
                } },
                { id: 'unknown', count: unknownCount ?? 0, open: () => {
                  navigate({ runId, module: 'operations', search: view.search, status: 'outcome-unknown' })
                } },
                { id: 'requests', count: lookupCount, open: () => { navigate({ runId, module: 'requests', search: view.search }) } },
              ]} />}
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

              {worldRun && <Feedback value={data.worldExport} t={t} />}
              {!worldRun && !supportsTasks && <p className={css.muted}>{t('cognitionOnly')}</p>}
              {overviewPanels}
              {supportsTasks && <TaskControls key={`tasks:${runId}`} runId={runId} ready={data.run.scope === JSON.stringify(['run', runId])}
                value={data.tasks} connected={data.connected} authorizationVersion={data.authorizationVersion} pageSize={props.pageSize}
                read={props.listTasks} drafts={authorized ? view.cancelDrafts : {}} target={authorized ? view.cancelTarget : undefined}
                change={props.actions.cancel} select={props.actions.cancelTarget} commands={administration.commands}
                retain={props.retain} submit={props.submit} query={props.query} t={t} />}
              {!worldRun && requestsButton}
              {run?.status === 'missing' && <p className={css.empty}>{t('missing')}</p>}
            </div> : <CollectionWorkspace view={{ ...view, module: view.module }} runId={runId} data={data} page={page}
              object={object} objectName={objectName} current={current} collection={collection} selection={selection}
              pageSize={props.pageSize} position={view.collectionScroll} rememberScroll={(value) => { props.actions.scroll('collection', value) }}
              refresh={() => { void refresh() }} navigate={navigate} t={t} date={date} browse={props.browse}
              inspectObject={props.inspectObject}
              watchSource={props.watchSource} inspectSource={props.inspectSource} refreshSource={props.refreshSource}
              navigateApplication={props.navigateApplication} readObjectPage={readObjectPage} openRetry={openRetry} />}
    {view.module !== 'overview' && view.module !== 'requests' && retained.length > 0
      && <Button onClick={() => { navigate({ runId, module: 'requests', search: view.search }) }}>{t('requests.open')}</Button>}
  </>
}
