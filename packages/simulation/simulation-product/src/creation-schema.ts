/** Strict deployment and retained creation resolution validation before native IO. */
import { simulationProductTaskReviewResolveInputSchema } from './review-schema.ts'
import { simulationProductTaskCancelInputSchema } from './task-control-schema.ts'
import { simulationProductOperationRetryInputSchema } from './operation-retry-schema.ts'
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { simulationRunSpecSchema } from '@clocky/clocky-simulation'
import { productPrincipalId } from '@clocky/clocky-product-principal'
import { simulationCompanyPreparationSchema } from './company-preparation.ts'
import { simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema } from './maintenance-schema.ts'
import { simulationCompanyDriverSchema } from './company-driver.ts'
import { simulationProductRecordSchema } from './directory.ts'
import { simulationProductTemplateIdSchema, simulationProductCreateInputSchema, simulationProductPrepareInputSchema,
  simulationProductRequestReceiptSchema, simulationProductLimitKeySchema } from './administration-schema.ts'
import type { SimulationCompanyTemplate, SimulationCompanyCreation, SimulationCreationCommand } from './creation-types.ts'

const templateSpec = z.record(z.string(), z.unknown()).transform((value, ctx) => {
  if (Object.hasOwn(value, 'runId')) { ctx.addIssue({ code: 'custom', message: 'Template spec cannot allocate a native run identity' }); return z.NEVER }
  const result = simulationRunSpecSchema.safeParse({ ...value, runId: 'template-validation' })
  if (!result.success) { ctx.addIssue({ code: 'custom', message: 'Template native spec is invalid' }); return z.NEVER }
  const { runId: _runId, ...spec } = result.data
  return spec
})
/** A catalog entry must carry its installed driver, strict parameters and complete native capacity policy. */
export const simulationCompanyTemplateSchema = z.strictObject({ id: simulationProductTemplateIdSchema, version: z.literal('1'),
  name: z.string().trim().min(1), provider: z.string().trim().min(1), spec: templateSpec,
  preset: z.string().trim().min(1), objective: z.string().trim().min(1), driver: simulationCompanyDriverSchema,
  checkpoint: z.strictObject({ maxDrainRounds: z.number().int().positive(), maxAttempts: z.number().int().positive() }),
  editableLimits: z.array(simulationProductLimitKeySchema).refine(values => new Set(values).size === values.length,
    'Editable allowance keys must be distinct').optional(),
}).refine(value => value.spec.rulesVersion === '1' && value.spec.policyVersion === '1'
  && value.spec.maxEntities >= 2 + (value.driver.scenario?.topology?.actors.length ?? 0)
  && (value.driver.tasks?.review !== 'buyer' && value.driver.scenario === undefined || value.spec.maxResidentActors >= 2)
  && BigInt(value.spec.maxResourceQuantity) >= 1n && BigInt(value.driver.completeDelay) <= BigInt(value.spec.maxTime),
'Company template does not support its retained native policy/capacity') satisfies z.ZodType<SimulationCompanyTemplate>
/** Original complete private resolution; regeneration from changed template configuration is forbidden. */
export const simulationCompanyCreationSchema = z.strictObject({ record: simulationProductRecordSchema,
  request: simulationProductCreateInputSchema, preparation: simulationCompanyPreparationSchema, driver: simulationCompanyDriverSchema,
}).refine(value => value.record.name === value.request.name && value.record.id === String(value.record.spec.runId)
  && value.preparation.ownerName === `simulation-product/${value.record.id}`
  && value.preparation.checkpoint.id === `product-initial/${value.request.commandId}`
  && value.preparation.buyerName === value.request.parameters.buyerName
  && value.preparation.supplierName === value.request.parameters.supplierName
  && value.preparation.initialStock === value.request.parameters.initialStock
  && isDeepStrictEqual(value.preparation.topology, value.driver.scenario?.topology)
  && value.record.spec.maxEntities >= 2 + (value.preparation.topology?.actors.length ?? 0)
  && Object.entries(value.request.limits ?? {}).every(([key, amount]) => amount === undefined
    || value.record.spec[key as keyof typeof value.record.spec] === amount)
  && (value.driver.tasks?.review !== 'buyer' && value.driver.scenario === undefined || value.record.spec.maxResidentActors >= 2)
  && value.preparation.participant.model === `${value.driver.model.provider}/${value.driver.model.name}`
  && BigInt(value.preparation.initialStock) <= BigInt(value.record.spec.maxResourceQuantity),
'Creation resolution does not match its original identity and payload') satisfies z.ZodType<SimulationCompanyCreation>

const base = { ownerPrincipalId: z.string().min(1).transform(productPrincipalId), receipt: simulationProductRequestReceiptSchema }
/** Every original command binds its exact payload and authenticated owning principal. */
export const simulationCreationCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), ...base, input: simulationProductCreateInputSchema, creation: simulationCompanyCreationSchema }),
  z.strictObject({ kind: z.literal('prepare'), ...base, input: simulationProductPrepareInputSchema }),
  z.strictObject({ kind: z.literal('checkpoint'), ...base, input: simulationProductCheckpointInputSchema }),
  z.strictObject({ kind: z.literal('restore'), ...base, input: simulationProductRestoreInputSchema }),
  z.strictObject({ kind: z.literal('review'), ...base, input: simulationProductTaskReviewResolveInputSchema }),
  z.strictObject({ kind: z.literal('cancel-task'), ...base, input: simulationProductTaskCancelInputSchema }),
  z.strictObject({ kind: z.literal('retry-operation'), ...base, input: simulationProductOperationRetryInputSchema }),
]).refine(value => value.kind === value.receipt.kind && value.input.commandId === value.receipt.commandId
  && (value.kind !== 'create' ? value.input.runId === value.receipt.runId
    : value.creation.record.id === value.receipt.runId && value.creation.record.ownerPrincipalId === value.ownerPrincipalId
      && value.creation.record.registeredAt === value.receipt.acceptedAt
      && JSON.stringify(value.input) === JSON.stringify(value.creation.request)),
'Administration receipt does not match its original command').refine(value =>
  value.kind === 'checkpoint' ? value.receipt.checkpointId === `product-checkpoint/${value.input.commandId}`
    : value.kind !== 'restore' || value.receipt.checkpointId === value.input.checkpointId,
'Maintenance checkpoint identity differs from its original command') satisfies z.ZodType<SimulationCreationCommand>
