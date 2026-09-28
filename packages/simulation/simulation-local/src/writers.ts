/** Writer transitions share the run journal serializer with decision admission. @module @clocky/clocky-simulation-local/writers */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { activationIdSchema, activationReservationIdSchema } from '@clocky/clocky-team'
import {
  assertCanonicalTeam, simulationCoordinatorIdSchema, simulationEntityBindingSchema, simulationEntityIdSchema,
  simulationWriterActivationSchema, simulationWriterEpochSchema,
} from '@clocky/clocky-simulation'
import type {
  SimulationEntity, SimulationEntityBinding, SimulationEntityId, SimulationSnapshot,
  SimulationWriter, SimulationWriterActivation, SimulationWriterEpoch,
} from '@clocky/clocky-simulation'

/** Validated durable writer mutations, inaccessible through the model proposal/admin entity command union. */
export const writerChangeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entity/bound'), entityId: simulationEntityIdSchema, binding: simulationEntityBindingSchema }),
  z.strictObject({
    kind: z.literal('writer/reserved'), entityId: simulationEntityIdSchema,
    epoch: simulationWriterEpochSchema, coordinatorId: simulationCoordinatorIdSchema,
    reservationId: activationReservationIdSchema, provider: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('writer/activated'), entityId: simulationEntityIdSchema,
    epoch: simulationWriterEpochSchema, activation: simulationWriterActivationSchema,
  }),
  z.strictObject({ kind: z.literal('writer/revoked'), entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema }),
  z.strictObject({
    kind: z.literal('writer/released'), entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema,
    activationId: activationIdSchema.optional(),
  }),
])
/** Parsed writer mutation. */
export type WriterChange = z.infer<typeof writerChangeSchema>

/**
 * Resolve one existing entity without inheriting object-prototype keys.
 * @param state - Current authoritative projection.
 * @param id - Exact entity id.
 * @returns the entity or rejects a missing id.
 */
export function requireCognitionEntity(state: SimulationSnapshot, id: SimulationEntityId): SimulationEntity {
  const entity = Object.hasOwn(state.entities, id) ? state.entities[id] : undefined
  if (entity === undefined) throw new Error('Simulation cognition entity does not exist')
  if (entity.cognition !== 'agent') throw new Error('Non-cognitive simulation entities cannot own Sessions or writers')
  return entity
}
/**
 * Verify a controller observation against the entity's permanent identity and reserved provider/epoch.
 * @param entity - Bound cognitive entity.
 * @param activation - Actual controller observation.
 */
export function assertWriterActivation(entity: SimulationEntity, activation: SimulationWriterActivation): void {
  const binding: SimulationEntityBinding = {
    teamId: activation.teamId, participantId: activation.participantId, sessionId: activation.sessionId,
  }
  if (!isDeepStrictEqual(entity.binding, binding) || entity.writer?.provider !== activation.provider
    || entity.writer.reservationId !== activation.reservationId
    || entity.writer.activationId !== undefined && entity.writer.activationId !== activation.activationId) {
    throw new Error('Simulation writer activation does not match its canonical binding')
  }
}
/**
 * Check epoch identity independently of the current lifecycle phase.
 * @param state - Current run state.
 * @param entityId - Selected entity.
 * @param epoch - Exact issued capability epoch.
 * @returns the entity at that epoch.
 */
export function requireWriterEpoch(
  state: SimulationSnapshot, entityId: SimulationEntityId, epoch: SimulationWriterEpoch,
): SimulationEntity {
  const entity = requireCognitionEntity(state, entityId)
  if (entity.writer?.epoch !== epoch) throw new Error('Simulation writer epoch is stale')
  return entity
}
/**
 * Apply a writer event without side effects; rejection leaves the prior projection intact.
 * @param state - Projection preceding the event.
 * @param change - Parsed persisted transition.
 * @returns updated entity projection without changing the journal tail.
 */
