/** Explicit raw preservation of one authorized registered source, independent of Native parser availability. */
import type { SimulationProductRunId, SimulationProductCursor } from './types.ts'
import type { SimulationProductReadVersion } from './watch-types.ts'

/** Query carries neither a source path nor permission, provider or version-override fields. */
export interface SimulationProductRawArchiveInput {
  readonly runId: SimulationProductRunId
  readonly limit?: number | undefined
  readonly cursor?: SimulationProductCursor | undefined
}
/** Text parts concatenate to one JSON preservation archive with embedded original byte payloads. */
export interface SimulationProductRawArchivePage {
  readonly runId: SimulationProductRunId
  readonly readVersion: SimulationProductReadVersion
  readonly observedAt: number
  readonly source: {
    readonly journalVersion: number
    readonly firstSequence: number
    readonly tailSequence: number
    readonly entryCount: number
    readonly representation: 'json-document-bytes' | 'sqlite-logical-frames'
    readonly sourceHash: string
    readonly nativeValidation: 'not-performed'
    readonly physicalDatabaseCopy: false
  }
  readonly totalParts: number
  readonly items: readonly { readonly part: number; readonly text: string }[]
  readonly nextCursor?: SimulationProductCursor | undefined
}
