/** Durable cognition identities parsed independently of runtime handles. @module @clocky/clocky-simulation/writer */
import { z } from 'zod'
import { activationIdSchema, activationReservationIdSchema, participantIdSchema, teamIdSchema } from '@clocky/clocky-team/schema'
import { SessionId } from '@clocky/clocky-session/types'
import type { SimulationCoordinatorId, SimulationEntityBinding, SimulationWriterActivation, SimulationWriterReservation, SimulationWriterEpoch } from './writer-types.ts'

/** One immutable Team/Participant/Session assignment. */
export const simulationEntityBindingSchema: z.ZodType<SimulationEntityBinding> = z.strictObject({
  teamId: teamIdSchema,
  participantId: participantIdSchema,
  sessionId: z.string().min(1).transform(SessionId),
})
const reservationFields = {
  teamId: teamIdSchema, participantId: participantIdSchema, sessionId: z.string().min(1).transform(SessionId),
  reservationId: activationReservationIdSchema, provider: z.string().min(1),
}
/** Durable Team reservation before runtime publication. */
export const simulationWriterReservationSchema: z.ZodType<SimulationWriterReservation> = z.strictObject(reservationFields)
/** One actual controller-bound activation. */
export const simulationWriterActivationSchema: z.ZodType<SimulationWriterActivation> = z.strictObject({
  ...reservationFields, activationId: activationIdSchema,
})
/** Canonical positive decimal epoch; zero is not a reserved writer. */
export const simulationWriterEpochSchema = z.string().regex(/^[1-9][0-9]*$/).transform(value => value as SimulationWriterEpoch)
/** Opaque open-run lifetime identity. */
export const simulationCoordinatorIdSchema = z.string().min(1).transform(value => value as SimulationCoordinatorId)
