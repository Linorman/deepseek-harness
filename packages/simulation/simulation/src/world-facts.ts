import { currentWorldAssignments } from './world-membership.ts'
/** Strict fact publications and pure reader projections; Native owns append authority and recording time. */
import { z } from 'zod'
import { simulationEntityIdSchema } from './entity.ts'
import { simTimeSchema } from './time.ts'
import { simulationExternalAdjudicatedFactPayloadSchema } from './world-external-claims.ts'
import { worldFactIdSchema, worldFactReferenceSchema, worldFactVersionSchema } from './world-facts-identities.ts'
export { worldFactIdSchema, worldFactReferenceSchema, worldFactVersionSchema } from './world-facts-identities.ts'
import type { SimulationRunId, SimulationSnapshot } from './types.ts'
import type { WorldSchemaRef } from './world-domain-types.ts'
import type { WorldFactId, SimulationWorldFact, SimulationWorldFactQuery,
  SimulationWorldFactProjection, SimulationWorldFactText, SimulationWorldFactAdjudicated } from './world-facts-types.ts'

const text = z.string().min(1)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Exact installed text fact schema; normative enforcement is a separate policy capability. */
export const WORLD_FACT_TEXT_SCHEMA_REF = 'clocky.world-fact/text/1' as WorldSchemaRef
/** Installed structured external Fact schema; model attribution alone does not authorize publication. */
export const WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF = 'clocky.world-fact/external-adjudicated/1' as WorldSchemaRef
/** Native-proved external observation; provenance contains only exact original causal references. */
export const simulationWorldFactAdjudicatedPayloadSchema = simulationExternalAdjudicatedFactPayloadSchema
/** Strict installed text body; arbitrary code, enforcement or attribution fields reject. */
export const simulationWorldFactTextPayloadSchema = z.strictObject({ body: text })
/** Exact causal Native source; foreign Session or Channel references are not accepted by this owner. */
export const simulationWorldFactSourceReferenceSchema = z.strictObject({ kind: z.literal('run-event'),
  runId: text.transform(value => value as SimulationRunId), sequence: count.positive() })
/** Explicit readers; scoped membership is checked at projection time and never assumed from a director role. */
export const simulationWorldFactAudienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('public') }),
  z.strictObject({ kind: z.literal('actors'), entityIds: z.array(simulationEntityIdSchema).min(1)
    .refine(values => new Set(values).size === values.length, 'Fact audience identities must be distinct') }),
  z.strictObject({ kind: z.literal('scope-members') }),
])
const fields = {
  factId: worldFactIdSchema,
  version: worldFactVersionSchema,
  subject: simulationEntityIdSchema,
  scope: simulationEntityIdSchema,
  effectiveFrom: simTimeSchema,
  effectiveUntil: simTimeSchema.nullable(),
  availableAt: simTimeSchema,
  audience: simulationWorldFactAudienceSchema,
  supersedes: worldFactReferenceSchema.nullable(),
}
const interval = (value: { effectiveFrom: string; effectiveUntil: string | null }): boolean =>
  value.effectiveUntil === null || BigInt(value.effectiveUntil) > BigInt(value.effectiveFrom)
const textFields = { ...fields,
  schemaRef: z.literal('clocky.world-fact/text/1').transform(value => value as WorldSchemaRef),
  payload: simulationWorldFactTextPayloadSchema,
}
const adjudicatedFields = { ...fields,
  schemaRef: z.literal('clocky.world-fact/external-adjudicated/1').transform(value => value as WorldSchemaRef),
  payload: simulationWorldFactAdjudicatedPayloadSchema,
}
const sources = z.array(simulationWorldFactSourceReferenceSchema)
  .refine(values => new Set(values.map(value => JSON.stringify(value))).size === values.length, 'Fact sources must be distinct')
const recording = { source: z.strictObject({ kind: z.literal('owner'), owner: text,
  references: z.array(simulationWorldFactSourceReferenceSchema) }), recordedAt: count, sequence: count.positive() }
/** Original text-only request contract, preserving strict rejection of attribution and unknown payload fields. */
export const simulationWorldFactTextRequestSchema = z.strictObject({ ...textFields, sources }).refine(interval)
/** Structured publication input; Native still requires the corresponding original adjudication effect. */
export const simulationWorldFactAdjudicatedRequestSchema = z.strictObject({ ...adjudicatedFields, sources }).refine(interval)
/** Complete trusted owner input; versions, audiences and availability dates remain explicit. */
export const simulationWorldFactRequestSchema = z.union([
  simulationWorldFactTextRequestSchema, simulationWorldFactAdjudicatedRequestSchema,
])
/** Original text-only immutable publication. */
export const simulationWorldFactTextVersionSchema = z.strictObject({ ...textFields, ...recording }).refine(interval)
/** Immutable original external publication with Native-derived recording metadata. */
export const simulationWorldFactAdjudicatedVersionSchema = z.strictObject({ ...adjudicatedFields, ...recording }).refine(interval)
/** Complete immutable Native publication; its wall-clock timestamp cannot be selected by a model. */
export const simulationWorldFactVersionSchema = z.union([
  simulationWorldFactTextVersionSchema, simulationWorldFactAdjudicatedVersionSchema,
])
/** Exact reader, revision and simulated time; complete output must fit the caller's finite limit. */
export const simulationWorldFactQuerySchema = z.strictObject({ viewer: simulationEntityIdSchema, cursor: count,
  time: simTimeSchema, limit: count.positive(), ids: z.array(worldFactIdSchema)
    .refine(values => new Set(values).size === values.length, 'Requested fact identities must be distinct').optional() })

