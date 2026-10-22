/** Typed refusal for a still-owned prepared decision whose next inference is closed by recorded pause. */
import type { SimulationDecisionId } from './identities.ts'

/** Paused scheduling rejects fresh model dispatch without hiding unrelated writer/context failures. */
export class SimulationDecisionPausedError extends Error {
  /** Exact original decision that remains eligible for pause cancellation at the Native queue. */
  readonly decisionId: SimulationDecisionId

  /** @param decisionId - Current unaccepted prepared decision owned by the refusing writer. */
  constructor(decisionId: SimulationDecisionId) {
    super('Simulation scheduling paused before the next model dispatch')
    this.name = 'SimulationDecisionPausedError'
    this.decisionId = decisionId
  }
}
