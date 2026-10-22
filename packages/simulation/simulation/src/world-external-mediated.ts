/** Strict director-mediated proposals and retained Native provenance. Kernel owners alone apply the closed effects. */
import { z } from 'zod'
import { simulationExternalClaimSchema } from './world-external-claims.ts'
export { simulationExternalClaimSchema } from './world-external-claims.ts'
import { channelIdSchema } from '@clocky/clocky-team/schema'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simulationQuantitySchema, simulationDecisionIdSchema, simulationResourceSpecSchema,
  simulationOperationIdSchema } from './business.ts'
import { simulationWorldDomainPinSchema, simulationWorldEvidenceRefSchema, worldIntentIdSchema,
  worldExternalIdentityIdSchema } from './world-domain.ts'
import { simulationWorldFinitePersonaSelectionSchema } from './world-domains.ts'
import { simulationTaskEvidenceSchema } from './task-evidence.ts'
import { simulationCommitmentIdSchema, simulationInteractionIdSchema } from './interaction.ts'
import { simulationPolicyRefSchema } from './deterministic.ts'
import { worldFactReferenceSchema, simulationWorldFactAudienceSchema, simulationWorldFactAdjudicatedRequestSchema,
  simulationWorldFactVersionSchema } from './world-facts.ts'
import { simTimeSchema } from './time.ts'
import { worldRequestIdSchema, worldPlanIdSchema, worldResultIdSchema } from './world.ts'
import { simulationEventIdSchema } from './scheduler.ts'


const text = z.string().min(1).max(4096)
const key = z.string().min(1).max(256).regex(/^[\p{L}\p{N}._-]+$/u)
const version = z.string().min(1).max(256)
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
import { WORLD_EXTERNAL_MEDIATION_POLICY_REF, simulationExternalMediatedPolicyParametersSchema } from './world-external-mediated-policy.ts'
export { WORLD_EXTERNAL_MEDIATION_POLICY_REF, WORLD_EXTERNAL_MEDIATION_FACT_SCHEMA_REF,
  simulationExternalMediatedPolicyParametersSchema } from './world-external-mediated-policy.ts'
/** Exact director-mediated operation; rule and actor request schemas keep their original interpretation. */
export const WORLD_EXTERNAL_MEDIATED_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'external',
  operation: 'interact', version: '3',
  schemaRef: 'clocky.external.interact.mediated/schema/1', implementationRef: 'clocky.external.interact.mediated/native/1',
  generation: 1 }))

/** Facts and commitments require new owner-comparable Core evidence/read-set variants, not a private shadow database. */
export const simulationExternalMediatedEvidenceSchema = simulationWorldEvidenceRefSchema
/** A proposed disclosure may narrow the frozen request/policy audience, never widen it. */
export const simulationExternalMediatedDisclosureSchema = z.union([z.strictObject({ kind: z.literal('requester') }),
  simulationWorldFactAudienceSchema])
/** Original subject, stable key, private question and bounded permitted outcome/disclosure scope. */
export const simulationExternalMediatedRequestSchema = z.strictObject({ scope: simulationEntityIdSchema, externalKey: key,
  subjectRef: simulationEntityIdSchema, sourceKind: z.literal('director-mediated'),
  policyRef: z.literal(WORLD_EXTERNAL_MEDIATION_POLICY_REF),
  input: z.strictObject({ kind: z.literal('adjudicate'), question: text, contactUnit: key.optional(), inventoryUnit: key.optional(),
    quoteScope: z.strictObject({ unit: key, currency: key }).optional() }),
  responseScope: z.strictObject({ allowed: z.array(z.enum(['environmental-fact', 'delayed-event', 'failure',
    'representative-preparation-plan', 'unverified-report'])).min(1)
    .refine(values => new Set(values).size === values.length, 'Outcome families must be distinct'),
  disclosure: simulationExternalMediatedDisclosureSchema }),
})
const common = { subjectRef: simulationEntityIdSchema, sourceKind: z.literal('director-mediated'),
  policyRef: z.literal(WORLD_EXTERNAL_MEDIATION_POLICY_REF),
  attribution: z.literal('scenario-generated'), evidence: z.array(simulationExternalMediatedEvidenceSchema),
  disclosure: simulationExternalMediatedDisclosureSchema }
