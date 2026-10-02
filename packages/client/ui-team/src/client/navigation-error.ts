/** Target failures describe navigation without publishing a retained object's body as the requested destination. */
import { TeamTaskStartError } from '@clocky/clocky-client-runtime/client'

type Reason = 'invalid' | 'binding' | 'missing' | 'forbidden' | 'failed'
/** A local route/binding rejection with an explicit presentation category. */
export class WorkspaceNavigationError extends Error {
  /** @param reason - Rejected target category. @param message - Diagnostic detail, never a substitute for localized UI copy. */
  constructor(readonly reason: Reason, message: string) { super(message) }
}
/** Local UI failure state; it contains no prior Team content. */
export interface NavigationFailure {
  readonly reason: Reason
  readonly detail: string
}
/**
 * Classify a refused route without reusing another object’s content.
 * @param error - Selection failure from the route owner.
 * @returns a localized-category discriminator and separate diagnostic detail.
 */
export function describeNavigationFailure(error: unknown): NavigationFailure {
  const detail = error instanceof Error ? error.message : 'Unknown navigation failure'
  if (error instanceof WorkspaceNavigationError) return { reason: error.reason, detail }
  const code = error instanceof TeamTaskStartError ? error.rpcError?.code
    : error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
  if (code !== undefined && ['team-not-found', 'team-task-not-found', 'team-member-not-found', 'session-not-found', 'team-artifact-not-found'].includes(code)) return { reason: 'missing', detail }
  if (code !== undefined && ['PRODUCT_AUTH_INVALID', 'PRODUCT_AUTH_REQUIRED', 'TEAM_POLICY_DENIED',
    'TEAM_HUMAN_ACTOR_NOT_FOUND', 'TEAM_HUMAN_ACTOR_AMBIGUOUS', 'TEAM_HUMAN_ACTOR_FORBIDDEN', 'TEAM_GRANT_DENIED', 'TEAM_ACTOR_PROOF_INVALID'].includes(code)) {
    return { reason: 'forbidden', detail }
  }
  return { reason: 'failed', detail }
}
