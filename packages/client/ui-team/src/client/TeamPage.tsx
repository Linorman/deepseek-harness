/** Durable Team detail surface for the browser product shell. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsRenderSlots } from '@clocky/clocky-client-ui-slots'
import { Button, IconChevronDownOutline14, IconStopFill16, IconTrashOutline16, Modal } from '@clocky/clocky-client-ui-primitives'
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
  TeamTaskSnapshot,
  TeamTaskSelection,
  TeamChannelState,
  TeamChannelListState,
  TeamId,
  TeamChannelAttachmentInput, TeamChannelAttachmentResult,
  TeamChannelCatalogState,
  TeamCollectionKind, TeamCollectionsState,
} from '@clocky/clocky-client-runtime/client'
import type { TeamKey } from './locales.ts'
import { teamPhaseKey } from './locales.ts'
import css from './TeamBrowser.module.css'
import { TeamManagementDialog, type TeamManagementTarget } from './TeamManagementDialog.tsx'
import { TeamTaskDialog, type TeamTaskDialogTarget } from './TeamTaskDialog.tsx'
import { HumanActionCard } from './HumanActionCard.tsx'
import { ChannelEnvelope } from './ChannelEnvelope.tsx'
import { ChannelSummaryDialog } from './ChannelSummaryDialog.tsx'

/** Compact localized labels for durable task phases in the detail list. */
const taskPhaseKey: Record<TeamTaskSnapshot['phase'], TeamKey> = {
  pending: 'detail.task.phase.pending',
  assigned: 'detail.task.phase.assigned',
  running: 'detail.task.phase.running',
  review: 'detail.task.phase.review',
  completed: 'detail.task.phase.completed',
  failed: 'detail.task.phase.failed',
  cancelled: 'detail.task.phase.cancelled',
  deleted: 'detail.task.phase.deleted',
}

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

/** Return a participant-review route while tolerating an older partial UI snapshot. */
function taskReviewerId(task: TeamTaskSnapshot): ParticipantId | undefined {
  const reviewPolicy = (task as unknown as { readonly reviewPolicy?: TeamTaskSnapshot['reviewPolicy'] }).reviewPolicy
  return reviewPolicy?.kind === 'participant' ? reviewPolicy.reviewerId : undefined
}

/** Read the execution discriminator while keeping older partial UI snapshots renderable. */
function taskExecution(task: TeamTaskSnapshot): TeamTaskSnapshot['execution'] | undefined {
  const partial = task as Omit<TeamTaskSnapshot, 'execution'> & { readonly execution?: TeamTaskSnapshot['execution'] }
  return partial.execution
}

/** Overlay newer selected-Team revisions without widening a loaded collection. */
function currentRevisionRows<T extends { readonly id: string; readonly revision: number }>(
  page: readonly T[],
  selected: readonly T[],
): readonly T[] {
  const latest = new Map(selected.map(task => [task.id, task]))
  return page.map((task) => {
    const current = latest.get(task.id)
    return current !== undefined && current.revision >= task.revision ? current : task
  })
}

/** Derive truthful activity for a participant from its assigned task leases. */
function participantActivity(
  participant: TeamTaskSelection['state']['participants'][number],
  activationStatus: string | undefined,
  tasks: readonly TeamTaskSnapshot[],
): string {
  if (participant.phase !== 'active') return participant.phase
  if (tasks.some(task => task.cancellation !== undefined && (task.phase === 'assigned' || task.phase === 'running'))) return 'stopping'
  if (tasks.some(task => task.phase === 'review')) return 'reviewing'
  if (tasks.some(task => task.phase === 'running')) return 'working'
  if (tasks.some(task => task.phase === 'assigned')) return 'assigned'
  if (activationStatus === 'offline') return 'offline'
  if (isWorkerRole(participant.role)) return 'ready'
  return activationStatus ?? 'active'
}

