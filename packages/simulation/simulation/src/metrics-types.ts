/** Safe runtime usage summaries derived only from authoritative native state. */
import type { SimTime } from './time-types.ts'

/** Reserved, active and revoked writers occupy slots until controller-confirmed release. */
export interface SimulationResidentSlots {
  readonly used: number
  readonly limit: number
  /** Nonactive writers, plus retained writers lacking a confirmed current owner. */
  readonly recoveryRequired: number
}

/** Current interval charges and unresolved administrative responsibilities; no private bodies or configuration paths. */
export interface SimulationRuntimeMetrics {
  readonly budgets: {
    readonly interval: SimTime
    readonly width: SimTime
    /** Charged includes reservations and observed overruns; unknown attempts remain charged. */
    readonly tokens: { readonly charged: number; readonly limit: number; readonly unknownAttempts: number }
    readonly decisions: { readonly used: number; readonly limit: number }
    readonly messages: { readonly used: number; readonly limit: number }
  }
  readonly residentSlots: SimulationResidentSlots
  /** Open/submitted decisions plus queued/reserved nominations, independently of total retained history. */
  readonly pendingDecisionCount: number
  /** Unsettled communication/post and task/create intents, including explicit unknown outcomes. */
  readonly pendingExternalOperationCount: number
  /** Operations explicitly retained as outcome-unknown. */
  readonly unknownOperationCount: number
}
