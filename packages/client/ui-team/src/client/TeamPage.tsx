import { MemberReadiness } from './MemberReadiness.tsx'
import { MemberDetail } from './MemberDetail.tsx'
import { WorkflowWorkspace, type WorkflowWorkspaceProps } from './WorkflowWorkspace.tsx'
import { memberLabels, memberPageLabels, overviewMemberLabels, type MemberLabel } from './member-labels.ts'
/** Durable Team detail surface for the browser product shell. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsRenderSlots } from '@clocky/clocky-client-ui-slots'
import { Button, IconChevronDownOutline14, Modal } from '@clocky/clocky-client-ui-primitives'
import type {
  ChannelId,
  ChannelReadPageResult,
  ParticipantId,
  TeamArtifactDetailState,
  TeamArtifactReference,
  TeamAuditList,
  TeamHumanAction,
  TeamActionResponseInput,
  TeamActionResponseResult,
  TeamManagementCommand,
  TeamTaskId,
  TeamTaskSnapshot, TeamTaskRecord, TeamTaskDetailState, ITeamTasks,
  TeamTaskSelection,
  TeamChannelState,
  TeamChannelListState,
  TeamId,
  TeamChannelAttachmentInput, TeamChannelAttachmentResult,
  TeamChannelCatalogState,
  TeamCollectionKind, TeamCollectionsState,
} from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import css from './TeamBrowser.module.css'
import { TeamManagementDialog, type TeamManagementTarget } from './TeamManagementDialog.tsx'
import { TeamTaskDialog, type TeamTaskDialogTarget } from './TeamTaskDialog.tsx'
import type { TeamWorkspaceView } from './TeamWorkspace.tsx'
import { TeamOverview } from './TeamOverview.tsx'
import { TeamAttention } from './TeamAttention.tsx'
import { ArtifactsWorkspace } from './ArtifactsWorkspace.tsx'
import { TeamHeader } from './TeamHeader.tsx'
import { TaskWorkspace } from './TaskWorkspace.tsx'
import type { ChannelComposerDraft } from './channel-draft.ts'
import { DEFAULT_TEAM_VIEW, type TeamViewState } from './workspace-store.ts'
import { ChannelHub } from './ChannelHub.tsx'
import { taskDraftKey, hasTaskDraftInput, type TaskFormDraft } from './task-draft.ts'

/** Localized participant role labels; numbered worker roles share one label. */
const participantRoleKey: Record<string, TeamKey> = {
  human: 'detail.participant.role.human',
  coordinator: 'detail.participant.role.coordinator',
  worker: 'detail.participant.role.worker',
  reviewer: 'detail.participant.role.reviewer',
}

/** Whether a durable participant belongs to the configured worker pool. */
function isWorkerRole(role: string): boolean {
  return role === 'worker' || /^worker-\d+$/u.test(role)
}

/** Loaded choices for forms; these arrays describe only the current collection windows. */
export interface TeamLoadedContext {
  readonly team: TeamTaskSelection['state']['team']
  readonly participants: readonly MemberLabel[]
  readonly tasks: readonly { readonly id: TeamTaskId; readonly phase: TeamTaskSnapshot['phase']; readonly subject: string }[]
}

