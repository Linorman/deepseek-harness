/** Host-only effects are separate from simulated approvals and never carry credentials. */
import { z } from 'zod'
const id = z.string().min(1).max(128)
const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** A finite test action; adapters cannot acquire arbitrary action names through a request. */
export const externalEffectIntentSchema = z.strictObject({ effectId: id, adapterId: id, action: id, target: id,
  units, payload: z.string().max(16384), compensatesEffectId: id.optional() })
/** Explicit authorization for one exact intent, independently of simulated roles. */
export const externalEffectGrantSchema = z.strictObject({ grantId: id, effectId: id, action: id, target: id,
  maxUnits: units, expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), environment: z.literal('test') })
/** Provider observations identify the original request and its actual destination. */
export const externalEffectReceiptSchema = z.strictObject({ effectId: id, idempotencyKey: id, action: id,
  target: id, units, outcome: z.enum(['confirmed', 'failed']), receiptId: id })
/** Original durable authorization and reservation; unknown outcomes retain their units. */
export const externalEffectRecordSchema = z.strictObject({ intent: externalEffectIntentSchema, principalId: id,
  idempotencyKey: id, source: z.literal('real-test'), status: z.enum(['proposed', 'user-authorized', 'reserved', 'dispatched',
    'outcome-unknown', 'confirmed', 'failed', 'cancelled']),
  grant: externalEffectGrantSchema.extend({ principalId: id, credentialGeneration: units }).optional(),
  revoked: z.boolean(), receipt: externalEffectReceiptSchema.optional() })
/** Strict durable event format; older or unknown versions are refused by the stream owner. */
export const externalEffectEventSchema = z.strictObject({ version: z.literal(1), record: externalEffectRecordSchema })
/** Finite original effect request. */
export type ExternalEffectIntent = z.infer<typeof externalEffectIntentSchema>
/** Exact user authorization request. */
export type ExternalEffectGrant = z.infer<typeof externalEffectGrantSchema>
/** Validated provider result. */
export type ExternalEffectReceipt = z.infer<typeof externalEffectReceiptSchema>
/** Original request and current durable state, excluding secrets. */
export type ExternalEffectRecord = z.infer<typeof externalEffectRecordSchema>
