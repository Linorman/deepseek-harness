/** Strict single-case hiring approval metadata; Native verifies original request, committee and current policy. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { worldIntentIdSchema, worldNormIdSchema } from './world-domain.ts'
import type { WorldRequestId } from './world-types.ts'
import type { WorldNormVersion } from './world-norms-types.ts'
import type { SimulationHireApprovalTarget } from './world-hire-approval-types.ts'
export { simulationHireApprovalBasisSchema } from './world-hiring-approval-basis.ts'

const text = z.string().min(1)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const values = z.array(text).max(32).refine(value => new Set(value).size === value.length, 'Approved Persona values must be distinct')
const norm = z.strictObject({ id: worldNormIdSchema,
  version: z.string().regex(/^[1-9][0-9]*$/).transform(value => value as WorldNormVersion) })
/** Exact existing person or finite installed template selection; committee consent cannot replace identity. */
export const simulationHireApprovalSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('finite-template'), templateId: text, templateVersion: text,
    names: values.min(1), skills: values, traits: values, goals: values }),
  z.strictObject({ kind: z.literal('existing-person'), personId: simulationEntityIdSchema,
    entityRevision: z.number().int().positive(), profileHash: hash }),
])
/** One specific request and one hire under the exact current policy; money and resource costs are unsupported. */
export const simulationHireApprovalTargetSchema = z.strictObject({
  intentId: worldIntentIdSchema,
  requestId: text.transform(value => value as WorldRequestId),
  requestHash: hash,
  scopeId: simulationEntityIdSchema,
  positionId: simulationEntityIdSchema,
  norm,
  selection: simulationHireApprovalSelectionSchema,
  quantity: z.literal(1),
})
/**
 * Render the exact structured single-hire purpose for a committee's original document.
 * @param target - Strict original request, norm and finite-selection approval metadata.
 * @returns canonical JSON text; generic policy approval or a prose consent claim cannot replace it.
 */
export function hireApprovalBody(target: SimulationHireApprovalTarget): string {
  return JSON.stringify({ kind: 'single-hire-approval', approval: simulationHireApprovalTargetSchema.parse(target) })
}
/** Stable hiring approval failures; they never imply funds, substitute votes or authorize an actor. */
export class SimulationHireApprovalError extends Error {
  /**
   * @param code - Exact missing, stale or incompatible committee approval category.
   * @param message - Trusted diagnosis, without private document contents.
   */
  constructor(readonly code: 'SIM_HIRE_APPROVAL_REQUIRED' | 'SIM_HIRE_APPROVAL_STALE' | 'SIM_HIRE_APPROVAL_INVALID'
    | 'SIM_HIRE_APPROVAL_SELECTION' | 'SIM_HIRE_APPROVAL_LIMIT', message: string) {
    super(message)
    this.name = 'SimulationHireApprovalError'
  }
}
