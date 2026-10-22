/** Browser-safe domain contracts; schemas validate structure while Native owns admission and effects. */
import type { Branded } from '@clocky/clocky-brand'
export type { WorldFactId } from './world-facts-types.ts'
import type { z } from 'zod'
import type {
  simulationWorldDomainSelectorSchema, simulationWorldDomainPinSchema, simulationWorldEvidenceRefSchema,
  simulationWorldDomainRequestSchema, simulationWorldDomainPlanSchema, simulationWorldDomainResultSchema,
  simulationWorldDomainMutationSchema, simulationWorldDomainFailureCodeSchema,
  simulationWorldReadSetSchema,
} from './world-domain.ts'

/** Native-assigned stable domain business identity within one run. */
export type WorldIntentId = Branded<'SimulationWorldIntentId'>
/** Stable identity of one core-owned mutation responsibility. */
export type WorldMutationId = Branded<'SimulationWorldMutationId'>
/** Installed immutable payload schema identity. */
export type WorldSchemaRef = Branded<'SimulationWorldSchemaRef'>
/** Immutable implementation artifact identity; a generation cannot substitute another artifact. */
export type WorldImplementationRef = Branded<'SimulationWorldImplementationRef'>
/** Stable resource account or other installed domain resource identity. */
export type WorldResourceId = Branded<'SimulationWorldResourceId'>
/** Stable frozen world definition identity. */
export type WorldDefinitionId = Branded<'SimulationWorldDefinitionId'>
/** Stable authority grant identity owned by Native or its installed policy provider. */
export type WorldAuthorityId = Branded<'SimulationWorldAuthorityId'>
/** Stable versioned institution identity. */
export type WorldNormId = Branded<'SimulationWorldNormId'>
/** Stable governance proposal identity. */
export type WorldProposalId = Branded<'SimulationWorldProposalId'>
/** Stable governance decision identity. */
export type WorldResolutionId = Branded<'SimulationWorldResolutionId'>
/** Stable external party identity independently of its representation. */
export type WorldExternalIdentityId = Branded<'SimulationWorldExternalIdentityId'>

/** Exact installed operation selector; versions never fall back to a compatible implementation. */
export type SimulationWorldDomainSelector = z.infer<typeof simulationWorldDomainSelectorSchema>
/** Immutable schema and implementation generation selected before accepting a plan. */
export type SimulationWorldDomainPin = z.infer<typeof simulationWorldDomainPinSchema>
/** Typed owner-comparable evidence, which cannot itself grant authority to read its source. */
export type SimulationWorldEvidenceRef = z.infer<typeof simulationWorldEvidenceRefSchema>
/** Exact typed reads whose owning domain/core services decide whether a retained plan is stale. */
export type SimulationWorldDomainReadSet = z.infer<typeof simulationWorldReadSetSchema>
/** Model proposed body; caller identity and run/source metadata are derived by Native. */
export type SimulationWorldDomainRequest = z.infer<typeof simulationWorldDomainRequestSchema>
/** JSON value permitted in versioned domain payloads; registered schemas define its business shape. */
export type SimulationWorldJsonValue = SimulationWorldDomainRequest['payload']
/** Immutable accepted plan envelope; the domain parser validates its inner payload. */
export type SimulationWorldDomainPlan = z.infer<typeof simulationWorldDomainPlanSchema>
/** Core-owned domain result envelope with an explicit terminal, blocked or unknown outcome. */
export type SimulationWorldDomainResult = z.infer<typeof simulationWorldDomainResultSchema>
/** Durable core mutation responsibility, independent of public result notification. */
export type SimulationWorldDomainMutation = z.infer<typeof simulationWorldDomainMutationSchema>
/** Stable machine-readable failures independent of trusted diagnostic wording. */
export type SimulationWorldDomainFailureCode = z.infer<typeof simulationWorldDomainFailureCodeSchema>

/** Four strict domain payload parsers registered together under one immutable schema identity. */
export interface SimulationWorldDomainSchemas {
  /** Proposed request payload; Native authenticates the caller separately. */
  readonly request: z.ZodType
  /** Domain apply payload; Native owns the common resolution, rejection and private rationale envelope. */
  readonly plan: z.ZodType
  /** Public result payload; domain projection must omit private planning material. */
  readonly result: z.ZodType
  /** Core-owned mutation payload; parsing never performs a mutation. */
  readonly mutation: z.ZodType
}

/** Installed domain operation definition shared by tool, persistence and SDK consumers. */
export interface SimulationWorldDomainDefinition extends SimulationWorldDomainSelector {
  /** Optional finite clarification vocabulary; absence declares no supported evidence fields for this pin. */
  readonly evidenceFields?: readonly import('./world-evidence-types.ts').SimulationWorldEvidenceField[]
  /** Explicit environment capability; absent operations cannot be initiated by scenario-authorized director events. */
  readonly directorEvents?: true
  /** Immutable schema artifact identity for these exact payload parsers and optional evidence field definitions. */
  readonly schemaRef: WorldSchemaRef
  /** Strict parsers retained by identity; a new parser object requires a new schemaRef in this registry. */
  readonly schemas: SimulationWorldDomainSchemas
}

/** Identity required of the execution capabilities installed by the domain provider. */
export interface SimulationWorldDomainImplementation {
  /** Pure exact-generation business projection over host-authorized original evidence; absence means unsupported. */
  readonly summary?: (evidence: import('./world-summary.ts').SimulationWorldBusinessSummaryEvidence) =>
  import('./world-summary.ts').SimulationWorldBusinessSummary

  /** Exact implementation artifact identity retained in accepted plans. */
  readonly ref: WorldImplementationRef
  /** Positive process/provider generation fixed for the registration lifetime. */
  readonly generation: number
}

/** A synchronous admission capability whose implementation remains held until release. */
export interface SimulationWorldDomainLease<I extends SimulationWorldDomainImplementation = SimulationWorldDomainImplementation> {
  /** Exact immutable pin for the admitted execution. */
  readonly pin: SimulationWorldDomainPin
  /** Original implementation; caller-specific execution members remain available through I. */
  readonly implementation: I
  /** Release this operation once; duplicate release calls are harmless. */
  release(): void
}
