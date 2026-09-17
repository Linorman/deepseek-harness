import { MemberDetail } from './MemberDetail.tsx'
import { WorkflowWorkspace, type WorkflowWorkspaceProps } from './WorkflowWorkspace.tsx'
import { memberLabels, memberPageLabels, type MemberLabel } from './member-labels.ts'
/** Durable Team detail surface for the browser product shell. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsRenderSlots } from '@clocky/clocky-client-ui-slots'
import { Button, IconChevronDownOutline14, Modal } from '@clocky/clocky-client-ui-primitives'
import type {
  ChannelId,
  ChannelReadPageResult,
  ParticipantId,
  TeamArtifactReadResult,
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
import { TeamHeader } from './TeamHeader.tsx'
import { TaskWorkspace } from './TaskWorkspace.tsx'
import type { ChannelComposerDraft } from './channel-draft.ts'
import { DEFAULT_TEAM_VIEW, type TeamViewState } from './workspace-store.ts'
import { ChannelHub } from './ChannelHub.tsx'

/** Compact localized labels for participant and activation status. */
const participantStatusKey: Record<string, TeamKey> = {
  invited: 'detail.participant.phase.invited',
  provisioning: 'detail.participant.phase.provisioning',
  active: 'detail.participant.phase.active',
  left: 'detail.participant.phase.left',
  failed: 'detail.participant.phase.failed',
  starting: 'detail.activation.starting',
  running: 'detail.activation.running',
  idle: 'detail.activation.idle',
  offline: 'detail.activation.offline',
  stopping: 'detail.activation.stopping',
  ready: 'detail.participant.status.ready',
  assigned: 'detail.participant.status.assigned',
  working: 'detail.participant.status.working',
  reviewing: 'detail.participant.status.reviewing',
  unknown: 'detail.participant.status.unknown',
}

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
  readonly inspectMember?: import('@clocky/clocky-client-runtime/client').ITeamTasks['inspectMember']
  readonly maxDraftBytes?: number | undefined
  readonly workflowDetail?: WorkflowWorkspaceProps['detail']
  readonly readWorkflowDetail?: WorkflowWorkspaceProps['read']
  readonly closeWorkflowDetail?: WorkflowWorkspaceProps['close']
  readonly humanActions?: readonly import('@clocky/clocky-client-connection/client').TeamHumanActionSnapshot[] | undefined
  readonly taskDetail?: TeamTaskDetailState | undefined
  readonly readTaskDetail?: ITeamTasks['readTaskDetail']
  readonly closeTaskDetail?: (() => void) | undefined
  /** Active Team workspace module. */
  readonly view?: TeamWorkspaceView
  /** Select another module while preserving this Team's browsing state. */
  readonly onViewChange?: (view: TeamWorkspaceView) => void
  /** Open the current coordinator Session on explicit request. */
  readonly openCoordinator?: () => Promise<void>
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
  readonly readArtifact?: (artifactId: string, signal?: AbortSignal) => Promise<TeamArtifactReadResult>
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
export function TeamPage({ maxDraftBytes, inspectMember, workflowDetail, readWorkflowDetail, closeWorkflowDetail, humanActions,
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
  readCollections,
  pendingActions = [],
  respondAction,
  openActionContext,
  deleteTask,
  cancelTask,
}: TeamPageProps) {
  const { team } = state
  const [localTaskView, setLocalTaskView] = useState(DEFAULT_TEAM_VIEW)
  const taskPreferences = taskView ?? localTaskView
  const taskPreferencesRef = useRef(taskPreferences)
  taskPreferencesRef.current = taskPreferences
  const view = controlledView ?? taskPreferences.view
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
  const tasks = (collections?.tasks.items ?? []).map(task => ({ ...task, subject: task.subject.text }))
  const loadedContext: TeamLoadedContext = { team, participants: memberLabels(state, participants), tasks }
  const workflowCollection = collections?.workflowPlans
  const workflowPlans = workflowCollection?.items ?? []
  const metadata = state.metadata?.kind === 'available' ? state.metadata : undefined
  const [taskDialogTarget, setTaskDialogTarget] = useState<TeamTaskDialogTarget | undefined>()
  const [memberDetailId, setMemberDetailId] = useState<ParticipantId>()
  const [managementTarget, setManagementTarget] = useState<TeamManagementTarget | undefined>()
  const canManage = manage !== undefined && !['completed', 'failed', 'cancelled'].includes(team.phase)
  const [deletedTaskId, setDeletedTaskId] = useState<TeamTaskId | undefined>()
  const visibleTasks = (collections?.tasks.items ?? []).filter(task => task.phase !== 'deleted' && task.id !== deletedTaskId)
  const workers = participants.filter(participant => isWorkerRole(participant.role))
  const activeWorkers = workers.filter(participant => participant.phase === 'active').length
  const workingTasks = state.counts.tasks.assigned + state.counts.tasks.running
  const artifacts = (collections?.artifacts.items ?? []).filter(artifact => artifact.visibility !== 'private')
  const [audit, setAudit] = useState<TeamAuditList | undefined>()
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | undefined>()
  const auditRequest = useRef<AbortController | undefined>()
  const artifactRequest = useRef<AbortController | undefined>()
  const deleteTaskRequest = useRef<AbortController | undefined>()
  const cancelTaskRequest = useRef<AbortController | undefined>()
  const [artifactLoadingId, setArtifactLoadingId] = useState<string | undefined>()
  const [artifact, setArtifact] = useState<TeamArtifactReadResult | undefined>()
  const [artifactError, setArtifactError] = useState<string | undefined>()
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
    setTaskDialogTarget(undefined)
    setFocusedTaskId(undefined)
    setManagementTarget(undefined)
    setMemberDetailId(undefined)
    setAudit(undefined)
    setAuditLoading(false)
    setAuditError(undefined)
    artifactRequest.current?.abort()
    deleteTaskRequest.current?.abort()
    cancelTaskRequest.current?.abort()
    setArtifact(undefined)
    setArtifactError(undefined)
    setArtifactLoadingId(undefined)
    setDeleteTarget(undefined)
    setDeletingTaskId(undefined)
    setDeleteTaskError(undefined)
    setCancelTarget(undefined)
    setCancellingTaskId(undefined)
    setCancelTaskError(undefined)
    setDeletedTaskId(undefined)
    return () => {
      auditRequest.current?.abort()
      artifactRequest.current?.abort()
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
    if (readArtifact === undefined || reference.provider === undefined) return
    artifactRequest.current?.abort()
    const controller = new AbortController()
    artifactRequest.current = controller
    setArtifactLoadingId(reference.id)
    setArtifact(undefined)
    setArtifactError(undefined)
    try {
      const next = await readArtifact(reference.id, controller.signal)
      if (!controller.signal.aborted) setArtifact(next)
    } catch (error: unknown) {
      if (!controller.signal.aborted) setArtifactError(error instanceof Error ? error.message : String(error))
    } finally {
      if (artifactRequest.current === controller) {
        artifactRequest.current = undefined
        setArtifactLoadingId(undefined)
      }
    }
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

      {view === 'overview' && <TeamOverview state={state} collections={collections} humanActions={humanActions} translate={translate} artifacts={artifacts} pendingActions={pendingActions}
        navigate={(next) => { updateTaskView({ view: next }); onViewChange?.(next) }}
        openTask={(taskId) => { updateTaskView({ taskId, view: 'tasks', taskSearch: '', taskPhase: 'all' }); onViewChange?.('tasks') }}
        inspectActivity={(cursor) => { updateTaskView({ view: 'audit' }); onViewChange?.('audit'); setAudit(undefined); void loadAudit(Math.max(-1, cursor - 1)) }}
        {...readArtifact === undefined ? {} : { openArtifact: (reference: TeamArtifactReference) => { updateTaskView({ view: 'artifacts' }); onViewChange?.('artifacts'); void loadArtifact(reference) } }}
        {...respondAction === undefined ? {} : { respondAction }}
        {...openActionContext === undefined ? {} : { openActionContext }}
        {...openParticipantSession === undefined ? {} : { openParticipantSession }}
        {...readAudit === undefined ? {} : { readAudit }} /> }
      {memberDetailId !== undefined && inspectMember !== undefined && <MemberDetail key={`${team.id}:${memberDetailId}`}
        teamId={team.id} participantId={memberDetailId} inspect={inspectMember} translate={translate}
        onClose={() => { setMemberDetailId(undefined) }} />}
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
          <ul className={css.list}>
            {participants.map((participant) => {
              const canOpen = openParticipantSession !== undefined && participant.kind !== 'human'
              const participantTasks = tasks.filter(task => task.phase === 'review' ? task.reviewerId === participant.id
                : task.ownerId === participant.id && (task.phase === 'assigned' || task.phase === 'running'))
              const status = participant.phase !== 'active' ? participant.phase
                : participantTasks.some(task => task.cancellationRequested) ? 'stopping'
                  : participantTasks.some(task => task.phase === 'review') ? 'reviewing'
                    : participantTasks.some(task => task.phase === 'running') ? 'working'
                      : participantTasks.some(task => task.phase === 'assigned') ? 'assigned' : participant.phase
              const statusLabel = translate(participantStatusKey[status] ?? 'detail.participant.status.unknown')
              const roleLabel = translate(participantRoleKey[participant.role]
              ?? (isWorkerRole(participant.role) ? 'detail.participant.role.worker' : 'detail.participant.role.other'))
              return (
                <li key={participant.id} className={css.participant}>
                  <span>
                    <strong>{participant.displayName}</strong>
                    <small>{roleLabel} · {statusLabel}</small>
                    {participantTasks.length > 0 && <span className={css.participantTasks}>{participantTasks.map(task => task.subject).join(' · ')}</span>}
                  </span>
                  {canManage && participant.kind !== 'human' && <div className={css.actions}>
                    {(participant.phase === 'invited' || participant.phase === 'provisioning') && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberActivate', participantId: participant.id }) }}>{translate('manage.memberActivate')}</button>}
                    {participant.phase === 'active' && <>
                      {<button type="button" onClick={() => { setManagementTarget({ kind: 'memberInterrupt', participantId: participant.id }) }}>{translate('manage.memberInterrupt')}</button>}
                      {participant.role !== 'coordinator' && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberRemove', participantId: participant.id }) }}>{translate('manage.memberRemove')}</button>}
                    </>}
                  </div>}
                  {inspectMember !== undefined && <button type="button" onClick={() => { setMemberDetailId(participant.id) }}>
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
        {(workflowPlans.length > 0 || workflowCollection?.loading || workflowCollection?.error !== undefined
        || workflowCollection?.hasNewer || (workflowCollection?.startCursor ?? -1) >= 0) && <section className={css.section} aria-label={translate('detail.workflowPlans')}>
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
          <WorkflowWorkspace plans={workflowPlans} detail={workflowDetail?.teamId === team.id ? workflowDetail : undefined}
            read={readWorkflowDetail === undefined ? undefined : async (id, mode) => {
              updateTaskView({ workflowPlanId: id }); await readWorkflowDetail(id, mode)
            }}
            close={closeWorkflowDetail === undefined ? undefined : () => {
              updateTaskView({ workflowPlanId: undefined }); closeWorkflowDetail()
            }} translate={translate} openTask={focusTask} />
        </section>}

      </>}

      {view === 'tasks' && <>
        <section className={css.section} aria-label={translate('detail.tasks')}>
          <div className={css.sectionHeader}><h2>{translate('detail.tasks')}</h2>
            {canManage && <button type="button" onClick={() => { setTaskDialogTarget({ kind: 'taskCreate' }) }}>{translate('taskForm.taskCreate')}</button>}
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
          </div>
          {readCollections !== undefined && <p className={css.muted}>{translate('detail.pageWindow')}</p>}
          {collections?.tasks.loading && <p className={css.muted} role="status">{translate('detail.tasksLoading')}</p>}
          {collections?.tasks.error !== undefined && <p className={css.error} role="alert">{collections.tasks.error}</p>}
          <TaskWorkspace state={loadedContext} tasks={visibleTasks}
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

      {view === 'channels' && <ChannelHub maxDraftBytes={maxDraftBytes} state={loadedContext} translate={translate}
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

      {view === 'artifacts' && <>
        {(artifacts.length > 0 || artifact !== undefined || artifactLoadingId !== undefined || artifactError !== undefined
        || collections?.artifacts.loading || collections?.artifacts.error !== undefined || collections?.artifacts.nextCursor !== undefined
        || collections?.artifacts.hasNewer || (collections?.artifacts.startCursor ?? -1) >= 0) && (
          <section className={css.section} aria-label={translate('detail.artifacts')}>
            <div className={css.sectionHeader}><h2>{translate('detail.artifacts')}</h2>
              {collections?.artifacts.startCursor !== undefined && collections.artifacts.startCursor >= 0 && readCollections !== undefined && <button type="button"
                disabled={collections.artifacts.loading || collections.artifacts.loadingMore} onClick={() => { void readCollections('artifacts', 'first') }}>
                {translate('detail.firstPage')}
              </button>}
              {collections?.artifacts.nextCursor !== undefined && readCollections !== undefined && <button type="button"
                disabled={collections.artifacts.loading || collections.artifacts.loadingMore} onClick={() => { void readCollections('artifacts', 'next') }}>
                {translate('detail.loadArtifacts')}
              </button>}
              {readCollections !== undefined && <button type="button"
                disabled={collections?.artifacts.loading || collections?.artifacts.loadingMore} onClick={() => { void readCollections('artifacts') }}>
                {translate('detail.refreshArtifacts')}
              </button>}
            </div>
            {artifacts.length > 0 && (
              <ul className={css.list}>{artifacts.map(artifact => (
                <li key={artifact.id} className={css.record}>
                  <strong>{artifact.id}</strong>
                  <small>{artifact.kind}</small>
                  {readArtifact !== undefined && artifact.provider !== undefined && (
                    <button
                      type="button"
                      disabled={artifactLoadingId !== undefined}
                      onClick={() => { void loadArtifact(artifact) }}
                    >
                      {artifactLoadingId === artifact.id ? translate('detail.artifactLoading') : translate('detail.artifactRead')}
                    </button>
                  )}
                  {readArtifact !== undefined && artifact.provider === undefined && (
                    <span className={css.muted}>{translate('detail.artifactUnavailable')}</span>
                  )}
                </li>
              ))}</ul>
            )}
            {artifactLoadingId !== undefined && <p className={css.muted} role="status">{translate('detail.artifactLoading')}</p>}
            {artifactError !== undefined && <p className={css.error} role="alert">{artifactError}</p>}
            {readCollections !== undefined && <p className={css.muted}>{translate('detail.pageWindow')}</p>}
            {collections?.artifacts.loading && <p className={css.muted} role="status">{translate('detail.artifactsLoading')}</p>}
            {collections?.artifacts.error !== undefined && <p className={css.error} role="alert">{collections.artifacts.error}</p>}
            {artifact !== undefined && <div className={css.result} aria-label={translate('detail.artifactRead')}>
              <strong>{artifact.artifact.id}</strong>
              <p className={css.muted} role="status">{artifact.bytes} {translate('detail.artifactBytes')}</p>
              {artifact.artifact.kind === 'screenshot' || artifact.artifact.kind === 'file'
                ? <p className={css.muted}>{translate('detail.artifactBinary')}</p>
                : <pre className={css.json}>{previewArtifactText(artifact.data)}</pre>}
              <button type="button" onClick={() => { downloadArtifact(artifact) }}>{translate('detail.artifactDownload')}</button>
            </div>}
          </section>
        )}

      </>}

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
      {taskDialogTarget !== undefined && manage !== undefined && <TeamTaskDialog
        key={`${team.id}:${taskDialogTarget.kind}:${'taskId' in taskDialogTarget ? taskDialogTarget.taskId : ''}`}
        target={taskDialogTarget} state={loadedContext} translate={translate} manage={manage}
        inspection={taskDetail} readTaskDetail={readTaskDetail}
        onClose={() => { setTaskDialogTarget(undefined) }}
      />}
      {managementTarget !== undefined && manage !== undefined && <TeamManagementDialog
        key={`${team.id}:${managementTarget.kind}:${'participantId' in managementTarget ? managementTarget.participantId : 'channelId' in managementTarget ? managementTarget.channelId : ''}`}
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

/** Cap text rendering while retaining the complete provider bytes for download. */
const MAX_ARTIFACT_PREVIEW_BYTES = 128 * 1024

function previewArtifactText(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const preview = new TextDecoder().decode(bytes.subarray(0, MAX_ARTIFACT_PREVIEW_BYTES))
  return bytes.length > MAX_ARTIFACT_PREVIEW_BYTES ? `${preview}\n…` : preview
}

function downloadArtifact(result: TeamArtifactReadResult): void {
  const binary = atob(result.data)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `artifact-${result.artifact.id.replace(/[^A-Za-z0-9._-]+/g, '-') || 'download'}`
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 0)
}