/** Controls and projection supplied by the host-facing Team page owner. */
export interface TeamPageProps {
  readonly attentionPreview?: import('@clocky/clocky-client-runtime/client').TeamAttentionState | undefined
  readonly attention?: import('@clocky/clocky-client-runtime/client').TeamAttentionState | undefined
  readonly watchAttention?: ((teamId: TeamId) => () => void) | undefined
  readonly readAttention?: ((teamId: TeamId, mode?: 'first' | 'next') => Promise<void>) | undefined
  readonly refreshAttentionPreview?: ((teamId: TeamId) => Promise<void>) | undefined
  readonly pauseAttention?: (() => void) | undefined
  readonly openPendingAction?: ((teamId: TeamId, id: TeamActionResponseInput['actionId']) => Promise<void>) | undefined
  readonly memberDetail?: import('@clocky/clocky-client-runtime/client').TeamMemberDetailState | undefined
  readonly closeMemberDetail?: import('@clocky/clocky-client-runtime/client').ITeamTasks['closeMemberDetail']
  readonly readMemberDetail?: import('@clocky/clocky-client-runtime/client').ITeamTasks['readMemberDetail']
  readonly onTaskDraftChange?: ((target: TeamTaskDialogTarget, draft: TaskFormDraft) => void) | undefined
  readonly onTaskDraftDiscard?: ((target: TeamTaskDialogTarget) => void) | undefined
  readonly maxDraftBytes?: number | undefined
  readonly workflowDetail?: WorkflowWorkspaceProps['detail']
  readonly readWorkflowDetail?: WorkflowWorkspaceProps['read']
  readonly closeWorkflowDetail?: WorkflowWorkspaceProps['close']
  readonly humanActions?: readonly import('@clocky/clocky-client-connection/client').TeamHumanActionSnapshot[] | undefined
  identities?: import('@clocky/clocky-client-runtime/client').TeamIdentityState | undefined
  watchIdentities?: ((teamId: import('@clocky/clocky-client-runtime/client').TeamId, ids: readonly import('@clocky/clocky-client-runtime/client').ParticipantId[]) => () => void) | undefined
  refreshIdentities?: (() => Promise<void>) | undefined
  executionProfiles?: import('@clocky/clocky-client-runtime/client').TeamExecutionProfilesState | undefined
  watchExecutionProfiles?: ((input: import('@clocky/clocky-client-runtime/client').TeamExecutionProfilesInput) => () => void) | undefined
  refreshExecutionProfiles?: (() => Promise<void>) | undefined
  readonly memberReadiness?: import('@clocky/clocky-client-runtime/client').TeamMemberReadinessState | undefined
  readonly watchMemberReadiness?: ((input: import('@clocky/clocky-client-runtime/client').TeamMemberReadinessInput) => () => void) | undefined
  readonly refreshMemberReadiness?: ITeamTasks['refreshMemberReadiness']
  readonly taskCapabilities?: import('@clocky/clocky-client-runtime/client').TeamTaskCapabilitiesState | undefined
  readonly watchTaskCapabilities?: ((input: import('@clocky/clocky-client-runtime/client').TeamTaskCapabilitiesInput) => () => void) | undefined
  readonly refreshTaskCapabilities?: ITeamTasks['refreshTaskCapabilities']
  readonly lookupTaskUpdate?: ITeamTasks['lookupTaskUpdate']
  readonly taskReferences?: import('@clocky/clocky-client-runtime/client').TaskReferencesState | undefined
  readonly watchTaskReferences?: import('./TeamBrowser.tsx').TeamBrowserInjected['watchTaskReferences']
  readonly refreshTaskReferences?: (() => Promise<void>) | undefined
  readonly dependencyQuery?: import('@clocky/clocky-client-runtime/client').TeamTaskQueryState | undefined
  readonly taskQuery?: import('@clocky/clocky-client-runtime/client').TeamTaskQueryState | undefined
  readonly readTaskQuery?: ITeamTasks['readTaskQuery']
  readonly pauseTaskQuery?: ITeamTasks['pauseTaskQuery']
  readonly readDependencies?: ITeamTasks['readDependencies']
  readonly closeDependencies?: ITeamTasks['closeDependencies']
  readonly taskDetail?: TeamTaskDetailState | undefined
  readonly readTaskDetail?: ITeamTasks['readTaskDetail']
  readonly closeTaskDetail?: (() => void) | undefined
  /** Active Team workspace module. */
  readonly view?: TeamWorkspaceView
  /** Select another module while preserving this Team's browsing state. */
  readonly onViewChange?: (view: TeamWorkspaceView) => void
  /** Open the current coordinator Session on explicit request. */
  readonly openCoordinator?: (() => Promise<void>) | undefined
  /** Controlled task preferences when the page belongs to a persistent workspace. */
  readonly taskView?: TeamViewState
  /** Publish task navigation and filtering to the workspace owner. */
  readonly onTaskViewChange?: (patch: Partial<TeamViewState>) => void
  /** Retain channel drafts under their exact Team/channel identity. */
  readonly onChannelDraftDiscard?: (channelId: ChannelId) => void
  readonly onChannelDraftChange?: (channelId: ChannelId, draft: ChannelComposerDraft) => void
  /** Complete durable Team projection selected by the caller. */
  readonly state: TeamTaskSelection['state']
  /** Independently paged member/task/artifact projections, when the runtime provides them. */
  readonly collections?: TeamCollectionsState | undefined
  /** Locale-aware visible copy and accessibility labels. */
  readonly translate: (key: TeamKey, vars?: Record<string, unknown>) => string
  /** Apply one authenticated member or channel command. */
  readonly manage?: (command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>
  /** Optional cancellation control. */
  readonly onCancel?: () => Promise<void>
  /** Optional re-attachment control for stalled/offline Teams. */
  readonly onResume?: () => Promise<void>
  /** Open a Participant's descendant Session. */
  readonly openParticipantSession?: (participantId: ParticipantId) => Promise<void>
  /** Open a child Team in the same read-only detail surface without resuming it. */
  readonly openTeam?: (teamId: TeamId) => Promise<void>
  /** Read one bounded authoritative Team or channel audit page. */
  readonly readAudit?: (
    options?: { channelId?: ChannelId; afterCursor?: number; limit?: number },
    signal?: AbortSignal,
  ) => Promise<TeamAuditList>
  /** Read one bounded authoritative channel WAL suffix. */
  readonly readChannel?: (channelId: ChannelId, afterCursor?: number, signal?: AbortSignal) => Promise<ChannelReadPageResult>
  /** Runtime-owned channel records, invitation and live-read state. */
  readonly channelState?: TeamChannelState
  /** Provider-bounded channel pages; Team.channelIds is not a product list. */
  readonly channelListState?: TeamChannelListState
  /** Load or explicitly extend this Team's channel list. */
  readonly readChannels?: (teamId: TeamId, mode?: 'refresh' | 'next' | 'first') => Promise<void>
  /** Framework render share for the declared channel-message child slot. */
  readonly renderSlot?: PropsRenderSlots<'team.channel.message'>['renderSlot']
  /** Host-backed exact Envelope attachment reader. */
  readonly readChannelAttachment?: (input: TeamChannelAttachmentInput, signal?: AbortSignal) => Promise<TeamChannelAttachmentResult>
  readonly channelCatalog?: TeamChannelCatalogState
  readonly readChannelCatalog?: () => Promise<void>
  /** Accept only the displayed principal invitation. */
  readonly acknowledgeChannel?: (channelId: ChannelId) => Promise<void>
  /** Stop the runtime observation when this inspection surface closes. */
  readonly closeChannelView?: () => void
  /** Read and verify one visible artifact retained by the selected Team. */
  readonly readArtifact?: ((artifactId: string, signal?: AbortSignal) => Promise<void>) | undefined
  /** Runtime-owned bytes for one independently selected exact artifact. */
  readonly artifactDetail?: TeamArtifactDetailState | undefined
  /** Load one bounded member or task collection page. */
  readonly readCollections?: (collection: TeamCollectionKind, mode?: 'refresh' | 'next' | 'first') => Promise<void>
  /** Answer a durable request through the authenticated principal owner. */
  readonly respondAction?: (input: TeamActionResponseInput, signal?: AbortSignal) => Promise<TeamActionResponseResult>
  /** Inspect an action's exact Session without resuming an activation. */
  readonly openActionContext?: (action: TeamActionResponseResult['action']) => Promise<void>
  /** Host-owned approval/question requests associated with this Team. */
  readonly pendingActions?: readonly TeamHumanAction[]
  /** Delete one lease-free task after the user confirms its tombstone. */
  readonly deleteTask?: (taskId: TeamTaskId, expectedRevision: number, signal?: AbortSignal) => Promise<void>
  /** Stop one assigned or running task after the user confirms cancellation. */
  readonly cancelTask?: (taskId: TeamTaskId, expectedRevision: number, reason?: string, signal?: AbortSignal) => Promise<void>
}

/** Render the Team objective, lifecycle, roster, task graph, channels, and durable audit controls. */
export function TeamPage({ onTaskDraftChange, onTaskDraftDiscard, maxDraftBytes, readMemberDetail, closeMemberDetail, memberDetail,
  workflowDetail, readWorkflowDetail, closeWorkflowDetail,
  attentionPreview, attention, watchAttention, readAttention, refreshAttentionPreview, pauseAttention, openPendingAction,
  identities, watchIdentities, refreshIdentities,
  executionProfiles, watchExecutionProfiles, refreshExecutionProfiles,
  memberReadiness, watchMemberReadiness, refreshMemberReadiness,
  taskCapabilities, watchTaskCapabilities, refreshTaskCapabilities,
  taskQuery, readTaskQuery, pauseTaskQuery,
  dependencyQuery, readDependencies, closeDependencies, taskReferences, watchTaskReferences, refreshTaskReferences, lookupTaskUpdate,
  taskDetail, readTaskDetail, closeTaskDetail,
  view: controlledView,
  onViewChange,
  openCoordinator,
  taskView,
  onTaskViewChange,
  onChannelDraftChange,
  onChannelDraftDiscard,
  state,
  collections,
  translate,
  manage,
  onCancel,
  onResume,
  openParticipantSession,
  openTeam,
  readAudit,
  readChannel,
  channelState,
  channelListState,
  readChannels,
  renderSlot,
  readChannelAttachment,
  channelCatalog,
  readChannelCatalog,
  acknowledgeChannel,
  closeChannelView,
  readArtifact,
  artifactDetail,
  readCollections,
  deleteTask,
  cancelTask,
}: TeamPageProps) {
  const { team } = state
  const simulationManaged = state.executionManagement === 'simulation-managed'
  if (simulationManaged) {
    manage = undefined
    onCancel = undefined
    onResume = undefined
    deleteTask = undefined
    cancelTask = undefined
    acknowledgeChannel = undefined
  }
  const [localTaskView, setLocalTaskView] = useState(DEFAULT_TEAM_VIEW)
  const taskPreferences = taskView ?? localTaskView
  const taskPreferencesRef = useRef(taskPreferences)
  taskPreferencesRef.current = taskPreferences
  const view = controlledView ?? taskPreferences.view
  useEffect(() => {
    if (view === 'overview') return watchAttention?.(team.id)
    if (view === 'attention') {
      if (attention?.teamId !== team.id || attention.page === undefined) void readAttention?.(team.id, 'first')
      return () => { pauseAttention?.() }
    }
  }, [team.id, view, watchAttention, readAttention, pauseAttention])
  const updateTaskView = onTaskViewChange ??
     ((patch: Partial<TeamViewState>) => {
       setLocalTaskView(current => ({ ...current,
         ...patch }))
     })
  useEffect(() => {
    const id = taskPreferences.workflowPlanId
    if (view === 'workflows' && id !== undefined && (workflowDetail?.teamId !== team.id || workflowDetail.planId !== id)) void readWorkflowDetail?.(id, 'open')
  }, [view, team.id, taskPreferences.workflowPlanId, workflowDetail?.teamId, workflowDetail?.planId, readWorkflowDetail])
  const pageRoot = useRef<HTMLElement | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<TeamTaskId | undefined>()
  const focusTask = (event: MouseEvent<HTMLAnchorElement>, taskId: TeamTaskId): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setFocusedTaskId(taskId)
    updateTaskView({ taskId, view: 'tasks', taskSearch: '', taskPhase: 'all' })
    onViewChange?.('tasks')
  }
  const participants = memberPageLabels(collections?.members.items ?? [])
  const tableQuery = taskQuery?.teamId === team.id && taskQuery.query.search === taskPreferences.taskSearch
    && taskQuery.query.phase === (taskPreferences.taskPhase === 'all' ? undefined : taskPreferences.taskPhase)
    && taskQuery.query.excludeTaskId === undefined ? taskQuery : undefined
  const taskRows = view === 'tasks' && readTaskQuery !== undefined ? tableQuery?.page?.items ?? [] : collections?.tasks.items ?? []
  const tasks = taskRows.map(task => ({ ...task, subject: task.subject.text }))
  const identityIds = JSON.stringify([...new Set([
    ...((view === 'tasks' || view === 'overview') ? tasks.flatMap(task => task.ownerId === undefined ? [] : [task.ownerId]) : []),
    ...taskDetail?.record.value?.task.lease?.participantId === undefined ? [] : [taskDetail.record.value.task.lease.participantId],
    ...taskDetail?.latest.value?.participantId === undefined ? [] : [taskDetail.latest.value.participantId],
    ...(taskDetail?.attempts.value?.items ?? []).map(attempt => attempt.participantId),
    ...(view === 'channels' ? (channelListState?.items ?? []).flatMap(channel => channel.manifest.participants.map(member => member.id)) : []),
    ...(view === 'channels' ? [channelState?.page?.channel, channelState?.admission?.channel, channelState?.invitation?.channel]
      .flatMap(channel => channel?.manifest.participants.map(member => member.id) ?? []) : []),
  ])])
  useEffect(() => {
    return watchIdentities?.(team.id, JSON.parse(identityIds) as ParticipantId[])
  }, [team.id, identityIds, watchIdentities])
  const identityState = identities?.teamId === team.id ? identities : undefined
  const tableQueryRef = useRef(tableQuery)
  tableQueryRef.current = tableQuery
  useEffect(() => {
    if (view !== 'tasks' || readTaskQuery === undefined) return
    const current = tableQueryRef.current
    const search = taskPreferences.taskSearch
    const phase = taskPreferences.taskPhase === 'all' ? undefined : taskPreferences.taskPhase
    if (current?.page === undefined || current.query.search !== search || current.query.phase !== phase) {
      void readTaskQuery(team.id, { search, ...phase === undefined ? {} : { phase } })
    }
    return () => { pauseTaskQuery?.() }
  }, [team.id, view, taskPreferences.taskSearch, taskPreferences.taskPhase, readTaskQuery, pauseTaskQuery])
  const readTable = (mode: 'first' | 'next') => readTaskQuery?.(team.id, { search: taskPreferences.taskSearch,
    ...taskPreferences.taskPhase === 'all' ? {} : { phase: taskPreferences.taskPhase } }, mode)
  const loadedContext: TeamLoadedContext = { team, participants: memberLabels(state, participants), tasks }
  const workflowCollection = collections?.workflowPlans
  const workflowPlans = workflowCollection?.items ?? []
  const metadata = state.metadata?.kind === 'available' ? state.metadata : undefined
  const taskDialogTarget = taskPreferences.taskForm
  const setTaskDialogTarget = (target: TeamTaskDialogTarget | undefined) => { updateTaskView({ taskForm: target }) }
  const [memberDetailId, setMemberDetailId] = useState<ParticipantId>()
  const readinessIds = JSON.stringify([...new Set([
    ...(view === 'members' ? participants : view === 'overview' ? overviewMemberLabels(state, participants) : []).map(member => member.id),
    ...memberDetailId === undefined ? [] : [memberDetailId],
  ])])
  useEffect(() => {
    const participantIds = JSON.parse(readinessIds) as ParticipantId[]
    if (participantIds.length === 0) return
    return watchMemberReadiness?.({ teamId: team.id, participantIds })
  }, [team.id, readinessIds, watchMemberReadiness])
  const readiness = memberReadiness?.input.teamId === team.id ? memberReadiness : undefined
  const readinessStale = readiness?.disconnected === true || readiness?.error !== undefined
    || readiness?.value !== undefined && readiness.value.teamCursor < team.cursor
  const [managementTarget, setManagementTarget] = useState<TeamManagementTarget | undefined>()
  const canManage = state.readAccess === 'member' && manage !== undefined && team.phase === 'active'
  const [deletedTaskId, setDeletedTaskId] = useState<TeamTaskId | undefined>()
  const visibleTasks = taskRows.filter(task => task.phase !== 'deleted' && task.id !== deletedTaskId)
  const workers = participants.filter(participant => isWorkerRole(participant.role))
  const activeWorkers = workers.filter(participant => participant.phase === 'active').length
  const workingTasks = state.counts.tasks.assigned + state.counts.tasks.running
  const artifacts = (collections?.artifacts.items ?? []).filter(artifact => artifact.visibility !== 'private')
  const [audit, setAudit] = useState<TeamAuditList | undefined>()
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | undefined>()
  const auditRequest = useRef<AbortController | undefined>()
  const deleteTaskRequest = useRef<AbortController | undefined>()
  const cancelTaskRequest = useRef<AbortController | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<TeamTaskRecord | undefined>()
  const [deletingTaskId, setDeletingTaskId] = useState<TeamTaskId | undefined>()
  const [deleteTaskError, setDeleteTaskError] = useState<string | undefined>()
  const [cancelTarget, setCancelTarget] = useState<TeamTaskRecord | undefined>()
  const [cancellingTaskId, setCancellingTaskId] = useState<TeamTaskId | undefined>()
  const [cancelTaskError, setCancelTaskError] = useState<string | undefined>()
  const hasAuditSection = readAudit !== undefined || audit !== undefined || auditLoading || auditError !== undefined

