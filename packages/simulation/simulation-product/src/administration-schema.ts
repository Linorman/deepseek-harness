/** Browser-safe parser for product creation, explicit preparation and persistent request lookup. */
import { simulationProductTaskReviewResolveInputSchema } from './review-schema.ts'
import { simulationProductOperationRetryInputSchema } from './operation-retry-schema.ts'
import { simulationCheckpointDiagnosticSchema } from '@clocky/clocky-simulation/checkpoint-diagnostics-schema'
import { z } from 'zod'
import { simulationProductTaskCancelInputSchema } from './task-control-schema.ts'
import { simulationProductRunIdSchema, simulationProductTextSchema, simulationProductCursorSchema } from './schema-common.ts'
import type { SimulationProductCommandId, SimulationProductTemplateId, SimulationProductCreateInput,
  SimulationProductPrepareInput, SimulationProductRequestInput, SimulationProductRequestReceipt, SimulationProductRequestResult,
  SimulationProductCatalog, SimulationProductPreflightInput, SimulationProductPreflightResult,
  SimulationProductRequestsInput, SimulationProductRequestsPage, SimulationProductRetryRequestInput,
  SimulationProductModelReadiness, SimulationProductOriginalCreateInput } from './administration-types.ts'
/** Empty catalog query carries no actor or deployment configuration. */
export const simulationProductCatalogInputSchema = z.strictObject({})
/** Brand a caller-retained command at its wire/file boundary. */
export const simulationProductCommandIdSchema = z.string().min(1).transform(value => value as SimulationProductCommandId)
/** Brand a deployment-selected template identifier. */
export const simulationProductTemplateIdSchema = z.string().trim().min(1).transform(value => value as SimulationProductTemplateId)
/** Company parameters contain only bounded-by-deployment names and canonical positive stock quantity. */
export const simulationCompanyParametersSchema = z.strictObject({ buyerName: z.string().trim().min(1),
  supplierName: z.string().trim().min(1), initialStock: z.string().regex(/^[1-9][0-9]*$/) })
/** Public allowance keys, shared with the trusted deployment allowlist. */
export const simulationProductLimitKeySchema = z.enum(['maxEntities', 'maxResidentActors', 'tokensPerModelRequest', 'maxTokensPerInterval', 'maxTime'])
/** Exact resolved allowances; no storage path, clock definition, route or shared permit setting. */
export const simulationProductLimitsSchema = z.strictObject({ maxEntities: z.number().int().positive(),
  maxResidentActors: z.number().int().positive(), tokensPerModelRequest: z.number().int().positive(),
  maxTokensPerInterval: z.number().int().nonnegative(), maxTime: z.string().regex(/^[1-9][0-9]*$/) })
/** Safe resolved budget metadata, with current shared capacity observed independently of this run. */
export const simulationProductConfigurationSchema = z.strictObject({ limits: simulationProductLimitsSchema,
  budgetInterval: z.string().regex(/^[1-9][0-9]*$/), tickUnit: simulationProductTextSchema,
  rulesVersion: simulationProductTextSchema, policyVersion: simulationProductTextSchema, sharedModelLimit: z.number().int().positive() })
/** Actor-free original creation payload; changed semantic payloads cannot reuse its command. */
export const simulationProductModelRouteSchema = z.strictObject({ provider: z.string().trim().min(1), name: z.string().trim().min(1) })
/** Safe reasons and an exact route only when metadata resolution succeeded. */
export const simulationProductModelReadinessSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), model: simulationProductModelRouteSchema }),
  z.strictObject({ status: z.literal('needs-model'), reason: z.literal('default-model-missing') }),
  z.strictObject({ status: z.literal('unavailable'), reason: z.enum(['provider-unavailable', 'metadata-unavailable',
    'reasoning-unsupported', 'execution-unavailable', 'template-unavailable']) }),
]) satisfies z.ZodType<SimulationProductModelReadiness>
/** Creation confirms the observed route without supplying execution configuration. */
export const simulationProductCreateInputSchema = z.strictObject({ commandId: simulationProductCommandIdSchema,
  templateId: simulationProductTemplateIdSchema, templateVersion: z.literal('1'), name: z.string().trim().min(1),
  expectedModel: simulationProductModelRouteSchema,
  parameters: simulationCompanyParametersSchema, limits: simulationProductLimitsSchema.partial().optional(),
}) satisfies z.ZodType<SimulationProductCreateInput>
/** Preflight is a read: callers allocate no durable command identity. */
export const simulationProductPreflightInputSchema = simulationProductCreateInputSchema.omit({
  commandId: true, expectedModel: true,
}) satisfies
  z.ZodType<SimulationProductPreflightInput>
