/** Typed canonical-context failure shared by consumption and input reconciliation. */
/** A canonical Session invariant cannot be repaired by changing model tool arguments. */
export class SimulationContextIntegrityError extends Error {
  /** Stable internal failure category. */
  readonly code = 'SIM_CONTEXT_INTEGRITY'
}
