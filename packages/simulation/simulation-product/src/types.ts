/** Product directory records and public read DTOs; world state remains provider-owned. */
import type { Branded } from '@clocky/clocky-brand'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import type { SimulationRuntimeMetrics } from '@clocky/clocky-simulation/metrics-types'
export type * from './collections-types.ts'
export type * from './administration-types.ts'
export type * from './control-types.ts'
export type * from './maintenance-types.ts'
export type * from './task-control-types.ts'
export type * from './watch-types.ts'
export type * from './knowledge-types.ts'

/** Stable directory identity independent of storage paths and provider-local run IDs. */
export type SimulationProductRunId = Branded<'SimulationProductRunId'>
/** Opaque continuation authenticated to this principal generation and directory revision. */
export type SimulationProductCursor = Branded<'SimulationProductCursor'>

/** Bounded display text with explicit truncation. */
export interface SimulationProductText {
  readonly text: string
  readonly truncated: boolean
}

/** Safe directory metadata; listing does not inspect provider journals. */
export interface SimulationProductRunSummary {
  readonly id: SimulationProductRunId
  readonly name: SimulationProductText
  readonly registeredAt: number
  readonly observation: 'not-observed'
}

/** Public directory query; no principal, provider or filesystem parameters. */
export interface SimulationProductListInput {
  readonly cursor?: SimulationProductCursor | undefined
  readonly limit?: number | undefined
  readonly search?: string | undefined
}

/** One complete bounded authorized directory window. */
export interface SimulationProductRunPage {
  readonly items: readonly SimulationProductRunSummary[]
  readonly nextCursor?: SimulationProductCursor | undefined
}

/** Exact registered run selector; its provider/spec come from the directory. */
export interface SimulationProductInspectInput {
  readonly runId: SimulationProductRunId
}

/** Provider state exposed only as bounded administrative summary. */
export interface SimulationProductRunInspection {
  readonly run: SimulationProductRunSummary
  readonly status: 'observed' | 'missing'
  /** Independent scheduling metadata; basic native reads explicitly lack the administrative owner. */
  readonly operational?: import('./control-types.ts').SimulationProductOperationalStatus | undefined
  readonly world?: {
    readonly revision: number
    readonly phase: 'paused' | 'running' | 'stalled'
    readonly time: SimTime
    readonly tickUnit: SimulationProductText
    /** Missing on older peers; current product readers always supply authoritative values. */
    readonly rulesVersion?: SimulationProductText | undefined
    readonly policyVersion?: SimulationProductText | undefined
    readonly metrics?: SimulationRuntimeMetrics | undefined
    /** Fixed native stop category and recovery action; private stall references and bodies are withheld. */
    readonly schedulerStop?: { readonly code: string; readonly recovery: string } | undefined
    readonly owner: 'this-provider' | 'unowned' | 'other-owner' | 'unavailable'
    readonly entityCount: number
    readonly decisionCount: number
    readonly operationCount: number
    readonly observedAt: number
  } | undefined
}

/** Exact authorized directory run identities; the deployment page and complete-byte bounds apply to the whole batch. */
export interface SimulationProductRunStatusesInput {
  readonly runIds: readonly SimulationProductRunId[]
}

/** A failed provider or unrepresentable usage cannot become a zero-valued observation. */
export type SimulationProductRunStatus = SimulationProductRunInspection | {
  readonly run: SimulationProductRunSummary
  readonly status: 'unavailable'
  readonly errorSummary: SimulationProductText
  readonly operational?: import('./control-types.ts').SimulationProductOperationalStatus | undefined
}

/** One bounded batch in request order; credential retirement invalidates every returned observation. */
export interface SimulationProductRunStatusesPage {
  readonly items: readonly SimulationProductRunStatus[]
  readonly modelPool?: import('./control-types.ts').SimulationProductModelPoolObservation | undefined
}
export type * from './records-types.ts'
export type * from './sources-types.ts'
export type * from './review-types.ts'
export type * from './operation-retry-types.ts'