/** An installed policy supplies the strict condition schema and declares its non-resource semantic key. */
/** Complete explicit deployment choices; a same pin cannot silently choose different parameters on open or replay. */
const factFields = { ...common, kind: z.literal('environmental-fact'), factKey: key,
  claim: simulationExternalClaimSchema, effectiveFrom: simTimeSchema, effectiveUntil: simTimeSchema.nullable() }
/** Proposed authoritative fact interval; Native independently verifies semantics and publication authority. */
export const simulationExternalMediatedFactOutcomeSchema = z.strictObject(factFields).refine(value => value.effectiveUntil === null
  || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom), 'Fact interval must end after its start')
/** Unverified quotations are explicit attributed reports. They have no authoritative fact or inventory effect. */
export const simulationExternalMediatedReportOutcomeSchema = z.strictObject({ ...common, kind: z.literal('unverified-report'),
  reliability: z.literal('unverified'),
  statement: text, quote: z.strictObject({ unit: key, quantity: simulationQuantitySchema,
    price: z.strictObject({ currency: key, quantity: simulationQuantitySchema }), validUntil: simTimeSchema.nullable() }) })
/** A typed narrative failure is distinct from the World protocol rejecting an invalid proposed adjudication. */
export const simulationExternalMediatedFailureOutcomeSchema = z.strictObject({ ...common, kind: z.literal('failure'),
  code: z.enum(['unavailable', 'declined', 'unsupported', 'dependency-unmet', 'expired']), description: text })
/** The original Actor owner must execute this exact finite plan; accepting this body alone never means ready. */
export const simulationExternalMediatedRepresentativeOutcomeSchema = z.strictObject({ ...common,
  kind: z.literal('representative-preparation-plan'),
  preparation: simulationWorldFinitePersonaSelectionSchema, contactUnit: key })
/** Delayed outcomes are single bounded leaves, not recursive event generators or unchecked scheduler actions. */
export const simulationExternalMediatedDelayedOutcomeSchema = z.strictObject({ ...common, kind: z.literal('delayed-event'), key,
  deliverAt: simTimeSchema, outcome: z.union([simulationExternalMediatedFactOutcomeSchema,
    simulationExternalMediatedReportOutcomeSchema, simulationExternalMediatedFailureOutcomeSchema]) })
/** Complete allowed outcome families, including an explicitly unverified report that has no Fact effect. */
export const simulationExternalAdjudicatedOutcomeSchema = z.union([simulationExternalMediatedFactOutcomeSchema,
  simulationExternalMediatedDelayedOutcomeSchema, simulationExternalMediatedFailureOutcomeSchema,
  simulationExternalMediatedRepresentativeOutcomeSchema, simulationExternalMediatedReportOutcomeSchema])
/** Original complete proposal; model output cannot supply actual Actor IDs, resource writes or cognition versions. */
export const simulationExternalMediatedPlanSchema = z.strictObject({ kind: z.literal('adjudicate'),
  outcome: simulationExternalAdjudicatedOutcomeSchema })
/** Closed execution instruction; all outcome and source material comes from the original accepted plan. */
export const simulationExternalMediatedMutationSchema = z.strictObject({ kind: z.literal('apply-original-adjudication') })

