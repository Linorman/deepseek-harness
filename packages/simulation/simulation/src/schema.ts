/** JSON-boundary validation for durable run configuration. @module @clocky/clocky-simulation/schema */
import { z } from 'zod'
import { jsonObjectSchema } from '@clocky/clocky-team/schema'
import { simulationEntityIdSchema } from './entity.ts'
/** Run-local stable direct-channel retry key. */
export const simulationChannelKeySchema = z.string().min(1).transform(value => value as import('./identities.ts').SimulationChannelKey)
/** Frozen direct membership; a repeated entity cannot occupy two endpoints. */
export const simulationChannelSpecSchema: z.ZodType<import('./types.ts').SimulationChannelSpec> = z.strictObject({
  key: simulationChannelKeySchema,
  members: z.array(z.strictObject({ entityId: simulationEntityIdSchema, role: z.string().trim().min(1) })).min(2)
    .refine(members => new Set(members.map(member => member.entityId)).size === members.length, 'Channel members must be distinct'),
  limits: jsonObjectSchema,
})
import type { SimulationRunId, SimulationRunSelection, SimulationRunSpec } from './types.ts'

import { simTimeSchema } from './time.ts'
import { simulationRelationRuleSchema } from './entity.ts'
import { simulationQuantitySchema } from './business.ts'
import { simulationEventPhaseSchema } from './scheduler.ts'
/** Explicit local actor configuration persisted before Team invitation; unknown fields reject. */
export const simulationParticipantSpecSchema: z.ZodType<import('./entity-types.ts').SimulationParticipantSpec> = z.strictObject({
  displayName: z.string().trim().min(1), role: z.string().trim().min(1),
  capabilities: z.array(z.string().trim().min(1)).transform(values => [...new Set(values)].sort()),
  provider: z.string().trim().min(1), preset: z.string().trim().min(1), model: z.string().trim().min(1),
})
/** Stable nonempty run identity; file names are derived by the provider. */
export const simulationRunIdSchema = z.string().min(1).transform(value => value as SimulationRunId)
/** Persisted clock and policy configuration; unknown keys reject. */
export const simulationRunSpecSchema: z.ZodType<SimulationRunSpec> = z.strictObject({
  maxQueuedDecisions: z.number().int().positive(),
  maxDispatchWaitRounds: z.number().int().positive(),
  maxTokensPerInterval: z.number().int().nonnegative(),
  tokensPerModelRequest: z.number().int().positive(),
  budgetInterval: simTimeSchema.refine(value => BigInt(value) > 0n, 'Budget interval must be positive'),
  maxDecisionsPerInterval: z.number().int().nonnegative(),
  maxMessagesPerInterval: z.number().int().nonnegative(),
  maxPendingEvents: z.number().int().nonnegative(),
  maxPendingInteractions: z.number().int().nonnegative(),
  maxResourceReservationHistory: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxKnowledgeBytes: z.number().int().positive(),
  maxKnowledgePerQuery: z.number().int().positive(),
  maxEntities: z.number().int().positive(),
  maxResidentActors: z.number().int().positive(),
  maxIngressBytes: z.number().int().positive(),
  maxConflictRetries: z.number().int().nonnegative(),
  decisionTimeoutMs: z.number().int().positive(),
  maxDecisionsPerWindow: z.number().int().positive(),
  runId: simulationRunIdSchema,
  tickUnit: z.string().min(1),
  origin: z.string().min(1),
  maxTime: simTimeSchema,
  rulesVersion: z.string().min(1),
  policyVersion: z.string().min(1),
  outboxMaxAttempts: z.number().int().positive(),
  outboxRetryDelayMs: z.number().int().nonnegative(),
  maxDriveSteps: z.number().int().positive(),
  maxMicrostepsPerTime: z.number().int().positive(),
  phaseOrder: z.array(simulationEventPhaseSchema).length(3).refine(phases => new Set(phases).size === 3, 'Each scheduler phase must occur exactly once'),
  maxOperationsPerDecision: z.number().int().positive(),
  maxResourceQuantity: simulationQuantitySchema,
  relationRules: z.array(simulationRelationRuleSchema).refine(
    rules => new Set(rules.map(rule => rule.relation)).size === rules.length,
    'Simulation relation rules must have distinct names',
  ),
})
/** Complete run selection accepted at configuration and process boundaries. */
export const simulationRunSelectionSchema: z.ZodType<SimulationRunSelection> = z.strictObject({
  provider: z.string().min(1),
  spec: simulationRunSpecSchema,
  mode: z.enum(['create', 'open']),
})
