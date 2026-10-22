/** Browser-safe original scenario initialization; no accepted model operation exposes these owner capabilities. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationResourceSpecSchema } from './business.ts'
import { simTimeSchema } from './time.ts'
import { simulationWorldFactAudienceSchema, worldFactIdSchema } from './world-facts.ts'
import { simulationKnowledgeIdSchema } from './knowledge.ts'
import { simulationInitialNormSchema, simulationFrozenCommitteePolicySchema } from './world-norms.ts'
import { simulationWorldDefinitionSchema } from './world.ts'
import { simulationWorldDomainSelectorSchema } from './world-domain.ts'
import { simulationWorldCalendarSchema, simulationWorldGoalTargetSchema,
  worldCalendarIdSchema, worldDirectorEventIdSchema, simulationCalendarRevisionSchema, simulationCalendarCommandSchema, simulationWorldCalendarOccurrenceSchema } from './world-calendar.ts'
export { simulationWorldCalendarSchema, simulationWorldGoalTargetSchema, worldCalendarIdSchema } from './world-calendar.ts'

const text = z.string().min(1)
const key = text.max(256)
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/)
const interval = { validFrom: simTimeSchema, validUntil: simTimeSchema.nullable() }
/** Initial facts have the actual scenario owner as source; no imported history or foreign source is accepted. */
export const simulationWorldInitialFactSchema = z.strictObject({ id: worldFactIdSchema,
  subjectId: simulationEntityIdSchema, scopeId: simulationEntityIdSchema, body: text,
  effectiveFrom: simTimeSchema, effectiveUntil: simTimeSchema.nullable(), availableAt: simTimeSchema,
  audience: simulationWorldFactAudienceSchema,
}).refine(value => value.effectiveUntil === null || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom),
  'Initial fact interval must be nonempty')
/** Authored private knowledge is a belief under its original initial profile, never an inferred observation. */
export const simulationWorldInitialKnowledgeSchema = z.strictObject({ id: simulationKnowledgeIdSchema,
  ownerId: simulationEntityIdSchema, body: text, observedAt: simTimeSchema, availableAt: simTimeSchema,
  ...interval, readers: z.array(simulationEntityIdSchema)
    .refine(values => new Set(values).size === values.length, 'Initial knowledge readers must be distinct'),
}).refine(value => value.validUntil === null || BigInt(value.validUntil) > BigInt(value.validFrom),
  'Initial knowledge interval must be nonempty')
/** Preconfigured external identity is authored simulation state and cannot select real adapters. */
export const simulationWorldInitialExternalIdentitySchema = z.strictObject({ scopeId: simulationEntityIdSchema,
  externalKey: key.regex(/^[\p{L}\p{N}._-]+$/u), subjectId: simulationEntityIdSchema,
  representation: z.enum(['simulated-rule', 'simulated-actor', 'director-mediated']),
})
/** Complete supported initial data; no field can be silently dropped when bootstrap is retried. */
export const simulationWorldInitialDataSchema = z.strictObject({ resources: z.array(simulationResourceSpecSchema),
  facts: z.array(simulationWorldInitialFactSchema), knowledge: z.array(simulationWorldInitialKnowledgeSchema),
  norms: z.array(simulationInitialNormSchema), committeePolicies: z.array(simulationFrozenCommitteePolicySchema),
  externalIdentities: z.array(simulationWorldInitialExternalIdentitySchema),
  behavior: z.strictObject({ initialGoals: z.array(z.strictObject({ id: key, kind: z.literal('goal'), at: simTimeSchema,
    target: simulationWorldGoalTargetSchema, body: text })), calendars: z.array(simulationWorldCalendarSchema),
  directorEvents: z.array(z.strictObject({ id: worldDirectorEventIdSchema, calendarId: worldCalendarIdSchema,
    maxRequests: cursor.positive(),
    ...simulationWorldDomainSelectorSchema.shape, scopeId: simulationEntityIdSchema, targetId: simulationEntityIdSchema })) }),
})
/** Immutable complete bootstrap input; the product command owns its original portable definition commitment. */
export const simulationWorldBootstrapRequestSchema = z.strictObject({ definitionHash: hash,
  definition: simulationWorldDefinitionSchema, actorIds: z.array(simulationEntityIdSchema).min(1)
    .refine(values => new Set(values).size === values.length, 'Bootstrap actors must be distinct'),
  data: simulationWorldInitialDataSchema,
})
/** Durable initialization source remains present after effects and checkpoint publication. */
export const simulationWorldBootstrapBookSchema = z.strictObject({ request: simulationWorldBootstrapRequestSchema,
  sequence: cursor.positive(), status: z.enum(['retained', 'applied']), appliedSequence: cursor.positive().optional(),
  occurrences: z.array(simulationWorldCalendarOccurrenceSchema),
  calendarRevisions: z.array(simulationCalendarRevisionSchema).optional(),
  calendarCommands: z.array(simulationCalendarCommandSchema).optional(),
}).refine(value => (value.status === 'applied') === (value.appliedSequence !== undefined),
  'Only applied bootstrap has its actual complete batch sequence')
