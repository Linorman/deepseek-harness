/** Explicit frozen deployment policy; this leaf has no World request or scheduler dependency. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Exact installed adjudication policy identity; effective parameters remain separately frozen. */
export const WORLD_EXTERNAL_MEDIATION_POLICY_REF = 'clocky.external.adjudication/1' as const
/** Structured Fact schema whose Native source must prove the original adjudication. */
export const WORLD_EXTERNAL_MEDIATION_FACT_SCHEMA_REF = 'clocky.world-fact/external-adjudicated/1' as const
/** Complete explicit deployment parameters; unsupported installs, duplicate families/readers and incomplete values reject. */
export const simulationExternalMediatedPolicyParametersSchema = z.strictObject({ ref: z.literal(WORLD_EXTERNAL_MEDIATION_POLICY_REF), version: z.literal('1'), generation: cursor.positive(),
  conditionInstalls: z.array(z.enum(['weather', 'lead-time', 'meeting-status']))
    .refine(values => new Set(values).size === values.length, 'Condition installs must be distinct'),
  futureConditionInstalls: z.array(z.enum(['weather', 'lead-time', 'meeting-status']))
    .refine(values => new Set(values).size === values.length, 'Future condition installs must be distinct'),
  allowedOutcomeKinds: z.array(z.enum(['environmental-fact', 'delayed-event', 'failure', 'representative-preparation-plan',
    'unverified-report'])).min(1)
    .refine(values => new Set(values).size === values.length, 'Allowed outcomes must be distinct'),
  maxDelay: simTimeSchema, allowPublicDisclosure: z.boolean(), allowScopeDisclosure: z.boolean(),
  actorDisclosure: z.array(simulationEntityIdSchema)
    .refine(values => new Set(values).size === values.length, 'Explicit readers must be distinct'),
}).refine(value => value.futureConditionInstalls.every(item => value.conditionInstalls.includes(item)),
  'Future conditions must also be explicitly installed')