export function foldWriterChange(state: SimulationSnapshot, change: WriterChange): SimulationSnapshot {
  const entity = requireCognitionEntity(state, change.entityId)
  let next: SimulationEntity
  switch (change.kind) {
    case 'entity/bound': {
      if (state.activeWindowId !== undefined) throw new Error('Simulation entity binding waits for its window to close')
      if (entity.participantReservation !== undefined && !isDeepStrictEqual(entity.participantReservation.binding, change.binding)) {
        throw new Error('Simulation binding differs from its reserved participant identity')
      }
      if (state.teamReservation !== undefined
        && (!state.teamReservation.confirmed || state.teamReservation.teamId !== change.binding.teamId)) {
        throw new Error('Simulation entity binding requires its confirmed canonical Team')
      }
      assertCanonicalTeam(state, change.binding.teamId)
      if (entity.phase !== 'active') throw new Error('Only active entities can receive a cognition binding')
      if (entity.binding !== undefined) throw new Error('Simulation entity already has its permanent binding')
      for (const other of Object.values(state.entities)) {
        const binding = other.binding
        if (binding === undefined) continue
        if (binding.teamId !== change.binding.teamId) throw new Error('Simulation run requires one canonical execution Team')
        if (binding.participantId === change.binding.participantId || binding.sessionId === change.binding.sessionId) {
          throw new Error('Simulation participant and Session bindings must be unique')
        }
      }
      next = { ...entity, binding: change.binding }
      break
    }
    case 'writer/reserved': {
      if (entity.phase !== 'active' || entity.binding === undefined) throw new Error('Writer reservation requires an active bound entity')
      if (entity.writer !== undefined && entity.writer.phase !== 'released') throw new Error('Simulation writer has not been proven stopped')
      if (Object.values(state.entities).filter(value => value.writer !== undefined && value.writer.phase !== 'released').length
        >= state.spec.maxResidentActors) throw new Error('Simulation resident actor capacity exceeded')
      if (BigInt(change.epoch) !== BigInt(entity.writer?.epoch ?? '0') + 1n) throw new Error('Simulation writer epoch must increase by one')
      next = { ...entity, writer: { epoch: change.epoch, coordinatorId: change.coordinatorId, reservationId: change.reservationId, provider: change.provider, phase: 'reserved' } }
      break
    }
    case 'writer/activated': {
      requireWriterEpoch(state, change.entityId, change.epoch)
      if (entity.writer?.phase !== 'reserved' || entity.phase !== 'active') throw new Error('Simulation writer is not reserved for activation')
      assertWriterActivation(entity, change.activation)
      next = { ...entity, writer: { ...entity.writer, phase: 'active', activationId: change.activation.activationId } }
      break
    }
    case 'writer/revoked': {
      requireWriterEpoch(state, change.entityId, change.epoch)
      const writer = entity.writer as SimulationWriter
      if (writer.phase !== 'reserved' && writer.phase !== 'active') throw new Error('Simulation writer cannot be revoked in its current phase')
      next = { ...entity, writer: { ...writer, phase: 'revoked' } }
      break
    }
    case 'writer/released': {
      requireWriterEpoch(state, change.entityId, change.epoch)
      if (entity.writer?.phase !== 'revoked') throw new Error('Simulation writer must be revoked before release')
      if (change.activationId !== entity.writer.activationId) throw new Error('Simulation release must retain its activation identity')
      next = { ...entity, writer: { ...entity.writer, phase: 'released' } }
      break
    }
    /* v8 ignore next 2 -- the persisted discriminant is validated before this closed-union fold. */
    default:
      return assertNever(change)
  }
  return { ...state, entities: { ...state.entities, [entity.id]: { ...next, revision: entity.revision + 1 } } }
}
/* v8 ignore next 3 -- only the statically unreachable closed-union arm calls this helper. */
function assertNever(value: never): never {
  throw new Error(`Unknown writer change: ${String(value)}`)
}

/**
 * Verify canonical entity bindings against the run's retained Team reservation.
 * @param state - Published or replayed projection at a complete journal tail.
 */
export function assertWriterProjection(state: SimulationSnapshot): void {
  if (Object.values(state.entities).filter(entity => entity.phase !== 'terminated').length > state.spec.maxEntities
    || Object.values(state.entities).filter(entity => entity.writer !== undefined && entity.writer.phase !== 'released').length
      > state.spec.maxResidentActors) throw new Error('Simulation population exceeds its persisted capacity limits')
  const reserved = state.teamReservation
  if (reserved === undefined) return
  for (const channel of Object.values(state.channelReservations ?? {})) {
    if (!reserved.confirmed || channel.spec.members.some(member => state.entities[member.entityId]?.binding?.teamId !== reserved.teamId)) {
      throw new Error('Simulation channel membership differs from its canonical Team')
    }
  }
  for (const entity of Object.values(state.entities)) {
    const participant = entity.participantReservation
    if (participant !== undefined && (!reserved.confirmed || participant.binding.teamId !== reserved.teamId
      || entity.binding !== undefined && !isDeepStrictEqual(entity.binding, participant.binding))) {
      throw new Error('Simulation participant differs from its canonical reservation')
    }
    if (entity.binding !== undefined && (!reserved.confirmed || entity.binding.teamId !== reserved.teamId)) {
      throw new Error('Simulation entity binding differs from its confirmed Team reservation')
    }
  }
}

/**
 * Check newly accepted decisions against writer authority at the published append.
 * Replay checks authority at each historical acceptance while folding the journal.
 * @param state - Projection after the complete acceptance batch.
 * @param previousRevision - Durable tail immediately before that append.
 */
export function assertWriterAdmission(state: SimulationSnapshot, previousRevision: number): void {
  for (const decision of Object.values(state.decisions)) {
    if (decision.status !== 'accepted') continue
    if (decision.closedAt === undefined || decision.closedAt <= decision.snapshotRevision || decision.closedAt > state.revision) {
      throw new Error('Simulation accepted decision has an invalid journal interval')
    }
    if (decision.closedAt <= previousRevision) continue
    const entity = state.entities[decision.entityId]
    if (entity?.phase !== 'active' || entity.writer?.phase !== 'active' || entity.writer.epoch !== decision.epoch) {
      throw new Error('Simulation accepted decision is outside its active writer interval')
    }
  }
}
