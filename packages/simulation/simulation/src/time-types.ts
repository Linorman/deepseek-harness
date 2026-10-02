/** Simulation clock identity without provider, Session or Cordis declarations. */
import type { Branded } from '@clocky/clocky-brand'

/** Canonical non-negative decimal simulation time, with no machine-integer precision limit. */
export type SimTime = Branded<'SimTime'>