/** Controls and projection supplied by the host-facing Team page owner. */
export interface TeamPageProps {
  /** Complete durable Team projection selected by the caller. */
  readonly state: TeamTaskSelection['state']
  /** Independently paged member/task/artifact projections, when the runtime provides them. */
  readonly collections?: TeamCollectionsState
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
  readonly readChannels?: (teamId: TeamId, more?: boolean) => Promise<void>
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
  readonly readCollections?: (collection: TeamCollectionKind, more?: boolean) => Promise<void>
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
export function TeamPage({
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
  const { team, goal, activations } = state
  const pageRoot = useRef<HTMLElement | null>(null)
  const [focusedTaskId, setFocusedTaskId] = useState<TeamTaskId | undefined>()
  const focusTask = (event: MouseEvent<HTMLAnchorElement>, taskId: TeamTaskId): void => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setFocusedTaskId(taskId)
  }
  const participants = collections?.members.items ?? state.participants
  const loadedTasks = collections !== undefined
    ? currentRevisionRows(collections.tasks.items, state.tasks) : state.tasks
  const tasksById = new Map(state.tasks.map(task => [task.id, task]))
  const focusedTask = focusedTaskId === undefined ? undefined : tasksById.get(focusedTaskId)
  const tasks = focusedTask !== undefined && focusedTask.phase !== 'deleted' && !loadedTasks.some(task => task.id === focusedTask.id)
    ? [...loadedTasks, focusedTask] : loadedTasks
  for (const task of tasks) tasksById.set(task.id, task)
  const workflowCollection = collections?.workflowPlans
  const workflowPlans = workflowCollection === undefined ? state.workflowPlans ?? []
    : currentRevisionRows(workflowCollection.items, state.workflowPlans ?? [])
  const channelList = channelListState?.teamId === team.id ? channelListState : undefined
  const visibleChannels = channelList?.items ?? []
  const [actionFeedback, setActionFeedback] = useState<TeamActionResponseResult['kind'] | undefined>()
  const [taskDialogTarget, setTaskDialogTarget] = useState<TeamTaskDialogTarget | undefined>()
  const [managementTarget, setManagementTarget] = useState<TeamManagementTarget | undefined>()
  const [summaryOpen, setSummaryOpen] = useState(false)
  const canManage = manage !== undefined && !['completed', 'failed', 'cancelled'].includes(team.phase)
  const [deletedTaskId, setDeletedTaskId] = useState<TeamTaskId | undefined>()
  const visibleTasks = tasks.filter(task => task.phase !== 'deleted' && task.id !== deletedTaskId)
  const workers = participants.filter(participant => isWorkerRole(participant.role))
  const activeWorkers = workers.filter(participant => participant.phase === 'active').length
  const workingTasks = tasks.filter(task => task.phase === 'assigned' || task.phase === 'running').length
  const pendingReviews = tasks.filter(task => task.phase === 'review')
  const durablePendingActions = state.humanActions?.filter(action => action.phase === 'pending') ?? []
  const durableSources = new Set<string>(state.humanActions?.map(action => action.sourceId) ?? [])
  const legacyPendingActions = pendingActions.filter(action => !durableSources.has(action.kind === 'approval' ? action.approvalId : action.questionRpcId))
  const taskArtifacts = [
    ...tasks.flatMap(task => task.attemptHistory.flatMap((attempt) => {
      if (attempt.outcome.kind !== 'completed') return []
      const result = attempt.outcome.result
      return [
        ...(result.artifacts ?? []),
        ...(result.integration?.proposalArtifact === undefined ? [] : [result.integration.proposalArtifact]),
        ...(result.integration?.artifacts ?? []),
      ]
    })),
    ...tasks.flatMap(task => task.delegation?.result?.artifacts ?? []),
  ]
  const artifacts = [...new Map((collections?.artifacts.items ?? [
    ...taskArtifacts,
    ...state.workspaceAllocations.flatMap(allocation => allocation.loss?.artifacts ?? []),
  ]).filter(artifact => artifact.visibility !== 'private').map(artifact => [artifact.id, artifact])).values()]
  const selectedChannelId = channelState?.channelId
  const channel = channelState?.page
  const channelLoading = channelState?.loading ?? false
  const channelError = channelState?.error
  const summaries = [...new Map([
    ...(channel?.records.flatMap(record => record.type === 'channel/summary' ? [record] : []) ?? []),
    ...channelState?.lastSummary === undefined ? [] : [channelState.lastSummary],
  ].map(summary => [summary.sequence, summary])).values()]
  const expectedNext = channelState?.admission?.expectedNext
  const protocolStatus = channelState?.admission?.protocolStatus
  const canSpeak = expectedNext?.kind !== 'participant' || expectedNext.participantId === channelState?.invitation?.invitation.participantId
  const basicProtocol = channel?.channel.manifest.adapter.version === 1
    && (channel.channel.manifest.adapter.type === 'consult' || channel.channel.manifest.adapter.type === 'discussion')
  const channelAuthorityPending = channelLoading || channelState?.disconnected === true || channelState?.error !== undefined
    || channelState?.invitationError !== undefined
  const summaryInfo = channelCatalog?.value?.summary
  const selectedPolicy = channel?.channel.manifest.viewPolicy
  const summaryCapabilities = summaryInfo !== undefined && selectedPolicy !== undefined
    && !channelCatalog?.loading && !channelCatalog?.disconnected && channelCatalog?.error === undefined
    && summaryInfo.allowedPolicies.includes(selectedPolicy.type) ? summaryInfo : undefined
  const [audit, setAudit] = useState<TeamAuditList | undefined>()
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | undefined>()
  const channelRequest = useRef<AbortController | undefined>()
  const auditRequest = useRef<AbortController | undefined>()
  const artifactRequest = useRef<AbortController | undefined>()
  const deleteTaskRequest = useRef<AbortController | undefined>()
  const cancelTaskRequest = useRef<AbortController | undefined>()
  const [artifactLoadingId, setArtifactLoadingId] = useState<string | undefined>()
  const [artifact, setArtifact] = useState<TeamArtifactReadResult | undefined>()
  const [artifactError, setArtifactError] = useState<string | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<TeamTaskSnapshot | undefined>()
  const [deletingTaskId, setDeletingTaskId] = useState<TeamTaskId | undefined>()
  const [deleteTaskError, setDeleteTaskError] = useState<string | undefined>()
  const [cancelTarget, setCancelTarget] = useState<TeamTaskSnapshot | undefined>()
  const [cancellingTaskId, setCancellingTaskId] = useState<TeamTaskId | undefined>()
  const [cancelTaskError, setCancelTaskError] = useState<string | undefined>()
  const hasChannelSection = canManage || readChannels !== undefined || visibleChannels.length > 0
    || selectedChannelId !== undefined || channel !== undefined || channelLoading || channelError !== undefined
  const hasAuditSection = readAudit !== undefined || audit !== undefined || auditLoading || auditError !== undefined

  useLayoutEffect(() => {
    const root = pageRoot.current
    if (focusedTaskId === undefined || root === null) return
    const row = root.ownerDocument.getElementById(`team-task-${focusedTaskId}`)
    if (row !== null && root.contains(row)) row.focus()
  }, [focusedTaskId])

  useEffect(() => {
    channelRequest.current?.abort()
    auditRequest.current?.abort()
    setActionFeedback(undefined)
    setTaskDialogTarget(undefined)
    setFocusedTaskId(undefined)
    setManagementTarget(undefined)
    setSummaryOpen(false)
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
      channelRequest.current?.abort()
      auditRequest.current?.abort()
      artifactRequest.current?.abort()
      deleteTaskRequest.current?.abort()
      cancelTaskRequest.current?.abort()
    }
  }, [team.id])
  useEffect(() => () => { closeChannelView?.() }, [team.id, closeChannelView])
  useEffect(() => { if (readChannels !== undefined) void readChannels(team.id) }, [team.id, readChannels])

