import { simulationGenerationJobIdSchema } from './generation-identities.ts'
import { simulationWorldAuthenticatedUserSourceSchema } from './world-management-source.ts'
import { simulationWorldEvidenceAskSchema, worldEvidenceChallengeIdSchema } from './world-evidence.ts'
import { personnelPositionPermissionSchema } from './world-role-permissions.ts'
import { simulationExternalMediatedPolicyParametersSchema } from './world-external-mediated-policy.ts'
/** Pure world input schemas; Native admission owns identity, authority, template selection and capacity checks. */
import { z } from 'zod'
import { simulationEntityIdSchema, simulationRelationIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { simulationWorldDomainRequestSchema, simulationWorldDomainPinSchema, simulationWorldDomainSelectorSchema,
  simulationWorldEvidenceRefSchema,
  worldIntentIdSchema } from './world-domain.ts'
import type { WorldPlanId, WorldRequestId, WorldResultId, WorldCancelId, SimulationWorldResult } from './world-types.ts'
import type { SimulationEventId, SimulationDecisionId } from './identities.ts'
import { simulationWorldDirectorTriggerSchema } from './world-calendar.ts'
import { simulationHiringFeePolicySchema } from './world-hiring-resources.ts'

/** Installed organization hiring operation identity; other operations have their own registered definitions. */
export const SIMULATION_WORLD_HIRE_OPERATION = 'organization.generate-and-hire/v1' as const

/** Request identity derived by Native from the accepted decision and logical operation position. */
export const worldRequestIdSchema = z.string().min(1).transform(value => value as WorldRequestId)
/** Immutable plan identity retained across execution retries. */
export const worldPlanIdSchema = z.string().min(1).transform(value => value as WorldPlanId)
/** Stable terminal result identity derived from the original domain business intent. */
export const worldResultIdSchema = z.string().min(1).transform(value => value as WorldResultId)
/** Original cancellation command identity; changing its request is forbidden. */
export const worldCancelIdSchema = z.string().min(1).transform(value => value as WorldCancelId)

const text = z.string().min(1)
const positiveInteger = z.number().int().positive()
const options = z.array(text).refine(values => new Set(values).size === values.length, 'Duplicate options are not allowed')
const operationKey = (value: z.infer<typeof simulationWorldDomainSelectorSchema>): string =>
  JSON.stringify([value.domain, value.operation, value.version])

/** Trusted recorded goal wake; ordinary communication text cannot impersonate this scheduler input. */
export const simulationWorldGoalSchema = z.strictObject({ kind: z.literal('world-goal'), version: z.literal(1), goal: text })

/** Complete selected persona; Native verifies every value against the referenced frozen template. */
export const simulationWorldPersonaSchema = z.strictObject({
  name: text,
  skills: options,
  traits: options,
  goals: options,
})

/** Trusted finite persona options and public description; director rationale is never a description source. */
export const simulationWorldTemplateSchema = z.strictObject({
  id: text,
  version: text,
  names: options.min(1),
  skills: options,
  traits: options,
  goals: options,
  description: text,
})

/** Explicit versioned operation grant; Native verifies its entity scope and exact live authority relation. */
export const simulationWorldOperationGrantSchema = z.strictObject({
  ...simulationWorldDomainSelectorSchema.shape,
  requesterEntityId: simulationEntityIdSchema,
  scopeEntityId: simulationEntityIdSchema,
  targetEntityId: simulationEntityIdSchema,
  relationId: simulationRelationIdSchema,
  relation: text,
})

/** Frozen operation manifest and domain policy; Native verifies installation and live authority. */
export const simulationWorldDefinitionSchema = z.strictObject({
  /** Versioned model presentation; absent retains the original replay representation. */
  modelProtocol: z.literal('bounded-v1').optional(),
  /** Explicit one-time charges; absence means no financial promise, rather than an invented fee. */
  hiringFees: z.array(simulationHiringFeePolicySchema).optional(),
  /** Explicit frozen adjudication policy; installing mediation without it rejects before accepted work. */
  externalAdjudicationPolicy: simulationExternalMediatedPolicyParametersSchema.optional(),
  directorEntityId: simulationEntityIdSchema,
  organizationEntityId: simulationEntityIdSchema,
  operations: z.array(simulationWorldDomainPinSchema).min(1)
    .refine(values => new Set(values.map(operationKey)).size === values.length, 'Duplicate operation selectors are not allowed'),
  positionRolePermissions: z.array(personnelPositionPermissionSchema),
  operationGrants: z.array(simulationWorldOperationGrantSchema)
    .refine(values => new Set(values.map(value => JSON.stringify([value.requesterEntityId,
      operationKey(value), value.scopeEntityId, value.targetEntityId]))).size === values.length,
    'Duplicate operation grants are not allowed'),
  positions: z.array(z.strictObject({
    entityId: simulationEntityIdSchema,
    capacity: positiveInteger,
  })).min(1).refine(values => new Set(values.map(value => value.entityId)).size === values.length, 'Duplicate positions are not allowed'),
  authorizations: z.array(z.strictObject({
    requesterEntityId: simulationEntityIdSchema,
    positionEntityId: simulationEntityIdSchema,
    relationId: simulationRelationIdSchema,
  })).refine(values => new Set(values.map(value =>
    JSON.stringify([value.requesterEntityId, value.positionEntityId]))).size === values.length,
  'Duplicate requester and position authorizations are not allowed')
    .refine(values => new Set(values.map(value => value.relationId)).size === values.length,
      'Duplicate authorization relations are not allowed'),
  templates: z.array(simulationWorldTemplateSchema).min(1)
    .refine(values => new Set(values.map(value => value.id)).size === values.length, 'Duplicate template identities are not allowed'),
  policyVersion: text,
  limits: z.strictObject({
    maxRequests: positiveInteger,
    /** Distinct accepted requests per actor in each Native budgetInterval; terminal cases stay charged. */
    maxRequestsPerActorPerInterval: positiveInteger,
    /** First preparation attempts per simulated budgetInterval; zero disables dynamic births. */
    maxBirthsPerInterval: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** First representative preparation attempts per simulated budgetInterval; zero disables expansion. */
    maxExternalExpansionsPerInterval: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** Structural mutation concurrency is frozen at one until multi-mutation recovery is supported. */
    maxPendingMutations: z.literal(1),
    /** Accepted evidence challenges per original request; zero disables missing-evidence rounds. */
    maxEvidenceAttemptsPerRequest: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    maxPlansPerRequest: positiveInteger,
    maxBytesPerRequest: positiveInteger,
    maxBytesPerPlan: positiveInteger,
  }),
}).superRefine((definition, context) => {
  const fees = definition.hiringFees ?? []
  if (new Set(fees.map(value => JSON.stringify([value.operation, value.positionEntityId]))).size !== fees.length
    || new Set(fees.map(value => value.id)).size !== fees.length)
    context.addIssue({ code: 'custom', path: ['hiringFees'], message: 'Hiring fees require unique policy and operation/position identities' })
  fees.forEach((fee, index) => {
    if (!definition.positions.some(value => value.entityId === fee.positionEntityId)
      || !definition.operations.some(value => value.domain === 'organization' && value.operation === fee.operation && value.version === '1'))
      context.addIssue({ code: 'custom', path: ['hiringFees', index], message: 'Hiring charge requires its declared position and installed operation' })
  })
  const operations = new Set(definition.operations.map(operationKey))
  definition.operationGrants.forEach((grant, index) => {
    if (!operations.has(operationKey(grant))) {
      context.addIssue({ code: 'custom', path: ['operationGrants', index], message: 'Grant must reference a declared operation version' })
    }
  })
  const declaredPositions = new Set(definition.positions.map(value => value.entityId))
  if (new Set(definition.positionRolePermissions.map(value => value.positionEntityId)).size !== definition.positionRolePermissions.length)
    context.addIssue({ code: 'custom', path: ['positionRolePermissions'], message: 'Role permission positions must be distinct' })
  definition.positionRolePermissions.forEach((role, index) => {
    if (new Set(role.permissions.map(value => JSON.stringify(value))).size !== role.permissions.length)
      context.addIssue({ code: 'custom', path: ['positionRolePermissions', index, 'permissions'], message: 'Role permissions must be distinct' })
    if (!declaredPositions.has(role.positionEntityId)) context.addIssue({ code: 'custom',
      path: ['positionRolePermissions', index, 'positionEntityId'], message: 'Role permissions require a declared position' })
    for (const permission of role.permissions) {
      if (!operations.has(operationKey(permission)) || permission.scopeEntityId !== definition.organizationEntityId)
        context.addIssue({ code: 'custom', path: ['positionRolePermissions', index], message: 'Role permission operation and scope must be declared' })
    }
  })
  const positions = new Set(definition.positions.map(position => position.entityId))
  definition.authorizations.forEach((authorization, index) => {
    if (!positions.has(authorization.positionEntityId)) {
      context.addIssue({ code: 'custom', path: ['authorizations', index, 'positionEntityId'],
        message: 'Authorization must reference a declared position' })
    }
  })
})

/** Trusted application input; Native derives the intent identity and validates the requesting actor. */
export const simulationHireIntentRequestSchema = z.strictObject({
  organizationEntityId: simulationEntityIdSchema,
  positionEntityId: simulationEntityIdSchema,
  requesterEntityId: simulationEntityIdSchema,
  applicationId: text,
  priorRequestId: worldRequestIdSchema.optional(),
})

/** Core-owned immutable domain intent; Native derives its requester, scope and business identity. */
const worldIntentFields = {
  id: worldIntentIdSchema,
  pin: simulationWorldDomainPinSchema,
  businessKey: text,
  requesterEntityId: simulationEntityIdSchema,
  scopeEntityId: simulationEntityIdSchema,
  targetEntityId: simulationEntityIdSchema,
  expectedTime: simTimeSchema.nullable(),
  evidence: z.array(simulationWorldEvidenceRefSchema),
  description: text,
  payload: z.json(),
  sequence: positiveInteger,
  requestId: worldRequestIdSchema.optional(),
  scenarioTrigger: simulationWorldDirectorTriggerSchema.optional(),
}
/** Strict disjoint sources: user commands cannot select a role requester or scenario trigger. */
export const simulationWorldRoleIntentSchema = z.strictObject({ ...worldIntentFields, requesterEntityId: simulationEntityIdSchema })
/** All persisted intents accept exactly their actual actor or authenticated-user branch. */
export const simulationWorldIntentSchema = z.union([
  simulationWorldRoleIntentSchema,
  z.strictObject({ ...worldIntentFields, requesterEntityId: z.null(), source: simulationWorldAuthenticatedUserSourceSchema,
    scenarioTrigger: z.never().optional() }),
])

/** Model-proposed domain envelope; installed payload schemas and Native derive its actor and business intent. */
export const simulationWorldRequestOperationSchema = simulationWorldDomainRequestSchema

/** Safe structured reasons for public result rendering, independent of private director rationale. */
export const simulationWorldRejectionReasonSchema = z.enum(['insufficient-information', 'unauthorized', 'capacity-full',
  'unsupported', 'policy'])

/** Trusted original cancellation command; this is never a model operation. */
export const simulationWorldCancelRequestSchema = z.strictObject({
  id: worldCancelIdSchema,
  requestId: worldRequestIdSchema,
})

/** Native-owned terminal result, including its safe notification responsibility and causal source. */
export const simulationWorldResultSchema = z.strictObject({
  id: worldResultIdSchema,
  requestId: worldRequestIdSchema,
  intentId: worldIntentIdSchema,
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('plan'), planId: worldPlanIdSchema }),
    z.strictObject({ kind: z.literal('cancel'), commandId: worldCancelIdSchema }),
    z.strictObject({ kind: z.literal('evidence-exhausted'), challengeId: worldEvidenceChallengeIdSchema,
      decisionId: z.string().min(1).transform(value => value as SimulationDecisionId) }),
    z.strictObject({ kind: z.literal('evidence-deadline'), challengeId: worldEvidenceChallengeIdSchema,
      eventId: z.string().min(1).transform(value => value as SimulationEventId) }),
  ]),
  outcome: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('rejected'), reason: simulationWorldRejectionReasonSchema }),
    z.strictObject({ kind: z.literal('cancelled') }),
    z.strictObject({ kind: z.literal('committed') }),
  ]),
  payload: z.json(),
  time: simTimeSchema,
  sequence: z.number().int().positive(),
}).superRefine((result, context) => {
  if ((result.source.kind === 'evidence-deadline' || result.source.kind === 'evidence-exhausted')
    && (result.outcome.kind !== 'rejected' || result.outcome.reason !== 'insufficient-information'))
    context.addIssue({ code: 'custom', path: ['outcome'], message: 'Evidence expiry requires its original insufficient-information rejection' })
  if ((result.outcome.kind === 'cancelled') !== (result.source.kind === 'cancel')) {
    context.addIssue({ code: 'custom', path: ['source'],
      message: 'Cancellation results require their original cancellation command; other outcomes retain their original business source' })
  }
})

