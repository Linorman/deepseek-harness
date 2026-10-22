/** Cross-log immutable identity contracts shared by checkpoint collection and writable restoration. */
import { isDeepStrictEqual } from 'node:util'
import { SimulationWorldError } from '@clocky/clocky-simulation'
import type { SimulationEntity, SimulationSnapshot } from '@clocky/clocky-simulation'
import type { ChannelAdmissionSnapshot, ChannelId, ParticipantSnapshot, TeamId } from '@clocky/clocky-team'
import { assertWorldChannelAdmission } from './world-cleanup.ts'

/**
 * Verify the original Native participant descriptor independently of current membership/activation phase.
 * @param entity - Original Native entity and immutable participant reservation.
 * @param participant - Current canonical Team participant, including retained retired history.
 * @param teamId - Canonical execution Team selected by the original reservation/checkpoint.
 */
export function assertParticipantReservationSource(entity: SimulationEntity, participant: ParticipantSnapshot | undefined,
  teamId: TeamId): void {
  const reserved = entity.participantReservation
  if (reserved === undefined) return
  const original = reserved.participant
  if (participant?.kind !== 'local-agent' || participant.id !== reserved.binding.participantId
    || participant.teamId !== teamId || reserved.binding.teamId !== teamId
    || !isDeepStrictEqual({ displayName: participant.displayName, role: participant.role, capabilities: participant.capabilities,
      provider: participant.provider, preset: participant.preset, model: participant.model },
    { displayName: original.displayName, role: original.role, capabilities: original.capabilities,
      provider: original.provider, preset: original.preset, model: original.model })) {
    throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Participant descriptor differs from its original Native reservation')
  }
}

/**
 * Recheck complete original endpoint consent for every confirmed Native Channel, including late owners absent from a checkpoint.
 * @param state - Full current Native suffix and permanent participant/Session bindings.
 * @param channelId - Actual Team-owned Channel being collected or restored.
 * @param admission - Actual immutable manifest and retained consent records; phase may legitimately be closed.
 * @param teamId - Canonical execution Team.
 */
export function assertReservedChannelSource(state: SimulationSnapshot, channelId: ChannelId,
  admission: ChannelAdmissionSnapshot, teamId: TeamId): void {
  const original = Object.entries(state.channelReservations ?? {}).find(([, value]) => value.channelId === channelId)
  if (original === undefined || !original[1].confirmed) return
  const [key, reservation] = original
  assertWorldChannelAdmission(state, { key: reservation.spec.key, channelId, spec: reservation.spec }, admission, teamId)
  if (key !== reservation.spec.key) throw new SimulationWorldError('SIM_WORLD_INTEGRITY', 'Native Channel key differs from its original spec')
}
