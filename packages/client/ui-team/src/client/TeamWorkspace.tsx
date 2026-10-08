import { describeNavigationFailure, type NavigationFailure } from './navigation-error.ts'
/** Selected Team workspace and its authenticated module controls. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@clocky/clocky-client-ui-slots'
import type { HostDescriptionSource } from '@clocky/clocky-client-connection/client'
import type { TeamBrowserInjected } from './TeamBrowser.tsx'
import { TeamPage } from './TeamPage.tsx'
import css from './TeamWorkspace.module.css'
import { DEFAULT_TEAM_VIEW, DraftCapacityError, type createTeamWorkspaceStore, type TeamViewState } from './workspace-store.ts'
import { Button } from '@clocky/clocky-client-ui-primitives'
import { readWorkspaceRoute, workspaceRouteIdentity, workspaceRouteUrl, type WorkspaceRoute } from './workspace-navigation.ts'
import { TeamActionDialog } from './TeamActionDialog.tsx'
import { hasTaskDraftInput } from './task-draft.ts'
import { readWorkspaceSource, restoreWorkspaceFocus, WORKSPACE_NAVIGATION_EVENT } from '@clocky/clocky-client-ui-layout/client'
export type { TeamWorkspaceView } from './workspace-store.ts'

type TeamWorkspaceControls = Pick<TeamBrowserInjected,
  'watchAttention' | 'readAttention' | 'refreshAttentionPreview' | 'pauseAttention' | 'openPendingAction' | 'inspectAction' | 'closeActionDetail' | 'readTaskQuery' | 'pauseTaskQuery' | 'watchIdentities' | 'refreshIdentities' | 'watchExecutionProfiles' | 'refreshExecutionProfiles' | 'watchMemberReadiness' | 'refreshMemberReadiness' | 'watchTaskCapabilities' | 'refreshTaskCapabilities' | 'readDependencies' | 'closeDependencies' | 'watchTaskReferences' | 'refreshTaskReferences' | 'lookupTaskUpdate' | 'readMemberDetail' | 'closeMemberDetail' | 'readWorkflowDetail' | 'closeWorkflowDetail' | 'readTaskDetail' | 'closeTaskDetail' | 'respondAction' | 'openActionContext' | 'manageTeam' | 'cancelTask' | 'cancelTeam' | 'deleteTask' | 'openTeam' | 'openParticipantSession' | 'readArtifact' | 'readCollections' | 'readAudit' | 'readChannel' | 'acknowledgeChannel' | 'closeChannelView' | 'readChannels' | 'readChannelAttachment' | 'readChannelCatalog' | 'resumeTeam'>
  & Required<Pick<TeamBrowserInjected, 'openParticipantSession' | 'readAudit' | 'readChannel' | 'closeChannelView' | 'readArtifact'>>

/** Framework-bound Team state plus the existing Host operation callbacks. */
export type TeamWorkspaceProps = PropsRuntime<'team.workspace'> & PropsRenderSlots<'team.channel.message'>
  & PropsLocale<'team'> & PropsStore<ReturnType<typeof createTeamWorkspaceStore>> & TeamWorkspaceControls
  & InjectFace<{ hooks: { hostDescription: HostDescriptionSource } }>
  & { maxDraftBytes?: number | undefined
    navigateApplication: (href: string) => void
    openCoordinator: () => Promise<void>
    restoreNavigation: (route: WorkspaceRoute |
     undefined,
      signal: AbortSignal) => Promise<void> }

/**
 * Render the selected Team independently from descendant Session inspection.
 * @param props - framework state, viewing store, localized labels, and authenticated controls.
 * @returns the selected Team workspace, or no content before selection.
 */
