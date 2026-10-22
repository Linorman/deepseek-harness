/** Browser-safe strict envelopes; registered payload parsers and Native admission complete validation. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { worldFactReferenceSchema } from './world-facts-identities.ts'
import { simulationCommitmentIdSchema } from './interaction.ts'
import { simulationResourceIdSchema, simulationGrantIdSchema } from './resource.ts'
import { simulationHiringFeePolicyIdSchema } from './world-hiring-resources.ts'
import type { WorldPlanId, WorldRequestId, WorldResultId } from './world-types.ts'
import type {
  WorldIntentId, WorldMutationId, WorldSchemaRef, WorldImplementationRef, WorldResourceId, WorldDefinitionId,
  WorldAuthorityId, WorldNormId, WorldProposalId, WorldResolutionId, WorldExternalIdentityId,
} from './world-domain-types.ts'

const text = z.string().min(1)
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const worldPlanIdSchema = text.transform(value => value as WorldPlanId)
const worldRequestIdSchema = text.transform(value => value as WorldRequestId)
const worldResultIdSchema = text.transform(value => value as WorldResultId)

/** Native-assigned domain business identity. */
export const worldIntentIdSchema = text.transform(value => value as WorldIntentId)
/** Original durable mutation identity. */
export const worldMutationIdSchema = text.transform(value => value as WorldMutationId)
/** Exact registered schema artifact identity. */
export const worldSchemaRefSchema = text.transform(value => value as WorldSchemaRef)
/** Exact installed implementation artifact identity. */
export const worldImplementationRefSchema = text.transform(value => value as WorldImplementationRef)
/** Stable core resource identity. */
export const worldResourceIdSchema = text.transform(value => value as WorldResourceId)
/** Stable frozen world definition identity. */
export const worldDefinitionIdSchema = text.transform(value => value as WorldDefinitionId)
/** Stable authority grant identity. */
export const worldAuthorityIdSchema = text.transform(value => value as WorldAuthorityId)
/** Stable institution identity. */
export const worldNormIdSchema = text.transform(value => value as WorldNormId)
/** Stable governance proposal identity. */
export const worldProposalIdSchema = text.transform(value => value as WorldProposalId)
/** Stable governance resolution identity. */
export const worldResolutionIdSchema = text.transform(value => value as WorldResolutionId)
/** Stable external party identity. */
export const worldExternalIdentityIdSchema = text.transform(value => value as WorldExternalIdentityId)

/** Complete operation identity; there is no implicit version or operation fallback. */
export const simulationWorldDomainSelectorSchema = z.strictObject({ domain: text, operation: text, version: text })
/** Accepted plan implementation and schema pin. */
export const simulationWorldDomainPinSchema = z.strictObject({
  ...simulationWorldDomainSelectorSchema.shape,
  schemaRef: worldSchemaRefSchema,
  implementationRef: worldImplementationRefSchema,
  generation: sequence,
})

/** Owner-comparable typed references; hashes and revisions refer to exact retained records. */
export const simulationWorldEvidenceRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entity'), id: simulationEntityIdSchema, revision }),
  z.strictObject({ kind: z.literal('entity-profile'), id: simulationEntityIdSchema, revision, hash }),
  z.strictObject({ kind: z.literal('entity-binding'), id: simulationEntityIdSchema, hash }),
  z.strictObject({ kind: z.literal('relation-subject-set'), relation: text, subject: simulationEntityIdSchema, hash }),
  z.strictObject({ kind: z.literal('relation'), id: simulationRelationIdSchema, revision,
    effectiveFrom: simTimeSchema, effectiveUntil: simTimeSchema.nullable() }).refine(value =>
    value.effectiveUntil === null || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom),
  'Relation interval must end after its start'),
  z.strictObject({ kind: z.literal('relation-set'), relation: text, object: simulationEntityIdSchema,
    scope: simulationEntityIdSchema, hash }),
  z.strictObject({ kind: z.literal('resource-owner-set'), owner: simulationEntityIdSchema, unit: text, hash }),
  z.strictObject({ kind: z.literal('resource'), id: worldResourceIdSchema, revision }),
  z.strictObject({ kind: z.literal('resource-account'), id: simulationResourceIdSchema, hash }),
  z.strictObject({ kind: z.literal('resource-reservation-set'), resourceId: simulationResourceIdSchema, hash }),
  z.strictObject({ kind: z.literal('resource-grant-set'), ids: z.array(simulationGrantIdSchema), hash }),
  z.strictObject({ kind: z.literal('hiring-fee-policy'), id: simulationHiringFeePolicyIdSchema, version: text, hash }),
  z.strictObject({ kind: z.literal('world-input'), id: worldIntentIdSchema, revision: z.number().int().nonnegative(), hash }),
  z.strictObject({ kind: z.literal('world-definition'), id: worldDefinitionIdSchema, revision }),
  z.strictObject({ kind: z.literal('authority'), id: worldAuthorityIdSchema, generation: sequence }),
  z.strictObject({ kind: z.literal('norm'), id: worldNormIdSchema, version: text }),
  z.strictObject({ kind: z.literal('proposal'), id: worldProposalIdSchema, hash }),
  z.strictObject({ kind: z.literal('resolution'), id: worldResolutionIdSchema, hash }),
  z.strictObject({ kind: z.literal('external-representation'), id: worldExternalIdentityIdSchema, hash }),
  z.strictObject({ kind: z.literal('external'), id: worldExternalIdentityIdSchema, revision }),
  z.strictObject({ kind: z.literal('external-adjudication-policy'), policyRef: z.literal('clocky.external.adjudication/1'),
    generation: sequence, hash }),
  z.strictObject({ kind: z.literal('world-fact'), reference: worldFactReferenceSchema, hash }),
  z.strictObject({ kind: z.literal('world-fact-set'), subject: simulationEntityIdSchema, scope: simulationEntityIdSchema, hash }),
  z.strictObject({ kind: z.literal('commitment'), id: simulationCommitmentIdSchema, revision, hash }),
  z.strictObject({ kind: z.literal('commitment-party-set'), subject: simulationEntityIdSchema, hash }),
])

