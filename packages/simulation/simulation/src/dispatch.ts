/** Durable decision admission candidates and fair slot reservations. @module @clocky/clocky-simulation/dispatch */
import { z } from 'zod'
import { simulationDecisionIdSchema } from './business.ts'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationEventIdSchema, simulationEventSlotSchema } from './scheduler.ts'
import { simulationWindowIdSchema } from './window.ts'
import { simTimeSchema } from './time.ts'

/** Immutable administrative nomination; model context is resolved only when opening the selected window. */
export const simulationDispatchCandidateSchema = z.strictObject({
  id: simulationDecisionIdSchema,
  entityId: simulationEntityIdSchema,
  priority: z.number().int(),
  deadline: simTimeSchema.optional(),
  wakeId: simulationEventIdSchema.optional(),
})
/** Retry identity and explicit number of distinct actors to reserve. */
export const simulationDispatchSelectionRequestSchema = z.strictObject({ id: simulationWindowIdSchema, limit: z.number().int().positive() })
/** Immutable nomination with optional business deadline and consumed wake ownership. */
export type SimulationDispatchCandidate = z.infer<typeof simulationDispatchCandidateSchema>
/** Window identity and capacity requested by the administrative scheduler. */
export type SimulationDispatchSelectionRequest = z.infer<typeof simulationDispatchSelectionRequestSchema>
/** Queue position and admission-round age survive coordinator replacement. */
export interface SimulationDispatchTicket {
  readonly candidate: SimulationDispatchCandidate
  readonly ordinal: z.infer<typeof simulationEventSlotSchema>
  readonly queuedRound: z.infer<typeof simulationEventSlotSchema>
  readonly status: 'queued' | 'reserved' | 'opened' | 'cancelled'
}
/** Exact order that the corresponding window must use; inference completion cannot change it. */
export interface SimulationDispatchSelection {
  readonly request: SimulationDispatchSelectionRequest
  readonly round: z.infer<typeof simulationEventSlotSchema>
  readonly decisions: readonly z.infer<typeof simulationDecisionIdSchema>[]
  readonly status: 'reserved' | 'opened' | 'cancelled'
}
/** Journal-owned queue, allocation history and the one pending window reservation. */
export interface SimulationDecisionDispatch {
  readonly round: z.infer<typeof simulationEventSlotSchema>
  readonly nextOrdinal: z.infer<typeof simulationEventSlotSchema>
  readonly tickets: Readonly<Record<z.infer<typeof simulationDecisionIdSchema>, SimulationDispatchTicket>>
  readonly selections: Readonly<Record<z.infer<typeof simulationWindowIdSchema>, SimulationDispatchSelection>>
  readonly active?: z.infer<typeof simulationWindowIdSchema>
}
