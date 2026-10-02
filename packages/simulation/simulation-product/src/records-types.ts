/** Bounded authoritative journal browsing; metadata and original content have independent permission. */
import type { SimulationProductRunId, SimulationProductCursor, SimulationProductText } from './types.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'

/** Exact journal query; original content is requested deliberately and never implied by run ownership. */
export interface SimulationProductRecordsInput {
  readonly runId: SimulationProductRunId
  readonly mode: 'metadata' | 'original'
  /** Exact native record kind, not a full-text search over private values. */
  readonly kind?: string | undefined
  /** Original sequence reference; absent means the filtered journal. */
  readonly sequence?: number | undefined
  readonly expectedRevision?: number | undefined
  readonly limit?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
}

/** Original JSON is UTF-8 text for inspection/download only, never executable or rendered as markup. */
export interface SimulationProductRecordItem {
  readonly sequence: number
  readonly kind: SimulationProductText
  readonly action?: SimulationProductText | undefined
  readonly body: { readonly status: 'withheld' }
    | { readonly status: 'text'; readonly text: string; readonly part: number; readonly parts: number }
}

/** One policy-tagged journal window; total counts original records while pagination may split their bodies. */
export interface SimulationProductRecordsPage {
  readonly runId: SimulationProductRunId
  readonly snapshotRevision: number
  readonly readVersion: SimulationProductReadVersion
  readonly observedAt: number
  readonly mode: 'metadata' | 'original'
  readonly bodyAccess: 'allowed' | 'withheld'
  readonly selection: { readonly kind?: string | undefined; readonly sequence?: number | undefined }
  readonly totalRecords: number
  readonly items: readonly SimulationProductRecordItem[]
  readonly nextCursor?: SimulationProductCursor | undefined
}
