/** Authoritative fact appends use the sole Native journal; attributed knowledge keeps its separate owner. */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import { simulationWorldFactVersionSchema, SimulationWorldFactError, parseSimTime, isWorldFactAdjudicated,
  WORLD_FACT_TEXT_SCHEMA_REF } from '@clocky/clocky-simulation'
import { originalAdjudicatedFactSource } from './world-external-mediated-fact-source.ts'
import type { SimulationSnapshot, SimulationWorldFact, SimulationWorldFactRequest, WorldFactId } from '@clocky/clocky-simulation'

/** Original complete publication; recordedAt and source owner are derived before the durable append. */
export const worldFactRecordSchema = z.strictObject({ kind: z.literal('world/fact-recorded'), fact: simulationWorldFactVersionSchema })
/** Strict fact journal event. */
export type WorldFactRecord = z.infer<typeof worldFactRecordSchema>

/**
 * Derive the canonical trusted publisher from the immutable Team/run composition.
 * @param state - Original Native projection with its confirmed canonical Team.
 * @returns exact owner identity; an unowned world cannot publish authoritative facts.
 */
export function worldFactOwner(state: SimulationSnapshot): string {
  const owner = state.teamReservation?.creation.rules['activationLifecycleOwner']
  if (state.world === undefined || state.teamReservation?.confirmed !== true || typeof owner !== 'string' || !owner.length) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_SOURCE', 'Fact publication requires its confirmed canonical World owner')
  }
  return owner
}

/**
 * Recover original trusted input for idempotent version retries without reassigning recording metadata.
 * @param fact - Original immutable publication.
 * @returns exact caller input, excluding Native source ownership, wall clock and sequence.
 */
export function worldFactInput(fact: SimulationWorldFact): SimulationWorldFactRequest {
  const { source, recordedAt: _recordedAt, sequence: _sequence, ...input } = fact
  return { ...input, sources: source.references }
}

/**
 * Append a complete next version after validating identity, causal source, times, audience and total retained bytes.
 * @param state - Prior Native projection; committed histories are never edited in place.
 * @param record - Strict complete publication with Native-derived metadata.
 * @param sequence - Exact append cursor.
 * @returns a new projection or a rejection before any journal effect.
 */
export function foldWorldFact(state: SimulationSnapshot, record: WorldFactRecord, sequence: number): SimulationSnapshot {
  const fact = simulationWorldFactVersionSchema.parse(record.fact), owner = worldFactOwner(state), world = state.world
  if (world === undefined) throw new SimulationWorldFactError('SIM_WORLD_FACT_SOURCE', 'Fact publication has no original World')
  const history = (Object.hasOwn(world.facts, fact.factId) ? world.facts[fact.factId] : undefined) ?? []
  const previous = history.at(-1)
  if (fact.sequence !== sequence || sequence !== state.revision + 1 || fact.source.owner !== owner
    || fact.source.references.some(ref => ref.runId !== state.spec.runId || ref.sequence > state.revision)
    || new Set(fact.source.references.map(ref => JSON.stringify(ref))).size !== fact.source.references.length) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_SOURCE', 'Fact publication lost its original owner, append position or existing causal source')
  }
  if (fact.version !== String(BigInt(previous?.version ?? '0') + BigInt(1))
    || (previous === undefined ? fact.supersedes !== null : !isDeepStrictEqual(fact.supersedes,
      { factId: previous.factId, version: previous.version }))
    || previous !== undefined && (fact.schemaRef !== previous.schemaRef || fact.subject !== previous.subject
      || fact.scope !== previous.scope)) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_VERSION', 'Fact corrections require the exact last version and immutable subject, scope and schema')
  }
  if (!Object.hasOwn(state.entities, fact.subject) || !Object.hasOwn(state.entities, fact.scope)
    || fact.audience.kind === 'actors' && fact.audience.entityIds.some(id => !Object.hasOwn(state.entities, id))) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_AUDIENCE', 'Fact subject, scope and explicit audience must reference existing entities')
  }
  for (const time of [fact.effectiveFrom, fact.effectiveUntil, fact.availableAt]) if (time !== null) parseSimTime(time, state.spec.maxTime)
  if (BigInt(fact.effectiveFrom) < BigInt(state.time) || BigInt(fact.availableAt) < BigInt(state.time)) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_TIME', 'A new fact version cannot retroactively change effective or known history')
  }
  assertAdjudicatedWorldFactSource(state, fact)
  const next: SimulationSnapshot = { ...state, world: { ...world, facts: { ...world.facts, [fact.factId]: [...history, fact] } } }
  assertWorldFactCapacity(next)
  return next
}

/**
 * Bound all retained fact versions, including complete payload, sources, audience and dictionary identities.
 * @param state - Complete Native projection.
 * @returns nothing within maxKnowledgeBytes; attributed KB writes retain their own budget semantics.
 */
export function assertWorldFactCapacity(state: SimulationSnapshot): void {
  if (state.world !== undefined && Object.keys(state.world.facts).length > 0
    && Buffer.byteLength(JSON.stringify(state.world.facts), 'utf8') > state.spec.maxKnowledgeBytes) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_LIMIT', 'Complete retained fact history exceeds the frozen knowledge byte allowance')
  }
}

