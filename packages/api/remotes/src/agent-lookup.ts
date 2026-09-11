/** Host BFF policy for resolving Remote Agent and Session identities. */

import type { Context } from '@clocky/cordis'
import type { Agent, AgentOptions, AgentSetup } from '@clocky/clocky-agent'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@clocky/clocky-session'
import type {} from '@clocky/clocky-session-persistence'
import { TypertLookupFailure } from '@clocky/clocky-typert-protocol'
import type {} from '@clocky/clocky-typert-registry'

/** Caller-facing failures preserved by the Gateway's RPC adapter. */
export type ApiRemoteLookupError =
  | { readonly code: 'agent-busy'; readonly message: string; readonly details: { readonly reason: string } }
  | { readonly code: 'session-not-found'; readonly message: string; readonly details: { readonly sessionId: SessionId } }
  | { readonly code: 'team-run-unavailable'; readonly message: string; readonly details: Record<never, never> }
  | { readonly code: 'internal'; readonly message: string; readonly details: Record<never, never> }

/** Result of resolving one session identity to its live Agent. */
export type ApiRemoteAgentResult =
  | { readonly agent: Agent }
  | { readonly error: ApiRemoteLookupError }

/** Resume configuration supplied by the owning Host composition. */
export interface ApiRemoteAgentOptions {
  /** Read the per-Agent defaults when a cold identity must resume. */
  readonly agentOptions?: () => AgentOptions
  /**
   * Build the Host-specific Agent-scope composition completed before
   * publication. Keyed by the resumed session itself because what a Host
   * installs may depend on what that session recorded: an agent preset fixes
   * the tools its history was produced under, so rebuilding it under another
   * composition would replay tool calls the agent can no longer make. The
   * events come along because a session's own record of such a choice may be
   * an event rather than a header field.
   * @param session - the resumed session's persisted header and event log.
   * @returns the Agent-scope setup to run before publication.
   */
  readonly setup?: (
    session: { meta: SessionHeader; events: readonly SessionEvent[] },
  ) => AgentSetup | Promise<AgentSetup>
}

/** Cold identity absent from the durable session store. */
export class ApiRemoteSessionNotFound extends Error {}

/** Session identity whose lifecycle belongs to subagent routing. */
export class ApiRemoteSubagentSessionOwnership extends Error {
  /**
   * Construct the ownership fence.
   * @param sessionId - identity reserved to subagent routing.
   */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" is a subagent session; use subagent delivery`)
  }
}

/** Session identity whose lifecycle belongs to Team activation and product routing. */
class ApiRemoteTeamSessionOwnership extends Error {
  /**
   * Construct the ownership fence.
   * @param sessionId - identity reserved to Team operations.
   */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" is a Team participant session; use Team operations`)
  }
}

/**
 * Test whether generic Host turn, command, queue, and lifecycle routing must
 * leave an identity to Team activation and product routing. The model catalog
 * endpoints are the explicit exception: the Team coordinator route resolves
 * their live Agent directly for model selection.
 * @param session - attached or inspected Session metadata.
 * @returns whether generic Remote and legacy API calls must reject the identity.
 */
export function hasApiRemoteTeamOwner(session: Pick<Session, 'header'>): boolean {
  return session.header.teamId !== undefined
}

/**
 * Test whether generic Host routing must leave an identity to subagent routing.
 * @param ctx - Host Context carrying the live Agent registry.
 * @param session - attached or live Session metadata.
 * @param agent - live Agent when one is registered.
 * @returns whether generic Remote and legacy API calls must reject the identity.
 */
export function hasApiRemoteSubagentOwner(
  ctx: Context,
  session: Pick<Session, 'header' | 'events'> | { header: SessionHeader; events?: readonly SessionEvent[] },
  agent: Agent | undefined,
): boolean {
  const seedLength = session.header.seedLength ?? 0
  if (session.events?.some(event =>
    String(event.type) === 'subagent/descriptor' && event.seq >= seedLength) === true) return true
  const parentId = session.header.parentSession
  if (parentId === undefined || agent === undefined) return false
  const parent = ctx.agents.get(parentId)
  return parent !== undefined && ctx.agents.isOwnedBy(agent.id, parent)
}

/**
 * Build the stable caller-facing ownership rejection.
 * @param sessionId - identity reserved to subagent routing.
 * @returns the existing `agent-busy` RPC shape.
 */
export function apiRemoteSubagentOwnershipError(sessionId: SessionId): ApiRemoteLookupError {
  return {
    code: 'agent-busy',
    message: `session "${sessionId}" is owned by subagent routing`,
    details: { reason: 'use subagent delivery for this child session' },
  }
}

/**
 * Build the stable caller-facing Team ownership rejection.
 * @param sessionId - identity reserved to Team activation and product operations.
 * @returns the existing `team-run-unavailable` RPC shape.
 */
export function apiRemoteTeamOwnershipError(sessionId: SessionId): ApiRemoteLookupError {
  return {
    code: 'team-run-unavailable',
    message: `session "${sessionId}" is a Team participant session; use Team operations`,
    details: {},
  }
}

/**
 * Inspect one cold served session without repairing, resuming, or publishing it.
 * @param ctx - Host Context carrying the optional persistence provider.
 * @param sessionId - durable identity to inspect.
 * @returns detached metadata and events for a servable session.
 * @throws {@link ApiRemoteSessionNotFound} when the identity has no project-backed session.
 */
