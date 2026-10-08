import { participantIdSchema, teamIdSchema } from './schema.ts'
import type { ParticipantId, TeamId } from './types.ts'

/**
 * Parse the complete Team participant reference carried by a local Session header.
 * @param header - Recorded Team and Participant fields; unrelated header metadata is ignored.
 * @returns The validated pair, or undefined when either member is absent or invalid.
 */
export function parseTeamParticipantHeader(
  header: { readonly teamId?: unknown; readonly participantId?: unknown },
): { readonly teamId: TeamId; readonly participantId: ParticipantId } | undefined {
  const teamId = teamIdSchema.safeParse(header.teamId)
  const participantId = participantIdSchema.safeParse(header.participantId)
  return teamId.success && participantId.success ? { teamId: teamId.data, participantId: participantId.data } : undefined
}
