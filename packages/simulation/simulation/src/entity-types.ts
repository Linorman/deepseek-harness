/** Stable entity and organization records; no activation is implied. @module @clocky/clocky-simulation/entity-types */
import type { z } from 'zod'
import type { simulationChangeSchema, simulationProfileSchema, simulationRelationRuleSchema } from './entity.ts'
import type { SimulationEntityBinding, SimulationWriter } from './writer-types.ts'
import type { SimTime } from './types.ts'
import type { SimulationEntityId, SimulationRelationId } from './identities.ts'
export type { SimulationEntityId, SimulationRelationId } from './identities.ts'
/** Validated JSON metadata attached to an entity profile. */
export type SimulationProfile = z.infer<typeof simulationProfileSchema>
/** Immutable per-run endpoint and cycle constraints. */
export type SimulationRelationRule = z.infer<typeof simulationRelationRuleSchema>
/** Validated administrative mutation admitted by a run's write queue. */
export type SimulationChange = z.infer<typeof simulationChangeSchema>
/** Stable entity projection with separate profile and lifecycle revisions. */
export interface SimulationEntity {
  readonly participantReservation?: SimulationParticipantReservation
  readonly id: SimulationEntityId
  readonly kind: string
  readonly cognition: 'none' | 'agent'
  readonly revision: number
  readonly profileRevision: number
  readonly phase: 'active' | 'inactive' | 'terminated'
  /** Explicit trusted bootstrap or preparation outcome; abandoned cannot become ready. */
  readonly readiness: 'preparing' | 'ready' | 'abandoned'
  readonly profile: SimulationProfile
  readonly binding?: SimulationEntityBinding
  readonly writer?: SimulationWriter
}
/** Immutable local actor configuration, without caller-selected execution identity or authority. */
export interface SimulationParticipantSpec {
  readonly displayName: string
  readonly role: string
  readonly capabilities: readonly string[]
  readonly provider: string
  readonly preset: string
  readonly model: string
}
/** Canonical identity reserved before invitation and retained after binding. */
export interface SimulationParticipantReservation {
  readonly binding: SimulationEntityBinding
  readonly participant: SimulationParticipantSpec
}
/** Relation valid on the half-open interval [validFrom, validUntil); null has no upper bound. */
export interface SimulationRelation {
  readonly id: SimulationRelationId
  readonly subject: SimulationEntityId
  readonly relation: string
  readonly object: SimulationEntityId
  /** Optional organization identity; its kind must be permitted by the relation rule. */
  readonly scope?: SimulationEntityId
  readonly validFrom: SimTime
  readonly validUntil: SimTime | null
  readonly revision: number
}
