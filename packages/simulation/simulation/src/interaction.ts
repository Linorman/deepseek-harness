/** Structured responsibility protocol; transport receipts never imply business acceptance. @module @clocky/clocky-simulation/interaction */
import { z } from 'zod'
import type { Branded } from '@clocky/clocky-brand'

/** Stable request identity inside one run. */
export const simulationInteractionIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationInteractionId'>)
/** Unique obligation created by accepting one request. */
export const simulationCommitmentIdSchema = z.string().min(1).transform(value => value as Branded<'SimulationCommitmentId'>)
