/** Authentication failures invalidate cached Team identities and private detail projections. */
import type { RpcError } from '@clocky/clocky-client-connection/client'

const authorizationErrors = new Set<RpcError['code']>([
  'PRODUCT_AUTH_INVALID', 'PRODUCT_AUTH_REQUIRED', 'TEAM_HUMAN_ACTOR_NOT_FOUND',
  'TEAM_HUMAN_ACTOR_FORBIDDEN', 'TEAM_HUMAN_ACTOR_AMBIGUOUS', 'TEAM_ACTOR_PROOF_INVALID', 'TEAM_GRANT_DENIED',
])

/** Classify explicit authentication and membership rejection separately from transient read failure.
 * @param error - Typed Host rejection, absent for an unclassified transport error.
 * @returns whether previously authorized Team data must be discarded.
 */
export function isTeamAuthorizationError(error: RpcError | undefined): boolean {
  return error !== undefined && authorizationErrors.has(error.code)
}
