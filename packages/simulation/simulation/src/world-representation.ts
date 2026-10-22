/** Explicit memoryless external representation transitions; cognitive downgrade is unsupported. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simulationWorldDomainPinSchema, worldExternalIdentityIdSchema } from './world-domain.ts'
import { simTimeSchema } from './time.ts'

const representation = z.enum(['simulated-rule', 'director-mediated'])
/** Original subject and generation are compared again by the single Native committer. */
export const representationSwitchRequestSchema = z.strictObject({
  scopeEntityId: simulationEntityIdSchema, targetEntityId: simulationEntityIdSchema,
  identityId: worldExternalIdentityIdSchema, expectedGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
  from: representation, to: representation,
}).refine(value => value.from !== value.to, 'Representation switch must change the selected implementation')
/** Recorded identity mapping and actual switch result; no Session memory is summarized or discarded. */
export const representationSwitchResultSchema = z.strictObject({
  ...representationSwitchRequestSchema.shape, generation: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER),
  sourceRevision: z.number().int().nonnegative(), identitySequence: z.number().int().positive(), time: simTimeSchema,
  memory: z.literal('none'), obligations: z.literal('no-pending-representation-io'),
}).refine(value => value.generation === value.expectedGeneration + 1 && value.from !== value.to,
  'Representation generation must advance exactly once')
/** Full original switch history remains in the subject projection and Native journal. */
export const representationHistorySchema = z.array(representationSwitchResultSchema).min(1).max(128)
  .refine(values => values.every((value, index) => value.expectedGeneration === index + 1
    && (index === 0 || value.from === values[index - 1]?.to && value.identityId === values[index - 1]?.identityId
      && value.targetEntityId === values[index - 1]?.targetEntityId)), 'Representation history must be contiguous')
/** One installed finite operation; existing interaction versions retain their original result semantics. */
export const WORLD_REPRESENTATION_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'external',
  operation: 'switch-representation', version: '1', schemaRef: 'clocky.external.representation/schema/2',
  implementationRef: 'clocky.external.representation/native/1', generation: 1 }))
/** Strict input and actual result participate in ordinary world request/plan/mutation validation. */
export const WORLD_REPRESENTATION_DEFINITION = Object.freeze({ domain: WORLD_REPRESENTATION_PIN.domain,
  operation: WORLD_REPRESENTATION_PIN.operation, version: WORLD_REPRESENTATION_PIN.version,
  schemaRef: WORLD_REPRESENTATION_PIN.schemaRef, schemas: Object.freeze({ request: representationSwitchRequestSchema,
    plan: representationSwitchRequestSchema, mutation: representationSwitchResultSchema,
    result: z.union([representationSwitchResultSchema, z.strictObject({})]) }) })
