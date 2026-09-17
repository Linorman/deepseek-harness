/** Selected Team workspace and its authenticated module controls. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@clocky/clocky-client-ui-slots'
import type { TeamBrowserInjected } from './TeamBrowser.tsx'
import { TeamPage } from './TeamPage.tsx'
import css from './TeamWorkspace.module.css'
import { DEFAULT_TEAM_VIEW, type createTeamWorkspaceStore, type TeamViewState } from './workspace-store.ts'
import { Button } from '@clocky/clocky-client-ui-primitives'
import { readWorkspaceRoute, workspaceRouteIdentity, workspaceRouteUrl, type WorkspaceRoute } from './workspace-navigation.ts'
export type { TeamWorkspaceView } from './workspace-store.ts'

type TeamWorkspaceControls = Pick<TeamBrowserInjected,
  'inspectMember' | 'readWorkflowDetail' | 'closeWorkflowDetail' | 'readTaskDetail' | 'closeTaskDetail' | 'respondAction' | 'openActionContext' | 'manageTeam' | 'cancelTask' | 'cancelTeam' | 'deleteTask' | 'openTeam' | 'openParticipantSession' | 'readArtifact' | 'readCollections' | 'readAudit' | 'readChannel' | 'acknowledgeChannel' | 'closeChannelView' | 'readChannels' | 'readChannelAttachment' | 'readChannelCatalog' | 'resumeTeam'>

/** Framework-bound Team state plus the existing Host operation callbacks. */
export type TeamWorkspaceProps = PropsRuntime<'team.workspace'> & PropsRenderSlots<'team.channel.message'>
  & PropsLocale<'team'> & PropsStore<ReturnType<typeof createTeamWorkspaceStore>> & TeamWorkspaceControls
  & { maxDraftBytes?: number | undefined
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
  useSessions,
  useStore,
  actions,
  renderSlot,
  t,
  openCoordinator,
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
  const [navigationError, setNavigationError] = useState<string>()
  const [navigationEpoch, setNavigationEpoch] = useState(0)
  const restoreRef = useRef(restoreNavigation)
  restoreRef.current = restoreNavigation
  const restoring = useRef(false)
  const historyRequest = useRef<AbortController>()
  const historyUrl = useRef<string>()
  const historyIdentity = useRef('')
  useEffect(() => {
    const restore = () => {
      historyRequest.current?.abort()
      const controller = new AbortController()
      historyRequest.current = controller
      restoring.current = true
      setNavigationError(undefined)
      void (async () => {
        const route = readWorkspaceRoute(window.location.href)
        await restoreRef.current(route, controller.signal)
        if (controller.signal.aborted) return
        historyUrl.current = workspaceRouteUrl(window.location.href, route)
        historyIdentity.current = workspaceRouteIdentity(route)
      })().catch((error: unknown) => {
        if (!controller.signal.aborted) setNavigationError(error instanceof Error ? error.message : String(error))
      }).finally(() => {
        if (historyRequest.current === controller) {
          restoring.current = false
          setNavigationEpoch(value => value + 1)
        }
      })
    }
    if (new URL(window.location.href).searchParams.has('team')) restore()
    else historyUrl.current = window.location.href
    window.addEventListener('popstate', restore)
    return () => { historyRequest.current?.abort(); window.removeEventListener('popstate', restore) }
  }, [])
  const participantId = state?.memberSession !== undefined && state.memberSession.teamId === teamId
    && state.memberSession.sessionId === sessionId
    ? state.memberSession.participantId : undefined
  const activeChannel = view === 'channels' ? state?.channel?.channelId : undefined
  useEffect(() => {
    if (restoring.current || navigationError !== undefined || state?.phase !== 'ready' || (state.current !== undefined && teamId === undefined)) return
    const route: WorkspaceRoute | undefined = teamId === undefined ? undefined : { teamId, view,
      planId: view === 'workflows' ? viewState.workflowPlanId : undefined,
      taskId: view === 'tasks' ? viewState.taskId : undefined, channelId: activeChannel, sessionId, participantId,
      search: view === 'tasks' ? viewState.taskSearch : '', phase: view === 'tasks' ? viewState.taskPhase : 'all',
    }
    const url = workspaceRouteUrl(window.location.href, route)
    if (url === historyUrl.current) return
    const identity = workspaceRouteIdentity(route)
    if (historyUrl.current === undefined || identity === historyIdentity.current) window.history.replaceState(window.history.state, '', url)
    else window.history.pushState(window.history.state, '', url)
    historyUrl.current = url
    historyIdentity.current = identity
  },
  [teamId,
    view,
    viewState.workflowPlanId,
    viewState.taskId,
    viewState.taskSearch,
    viewState.taskPhase,
    sessionId,
    participantId,
    activeChannel,
    navigationEpoch,
    navigationError,
    state?.phase,
    state?.current])
  const resetNavigation = () => {
    historyRequest.current?.abort()
    restoring.current = false
    historyUrl.current = workspaceRouteUrl(window.location.href, undefined)
    historyIdentity.current = ''
    window.history.replaceState(window.history.state, '', historyUrl.current)
    setNavigationError(undefined)
    void restoreRef.current(undefined, new AbortController().signal).catch((error: unknown) => { setNavigationError(String(error)) })
  }
  const navigationFailure = navigationError === undefined ? null : <div className={css.navigationError} role="alert">
    <p>{navigationError}</p><Button size="sm" onClick={resetNavigation}>{t('workspace.resetNavigation')}</Button>
  </div>
  const { inspectMember, readWorkflowDetail, closeWorkflowDetail, readTaskDetail, closeTaskDetail,
    cancelTask, cancelTeam, openTeam, deleteTask,
    openParticipantSession, readArtifact, readCollections,
    readAudit, readChannel, acknowledgeChannel, closeChannelView, readChannels, readChannelAttachment,
    readChannelCatalog, manageTeam, respondAction, openActionContext, resumeTeam } = controls
  if (teamId === undefined || selected === undefined) return navigationFailure
  const actionFailure = (error: unknown) => { setActionError(error instanceof Error ? error.message : String(error)) }
  const cancel = cancelTeam === undefined ? undefined : async () => { await cancelTeam(teamId) }
  const resume = resumeTeam === undefined ? undefined : async () => { await resumeTeam(teamId) }
  const updateView = (patch: Partial<TeamViewState>) => {
    if (Object.keys(patch).some(key => key !== 'taskListScroll')) {
      historyRequest.current?.abort()
      restoring.current = false
      setNavigationError(undefined)
    }
    actions.update(teamId, patch)
  }
  return <div
    ref={workspaceRef}
    className={css.workspace}
    data-team-workspace-page
    onScroll={(event) => {
      scrollPosition.current = event.currentTarget.scrollTop
    }}>
    {navigationFailure}

    {actionError !== undefined && <p role="alert">{actionError}</p>}
    <TeamPage maxDraftBytes={maxDraftBytes}
      key={teamId}
      view={view}
      onViewChange={(next) => { updateView({ view: next }) }}
      openCoordinator={openCoordinator}
      taskView={viewState}
      onTaskViewChange={updateView}
      onChannelDraftChange={(channelId, draft) => { actions.setChannelDraft(teamId, channelId, draft) }}
      onChannelDraftDiscard={(channelId) => { actions.discardChannelDraft(teamId, channelId) }}
      inspectMember={inspectMember}
      state={selected.state}
      humanActions={state?.inbox?.items.flatMap(item => item.kind === 'action' && item.action.teamId === teamId ? [item.action] : [])}
      workflowDetail={state?.workflowDetail}
      closeWorkflowDetail={closeWorkflowDetail}
      readWorkflowDetail={readWorkflowDetail === undefined ? undefined : async (id, mode) => { await readWorkflowDetail(teamId, id, mode) }}
      taskDetail={state?.taskDetail}
      readTaskDetail={readTaskDetail}
      closeTaskDetail={closeTaskDetail}
      {...state?.collections?.teamId !== teamId ? {} : { collections: state.collections }}
      renderSlot={renderSlot}
      translate={t}
      {...openParticipantSession === undefined ? {} : {
        openParticipantSession: async (participantId) => {
          try { await openParticipantSession(teamId, participantId) } catch (error: unknown) { actionFailure(error) }
        },
      }}
      openTeam={async (childTeamId) => {
        await openTeam(childTeamId)
      }}
      {...readCollections === undefined ? {} : {
        readCollections: async (collection, mode) => { await readCollections(teamId, collection, mode) },
      }}
      {...readAudit === undefined ? {} : {
        readAudit: async (options, signal) => await readAudit(teamId, options, signal),
      }}
      {...readChannel === undefined ? {} : { readChannel }}
      {...state?.channel === undefined ? {} : { channelState: state.channel }}
      {...state?.channels === undefined ? {} : { channelListState: state.channels }}
      {...readChannels === undefined ? {} : { readChannels }}
      {...readChannelAttachment === undefined ? {} : { readChannelAttachment }}
      {...readChannelCatalog === undefined ? {} : { readChannelCatalog }}
      {...state?.channelCatalog === undefined ? {} : { channelCatalog: state.channelCatalog }}
      {...acknowledgeChannel === undefined ? {} : { acknowledgeChannel }}
      {...closeChannelView === undefined ? {} : { closeChannelView }}
      {...respondAction === undefined ? {} : { respondAction: async (input, signal) => {
        const { teamId: _inputTeamId, ...answer } = input
        return await respondAction(teamId, answer, signal)
      } }}
      {...openActionContext === undefined ? {} : { openActionContext }}
      {...manageTeam === undefined ? {} : { manage: async (command, signal) =>{  await manageTeam(teamId, command, signal) } }}
      {...readArtifact === undefined ? {} : {
        readArtifact: async (artifactId, signal) => await readArtifact(teamId, artifactId, signal),
      }}
      {...deleteTask === undefined ? {} : {
        deleteTask: async (taskId, expectedRevision, signal) => {
          await deleteTask(teamId, taskId, expectedRevision, signal)
        },
      }}
      {...cancelTask === undefined ? {} : {
        cancelTask: async (taskId, expectedRevision, reason, signal) => {
          await cancelTask(teamId, taskId, expectedRevision, reason, signal)
        },
      }}
      pendingActions={(state?.pendingHumanActions ?? []).filter(action => action.teamId === teamId)}
      {...cancel === undefined ? {} : { onCancel: cancel }}
      {...resume === undefined ? {} : { onResume: resume }}
    />
  </div>
}
