import { WorkspaceNavigationError } from './navigation-error.ts'
/** Shareable Team view parameters; Host authorization still owns every referenced object. */
import type { ChannelId, ParticipantId, SessionId, TeamId, TeamTaskId } from '@clocky/clocky-client-runtime/client'
import type { TeamTaskDialogTarget } from './task-draft.ts'
import type { TeamOverviewViz, TeamViewState, TeamWorkspaceView } from './workspace-store.ts'
import { TEAM_ROUTE_KEYS } from '@clocky/clocky-client-ui-layout/client'

/** JSON-only navigation state, excluding drafts and authorization material. */
export interface WorkspaceRoute {
  readonly teamId: TeamId
  readonly view: TeamWorkspaceView
  readonly planId?: import('@clocky/clocky-client-runtime/client').TeamWorkflowSummary['id'] | undefined
  readonly actionId?: TeamViewState['actionId']
  readonly taskForm?: TeamTaskDialogTarget | undefined
  readonly taskId?: TeamTaskId | undefined
  readonly channelId?: ChannelId | undefined
  readonly sessionId?: SessionId | undefined
  readonly participantId?: ParticipantId | undefined
  readonly search: string
  readonly phase: TeamViewState['taskPhase']
  /** Overview visualization; absent means the default topology. */
  readonly viz?: TeamOverviewViz | undefined
}

const views: readonly string[] = ['overview', 'tasks', 'channels', 'members', 'artifacts', 'workflows', 'audit', 'attention']
const vizModes: readonly string[] = ['topology', 'flow', 'lanes', 'list']
const phases: readonly string[] = ['all', 'pending', 'assigned', 'running', 'review', 'completed', 'failed', 'cancelled']

/**
 * Parse an external view URL without accepting an unknown module or task-state filter.
 * @param href - absolute browser URL.
 * @returns a route, or undefined for the first-input page.
 */
export function readWorkspaceRoute(href: string): WorkspaceRoute | undefined {
  const query = new URL(href).searchParams
  const team = query.get('team')
  if (team === null) return undefined
  if (team.length === 0) throw new WorkspaceNavigationError('invalid', 'A Team identifier is required')
  const view = query.get('view') ?? 'overview'
  const phase = query.get('status') ?? 'all'
  if (!views.includes(view) || !phases.includes(phase)) throw new WorkspaceNavigationError('invalid', 'This workspace view is not available')
  const viz = query.get('viz')
  if (viz !== null && !vizModes.includes(viz)) throw new WorkspaceNavigationError('invalid', 'This visualization is not available')
  const form = query.get('form')
  const formTask = query.get('formTask')
  let taskForm: TeamTaskDialogTarget | undefined
  switch (form) {
    case null: break
    case 'taskCreate':
      if (formTask !== null) throw new WorkspaceNavigationError('invalid', 'A new task form has no existing task identity')
      taskForm = { kind: form }; break
    case 'taskUpdate': case 'taskReview': case 'taskIntegrate':
      if (formTask === null || formTask === '') throw new WorkspaceNavigationError('invalid', 'This task form requires a task identity')
      taskForm = { kind: form, taskId: formTask as TeamTaskId }; break
    default: throw new WorkspaceNavigationError('invalid', 'This task form is not available')
  }
  // URL identifiers are opaque strings; their membership and visibility are checked against the Host projection.
  return { teamId: team as TeamId, view: view as TeamWorkspaceView, phase: phase as TeamViewState['taskPhase'],
    taskForm,
    actionId: (query.get('action') || undefined) as TeamViewState['actionId'],
    planId: (query.get('plan') || undefined) as WorkspaceRoute['planId'],
    taskId: (query.get('task') || undefined) as TeamTaskId | undefined,
    channelId: (query.get('channel') || undefined) as ChannelId | undefined,
    sessionId: (query.get('session') || undefined) as SessionId | undefined,
    participantId: (query.get('participant') || undefined) as ParticipantId | undefined,
    search: query.get('q') ?? '',
    ...viz === null ? {} : { viz: viz as TeamOverviewViz },
  }
}

/**
 * Replace only workspace-owned parameters and preserve unrelated application URL settings.
 * @param href - current absolute URL.
 * @param route - selected Team view, or undefined for the first-input page.
 * @returns the normalized absolute URL.
 */
export function workspaceRouteUrl(href: string, route: WorkspaceRoute | undefined): string {
  const url = new URL(href)
  for (const key of TEAM_ROUTE_KEYS) url.searchParams.delete(key)
  if (route !== undefined) {
    url.searchParams.set('team', route.teamId)
    url.searchParams.set('view', route.view)
    if (route.viz !== undefined && route.viz !== 'topology') url.searchParams.set('viz', route.viz)
    if (route.taskForm !== undefined) {
      url.searchParams.set('form', route.taskForm.kind)
      if ('taskId' in route.taskForm) url.searchParams.set('formTask', route.taskForm.taskId)
    }
    if (route.actionId !== undefined) url.searchParams.set('action', route.actionId)
    if (route.planId !== undefined) url.searchParams.set('plan', route.planId)
    if (route.taskId !== undefined) url.searchParams.set('task', route.taskId)
    if (route.channelId !== undefined) url.searchParams.set('channel', route.channelId)
    if (route.sessionId !== undefined) url.searchParams.set('session', route.sessionId)
    if (route.participantId !== undefined) url.searchParams.set('participant', route.participantId)
    if (route.search !== '') url.searchParams.set('q', route.search)
    if (route.phase !== 'all') url.searchParams.set('status', route.phase)
  }
  return url.href
}

/**
 * Identify navigation changes independently of live search/filter edits.
 * @param route - the current route.
 * @returns the fields that create a browser Back entry rather than replacing the current entry.
 */
export function workspaceRouteIdentity(route: WorkspaceRoute | undefined): string {
  return route === undefined ? '' : JSON.stringify([route.teamId, route.view, route.taskForm, route.actionId, route.planId, route.taskId, route.channelId, route.sessionId, route.participantId])
}
