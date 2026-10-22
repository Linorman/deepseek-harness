/** World driver observations; durable progress remains owned by Native, Team and Session journals. */
import type { SimulationCheckpointId, SimulationEntityId, SimTime } from '@clocky/clocky-simulation'
import type { SimulationTeamDriveResult } from '@clocky/clocky-simulation-team'

/** Original bootstrap or explicitly restored checkpoint and immutable lifecycle namespace. */
export interface SimulationWorldDriverAnchor {
  readonly checkpointId: SimulationCheckpointId
  readonly ownerName: string
  readonly maxDrainRounds: number
  readonly maxAttempts: number
}
/** Finite control batch outcome; idle or blockers never imply that every role consumed a business result. */
export interface SimulationWorldDriveResult {
  readonly reason: SimulationTeamDriveResult['reason'] | 'idle' | 'recovery-required' | 'maintenance-blocked'
    | 'message-rejected' | 'context-integrity' | 'decision-timeout' | 'token-overrun' | 'request-budget'
    | 'position-capacity' | 'authority-missing' | 'approval-required' | 'existing-obligations' | 'plan-stale' | 'plan-budget'
    | 'entity-capacity' | 'identity-capacity' | 'channel-capacity' | 'world-byte-limit' | 'world-request-limit' | 'world-command-limit'
    | 'world-birth-limit' | 'world-expansion-limit' | 'world-mutation-limit'
    | 'budget-limit' | 'context-limit' | 'microstep-limit' | 'model-pool-capacity' | 'activation-history-limit' | 'message-byte-limit'
    | 'stale-time' | 'waiting-effective-time' | 'handoff-required'
    | 'retirement-unknown'
    | 'resource-capacity' | 'resource-history-limit' | 'resource-reservation-expired'
  readonly controlSteps: number
  readonly revision: number
  readonly time: SimTime
  readonly entityId?: SimulationEntityId | undefined
  readonly nextAttemptAt?: number | undefined
}