/** Read-set entries use the same exact references as evidence; owners compare their semantics. */
export const simulationWorldReadSetSchema = z.array(simulationWorldEvidenceRefSchema)
/** Proposed request body excludes caller identity, run, epoch, Session and durable IDs. */
export const simulationWorldDomainRequestSchema = z.strictObject({
  kind: z.literal('world/request'),
  ...simulationWorldDomainSelectorSchema.shape,
  businessKey: text,
  expectedTime: simTimeSchema.nullable(),
  evidence: z.array(simulationWorldEvidenceRefSchema),
  payload: z.json(),
})
/** Core-owned immutable accepted plan; payload holds the installed operation's complete plan. */
export const simulationWorldDomainPlanSchema = z.strictObject({
  kind: z.literal('world/plan'),
  id: worldPlanIdSchema,
  requestId: worldRequestIdSchema,
  intentId: worldIntentIdSchema,
  pin: simulationWorldDomainPinSchema,
  requestRevision: revision,
  supersedes: worldPlanIdSchema.nullable(),
  expectedTime: simTimeSchema.nullable(),
  reads: simulationWorldReadSetSchema,
  authority: z.array(simulationWorldEvidenceRefSchema),
  payload: z.json(),
})
/** Public core outcome distinguishes definite denial, unmet prerequisites and uncertain accepted IO. */
export const simulationWorldDomainOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('committed'), refs: z.array(simulationWorldEvidenceRefSchema) }),
  z.strictObject({ kind: z.literal('rejected'), reason: text }),
  z.strictObject({ kind: z.literal('blocked'), reason: text }),
  z.strictObject({ kind: z.literal('outcome-unknown'), mutationId: worldMutationIdSchema }),
])
/** Immutable result; unknown domain payloads cannot be interpreted without their installed schema. */
export const simulationWorldDomainResultSchema = z.strictObject({
  kind: z.literal('world/result'),
  id: worldResultIdSchema,
  requestId: worldRequestIdSchema,
  intentId: worldIntentIdSchema,
  planId: worldPlanIdSchema,
  pin: simulationWorldDomainPinSchema,
  outcome: simulationWorldDomainOutcomeSchema,
  time: simTimeSchema,
  sequence,
  payload: z.json(),
})
/** Original durable mutation responsibility; payload cannot bypass closed Native core transitions. */
export const simulationWorldDomainMutationSchema = z.strictObject({
  kind: z.literal('world/mutation'),
  id: worldMutationIdSchema,
  requestId: worldRequestIdSchema,
  planId: worldPlanIdSchema,
  pin: simulationWorldDomainPinSchema,
  time: simTimeSchema,
  sequence,
  recordedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  payload: z.json(),
})
/** Stable failure categories used before side effects or when a pinned responsibility cannot execute. */
export const simulationWorldDomainFailureCodeSchema = z.enum([
  'SIM_WORLD_DOMAIN_UNKNOWN', 'SIM_WORLD_OPERATION_UNKNOWN', 'SIM_WORLD_VERSION_UNAVAILABLE',
  'SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'SIM_WORLD_IMPLEMENTATION_MISMATCH', 'SIM_WORLD_SCHEMA',
  'SIM_WORLD_REGISTRATION_CONFLICT', 'SIM_WORLD_STALE', 'SIM_WORLD_AUTHORITY', 'SIM_WORLD_CONFLICT',
])
