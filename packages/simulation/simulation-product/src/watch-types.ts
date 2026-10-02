/** Bounded invalidation hints contain no world bodies, grants or execution authority. */
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationProductRunId, SimulationProductCursor } from './types.ts'

/** Non-authorizing identity for one installed product read-policy lifetime. */
export type SimulationProductReadVersion = Branded<'SimulationProductReadVersion'>
/** One explicit authenticated wait, independent of simulation clock and execution. */
export interface SimulationProductWatchInput {
  readonly runId: SimulationProductRunId
  readonly cursor?: SimulationProductCursor | undefined
  /** Real milliseconds; zero requests an immediate observation. Host bounds the actual wait. */
  readonly waitMs?: number | undefined
}
/** Provider availability and native revision are independent of the current product read policy. */
export type SimulationProductWatchWorld = { readonly status: 'observed'; readonly revision: number }
  | { readonly status: 'missing' | 'unavailable' }
/** Reset requires discarding old continuations and private-body responses before new reads. */
export interface SimulationProductWatchResult {
  readonly runId: SimulationProductRunId
  readonly readVersion: SimulationProductReadVersion
  readonly cursor: SimulationProductCursor
  readonly status: 'changed' | 'unchanged' | 'reset'
  readonly world: SimulationProductWatchWorld
  readonly observedAt: number
}