  useLayoutEffect(() => {
    const root = pageRoot.current
    if (focusedTaskId === undefined || root === null) return
    const row = root.ownerDocument.getElementById(`team-task-${focusedTaskId}`)
    if (row !== null && root.contains(row)) row.querySelector('button')?.focus()
    else root.querySelector<HTMLButtonElement>('[data-task-inspector] [data-task-close]')?.focus()
  }, [focusedTaskId, view])

  useEffect(() => {
    auditRequest.current?.abort()
    if (taskView === undefined) setLocalTaskView(DEFAULT_TEAM_VIEW)
    setFocusedTaskId(undefined)
    setManagementTarget(undefined)
    setMemberDetailId(undefined)
    setAudit(undefined)
    setAuditLoading(false)
    setAuditError(undefined)
    deleteTaskRequest.current?.abort()
    cancelTaskRequest.current?.abort()
    setDeleteTarget(undefined)
    setDeletingTaskId(undefined)
    setDeleteTaskError(undefined)
    setCancelTarget(undefined)
    setCancellingTaskId(undefined)
    setCancelTaskError(undefined)
    setDeletedTaskId(undefined)
    return () => {
      auditRequest.current?.abort()
      deleteTaskRequest.current?.abort()
      cancelTaskRequest.current?.abort()
    }
  }, [team.id])
  const loadAudit = async (afterCursor = -1): Promise<void> => {
    if (readAudit === undefined) return
    auditRequest.current?.abort()
    const controller = new AbortController()
    auditRequest.current = controller
    setAuditError(undefined)
    setAuditLoading(true)
    try {
      const page = await readAudit({ limit: 64, ...afterCursor === -1 ? {} : { afterCursor } }, controller.signal)
      if (controller.signal.aborted) return
      setAudit(page)
    } catch (error: unknown) {
      if (!controller.signal.aborted) setAuditError(error instanceof Error ? error.message : String(error))
    } finally {
      if (auditRequest.current === controller) setAuditLoading(false)
    }
  }

