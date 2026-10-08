import { WorkspaceNavigationError } from './navigation-error.ts'
import { WorkspaceNavigation } from './WorkspaceNavigation.tsx'
import { TeamModeCard } from './TeamModeCard.tsx'
/** Registers the Team task browser in the sidebar shell. */

import type { BoundActions } from '@clocky/clocky-client-ui-slots'
import type { WorkspaceRoute } from './workspace-navigation.ts'
import type { ClientContext, TeamId, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type { ConnectionHandle } from '@clocky/clocky-client-connection/client'
import type {} from '@clocky/clocky-client-locale/client'
import type {} from '@clocky/clocky-client-ui-sidebar/client'
import type {} from '@clocky/clocky-client-ui-layout/client'
import type {} from '@clocky/clocky-client-ui-conversation/client'
import type { TeamInboxControls } from './TeamInboxDialog.tsx'
import type { TeamBrowserInjected } from './TeamBrowser.tsx'
import { TeamBrowser } from './TeamBrowser.tsx'
import { TeamWorkspace } from './TeamWorkspace.tsx'
import { createTeamWorkspaceStore, Config } from './workspace-store.ts'
import { createSessionInspection } from './session-inspection.ts'
import type { TeamChannelMessageOwnerProps } from './channel-message-types.ts'
export type { TeamChannelMessageOwnerProps, TeamChannelMessageProps } from './channel-message-types.ts'
import { en, zh, teamPhaseKey, type TeamKey } from './locales.ts'
import { deriveShortTitle } from './team-row.ts'
import { memberLabels, memberPageLabels } from './member-labels.ts'

export type { TeamBrowserInjected, TeamBrowserProps } from './TeamBrowser.tsx'
export { Config } from './workspace-store.ts'
export type { TeamKey } from './locales.ts'

declare module '@clocky/clocky-client-ui-slots' {
  interface SlotMap {
    /** Ordered admitted channel message content and exact image reads. */
    'team.channel.message': { kind: 'single'; scope: 'root'; owner: TeamChannelMessageOwnerProps }
  }
  interface LocaleNamespaceMap {
    /** Team task list and selection feedback. */
    team: TeamKey
  }
}

const NS = 'team'

/** Services required by the Team browser. */
export const inject = ['slots', 'sessions', 'teamTasks', 'locale', 'connection', 'layout']

/** Mount the sidebar Team browser.
 * @param ctx - Client root context.
 * @param config - Public deployment limits for channel draft retention.
 * @returns nothing; registrations live on the caller fiber.
 */
export function apply(ctx: ClientContext, config: Config = {}): void {
  const limits = Config.parse(config)
  const connection = ctx.get('connection') as ConnectionHandle
  const workspaceStore = createTeamWorkspaceStore(limits)
  let navigationRequest: AbortController | undefined
  const cancelRestoration = () => { navigationRequest?.abort() }
  ctx.effect(() => cancelRestoration, 'ui-team: route restoration lifetime')
  const inspection = createSessionInspection({ currentTeam: () => ctx.teamTasks.list.getSnapshot().current,
    refresh: async () =>{  await ctx.sessions.refresh() }, select: (sessionId) => { ctx.sessions.open(sessionId) } })
  ctx.effect(() => inspection.cancel, 'ui-team: inspection lifetime')
  ctx.effect(() => {
    let previous = ctx.sessions.list.getSnapshot().current
    return ctx.sessions.list.subscribe(() => {
      const current = ctx.sessions.list.getSnapshot().current
      if (previous !== undefined && current === undefined) inspection.cancel()
      previous = current
    })
  }, 'ui-team: dismissed inspection')
  const inspect = ctx.teamTasks.inspect?.bind(ctx.teamTasks)
  const workspaces = ctx.get('workspaces')
  const draftControls: Pick<TeamBrowserInjected, 'updateDraft' | 'pickDirectory' | 'startDraft'> =
    workspaces === undefined ? {} : {
      updateDraft: (options) => { ctx.teamTasks.updateDraft(options) },
      pickDirectory: async () => {
        const path = await workspaces.pickDirectory()
        if (path === null) return null
        await workspaces.create({ path })
        return path
      },
      startDraft: (options) => {
        cancelRestoration()
        inspection.cancel()
        ctx.teamTasks.startDraft(options)
        ctx.sessions.clear()
      },
    }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-team: dictionaries')
  const stopLiveUpdates = ctx.teamTasks.watch?.()
  ctx.effect(() => () => { stopLiveUpdates?.() }, 'ui-team: live Team updates')

  const openTeam = async (teamId: TeamId) => {
    ctx.layout.showWorkspace('team')
    if (inspect === undefined) throw new Error('Read-only Team inspection is unavailable')
    cancelRestoration()
    inspection.cancel()
    ctx.sessions.clear()
    const selection = await inspect(teamId)
    return selection
  }
  const archiveTeam = async (teamId: TeamId): Promise<void> => {
    await ctx.teamTasks.archive(teamId)
  }
  const cancelTeam = async (teamId: TeamId) => await ctx.teamTasks.cancel(teamId)
  const resumeTeam = async (teamId: TeamId) => {
    ctx.layout.showWorkspace('team')
    cancelRestoration()
    inspection.cancel()
    ctx.sessions.clear()
    const selection = await ctx.teamTasks.resume(teamId)
    return selection
  }
  const openParticipantSession = async (teamId: TeamId, participantId: Parameters<NonNullable<TeamBrowserInjected['openParticipantSession']>>[1]): Promise<void> => {
    cancelRestoration()
    await inspection.open(teamId, async (signal) => {
      const sessionId = await ctx.teamTasks.participantSession?.(teamId, participantId, signal)
      if (sessionId === undefined) throw new Error(`Participant '${participantId}' has no Session descendant`)
      return sessionId
    })
  }

  const refreshInbox = ctx.teamTasks.refreshInbox?.bind(ctx.teamTasks)
  const recoverInbox = ctx.teamTasks.recoverInbox?.bind(ctx.teamTasks)
  const loadMoreInbox = ctx.teamTasks.loadMoreInbox?.bind(ctx.teamTasks)
  const watchInbox = ctx.teamTasks.watchInbox?.bind(ctx.teamTasks)
  const acknowledgeInbox = ctx.teamTasks.acknowledgeInbox?.bind(ctx.teamTasks)
  const readAction = ctx.teamTasks.readAction?.bind(ctx.teamTasks)
  const respondAction = ctx.teamTasks.respondAction?.bind(ctx.teamTasks)
  const openActionContext: TeamInboxControls['openActionContext'] = async (action) => {
    if (inspect === undefined) throw new Error('Read-only Team inspection is unavailable')
    cancelRestoration()
    ctx.sessions.clear()
    await inspection.open(action.teamId, async (signal) => { await inspect(action.teamId, signal); return action.sessionId })
  }
  const inboxControls: Partial<TeamInboxControls> = refreshInbox === undefined || loadMoreInbox === undefined || watchInbox === undefined
    || acknowledgeInbox === undefined || readAction === undefined || respondAction === undefined || inspect === undefined
    ? {} : { recoverInbox, refreshInbox, loadMoreInbox, watchInbox, acknowledgeInbox, readAction, respondAction, openActionContext }
  const manageTeam = ctx.teamTasks.manage === undefined ? undefined : async (
    teamId: TeamId, command: Parameters<NonNullable<TeamBrowserInjected['manageTeam']>>[1], signal?: AbortSignal,
  ): Promise<void> => { await ctx.teamTasks.manage?.(teamId, command, signal) }
  const readAudit = async (teamId: TeamId, options: Parameters<NonNullable<TeamBrowserInjected['readAudit']>>[1], signal?: AbortSignal) =>
    await ctx.teamTasks.readAudit?.(teamId, options, signal) ?? { teamId, items: [] }
  const readChannel = async (channelId: Parameters<NonNullable<TeamBrowserInjected['readChannel']>>[0], afterCursor?: number, signal?: AbortSignal) => {
    const channel = await ctx.teamTasks.readChannel?.(channelId, afterCursor, signal)
    if (channel === undefined) throw new Error(`Channel '${channelId}' cannot be read`)
    return channel
  }
  const acknowledgeChannel = ctx.teamTasks.acknowledgeChannel === undefined ? undefined
    : async (channelId: Parameters<NonNullable<TeamBrowserInjected['acknowledgeChannel']>>[0]) => { await ctx.teamTasks.acknowledgeChannel?.(channelId) }
  const closeChannelView = () => { ctx.teamTasks.closeChannelView?.() }
  const readChannels = ctx.teamTasks.readChannels === undefined ? undefined
    : async (teamId: TeamId, mode?: 'refresh' | 'next' | 'first') => { await ctx.teamTasks.readChannels?.(teamId, mode) }
  const attachmentReader = ctx.teamTasks.readChannelAttachment?.bind(ctx.teamTasks)
  const readChannelAttachment = attachmentReader === undefined ? undefined
    : async (input: Parameters<NonNullable<TeamBrowserInjected['readChannelAttachment']>>[0], signal?: AbortSignal) =>
      await attachmentReader(input, signal)
  const readChannelCatalog = ctx.teamTasks.readChannelCatalog === undefined ? undefined
    : async () => { await ctx.teamTasks.readChannelCatalog?.() }
  const readArtifact = async (teamId: TeamId, artifactId: string, signal?: AbortSignal) => {
    if (ctx.teamTasks.readArtifact === undefined) throw new Error(`Artifact '${artifactId}' cannot be read`)
    await ctx.teamTasks.readArtifact(teamId, artifactId, signal)
  }
  ctx.effect(() => () => { ctx.teamTasks.closeArtifactDetail?.() }, 'ui-team: artifact viewing lifetime')
  const readTaskDetail: TeamBrowserInjected['readTaskDetail'] = ctx.teamTasks.readTaskDetail === undefined ? undefined
    : async (teamId, taskId, section, mode) => { await ctx.teamTasks.readTaskDetail?.(teamId, taskId, section, mode) }
  const closeTaskDetail = () => { ctx.teamTasks.closeTaskDetail?.() }
  const identityWatcher = ctx.teamTasks.watchIdentities?.bind(ctx.teamTasks)
  const watchIdentities: TeamBrowserInjected['watchIdentities'] = identityWatcher === undefined ? undefined
    : (teamId, ids) => identityWatcher(teamId, ids, { refreshMs: limits.identityRefreshMs,
      capacity: limits.identityCacheCapacity, batchSize: limits.identityBatchSize })
  const refreshIdentities = async (): Promise<void> => { await ctx.teamTasks.refreshIdentities?.() }
  const executionProfileWatcher = ctx.teamTasks.watchExecutionProfiles?.bind(ctx.teamTasks)
  const watchExecutionProfiles: TeamBrowserInjected['watchExecutionProfiles'] = executionProfileWatcher === undefined ? undefined
    : input => executionProfileWatcher(input, limits.capabilityRefreshMs)
  const refreshExecutionProfiles = async (): Promise<void> => { await ctx.teamTasks.refreshExecutionProfiles?.() }
  const memberReadinessWatcher = ctx.teamTasks.watchMemberReadiness?.bind(ctx.teamTasks)
  const watchMemberReadiness: TeamBrowserInjected['watchMemberReadiness'] = memberReadinessWatcher === undefined ? undefined
    : input => memberReadinessWatcher(input, limits.readinessRefreshMs)
  const refreshMemberReadiness = ctx.teamTasks.refreshMemberReadiness?.bind(ctx.teamTasks)
  const taskCapabilityWatcher = ctx.teamTasks.watchTaskCapabilities?.bind(ctx.teamTasks)
  const watchTaskCapabilities: TeamBrowserInjected['watchTaskCapabilities'] = taskCapabilityWatcher === undefined ? undefined
    : input => taskCapabilityWatcher(input, limits.capabilityRefreshMs)
  const refreshTaskCapabilities = ctx.teamTasks.refreshTaskCapabilities?.bind(ctx.teamTasks)
  const attentionWatcher = ctx.teamTasks.watchAttention?.bind(ctx.teamTasks)
  const watchAttention: TeamBrowserInjected['watchAttention'] = attentionWatcher === undefined ? undefined
    : teamId => attentionWatcher(teamId, { limit: limits.attentionPreviewLimit,
      refreshMs: limits.attentionRefreshMs })
  const readAttention: TeamBrowserInjected['readAttention'] = ctx.teamTasks.readAttention === undefined ? undefined
    : async (teamId, mode) => { await ctx.teamTasks.readAttention?.(teamId, limits.attentionPageLimit, mode) }
  const refreshAttentionPreview: TeamBrowserInjected['refreshAttentionPreview'] = ctx.teamTasks.refreshAttentionPreview === undefined ? undefined
    : async (teamId) => { if (ctx.teamTasks.list.getSnapshot().current === teamId) await ctx.teamTasks.refreshAttentionPreview?.() }
  const pauseAttention = ctx.teamTasks.pauseAttention?.bind(ctx.teamTasks)
  const inspectAction = ctx.teamTasks.inspectAction?.bind(ctx.teamTasks)
  const closeActionDetail = ctx.teamTasks.closeActionDetail?.bind(ctx.teamTasks)
  const openPendingAction: TeamBrowserInjected['openPendingAction'] = inspectAction === undefined ? undefined
    : async (teamId, id) => { await inspectAction(teamId, id) }
  const readTaskQuery = ctx.teamTasks.readTaskQuery?.bind(ctx.teamTasks)
  const pauseTaskQuery = ctx.teamTasks.pauseTaskQuery?.bind(ctx.teamTasks)
  const lookupTaskUpdate = ctx.teamTasks.lookupTaskUpdate?.bind(ctx.teamTasks)
  const taskReferenceWatcher = ctx.teamTasks.watchTaskReferences?.bind(ctx.teamTasks)
  const watchTaskReferences: TeamBrowserInjected['watchTaskReferences'] = taskReferenceWatcher === undefined ? undefined
    : (teamId, ids) => taskReferenceWatcher(teamId, ids, { capacity: limits.taskReferenceCapacity,
      batchSize: limits.taskReferenceBatchSize, refreshMs: limits.taskReferenceRefreshMs })
  const refreshTaskReferences = ctx.teamTasks.refreshTaskReferences?.bind(ctx.teamTasks)
  const readDependencies = ctx.teamTasks.readDependencies?.bind(ctx.teamTasks)
  const closeDependencies = ctx.teamTasks.closeDependencies?.bind(ctx.teamTasks)
  const readCollections = ctx.teamTasks.readCollections === undefined ? undefined
    : async (teamId: TeamId, collection: Parameters<NonNullable<TeamBrowserInjected['readCollections']>>[1], mode?: 'refresh' | 'next' | 'first', signal?: AbortSignal) => {
      await ctx.teamTasks.readCollections?.(teamId, collection, mode, signal)
    }
  const deleteTask = ctx.teamTasks.deleteTask === undefined ? undefined : async (
    teamId: TeamId,
    taskId: TeamTaskId,
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<void> => {
    await ctx.teamTasks.deleteTask?.(teamId, taskId, expectedRevision, signal)
  }
  const cancelTask = ctx.teamTasks.cancelTask === undefined ? undefined : async (
    teamId: TeamId,
    taskId: TeamTaskId,
    expectedRevision: number,
    reason?: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    await ctx.teamTasks.cancelTask?.(teamId, taskId, expectedRevision, reason, signal)
  }
  const tt = ctx.locale.bind(NS)
  ctx.effect(() => ctx.layout.registerCommands({
    id: 'team.actions',
    label: () => tt('palette.actions'),
    items: () => [{
      id: 'new',
      label: tt('palette.newTeam'),
      run: () => {
        ctx.layout.showWorkspace('team')
        if (draftControls.startDraft !== undefined) draftControls.startDraft()
        else { cancelRestoration(); inspection.cancel(); ctx.sessions.clear() }
      },
    }],
  }), 'ui-team: palette actions')
  ctx.effect(() => ctx.layout.registerCommands({
    id: 'team.teams',
    label: () => tt('palette.teams'),
    // Loaded Team summaries only; the palette never pages the directory itself.
    items: () => ctx.teamTasks.list.getSnapshot().items.map(team => ({
      id: team.id,
      label: deriveShortTitle(team.goal.objective),
      hint: `${tt(teamPhaseKey[team.phase])}${team.workspacePath === undefined ? '' : ` · ${team.workspacePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? ''}`}`,
      keywords: [team.goal.objective],
      run: () => { void openTeam(team.id).catch((reason: unknown) => { ctx.logger.warn('ui-team: palette Team open failed', reason) }) },
    })),
  }), 'ui-team: palette Teams')
  ctx.effect(() => ctx.layout.registerCommands({
    id: 'team.members',
    label: () => tt('palette.members'),
    // The selected Team's loaded member page plus its coordinator; opening one inspects its Session.
    items: () => {
      const { current, selected, collections } = ctx.teamTasks.list.getSnapshot()
      if (current === undefined || selected?.teamId !== current) return []
      const page = collections?.teamId === current ? collections.members.items : []
      return memberLabels(selected.state, memberPageLabels(page)).map(member => ({
        id: member.id,
        label: member.displayName,
        hint: member.role,
        keywords: [member.role],
        run: () => {
          void openParticipantSession(current, member.id).catch((reason: unknown) => {
            ctx.logger.warn('ui-team: palette member Session open failed', reason)
          })
        },
      }))
    },
  }), 'ui-team: palette members')
  ctx.slots.inject('sidebar.workspaceNavigation', () => ctx.slots.register({
    name: 'sidebar.workspaceNavigation', id: 'team', order: -100, locale: NS,
    inject: () => ({ open: () => { ctx.layout.showWorkspace('team') } }),
  }, WorkspaceNavigation))
  ctx.slots.inject('conversation.hero.modes', () => ctx.slots.register({
    name: 'conversation.hero.modes', id: 'team', order: -100, locale: NS,
    inject: () => ({
      open: (teamId?: TeamId) => {
        if (teamId === undefined) ctx.layout.showWorkspace('team')
        else void openTeam(teamId).catch((error: unknown) => { ctx.logger.warn('ui-team: recent Team open failed', error) })
      },
      hooks: { tasks: ctx.teamTasks.list },
    }),
  }, TeamModeCard))
  const inspectionControls = {
    readMemberDetail: ctx.teamTasks.readMemberDetail?.bind(ctx.teamTasks),
    closeMemberDetail: ctx.teamTasks.closeMemberDetail?.bind(ctx.teamTasks),
    readWorkflowDetail: ctx.teamTasks.readWorkflowDetail?.bind(ctx.teamTasks),
    closeWorkflowDetail: ctx.teamTasks.closeWorkflowDetail?.bind(ctx.teamTasks),
    openParticipantSession,
    readAudit,
    ...manageTeam === undefined ? {} : { manageTeam },
    readChannel,
    ...acknowledgeChannel === undefined ? {} : { acknowledgeChannel },
    closeChannelView,
    ...readChannels === undefined ? {} : { readChannels },
    ...readChannelAttachment === undefined ? {} : { readChannelAttachment },
    ...readChannelCatalog === undefined ? {} : { readChannelCatalog },
    readArtifact,
    ...readCollections === undefined ? {} : { readCollections },
    ...readTaskDetail === undefined ? {} : { readTaskDetail, closeTaskDetail },
    watchAttention, readAttention, refreshAttentionPreview, pauseAttention, openPendingAction, inspectAction, closeActionDetail,
    readTaskQuery, pauseTaskQuery, readDependencies, closeDependencies, watchTaskReferences, refreshTaskReferences, lookupTaskUpdate,
    watchIdentities, refreshIdentities,
    watchExecutionProfiles, refreshExecutionProfiles,
    watchTaskCapabilities, refreshTaskCapabilities, watchMemberReadiness, refreshMemberReadiness,
    ...deleteTask === undefined ? {} : { deleteTask },
    ...cancelTask === undefined ? {} : { cancelTask },
  }
  ctx.slots.inject('sidebar.teamTasks', () => ctx.slots.register({
    name: 'sidebar.teamTasks',
    locale: NS,
    inject: (): TeamBrowserInjected => ({
      openTeam,
      ...inboxControls,
      firstTeamPage: async () => { await ctx.teamTasks.refresh(true) },
      ...ctx.teamTasks.loadMore === undefined ? {} : { loadMoreTeams: async () => { await ctx.teamTasks.loadMore?.() } },
      archiveTeam,
      cancelTeam,
      resumeTeam,
      ...inspectionControls,
      ...draftControls,
      hooks: { tasks: ctx.teamTasks.list },
    }),
  }, TeamBrowser))
  ctx.slots.inject('team.workspace', () => ctx.slots.register({
    name: 'team.workspace',
    store: workspaceStore,
    children: { 'team.channel.message': { kind: 'single', scope: 'root' } },
    locale: NS,
    inject: (actions: BoundActions<ReturnType<typeof createTeamWorkspaceStore>>) => ({
      hooks: { hostDescription: connection.hostDescription },
      maxDraftBytes: limits.maxDraftBytes,
      navigateApplication: (href: string) => { ctx.layout.navigate(href) },
      restoreNavigation: async (route: WorkspaceRoute | undefined, externalSignal: AbortSignal) => {
        cancelRestoration()
        const request = new AbortController()
        navigationRequest = request
        const signal = AbortSignal.any([externalSignal, request.signal])
        const cancelInspection = () => { inspection.cancel() }
        signal.addEventListener('abort', cancelInspection, { once: true })
        try {
          signal.throwIfAborted()
          if (route === undefined) {
            inspection.cancel()
            ctx.sessions.clear()
            if (ctx.teamTasks.list.getSnapshot().current !== undefined) ctx.teamTasks.startDraft()
            return
          }
          if (inspect === undefined) throw new Error('Read-only Team inspection is unavailable')
          // A rejected exact target must leave its navigation error reachable instead of retaining an older modal Session.
          inspection.cancel()
          ctx.sessions.clear()
          // History/source restoration revalidates the target even when an older selection is retained.
          const selected = await inspect(route.teamId, signal)
          signal.throwIfAborted()
          if (route.actionId !== undefined) {
            const current = await inspectAction?.(route.teamId, route.actionId)
            signal.throwIfAborted()
            if (current === undefined) throw new WorkspaceNavigationError('missing', 'This request is not available in the selected Team')
          }
          if (route.taskForm !== undefined && 'taskId' in route.taskForm) {
            await readTaskDetail?.(route.teamId, route.taskForm.taskId)
            signal.throwIfAborted()
            const detail = ctx.teamTasks.list.getSnapshot().taskDetail
            if (detail?.taskId !== route.taskForm.taskId || detail.record.value === undefined || detail.record.error !== undefined) {
              throw new WorkspaceNavigationError('missing', 'This task form is not available in the selected Team')
            }
          }
          if (route.taskId !== undefined) {
            await readTaskDetail?.(route.teamId, route.taskId)
            signal.throwIfAborted()
            const detail = ctx.teamTasks.list.getSnapshot().taskDetail
            if (detail?.taskId !== route.taskId || detail.record.value?.task.phase === 'deleted' || detail.record.error !== undefined) {
              throw new WorkspaceNavigationError('missing', 'This task is not available in the selected Team')
            }
          }
          if (route.sessionId !== undefined && (route.participantId !== undefined || route.sessionId !== selected.coordinatorSessionId)) {
            if (route.participantId === undefined || ctx.teamTasks.participantSession === undefined) {
              throw new WorkspaceNavigationError('binding', 'A member identity is required to restore this Session. Open it from the member list.')
            }
            const resolved = await ctx.teamTasks.participantSession(route.teamId, route.participantId, signal)
            if (resolved !== route.sessionId) throw new WorkspaceNavigationError('binding', 'This Session does not belong to the selected member')
          }
          if (ctx.teamTasks.list.getSnapshot().current !== route.teamId) return
          actions.update(route.teamId, { view: route.view, taskForm: route.taskForm, ...(route.view === 'overview' ? { overviewViz: route.viz ?? 'topology' } : {}), actionId: route.actionId, ...(route.view === 'workflows' ? { workflowPlanId: route.planId } : {}), ...(route.view === 'tasks' ? { taskId: route.taskId, taskSearch: route.search, taskPhase: route.phase } : {}) })
          if (route.sessionId === undefined) ctx.sessions.clear()
          if (route.view === 'channels' && route.channelId !== undefined && ctx.teamTasks.list.getSnapshot().channel?.channelId !== route.channelId) await readChannel(route.channelId, -1, signal)
          signal.throwIfAborted()
          const sessionId = route.sessionId
          if (sessionId !== undefined &&
             ctx.sessions.list.getSnapshot().current !== sessionId) await inspection.open(route.teamId,
            () => Promise.resolve(sessionId))
        } catch (error: unknown) {
          if (!signal.aborted) throw error
        } finally {
          signal.removeEventListener('abort', cancelInspection)
          if (navigationRequest === request) navigationRequest = undefined
        }
      },
      openCoordinator: async () => {
        cancelRestoration()
        const selection = ctx.teamTasks.list.getSnapshot().selected
        if (selection === undefined) return
        const sessionId = selection.coordinatorSessionId
        if (sessionId === undefined) throw new Error('This Team has no bound coordinator Session; inspect a member Session instead')
        await inspection.open(selection.teamId, () => Promise.resolve(sessionId))
      },
      cancelTeam,
      resumeTeam,
      openTeam,
      ...inspectionControls,
      ...respondAction === undefined ? {} : { respondAction, openActionContext },
    }),
  }, TeamWorkspace))
}