/**
 * Verify immutable history and source/version relationships after replay or before writable restoration.
 * @param state - Complete Native projection, never a partial raw inspection.
 * @returns nothing for a structurally complete history; corrupt or missing provenance rejects.
 */
export function assertWorldFactsProjection(state: SimulationSnapshot): void {
  if (state.world === undefined) return
  const owner = worldFactOwner(state)
  assertWorldFactCapacity(state)
  for (const [id, history] of Object.entries(state.world.facts)) {
    const first = history[0]
    if (first === undefined) throw new SimulationWorldFactError('SIM_WORLD_FACT_INTEGRITY', 'Fact history cannot be empty')
    let previous: SimulationWorldFact | undefined
    for (const [index, raw] of history.entries()) {
      const fact = simulationWorldFactVersionSchema.parse(raw)
      if (fact.factId !== id || fact.version !== String(index + 1) || fact.sequence > state.revision
        || (previous === undefined ? fact.sequence < state.world.sequence
          || fact.sequence === state.world.sequence && !isOriginalBootstrapFact(state, fact)
          : fact.sequence <= previous.sequence) || fact.source.owner !== owner
        || fact.subject !== first.subject || fact.scope !== first.scope || fact.schemaRef !== first.schemaRef
        || !Object.hasOwn(state.entities, fact.subject) || !Object.hasOwn(state.entities, fact.scope)
        || fact.source.references.some(ref => ref.runId !== state.spec.runId || ref.sequence >= fact.sequence)
        || new Set(fact.source.references.map(ref => JSON.stringify(ref))).size !== fact.source.references.length
        || (previous === undefined ? fact.supersedes !== null : !isDeepStrictEqual(fact.supersedes,
          { factId: previous.factId, version: previous.version }))) {
        throw new SimulationWorldFactError('SIM_WORLD_FACT_INTEGRITY',
          'Fact history lost its immutable version chain or Native provenance')
      }
      for (const time of [fact.effectiveFrom, fact.effectiveUntil, fact.availableAt]) {
        if (time !== null) parseSimTime(time, state.spec.maxTime)
      }
      assertAdjudicatedWorldFactSource(state, fact)
      previous = fact
    }
  }
}

/** Same-record initial publications must match the complete prior retained scenario input. */
function isOriginalBootstrapFact(state: SimulationSnapshot, fact: SimulationWorldFact): boolean {
  const book = state.worldBootstrap
  if (book?.status !== 'applied' || book.appliedSequence !== fact.sequence || book.sequence >= fact.sequence) return false
  const originals = book.request.data.facts.filter(value => value.id === fact.factId), input = originals[0]
  return originals.length === 1 && input !== undefined && isDeepStrictEqual(worldFactInput(fact), {
    factId: input.id, version: '1', schemaRef: WORLD_FACT_TEXT_SCHEMA_REF, subject: input.subjectId, scope: input.scopeId,
    payload: { body: input.body }, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil,
    availableAt: input.availableAt, audience: input.audience, supersedes: null,
    sources: [{ kind: 'run-event', runId: state.spec.runId, sequence: book.sequence }],
  })
}

/**
 * Locate an original immutable publication for a retry.
 * @param state - Authoritative Native history.
 * @param id - Exact fact identity.
 * @param version - Exact publication version.
 * @returns the original publication or undefined; callers must detach before exposing it.
 */
export function originalWorldFact(state: SimulationSnapshot, id: WorldFactId, version: string): SimulationWorldFact | undefined {
  const history = state.world !== undefined && Object.hasOwn(state.world.facts, id) ? state.world.facts[id] : undefined
  return history?.find(value => value.version === version)
}

/**
 * Prove the entire publication against its retained original owner effect, with no caller-controlled authority bypass.
 * @param state - Original Native books; an atomic mutation stages its source before this same-sequence Fact fold.
 * @param fact - Strict Native publication; the common run-event sources remain prior-only.
 */
function assertAdjudicatedWorldFactSource(state: SimulationSnapshot, fact: SimulationWorldFact): void {
  if (!isWorldFactAdjudicated(fact)) return
  const original = originalAdjudicatedFactSource(state, fact.payload.provenance)
  if (original === undefined || !isDeepStrictEqual(original, worldFactInput(fact))) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_SOURCE', 'External fact lost its exact original adjudication or event effect')
  }
  const provenance = fact.payload.provenance
  parseSimTime(fact.payload.asOf, state.spec.maxTime)
  if (provenance.adjudicationSequence > fact.sequence || provenance.event?.consumedSequence !== undefined
    && (provenance.event.consumedSequence > fact.sequence
      || provenance.event.consumedSequence < provenance.adjudicationSequence) || BigInt(fact.payload.asOf) > BigInt(fact.availableAt)) {
    throw new SimulationWorldFactError('SIM_WORLD_FACT_SOURCE', 'External fact provenance exceeds its original publication fence')
  }
}
