/** Team list presentation for the sidebar's Team task seat. */

import { useEffect, useState } from 'react'
import {
  IconFolderClose16, IconGoalOutline16, IconPlusOutline16, IconQueueOutline14, StatusGlyph, Tooltip,
} from '@clocky/clocky-client-ui-primitives'
import type {
  ChannelId,
  ChannelReadPageResult,
  ObservableSnapshot,
  ParticipantId,
  TeamAuditList,
  TeamId,
  TeamCollectionKind,
  TeamManagementCommand,
  TeamTaskListState,
  TeamTaskDraftOptions,
  TeamTaskId,
  TeamTaskSelection,
  TeamChannelAttachmentInput, TeamChannelAttachmentResult,
  WorkspaceListState,
} from '@clocky/clocky-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@clocky/clocky-client-ui-slots'
import css from './TeamBrowser.module.css'
import { teamPhaseKey } from './locales.ts'
import { TeamInboxDialog, type TeamInboxControls } from './TeamInboxDialog.tsx'
import { deriveShortTitle, relativeTime, sortTeams, teamStatus } from './team-row.ts'

/** Re-render once a minute so relative times stay current without a store. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [])
  return now
}

/** Browser-private actions and observable Team product state. */
export interface TeamBrowserInjected extends Partial<TeamInboxControls> {
  closeMemberDetail?: import('@clocky/clocky-client-runtime/client').ITeamTasks['closeMemberDetail']
  readMemberDetail?: import('@clocky/clocky-client-runtime/client').ITeamTasks['readMemberDetail']
  readWorkflowDetail?: import('@clocky/clocky-client-runtime/client').ITeamTasks['readWorkflowDetail']
  closeWorkflowDetail?: import('@clocky/clocky-client-runtime/client').ITeamTasks['closeWorkflowDetail']
  /** Read one additional Team page on explicit request. */
  loadMoreTeams?: () => Promise<void>
  /** Return to the first Team page without discarding the selected workspace. */
  firstTeamPage?: () => Promise<void>
  /** Resolve a Team and open its coordinator transcript. */
  openTeam: (teamId: TeamId) => Promise<void | TeamTaskSelection>
  /** Archive a terminal Team and remove it from the list. */
  archiveTeam: (teamId: TeamId) => Promise<void>
  /** Cancel a nonterminal Team. */
  cancelTeam?: (teamId: TeamId) => Promise<TeamTaskListState['items'][number]['phase']>
  /** Re-attach a stalled/offline Team. */
  resumeTeam?: (teamId: TeamId) => Promise<void | TeamTaskSelection>
  /** Open a selected Participant's descendant Session. */
  openParticipantSession?: (teamId: TeamId, participantId: ParticipantId) => Promise<void>
  /** Apply one authenticated member or channel operation. */
  manageTeam?: (teamId: TeamId, command: TeamManagementCommand, signal?: AbortSignal) => Promise<void>
  /** Read one bounded authoritative Team or channel audit page. */
  readAudit?: (
    teamId: TeamId,
    options?: { channelId?: ChannelId; afterCursor?: number; limit?: number },
    signal?: AbortSignal,
  ) => Promise<TeamAuditList>
  /** Read one bounded authoritative channel WAL suffix. */
  readChannel?: (channelId: ChannelId, afterCursor?: number, signal?: AbortSignal) => Promise<ChannelReadPageResult>
  /** Explicit principal invitation consent for the displayed channel. */
  acknowledgeChannel?: (channelId: ChannelId) => Promise<void>
  /** Release the runtime's current channel observation. */
  closeChannelView?: () => void
  /** Load the selected Team's explicit channel page window. */
  readChannels?: (teamId: TeamId, mode?: 'refresh' | 'next' | 'first') => Promise<void>
  /** Exact saved-envelope image read; no arbitrary attachment reader is exposed. */
  readChannelAttachment?: (input: TeamChannelAttachmentInput, signal?: AbortSignal) => Promise<TeamChannelAttachmentResult>
  /** Resolve registered protocol and view choices for channel creation. */
  readChannelCatalog?: () => Promise<void>
  /** Read and verify one visible Team artifact. */
  readArtifact?: (teamId: TeamId, artifactId: string, signal?: AbortSignal) => Promise<void>
  /** Load one bounded member or task collection page for the selected Team. */
  readCollections?: (teamId: TeamId, collection: TeamCollectionKind, mode?: 'refresh' | 'next' | 'first', signal?: AbortSignal) => Promise<void>
  /** Read current task data or replace one bounded history window. */
  watchIdentities?: ((teamId: import('@clocky/clocky-client-runtime/client').TeamId, ids: readonly import('@clocky/clocky-client-runtime/client').ParticipantId[]) => () => void) | undefined
  refreshIdentities?: (() => Promise<void>) | undefined
  watchExecutionProfiles?: ((input: import('@clocky/clocky-client-runtime/client').TeamExecutionProfilesInput) => () => void) | undefined
  refreshExecutionProfiles?: (() => Promise<void>) | undefined
  watchMemberReadiness?: ((input: import('@clocky/clocky-client-runtime/client').TeamMemberReadinessInput) => () => void) | undefined
  refreshMemberReadiness?: import('@clocky/clocky-client-runtime/client').ITeamTasks['refreshMemberReadiness']
  watchTaskCapabilities?: ((input: import('@clocky/clocky-client-runtime/client').TeamTaskCapabilitiesInput) => () => void) | undefined
  refreshTaskCapabilities?: import('@clocky/clocky-client-runtime/client').ITeamTasks['refreshTaskCapabilities']
  watchAttention?: ((teamId: TeamId) => () => void) | undefined
  readAttention?: ((teamId: TeamId, mode?: 'first' | 'next') => Promise<void>) | undefined
  refreshAttentionPreview?: ((teamId: TeamId) => Promise<void>) | undefined
  pauseAttention?: (() => void) | undefined
  inspectAction?: import('@clocky/clocky-client-runtime/client').ITeamTasks['inspectAction']
  closeActionDetail?: (() => void) | undefined
  openPendingAction?: ((teamId: TeamId, id: import('@clocky/clocky-client-runtime/client').TeamActionResponseInput['actionId']) => Promise<void>) | undefined
  readTaskQuery?: import('@clocky/clocky-client-runtime/client').ITeamTasks['readTaskQuery']
  pauseTaskQuery?: import('@clocky/clocky-client-runtime/client').ITeamTasks['pauseTaskQuery']
  lookupTaskUpdate?: import('@clocky/clocky-client-runtime/client').ITeamTasks['lookupTaskUpdate']
  watchTaskReferences?: ((teamId: TeamId, taskIds: readonly import('@clocky/clocky-client-runtime/client').TeamTaskId[]) => () => void) | undefined
  refreshTaskReferences?: (() => Promise<void>) | undefined
  readDependencies?: import('@clocky/clocky-client-runtime/client').ITeamTasks['readDependencies']
  closeDependencies?: import('@clocky/clocky-client-runtime/client').ITeamTasks['closeDependencies']
  readTaskDetail?: import('@clocky/clocky-client-runtime/client').ITeamTasks['readTaskDetail']
  /** Release task inspection reads and data. */
  closeTaskDetail?: () => void
  hooks: {
    /** Durable Team list and local Team-selection state. */
    tasks: ObservableSnapshot<TeamTaskListState>
  }
  /** Update the local choices retained by the current new-Team draft. */
  updateDraft?: (options: import('@clocky/clocky-client-runtime/client').TeamTaskDraftOptions) => void
  /** Open the Host's native project-directory chooser for the current draft. */
  pickDirectory?: () => Promise<string | null>
  /** Start a new local Team draft, optionally pinned to a Workspace. */
  startDraft?: (options?: TeamTaskDraftOptions) => void
  /** Delete one lease-free task through the authenticated Team control path. */
  deleteTask?: (teamId: TeamId, taskId: TeamTaskId, expectedRevision: number, signal?: AbortSignal) => Promise<void>
  /** Stop one assigned or running task through the authenticated Team control path. */
  cancelTask?: (teamId: TeamId, taskId: TeamTaskId, expectedRevision: number, reason?: string, signal?: AbortSignal) => Promise<void>
}

