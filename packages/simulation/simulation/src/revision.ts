/** Typed optimistic concurrency conflicts contain no business or model payload. */

/** A retained snapshot changed before an operation entered the Native write queue. */
export class SimulationRevisionConflictError extends Error {
  /** Stable classifier for callers that can safely reread the original responsibility. */
  readonly code = 'SIM_REVISION_CONFLICT'
  /** Exact cursor the caller reviewed. */
  readonly expectedRevision: number
  /** Exact cursor observed at queue admission. */
  readonly actualRevision: number

  /**
   * @param expectedRevision - Original caller snapshot cursor.
   * @param actualRevision - Current authoritative Native cursor.
   */
  constructor(expectedRevision: number, actualRevision: number) {
    super('Simulation revision conflict')
    this.name = 'SimulationRevisionConflictError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}
