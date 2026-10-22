/** Immutable institution versions and closed Native effects; readable text is separate from policy enforcement. */
import type { Branded } from '@clocky/clocky-brand'
import type { z } from 'zod'
import type {
  simulationNormReferenceSchema, simulationNormVersionSchema, simulationNormClosureSchema, simulationNormAnnouncementSchema,
  simulationNormEnactRequestSchema, simulationNormRevokeRequestSchema, simulationNormEffectSchema,
  simulationNormQuerySchema, simulationNormObligationReferenceSchema, simulationNormMutationSourceSchema,
  simulationInitialNormSchema, simulationFrozenCommitteePolicySchema, simulationNormBootstrapSourceSchema,
} from './world-norms.ts'
import type { WorldNormId } from './world-domain-types.ts'

/** Canonical positive decimal institution version; old originals never change. */
export type WorldNormVersion = Branded<'SimulationWorldNormVersion'>
/** Stable append-only closure identity derived from an original mutation and predecessor. */
export type WorldNormClosureId = Branded<'SimulationWorldNormClosureId'>
/** Stable audience-frozen announcement responsibility; it does not assert receipt or understanding. */
export type WorldNormAnnouncementId = Branded<'SimulationWorldNormAnnouncementId'>
/** Exact immutable institution identity. */
export type SimulationNormReference = z.infer<typeof simulationNormReferenceSchema>
/** Immutable scenario-authored or governance-approved institution, retaining its distinct original provenance. */
export type SimulationNormVersion = z.infer<typeof simulationNormVersionSchema>
/** One immutable predecessor interval closure, separate from its original version. */
export type SimulationNormClosure = z.infer<typeof simulationNormClosureSchema>
/** Frozen actual recipients and trusted approved material requiring later Native delivery. */
export type SimulationNormAnnouncement = z.infer<typeof simulationNormAnnouncementSchema>
/** Complete enact input; every policy, temporal and original-governance field is explicit. */
export type SimulationNormEnactRequest = z.infer<typeof simulationNormEnactRequestSchema>
/** Approved revocation creates another version and a closure, preserving legal history. */
export type SimulationNormRevokeRequest = z.infer<typeof simulationNormRevokeRequestSchema>
/** Closed institution effect; providers cannot patch arbitrary Snapshot paths. */
export type SimulationNormEffect = z.infer<typeof simulationNormEffectSchema>
/** Original request/plan/mutation identity supplied by the Native mutation owner. */
export type SimulationNormMutationSource = z.infer<typeof simulationNormMutationSourceSchema>
/** Exact initial institution body and installed enforcement declared by its original scenario. */
export type SimulationInitialNorm = z.infer<typeof simulationInitialNormSchema>
/** Scenario-frozen committee membership and voting rule; model proposals cannot replace it. */
export type SimulationFrozenCommitteePolicy = z.infer<typeof simulationFrozenCommitteePolicySchema>
/** Actual earlier Native bootstrap sequence and immutable original definition hash. */
export type SimulationNormBootstrapSource = z.infer<typeof simulationNormBootstrapSourceSchema>
/** Typed old responsibility which blocks unsupported obligation migration. */
export type SimulationNormObligationReference = z.infer<typeof simulationNormObligationReferenceSchema>
/** Bounded as-of institution background query; disclosure never grants policy bypass. */
export type SimulationNormQuery = z.infer<typeof simulationNormQuerySchema>
/** Sole Native institution projection with append-only originals and separate announcements. */
export interface SimulationNormState {
  /** Every original version, including revocations, retained in append order. */
  readonly versions: Readonly<Record<WorldNormId, readonly SimulationNormVersion[]>>
  /** Original interval endings; successor publication does not edit a predecessor. */
  readonly closures: readonly SimulationNormClosure[]
  /** Original publication responsibilities keyed by exact derived identity. */
  readonly announcements: Readonly<Record<WorldNormAnnouncementId, SimulationNormAnnouncement>>
}
/** A known version can be effective, announced for later, historically closed or a revocation notice. */
export interface SimulationNormView {
  /** Exact immutable version and original approved body. */
  readonly norm: SimulationNormVersion
  /** Effective state is independent of availability and actual delivery. */
  readonly effective: 'effective' | 'scheduled' | 'historical' | 'revoked'
}
/** Complete reader-known selection; a hidden or missing requested norm remains unknown. */
export interface SimulationNormProjection {
  /** Actual reader selected by Native. */
  readonly viewer: SimulationNormQuery['viewer']
  /** Original publication fence, also applied to closure records. */
  readonly cursor: number
  /** Canonical simulated selection time. */
  readonly time: SimulationNormQuery['time']
  /** Exact known originals; query overflow rejects rather than silently truncating. */
  readonly items: readonly SimulationNormView[]
  /** Explicit requested identities without permitted available material. */
  readonly unknown: readonly WorldNormId[]
}