/** Full Team browser component props. */
export type TeamBrowserProps =
  PropsRuntime<'sidebar.teamTasks'>
  & InjectFace<TeamBrowserInjected>
  & PropsLocale<'team'>

/** AbortController and host pickers may reject with DOMException instead of Error. */
function isAbortError(reason: unknown): boolean {
  return (reason instanceof DOMException || reason instanceof Error) && reason.name === 'AbortError'
}

/**
 * Render the Team task list and route Team selection through the injected owner.
 * @param props - Framework-composed Team browser props.
 * @returns the Team navigation surface.
 */
export function TeamBrowser({
  wide,
  openTeam,
  recoverInbox, refreshInbox, loadMoreInbox, watchInbox, acknowledgeInbox, readAction, respondAction, openActionContext,
  loadMoreTeams, firstTeamPage,
  archiveTeam,
  cancelTeam,
  resumeTeam,
  updateDraft,
  pickDirectory,
  startDraft,
  useTasks,
  useWorkspaces,
  t,
}: TeamBrowserProps) {
  const state = useTasks(snapshot => snapshot)
  const workspaceState = useWorkspaces(snapshot => snapshot) as WorkspaceListState | undefined
  const workspaces = workspaceState === undefined ? [] : workspaceState.items
  const [inboxOpen, setInboxOpen] = useState(false)
  const inboxControls = refreshInbox === undefined || loadMoreInbox === undefined || watchInbox === undefined
    || acknowledgeInbox === undefined || readAction === undefined || respondAction === undefined || openActionContext === undefined
    ? undefined : { recoverInbox, refreshInbox, loadMoreInbox, watchInbox, acknowledgeInbox, readAction, respondAction, openActionContext }
  const [opening, setOpening] = useState<TeamId | undefined>()
  const [archiving, setArchiving] = useState<TeamId | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [mutating, setMutating] = useState<TeamId | undefined>()
  const [workspacePicking, setWorkspacePicking] = useState(false)
  const now = useMinuteClock()
  // Access refusals are explained once by the shell's connection banner; the
  // list never repeats transport text. Other list failures show product words
  // and keep the Host message on hover.
  const listError = state.error === null || state.error.code === 'PRODUCT_AUTH_INVALID' || state.error.code === 'PRODUCT_AUTH_REQUIRED'
    ? undefined : state.error.message
  const visibleError = error ?? (listError === undefined ? undefined : t('list.loadFailed'))
  const errorDetail = error ?? listError
  const inbox = state.inbox
  const unread = inbox === undefined ? 0 : inbox.items.filter(item => item.sequence > inbox.displayCursor).length
  const inboxAvailable = inboxControls !== undefined && state.inbox !== undefined
  const inboxDialog = inboxOpen && inboxControls !== undefined && state.inbox !== undefined && <TeamInboxDialog
    state={state.inbox} teams={state.items} translate={t} openTeam={openTeam} onClose={() => { setInboxOpen(false) }} {...inboxControls}
  />
  const inboxLabel = unread > 0 ? `${t('inbox.title')}，${t('inbox.unreadCount', { count: unread })}` : t('inbox.title')

  if (!wide) {
    // The collapsed rail keeps only the Inbox, as an icon with its count.
    if (!inboxAvailable) return null
    return (
      <>
        <Tooltip label={inboxLabel} delayMs={500}>
          <button type="button" className={css.railInbox} aria-label={inboxLabel} onClick={() => { setInboxOpen(true) }}>
            <IconQueueOutline14 size={18} />
            {unread > 0 && <span className={css.railBadge} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
          </button>
        </Tooltip>
        {inboxDialog}
      </>
    )
  }

  const select = async (teamId: TeamId): Promise<void> => {
    setOpening(teamId)
    setError(undefined)
    try {
      await openTeam(teamId)
    } catch (reason: unknown) {
      if (!isAbortError(reason)) setError(String(reason))
    } finally {
      setOpening((current) => {
        /* v8 ignore next -- All Team rows are disabled while one selection is opening. */
        return current === teamId ? undefined : current
      })
    }
  }

  const archive = async (teamId: TeamId): Promise<void> => {
    setArchiving(teamId)
    setError(undefined)
    try {
      await archiveTeam(teamId)
    } catch (reason: unknown) {
      setError(String(reason))
    } finally {
      setArchiving(undefined)
    }
  }

  const mutate = async (
    teamId: TeamId,
    action: ((id: TeamId) => Promise<void | TeamTaskSelection | TeamTaskListState['items'][number]['phase']>) | undefined,
  ): Promise<void> => {
    /* v8 ignore next -- Mutation buttons render only when their operation callback is installed. */
    if (action === undefined) return
    setMutating(teamId)
    setError(undefined)
    try {
      await action(teamId)
    } catch (reason: unknown) {
      setError(String(reason))
    } finally {
      setMutating(undefined)
    }
  }

  const chooseWorkspace = (): void => {
    /* v8 ignore next -- The folder button is omitted without a picker and disabled while a pick is pending. */
    if (pickDirectory === undefined || workspacePicking) return
    setWorkspacePicking(true)
    void pickDirectory().catch((reason: unknown) => {
      if (!isAbortError(reason)) setError(String(reason))
    }).finally(() => { setWorkspacePicking(false) })
  }

  type SidebarTeam = Pick<TeamTaskListState['items'][number],
    'id' | 'phase' | 'workspacePath' | 'objectiveTruncated' | 'readAccess' | 'executionManagement' | 'updatedAt'>
    & { readonly goal: { readonly objective: string } }
  const selected = state.selected?.teamId === state.current ? state.selected : undefined
  const selectedRow: SidebarTeam | undefined = selected === undefined ? undefined : {
    ...selected.state.team, goal: { objective: selected.state.metadata?.kind === 'available'
      ? selected.state.metadata.goal.objective : selected.state.goal.objective.text },
    objectiveTruncated: selected.state.metadata?.kind === 'available' ? false : selected.state.goal.objective.truncated,
    readAccess: selected.state.readAccess,
    executionManagement: selected.state.executionManagement,
  }
  const rows: readonly SidebarTeam[] = sortTeams(selectedRow === undefined || state.items.some(item => item.id === selectedRow.id)
    ? state.items : [selectedRow, ...state.items])
  const renderTeamRow = (team: SidebarTeam) => {
    const objective = `${team.goal.objective}${team.objectiveTruncated ? '…' : ''}`
    const time = relativeTime(team.updatedAt, now)
    const short = deriveShortTitle(team.goal.objective)
    return (
      <div key={team.id} className={css.item} role="listitem" data-status={teamStatus(team.phase)}>
        <button
          type="button"
          className={`${css.row}${team.id === state.current ? ` ${css.selected}` : ''}`}
          aria-current={team.id === state.current ? 'page' : undefined}
          disabled={opening !== undefined || archiving !== undefined || mutating !== undefined}
          title={objective}
          // A stable name: the full objective and phase; relative time is visual.
          aria-label={`${objective} ${t(teamPhaseKey[team.phase])}`}
          onClick={() => { void select(team.id) }}
        >
          <StatusGlyph status={teamStatus(team.phase)} className={css.glyph} />
          {/* The row's aria-label names it; the short title and relative time are visual. */}
          <span className={css.rowText} aria-hidden="true">
            <span className={css.objective}>{short}</span>
            <span className={css.meta}>
              <span className={css.phase}>{t(teamPhaseKey[team.phase])}</span>
              <span aria-hidden="true">·</span>
              <span data-relative-time>{t(time.key, { count: time.count })}</span>
            </span>
          </span>
        </button>
        <div className={css.rowActions}>
          {team.readAccess === 'member' && team.executionManagement !== 'simulation-managed' && (team.phase === 'completed' || team.phase === 'failed' || team.phase === 'cancelled') && (
            <button
              type="button"
              className={css.archive}
              aria-label={`${t('archive')} ${team.goal.objective}`}
              title={t('archive')}
              disabled={opening !== undefined || archiving !== undefined}
              onClick={() => { void archive(team.id) }}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
          {team.readAccess === 'member' && team.executionManagement !== 'simulation-managed' && team.phase === 'stalled' && resumeTeam !== undefined && (
            <button type="button" className={css.archive} aria-label={`${t('resume')} ${team.goal.objective}`} title={t('resume')}
              disabled={mutating !== undefined} onClick={() => { void mutate(team.id, resumeTeam) }}>
              <span aria-hidden="true">↻</span>
            </button>
          )}
          {team.readAccess === 'member' && team.executionManagement !== 'simulation-managed' && (team.phase === 'active' || team.phase === 'quiescing' || team.phase === 'stalled') && cancelTeam !== undefined && (
            <button type="button" className={css.archive} aria-label={`${t('cancel')} ${team.goal.objective}`} title={t('cancel')}
              disabled={mutating !== undefined} onClick={() => { void mutate(team.id, cancelTeam) }}>
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderTaskGroups = () => {
    if (workspaces.length === 0) {
      return <div className={css.list} role="list">{rows.map(renderTeamRow)}</div>
    }
    const workspacePaths = new Set(workspaces.map(workspace => workspace.path))
    const loose = rows.filter(team => team.workspacePath === undefined || !workspacePaths.has(team.workspacePath))
    return (
      <div className={css.workspaceList}>
        {workspaces.map((workspace) => {
          const tasks = rows.filter(team => team.workspacePath === workspace.path)
          return (
            <section key={workspace.workspaceId} className={css.workspaceGroup} aria-label={workspace.title}>
              <div className={css.workspaceHead}>
                <button
                  type="button"
                  className={css.workspaceButton}
                  title={workspace.path}
                  onClick={() => {
                    if (startDraft !== undefined) startDraft({ cwd: workspace.path })
                    else updateDraft?.({ cwd: workspace.path })
                  }}
                >
                  <IconFolderClose16 size={14} />
                  <span className={css.workspaceName}>{workspace.title}</span>
                  <span className={css.workspaceCount}>{tasks.length}</span>
                </button>
                {startDraft !== undefined && (
                  <button
                    type="button"
                    className={css.workspaceAddTask}
                    aria-label={`${t('workspace.addTask')} ${workspace.title}`}
                    title={t('workspace.addTask')}
                    onClick={() => { startDraft({ cwd: workspace.path }) }}
                  >
                    <IconPlusOutline16 size={13} />
                  </button>
                )}
              </div>
              {tasks.length === 0 ? <p className={css.workspaceEmpty}>{t(state.nextCursor === undefined ? 'workspace.empty' : 'workspace.notLoaded')}</p> : <div className={css.list} role="list">{tasks.map(renderTeamRow)}</div>}
            </section>
          )
        })}
        {loose.length > 0 && (
          <section className={css.workspaceGroup} aria-label={t('workspace.unassigned')}>
            <div className={css.workspaceHead}><span className={css.workspaceUnassigned}>{t('workspace.unassigned')}</span></div>
            <div className={css.list} role="list">{loose.map(renderTeamRow)}</div>
          </section>
        )}
      </div>
    )
  }

  return (
    <section className={css.root} aria-label={t('section.title')}>
      <div className={css.header}><IconGoalOutline16 size={14} />{t('section.title')}</div>
      {inboxAvailable && (
        <button type="button" className={css.inboxRow} aria-label={inboxLabel} onClick={() => { setInboxOpen(true) }}>
          <IconQueueOutline14 size={14} />
          <span className={css.inboxLabel}>{t('inbox.title')}</span>
          {unread > 0 && <span className={css.inboxBadge} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
      {visibleError !== undefined && <div className={css.error} role="alert" title={errorDetail}>{visibleError}</div>}
      {pickDirectory !== undefined && (
        <div className={css.workspaceToolbar}>
          <span>{t('workspace.title')}</span>
          <button type="button" className={css.workspaceAdd} disabled={workspacePicking} onClick={chooseWorkspace}>
            <IconPlusOutline16 size={13} />
            {t('workspace.add')}
          </button>
        </div>
      )}
      {rows.length === 0 && workspaces.length === 0
        ? <div className={css.empty}>{t(state.phase === 'pending' ? 'empty.loading' : state.nextCursor === undefined ? 'empty.none' : 'workspace.notLoaded')}</div>
        : renderTaskGroups()}
      {(state.nextCursor !== undefined || state.startCursor !== undefined && state.startCursor !== -1) && <div className={css.actions}>
        <small>{t('list.loaded', { count: state.items.length })}</small>
        {state.startCursor !== undefined && state.startCursor !== -1 && firstTeamPage !== undefined && <button type="button"
          disabled={state.loadingMore === true || state.state === 'loading'} onClick={() => { void firstTeamPage() }}>{t('detail.firstPage')}</button>}
        {state.nextCursor !== undefined && loadMoreTeams !== undefined && <button type="button"
          disabled={state.loadingMore === true || state.state === 'loading'} onClick={() => { void loadMoreTeams() }}>{t('detail.loadMore')}</button>}
        {state.loadingMore === true && <p className={css.muted} role="status">{t('empty.loading')}</p>}
      </div>}
      {inboxDialog}
    </section>
  )
}
