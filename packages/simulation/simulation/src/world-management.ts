export { simulationPersonaManagementCommandSchema } from './world-hiring-market.ts'
import { simulationPersonaManagementCommandSchema } from './world-hiring-market.ts'
import type { SimulationSnapshot } from './types.ts'
import type { ProductPrincipalId } from '@clocky/clocky-product-principal'
import type { WorldManagementCommandId } from './world-management-source.ts'
import type { SimulationWorldManagementReceipt } from './world-management-types.ts'
/** Pure typed user-command inputs and receipts; Native owns authorization and every derived business identity. */
import { z } from 'zod'
import { simulationWorldTransferPayloadSchema, simulationWorldDepartPayloadSchema } from './world-personnel.ts'
import { simulationWorldHireExistingPayloadSchema } from './world-hire-existing.ts'
import { simulationWorldDomainPinSchema, simulationWorldReadSetSchema, worldIntentIdSchema } from './world-domain.ts'
import { worldPlanIdSchema, worldRequestIdSchema, simulationWorldResultSchema } from './world.ts'
import { worldExecutionReasonSchema, worldExecutionObservationSchema } from './world-execution.ts'
import { simulationHiringFeePolicySchema } from './world-hiring-resources.ts'
import { simulationWorldAuthenticatedUserSourceSchema, simulationWorldManagementFundingAuthoritySchema,
  worldManagementCommandIdSchema } from './world-management-source.ts'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
export * from './world-management-source.ts'
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
/** Complete immutable personnel command; there are no actor, Persona, identity-allocation or arbitrary effect fields. */
export const simulationWorldManagementActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('transfer'), payload: simulationWorldTransferPayloadSchema }),
  z.strictObject({ kind: z.literal('depart'), payload: simulationWorldDepartPayloadSchema }),
  z.strictObject({ kind: z.literal('hire-existing'), payload: simulationWorldHireExistingPayloadSchema }),
  z.strictObject({ kind: z.literal('hiring-market'), payload: simulationPersonaManagementCommandSchema }),
])
/** Read-only request with an explicit Native prefix, without a durable business reservation. */
export const simulationWorldManagementPreviewRequestSchema = z.strictObject({ action: simulationWorldManagementActionSchema,
  expectedRevision: revision })
/** Exact original command; retries retain all fields, including the original preview commitment. */
export const simulationWorldManagementSubmitRequestSchema = z.strictObject({ commandId: worldManagementCommandIdSchema,
  action: simulationWorldManagementActionSchema, expectedRevision: revision, previewHash: hash })
const impactFields = { personId: simulationEntityIdSchema, organizationEntityId: simulationEntityIdSchema,
  authorityRelationIds: z.array(simulationRelationIdSchema) }
/** Actual existing identities and role references affected by an admitted action, without private cognitive material. */
export const simulationWorldManagementImpactSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...impactFields, kind: z.literal('transfer'), assignmentId: simulationRelationIdSchema,
    assignmentRevision: revision.positive(), previousPositionId: simulationEntityIdSchema,
    targetPositionId: simulationEntityIdSchema, requestedEffectiveAt: simTimeSchema.nullable() }),
  z.strictObject({ ...impactFields, kind: z.literal('depart'), assignmentId: simulationRelationIdSchema,
    assignmentRevision: revision.positive(), previousPositionId: simulationEntityIdSchema,
    requestedEffectiveAt: simTimeSchema.nullable(), retire: z.boolean() }),
  z.strictObject({ ...impactFields, kind: z.literal('hire-existing'), targetPositionId: simulationEntityIdSchema }),
  z.strictObject({ kind: z.literal('hiring-market'), organizationEntityId: simulationEntityIdSchema,
    targetPositionId: simulationEntityIdSchema, draftId: z.string().min(1), draftRevision: revision }),
])
/** Native dependencies and exact quote; external source coverage remains owned by the trusted management authority. */
export const simulationWorldManagementPreviewSchema = z.strictObject({ action: simulationWorldManagementActionSchema,
  snapshotRevision: revision, pin: simulationWorldDomainPinSchema, reads: simulationWorldReadSetSchema,
  sourceFingerprint: hash, admission: z.enum(['allowed', 'blocked']), blockers: z.array(worldExecutionReasonSchema),
  settlementRequirements: z.array(worldExecutionReasonSchema), impact: simulationWorldManagementImpactSchema.nullable(),
  hiringFee: simulationHiringFeePolicySchema.nullable(), previewHash: hash,
}).refine(value => value.pin.domain === 'organization' && value.pin.operation === value.action.kind && value.pin.version === '1'
  && (value.impact === null || value.impact.kind === value.action.kind
    && (value.impact.kind === 'hiring-market' && value.action.kind === 'hiring-market'
      ? value.impact.draftId === value.action.payload.id
      : 'personId' in value.impact && 'personId' in value.action.payload && value.impact.personId === value.action.payload.personId)
    && value.impact.organizationEntityId === value.action.payload.organizationEntityId), 'Preview must retain its exact management selector and affected person')
  .refine(value => (value.admission === 'allowed') === (value.blockers.length === 0), 'Admission must match the actual blocker set')