  const loadArtifact = async (reference: TeamArtifactReference): Promise<void> => {
    if (readArtifact !== undefined && reference.provider !== undefined) await readArtifact(reference.id)
  }

  const closeDeleteTask = (): void => {
    if (deletingTaskId !== undefined) return
    setDeleteTarget(undefined)
    setDeleteTaskError(undefined)
  }

  const confirmDeleteTask = (): void => {
    if (deleteTask === undefined || deleteTarget === undefined || deletingTaskId !== undefined) return
    const target = deleteTarget
    const controller = new AbortController()
    deleteTaskRequest.current?.abort()
    deleteTaskRequest.current = controller
    setDeletingTaskId(target.id)
    setDeleteTaskError(undefined)
    void deleteTask(target.id, target.revision, controller.signal).then(() => {
      if (controller.signal.aborted) return
      setDeleteTarget(undefined)
      setDeletedTaskId(target.id)
      if (taskPreferencesRef.current.taskId === target.id) updateTaskView({ taskId: undefined })
      updateTaskView({ taskId: undefined })
    }, (error: unknown) => {
      if (!controller.signal.aborted) setDeleteTaskError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (deleteTaskRequest.current === controller) deleteTaskRequest.current = undefined
      setDeletingTaskId(undefined)
    })
  }

