/** Bounded current-owner facts for scheduling and administration; no journal history or private bodies. */
import type { SimulationRunId, SimulationSnapshot } from './types.ts'
import type { SimTime } from './time-types.ts'
import type { SimulationCheckpointId, SimulationEntityId } from './identities.ts'
import type { TeamId } from '@clocky/clocky-team'

/** Numeric recovery facts do not authorize acknowledgement or resumption. */
export interface SimulationControlTokenFacts {
  readonly recovery?: { readonly request: import('./tokens.ts').SimulationTokenRecovery
    readonly complete: boolean
    readonly settled: boolean } | undefined
  readonly requestBudget?: (import('./tokens.ts').SimulationRequestBudgetBlock & { readonly decisionId: string }) | undefined
}
/** Current authoritative Native facts. Collection counts may require a scan, but historical bodies are never copied. */
export interface SimulationControlObservation {
  readonly runId: SimulationRunId
  readonly revision: number
  readonly phase: SimulationSnapshot['phase']
  readonly time: SimTime
  readonly observedAt: number
  readonly budget: Pick<SimulationSnapshot['spec'], 'tokensPerModelRequest' | 'maxTokensPerInterval' | 'budgetInterval' | 'maxResidentActors' | 'maxConflictRetries'>
  readonly teamId?: TeamId | undefined
  readonly unconfirmedWorldExecutions: number
  readonly activeDecisions: number
  readonly checkpointInProgress: boolean
  readonly managementCount: number
  readonly managementInProgress: boolean
  readonly maintenanceInProgress: boolean
  readonly unknownOperations: boolean
  readonly messageByteBlocked: boolean
  readonly activationHistory: 'clear' | 'blocked' | 'recovery-required'
  readonly retryAuthorized: boolean
  readonly budgetRecovered: boolean
  readonly unstarted: boolean
  readonly ingressCount: number
  readonly targets: readonly { readonly id: SimulationEntityId
    readonly name: string
    readonly truncated: boolean }[]
  readonly targetCount: number
  readonly tokenOverrun: boolean
  readonly token: SimulationControlTokenFacts
  readonly stall?: SimulationSnapshot['stall'] | undefined
  readonly submissionFailure?: import('./world-submission.ts').SimulationWorldSubmissionBlock['failure'] | undefined
  readonly tokenStallAcknowledged: boolean
  readonly selectedCheckpoint?: { readonly status: 'in-progress' | 'completed' | 'failed'
    readonly implementationVersion?: string | undefined
    readonly teamId?: TeamId | undefined } | undefined
  readonly latestCheckpoint?: { readonly id: SimulationCheckpointId
    readonly implementationVersion: string
    readonly publishedAt: number
    readonly time: SimTime
    readonly revision: number
    readonly references: { readonly runs: number; readonly teams: number; readonly channels: number; readonly sessions: number }
  } | undefined
  readonly executionPins: readonly import('./world-domain-types.ts').SimulationWorldDomainPin[]
  readonly stopTarget?: import('./run-control-observation.ts').SimulationRunControlObservation | undefined
  readonly checkpointCoverage: 'native' | 'external-state-required'
  readonly driverObservation?: SimulationSnapshot['driverObservation'] | undefined
}
