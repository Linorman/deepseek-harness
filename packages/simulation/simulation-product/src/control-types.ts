/** Safe failure facts share the Native journal parser and exclude private diagnostics. */
export type SimulationProductFailure = import('@clocky/clocky-simulation/driver-observation').SimulationDriverFailure
/** Safe history failure; missing histories remain the existing missing observation. */
export type SimulationProductReadFailure = 'history-limit' | 'unsupported-version' | 'corrupt-history' | 'owner-unavailable' | 'unavailable'

/** Actor-free scheduling controls and safe owner observations, independent of creation receipts. */
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { SimulationCheckpointId, SimulationEntityId } from '@clocky/clocky-simulation/identities'
import type { Branded } from '@clocky/clocky-brand'
import type { SimulationProductRunId, SimulationProductText } from './types.ts'

/** Caller-retained identity of one durable native scheduling request. */
export type SimulationProductManagementId = Branded<'SimulationProductManagementId'>
/** Scheduling requests carry no native provider, route, actor or browser-selected revision. */
export interface SimulationProductManageInput {
  readonly runId: SimulationProductRunId
  readonly managementId: SimulationProductManagementId
  readonly phase: 'paused' | 'running'
  /** Explicit original overrun acknowledgement; permitted only with phase paused and complete reported usage. */
  readonly tokenRecovery?: import('@clocky/clocky-simulation/tokens').SimulationTokenRecovery | undefined
}
/** Read one run's current product owner without attaching actors or scheduling work. */
export interface SimulationProductControlInput { readonly runId: SimulationProductRunId }
/** Read one original management result without resending its operation. */
export interface SimulationProductManagementInput extends SimulationProductControlInput {
  readonly managementId: SimulationProductManagementId
}
/** Stable remedial category; no native storage diagnostic is exposed. */
export type SimulationProductControlReason = 'ready' | 'recovery-required' | 'checkpoint-in-progress' | 'preparation-in-progress' | 'management-in-progress'
  | 'stop-target-pending' | 'stop-target-reached' | 'stalled' | 'driver-failed' | 'execution-unavailable' | 'review-required' | 'scenario-completed' | 'scenario-blocked' | 'outcome-unknown' | 'retiring'
/** Observed permission/precondition hint; each management write checks again in the owner queue. */
export interface SimulationProductControlAction {
  readonly allowed: boolean
  readonly reason: SimulationProductControlReason
}
/** Public immutable model/budget limits; credentials, storage and private world facts are excluded. */
export interface SimulationProductControlBudget {
  readonly model: { readonly provider: string; readonly name: string }
  readonly tokensPerRequest: number
  readonly tokensPerInterval: number
  readonly interval: SimTime
  readonly residentActors: number
  readonly sharedModelLimit: number
}
/** Public remedy categories for maintenance; observation does not authorize a write. */
export type SimulationProductMaintenanceReason = 'ready' | 'preparation-in-progress' | 'request-capacity' | 'recovery-required'
  | 'retiring' | 'checkpoint-in-progress' | 'management-in-progress' | 'checkpoint-required' | 'ownership-unavailable'
  | 'scenario-progressed' | 'ingress-capacity' | 'target-unavailable'