/** Native derives these fields from the actual accepted director decision, consumed view and original installed policy. */
export const simulationExternalMediatedBasisSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('model'), actorId: simulationEntityIdSchema, decisionId: simulationDecisionIdSchema,
    modelVersion: version, personaVersion: version, contextFingerprint: hash,
    policyRef: z.literal(WORLD_EXTERNAL_MEDIATION_POLICY_REF), policyVersion: version, policyFingerprint: hash }),
  z.strictObject({ kind: z.literal('policy'), actorId: simulationEntityIdSchema, decisionId: simulationDecisionIdSchema,
    policy: simulationPolicyRefSchema, contextFingerprint: hash,
    adjudicationPolicyRef: z.literal(WORLD_EXTERNAL_MEDIATION_POLICY_REF), policyVersion: version, policyFingerprint: hash }),
])
/** Captured actual historical inputs; current balances or later fact versions never replace this checked prefix. */
export const simulationExternalAdjudicationInputsSchema = z.strictObject({
  subject: z.strictObject({ id: simulationEntityIdSchema, revision: cursor.positive() }),
  resources: z.array(simulationResourceSpecSchema.extend({ revision: cursor.positive() })),
  commitments: z.array(z.strictObject({ id: simulationCommitmentIdSchema, interactionId: simulationInteractionIdSchema,
    debtor: simulationEntityIdSchema, creditor: simulationEntityIdSchema, revision: cursor.positive(),
    phase: z.enum(['open', 'fulfilled', 'cancelled']), createdBy: simulationOperationIdSchema,
    evidence: z.array(simulationOperationIdSchema),
    taskEvidence: simulationTaskEvidenceSchema.optional(), breachedAt: simTimeSchema.optional(), fulfilledAt: simTimeSchema.optional() })),
  facts: z.array(simulationWorldFactVersionSchema),
})
/** Persisted execution source lives inside the existing Native external registry and the original mutation/Actor journal. */
export const simulationExternalAdjudicationSchema = z.strictObject({ identityId: worldExternalIdentityIdSchema,
  intentId: worldIntentIdSchema,
  requestId: worldRequestIdSchema, planId: worldPlanIdSchema, request: simulationExternalMediatedRequestSchema,
  proposal: simulationExternalMediatedPlanSchema,
  basis: simulationExternalMediatedBasisSchema, policyParameters: simulationExternalMediatedPolicyParametersSchema,
  policyFingerprint: hash, actualEvidence: z.array(simulationExternalMediatedEvidenceSchema), time: simTimeSchema,
  recordedAt: cursor, sequence: cursor.positive(), actualInputs: simulationExternalAdjudicationInputsSchema,
  actualInputHash: hash, actualPublication: simulationWorldFactAdjudicatedRequestSchema.optional(),
  actualActor: z.strictObject({ identityId: worldExternalIdentityIdSchema, entityId: simulationEntityIdSchema,
    relationId: simulationRelationIdSchema,
    generation: z.literal(1), contactUnit: key, requesterEntityId: simulationEntityIdSchema, channelId: channelIdSchema,
    committedSequence: cursor.positive() }).optional() })
/** Actual Actor commit uses these refs in the same append as ready/represents/result/wake. Model output cannot assign them. */
export const simulationExternalMediatedReadyActorSchema = z.strictObject({ identityId: worldExternalIdentityIdSchema,
  entityId: simulationEntityIdSchema, relationId: simulationRelationIdSchema, generation: z.literal(1), contactUnit: key,
  requesterEntityId: simulationEntityIdSchema, channelId: channelIdSchema })
/** Original finite scheduled duty; event identity is derived from the original intent/key by Native, never chosen by the proposal. */
export const simulationExternalAdjudicatedEventOriginalSchema = z.strictObject({ eventId: simulationEventIdSchema,
  intentId: worldIntentIdSchema,
  requestId: worldRequestIdSchema, planId: worldPlanIdSchema, identityId: worldExternalIdentityIdSchema,
  adjudicationSequence: cursor.positive(), key, deliverAt: simTimeSchema,
  leaf: z.union([simulationExternalMediatedFactOutcomeSchema, simulationExternalMediatedReportOutcomeSchema,
    simulationExternalMediatedFailureOutcomeSchema]), leafHash: hash,
  policyFingerprint: hash, evidence: z.array(simulationExternalMediatedEvidenceSchema), initialResultId: worldResultIdSchema })
