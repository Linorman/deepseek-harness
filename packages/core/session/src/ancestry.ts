/** Durable Session ancestry lookup shared by authenticated transcript consumers. */
import type { SessionHeader, SessionId } from './types.ts'

/** Resolve the nearest explicit Team owner or standalone root without losing missing-parent and cycle evidence.
 * @param header - Session whose content ownership is being inspected.
 * @param live - Current in-memory header lookup, preferred over persisted metadata.
 * @param persisted - Lazy complete durable header inventory, read at most once per traversal.
 * @returns the nearest ownership header, or undefined for an unavailable or cyclic parent chain.
 */
export async function resolveSessionContentOwner(
  header: SessionHeader,
  live: (id: SessionId) => SessionHeader | undefined,
  persisted: () => Promise<readonly SessionHeader[]>,
): Promise<SessionHeader | undefined> {
  let current = header
  const seen = new Set<SessionId>()
  let durable: Map<SessionId, SessionHeader> | undefined
  while (current.teamId === undefined && current.participantId === undefined && current.parentSession !== undefined) {
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    let parent = live(current.parentSession)
    if (parent === undefined) {
      durable ??= new Map((await persisted()).map(candidate => [candidate.id, candidate]))
      parent = durable.get(current.parentSession)
    }
    if (parent === undefined) return undefined
    current = parent
  }
  return current
}
