/** Pure versioned business-result projections; these facts never authorize execution.
 * @module @clocky/clocky-simulation/world-summary
 */
import { z } from 'zod'
import type { SimulationWorldRequest, SimulationWorldResult } from './world-types.ts'
import type { SimulationWorldJsonValue } from './world-domain-types.ts'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const measured = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('known'), value: count }),
  z.strictObject({ status: z.enum(['unknown', 'withheld', 'not-applicable']),
    reason: z.enum(['missing-evidence', 'stale-evidence', 'unconfirmed-effects', 'invalid-evidence']).optional() }),
])
/** Strict bounded projection output; raw requests, receipts and private prose cannot escape through it. */
export const simulationWorldBusinessSummarySchema = z.strictObject({
  version: z.literal(1), label: z.string().min(1).max(80),
  submission: z.enum(['accepted', 'rejected', 'cancelled']),
  execution: z.enum(['pending', 'accepted', 'rejected', 'unknown', 'not-applicable']),
  businessOutcome: z.enum(['achieved', 'not-achieved', 'unknown', 'not-applicable']),
  counts: z.strictObject({ businessEntities: measured, firms: measured, alliances: measured, organizations: measured, memberships: measured,
    employmentRelationships: measured,
    founderRepresentedEntities: measured, employedPeople: measured, technicalRoles: measured, independentSessions: measured,
    openOrders: measured, openLoans: measured }),
  sources: z.array(z.strictObject({ kind: z.enum(['request', 'result', 'environment', 'bindings']), sequence: count,
    profileRevision: count.optional(), domainRevision: count.optional(),
    domainTime: z.string().regex(/^(0|[1-9][0-9]*)$/).optional() })).min(1).max(8),
  nativeRevision: count,
}).refine(value => value.sources.every(source => source.sequence <= value.nativeRevision),
  'Business summary sources must belong to the observed Native prefix')
/** Three independent success layers and explicitly covered business/technical counts. */
export type SimulationWorldBusinessSummary = z.infer<typeof simulationWorldBusinessSummarySchema>
/** Host-selected evidence only; absence never authorizes reading an external case or another private context. */
export interface SimulationWorldBusinessSummaryEvidence {
  /** Public original acceptance identity, without description, business key, source Session or proposed body. */
  readonly request: Pick<SimulationWorldRequest, 'id' | 'intentId' | 'pin' | 'sequence' | 'status'>
  /** Private proposed body has independent case-prose authorization. */
  readonly requestBody: { readonly status: 'allowed'; readonly proposal: SimulationWorldRequest['proposal'] }
    | { readonly status: 'withheld' }
  /** Validated public domain result, which excludes private planning material by its owning contract. */
  readonly result?: SimulationWorldResult
  /** Current Native prefix that contains all supplied evidence. */
  readonly nativeRevision: number
  /** Native execution receipt is still unconfirmed; pending does not prove a judge result. */
  readonly executionUnknown: boolean
  /** Target profile only when independently authorized by its context reader. */
  readonly environment: {
    readonly status: 'allowed'
    readonly profile: Readonly<Record<string, SimulationWorldJsonValue>>
    readonly profileRevision: number
  } | { readonly status: 'withheld' | 'unknown' }
  /** Newer public results or unconfirmed external effects on this same domain operation and target. */
  readonly targetEffects: { readonly latestResultSequence: number | null; readonly unconfirmed: boolean }
  /** Whole-run technical identity counts; no Session identities or private bodies. */
  readonly technicalCounts: { readonly roles: number; readonly independentSessions: number }
}