export async function inspectApiRemoteSession(
  ctx: Context,
  sessionId: SessionId,
): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new Error('session persistence is not configured (load a clocky-session-persistence backend)')
  }
  const meta = (await persistence.list()).find(candidate => candidate.id === sessionId)
  if (meta === undefined || meta.cwd === undefined) {
    throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`)
  }
  const inspected = await persistence.inspect(sessionId)
  if (inspected.meta.cwd === undefined) {
    throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`)
  }
  return { meta: inspected.meta, events: [...inspected.events] }
}

/**
 * Create the Host's shared Agent resolver and configure Agent/Session Typert lookups.
 * Live ordinary Agents are reused, ordinary cold sessions resume once per
 * identity, and Team- or subagent-owned identities stay with their owners.
 * @param ctx - owning Host Context.
 * @param options - defaults and Agent-scope setup used only for cold resume.
 * @returns resolver shared by legacy API Proxy methods and Typert lookups.
 */
export function createApiRemoteAgentResolver(
  ctx: Context,
  options: ApiRemoteAgentOptions,
): (sessionId: SessionId) => Promise<ApiRemoteAgentResult> {
  const resumes = new Map<SessionId, Promise<Agent>>()

  const fencedLiveAgent = (sessionId: SessionId): ApiRemoteAgentResult | undefined => {
    const live = ctx.agents.get(sessionId)
    if (live === undefined) return undefined
    if (hasApiRemoteTeamOwner(live.session)) {
      return { error: apiRemoteTeamOwnershipError(sessionId) }
    }
    if (hasApiRemoteSubagentOwner(ctx, live.session, live)) {
      return { error: apiRemoteSubagentOwnershipError(sessionId) }
    }
    return { agent: live }
  }

  const agentFor = async (sessionId: SessionId): Promise<ApiRemoteAgentResult> => {
    const fenced = fencedLiveAgent(sessionId)
    if (fenced !== undefined) return fenced
    const attached = ctx.sessions.get(sessionId)
    if (attached !== undefined && hasApiRemoteTeamOwner(attached)) {
      return { error: apiRemoteTeamOwnershipError(sessionId) }
    }
    if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
      return { error: apiRemoteSubagentOwnershipError(sessionId) }
    }
    let resume = resumes.get(sessionId)
    if (resume === undefined) {
      resume = (async () => {
        try {
          const inspected = await inspectApiRemoteSession(ctx, sessionId)
          if (hasApiRemoteTeamOwner({ header: inspected.meta })) {
            throw new ApiRemoteTeamSessionOwnership(sessionId)
          }
          if (hasApiRemoteSubagentOwner(ctx, { header: inspected.meta, events: inspected.events }, undefined)) {
            throw new ApiRemoteSubagentSessionOwnership(sessionId)
          }
          // Built from the inspected session before the published re-checks
          // below, so those stay adjacent to `resume` and a Host setup that
          // awaits (composing a preset, say) does not widen the collision
          // window.
          const setup = options.setup === undefined ? undefined : await options.setup(inspected)
          const publishedSession = ctx.sessions.get(sessionId)
          const publishedAgent = ctx.agents.get(sessionId)
          if (publishedSession !== undefined && hasApiRemoteTeamOwner(publishedSession)) {
            throw new ApiRemoteTeamSessionOwnership(sessionId)
          }
          if (publishedSession !== undefined
            && hasApiRemoteSubagentOwner(ctx, publishedSession, publishedAgent)) {
            throw new ApiRemoteSubagentSessionOwnership(sessionId)
          }
          const handle = await ctx.agents.resume({
            resumeSessionId: sessionId,
            ...options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions() },
            ...setup === undefined ? {} : { setup },
          })
          return handle.agent
        } finally {
          resumes.delete(sessionId)
        }
      })()
      resumes.set(sessionId, resume)
    }
    try {
      return { agent: await resume }
    } catch (error: unknown) {
      if (error instanceof ApiRemoteSessionNotFound) {
        return { error: { code: 'session-not-found', message: error.message, details: { sessionId } } }
      }
      if (error instanceof ApiRemoteTeamSessionOwnership) {
        return { error: apiRemoteTeamOwnershipError(error.sessionId) }
      }
      if (error instanceof ApiRemoteSubagentSessionOwnership) {
        return { error: apiRemoteSubagentOwnershipError(error.sessionId) }
      }
      const fenced = fencedLiveAgent(sessionId)
      if (fenced !== undefined) return fenced
      const attached = ctx.sessions.get(sessionId)
      if (attached !== undefined && hasApiRemoteTeamOwner(attached)) {
        return { error: apiRemoteTeamOwnershipError(sessionId) }
      }
      if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
        return { error: apiRemoteSubagentOwnershipError(sessionId) }
      }
      return {
        error: {
          code: 'internal',
          message: `resume failed for session "${sessionId}": ${String(error)}`,
          details: {},
        },
      }
    }
  }

  ctx.inject(['typert'], (typeCtx) => {
    const resolveAgent = async (sessionId: SessionId): Promise<Agent> => {
      const found = await agentFor(sessionId)
      if ('error' in found) throw new TypertLookupFailure(found.error)
      return found.agent
    }
    typeCtx.typert.lookups.configure('agent', resolveAgent)
    typeCtx.typert.lookups.configure('session', async sessionId => (await resolveAgent(sessionId)).session)
    typeCtx.typert.contexts.configureHost('agent', async sessionId => (await resolveAgent(sessionId)).ctx)
  })

  return agentFor
}
