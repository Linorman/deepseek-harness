/** Bounded display-name projection reads only explicitly requested member identities. */
import { TeamError } from './error.ts'
import { teamTextSummary } from './display-text.ts'
import type { ParticipantId, ParticipantSnapshot, TeamIdentityResolveInput, TeamIdentityResolvePage, TeamResolvedIdentity } from './types.ts'

/** Resolve references under the provider's authorized Team serializer.
 * @param members - Authoritative members; never enumerated for display resolution.
 * @param cursor - Current Team journal revision.
 * @param input - Deduplicated requested IDs and optional continuation.
 * @param maxRows - Resolved deployment page allowance.
 * @param maxTextBytes - UTF-8 display-name prefix allowance.
 * @param maxBytes - Complete serialized page allowance.
 * @returns a bounded page with unknown identities indistinguishable from inaccessible ones.
 */
export function resolveTeamIdentities(members: ReadonlyMap<ParticipantId, ParticipantSnapshot>, cursor: number,
  input: TeamIdentityResolveInput, maxRows: number, maxTextBytes: number, maxBytes: number): TeamIdentityResolvePage {
  if (input.expectedTeamCursor !== undefined && input.expectedTeamCursor !== cursor) {
    throw new TeamError('Identity references changed; refresh the visible set', 'TEAM_CURSOR_CONFLICT')
  }
  const offset = input.afterCursor ?? 0
  if (offset > input.participantIds.length) throw new TeamError('Identity continuation exceeds the requested set', 'TEAM_INVALID_ARGUMENT')
  const items: TeamResolvedIdentity[] = []
  const page = (nextCursor?: number): TeamIdentityResolvePage => ({ teamId: input.teamId, teamCursor: cursor, items,
    ...nextCursor === undefined ? {} : { nextCursor } })
  const bytes = (value: TeamIdentityResolvePage) => new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (bytes(page()) > maxBytes) throw new TeamError('Identity metadata exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
  let next: number | undefined
  for (let index = offset; index < input.participantIds.length; index++) {
    if (items.length === maxRows) { next = index; break }
    const participantId = input.participantIds[index] as ParticipantId
    const member = members.get(participantId)
    items.push(member === undefined ? { participantId, state: 'unavailable' } : { participantId, state: 'resolved',
      displayName: teamTextSummary(member.displayName, maxTextBytes), phase: member.phase })
    if (bytes(page(index + 1 < input.participantIds.length ? index + 1 : undefined)) > maxBytes) {
      items.pop()
      if (items.length === 0) throw new TeamError('Identity row exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
      next = index; break
    }
  }
  return page(next)
}
