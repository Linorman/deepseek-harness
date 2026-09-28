/** Run-owned durable reference for checkpoint collection. @module @clocky/clocky-simulation/checkpoint-reference */
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationRunId } from './types.ts'

/** Full run projection identity; references alone do not pin retained history. */
export interface SimulationRunPersistenceReference {
  readonly retention: 'full'
  readonly runId: SimulationRunId
  readonly backend: 'json' | 'sqlite'
  readonly stream: { readonly name: string; readonly version: number }
  readonly cursor: number
  readonly firstSequence: number
  readonly fingerprint: Branded<'SimulationRunFingerprint'>
}

/** A sealed run position held until the collector releases its write barrier. */
export interface SimulationCheckpointCut {
  readonly snapshot: import('./types.ts').SimulationSnapshot
  readonly reference: SimulationRunPersistenceReference
  /**
   * Atomically publish a validated manifest while this exact cut remains held.
   * @param manifest - Complete owner references and the cut's run responsibilities.
   * @returns the completed checkpoint request; failed storage writes leave it pending.
   */
  publish(manifest: import('./checkpoint.ts').SimulationCheckpointManifest): Promise<import('./checkpoint.ts').SimulationCheckpointOperation>
  /** Release this cut's admission barrier; this does not resume scheduling. */
  release(): void
}
