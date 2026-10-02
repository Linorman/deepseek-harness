/** Original bounded retry allowances for unknown external outcomes; grants never publish or resume scheduling. */
import { z } from 'zod'
import { simulationOperationIdSchema } from './business.ts'
import { simulationWallTimeSchema } from './outbox.ts'
import { simTimeSchema } from './time.ts'
import type { SimulationOutboxRetryId } from './identities.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationOperationId } from './identities.ts'
export type { SimulationOutboxRetryId } from './identities.ts'

/** Exact original native allowance identity supplied by its trusted administrative owner. */
export const simulationOutboxRetryIdSchema = z.string().min(1).refine(value => value === value.trim())
  .transform(value => value as SimulationOutboxRetryId)
/** An immutable exact retry authorization; accepted product time is reused on every reconciliation. */
export const simulationOutboxRetryRequestSchema = z.strictObject({ id: simulationOutboxRetryIdSchema,
  operationId: simulationOperationIdSchema, expectedAttemptCount: z.number().int().positive(),
  reason: z.string().trim().min(1), authorizedAt: simulationWallTimeSchema })
/** Caller-retained retry payload; no operation body, fingerprint, attempt limit or phase is caller-selected. */
export type SimulationOutboxRetryRequest = z.infer<typeof simulationOutboxRetryRequestSchema>
/** One original recorded grant remains queryable after subsequent attempts, phases or results. */
export const simulationOutboxRetryGrantSchema = z.strictObject({ request: simulationOutboxRetryRequestSchema,
  sequence: z.number().int().nonnegative(), time: simTimeSchema, budgetStart: z.number().int().positive(),
  maxAttempts: z.number().int().positive() })
/** Durable target-side acceptance of exactly one bounded retry budget. */
export type SimulationOutboxRetryGrant = z.infer<typeof simulationOutboxRetryGrantSchema>

/** Safe native fences independent of any product owner, credential or transport dispatch. */
export interface SimulationOutboxRetryCapability {
  readonly allowed: boolean
  readonly reason: 'ready' | 'not-external' | 'outcome-known' | 'not-unknown' | 'not-due' | 'maintenance-in-progress'
  readonly expectedAttemptCount: number
  readonly maxAttempts: number
}
/**
 * Derive exact unknown-intent eligibility used by both the mutation fold and read projections.
 * @param state - Authoritative native state; inspection never changes it.
 * @param id - Exact retained external-operation identity.
 * @returns current count fence and unchanged retry bound; product admission remains independent.
 */
export function simulationOutboxRetryCapability(state: SimulationSnapshot, id: SimulationOperationId): SimulationOutboxRetryCapability {
  const operation = Object.hasOwn(state.operations, id) ? state.operations[id] : undefined
  const outbox = operation?.outbox, latest = outbox?.attempts.at(-1)
  const base = { expectedAttemptCount: outbox?.attempts.length ?? 0, maxAttempts: state.spec.outboxMaxAttempts }
  let reason: SimulationOutboxRetryCapability['reason']
  if (operation === undefined || outbox === undefined
    || operation.action.kind !== 'communication/post' && operation.action.kind !== 'task/create') reason = 'not-external'
  else if (operation.result !== undefined) reason = 'outcome-known'
  else if (operation.status !== 'outcome-unknown' || latest === undefined
    || latest.outcome !== 'uncertain' && latest.outcome !== 'in-flight') reason = 'not-unknown'
  else if (!outbox.ready || BigInt(state.time) < BigInt(operation.action.deliverAt)
    || operation.dependencies.some(dependency => state.operations[dependency]?.result?.status !== 'applied')) reason = 'not-due'
  else if (state.activeWindowId !== undefined || Object.values(state.checkpoints ?? {}).some(value => value.status === 'in-progress')) {
    reason = 'maintenance-in-progress'
  } else reason = 'ready'
  return { ...base, allowed: reason === 'ready', reason }
}
