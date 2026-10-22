/** Bounded simulated supply and experience contracts; these never describe measured real-world facts. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { simulationWorldDomainPinSchema, worldIntentIdSchema } from './world-domain.ts'

const count = z.number().int().min(0).max(1_000_000)
/** Frozen stock and obligations; model replacement requires a fresh experiment. */
export const environmentStateSchema = z.strictObject({
  model: z.enum(['supply-fixed/1', 'supply-seasonal/1']), generation: z.literal(1),
  inventory: count, committed: count, capacity: count, sourceLimit: count, sinkLimit: count,
  step: z.number().int().positive().max(1000), lastTime: simTimeSchema.nullable(),
}).refine(v => v.committed <= v.inventory && v.inventory <= v.capacity, 'Stock must cover commitments within capacity')
/** Accepted inputs contain no sampled output; installed deterministic rules own production. */
export const environmentRequestSchema = z.strictObject({ scopeEntityId: simulationEntityIdSchema,
  targetEntityId: simulationEntityIdSchema, demand: count })
/** Actual sample is retained in the mutation and checked against the pinned implementation on replay. */
export const environmentSampleSchema = z.strictObject({ ...environmentRequestSchema.shape,
  implementation: z.enum(['supply-fixed/1', 'supply-seasonal/1']), production: count, consumed: count,
  previousInventory: count, inventory: count, time: simTimeSchema, simulated: z.literal(true) })
/** Installed supply schema identity; both algorithms are explicitly selected in fresh state. */
export const WORLD_ENVIRONMENT_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'environment',
  operation: 'supply-step', version: '1', schemaRef: 'clocky.environment.supply/schema/2',
  implementationRef: 'clocky.environment.supply/native/1', generation: 1 }))
/** Environment changes use the common driver and Native single-commit path. */
export const WORLD_ENVIRONMENT_DEFINITION = Object.freeze({ domain: WORLD_ENVIRONMENT_PIN.domain,
  operation: WORLD_ENVIRONMENT_PIN.operation, version: WORLD_ENVIRONMENT_PIN.version,
  schemaRef: WORLD_ENVIRONMENT_PIN.schemaRef, schemas: Object.freeze({ request: environmentRequestSchema,
    plan: environmentRequestSchema, mutation: environmentSampleSchema, result: z.union([environmentSampleSchema, z.strictObject({})]) }) })

/** Replayable deterministic sample; no random generator or model call is hidden in this projection.
 * @param state - Validated frozen model and stock.
 * @param input - Accepted demand and target.
 * @param time - Exact simulation boundary.
 * @returns actual finite production, consumption and stock result.
 */
export function sampleEnvironment(state: z.infer<typeof environmentStateSchema>,
  input: z.infer<typeof environmentRequestSchema>, time: z.infer<typeof simTimeSchema>): z.infer<typeof environmentSampleSchema> {
  const current = environmentStateSchema.parse(state), request = environmentRequestSchema.parse(input)
  if (current.lastTime !== null && BigInt(time) < BigInt(current.lastTime) + BigInt(current.step))
    throw new Error('Environment step has not elapsed')
  const seasonal = current.model === 'supply-seasonal/1' && (BigInt(time) / BigInt(current.step)) % 2n === 1n
  const production = Math.min(current.capacity - current.inventory, seasonal ? Math.floor(current.sourceLimit / 2) : current.sourceLimit)
  const consumed = Math.min(request.demand, current.sinkLimit, current.inventory + production - current.committed)
  return environmentSampleSchema.parse({ ...request, implementation: current.model, production, consumed,
    previousInventory: current.inventory, inventory: current.inventory + production - consumed, time, simulated: true })
}

/** One subjective state transition; it is never a world fact or an authority grant. */
export const personExperienceSchema = z.strictObject({ scopeEntityId: simulationEntityIdSchema,
  targetEntityId: simulationEntityIdSchema, personId: simulationEntityIdSchema,
  field: z.enum(['skill', 'relationship', 'belief']), key: z.string().min(1).max(128),
  previous: z.number().int().min(-100).max(100), next: z.number().int().min(-100).max(100),
  sourceIntentId: z.string().min(1).max(256).pipe(worldIntentIdSchema), effectiveAt: simTimeSchema, validUntil: simTimeSchema,
}).refine(v => Math.abs(v.next - v.previous) <= 5 && BigInt(v.validUntil) > BigInt(v.effectiveAt),
  'Experience delta must not exceed five and validity must be nonempty')
/** Separate private state owner; never stored in the immutable Persona. */
export const personEvolutionStateSchema = z.strictObject({ personId: simulationEntityIdSchema,
  audience: z.array(simulationEntityIdSchema).min(1).max(16), period: z.number().int().positive().max(1000),
  versions: z.array(personExperienceSchema).max(256) })
/** Installed experience operation, with bounded and immutable source references. */
export const WORLD_EXPERIENCE_PIN = Object.freeze(simulationWorldDomainPinSchema.parse({ domain: 'person-state',
  operation: 'experience', version: '1', schemaRef: 'clocky.person-state.experience/schema/2',
  implementationRef: 'clocky.person-state.experience/native/1', generation: 1 }))
/** Domain schemas prohibit arbitrary profile or authority changes. */
export const WORLD_EXPERIENCE_DEFINITION = Object.freeze({ domain: WORLD_EXPERIENCE_PIN.domain,
  operation: WORLD_EXPERIENCE_PIN.operation, version: WORLD_EXPERIENCE_PIN.version,
  schemaRef: WORLD_EXPERIENCE_PIN.schemaRef, schemas: Object.freeze({ request: personExperienceSchema,
    plan: personExperienceSchema, mutation: personExperienceSchema, result: z.union([personExperienceSchema, z.strictObject({})]) }) })
