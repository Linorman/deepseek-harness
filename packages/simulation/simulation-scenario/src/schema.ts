/** Browser-safe JSON boundaries for portable scenarios and caller-supplied installed catalog metadata. */
import { z } from 'zod'
import { teamLimitsSchema } from '@clocky/clocky-team/schema'
import { simulationWorldDefinitionSchema, simulationWorldPersonaSchema, simulationWorldTemplateSchema } from '@clocky/clocky-simulation/world'

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/)
const text = z.string().min(1)
const positive = z.number().int().positive()
const nonnegative = z.number().int().nonnegative()
const time = z.string().regex(/^(0|[1-9][0-9]*)$/)
const reference = z.strictObject({ id: key, version: text })
const role = z.enum(['director', 'member'])

/** Native numeric admission bounds; clock, storage selection and run identities belong to the creation owner. */
export const scenarioNativeLimitsSchema = z.strictObject({
  maxQueuedDecisions: positive, maxDispatchWaitRounds: positive, maxTokensPerInterval: nonnegative,
  tokensPerModelRequest: positive, maxDecisionsPerInterval: nonnegative, maxMessagesPerInterval: nonnegative,
  maxPendingEvents: nonnegative, maxPendingInteractions: nonnegative, maxResourceReservationHistory: positive, maxKnowledgeBytes: positive,
  maxKnowledgePerQuery: positive, maxEntities: positive, maxResidentActors: positive, maxIngressBytes: positive,
  maxConflictRetries: nonnegative, decisionTimeoutMs: positive, maxDecisionsPerWindow: positive,
  outboxMaxAttempts: positive, outboxRetryDelayMs: nonnegative, maxDriveSteps: positive,
  maxMicrostepsPerTime: positive, maxOperationsPerDecision: positive,
})

/** Explicit clock and protocol settings selected by the creation owner, with no storage route or run identity. */
export const scenarioNativeSettingsSchema = z.strictObject({
  tickUnit: text, origin: text, maxTime: time, rulesVersion: text,
  budgetInterval: time.refine(value => BigInt(value) > 0n, 'Budget interval must be positive'),
  maxResourceQuantity: time,
  phaseOrder: z.array(z.enum(['delivery', 'decision', 'deadline'])).length(3)
    .refine(values => new Set(values).size === values.length, 'Each scheduler phase must occur exactly once'),
})

/** Actual per-Team history and delivery bounds supplied by its deployment owner. */
export const scenarioTeamLimitsSchema = teamLimitsSchema
const worldLimits = simulationWorldDefinitionSchema.shape.limits
/** Fully explicit resolved limits; each field is capped independently by the installed catalog. */
export const scenarioLimitsSchema = z.strictObject({
  native: scenarioNativeLimitsSchema, team: scenarioTeamLimitsSchema, world: worldLimits,
})
const requestedLimits = z.strictObject({
  native: scenarioNativeLimitsSchema.partial().optional(), team: scenarioTeamLimitsSchema.partial().optional(),
  world: worldLimits.partial().optional(),
})

/** Portable creation definition; all runtime and template selections are installed versioned references. */
export const worldScenarioSchema = z.strictObject({
  apiVersion: z.literal('clocky.world/v0'),
  metadata: z.strictObject({ id: key, name: text, description: text }),
  organization: z.strictObject({ id: key, name: text, description: text }),
  positions: z.array(z.strictObject({ id: key, name: text, capacity: positive })).min(1),
  runtimeProfile: reference,
  templates: z.array(reference).min(1),
  actors: z.array(z.strictObject({ id: key, role, template: reference, runtimeProfile: reference.optional(),
    persona: simulationWorldPersonaSchema.partial().optional() })).min(2),
  assignments: z.array(z.strictObject({ id: key, personId: key, positionId: key })),
  authorizations: z.array(z.strictObject({ id: key, requesterId: key, positionId: key })),
  initialEvents: z.array(z.strictObject({ kind: z.literal('hire-request'), applicationId: key,
    requesterId: key, positionId: key, at: time, description: text })),
  limits: requestedLimits.optional(),
})

/** Installed runtime metadata is supplied by trusted callers; no profile is loaded or contacted by this package. */
export const scenarioRuntimeProfileSchema = z.strictObject({
  id: key, version: text, available: z.boolean(), roles: z.array(role).min(1)
    .refine(values => new Set(values).size === values.length, 'Duplicate profile roles are not allowed'),
  provider: key, preset: text, capabilities: z.array(text)
    .refine(values => new Set(values).size === values.length, 'Duplicate capabilities are not allowed'),
  model: z.strictObject({ provider: text, name: text, version: text, available: z.boolean() }),
})

/** Complete immutable compilation inputs; callers must change generation whenever installed policy or availability changes. */
export const scenarioCatalogSchema = z.strictObject({
  generation: text, policyVersion: text, native: scenarioNativeSettingsSchema,
  runtimeProfiles: z.array(scenarioRuntimeProfileSchema).min(1),
  templates: z.array(z.strictObject({ template: simulationWorldTemplateSchema, defaultPersona: simulationWorldPersonaSchema })).min(1),
  limits: z.strictObject({ defaults: scenarioLimitsSchema, ceilings: scenarioLimitsSchema }),
})
