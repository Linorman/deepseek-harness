/** Run-wide personnel metadata; no Person, Session or private Team bodies cross the product boundary. */
import type { SimTime } from '@clocky/clocky-simulation/time-types'

/** History is complete at one canonical Team cursor, or explicitly unavailable. */
export type SimulationProductPeopleHistory = {
  readonly status: 'observed'
  readonly teamCursor: number
  readonly participants: number
  readonly activations: number
} | {
  readonly status: 'unavailable'
  readonly reason: 'unavailable' | 'unsupported' | 'partial' | 'source-moved'
}

/** Counts use the whole run, rather than one loaded page or one organization. */
export interface SimulationProductPeopleCounts {
  readonly scope: 'run'
  readonly snapshotRevision: number
  readonly time: SimTime
  /** Distinct nonterminated Persons with an assignment effective at this simulated time. */
  readonly employed: number
  /** Includes inactive candidates and departed Persons; other entity kinds do not count. */
  readonly nonTerminalPersons: number
  /** Currently admitted active cognitive writers; this does not claim physical process liveness. */
  readonly resident: number
  readonly residentLimit: number
  /** Reserved, active and revoked writers retain capacity until actual release. */
  readonly unreleasedWriters: number
  /** All canonical Team identities and activation epochs, including retired history. */
  readonly history: SimulationProductPeopleHistory
}