/** Finite delayed responsibility; only actual consumption has a captured result and publication, while blocks retain the duty. */
export const simulationExternalAdjudicatedEventStateSchema = z.strictObject({ original: simulationExternalAdjudicatedEventOriginalSchema,
  status: z.enum(['scheduled', 'blocked', 'consumed']), blocks: z.array(z.strictObject({ sequence: cursor.positive(), time: simTimeSchema,
    code: z.enum(['source-change', 'authority-conflict', 'fact-conflict', 'resource-conflict', 'contract-conflict',
      'policy-mismatch', 'disclosure-invalid']), currentReadSetHash: hash })),
  consumption: z.strictObject({ sequence: cursor.positive(), time: simTimeSchema, checkedInputHash: hash, leafHash: hash,
    publicationRefs: z.array(z.union([worldFactReferenceSchema, z.strictObject({ kind: z.literal('report'),
      intentId: worldIntentIdSchema })])),
    actualPublication: simulationWorldFactAdjudicatedRequestSchema.optional(), resultPayload: z.lazy(() =>
      simulationExternalMediatedResultSchema) }).optional(),
}).refine(value => (value.status === 'consumed') === (value.consumption !== undefined),
  'Only consumed events have a completed leaf; blocked responsibilities remain retained')

/** Safe terminal outcome uses refs only where the original Native owner has actually committed them. */
export const simulationExternalMediatedResultSchema = z.union([z.strictObject({ identityId: worldExternalIdentityIdSchema,
  subjectRef: simulationEntityIdSchema, sourceKind: z.literal('director-mediated'), attribution: z.literal('scenario-generated'),
  policyRef: z.literal(WORLD_EXTERNAL_MEDIATION_POLICY_REF), policyVersion: version, policyFingerprint: hash,
  adjudicatorEntityId: simulationEntityIdSchema,
  evidence: z.array(simulationExternalMediatedEvidenceSchema), disclosure: simulationExternalMediatedDisclosureSchema,
  outcome: z.union([
    z.strictObject({ kind: z.literal('environmental-fact'), fact: worldFactReferenceSchema }),
    z.strictObject({ kind: z.literal('unverified-report'), reliability: z.literal('unverified'), statement: text,
      quote: simulationExternalMediatedReportOutcomeSchema.shape.quote }),
    z.strictObject({ kind: z.literal('failure'), code: simulationExternalMediatedFailureOutcomeSchema.shape.code, description: text }),
    z.strictObject({ kind: z.literal('delayed-event'), eventId: simulationEventIdSchema, deliverAt: simTimeSchema,
      status: z.literal('scheduled') }),
    z.strictObject({ kind: z.literal('representative-prepared'), actual: simulationExternalMediatedReadyActorSchema }),
  ]),
}), z.strictObject({})])
/** Closed owner capability names the original intent/plan; it cannot select a new outcome or sender. */
export const simulationExternalMediatedEffectSchema = z.strictObject({ kind: z.literal('external/adjudicate-original'),
  intentId: worldIntentIdSchema, planId: worldPlanIdSchema })
/** Strict request, plan, mutation and safe result parsers for the original installed operation. */
export const WORLD_EXTERNAL_MEDIATED_DEFINITION = Object.freeze({ domain: 'external', operation: 'interact', version: '3',
  directorEvents: true as const,
  schemaRef: WORLD_EXTERNAL_MEDIATED_PIN.schemaRef,
  schemas: Object.freeze({ request: simulationExternalMediatedRequestSchema, plan: simulationExternalMediatedPlanSchema,
    mutation: simulationExternalMediatedMutationSchema, result: simulationExternalMediatedResultSchema }) })