export function TeamWorkspace({ maxDraftBytes, useTeamTasks,
  useHostDescription,
  useSessions,
  useStore,
  actions,
  renderSlot,
  t,
  openCoordinator,
  navigateApplication,
  restoreNavigation,
  ...controls }: TeamWorkspaceProps) {

  const state = useTeamTasks?.(snapshot => snapshot)
  const [actionError, setActionError] = useState<string>()
  const selected = state?.selected?.teamId === state?.current ? state?.selected : undefined
  const teamId = selected?.teamId
  useEffect(() => { if (teamId !== undefined) actions.update(teamId, {}) }, [teamId])
  const workspaceState = useStore(snapshot => snapshot)
  const viewState = teamId === undefined ? DEFAULT_TEAM_VIEW : workspaceState.byTeam[teamId] ?? DEFAULT_TEAM_VIEW
  const { view } = viewState
  const workspaceRef = useRef<HTMLDivElement>(null)
  const scrollTop = viewState.scroll[view] ?? 0
  const scrollPosition = useRef(0)
  useLayoutEffect(() => {
    const element = workspaceRef.current
    if (element === null || teamId === undefined) return
    element.scrollTop = scrollTop
    scrollPosition.current = element.scrollTop
    return () => { actions.rememberScroll(teamId, view, scrollPosition.current) }
  }, [actions, teamId, view, scrollTop])
  const sessionId = useSessions(snapshot => snapshot.current)
  const [navigationError, setNavigationError] = useState<NavigationFailure>()
  const failedHeading = useRef<HTMLHeadingElement>(null)
  const [navigationPending, setNavigationPending] = useState(false)
  const [navigationEpoch, setNavigationEpoch] = useState(0)
  const restoreRef = useRef(restoreNavigation)
  restoreRef.current = restoreNavigation
  const restoring = useRef(false)
  const historyRequest = useRef<AbortController>()
  const historyUrl = useRef<string>()
  const historyIdentity = useRef('')
  const authorizationScope = useHostDescription(description => description?.authorizationScope)
  const priorAuthorizationScope = useRef(authorizationScope)
  useEffect(() => {
    if (authorizationScope === undefined) return
    if (priorAuthorizationScope.current !== undefined && authorizationScope !== priorAuthorizationScope.current) actions.clearFormDrafts()
    priorAuthorizationScope.current = authorizationScope
  }, [authorizationScope, actions])
  useEffect(() => {
    if (state?.error?.code === 'PRODUCT_AUTH_INVALID') actions.clearFormDrafts()
  }, [state?.error?.code, actions])
  const hasFormDrafts = Object.values(workspaceState.byTeam).some(team => Object.keys(team.actionDrafts).length > 0
    || Object.values(team.taskDrafts).some(hasTaskDraftInput))
  useEffect(() => {
    if (!hasFormDrafts) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn) }
  }, [hasFormDrafts])
  const handshakeComplete = useHostDescription(description => description !== undefined)
  useEffect(() => {
    if (!handshakeComplete) return
    const restore = () => {
      historyRequest.current?.abort()
      if (new URL(window.location.href).searchParams.get('workspace') === 'simulation') return
      const controller = new AbortController()
      const requestedHref = window.location.href
      historyRequest.current = controller
      restoring.current = true
      setNavigationPending(true)
      setNavigationError(undefined)
      void (async () => {
        const route = readWorkspaceRoute(requestedHref)
        await restoreRef.current(route, controller.signal)
        if (controller.signal.aborted) return
        historyUrl.current = workspaceRouteUrl(window.location.href, route)
        historyIdentity.current = workspaceRouteIdentity(route)
      })().catch((error: unknown) => {
        /* v8 ignore next -- The injected route owner absorbs aborted reads before this UI catch observes them. */
        if (!controller.signal.aborted) {
          const failure = describeNavigationFailure(error)
          const deniedTeam = new URL(requestedHref).searchParams.get('team')
          if (failure.reason === 'forbidden' && deniedTeam !== null) actions.clearFormDrafts(deniedTeam as import('@clocky/clocky-client-runtime/client').TeamId)
          setNavigationError(failure)
        }
      }).finally(() => {
        if (historyRequest.current === controller) {
          restoring.current = false
          setNavigationPending(false)
          setNavigationEpoch(value => value + 1)
        }
      })
    }
    if (new URL(window.location.href).searchParams.has('team')) restore()
    else historyUrl.current = window.location.href
    window.addEventListener('popstate', restore)
    window.addEventListener(WORKSPACE_NAVIGATION_EVENT, restore)
    return () => { historyRequest.current?.abort(); window.removeEventListener('popstate', restore); window.removeEventListener(WORKSPACE_NAVIGATION_EVENT, restore) }
  }, [handshakeComplete, authorizationScope])
  const participantId = state?.memberSession !== undefined && state.memberSession.teamId === teamId
    && state.memberSession.sessionId === sessionId
    ? state.memberSession.participantId : selected?.state.coordinator.kind === 'bound'
      && selected.state.coordinator.binding.sessionId === sessionId
      ? selected.state.coordinator.binding.activation.participantId : undefined
  const activeChannel = view === 'channels' ? state?.channel?.channelId : undefined
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('workspace') === 'simulation') return
    if (!handshakeComplete || restoring.current || navigationPending || navigationError !== undefined
      || state?.phase !== 'ready' || (state.current !== undefined && teamId === undefined)) return
    const route: WorkspaceRoute | undefined = teamId === undefined ? undefined : { teamId, view,
      actionId: viewState.actionId, taskForm: viewState.taskForm,
      planId: view === 'workflows' ? viewState.workflowPlanId : undefined,
      taskId: view === 'tasks' ? viewState.taskId : undefined, channelId: activeChannel, sessionId, participantId,
      search: view === 'tasks' ? viewState.taskSearch : '', phase: view === 'tasks' ? viewState.taskPhase : 'all',
      ...view === 'overview' ? { viz: viewState.overviewViz } : {},
    }
    const url = workspaceRouteUrl(window.location.href, route)
    // A completed target read can arrive after the application navigator has
    // already committed this route. Retire the stale local history cursor
    // without adding a second entry for the identical destination.
    if (url === window.location.href) {
      historyUrl.current = url
      historyIdentity.current = workspaceRouteIdentity(route)
      return
    }
    if (url === historyUrl.current) return
    const identity = workspaceRouteIdentity(route)
    if (historyUrl.current === undefined || identity === historyIdentity.current) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState(window.history.state, '', url)
    historyUrl.current = url
    historyIdentity.current = identity
  },
  [teamId,
    handshakeComplete,
    view,
    viewState.taskForm,
    viewState.actionId,
    viewState.workflowPlanId,
    viewState.taskId,
    viewState.taskSearch,
    viewState.taskPhase,
    viewState.overviewViz,
    sessionId,
    participantId,
    activeChannel,
    navigationEpoch,
    navigationPending,
    navigationError,
    state?.phase,
    state?.current])
  useLayoutEffect(() => {
    if (new URL(window.location.href).searchParams.get('workspace') === 'simulation') return
    if (navigationError !== undefined) failedHeading.current?.focus()
    else if (!navigationPending && workspaceRef.current !== null && teamId !== undefined) restoreWorkspaceFocus(workspaceRef.current)
  }, [navigationError, navigationPending, navigationEpoch, teamId, view])
  const resetNavigation = () => {
    historyRequest.current?.abort()
    restoring.current = false
    setNavigationPending(false)
    historyUrl.current = workspaceRouteUrl(window.location.href, undefined)
    historyIdentity.current = ''
    window.history.replaceState(window.history.state, '', historyUrl.current)
    setNavigationError(undefined)
    void restoreRef.current(undefined, new AbortController().signal).catch((error: unknown) => {
      setNavigationError(describeNavigationFailure(error))
    })
  }
  const source = readWorkspaceSource(window.history.state, window.location.href)
  const sourceRoute = source === undefined ? undefined : new URL(source).searchParams
  const sourceLabel = sourceRoute?.get('workspace') === 'simulation' ? 'workspace.sourceSimulation' : 'workspace.sourceTeam'
  const sourceId = sourceRoute?.get('simulation') ?? sourceRoute?.get('team')
  const sourceObject = sourceRoute?.get('simulationObject') ?? sourceRoute?.get('task') ?? sourceRoute?.get('channel') ?? sourceRoute?.get('session')
  const returnToSource = source === undefined ? null : <nav className={css.sourceContext} aria-label={t('workspace.sourceContext')}>
    <span>{t(sourceLabel)}</span>
    {sourceId !== null && sourceId !== undefined && <details><summary>{t('workspace.sourceLocation')}</summary>
      <dl><dt>{t('workspace.sourceIdentity')}</dt><dd><code>{sourceId}</code></dd>
        {sourceObject !== null && sourceObject !== undefined && <><dt>{t('workspace.sourceObject')}</dt><dd><code>{sourceObject}</code></dd></>}
      </dl>
    </details>}
    <Button variant="secondary" onClick={() => { navigateApplication(source) }}>{t('workspace.returnToSource')}</Button>
  </nav>
  const navigationFailure = navigationError === undefined ? null : <main className={css.workspace} data-team-navigation-error>
    <h1 ref={failedHeading} tabIndex={-1}>{t('workspace.targetUnavailable')}</h1>
    <div role="alert"><p>{t(`workspace.navigation.${navigationError.reason}`)}</p></div>
    <p>{t('workspace.requestedTarget')}: <code>{new URL(window.location.href).searchParams.get('team')}</code></p>
    <details><summary>{t('workspace.navigationDetails')}</summary><p>{navigationError.detail}</p></details>
    <div className={css.pendingControls}>
      {returnToSource}
      <Button variant="secondary" onClick={() => { window.dispatchEvent(new Event(WORKSPACE_NAVIGATION_EVENT)) }}>{t('workspace.retryNavigation')}</Button>
      <Button onClick={resetNavigation}>{t('workspace.resetNavigation')}</Button>
    </div>
  </main>
  const { watchIdentities, refreshIdentities, watchExecutionProfiles, refreshExecutionProfiles,
    watchMemberReadiness, refreshMemberReadiness, watchTaskCapabilities, refreshTaskCapabilities,
    readTaskQuery, pauseTaskQuery, readDependencies, closeDependencies, watchTaskReferences, refreshTaskReferences,
    lookupTaskUpdate, readMemberDetail, closeMemberDetail,
    readWorkflowDetail, closeWorkflowDetail, readTaskDetail, closeTaskDetail, inspectAction, closeActionDetail,
    cancelTask, cancelTeam, openTeam, deleteTask,
    openParticipantSession, readArtifact, readCollections,
    readAudit, readChannel, acknowledgeChannel, closeChannelView, readChannels, readChannelAttachment,
    readChannelCatalog, manageTeam, respondAction, openActionContext, resumeTeam } = controls
  if (navigationFailure !== null) return navigationFailure
  const requestedTeam = new URL(window.location.href).searchParams.get('team')
  if (requestedTeam !== null && (navigationPending || !handshakeComplete) && requestedTeam !== teamId) {
    return <main className={css.workspace} aria-busy="true"><p role="status">{t('workspace.loadingTarget')}</p></main>
  }
  if (teamId === undefined || selected === undefined) return null
  const actionFailure = (error: unknown) => { setActionError(error instanceof Error ? error.message : String(error)) }
  const directMember = selected.state.readAccess === 'member'
  const writableTeam = directMember && selected.state.executionManagement !== 'simulation-managed'
  const cancel = !writableTeam || cancelTeam === undefined ? undefined : async () => { await cancelTeam(teamId) }
  const resume = !writableTeam || resumeTeam === undefined ? undefined : async () => { await resumeTeam(teamId) }
  const updateView = (patch: Partial<TeamViewState>) => {
    // Layout persistence is emitted on first paint as well as after dragging;
    // it cannot cancel authorization of the requested navigation target.
    if (Object.keys(patch).some(key => key !== 'taskListScroll' && key !== 'swarmPositions')) {
      historyRequest.current?.abort()
      restoring.current = false
      setNavigationPending(false)
      setNavigationError(undefined)
    }
    actions.update(teamId, patch)
  }
  const selectedActionId = viewState.actionId
  const respond = !writableTeam || respondAction === undefined ? undefined : async (input: import('@clocky/clocky-client-runtime/client').TeamActionResponseInput, signal?: AbortSignal) => {
    const { teamId: _inputTeamId, ...answer } = input
    return await respondAction(teamId, answer, signal)
  }
  return <div
    ref={workspaceRef}
    className={css.workspace}
    aria-busy={navigationPending || undefined}
    data-team-workspace-page
    onScroll={(event) => {
      scrollPosition.current = event.currentTarget.scrollTop
    }}>
    {returnToSource}
    {!directMember && <p role="status">{t('workspace.parentInspection')}</p>}

    {actionError !== undefined && <p role="alert">{actionError}</p>}
    <TeamPage maxDraftBytes={maxDraftBytes}
      key={teamId}
      view={view}
      onViewChange={(next) => { updateView({ view: next, actionId: undefined, taskForm: undefined }) }}
      openCoordinator={selected.state.coordinator.kind === 'bound' ? openCoordinator : undefined}
      taskView={viewState}
      onTaskViewChange={updateView}
      onTaskDraftChange={(target, draft) => {
        try { actions.setTaskDraft(teamId, target, draft) }
        catch (error: unknown) {
          /* v8 ignore next 2 -- Typed form drafts reach this store only through its bounded-capacity admission. */
          if (error instanceof DraftCapacityError) throw new Error(t('taskForm.draftCapacity'))
          /* v8 ignore next -- Typed form drafts cannot raise another store failure here. */
          throw error
        }
      }}
      onTaskDraftDiscard={(target) => { actions.discardTaskDraft(teamId, target) }}
      onChannelDraftChange={(channelId, draft) => { actions.setChannelDraft(teamId, channelId, draft) }}
      onChannelDraftDiscard={(channelId) => { actions.discardChannelDraft(teamId, channelId) }}
      readMemberDetail={readMemberDetail} closeMemberDetail={closeMemberDetail} memberDetail={state?.memberDetail}
      state={selected.state}
      artifactDetail={state?.artifactDetail}
      attentionPreview={state?.attentionPreview} attention={state?.attention}
      watchAttention={controls.watchAttention} readAttention={controls.readAttention} pauseAttention={controls.pauseAttention}
      refreshAttentionPreview={controls.refreshAttentionPreview}
      openPendingAction={inspectAction === undefined ? undefined : (_teamId, actionId) => {
        updateView({ actionId }); return Promise.resolve()
      }}
      workflowDetail={state?.workflowDetail}
      closeWorkflowDetail={closeWorkflowDetail}
      readWorkflowDetail={readWorkflowDetail === undefined ? undefined : async (id, mode) => { await readWorkflowDetail(teamId, id, mode) }}
      identities={state?.identities} watchIdentities={watchIdentities} refreshIdentities={refreshIdentities}
      executionProfiles={state?.executionProfiles}
      watchExecutionProfiles={watchExecutionProfiles} refreshExecutionProfiles={refreshExecutionProfiles}
      memberReadiness={state?.memberReadiness}
      watchMemberReadiness={watchMemberReadiness}
      refreshMemberReadiness={refreshMemberReadiness}
      taskCapabilities={state?.taskCapabilities}
      watchTaskCapabilities={watchTaskCapabilities}
      refreshTaskCapabilities={refreshTaskCapabilities}
      taskQuery={state?.taskQuery} readTaskQuery={readTaskQuery} pauseTaskQuery={pauseTaskQuery}
      taskReferences={state?.taskReferences} watchTaskReferences={watchTaskReferences}
      refreshTaskReferences={refreshTaskReferences} lookupTaskUpdate={lookupTaskUpdate}
      dependencyQuery={state?.dependencyQuery}
      readDependencies={readDependencies}
      closeDependencies={closeDependencies}
      taskDetail={state?.taskDetail}
      readTaskDetail={readTaskDetail}
      closeTaskDetail={closeTaskDetail}
      {...state?.collections?.teamId !== teamId ? {} : { collections: state.collections }}
      renderSlot={renderSlot}
      translate={t}
      openParticipantSession={async (participantId) => {
        try { await openParticipantSession(teamId, participantId) } catch (error: unknown) { actionFailure(error) }
      }}
      openTeam={async (childTeamId) => {
        await openTeam(childTeamId)
      }}
      {...readCollections === undefined ? {} : {
        readCollections: async (collection, mode) => { await readCollections(teamId, collection, mode) },
      }}
      readAudit={async (options, signal) => await readAudit(teamId, options, signal)}
      readChannel={readChannel}
      {...state?.channel === undefined ? {} : { channelState: state.channel }}
      {...state?.channels === undefined ? {} : { channelListState: state.channels }}
      {...readChannels === undefined ? {} : { readChannels }}
      {...readChannelAttachment === undefined ? {} : { readChannelAttachment }}
      {...readChannelCatalog === undefined ? {} : { readChannelCatalog }}
      {...state?.channelCatalog === undefined ? {} : { channelCatalog: state.channelCatalog }}
      {...!writableTeam || acknowledgeChannel === undefined ? {} : { acknowledgeChannel }}
      closeChannelView={closeChannelView}
      {...!writableTeam || manageTeam === undefined ? {} : {
        manage: async (command, signal) => { await manageTeam(teamId, command, signal) },
      }}
      readArtifact={async (artifactId, signal) => { await readArtifact(teamId, artifactId, signal) }}
      {...!writableTeam || deleteTask === undefined ? {} : {
        deleteTask: async (taskId, expectedRevision, signal) => {
          await deleteTask(teamId, taskId, expectedRevision, signal)
        },
      }}
      {...!writableTeam || cancelTask === undefined ? {} : {
        cancelTask: async (taskId, expectedRevision, reason, signal) => {
          await cancelTask(teamId, taskId, expectedRevision, reason, signal)
        },
      }}
      {...cancel === undefined ? {} : { onCancel: cancel }}
      {...resume === undefined ? {} : { onResume: resume }}
    />
    {selectedActionId !== undefined && inspectAction !== undefined && closeActionDetail !== undefined && <TeamActionDialog
      teamId={teamId} actionId={selectedActionId} detail={state?.actionDetail}
      draft={viewState.actionDrafts[selectedActionId]}
      inspect={inspectAction} closeDetail={closeActionDetail} translate={t} respond={respond} openContext={openActionContext}
      changeDraft={(draft) => {
        try { actions.setActionDraft(teamId, selectedActionId, draft) }
        catch (error: unknown) {
          /* v8 ignore next 2 -- Typed answer drafts reach this store only through its bounded-capacity admission. */
          if (error instanceof DraftCapacityError) throw new Error(t('human.draftCapacity'))
          /* v8 ignore next -- Typed answer drafts cannot raise another store failure here. */
          throw error
        }
      }}
      discardDraft={() => { actions.discardActionDraft(teamId, selectedActionId) }}
      onClose={() => { updateView({ actionId: undefined }) }} />}
  </div>
}