  const closeCancelTask = (): void => {
    if (cancellingTaskId !== undefined) return
    setCancelTarget(undefined)
    setCancelTaskError(undefined)
  }

  const confirmCancelTask = (): void => {
    if (cancelTask === undefined || cancelTarget === undefined || cancellingTaskId !== undefined) return
    const target = cancelTarget
    const controller = new AbortController()
    cancelTaskRequest.current?.abort()
    cancelTaskRequest.current = controller
    setCancellingTaskId(target.id)
    setCancelTaskError(undefined)
    void cancelTask(target.id, target.revision, translate('detail.task.stopReason'), controller.signal).then(() => {
      if (controller.signal.aborted) return
      setCancelTarget(undefined)
    }, (error: unknown) => {
      if (!controller.signal.aborted) setCancelTaskError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (cancelTaskRequest.current === controller) cancelTaskRequest.current = undefined
      setCancellingTaskId(undefined)
    })
  }

  return (
    <main ref={pageRoot} className={css.page} aria-label={translate('detail.title')} data-team-id={String(team.id)} title={String(team.id)}>
      <TeamHeader state={state} view={view} translate={translate}
        {...onViewChange === undefined ? {} : { onViewChange }}
        {...openCoordinator === undefined ? {} : { openCoordinator }}
        {...onCancel === undefined ? {} : { onCancel }}
        {...onResume === undefined ? {} : { onResume }} />

      {identityState?.disconnected && <p role="status" className={css.notice}>{translate('identity.disconnected')}</p>}
      {identityState?.error !== undefined && <p role="alert" className={css.error}>{identityState.error}
        {refreshIdentities !== undefined && <Button onClick={() => { void refreshIdentities() }}>{translate('identity.retry')}</Button>}
      </p>}
      {view === 'overview' && <TeamOverview openMember={readMemberDetail === undefined ? undefined : setMemberDetailId} identities={identityState} memberReadiness={readiness} state={state} collections={collections} attentionPreview={attentionPreview} refreshAttentionPreview={refreshAttentionPreview} openPendingAction={openPendingAction} translate={translate} artifacts={artifacts}
        navigate={(next) => { updateTaskView({ view: next }); onViewChange?.(next) }}
        openTask={(taskId) => { updateTaskView({ taskId, view: 'tasks', taskSearch: '', taskPhase: 'all' }); onViewChange?.('tasks') }}
        inspectActivity={(cursor) => { updateTaskView({ view: 'audit' }); onViewChange?.('audit'); setAudit(undefined); void loadAudit(Math.max(-1, cursor - 1)) }}
        {...readArtifact === undefined ? {} : { openArtifact: (reference: TeamArtifactReference) => { updateTaskView({ view: 'artifacts' }); onViewChange?.('artifacts'); void loadArtifact(reference) } }}
        {...openParticipantSession === undefined ? {} : { openParticipantSession }}
        {...readAudit === undefined ? {} : { readAudit }} /> }
      {memberDetailId !== undefined && readMemberDetail !== undefined && closeMemberDetail !== undefined && <MemberDetail key={`${team.id}:${memberDetailId}`}
        teamId={team.id} participantId={memberDetailId} read={readMemberDetail} closeDetail={closeMemberDetail}
        detail={memberDetail} translate={translate}
        readiness={readiness?.value?.items.find(item => item.participantId === memberDetailId)}
        readinessStale={readinessStale}
        onClose={() => { setMemberDetailId(undefined) }} />}
      {view === 'attention' && <TeamAttention
        state={attention?.teamId === team.id ? attention : undefined}
        counts={attention?.page !== undefined && attention.page.teamCursor >= team.cursor ? attention.page.counts : state.attentionCounts}
        translate={translate} read={readAttention === undefined ? undefined : async (mode) => { await readAttention(team.id, mode) }}
        openTask={(id) => { updateTaskView({ view: 'tasks', taskId: id }); onViewChange?.('tasks') }}
        openRecovery={() => { updateTaskView({ view: 'audit' }); onViewChange?.('audit') }}
        openAction={openPendingAction === undefined ? undefined : async (id) => { await openPendingAction(team.id, id) }} />}
      {view === 'members' && <>
        <section className={css.section} aria-label={translate('detail.participants')}>
          <div className={css.sectionHeader}>
            <h2>{translate('detail.participants')}</h2>
            {canManage && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberInvite' }) }}>{translate('manage.memberInvite')}</button>}
            <small>{activeWorkers} {translate(activeWorkers === 1 ? 'detail.workerActive.one' : 'detail.workerActive.other')} · {workingTasks} {translate(workingTasks === 1 ? 'detail.activeTask.one' : 'detail.activeTask.other')}</small>
            {collections?.members.startCursor !== undefined && collections.members.startCursor >= 0 && readCollections !== undefined && <button type="button"
              disabled={collections.members.loading || collections.members.loadingMore} onClick={() => { void readCollections('members', 'first') }}>
              {translate('detail.firstPage')}
            </button>}
            {collections?.members.nextCursor !== undefined && readCollections !== undefined && <button type="button"
              disabled={collections.members.loading || collections.members.loadingMore} onClick={() => { void readCollections('members', 'next') }}>
              {translate('detail.loadMembers')}
            </button>}
            {readCollections !== undefined && <button type="button"
              disabled={collections?.members.loading || collections?.members.loadingMore} onClick={() => { void readCollections('members') }}>
              {translate('detail.refreshMembers')}
            </button>}
          </div>
          {readCollections !== undefined && <p className={css.muted}>{translate('detail.pageWindow')}</p>}
          {collections?.members.loading && <p className={css.muted} role="status">{translate('detail.membersLoading')}</p>}
          {collections?.members.error !== undefined && <p className={css.error} role="alert">{collections.members.error}</p>}
          <div className={css.actions}>
            {refreshMemberReadiness !== undefined && <Button aria-busy={readiness?.loading} disabled={readiness?.disconnected}
              onClick={() => { void refreshMemberReadiness() }}>{translate('readiness.refresh')}</Button>}
            {readiness?.loading && readiness.value === undefined && <span role="status">{translate('readiness.loading')}</span>}
            {readiness?.disconnected && <span role="status">{translate('readiness.disconnected')}</span>}
          </div>
          {readiness?.error !== undefined && <p className={css.error} role="alert">{readiness.error}</p>}
          <p className={css.muted}>{translate('readiness.advisory')}</p>

          <ul className={css.list}>
            {participants.map((participant) => {
              const canOpen = openParticipantSession !== undefined && participant.kind !== 'human'
              const participantTasks = tasks.filter(task => task.phase === 'review' ? task.reviewerId === participant.id
                : task.ownerId === participant.id && (task.phase === 'assigned' || task.phase === 'running'))
              const execution = readiness?.value?.items.find(item => item.participantId === participant.id)
              const participation = execution?.participation ?? participant.phase
              const statusLabel = translate(`detail.participant.phase.${participation}`)
              const roleLabel = translate(participantRoleKey[participant.role]
              ?? (isWorkerRole(participant.role) ? 'detail.participant.role.worker' : 'detail.participant.role.other'))
              return (
                <li key={participant.id} className={css.participant}>
                  <div>
                    <strong>{participant.displayName}</strong>
                    <small>{roleLabel} · {translate('readiness.participation')}: {statusLabel}</small>
                    <MemberReadiness value={execution} stale={readinessStale} translate={translate} />
                    {participantTasks.length > 0 && <span className={css.participantTasks}>{participantTasks.map(task => task.subject).join(' · ')}</span>}
                  </div>
                  {canManage && participant.kind !== 'human' && <div className={css.actions}>
                    {(participation === 'invited' || participation === 'provisioning') && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberActivate', participantId: participant.id }) }}>{translate('manage.memberActivate')}</button>}
                    {participation === 'active' && <>
                      {<button type="button" onClick={() => { setManagementTarget({ kind: 'memberInterrupt', participantId: participant.id }) }}>{translate('manage.memberInterrupt')}</button>}
                      {participant.role !== 'coordinator' && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberRemove', participantId: participant.id }) }}>{translate('manage.memberRemove')}</button>}
                    </>}
                  </div>}
                  {readMemberDetail !== undefined && <button type="button" onClick={() => { setMemberDetailId(participant.id) }}>
                    {translate('memberDetail.open')}
                  </button>}
                  {canOpen ? (
                    <button type="button" onClick={() => { void openParticipantSession(participant.id) }}>
                      {translate('detail.openSession')}
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>

      </>}

      {view === 'audit' && metadata !== undefined && (Object.keys(metadata.budgets).length > 0 || metadata.usage !== undefined) && (
        <section className={css.section} aria-label={translate('detail.budget')}>
          <div className={css.sectionHeader}>
            <h2>{translate('detail.budget')}</h2>
            {metadata.usage !== undefined && <small data-team-usage>
              {metadata.usage.inputTokens + metadata.usage.outputTokens} tokens · {metadata.usage.turns} turns · {' '}
              {metadata.usage.costUnits} cost units
            </small>}
          </div>
          {Object.keys(metadata.budgets).length > 0 && (
            <details className={css.details}>
              <summary>{translate('detail.budgetLimits')} <IconChevronDownOutline14 /></summary>
              <pre className={css.json} data-team-budget>{JSON.stringify(metadata.budgets, null, 2)}</pre>
            </details>
          )}
        </section>
      )}

      {view === 'workflows' && <>
        <section className={css.section} aria-label={translate('detail.workflowPlans')}>
          <div className={css.sectionHeader}><h2>{translate('detail.workflowPlans')}</h2>
            {workflowCollection?.startCursor !== undefined && workflowCollection.startCursor >= 0 && readCollections !== undefined && <button type="button"
              disabled={workflowCollection.loading || workflowCollection.loadingMore} onClick={() => { void readCollections('workflowPlans', 'first') }}>
              {translate('detail.firstPage')}
            </button>}
            {workflowCollection?.nextCursor !== undefined && readCollections !== undefined && <button type="button"
              disabled={workflowCollection.loading || workflowCollection.loadingMore} onClick={() => { void readCollections('workflowPlans', 'next') }}>
              {translate('detail.loadWorkflowPlans')}
            </button>}
            {readCollections !== undefined && <button type="button"
              disabled={workflowCollection?.loading || workflowCollection?.loadingMore} onClick={() => { void readCollections('workflowPlans') }}>
              {translate('detail.refreshWorkflowPlans')}
            </button>}
          </div>
          {readCollections !== undefined && <p className={css.muted}>{translate('detail.pageWindow')}</p>}
          {workflowCollection?.loading && <p className={css.muted} role="status">{translate('detail.workflowLoading')}</p>}
          {workflowCollection?.error !== undefined && <p className={css.error} role="alert">{workflowCollection.error}</p>}
          {workflowPlans.length === 0 && !workflowCollection?.loading && workflowCollection?.error === undefined
            && <p className={css.muted} role="status">{translate('detail.workflowsEmpty')}</p>}
          <WorkflowWorkspace plans={workflowPlans} detail={workflowDetail?.teamId === team.id ? workflowDetail : undefined}
            read={readWorkflowDetail === undefined ? undefined : async (id, mode) => {
              updateTaskView({ workflowPlanId: id }); await readWorkflowDetail(id, mode)
            }}
            close={closeWorkflowDetail === undefined ? undefined : () => {
              updateTaskView({ workflowPlanId: undefined }); closeWorkflowDetail()
            }} translate={translate} openTask={focusTask} />
        </section>

      </>}

      {view === 'tasks' && <>
        <section className={css.section} aria-label={translate('detail.tasks')}>
          <div className={css.sectionHeader}><h2>{translate('detail.tasks')}</h2>
            {canManage && <button type="button" onClick={() => { setTaskDialogTarget({ kind: 'taskCreate' }) }}>{translate('taskForm.taskCreate')}</button>}
            {readTaskQuery !== undefined ? <>
              {tableQuery?.startCursor !== undefined && <button type="button" disabled={tableQuery.loading}
                onClick={() => { void readTable('first') }}>{translate('detail.firstPage')}</button>}
              {tableQuery?.page?.nextQueryCursor !== undefined && <button type="button"
                disabled={tableQuery.loading || tableQuery.hasNewer || tableQuery.disconnected || tableQuery.error !== undefined}
                onClick={() => { void readTable('next') }}>{translate('detail.loadTasks')}</button>}
              <button type="button" disabled={tableQuery?.loading} onClick={() => { void readTable('first') }}>{translate('taskView.refreshQuery')}</button>
            </> : <>
              {collections?.tasks.startCursor !== undefined && collections.tasks.startCursor >= 0 && readCollections !== undefined && <button type="button"
                disabled={collections.tasks.loading || collections.tasks.loadingMore} onClick={() => { void readCollections('tasks', 'first') }}>
                {translate('detail.firstPage')}
              </button>}
              {collections?.tasks.nextCursor !== undefined && readCollections !== undefined && <button type="button"
                disabled={collections.tasks.loading || collections.tasks.loadingMore} onClick={() => { void readCollections('tasks', 'next') }}>
                {translate('detail.loadTasks')}
              </button>}
              {readCollections !== undefined && <button type="button"
                disabled={collections?.tasks.loading || collections?.tasks.loadingMore} onClick={() => { void readCollections('tasks') }}>
                {translate('detail.refreshTasks')}
              </button>}
            </>}
          </div>
          {readTaskQuery !== undefined ? <>
            {tableQuery?.loading && <p role="status">{translate('detail.tasksLoading')}</p>}
            {tableQuery?.hasNewer && <p role="status">{translate('taskView.queryChanged')}</p>}
            {tableQuery?.disconnected && <p role="status">{translate('taskView.queryDisconnected')}</p>}
            {tableQuery?.error !== undefined && <p role="alert" className={css.error}>{tableQuery.error}</p>}
          </> : <>
            {readCollections !== undefined && <p className={css.muted}>{translate('detail.pageWindow')}</p>}
            {collections?.tasks.loading && <p role="status">{translate('detail.tasksLoading')}</p>}
            {collections?.tasks.error !== undefined && <p className={css.error} role="alert">{collections.tasks.error}</p>}
          </>}
          <TaskWorkspace inspectMember={readMemberDetail === undefined ? undefined : setMemberDetailId}
            searchScope={readTaskQuery === undefined ? 'loaded' : 'team'} queryState={tableQuery}
            refreshSearch={readTaskQuery === undefined ? undefined : () => { void readTable('first') }}
            identities={identityState} state={loadedContext} tasks={visibleTasks}
            detail={taskDetail} readDetail={readTaskDetail} closeDetail={closeTaskDetail}
            viewState={taskPreferences} updateView={updateTaskView}
            translate={translate} canManage={canManage} busy={deletingTaskId !== undefined || cancellingTaskId !== undefined}
            onForm={setTaskDialogTarget}
            {...readArtifact === undefined ? {} : { openArtifact: (reference: TeamArtifactReference) => { updateTaskView({ view: 'artifacts' }); onViewChange?.('artifacts'); void loadArtifact(reference) } }}

            {...deleteTask === undefined ? {} : { onDelete: (task: TeamTaskRecord) => {
              setDeleteTarget(task)
              setDeleteTaskError(undefined)
            } }}

            {...cancelTask === undefined ? {} : { onStop: (task: TeamTaskRecord) => {
              setCancelTarget(task)
              setCancelTaskError(undefined)
            } }}
            {...openParticipantSession === undefined ? {} : { openParticipantSession }}
            {...openTeam === undefined ? {} : { openTeam }} />
        </section>

      </>}

      {view === 'channels' && <ChannelHub openMember={readMemberDetail === undefined ? undefined : setMemberDetailId} identities={identityState} maxDraftBytes={maxDraftBytes} state={loadedContext} translate={translate}
        viewState={taskPreferences}
        updateView={updateTaskView}
        {...onChannelDraftChange === undefined ? {} : { onDraftChange: onChannelDraftChange }}
        {...onChannelDraftDiscard === undefined ? {} : { onDraftDiscard: onChannelDraftDiscard }}
        {...channelState === undefined ? {} : { channelState }}
        {...channelListState === undefined ? {} : { channelListState }}
        {...readChannels === undefined ? {} : { readChannels }}
        {...readChannel === undefined ? {} : { readChannel }}
        {...manage === undefined ? {} : { manage }}
        {...readChannelAttachment === undefined ? {} : { readChannelAttachment }}
        {...renderSlot === undefined ? {} : { renderSlot }}
        {...channelCatalog === undefined ? {} : { channelCatalog }}
        {...readChannelCatalog === undefined ? {} : { readChannelCatalog }}
        {...acknowledgeChannel === undefined ? {} : { acknowledgeChannel }}
        {...closeChannelView === undefined ? {} : { closeChannelView }} />}

      {view === 'artifacts' && <ArtifactsWorkspace artifacts={artifacts} collections={collections}
        detail={artifactDetail?.teamId === team.id ? artifactDetail : undefined}
        read={readArtifact} readCollections={readCollections} t={translate} />}

      {view === 'audit' && hasAuditSection && (
        <section className={css.section} aria-label={translate('detail.audit')}>
          <div className={css.sectionHeader}>
            <h2>{translate('detail.audit')}</h2>
            {readAudit !== undefined && <button type="button" disabled={auditLoading} onClick={() => { void loadAudit() }}>{translate('detail.audit')}</button>}
          </div>
          {auditLoading && <p className={css.muted} role="status">{translate('detail.auditLoading')}</p>}
          {auditError !== undefined && <p className={css.error} role="alert">{auditError}</p>}
          {readAudit !== undefined && <div className={css.actions}>
            {audit?.nextCursor !== undefined && <button type="button" disabled={auditLoading} onClick={() => { void loadAudit(audit.nextCursor) }}>{translate('detail.loadMore')}</button>}
            {auditLoading && <button type="button" onClick={() => { auditRequest.current?.abort(); setAuditLoading(false) }}>{translate('detail.cancelRead')}</button>}
          </div>}
          {audit !== undefined && (audit.items.length === 0 ? <p className={css.muted}>{translate('detail.auditEmpty')}</p> : (
            <div className={css.audit}>
              <p className={css.muted}>{audit.items.length} {translate('detail.auditRecords')}</p>
              {audit.items.map(entry => <details key={`${entry.stream}:${entry.channelId ?? ''}:${entry.cursor}`} className={css.record}>
                <summary><strong>{entry.type}</strong> <IconChevronDownOutline14 /></summary>
                <small>{entry.stream} · {translate('detail.cursor')} {entry.cursor}</small>
                <pre className={css.json}>{JSON.stringify(entry.facts, null, 2)}</pre>
              </details>)}
            </div>
          ))}
        </section>
      )}
      {taskDialogTarget !== undefined && (manage !== undefined
        || hasTaskDraftInput(taskPreferences.taskDrafts[taskDraftKey(taskDialogTarget)])) && <TeamTaskDialog
        key={`${team.id}:${taskDialogTarget.kind}:${'taskId' in taskDialogTarget ? taskDialogTarget.taskId : ''}`}
        draft={taskPreferences.taskDrafts[taskDraftKey(taskDialogTarget)]}
        {...onTaskDraftChange === undefined ? {} : { onDraftChange: (draft) => { onTaskDraftChange(taskDialogTarget, draft) } }}
        {...onTaskDraftDiscard === undefined ? {} : { onDraftDiscard: () => { onTaskDraftDiscard(taskDialogTarget) } }}
        target={taskDialogTarget} state={loadedContext} translate={translate} manage={manage} canSubmit={canManage}
        inspection={taskDetail} readTaskDetail={readTaskDetail}
        taskCapabilities={taskCapabilities} watchTaskCapabilities={watchTaskCapabilities} refreshTaskCapabilities={refreshTaskCapabilities}
        taskReferences={taskReferences} watchTaskReferences={watchTaskReferences}
        refreshTaskReferences={refreshTaskReferences} lookupTaskUpdate={lookupTaskUpdate}
        dependencyQuery={dependencyQuery} readDependencies={readDependencies} closeDependencies={closeDependencies}
        onClose={() => { setTaskDialogTarget(undefined) }}
      />}
      {managementTarget !== undefined && manage !== undefined && <TeamManagementDialog
        key={`${team.id}:${managementTarget.kind}:${'participantId' in managementTarget ? managementTarget.participantId : 'channelId' in managementTarget ? managementTarget.channelId : ''}`}
        executionProfiles={executionProfiles}
        watchExecutionProfiles={watchExecutionProfiles} refreshExecutionProfiles={refreshExecutionProfiles}
        target={managementTarget}
        maxDraftBytes={maxDraftBytes}
        state={loadedContext}
        translate={translate}
        channel={undefined}
        manage={manage}
        onClose={() => { setManagementTarget(undefined) }}
      />}
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDeleteTask}
        closeLabel={translate('detail.task.deleteCancel')}
        title={translate('detail.task.delete')}
        {...deleteTarget === undefined ? {} : { description: translate('detail.task.deleteDescription', { subject: deleteTarget.subject }) }}
        footer={(
          <>
            <Button variant="outline" disabled={deletingTaskId !== undefined} onClick={closeDeleteTask}>
              {translate('detail.task.deleteCancel')}
            </Button>
            <Button
              variant="outline"
              className={css.taskDeleteConfirm}
              disabled={deletingTaskId !== undefined}
              onClick={confirmDeleteTask}
            >
              {translate('detail.task.delete')}
            </Button>
          </>
        )}
      >
        {deletingTaskId !== undefined && <p className={css.muted} role="status">{translate('detail.task.deleteLoading')}</p>}
        {deleteTaskError !== undefined && <p className={css.error} role="alert">{deleteTaskError}</p>}
      </Modal>
      <Modal
        open={cancelTarget !== undefined}
        onClose={closeCancelTask}
        closeLabel={translate('detail.task.stopCancel')}
        title={translate('detail.task.stop')}
        {...cancelTarget === undefined ? {} : { description: translate('detail.task.stopDescription', { subject: cancelTarget.subject }) }}
        footer={(
          <>
            <Button variant="outline" disabled={cancellingTaskId !== undefined} onClick={closeCancelTask}>
              {translate('detail.task.stopCancel')}
            </Button>
            <Button
              variant="outline"
              className={css.taskStopConfirm}
              disabled={cancellingTaskId !== undefined}
              onClick={confirmCancelTask}
            >
              {translate('detail.task.stop')}
            </Button>
          </>
        )}
      >
        {cancellingTaskId !== undefined && <p className={css.muted} role="status">{translate('detail.task.stopLoading')}</p>}
        {cancelTaskError !== undefined && <p className={css.error} role="alert">{cancelTaskError}</p>}
      </Modal>
    </main>
  )
}