/** One administrative operation's currently observed admission. */
export interface SimulationProductMaintenanceAction { readonly allowed: boolean; readonly reason: SimulationProductMaintenanceReason }
/** Bounded allowed targets and exact complete native input/time limits; attribution stays server-derived. */
export interface SimulationProductAdministrationControl {
  readonly actions: {
    readonly checkpoint: SimulationProductMaintenanceAction
    readonly restore: SimulationProductMaintenanceAction
    readonly prepare: SimulationProductMaintenanceAction
    readonly ingress: SimulationProductMaintenanceAction
  }
  readonly ingress: {
    readonly maxTime: SimTime
    readonly maxBytes: number
    readonly coverage?: { readonly complete: boolean; readonly returned: number; readonly total: number } | undefined
    readonly targets: readonly { readonly id: SimulationEntityId; readonly name: SimulationProductText }[]
  }
  readonly recovery?: {
    readonly checkpointId: SimulationCheckpointId
    readonly publishedAt: number
    readonly time: SimTime
    readonly revision: number
    readonly references: { readonly runs: number; readonly teams: number; readonly channels: number; readonly sessions: number }
  } | undefined
}
/** Installed scenario identity comes from the original trusted definition or template, never a run name. */
export type SimulationProductScenarioVersion = { readonly status: 'unavailable' }
  | { readonly status: 'observed'
    readonly templateId: SimulationProductText
    readonly version: '1'
    readonly driverVersion: '1'
    /** Immutable execution mode of the retained creation, independent of the current template catalog. */
    readonly execution: 'cognition-only' | 'automatic-tasks' }
/** Public immutable rule/policy and clock labels; caller-owned display text remains bounded. */
export interface SimulationProductVersionSummary {
  readonly rulesVersion: SimulationProductText
  readonly policyVersion: SimulationProductText
  readonly tickUnit: SimulationProductText
  readonly scenario: SimulationProductScenarioVersion
}
/** Administrative scheduling facts are independent of the native world observation and grant no actions. */
export type SimulationProductOperationalStatus = { readonly status: 'unavailable'
  readonly observedAt: number
  readonly scenario: { readonly status: 'unavailable' } }
  | { readonly status: 'observed'
    readonly observedAt: number
    readonly scenario: SimulationProductScenarioVersion
    readonly stopTarget?: SimulationProductControl['stopTarget'] | undefined
    readonly driverSource?: SimulationProductControl['driverSource'] | undefined
    readonly failure?: SimulationProductFailure | undefined
    readonly owner: SimulationProductControl['owner']
    readonly driver: SimulationProductControl['driver']
    readonly inFlight: boolean
    readonly stop?: SimulationProductControl['stop'] | undefined
    readonly nextAttemptAt?: number | undefined }

/** Real-time Host-wide model admission observation; run budget usage is a separate native metric. */
export type SimulationProductModelPoolObservation = { readonly status: 'unavailable'
  readonly clock: 'real'
  readonly observedAt: number }
  | { readonly status: 'observed'
    readonly clock: 'real'
    readonly observedAt: number
    readonly active: number
    readonly queued: number
    readonly limit: number
    readonly queueLimit: number }

