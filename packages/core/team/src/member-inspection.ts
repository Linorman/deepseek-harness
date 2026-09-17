/** Exact member detail and indexed capability pages without grant or attempt-history materialization. */
import type { ParticipantSnapshot, TeamMemberInspection, TeamMemberInspectSpec } from './types.ts'

/** Explicit ownership, revision or response-capacity refusal. */
export type TeamMemberInspectionProjection =
  | { readonly ok: true; readonly value: TeamMemberInspection }
  | { readonly ok: false; readonly reason: 'owner' | 'cursor' | 'metadata' | 'row' }
const utf8 = new TextEncoder()

/** Inspect a member without traversing other members or copying capability history outside the page.
 * @param member - authoritative retained member.
 * @param teamCursor - current Team journal cursor under its serializer.
 * @param request - exact member selection and resolved capability window.
 * @param maxBytes - total UTF-8 JSON allowance, including metadata and continuation.
 * @returns detached detail page or an explicit refusal; no Agent is created or resumed.
 */
export function projectMemberInspection(member: ParticipantSnapshot, teamCursor: number,
  request: TeamMemberInspectSpec, maxBytes: number): TeamMemberInspectionProjection {
  if (member.teamId !== request.teamId || member.id !== request.participantId) return { ok: false, reason: 'owner' }
  if (request.expectedTeamCursor !== undefined && request.expectedTeamCursor !== teamCursor) return { ok: false, reason: 'cursor' }
  const record = { id: member.id, teamId: member.teamId, kind: member.kind, displayName: member.displayName,
    role: member.role, phase: member.phase,
    ...member.provider === undefined ? {} : { provider: member.provider },
    ...member.preset === undefined ? {} : { preset: member.preset },
    ...member.model === undefined ? {} : { model: member.model },
    ...member.authScheme === undefined ? {} : { authScheme: member.authScheme } }
  if (Object.values(record).some(value => value.length > maxBytes)) return { ok: false, reason: 'metadata' }
  const header = { record, teamCursor, startCursor: request.afterCursor, total: member.capabilities.length }
  const items: string[] = []
  const page = (scanned: number, nextCursor?: number): TeamMemberInspection => ({ ...header, scanned, items,
    ...nextCursor === undefined ? {} : { nextCursor } })
  const bytes = (value: TeamMemberInspection) => utf8.encode(JSON.stringify(value)).byteLength
  if (bytes(page(0)) > maxBytes) return { ok: false, reason: 'metadata' }
  let scanned = 0
  let itemBytes = 0
  let position = Math.min(request.afterCursor + 1, member.capabilities.length)
  for (; position < member.capabilities.length && items.length < request.limit; position++) {
    const capability = member.capabilities[position]
    // Parsed capability arrays are dense and the serializer owns this range.
    if (capability === undefined) throw new Error('Capability is missing at its retained index')
    scanned++
    const nextCursor = position < member.capabilities.length - 1 ? position : undefined
    const metadataBytes = bytes({ ...page(nextCursor === undefined ? scanned : scanned + 1, nextCursor), items: [] })
    const rowBytes = capability.length > maxBytes ? maxBytes + 1 : utf8.encode(JSON.stringify(capability)).byteLength
    const separator = items.length === 0 ? 0 : 1
    if (metadataBytes + itemBytes + separator + rowBytes > maxBytes) {
      if (items.length === 0) return { ok: false, reason: 'row' }
      return { ok: true, value: page(scanned, position - 1) }
    }
    itemBytes += separator + rowBytes
    items.push(capability)
  }
  return { ok: true, value: page(scanned, position < member.capabilities.length ? position - 1 : undefined) }
}
