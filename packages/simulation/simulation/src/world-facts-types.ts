/** Versioned authoritative facts; private beliefs and reports remain in the attributed knowledge owner. */
import type { Branded } from '@clocky/clocky-brand'
import type { z } from 'zod'
import type {
  worldFactReferenceSchema, simulationWorldFactRequestSchema, simulationWorldFactVersionSchema,
  simulationWorldFactQuerySchema, simulationWorldFactTextRequestSchema, simulationWorldFactAdjudicatedRequestSchema,
  simulationWorldFactTextVersionSchema, simulationWorldFactAdjudicatedVersionSchema,
} from './world-facts.ts'

/** Stable run-local authoritative fact identity. */
export type WorldFactId = Branded<'SimulationWorldFactId'>
/** Canonical positive decimal version; journal ordering does not depend on machine integer precision. */
export type WorldFactVersion = Branded<'SimulationWorldFactVersion'>
/** Exact immutable fact record identity. */
export type WorldFactReference = z.infer<typeof worldFactReferenceSchema>
/** Trusted publication input; Native derives source owner, recording clock and journal position. */
export type SimulationWorldFactRequest = z.infer<typeof simulationWorldFactRequestSchema>
/** Complete append-only publication, including original source and visibility conditions. */
export type SimulationWorldFact = z.infer<typeof simulationWorldFactVersionSchema>
/** Exact text request, for consumers explicitly restricted to the original schema. */
export type SimulationWorldFactTextRequest = z.infer<typeof simulationWorldFactTextRequestSchema>
/** Exact external request; the Fact owner independently verifies its original source. */
export type SimulationWorldFactAdjudicatedRequest = z.infer<typeof simulationWorldFactAdjudicatedRequestSchema>
/** Exact text publication. */
export type SimulationWorldFactText = z.infer<typeof simulationWorldFactTextVersionSchema>
/** Exact Native-proved structured external publication. */
export type SimulationWorldFactAdjudicated = z.infer<typeof simulationWorldFactAdjudicatedVersionSchema>
/** Reader-specific bounded as-of query; this is not authority to inspect hidden subjects. */
export type SimulationWorldFactQuery = z.infer<typeof simulationWorldFactQuerySchema>
/** A known version can describe a current fact, announced future fact or retained historical fact. */
export interface SimulationWorldFactView {
  /** Exact immutable publication; its payload is the body actually selected for this reader. */
  readonly fact: SimulationWorldFact
  /** Effective state of this version is separate from its known/available status. */
  readonly effective: 'effective' | 'scheduled' | 'historical'
}
/** Complete visible selection; missing and hidden requested identities both remain unknown. */
export interface SimulationWorldFactProjection {
  /** Actual selected reader; model preparation derives this from its decision owner. */
  readonly viewer: SimulationWorldFactQuery['viewer']
  /** Native revision fence used to select immutable publications. */
  readonly cursor: number
  /** Canonical simulated selection time, independent of recordedAt's wall clock. */
  readonly time: SimulationWorldFactQuery['time']
  /** Selection includes all known versions in the requested scope; overflow rejects instead of truncating. */
  readonly items: readonly SimulationWorldFactView[]
  /** Explicit requested identities without available authorized material; existence is not disclosed. */
  readonly unknown: readonly WorldFactId[]
}
