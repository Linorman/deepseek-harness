/** Flushed canonical Session evidence. @module @clocky/clocky-simulation/context-consumption */
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { SimulationContextViewEventData } from '@clocky/clocky-session/types'
import { SessionId } from '@clocky/clocky-session/types'
import type { Branded } from '@clocky/clocky-brand'

/** Exact context-view and entered control-input positions in one canonical Session. */
export const simulationContextConsumptionSchema = z.strictObject({
  notification: z.strictObject({ operationId: z.string().min(1).transform(value => value as Branded<'SimulationOperationId'>),
    consumedSequence: z.number().int().nonnegative() }).optional(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: z.string().min(1).transform(SessionId),
  inputId: z.string().min(1).transform(value => value as Branded<'SimulationInputId'>),
  viewSequence: z.number().int().nonnegative(),
  consumedSequence: z.number().int().nonnegative(),
}).refine(value => value.consumedSequence > value.viewSequence, 'Consumption must follow its context view')
/** Session-owner receipt; model proposal JSON never supplies it. */
export type SimulationContextConsumption = z.infer<typeof simulationContextConsumptionSchema>

/**
 * Fingerprint the exact Native-prepared view, including its private content and source references.
 * @param view - Canonical Native-owned view, compared with the Session projection before attestation.
 * @returns SHA-256 of its retained JSON representation; never a substitute for consumption evidence.
 */
export function simulationContextConsumptionHash(view: SimulationContextViewEventData): string {
  return createHash('sha256').update(JSON.stringify(view)).digest('hex')
}