  const loadChannel = async (channelId: ChannelId, afterCursor = -1): Promise<void> => {
    if (readChannel === undefined) return
    channelRequest.current?.abort()
    const controller = new AbortController()
    channelRequest.current = controller
    try {
      await readChannel(channelId, afterCursor, controller.signal)
    } catch {
      // The runtime publishes read failures; cancellation intentionally has no error message.
    }
  }

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
      setAudit(previous => afterCursor === -1 || previous === undefined ? page : {
        ...page,
        items: [...new Map([...previous.items, ...page.items].map(entry => [
          `${entry.stream}:${entry.channelId ?? ''}:${entry.cursor}`, entry,
        ])).values()],
      })
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
      <header className={css.pageHeader}>
        <div>
          <h1>{goal.objective}</h1>
          <span className={css.phase} data-team-phase>{translate(teamPhaseKey[team.phase])}</span>
        </div>
        <div className={css.actions}>
          {onResume !== undefined && team.phase === 'stalled' && (
            <button type="button" onClick={() => { void onResume() }}>{translate('resume')}</button>
          )}
          {onCancel !== undefined && (team.phase === 'active' || team.phase === 'quiescing' || team.phase === 'stalled') && (
            <button type="button" onClick={() => { void onCancel() }}>{translate('cancel')}</button>
          )}
        </div>
        {team.stallReason !== undefined && <p className={css.error} role="alert">{team.stallReason.message}</p>}
        {team.cancellation !== undefined && <p className={css.notice} role="status">{team.cancellation.reason.message}</p>}
      </header>

