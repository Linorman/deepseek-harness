/** Startup history refusal retains a released or still-charged writer, never assumes raw resources are absent. */
import { z } from 'zod'
import { simulationActivationAdmissionRequestSchema, simulationWriterEpochSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationActivationAdmissionBlock } from '@clocky/clocky-simulation'
import { requireWriterEpoch } from './writers.ts'

/** Controller-attested startup outcome bound to the exact Native epoch. */
export const activationAdmissionRecordSchema = z.strictObject({ kind: z.literal('activation/history-blocked'),
  request: simulationActivationAdmissionRequestSchema, epoch: simulationWriterEpochSchema })
/** Parsed retained startup refusal. */
export type ActivationAdmissionRecord = z.infer<typeof activationAdmissionRecordSchema>

/**
 * Save the permanent history blocker while preserving any unconfirmed writer and current scheduling selection.
 * @param state - Current canonical binding, frozen Team limit and writer ownership.
 * @param record - Original exact typed refusal after controller cleanup attempted.
 * @returns stalled projection; a concurrent user pause remains paused.
 */
export function foldActivationAdmission(state: SimulationSnapshot, record: ActivationAdmissionRecord): SimulationSnapshot {
  const entity = requireWriterEpoch(state, record.request.entityId, record.epoch), details = record.request.details
  if (!['running', 'paused'].includes(state.phase) || entity.readiness !== 'ready' || entity.phase !== 'active'
    || entity.binding?.teamId !== details.teamId || entity.binding.participantId !== details.participantId
    || entity.binding.sessionId !== details.sessionId || details.reservationId === undefined
    || entity.writer?.reservationId !== details.reservationId
    || details.limit !== state.teamReservation?.creation.limits?.maxActivations
    || (details.cleanup === 'confirmed' ? entity.writer.phase !== 'released'
      : entity.writer.phase !== 'revoked' && entity.writer.phase !== 'reserved')
    || state.activationAdmissionBlocks?.some(value => value.entityId === entity.id)) {
    throw new Error('Simulation Activation history refusal requires its canonical original startup and cleanup outcome')
  }
  const block: SimulationActivationAdmissionBlock = { ...record.request, epoch: record.epoch }
  return { ...state, activationAdmissionBlocks: [...state.activationAdmissionBlocks ?? [], block],
    phase: state.phase === 'paused' ? 'paused' : 'stalled', stall: { code: 'SIM_ACTIVATION_HISTORY_LIMIT', entityId: entity.id,
      recovery: 'reconcile-startup-and-create-new-scenario' } }
}

/**
 * Check immutable refusal identities against retained ownership after commit or replay.
 * @param state - Complete authoritative projection.
 */
export function assertActivationAdmissionProjection(state: SimulationSnapshot): void {
  const seen = new Set<string>()
  for (const block of state.activationAdmissionBlocks ?? []) {
    simulationActivationAdmissionRequestSchema.parse({ entityId: block.entityId, details: block.details })
    simulationWriterEpochSchema.parse(block.epoch)
    const entity = state.entities[block.entityId], details = block.details
    if (seen.has(block.entityId) || entity?.binding?.teamId !== details.teamId
      || entity.binding.participantId !== details.participantId || entity.binding.sessionId !== details.sessionId
      || entity.writer?.epoch !== block.epoch || entity.writer.reservationId !== details.reservationId
      || details.limit !== state.teamReservation?.creation.limits?.maxActivations
      || details.cleanup === 'confirmed' && entity.writer.phase !== 'released') {
      throw new Error('Simulation Activation history refusal lost its retained startup ownership')
    }
    seen.add(block.entityId)
  }
  if (state.stall?.code === 'SIM_ACTIVATION_HISTORY_LIMIT') {
    const entityId = state.stall.entityId
    if (!state.activationAdmissionBlocks?.some(value => value.entityId === entityId)) {
      throw new Error('Simulation Activation history stop lost its original refusal')
    }
  }
}