/** Immutable acceptance commitment retained on the sole Native request. */
export const simulationWorldManagementAdmissionSchema = z.strictObject({ input: simulationWorldManagementSubmitRequestSchema,
  inputHash: hash, sourceFingerprint: hash, funding: simulationWorldManagementFundingAuthoritySchema.nullable() })
/** Replayable acceptance event; the reducer derives the request, plan, fence and IDs independently. */
export const simulationWorldManagementAcceptedSchema = z.strictObject({ kind: z.literal('world/management-accepted'),
  admission: simulationWorldManagementAdmissionSchema, source: simulationWorldAuthenticatedUserSourceSchema,
  pin: simulationWorldDomainPinSchema })
/** Exact original IDs together with current Native facts; callback settlement does not invent a business result. */
export const simulationWorldManagementReceiptSchema = z.strictObject({ commandId: worldManagementCommandIdSchema,
  principalId: simulationWorldAuthenticatedUserSourceSchema.shape.principalId, inputHash: hash,
  acceptedSequence: revision.positive(), intentId: worldIntentIdSchema, requestId: worldRequestIdSchema, planId: worldPlanIdSchema,
  execution: worldExecutionObservationSchema.optional(), result: simulationWorldResultSchema.optional(),
}).refine(value => value.execution === undefined || value.execution.planId === value.planId
  && value.execution.requestId === value.requestId && value.execution.intentId === value.intentId, 'Execution must belong to the original command')
  .refine(value => value.result === undefined || value.result.requestId === value.requestId && value.result.intentId === value.intentId
    && (value.result.source.kind !== 'plan' || value.result.source.planId === value.planId), 'Business result must belong to the original command')

/**
 * Observe an original user command from one already-validated Native prefix, without writer ownership or IO.
 * @param state - Actual Native snapshot; public redaction and current reader authorization belong to Product.
 * @param commandId - Exact original user command identity.
 * @param principalId - Current authenticated principal supplied by the trusted owner, never a browser selector.
 * @returns original IDs and actual optional receipts, or undefined for absence in this observed prefix only.
 */
export function inspectWorldManagement(state: Pick<SimulationSnapshot, 'world'>, commandId: WorldManagementCommandId,
  principalId: ProductPrincipalId): SimulationWorldManagementReceipt | undefined {
  const request = Object.values(state.world?.requests ?? {}).find(value => value.operationId === null
    && value.source.commandId === commandId && value.source.principalId === principalId)
  if (request?.operationId !== null) return undefined
  const planId = request.plans[0]
  if (planId === undefined || request.plans.length !== 1) throw new Error('Original user request lost its unique direct plan')
  const result = Object.values(state.world?.results ?? {}).find(value => value.requestId === request.id)
  const execution = state.world?.executions[planId]
  return simulationWorldManagementReceiptSchema.parse({ commandId, principalId, inputHash: request.admission.inputHash,
    acceptedSequence: request.sequence, intentId: request.intentId, requestId: request.id, planId,
    ...execution === undefined ? {} : { execution }, ...result === undefined ? {} : { result } })
}