      <section className={css.section} aria-label={translate('detail.participants')}>
        <div className={css.sectionHeader}>
          <h2>{translate('detail.participants')}</h2>
          {canManage && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberInvite' }) }}>{translate('manage.memberInvite')}</button>}
          <small>{activeWorkers} {translate(activeWorkers === 1 ? 'detail.workerActive.one' : 'detail.workerActive.other')} · {workingTasks} {translate(workingTasks === 1 ? 'detail.activeTask.one' : 'detail.activeTask.other')}</small>
          {collections?.members.nextCursor !== undefined && readCollections !== undefined && <button type="button"
            disabled={collections.members.loadingMore} onClick={() => { void readCollections('members', true) }}>
            {translate('detail.loadMembers')}
          </button>}
          {(collections?.members.hasNewer || collections?.members.error !== undefined) && readCollections !== undefined && <button type="button"
            disabled={collections.members.loading || collections.members.loadingMore} onClick={() => { void readCollections('members') }}>
            {translate('detail.refreshMembers')}
          </button>}
        </div>
        {collections?.members.loading && <p className={css.muted} role="status">{translate('detail.membersLoading')}</p>}
        {collections?.members.error !== undefined && <p className={css.error} role="alert">{collections.members.error}</p>}
        <ul className={css.list}>
          {participants.map((participant) => {
            const binding = activations.find(candidate => candidate.activation.participantId === participant.id)
            const canOpen = openParticipantSession !== undefined && binding !== undefined
            const participantTasks = tasks.filter((task) => {
              if (task.phase !== 'assigned' && task.phase !== 'running' && task.phase !== 'review') return false
              if (task.lease?.participantId === participant.id) return true
              return task.phase === 'review' && taskReviewerId(task) === participant.id
            })
            const status = participantActivity(participant, binding?.activation.status, participantTasks)
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
                    {binding !== undefined && binding.activation.status !== 'offline' && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberInterrupt', participantId: participant.id }) }}>{translate('manage.memberInterrupt')}</button>}
                    {participant.role !== 'coordinator' && <button type="button" onClick={() => { setManagementTarget({ kind: 'memberRemove', participantId: participant.id }) }}>{translate('manage.memberRemove')}</button>}
                  </>}
                </div>}
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

      {(Object.keys(state.budgets).length > 0 || state.usage !== undefined) && (
        <section className={css.section} aria-label={translate('detail.budget')}>
          <div className={css.sectionHeader}>
            <h2>{translate('detail.budget')}</h2>
            {state.usage !== undefined && <small data-team-usage>
              {state.usage.inputTokens + state.usage.outputTokens} tokens · {state.usage.turns} turns · {state.usage.costUnits} cost units
            </small>}
          </div>
          {Object.keys(state.budgets).length > 0 && (
            <details className={css.details}>
              <summary>{translate('detail.budgetLimits')} <IconChevronDownOutline14 /></summary>
              <pre className={css.json} data-team-budget>{JSON.stringify(state.budgets, null, 2)}</pre>
            </details>
          )}
        </section>
      )}

      {(workflowPlans.length > 0 || workflowCollection?.loading || workflowCollection?.error !== undefined
        || workflowCollection?.hasNewer) && <section className={css.section} aria-label={translate('detail.workflowPlans')}>
        <div className={css.sectionHeader}><h2>{translate('detail.workflowPlans')}</h2>
          {workflowCollection?.nextCursor !== undefined && readCollections !== undefined && <button type="button"
            disabled={workflowCollection.loadingMore} onClick={() => { void readCollections('workflowPlans', true) }}>
            {translate('detail.loadWorkflowPlans')}
          </button>}
          {(workflowCollection?.hasNewer || workflowCollection?.error !== undefined) && readCollections !== undefined && <button type="button"
            disabled={workflowCollection.loading || workflowCollection.loadingMore} onClick={() => { void readCollections('workflowPlans') }}>
            {translate('detail.refreshWorkflowPlans')}
          </button>}
        </div>
        {workflowCollection?.loading && <p className={css.muted} role="status">{translate('detail.workflowLoading')}</p>}
        {workflowCollection?.error !== undefined && <p className={css.error} role="alert">{workflowCollection.error}</p>}
        <ul className={css.list}>
          {workflowPlans.map((plan) => {
            const bindings = new Map(plan.taskBindings.map(binding => [binding.templateId, binding.taskId]))
            return <li key={plan.id} className={css.record}>
              <div className={css.taskHeader}>
                <strong>{plan.plan.name}</strong>
                <span className={css.badge}>{translate(`detail.workflow.phase.${plan.phase}`)}</span>
              </div>
              <small className={css.taskMeta}>{translate('detail.workflow.bounds')}: {plan.plan.bounds.maxTasks} · {plan.plan.bounds.maxParallelism} · {plan.plan.bounds.maxTotalAttempts}</small>
              <ol className={css.list} aria-label={translate('detail.workflow.tasks')}>
                {plan.plan.tasks.map((template) => {
                  const taskId = bindings.get(template.id)
                  const task = taskId === undefined ? undefined : tasksById.get(taskId)
                  return <li key={template.id} className={css.record}>
                    {task === undefined || task.phase === 'deleted' ? <strong>{template.subject}</strong>
                      : <a href={`#team-task-${task.id}`} onClick={(event) => { focusTask(event, task.id) }}>{task.subject}</a>}
                    {template.blockedBy.length > 0 && <small className={css.taskMeta}>{translate('detail.workflow.dependsOn')}: {' '}
                      {template.blockedBy.map((dependencyId, index) => {
                        const boundId = bindings.get(dependencyId)
                        const dependency = boundId === undefined ? undefined : tasksById.get(boundId)
                        return <span key={dependencyId}>{index > 0 ? ' · ' : null}
                          {dependency === undefined || dependency.phase === 'deleted' ? dependencyId
                            : <a href={`#team-task-${dependency.id}`}
                              onClick={(event) => { focusTask(event, dependency.id) }}>{dependency.subject}</a>}
                        </span>
                      })}
                    </small>}
                  </li>
                })}
              </ol>
              {plan.failure !== undefined && <p className={css.error}>{translate('detail.workflow.failure')}: {plan.failure.message}</p>}
              {plan.cancellation !== undefined && <p className={css.notice}>{translate('detail.workflow.cancellation')}: {plan.cancellation.message}</p>}
              {plan.result !== undefined && <small className={css.muted}>{translate('detail.workflow.result')}: {plan.result.tasks.length}</small>}
            </li>
          })}
        </ul>
      </section>}

      <section className={css.section} aria-label={translate('detail.tasks')}>
        <div className={css.sectionHeader}><h2>{translate('detail.tasks')}</h2>
          {canManage && <button type="button" onClick={() => { setTaskDialogTarget({ kind: 'taskCreate' }) }}>{translate('taskForm.taskCreate')}</button>}
          {collections?.tasks.nextCursor !== undefined && readCollections !== undefined && <button type="button"
            disabled={collections.tasks.loadingMore} onClick={() => { void readCollections('tasks', true) }}>
            {translate('detail.loadTasks')}
          </button>}
          {readCollections !== undefined && <button type="button"
            disabled={collections?.tasks.loading || collections?.tasks.loadingMore} onClick={() => { void readCollections('tasks') }}>
            {translate('detail.refreshTasks')}
          </button>}
        </div>
        {collections?.tasks.loading && <p className={css.muted} role="status">{translate('detail.tasksLoading')}</p>}
        {collections?.tasks.error !== undefined && <p className={css.error} role="alert">{collections.tasks.error}</p>}
        {visibleTasks.length === 0 ? <p className={css.muted}>{translate('detail.noTasks')}</p> : (
          <ul className={css.list}>
            {visibleTasks.map((task) => {
              const latest = task.attemptHistory.at(-1)
              const canDelete = deleteTask !== undefined && task.lease === undefined && task.phase !== 'review'
              const canCancel = cancelTask !== undefined
                && task.cancellation === undefined
                && (task.phase === 'assigned' || task.phase === 'running')
              const hasResultDetails = latest?.outcome.kind === 'completed'
                && (latest.outcome.result.evidence !== undefined || latest.outcome.result.verification !== undefined)
              const ownerId = task.lease?.participantId ?? latest?.participantId
              const owner = ownerId === undefined
                ? undefined
                : participants.find(participant => participant.id === ownerId)
              const hasTaskDetails = task.description.length > 0 || hasResultDetails
              const taskMeta = [
                owner === undefined ? translate('detail.task.unassigned') : `${translate('detail.task.owner')}: ${owner.displayName}`,
                ...(task.maxAttempts > 1 ? [`${translate('detail.task.attempts')}: ${task.attemptCount}/${task.maxAttempts}`] : []),

              ].join(' · ')
              const execution = taskExecution(task)
              const child = execution?.kind === 'child-team' ? task.delegation : undefined
              return (
                <li id={`team-task-${task.id}`} key={task.id} className={css.task} tabIndex={-1}>
                  <div className={css.taskHeader}>
                    <span className={css.taskTitle}><strong>{task.subject}</strong>{canDelete && (
                      <button
                        type="button"
                        className={css.taskDelete}
                        aria-label={`${translate('detail.task.delete')} ${task.subject}`}
                        title={translate('detail.task.delete')}
                        disabled={deletingTaskId !== undefined || cancellingTaskId !== undefined}
                        onClick={() => {
                          setDeleteTarget(task)
                          setDeleteTaskError(undefined)
                        }}
                      >
                        <IconTrashOutline16 size={14} />
                      </button>
                    )}</span>
                    {canCancel && (
                      <button
                        type="button"
                        className={css.taskStop}
                        aria-label={`${translate('detail.task.stop')} ${task.subject}`}
                        title={translate('detail.task.stop')}
                        disabled={deletingTaskId !== undefined || cancellingTaskId !== undefined}
                        onClick={() => {
                          setCancelTarget(task)
                          setCancelTaskError(undefined)
                        }}
                      >
                        <IconStopFill16 size={14} />
                      </button>
                    )}
                    <span className={css.badge}>{translate(task.cancellation !== undefined && (task.phase === 'assigned' || task.phase === 'running')
                      ? 'detail.task.phase.stopping' : taskPhaseKey[task.phase])}</span>
                  </div>
                  <small className={css.taskMeta}>{taskMeta}</small>
                  {child !== undefined && <div className={css.result}>
                    <small>{translate('detail.task.child')} · {translate(`detail.task.childPhase.${child.phase}`)}</small>
                    {child.failure !== undefined && <p className={css.error}>{child.failure.message}</p>}
                    {child.result?.text !== undefined && <p>{child.result.text}</p>}
                    {child.childTeamId !== undefined && openTeam !== undefined && <div className={css.actions}>
                      <button type="button" onClick={() => { void openTeam(child.childTeamId as TeamId) }}>
                        {translate('detail.task.openChild')}
                      </button>
                    </div>}
                  </div>}
                  {task.blockedBy.length > 0 && <p className={css.taskMeta}>{translate('detail.task.blockedBy')}: {task.blockedBy.map((taskId, index) => {
                    const dependency = visibleTasks.find(item => item.id === taskId)
                    return <span key={taskId}>{index === 0 ? '' : ' · '}{dependency === undefined
                      ? translate('taskForm.unloadedDependency', { taskId })
                      : <a href={`#team-task-${taskId}`}>{dependency.subject}</a>}</span>
                  })}</p>}
                  {canManage && <div className={css.actions}>
                    {task.lease === undefined && task.phase === 'pending' && <button type="button" onClick={() => { setTaskDialogTarget({ kind: 'taskUpdate', taskId: task.id }) }}>{translate('taskForm.taskUpdate')}</button>}
                    {task.phase === 'review' && <button type="button" onClick={() => { setTaskDialogTarget({ kind: 'taskReview', taskId: task.id }) }}>{translate('taskForm.taskReview')}</button>}
                    {task.phase === 'completed' && task.attemptHistory.some(attempt => attempt.outcome.kind === 'completed') && <button type="button" onClick={() => { setTaskDialogTarget({ kind: 'taskIntegrate', taskId: task.id }) }}>{translate('taskForm.taskIntegrate')}</button>}
                  </div>}
                  {latest?.outcome.kind === 'completed' && <div className={css.result}>
                    <p>{latest.outcome.result.summary}</p>
                    {hasTaskDetails && <details className={css.details}>
                      <summary>{translate('detail.task.more')} <IconChevronDownOutline14 /></summary>
                      {task.description.length > 0 && <p className={css.taskDetailDescription}>{task.description}</p>}
                      {latest.outcome.result.evidence !== undefined && <small>{translate('detail.task.evidence')}: {latest.outcome.result.evidence.join(' · ')}</small>}
                      {latest.outcome.result.verification !== undefined && <small>{translate('detail.task.verification')}: {latest.outcome.result.verification}</small>}
                    </details>}
                  </div>}
                  {latest?.outcome.kind !== 'completed' && hasTaskDetails && <details className={css.details}>
                    <summary>{translate('detail.task.more')} <IconChevronDownOutline14 /></summary>
                    <p className={css.taskDetailDescription}>{task.description}</p>
                  </details>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {hasChannelSection && (
        <section className={css.section} aria-label={translate('detail.channels')}>
          <div className={css.sectionHeader}>
            <h2>{translate('detail.channels')}</h2>
            {canManage && <button type="button" onClick={() => { setManagementTarget({ kind: 'channelOpen' }) }}>{translate('manage.channelOpen')}</button>}
            <small>{visibleChannels.length}</small>
            {readChannels !== undefined && <button type="button" disabled={channelList?.loading || channelList?.loadingMore}
              onClick={() => { void readChannels(team.id) }}>{translate('channel.refreshList')}</button>}
          </div>
          {channelList?.loading && <p className={css.muted} role="status">{translate('channel.listLoading')}</p>}
          {channelList?.error !== undefined && <p className={css.error} role="alert">{channelList.error}</p>}
          {channelList?.hasNewer && <p className={css.notice} role="status">{translate('channel.listNewer')}</p>}
          {visibleChannels.length === 0 && !channelList?.loading ? <p className={css.muted}>{translate('detail.channelEmpty')}</p> : (
            <ul className={css.channelList}>
              {visibleChannels.map((item, index) => (
                <li key={item.manifest.id}>
                  <button
                    type="button"
                    aria-pressed={selectedChannelId === item.manifest.id}
                    aria-label={`${translate('detail.channel')} ${index + 1}`}
                    data-channel-id={item.manifest.id}
                    disabled={readChannel === undefined}
                    onClick={() => { void loadChannel(item.manifest.id) }}
                  >
                    {translate('detail.channel')} {index + 1} · {item.manifest.adapter.type}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {channelList?.nextCursor !== undefined && readChannels !== undefined && <button type="button"
            disabled={channelList.loading || channelList.loadingMore} onClick={() => { void readChannels(team.id, true) }}>
            {translate('channel.loadMoreChannels')}</button>}
          {channelList?.loadingMore && <p className={css.muted} role="status">{translate('channel.listLoading')}</p>}
          {channelLoading && <p className={css.muted} role="status">{translate('detail.channelLoading')}</p>}
          {channelError !== undefined && <p className={css.error} role="alert">{channelError}</p>}
          {channelState?.hasNewer && <p className={css.notice} role="status">{translate('channel.newer')}</p>}
          {channelState?.disconnected && <p className={css.notice} role="status">{translate('channel.disconnected')}</p>}
          {channelState?.invitationError !== undefined && <p className={css.muted}>{translate('channel.invitationUnavailable')}</p>}
          {channelState?.acknowledgementError !== undefined && <p className={css.error} role="alert">{channelState.acknowledgementError}</p>}
          {channelState?.admissionError !== undefined && <p className={css.error} role="alert">{channelState.admissionError}</p>}
          {channelState?.admission !== undefined && <section className={css.notice} aria-label={translate('channel.endpointStatus')}>
            <h3>{translate('channel.endpointStatus')}</h3>
            <p>{translate('channel.lifecycle')}: {translate(`channel.phase.${channelState.admission.channel.phase}`)}</p>
            <p>{translate('channel.nextSpeaker')}: {expectedNext?.kind === 'participant'
              ? participants.find(participant => participant.id === expectedNext.participantId)?.displayName ?? translate('channel.unknownParticipant')
              : translate('channel.noDesignatedSpeaker')}</p>
            {protocolStatus?.kind === 'consult' && <p>{translate(`channel.consultPhase.${protocolStatus.phase}`)}</p>}
            {protocolStatus?.kind === 'discussion' && <p>{translate('channel.discussionProgress', { count: protocolStatus.turnCount, maximum: protocolStatus.maxTurns })}
              {' · '}{translate(`channel.speaker.${protocolStatus.speakerPolicy}`)}</p>}
            <ul>{channelState.admission.invitations.map(invitation => <li key={invitation.participantId}>
              <strong>{participants.find(participant => participant.id === invitation.participantId)?.displayName ?? translate('channel.unknownParticipant')}</strong>
              {' · '}{invitation.role}{' · '}{translate(invitation.required ? 'channel.required' : 'channel.optional')}
              {' · '}{translate(`channel.invitation.${invitation.status}`)}
              <p>{translate('channel.deadline')} <time dateTime={new Date(invitation.deadline).toISOString()}>
                {new Intl.DateTimeFormat(translate('channel.dateLocale'), { dateStyle: 'short', timeStyle: 'medium' }).format(invitation.deadline)}
              </time></p>
            </li>)}</ul>
          </section>}
          {channelState?.invitation !== undefined && <div className={css.notice}>
            <p>{translate(channelState.invitation.invitation.status === 'pending' ? 'channel.invitationPending' : 'channel.invitationSettled')}</p>
            <small>{channelState.invitation.channel.manifest.adapter.type} · {channelState.invitation.channel.manifest.participants.length} {translate('manage.members')}</small>
            <ul>{channelState.invitation.channel.manifest.participants.map(endpoint => <li key={endpoint.id}>
              {participants.find(participant => participant.id === endpoint.id)?.displayName ?? translate('channel.unknownParticipant')} · {endpoint.role}
            </li>)}</ul>
            {channelState.invitation.invitation.status === 'pending' && acknowledgeChannel !== undefined && <button type="button"
              disabled={channelState.acknowledging || channelAuthorityPending} aria-busy={channelState.acknowledging}
              onClick={() => { void acknowledgeChannel(channelState.channelId) }}>{translate('channel.acceptInvitation')}</button>}
          </div>}
          {selectedChannelId !== undefined && readChannel !== undefined && <div className={css.actions}>
            <button type="button" disabled={channelLoading} onClick={() => { void loadChannel(selectedChannelId) }}>{translate('detail.refresh')}</button>
            {canManage && channel !== undefined && ['pending', 'active'].includes(channel.channel.phase) && <>
              {channel.channel.phase === 'active' && channel.channel.manifest.adapter.type === 'direct'
                && [3, 4].includes(channel.channel.manifest.adapter.version) && <button type="button"
                disabled={channelAuthorityPending || channelState?.invitation?.invitation.status !== 'acknowledged'}
                onClick={() => { setManagementTarget({ kind: 'channelPost', channelId: selectedChannelId }) }}>{translate('manage.channelPost')}</button>}
              {channel.channel.phase === 'active' && basicProtocol && <button type="button"
                disabled={channelAuthorityPending || channelState?.admissionError !== undefined || channelState?.invitation?.invitation.status !== 'acknowledged'
                  || channelState?.admission === undefined || !canSpeak || protocolStatus?.kind === 'consult'
                    && (protocolStatus.phase === 'complete' || protocolStatus.request?.review)}
                onClick={() => { setManagementTarget({ kind: 'channelPost', channelId: selectedChannelId }) }}>{translate('manage.channelPost')}</button>}
              <button type="button" disabled={channelState?.disconnected} onClick={() => { setManagementTarget({ kind: 'channelClose', channelId: selectedChannelId }) }}>{translate(channel.channel.phase === 'pending' ? 'channel.cancelOpening' : 'manage.channelClose')}</button>
            </>}
            {channel?.nextCursor !== undefined && <button type="button" disabled={channelLoading} onClick={() => { void loadChannel(selectedChannelId, channel.nextCursor) }}>{translate('detail.loadMore')}</button>}
            {canManage && summaryCapabilities !== undefined && channel?.records.some(record => record.type === 'channel/envelope') && <button type="button"
              disabled={channelLoading || channelState?.disconnected} onClick={() => { setSummaryOpen(true) }}>{translate('channel.summarize')}</button>}
            {channelLoading && <button type="button" onClick={() => { channelRequest.current?.abort(); closeChannelView?.() }}>{translate('detail.cancelRead')}</button>}
          </div>}
          {basicProtocol && !canSpeak && <p className={css.muted}>{translate('channel.waitForSpeaker')}</p>}
          {protocolStatus?.kind === 'consult' && protocolStatus.request?.review && <p className={css.muted}>{translate('channel.reviewSeparate')}</p>}
          {channelCatalog?.error !== undefined && <p className={css.error} role="alert">{channelCatalog.error}</p>}
          {channel !== undefined && readChannelCatalog !== undefined && <button type="button" disabled={channelCatalog?.loading}
            onClick={() => { void readChannelCatalog() }}>{translate('channel.refreshCatalog')}</button>}
          {channel !== undefined && <p className={css.muted}>{translate('channel.immutableView')}: {channel.channel.manifest.viewPolicy === undefined
            ? translate('channel.noView') : `${channel.channel.manifest.viewPolicy.type} v${channel.channel.manifest.viewPolicy.version}`}</p>}
          {summaries.map(summary => <section key={summary.sequence} className={css.notice} aria-label={translate('channel.savedSummary')}>
            <h3>{translate('channel.savedSummary')}</h3>
            <p>{translate('channel.sourceRange', summary.coveredSequenceRange)}</p>
            <p className={css.humanText}>{summary.text}</p>
          </section>)}
          {channel?.view !== undefined && <details className={css.record}>
            <summary>{translate('channel.pageView')}</summary><pre className={css.json}>{JSON.stringify(channel.view, null, 2)}</pre>
          </details>}
          {channel !== undefined && <div className={css.records} aria-label={translate('detail.readChannel')}>
            {channel.records.filter(record => record.type === 'channel/envelope').map(record => <ChannelEnvelope key={record.envelope.id}
              record={record} sender={participants.find(participant => participant.id === record.envelope.senderId)?.displayName ?? translate('channel.unknownParticipant')}
              richContent={channel.channel.manifest.adapter.type === 'direct' && [3, 4].includes(channel.channel.manifest.adapter.version)}
              renderSlot={renderSlot} readAttachment={readChannelAttachment} translate={translate} />)}
            {channel.records.length === 0 ? <p className={css.muted}>{translate('detail.channelEmpty')}</p> : (
              <>
                <p className={css.muted}>{channel.records.length} {translate(channel.records.length === 1 ? 'detail.channelRecords.one' : 'detail.channelRecords.other')}</p>
                <details><summary>{translate('channel.rawRecords')}</summary>
                  {channel.records.map(record => (
                    <details key={`${record.type}:${'sequence' in record ? record.sequence : record.envelope.id}`} className={css.record} data-channel-record>
                      <summary><strong>{record.type}</strong> <IconChevronDownOutline14 /></summary>
                      <pre className={css.json}>{JSON.stringify(record.type === 'channel/envelope' ? record.envelope.payload : record, null, 2)}</pre>
                    </details>
                  ))}
                </details>
              </>
            )}
          </div>}
        </section>
      )}

      {(pendingReviews.length > 0 || legacyPendingActions.length > 0
        || durablePendingActions.length > 0 || actionFeedback !== undefined) && (
        <section className={css.section} aria-label={translate('detail.humanActions')}>
          <h2>{translate('detail.humanActions')}</h2>
          {actionFeedback !== undefined && <p className={css.notice} role="status">
            {translate(actionFeedback === 'accepted' ? 'human.accepted' : 'human.unavailable')}
          </p>}
          <ul className={css.list}>
            {pendingReviews.map(task => <li key={task.id} className={css.notice}>{translate('detail.review')}: {task.subject}</li>)}
            {legacyPendingActions.map(action => <li key={`${action.kind}:${action.requestId}`} className={css.notice}>
              {action.kind === 'approval' ? `${translate('detail.approval')}: ${action.toolName}` : `${translate('detail.question')} (${String(action.questions.length)})`}
            </li>)}
            {durablePendingActions.map(action => <li key={String(action.id)}>
              {respondAction === undefined ? <p className={css.notice}>
                {translate(action.kind === 'approval' ? 'detail.approval' : 'detail.question')} {translate('detail.pending')}
              </p>
                : <HumanActionCard action={action} translate={translate}
                  respond={async (input, signal) => {
                    const result = await respondAction(input, signal)
                    setActionFeedback(result.kind)
                    return result
                  }}
                  {...openActionContext === undefined ? {} : { openContext: openActionContext }} />}
            </li>)}
          </ul>
        </section>
      )}

      {(artifacts.length > 0 || artifact !== undefined || artifactLoadingId !== undefined || artifactError !== undefined
        || collections?.artifacts.loading || collections?.artifacts.error !== undefined || collections?.artifacts.nextCursor !== undefined
        || collections?.artifacts.hasNewer) && (
        <section className={css.section} aria-label={translate('detail.artifacts')}>
          <div className={css.sectionHeader}><h2>{translate('detail.artifacts')}</h2>
            {collections?.artifacts.nextCursor !== undefined && readCollections !== undefined && <button type="button"
              disabled={collections.artifacts.loadingMore} onClick={() => { void readCollections('artifacts', true) }}>
              {translate('detail.loadArtifacts')}
            </button>}
            {(collections?.artifacts.hasNewer || collections?.artifacts.error !== undefined) && readCollections !== undefined && <button type="button"
              disabled={collections.artifacts.loading || collections.artifacts.loadingMore} onClick={() => { void readCollections('artifacts') }}>
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

      {hasAuditSection && (
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
        target={taskDialogTarget} state={state} translate={translate} manage={manage}
        onClose={() => { setTaskDialogTarget(undefined) }}
      />}
      {managementTarget !== undefined && manage !== undefined && <TeamManagementDialog
        key={`${team.id}:${managementTarget.kind}:${'participantId' in managementTarget ? managementTarget.participantId : 'channelId' in managementTarget ? managementTarget.channelId : ''}`}
        target={managementTarget}
        state={state}
        translate={translate}
        channel={channel?.channel}
        senderId={channelState?.invitation?.invitation.participantId}
        channelPending={channelAuthorityPending || basicProtocol && channelState?.admissionError !== undefined}
        catalog={channelCatalog}
        readCatalog={readChannelCatalog}
        admission={channelState?.admission}
        manage={manage}
        onClose={() => { setManagementTarget(undefined) }}
        refreshChannel={async () => { if (selectedChannelId !== undefined) await loadChannel(selectedChannelId) }}
      />}
      {summaryOpen && channel !== undefined && manage !== undefined && <ChannelSummaryDialog
        key={channel.channel.manifest.id} page={channel} capabilities={summaryCapabilities} readCatalog={readChannelCatalog} translate={translate} manage={manage}
        onClose={() => { setSummaryOpen(false) }} />}
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
