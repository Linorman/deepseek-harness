/** Registers the Team task browser in the sidebar shell. */

import type { ClientContext, TeamId, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type {} from '@clocky/clocky-client-locale/client'
import type {} from '@clocky/clocky-client-ui-sidebar/client'
import type { TeamInboxControls } from './TeamInboxDialog.tsx'
import type { TeamBrowserInjected } from './TeamBrowser.tsx'
import { TeamBrowser } from './TeamBrowser.tsx'
import { TeamDetailOverlay } from './TeamDetailOverlay.tsx'
import type { TeamChannelMessageOwnerProps } from './channel-message-types.ts'
export type { TeamChannelMessageOwnerProps, TeamChannelMessageProps } from './channel-message-types.ts'
export { TeamPage } from './TeamPage.tsx'
export type { TeamPageProps } from './TeamPage.tsx'
import { en, zh, type TeamKey } from './locales.ts'

export type { TeamBrowserInjected, TeamBrowserProps } from './TeamBrowser.tsx'
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
export const inject = ['slots', 'sessions', 'teamTasks', 'locale']

/** Mount the sidebar Team browser.
 * @param ctx - Client root context.
 * @returns nothing; registrations live on the caller fiber.
 */
export function apply(ctx: ClientContext): void {
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
        ctx.teamTasks.startDraft(options)
        ctx.sessions.clear()
      },
    }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-team: dictionaries')
  const stopLiveUpdates = ctx.teamTasks.watch?.()
  ctx.effect(() => () => { stopLiveUpdates?.() }, 'ui-team: live Team updates')

  const openTeam = async (teamId: TeamId) => {
    const selection = await ctx.teamTasks.open(teamId)
    await ctx.sessions.refresh()
    ctx.sessions.open(selection.coordinatorSessionId)
    return selection
  }
  const archiveTeam = async (teamId: TeamId): Promise<void> => {
    await ctx.teamTasks.archive(teamId)
  }
  const cancelTeam = async (teamId: TeamId) => await ctx.teamTasks.cancel(teamId)
  const resumeTeam = async (teamId: TeamId) => {
    const selection = await ctx.teamTasks.resume(teamId)
    await ctx.sessions.refresh()
    ctx.sessions.open(selection.coordinatorSessionId)
    return selection
  }
  const openParticipantSession = async (teamId: TeamId, participantId: Parameters<NonNullable<TeamBrowserInjected['openParticipantSession']>>[1]): Promise<void> => {
    const sessionId = await ctx.teamTasks.participantSession?.(teamId, participantId)
    if (sessionId === undefined) throw new Error(`Participant '${participantId}' has no Session descendant`)
    await ctx.sessions.refresh()
    ctx.sessions.open(sessionId)
  }
  const refreshInbox = ctx.teamTasks.refreshInbox?.bind(ctx.teamTasks)
  const loadMoreInbox = ctx.teamTasks.loadMoreInbox?.bind(ctx.teamTasks)
  const watchInbox = ctx.teamTasks.watchInbox?.bind(ctx.teamTasks)
  const acknowledgeInbox = ctx.teamTasks.acknowledgeInbox?.bind(ctx.teamTasks)
  const readAction = ctx.teamTasks.readAction?.bind(ctx.teamTasks)
  const respondAction = ctx.teamTasks.respondAction?.bind(ctx.teamTasks)
  const inspect = ctx.teamTasks.inspect?.bind(ctx.teamTasks)
  const openActionContext: TeamInboxControls['openActionContext'] = async (action) => {
    if (inspect === undefined) throw new Error('Read-only Team inspection is unavailable')
    await inspect(action.teamId)
    await ctx.sessions.refresh()
    ctx.sessions.open(action.sessionId)
  }
  const inboxControls: Partial<TeamInboxControls> = refreshInbox === undefined || loadMoreInbox === undefined || watchInbox === undefined
    || acknowledgeInbox === undefined || readAction === undefined || respondAction === undefined || inspect === undefined
    ? {} : { refreshInbox, loadMoreInbox, watchInbox, acknowledgeInbox, readAction, respondAction, openActionContext }
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
    : async (teamId: TeamId, more?: boolean) => { await ctx.teamTasks.readChannels?.(teamId, more) }
  const readChannelAttachment = ctx.teamTasks.readChannelAttachment === undefined ? undefined
    : async (input: Parameters<NonNullable<TeamBrowserInjected['readChannelAttachment']>>[0], signal?: AbortSignal) => {
      const result = await ctx.teamTasks.readChannelAttachment?.(input, signal)
      if (result === undefined) throw new Error('Channel image reader is unavailable')
      return result
    }
  const readChannelCatalog = ctx.teamTasks.readChannelCatalog === undefined ? undefined
    : async () => { await ctx.teamTasks.readChannelCatalog?.() }
  const readArtifact = async (teamId: TeamId, artifactId: string, signal?: AbortSignal) => {
    const artifact = await ctx.teamTasks.readArtifact?.(teamId, artifactId, signal)
    if (artifact === undefined) throw new Error(`Artifact '${artifactId}' cannot be read`)
    return artifact
  }
  const readCollections = ctx.teamTasks.readCollections === undefined ? undefined
    : async (teamId: TeamId, collection: Parameters<NonNullable<TeamBrowserInjected['readCollections']>>[1], more?: boolean, signal?: AbortSignal) => {
      await ctx.teamTasks.readCollections?.(teamId, collection, more, signal)
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
  ctx.slots.inject('sidebar.teamTasks', () => ctx.slots.register({
    name: 'sidebar.teamTasks',
    locale: NS,
    inject: (): TeamBrowserInjected => ({
      openTeam,
      ...inboxControls,
      ...ctx.teamTasks.loadMore === undefined ? {} : { loadMoreTeams: async () => { await ctx.teamTasks.loadMore?.() } },
      archiveTeam,
      cancelTeam,
      resumeTeam,
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
      ...deleteTask === undefined ? {} : { deleteTask },
      ...cancelTask === undefined ? {} : { cancelTask },
      ...draftControls,
      hooks: { tasks: ctx.teamTasks.list },
    }),
  }, TeamBrowser))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    children: { 'team.channel.message': { kind: 'single', scope: 'root' } },
    id: 'team-detail',
    order: 100,
    locale: NS,
    inject: () => ({
      cancelTeam,
      resumeTeam,
      openTeam,
      openParticipantSession,
      readAudit,
      ...manageTeam === undefined ? {} : { manageTeam },
      ...respondAction === undefined ? {} : { respondAction, openActionContext },
      readChannel,
      ...acknowledgeChannel === undefined ? {} : { acknowledgeChannel },
      closeChannelView,
      ...readChannels === undefined ? {} : { readChannels },
      ...readChannelAttachment === undefined ? {} : { readChannelAttachment },
      ...readChannelCatalog === undefined ? {} : { readChannelCatalog },
      readArtifact,
      ...readCollections === undefined ? {} : { readCollections },
      ...deleteTask === undefined ? {} : { deleteTask },
      ...cancelTask === undefined ? {} : { cancelTask },
    }),
  }, TeamDetailOverlay))
}
