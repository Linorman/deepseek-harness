/** Immutable identity comparison shared by usage-charge admission and journal replay. */
import type { TeamUsageCharge } from '@clocky/clocky-team'

/**
 * Compare provenance while permitting provider chunks to replace usage and observation timestamps.
 * @param left - Existing retained child charge.
 * @param right - Candidate charge with the same admitted identity.
 * @returns Whether every immutable origin, participant, Session and model-step field matches.
 */
export function sameUsageChargeProvenance(left: TeamUsageCharge, right: TeamUsageCharge): boolean {
  return left.id === right.id
    && left.sourceTeamId === right.sourceTeamId
    && left.parentTaskId === right.parentTaskId
    && left.originTeamId === right.originTeamId
    && left.sourceSampleId === right.sourceSampleId
    && left.participantId === right.participantId
    && left.sessionId === right.sessionId
    && left.provider === right.provider
    && left.model === right.model
    && left.turn === right.turn
    && left.step === right.step
}
