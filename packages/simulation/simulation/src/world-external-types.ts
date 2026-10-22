/** Browser-safe persisted external records, without IO or runtime inference dependencies. */
import type { SimulationExternalAdjudication, SimulationExternalAdjudicatedEventState } from './world-external-mediated-types.ts'
import type { SimulationEventId } from './scheduler-types.ts'
import type { z } from 'zod'
import type { simulationExternalRepresentativeReservationSchema, simulationExternalContactSchema,
  simulationExternalContactCleanupEvidenceSchema } from './world-external-actor.ts'
import type { WorldExternalIdentityId, WorldIntentId } from './world-domain-types.ts'
import type { simulationExternalIdentitySchema, simulationExternalInteractionSchema,
  simulationExternalEffectSchema } from './world-external.ts'
/** Stable external organization and its installed representation policy. */
export type SimulationExternalIdentity = z.infer<typeof simulationExternalIdentitySchema>
/** Original recorded availability evaluation and its exact causal source. */
export type SimulationExternalInteraction = z.infer<typeof simulationExternalInteractionSchema>
/** Closed evaluation effect; Native independently derives actual inputs and output. */
export type SimulationExternalEffect = z.infer<typeof simulationExternalEffectSchema>
/** Sole Native-owned registry and immutable interactions within one run. */
export interface SimulationExternalState {
  /** Actual original director adjudications inside this same Native registry. */
  readonly adjudications: Readonly<Record<WorldIntentId, SimulationExternalAdjudication>>
  /** Original finite delayed responsibilities and their exact consumption. */
  readonly events: Readonly<Record<SimulationEventId, SimulationExternalAdjudicatedEventState>>
  /** Original private conversations; cases share only a ready representative, never another caller's history. */
  readonly contacts: Readonly<Record<WorldIntentId, SimulationExternalContact>>
  readonly representatives: Readonly<Record<WorldIntentId, SimulationExternalRepresentativeReservation>>
  readonly identities: Readonly<Record<WorldExternalIdentityId, SimulationExternalIdentity>>
  readonly interactions: Readonly<Record<WorldIntentId, SimulationExternalInteraction>>
}

/** Original representative preparation and canonical identities; this grants no employment or asset control. */
export type SimulationExternalRepresentativeReservation = z.infer<typeof simulationExternalRepresentativeReservationSchema>

/** Durable original contact and its canonical per-caller Channel. */
export type SimulationExternalContact = z.infer<typeof simulationExternalContactSchema>

/** Canonical evidence for withdrawing one caller case without retiring a shared representative. */
export type SimulationExternalContactCleanupEvidence = z.infer<typeof simulationExternalContactCleanupEvidenceSchema>
