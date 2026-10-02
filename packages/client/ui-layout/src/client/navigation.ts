/** Shared URL navigation changes viewing state only; each workspace authorizes its own references. */
import type { TeamId, TeamTaskId, ParticipantId, SessionId, ChannelId } from '@clocky/clocky-client-runtime/client'

/** Same-document navigation notification consumed by workspace route owners. */
export const WORKSPACE_NAVIGATION_EVENT = 'clocky:workspace-navigation'
/** Team-owned URL fields, including forms which an inspection link must never inherit. */
export const TEAM_ROUTE_KEYS = ['team', 'view', 'task', 'plan', 'action', 'form', 'formTask', 'channel', 'session', 'participant', 'q', 'status'] as const
/** Simulation-owned viewing fields; no command identity or private draft is included. */
export const SIMULATION_ROUTE_KEYS = ['simulation', 'simulationModule', 'simulationObject', 'simulationSearch', 'simulationStatus',
  'simulationCognition', 'simulationEntity', 'simulationDecision', 'simulationRecordKind', 'simulationSequence',
  'simulationSource', 'simulationSection', 'simulationKnowledge', 'simulationKnowledgeRevision'] as const

/**
 * Read a single bounded source route from browser history without trusting its contents.
 * @param state - Browser-owned history payload, which can also originate outside the application.
 * @param href - Current application URL supplying the allowed origin and document path.
 * @returns a same-document source containing only workspace-owned view parameters, or undefined.
 */
export function readWorkspaceSource(state: unknown, href: string): string | undefined {
  if (state === null || typeof state !== 'object' || !('clockyWorkspaceSource' in state)
    || !('clockyWorkspaceTarget' in state) || typeof state.clockyWorkspaceTarget !== 'string'
    || state.clockyWorkspaceTarget === '' || state.clockyWorkspaceTarget !== new URL(href).searchParams.get('team')) return
  const source = cleanWorkspaceRoute(state.clockyWorkspaceSource, href)
  return source === cleanWorkspaceRoute(href, href) ? undefined : source
}

/**
 * Capture one return route and focus target using only supported view parameters.
 * @param href - Current source document URL.
 * @param target - Requested Team destination.
 * @returns bounded history metadata; it conveys no authorization.
 */
export function workspaceNavigationSource(href: string, target: string): Record<string, string> {
  const source = cleanWorkspaceRoute(href, href)
  const focus = cleanWorkspaceRoute(target, href)
  const team = new URL(target, href).searchParams.get('team')
  return source === undefined || focus === undefined || team === null ? {} : {
    clockyWorkspaceSource: source, clockyWorkspaceTarget: team, clockyWorkspaceFocus: focus,
  }
}

/**
 * Restore a source control only after the destination owner has revalidated and rendered its content.
 * @param root - Authorized source surface, never a cached detached subtree.
 * @returns whether a matching return marker was consumed and focus restored.
 */
export function restoreWorkspaceFocus(root: HTMLElement): boolean {
  if (root.closest('[hidden]') !== null) return false
  const state: unknown = window.history.state
  if (state === null || typeof state !== 'object' || !('clockyReturnDestination' in state) || !('clockyReturnFocus' in state)) return false
  const current = cleanWorkspaceRoute(window.location.href, window.location.href)
  if (cleanWorkspaceRoute(state.clockyReturnDestination, window.location.href) !== current) return false
  const target = cleanWorkspaceRoute(state.clockyReturnFocus, window.location.href)
  if (target === undefined) return false
  const anchor = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .find(link => cleanWorkspaceRoute(link.href, window.location.href) === target)
  const heading = root.querySelector<HTMLElement>('h1,h2,h3')
  const focus = anchor ?? heading
  if (focus === null) return false
  if (anchor === undefined) focus.tabIndex = -1
  focus.focus()
  const { clockyReturnDestination: _destination, clockyReturnFocus: _focus, ...retained } = state
  window.history.replaceState(retained, '', window.location.href)
  return true
}

function cleanWorkspaceRoute(value: unknown, href: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return
  let source: URL
  try { source = new URL(value, href) }
  catch { return } // Malformed external history cannot supply an application return route.
  const current = new URL(href)
  if (source.origin !== current.origin || source.pathname !== current.pathname) return
  const clean = new URL(current.pathname, current.origin)
  const allowed = new Set<string>([...TEAM_ROUTE_KEYS, ...SIMULATION_ROUTE_KEYS, 'workspace'])
  for (const [key, selected] of source.searchParams) {
    if (allowed.has(key) && !clean.searchParams.has(key)) clean.searchParams.set(key, selected)
  }
  return clean.href
}

/** Exact read target; historical Sessions never resolve to an unspecified current binding. */
export type TeamInspectionTarget = { readonly teamId: TeamId } & (
  | { readonly kind: 'team' }
  | { readonly kind: 'task'; readonly taskId: TeamTaskId }
  | { readonly kind: 'channel'; readonly channelId: ChannelId }
  | { readonly kind: 'session'; readonly sessionId: SessionId; readonly participantId: ParticipantId })

/**
 * Construct an exact Team inspection link without carrying unrelated task forms or filters.
 * @param href - Current absolute application URL.
 * @param target - Authorized metadata reference; the destination rechecks content access.
 * @returns shareable URL containing no new execution request.
 */
export function teamInspectionUrl(href: string, target: TeamInspectionTarget): string {
  const url = new URL(href)
  for (const key of [...TEAM_ROUTE_KEYS, ...SIMULATION_ROUTE_KEYS, 'workspace']) url.searchParams.delete(key)
  url.searchParams.set('team', target.teamId)
  url.searchParams.set('view', target.kind === 'task' ? 'tasks' : target.kind === 'channel' ? 'channels' : target.kind === 'session' ? 'members' : 'overview')
  switch (target.kind) {
    case 'team': break
    case 'task': url.searchParams.set('task', target.taskId); break
    case 'channel': url.searchParams.set('channel', target.channelId); break
    case 'session':
      url.searchParams.set('session', target.sessionId)
      url.searchParams.set('participant', target.participantId)
      break
  }
  return url.href
}
