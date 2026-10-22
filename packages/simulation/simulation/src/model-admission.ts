/** Durable refusal of a logged model attempt by the shared live pool. @module @clocky/clocky-simulation/model-admission */
import { z } from 'zod'
import type { SimulationCompactionTokenRequest } from './tokens.ts'
import type { SimulationEntityId } from './entity-types.ts'
import type { SimulationWriterEpoch } from './writer-types.ts'
import type { SimulationDecisionId } from './business-types.ts'
import type { SessionId } from '@clocky/clocky-session/types'

/** Owner-attested pool facts at the refused Session request; occupancy is historical evidence, not a recovery permit. */
export const simulationModelPoolUsageSchema = z.strictObject({
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  queueLimit: z.number().int().nonnegative(),
}).refine(value => value.active === value.limit && value.queued === value.queueLimit,
  'A refused model attempt requires a full pool and queue')
/** Exact durable Session position of an ordinary decision request refused by that pool. */
export const simulationModelAdmissionBlockSchema = simulationModelPoolUsageSchema.safeExtend({
  sessionSequence: z.number().int().nonnegative(),
})
/** Exact refusal retained on the cancelled decision. */
export type SimulationModelAdmissionBlock = z.infer<typeof simulationModelAdmissionBlockSchema>
/** Full pool/queue facts sampled at refusal, independent of later permit release. */
export type SimulationModelPoolUsage = z.infer<typeof simulationModelPoolUsageSchema>
/** Full-request refusal before a provider is called; the estimate includes the logged envelope and history. */
export const simulationRequestBudgetBlockSchema = z.strictObject({
  sessionSequence: z.number().int().nonnegative(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  estimatedInputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  safetyMarginTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).refine(value => BigInt(value.estimatedInputTokens) + BigInt(value.maxOutputTokens)
  + BigInt(value.safetyMarginTokens) > BigInt(value.limit), 'A request refusal must exceed its recorded bound')
/** Recorded, model-free request refusal. */
export type SimulationRequestBudgetBlock = z.infer<typeof simulationRequestBudgetBlockSchema>

/** Typed request-budget refusal; callers retain the original decision and never silently retry a paid request. */
export class SimulationRequestBudgetError extends Error {
  /** Stable refusal category retained by scheduling consumers. */
  readonly code = 'SIM_REQUEST_BUDGET_EXCEEDED'
  /** @param block - Complete original request measurement and limit. */
  constructor(readonly block: SimulationRequestBudgetBlock) {
    super(`Simulation request budget exceeded: input estimate ${block.estimatedInputTokens}, output ${block.maxOutputTokens}, margin ${block.safetyMarginTokens}, limit ${block.limit}`)
  }
}

/** Actual provider usage exceeded an already retained reservation; acknowledgement is an explicit management action. */
export class SimulationTokenOverrunError extends Error {
  /** Stable overrun category; actual charged usage remains durable. */
  readonly code = 'SIM_TOKEN_RESERVATION_EXCEEDED'
  /** @param reservationId - Original charged request. @param reserved - Reserved tokens. @param used - Complete reported usage. */
  constructor(readonly reservationId: string, readonly reserved: number, readonly used: number) {
    super(`Simulation token reservation exceeded: ${reservationId}, reserved ${reserved}, used ${used}; acknowledge the original overrun before resuming`)
  }
}
/** Canonical auxiliary request retained even when it runs outside a world decision. */
export interface SimulationCompactionAdmissionBlock {
  readonly requestHash: string
  readonly entityId: SimulationEntityId
  readonly epoch: SimulationWriterEpoch
  readonly sessionId: SessionId
  readonly request: SimulationCompactionTokenRequest
  readonly pool: SimulationModelPoolUsage
  /** Unsubmitted owned decision cancelled atomically with the refusal, when one exists. */
  readonly decisionId?: SimulationDecisionId
}
