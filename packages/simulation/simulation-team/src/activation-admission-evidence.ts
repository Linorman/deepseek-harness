/** Recheck permanent history refusal against its original Team startup responsibility. */
import type { TeamStateSnapshot } from '@clocky/clocky-team'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'

/**
 * Verify original limit facts, absent attempted binding and retained startup cleanup across checkpoint or restore.
 * @param state - Native retained failure and current writer settlement.
 * @param team - Actual canonical Team history and startup reservations.
 * @returns whether all refused startups still have exact evidence; a historical unconfirmed outcome may now be released.
 */
export function activationAdmissionEvidenceMatches(state: SimulationSnapshot, team: TeamStateSnapshot): boolean {
  return (state.activationAdmissionBlocks ?? []).every((block) => {
    const details = block.details, writer = state.entities[block.entityId]?.writer
    const reservation = team.participants.find(value => value.id === details.participantId)?.activationReservation
    return team.team.id === details.teamId && team.team.cursor >= details.teamCursor && team.activations.length >= details.used
      && !team.activations.some(value => value.activation.id === details.activationId)
      && details.reservationId !== undefined && reservation !== undefined
      && reservation.id === details.reservationId && reservation.sessionId === details.sessionId
      && (writer?.phase === 'released' ? reservation.releasedAt !== undefined : reservation.releasedAt === undefined)
  })
}