/** Scheduling intent, product driver and in-flight work are separate observations. */
export interface SimulationProductControl {
  readonly runId: SimulationProductRunId
  readonly administration: SimulationProductAdministrationControl
  readonly budget: SimulationProductControlBudget
  /** First retained unacknowledged overrun; a quote is not permission to resume or change per-request limits. */
  readonly tokenRecovery?: {
    readonly request: import('@clocky/clocky-simulation/tokens').SimulationTokenRecovery
    readonly allowed: boolean
    readonly reason: 'ready' | 'pause-required' | 'in-flight' | 'unknown-usage' | 'ownership-unavailable'
  } | undefined
  /** Original full-envelope refusal, retained before provider dispatch. */
  readonly requestBudget?: (import('@clocky/clocky-simulation/tokens').SimulationRequestBudgetBlock & { readonly decisionId: string }) | undefined
  /** Absence denotes an older protocol peer; deployed owners explicitly report observed or unavailable. */
  readonly modelPool?: SimulationProductModelPoolObservation | undefined
  readonly versions?: SimulationProductVersionSummary | undefined
  readonly owner: 'held' | 'not-held'
  readonly phase?: 'paused' | 'running' | 'stalled' | undefined
  readonly revision?: number | undefined
  readonly failure?: SimulationProductFailure | undefined
  /** Native facts and the driver observation may come from different revisions. */
  readonly historyRead?: { readonly status: 'unavailable'
    readonly reason: SimulationProductReadFailure
    readonly limit?: SimulationProductReadLimit | undefined } | undefined
  readonly stopTarget?: import('@clocky/clocky-simulation/run-control-observation').SimulationRunControlObservation | undefined
  readonly driverSource?: { readonly status: 'live' | 'owner-unavailable'
    readonly revision?: number | undefined
    readonly observedAt: number } | undefined
  readonly driver: 'idle' | 'scheduled' | 'advancing' | 'checkpointing' | 'waiting' | 'completed' | 'failed' | 'retiring'
  readonly inFlight: boolean
  readonly observedAt: number
  readonly stop?: 'paused' | 'stalled' | 'until' | 'work-limit' | 'decision-required' | 'retry' | 'outcome-unknown'
    | 'message-rejected' | 'context-integrity' | 'decision-timeout' | 'token-overrun' | 'request-budget'
    | 'recipient-required' | 'recipient-busy' | 'coordination-limit' | 'resident-capacity' | 'residency-recovery-required'
    | 'review-required' | 'completed' | 'scenario-blocked' | 'recovery-required'
    | 'idle' | 'maintenance-blocked' | 'position-capacity' | 'authority-missing' | 'approval-required' | 'existing-obligations' | 'plan-stale' | 'plan-budget'
    | 'stale-time' | 'waiting-effective-time' | 'handoff-required'
    | 'retirement-unknown'
    | 'resource-capacity' | 'resource-history-limit' | 'resource-reservation-expired'
    | 'entity-capacity' | 'identity-capacity' | 'channel-capacity' | 'world-byte-limit' | 'world-request-limit' | 'world-command-limit'
    | 'world-birth-limit' | 'world-expansion-limit' | 'world-mutation-limit'
    | 'budget-limit' | 'context-limit' | 'microstep-limit' | 'model-pool-capacity' | 'activation-history-limit' | 'message-byte-limit' | undefined
  readonly nextAttemptAt?: number | undefined
  readonly actions: { readonly start: SimulationProductControlAction; readonly pause: SimulationProductControlAction }
}
/** Original durable management fact; failed native diagnostic text is withheld. */
export interface SimulationProductManagementReceipt {
  readonly managementId: SimulationProductManagementId
  readonly phase: 'paused' | 'running'
  readonly status: 'in-progress' | 'completed' | 'failed'
  readonly startedSequence: number
  readonly finishedSequence?: number | undefined
  readonly failure?: 'details-withheld' | undefined
}
/** Returning an old completed request does not imply that the current phase equals its original target. */
export interface SimulationProductManageResult {
  readonly runId: SimulationProductRunId
  readonly operation: SimulationProductManagementReceipt
  readonly control: SimulationProductControl
}
/** Absence does not establish failure; queries never take execution ownership or resume inference. */
export type SimulationProductManagementResult = {
  readonly runId: SimulationProductRunId
  readonly managementId: SimulationProductManagementId
} & ({ readonly status: 'not-found' } | { readonly status: 'found'; readonly operation: SimulationProductManagementReceipt })

/** Authenticated caller-selected command identity; Host derives run ownership and current revision. */
export interface SimulationProductRunControlInput {
  readonly runId: SimulationProductRunId
  readonly commandId: string
  readonly target: import('@clocky/clocky-simulation/run-control').SimulationStopTarget | null
}
/** Original durable receipt remains separate from the current stop state after later updates. */
export interface SimulationProductRunControlResult {
  readonly runId: SimulationProductRunId
  readonly receipt: import('@clocky/clocky-simulation/run-control').SimulationRunControlReceipt
  readonly control: SimulationProductControl
}

/** Numeric refusal measurements are safe independently of physical storage diagnostics. */
export interface SimulationProductReadLimit {
  readonly dimension: 'entries' | 'bytes' | 'entry-bytes'
  readonly actual: number
  readonly limit: number
}