/** Cancellation outcome is retained separately from the business result and never replaces a prior terminal result. */
export const simulationWorldCancellationSchema = z.strictObject({
  request: simulationWorldCancelRequestSchema,
  status: z.enum(['cancel-requested', 'cancelled', 'already-resolved', 'already-committed']),
  resultId: worldResultIdSchema.optional(),
  sequence: z.number().int().positive(),
}).refine(value => (value.status === 'cancel-requested') === (value.resultId === undefined),
  'Only an unresolved cancellation omits the terminal result')

/** Trusted execution input; Native assigns the mutation identity and derives every core change. */
export const simulationWorldMutationCommitRequestSchema = z.strictObject({ planId: worldPlanIdSchema, payload: z.json() })

/** Common director disposition; installed domains parse apply payloads and verify business constraints. */
export const simulationWorldResolutionSchema = z.discriminatedUnion('kind', [
  simulationWorldEvidenceAskSchema,
  z.strictObject({
    kind: z.literal('apply'),
    payload: z.json(),
    rationale: text,
  }),
  z.strictObject({
    kind: z.literal('reject'),
    reason: simulationWorldRejectionReasonSchema,
    rationale: text,
  }),
])

/** Director proposal only; acceptance does not imply execution or public disclosure of rationale. */
export const simulationWorldResolveOperationSchema = z.strictObject({
  kind: z.literal('world/resolve'),
  generationJobId: simulationGenerationJobIdSchema.exactOptional(),
  requestId: worldRequestIdSchema,
  supersedes: worldPlanIdSchema.nullable(),
  resolution: simulationWorldResolutionSchema,
})

