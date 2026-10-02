/** Structured checkpoint diagnoses cross persistence and product boundaries without exposing raw causes. */
import type { SimulationCheckpointDiagnostic } from './checkpoint-diagnostics-types.ts'
export type * from './checkpoint-diagnostics-types.ts'
export { simulationCheckpointDiagnosticSchema } from './checkpoint-diagnostics-schema.ts'

/** A private cause and its explicit public rule/reference retain separate lifetimes. */
export class SimulationCheckpointError extends Error {
  /**
   * @param message - Existing private diagnostic for native logs and trusted maintainers.
   * @param diagnostic - Safe explicit category and canonical subject.
   * @param options - Optional private underlying failure; never serialized into a public response.
   */
  constructor(message: string, readonly diagnostic: SimulationCheckpointDiagnostic, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SimulationCheckpointError'
  }
}

/** Preserve both primary and cleanup failures while exposing only explicit safe metadata. */
export class SimulationCheckpointCleanupError extends AggregateError {
  /** Primary safe diagnosis plus independent unconfirmed cleanup; original errors remain private. */
  readonly diagnostic: SimulationCheckpointDiagnostic
  /**
   * @param errors - Independent private validation and cleanup failures in that order.
   * @param diagnostic - Primary failure's known stage/category/reference.
   */
  constructor(errors: readonly [unknown, unknown], diagnostic: SimulationCheckpointDiagnostic) {
    super(errors, 'Checkpoint recovery cleanup failed')
    this.diagnostic = { ...diagnostic, cleanup: 'unconfirmed' }
  }
}

/**
 * Select only explicitly typed failure metadata; arbitrary provider text cannot establish a category.
 * @param error - Private thrown failure from an owned checkpoint pipeline.
 * @param fallback - Known current stage/subject when no typed cause exists.
 * @returns safe metadata without messages, paths or arbitrary error properties.
 */
export function checkpointDiagnostic(error: unknown, fallback: SimulationCheckpointDiagnostic): SimulationCheckpointDiagnostic {
  return error instanceof SimulationCheckpointError || error instanceof SimulationCheckpointCleanupError ? error.diagnostic : fallback
}