/** Existing journal layout keeps route confirmation in its frozen driver; no selector or new durable field is added. */
export const simulationProductOriginalCreateInputSchema = simulationProductCreateInputSchema.omit({ expectedModel: true }) satisfies
  z.ZodType<SimulationProductOriginalCreateInput>
/** Public issues contain only bounded safe messages and field locations. */
export const simulationProductPreflightResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), configuration: simulationProductConfigurationSchema,
    readiness: z.strictObject({ status: z.literal('ready'), model: simulationProductModelRouteSchema }) }),
  z.strictObject({ status: z.literal('invalid'), issues: z.array(z.strictObject({ field: z.string().min(1).max(256),
    code: z.enum(['invalid', 'not-allowed', 'unavailable', 'capacity-unavailable']), message: simulationProductTextSchema })).min(1).max(32),
  readiness: simulationProductModelReadinessSchema }),
]) satisfies z.ZodType<SimulationProductPreflightResult>
/** Preparation reuses the retained run; no browser-provided configuration or source. */
export const simulationProductPrepareInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductCommandIdSchema }) satisfies z.ZodType<SimulationProductPrepareInput>
/** Persistent outcome lookup without a transport identity or self-reported actor. */
export const simulationProductRequestInputSchema = z.strictObject({ commandId: simulationProductCommandIdSchema }) satisfies
  z.ZodType<SimulationProductRequestInput>
/** Discovery accepts only a run and bound/revision selections, never private original bodies. */
export const simulationProductRequestsInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  limit: z.number().int().positive().optional(), cursor: simulationProductCursorSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional() }) satisfies z.ZodType<SimulationProductRequestsInput>
/** Retry requires the exact original run/command pair and allocates nothing on a missing selection. */
export const simulationProductRetryRequestInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  commandId: simulationProductCommandIdSchema }) satisfies z.ZodType<SimulationProductRetryRequestInput>
/** The original terminal result remains historical after later preparation attempts. */
export const simulationProductRequestReceiptSchema = z.strictObject({ commandId: simulationProductCommandIdSchema,
  runId: simulationProductRunIdSchema, kind: z.enum(['create', 'prepare', 'checkpoint', 'restore', 'review', 'retry-operation', 'cancel-task']), acceptedAt: z.number().int().nonnegative(),
  status: z.enum(['accepted', 'completed', 'failed']), checkpointId: z.string().min(1).transform(value => value as import('@clocky/clocky-simulation/identities').SimulationCheckpointId).optional(),
  failure: z.enum(['preparation-required', 'recovery-required', 'unavailable', 'checkpoint-failed', 'restore-failed', 'review-failed',
    'retry-operation-failed', 'cancel-task-failed']).optional(),
  diagnostic: simulationCheckpointDiagnosticSchema.optional(),
}).refine(value => (value.status === 'failed') === (value.failure !== undefined), 'Only failed requests carry a failure category').refine(value =>
  (value.kind === 'checkpoint' || value.kind === 'restore') === (value.checkpointId !== undefined),
'Maintenance receipts must carry their exact checkpoint identity').refine((value) => {
  if (value.status !== 'failed' || value.failure === 'recovery-required' || value.failure === 'unavailable') return true
  return value.kind === 'checkpoint' ? value.failure === 'checkpoint-failed'
    : value.kind === 'restore' ? value.failure === 'restore-failed' : value.kind === 'review' ? value.failure === 'review-failed'
      : value.kind === 'retry-operation' ? value.failure === 'retry-operation-failed'
        : value.kind === 'cancel-task' ? value.failure === 'cancel-task-failed' : value.failure === 'preparation-required'
}, 'Failure category does not belong to the original operation kind').refine(value => value.diagnostic === undefined
  || value.status === 'failed' && (value.kind === 'checkpoint' || value.kind === 'restore'),
'Only failed checkpoint or restore requests carry source diagnoses') satisfies
  z.ZodType<SimulationProductRequestReceipt>
