/** Team list presentation for the sidebar's Team task seat. */

import { useState } from 'react'
import { IconFolderClose16, IconGoalOutline16, IconPlusOutline16 } from '@clocky/clocky-client-ui-primitives'
import type {
  ChannelId,
  ChannelReadPageResult,
  ObservableSnapshot,
  ParticipantId,
  TeamArtifactReadResult,
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

/** Browser-private actions and observable Team product state. */
export interface TeamBrowserInjected extends Partial<TeamInboxControls> {
  inspectMember?: import('@clocky/clocky-client-runtime/client').ITeamTasks['inspectMember']
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
  readArtifact?: (teamId: TeamId, artifactId: string, signal?: AbortSignal) => Promise<TeamArtifactReadResult>
  /** Load one bounded member or task collection page for the selected Team. */
  readCollections?: (teamId: TeamId, collection: TeamCollectionKind, mode?: 'refresh' | 'next' | 'first', signal?: AbortSignal) => Promise<void>
  /** Read current task data or replace one bounded history window. */
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

/**
 * Render the Team task list and route Team selection through the injected owner.
 * @param props - Framework-composed Team browser props.
 * @returns the Team navigation surface.
 */
export function TeamBrowser({
  wide,
  expandSidebar,
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
  const visibleError = error ?? state.error?.message

  if (!wide) {
    return (
      <button type="button" className={css.rail} aria-label={t('rail.expand')} onClick={expandSidebar}>
        <IconGoalOutline16 size={18} />
      </button>
    )
  }

  const select = async (teamId: TeamId): Promise<void> => {
    setOpening(teamId)
    setError(undefined)
    try {
      await openTeam(teamId)
    } catch (reason: unknown) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) setError(String(reason))
    } finally {
      setOpening(current => current === teamId ? undefined : current)
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
    if (pickDirectory === undefined || workspacePicking) return
    setWorkspacePicking(true)
    void pickDirectory().catch((reason: unknown) => {
      if (!(reason instanceof Error && reason.name === 'AbortError')) setError(String(reason))
    }).finally(() => { setWorkspacePicking(false) })
  }

  type SidebarTeam = Pick<TeamTaskListState['items'][number], 'id' | 'phase' | 'workspacePath'> & { readonly goal: { readonly objective: string } }
  const selected = state.selected?.teamId === state.current ? state.selected : undefined
  const selectedRow: SidebarTeam | undefined = selected === undefined ? undefined : {
    ...selected.state.team, goal: { objective: selected.state.metadata?.kind === 'available'
      ? selected.state.metadata.goal.objective : selected.state.goal.objective.text },
  }
  const rows: readonly SidebarTeam[] = selectedRow === undefined || state.items.some(item => item.id === selectedRow.id)
    ? state.items : [selectedRow, ...state.items]
  const renderTeamRow = (team: SidebarTeam) => (
    <div key={team.id} className={css.item} role="listitem">
      <button
        type="button"
        className={`${css.row}${team.id === state.current ? ` ${css.selected}` : ''}`}
        aria-current={team.id === state.current ? 'page' : undefined}
        disabled={opening !== undefined || archiving !== undefined || mutating !== undefined}
        title={team.goal.objective}
        onClick={() => { void select(team.id) }}
      >
        <span className={css.objective}>{team.goal.objective}</span>
        <span className={css.phase}>{t(teamPhaseKey[team.phase])}</span>
      </button>
      {(team.phase === 'completed' || team.phase === 'failed' || team.phase === 'cancelled') && (
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
      {team.phase === 'stalled' && resumeTeam !== undefined && (
        <button type="button" className={css.archive} aria-label={`${t('resume')} ${team.goal.objective}`} title={t('resume')}
          disabled={mutating !== undefined} onClick={() => { void mutate(team.id, resumeTeam) }}>
          <span aria-hidden="true">↻</span>
        </button>
      )}
      {(team.phase === 'active' || team.phase === 'quiescing' || team.phase === 'stalled') && cancelTeam !== undefined && (
        <button type="button" className={css.archive} aria-label={`${t('cancel')} ${team.goal.objective}`} title={t('cancel')}
          disabled={mutating !== undefined} onClick={() => { void mutate(team.id, cancelTeam) }}>
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  )

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
      {inboxControls !== undefined && state.inbox !== undefined && <div className={css.actions}><button type="button" onClick={() => { setInboxOpen(true) }}>{t('inbox.title')}</button></div>}
      {visibleError !== undefined && <div className={css.error} role="alert">{visibleError}</div>}
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
      {inboxOpen && inboxControls !== undefined && state.inbox !== undefined && <TeamInboxDialog
        state={state.inbox} teams={state.items} translate={t} openTeam={openTeam} onClose={() => { setInboxOpen(false) }} {...inboxControls}
      />}
    </section>
  )
}
