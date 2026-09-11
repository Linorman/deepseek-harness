/** Explicit closed-sink admission for final-receipt fixtures. @module */

import type { Context } from '@clocky/cordis'
import { fingerprintTeamFinalContent, teamFinalAdmissionIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamEnvelope, TeamFinalAdmission, TeamSystemFinalReceiptProof } from '@clocky/clocky-team'

/**
 * Persist a fixture final through the production closed-result admission command.
 * @param ctx - mounted authoritative Team provider.
 * @param actor - current source-owned TeamRun proof.
 * @param final - committed coordinator final whose exact payload is accepted.
 * @returns the durable independent sink acceptance.
 */
export async function admitTestFinal(ctx: Context, actor: TeamSystemFinalReceiptProof, final: TeamEnvelope): Promise<TeamFinalAdmission> {
  return await ctx.teams.admitTeamFinalResult({
    actor, teamId: final.teamId, channelId: final.channelId, envelopeId: final.id,
    envelopeSequence: final.sequence, contentFingerprint: fingerprintTeamFinalContent(final.payload),
    idempotencyKey: teamFinalAdmissionIdempotencyKeySchema.parse(`team-run-final:${final.teamId}`),
  })
}