/** Stable fact failures; diagnostic text does not become public world content. */
export class SimulationWorldFactError extends Error {
  /**
   * @param code - Stable violated fact invariant or capacity category.
   * @param message - Trusted diagnostic, separate from model-visible fact bodies.
   */
  constructor(readonly code: 'SIM_WORLD_FACT_VERSION' | 'SIM_WORLD_FACT_SOURCE' | 'SIM_WORLD_FACT_TIME'
    | 'SIM_WORLD_FACT_AUDIENCE' | 'SIM_WORLD_FACT_LIMIT' | 'SIM_WORLD_FACT_INTEGRITY', message: string) {
    super(message)
    this.name = 'SimulationWorldFactError'
  }
}

function audienceAllows(state: SimulationSnapshot, fact: SimulationWorldFact, query: SimulationWorldFactQuery): boolean {
  switch (fact.audience.kind) {
    case 'public': return true
    case 'actors': return fact.audience.entityIds.includes(query.viewer)
    case 'scope-members': return currentWorldAssignments(state, query.viewer, fact.scope).length !== 0
    default: return assertNever(fact.audience)
  }
}

function phase(fact: SimulationWorldFact, history: readonly SimulationWorldFact[], time: string):
SimulationWorldFactProjection['items'][number]['effective'] {
  let until = fact.effectiveUntil === null ? undefined : BigInt(fact.effectiveUntil)
  for (const successor of history) {
    if (BigInt(successor.version) <= BigInt(fact.version)) continue
    const cutoff = BigInt(successor.effectiveFrom)
    if (until === undefined || cutoff < until) until = cutoff
  }
  if (until !== undefined && (until <= BigInt(fact.effectiveFrom) || BigInt(time) >= until)) return 'historical'
  return BigInt(time) < BigInt(fact.effectiveFrom) ? 'scheduled' : 'effective'
}

/**
 * Select only authorized available publications, preserving exact versions and original typed payloads.
 * @param state - Authoritative Native history; past prepared views are retained separately and never recomputed.
 * @param request - As-of content query; scope membership uses the supplied current Native prefix, never the requested past time.
 * @returns complete known material and unknown requested identities, without asserting receipt or understanding.
 */
export function projectWorldFacts(state: SimulationSnapshot, request: SimulationWorldFactQuery): SimulationWorldFactProjection {
  const query = simulationWorldFactQuerySchema.parse(request)
  if (state.world === undefined || !Object.hasOwn(state.entities, query.viewer)) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_AUDIENCE', 'Fact projection requires an existing World reader')
  }
  if (query.cursor > state.revision || BigInt(query.time) > BigInt(state.time)) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_TIME', 'Fact projection cannot select a future Native cursor or time')
  }
  if (query.limit > state.spec.maxKnowledgePerQuery || (query.ids?.length ?? 0) > query.limit) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_LIMIT', 'Complete fact selection exceeds the frozen knowledge query allowance')
  }
  const items: SimulationWorldFactProjection['items'][number][] = [], unknown: WorldFactId[] = []
  const ids = query.ids ?? Object.keys(state.world.facts).sort().map(value => value as WorldFactId)
  for (const id of ids) {
    const stored = Object.hasOwn(state.world.facts, id) ? state.world.facts[id] : undefined
    const history = stored?.filter(value => value.sequence <= query.cursor) ?? []
    const visible = history.filter(value => BigInt(value.availableAt) <= BigInt(query.time) && audienceAllows(state, value, query))
    if (visible.length === 0 && query.ids !== undefined) unknown.push(id)
    for (const fact of visible) items.push({ fact, effective: phase(fact, history, query.time) })
  }
  if (items.length + unknown.length > query.limit) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_LIMIT', 'Complete known fact versions exceed the explicit selection limit')
  }
  return { viewer: query.viewer, cursor: query.cursor, time: query.time, items, unknown }
}

/**
 * Read authoritative effective state without mistaking publication availability for policy activation.
 * @param state - Trusted complete Native fact history.
 * @param factId - Exact fact identity; absence remains unknown.
 * @param time - Current or past simulated time; future state cannot be inferred.
 * @param cursor - Current or past Native publication fence.
 * @returns exact effective version or undefined; this trusted method does not grant model disclosure.
 */
export function effectiveWorldFact(state: SimulationSnapshot, factId: WorldFactId, time: import('./time-types.ts').SimTime,
  cursor = state.revision): SimulationWorldFact | undefined {
  if (cursor > state.revision || cursor < 0 || !Number.isSafeInteger(cursor) || BigInt(time) > BigInt(state.time)) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_TIME', 'Effective fact inspection cannot select a future Native cursor or time')
  }
  const stored = state.world !== undefined && Object.hasOwn(state.world.facts, factId) ? state.world.facts[factId] : undefined
  const history = stored?.filter(value => value.sequence <= cursor) ?? []
  return history.findLast(value => phase(value, history, time) === 'effective')
}

function assertNever(value: never): never { throw new Error(`Unknown fact audience: ${String(value)}`) }

/**
 * Select the original installed text branch without erasing the branded schema identity.
 * @param fact - Complete strict immutable publication.
 * @returns whether the publication uses the installed text payload schema.
 */
export function isWorldFactText(fact: SimulationWorldFact): fact is SimulationWorldFactText {
  return fact.schemaRef === WORLD_FACT_TEXT_SCHEMA_REF
}
/**
 * Select the installed adjudicated branch; this guard does not grant publication authority.
 * @param fact - Complete strict immutable publication.
 * @returns whether the publication uses the installed adjudicated payload schema.
 */
export function isWorldFactAdjudicated(fact: SimulationWorldFact): fact is SimulationWorldFactAdjudicated {
  return fact.schemaRef === WORLD_FACT_EXTERNAL_ADJUDICATED_SCHEMA_REF
}
