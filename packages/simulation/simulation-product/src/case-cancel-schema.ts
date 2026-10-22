/** Strict public cancellation selector; neither actor identity nor lifecycle authority comes from the browser. */
import { z } from 'zod'
import type { WorldIntentId } from '@clocky/clocky-simulation/world-domain-types'
import type { WorldPlanId, WorldRequestId } from '@clocky/clocky-simulation/world-types'
import type { SimulationProductCommandId } from './administration-types.ts'
import type { SimulationProductWorldCaseCancelPreview } from './case-types.ts'
import type { SimulationProductWorldCaseCancelInput } from './case-cancel-types.ts'
import { simulationProductRunIdSchema } from './schema-common.ts'

const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const planId = z.string().min(1).transform(value => value as WorldPlanId)
const intentId = z.string().min(1).transform(value => value as WorldIntentId)
/** Actual finite Native dependencies; unknown cleanup remains distinct from a business outcome. */
export const simulationProductWorldCaseCancelPreviewSchema = z.strictObject({ snapshotRevision: revision, previewHash: hash,
  impact: z.strictObject({ requestStatus: z.enum(['open', 'awaiting-evidence', 'cancel-requested', 'cancelled', 'rejected', 'committed']),
    planIds: z.array(planId), hiringReservationIds: z.array(intentId), personnelReservationIds: z.array(intentId),
    representativeReservationIds: z.array(intentId), unconfirmedExecutionPlanIds: z.array(planId) }) })
  .refine(value => Object.entries(value.impact).every(([key, ids]) => key === 'requestStatus'
    || new Set(ids).size === ids.length)
    && value.impact.unconfirmedExecutionPlanIds.every(id => value.impact.planIds.includes(id)),
  'Cancellation dependencies must be distinct original case plans and reservations') satisfies z.ZodType<SimulationProductWorldCaseCancelPreview>

/** Exact caller-retained command and run-local request; changed payloads cannot reuse a command. */
export const simulationProductWorldCaseCancelInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: z.string().min(1).refine(value => value === value.trim(), 'World cancellation command must be trimmed')
    .transform(value => value as SimulationProductCommandId),
  requestId: z.string().min(1).transform(value => value as WorldRequestId), previewRevision: revision, previewHash: hash,
}) satisfies z.ZodType<SimulationProductWorldCaseCancelInput>