/** Complete receipt page binds every row to its selected run and contains no command input text. */
export const simulationProductRequestsPageSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  snapshotRevision: z.number().int().nonnegative(), items: z.array(simulationProductRequestReceiptSchema),
  total: z.number().int().nonnegative(), nextCursor: simulationProductCursorSchema.optional(),
}).refine(value => value.items.length <= value.total && value.items.every(item => item.runId === value.runId)
  && new Set(value.items.map(item => item.commandId)).size === value.items.length,
'Request page must contain distinct original commands from its selected run') satisfies z.ZodType<SimulationProductRequestsPage>
/** Unknown results must remain distinct from persisted failure. */
export const simulationProductRequestResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not-found'), commandId: simulationProductCommandIdSchema }),
  z.strictObject({ status: z.literal('found'), request: simulationProductRequestReceiptSchema,
    review: simulationProductTaskReviewResolveInputSchema.optional(),
    cancellation: simulationProductTaskCancelInputSchema.optional(),
    retryOperation: simulationProductOperationRetryInputSchema.optional() }),
]).refine(value => value.status !== 'found' || (value.request.kind === 'review') === (value.review !== undefined),
  'Only review requests carry their exact original review payload').refine(value => value.status !== 'found' || value.review === undefined
  || value.review.commandId === value.request.commandId && value.review.runId === value.request.runId,
'Review result must carry the input of its exact original command').refine(value => value.status !== 'found'
  || (value.request.kind === 'retry-operation') === (value.retryOperation !== undefined),
'Only retry-operation requests carry their exact original retry payload').refine(value => value.status !== 'found'
  || value.retryOperation === undefined || value.retryOperation.commandId === value.request.commandId
  && value.retryOperation.runId === value.request.runId,
'Retry result must carry the input of its exact original command').refine(value => value.status !== 'found'
  || (value.request.kind === 'cancel-task') === (value.cancellation !== undefined),
'Only cancellation requests carry their exact original cancellation payload').refine(value => value.status !== 'found'
  || value.cancellation === undefined || value.cancellation.commandId === value.request.commandId
  && value.cancellation.runId === value.request.runId,
'Cancellation result must carry the input of its exact original command') satisfies z.ZodType<SimulationProductRequestResult>
/** Safe catalog metadata omits private deployment spec, paths, owner identity and credentials. */
export const simulationProductCatalogSchema = z.strictObject({ items: z.array(z.strictObject({
  id: simulationProductTemplateIdSchema, version: z.literal('1'), name: simulationProductTextSchema,
  kind: z.enum(['company-procurement', 'task-workflow']), readiness: simulationProductModelReadinessSchema,
  tickUnit: simulationProductTextSchema, execution: z.enum(['cognition-only', 'automatic-tasks']), review: z.enum(['none', 'buyer', 'participant']), maxStock: z.string().regex(/^[1-9][0-9]*$/),
  cognition: z.enum(['model', 'deterministic']).optional(),
  configuration: simulationProductConfigurationSchema.extend({ editable: z.array(simulationProductLimitKeySchema) }).optional(),
})) }) satisfies z.ZodType<SimulationProductCatalog>