/** Trusted context selection; Native supplies private planning reads or immutable terminal result facts. */
export const simulationWorldContextRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('evidence'), challengeId: worldEvidenceChallengeIdSchema }),
  z.strictObject({ kind: z.literal('director-event') }),
  z.strictObject({ kind: z.literal('scenario-resolve'), requestId: worldRequestIdSchema }),
  z.strictObject({ kind: z.literal('scenario-result'), resultId: worldResultIdSchema, externalEventId: z.string().min(1).transform(value => value as SimulationEventId).optional() }),
  z.strictObject({ kind: z.literal('goal') }),
  z.strictObject({ kind: z.literal('request'), intentId: worldIntentIdSchema }),
  z.strictObject({ kind: z.literal('resolve'), requestId: worldRequestIdSchema }),
  z.strictObject({ kind: z.literal('result'), resultId: worldResultIdSchema,
    externalEventId: z.string().min(1).transform(value => value as SimulationEventId).optional() }),
  z.strictObject({ kind: z.literal('first-action'), resultId: worldResultIdSchema }),
])
/** Trusted Native context selection; model tools cannot select another actor or a hidden source. */
export type SimulationWorldContextRequest = z.infer<typeof simulationWorldContextRequestSchema>

/**
 * Render the immutable result index and its bounded public outcome without including private plan text.
 * @param result - Original Native terminal result.
 * @returns deterministic JSON for the exact model-submitted result notification.
 */
export function worldResultNotification(result: SimulationWorldResult): string {
  const outcome = result.outcome
  switch (outcome.kind) {
    case 'committed': return JSON.stringify({ resultId: result.id, outcome: { kind: outcome.kind }, payload: result.payload })
    case 'rejected': return JSON.stringify({ resultId: result.id, outcome: { kind: outcome.kind, reason: outcome.reason },
      payload: result.payload })
    case 'cancelled': return JSON.stringify({ resultId: result.id, outcome: { kind: outcome.kind }, payload: result.payload })
    default: return assertNever(outcome)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown world result outcome: ${String(value)}`)
}

/** Stable Native world failure categories; private error text is not a public result body. */
export const simulationWorldFailureCodeSchema = z.enum([
  'SIM_WORLD_NOT_CONFIGURED', 'SIM_WORLD_AUTHORITY', 'SIM_WORLD_CONTEXT', 'SIM_WORLD_DELIVERY',
  'SIM_WORLD_CONFLICT', 'SIM_WORLD_LIMIT', 'SIM_WORLD_TEMPLATE', 'SIM_WORLD_INTEGRITY',
])
