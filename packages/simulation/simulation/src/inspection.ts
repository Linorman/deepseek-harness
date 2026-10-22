/** Trusted native inspection observes existing runs without acquiring execution ownership. */
import { z } from 'zod'
import { simulationRunSpecSchema } from './schema.ts'
import type { SimulationRunSpec, SimulationSnapshot } from './types.ts'

/** Deployment-resolved provider and immutable expected run configuration. */
export interface SimulationInspectionSelection {
  readonly provider: string
  readonly spec: SimulationRunSpec
  /** Include validated original journal entries for trusted source inspection; never a public transport flag. */
  readonly includeRecords?: boolean | undefined
}

/** Owner status is an observation, never permission to take over or execute. */
export type SimulationOwnerObservation = 'this-provider' | 'unowned' | 'other-owner' | 'unavailable'

/** Detached authoritative history; native consumers own authorization and public redaction. */
export interface SimulationRunObservation {
  /** Exact validated journal prefix digest when supplied by the provider; binds continuations beyond a numeric revision. */
  readonly sourceHash?: string | undefined

  readonly snapshot: SimulationSnapshot
  readonly owner: SimulationOwnerObservation
  /** Complete validated history within provider inspection allowances; absent unless explicitly requested. */
  readonly records?: readonly { readonly sequence: number; readonly value: unknown }[] | undefined
}

/** Exact Native prefix paired with its metadata-only obligation inventory; no writable owner is acquired. */
export interface SimulationPersonnelObligationObservation {
  readonly snapshot: SimulationSnapshot
  readonly report: import('./personnel-obligations.ts').PersonnelObligationReport
}

/** Parse immutable inspection selection without accepting create/open or filesystem flags. */
export const simulationInspectionSelectionSchema = z.object({ provider: z.string().trim().min(1), spec: simulationRunSpecSchema,
  includeRecords: z.boolean().optional() })
  .strict() satisfies z.ZodType<SimulationInspectionSelection>

/** Published derived index identity; source records remain authoritative. */
export const simulationIndexManifestSchema = z.strictObject({
  schema: z.literal('clocky/simulation-inspection-index'), version: z.literal(1),
  journalVersion: z.number().int().positive(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  cursor: z.number().int().nonnegative(),
})
/** Metadata returned after explicit atomic index publication. */
export type SimulationIndexManifest = z.infer<typeof simulationIndexManifestSchema>

/** Registered-source raw preservation; this makes no claim that a Native parser accepted the archived contents. */
export interface SimulationRawArchiveObservation {
  readonly journalVersion: number
  readonly firstSequence: number
  readonly tailSequence: number
  readonly entryCount: number
  readonly representation: 'json-document-bytes' | 'sqlite-logical-frames'
  readonly sourceHash: string
  readonly nativeValidation: 'not-performed'
  readonly physicalDatabaseCopy: false
  readonly text: string
}
