/** World input types without runtime dependencies or execution authority. */
import type { Branded } from '@clocky/clocky-brand'
import type { ChannelId } from '@clocky/clocky-team/types'
import type { SimulationEntityId } from './identities.ts'
import type { SimTime } from './time-types.ts'
import type { SimulationWorldDirectorTrigger } from './world-calendar.ts'
import type { SimulationWorldHireReservation } from './world-hire-types.ts'
import type { SimulationWorldDomainPin, SimulationWorldDomainRequest, SimulationWorldDomainReadSet,
  SimulationWorldEvidenceRef, SimulationWorldJsonValue, WorldIntentId } from './world-domain-types.ts'
export type { SimulationWorldHireReserveRequest, SimulationWorldHireReservation,
  SimulationWorldHireIdentities } from './world-hire-types.ts'
import type { z } from 'zod'
import type {
  simulationHireIntentRequestSchema, simulationWorldDefinitionSchema, simulationWorldPersonaSchema,
  simulationWorldRejectionReasonSchema, simulationWorldRequestOperationSchema, simulationWorldResolveOperationSchema,
  simulationWorldTemplateSchema,
  simulationWorldCancelRequestSchema, simulationWorldCancellationSchema, simulationWorldResultSchema,
  simulationWorldOperationGrantSchema, simulationWorldResolutionSchema,
} from './world.ts'

/** Stable run-local request identity assigned at decision acceptance. */
export type WorldRequestId = Branded<'SimulationWorldRequestId'>
/** Stable run-local plan identity assigned at decision acceptance. */
export type WorldPlanId = Branded<'SimulationWorldPlanId'>
/** Stable identity of one terminal business result, independent of notification attempts. */
export type WorldResultId = Branded<'SimulationWorldResultId'>
/** Original trusted cancellation command identity retained across response loss. */
export type WorldCancelId = Branded<'SimulationWorldCancelId'>
/** Trusted case cancellation input; product authorization belongs to its command owner. */
export type SimulationWorldCancelRequest = z.infer<typeof simulationWorldCancelRequestSchema>
/** Durable cancellation receipt; an already resolved case retains its original result. */
export type SimulationWorldCancellation = z.infer<typeof simulationWorldCancellationSchema>
/** Structured terminal business result; private director rationale is excluded. */
export type SimulationWorldResult = z.infer<typeof simulationWorldResultSchema>
/** Frozen world configuration whose live references require Native validation. */
export type SimulationWorldDefinition = z.infer<typeof simulationWorldDefinitionSchema>
/** Frozen operation authorization whose relation and entity ownership still require Native checks. */
export type SimulationWorldOperationGrant = z.infer<typeof simulationWorldOperationGrantSchema>
/** Complete persona whose selected values require frozen-template validation. */
export type SimulationWorldPersona = z.infer<typeof simulationWorldPersonaSchema>
/** Trusted versioned finite options for a generated persona. */
export type SimulationWorldTemplate = z.infer<typeof simulationWorldTemplateSchema>
/**
 * Business identity fields; priorRequestId links a resubmission after insufficient information.
 */
export type SimulationHireIntentRequest = z.infer<typeof simulationHireIntentRequestSchema>
/** Proposed domain request; Native derives or matches its business application from the actual actor. */
export type SimulationWorldRequestOperation = z.infer<typeof simulationWorldRequestOperationSchema>
/** Proposed director resolution with private rationale and explicit predecessor. */
export type SimulationWorldResolveOperation = z.infer<typeof simulationWorldResolveOperationSchema>
/** Common apply/reject disposition; domain schemas validate the business payload of an apply plan. */
export type SimulationWorldResolution = z.infer<typeof simulationWorldResolutionSchema>
/** Business execution disposition; clarification is owned by the common protocol rather than domain effects. */
export type SimulationWorldBusinessResolution = Exclude<SimulationWorldResolution, { kind: 'awaiting-evidence' }>
/** Bounded rejection vocabulary suitable for trusted public rendering. */
export type SimulationWorldRejectionReason = z.infer<typeof simulationWorldRejectionReasonSchema>

/** Immutable domain business identity and input retained in the sole Native journal. */
interface SimulationWorldIntentFields {
  /** Native-derived run-local business identity, independent of model decision retries. */
  readonly id: WorldIntentId
  /** Exact schema, reducer and implementation generation installed for this operation. */
  readonly pin: SimulationWorldDomainPin
  /** Stable domain business key verified against the authenticated requester's scope. */
  readonly businessKey: string
  /** Actual admitted actor; domain payloads cannot select a different requester. */
  /** Authoritative scope selected by the installed domain and independently verified by Native. */
  readonly scopeEntityId: SimulationEntityId
  /** Domain-admitted business target; generic product views never assume a hiring position. */
  readonly targetEntityId: SimulationEntityId
  /** Original requested effective time; null selects the operation's next safe boundary. */
  readonly expectedTime: SimTime | null
  /** Original request evidence, independently checked by the installed Native owner. */
  readonly evidence: readonly import('./world-domain-types.ts').SimulationWorldEvidenceRef[]
  /** Exact private description derived at original admission. */
  readonly description: string
  /** Immutable installed-domain input; its registered request schema verifies business fields. */
  readonly payload: SimulationWorldJsonValue
  /** Journal position which established this business identity. */
  readonly sequence: number
  /** Original recorded request, absent only before the intent's first accepted request. */
  readonly requestId?: WorldRequestId | undefined
  /** Actual scenario declaration/calendar occurrence; absent for ordinary role requests. */
  readonly scenarioTrigger?: SimulationWorldDirectorTrigger | undefined
}
/** Role intent or an actual authenticated-user original; a principal is never an Entity. */
export type SimulationWorldIntent = SimulationWorldIntentFields & (
  | { readonly requesterEntityId: SimulationEntityId
    readonly source?: never }
  | { readonly requesterEntityId: null
    readonly source: import('./world-management-types.ts').SimulationWorldAuthenticatedUserSource
    readonly scenarioTrigger?: undefined }
)
/** Explicit execution reads; unrelated global journal revisions are not conflicts. */
export type SimulationWorldReadSet = SimulationWorldDomainReadSet
type SimulationWorldPlanningContext = {
  readonly intentId: WorldIntentId
  readonly pin: SimulationWorldDomainPin
  readonly reads: SimulationWorldReadSet
  readonly baseRevision: number
} & ({ readonly kind: 'request' } | { readonly kind: 'resolve'
  readonly requestId: WorldRequestId
  readonly notificationOperationId: import('./identities.ts').SimulationOperationId })
/** Native-selected context authority, frozen before inference and covered by the consumed view hash. */
export type SimulationWorldContext = (SimulationWorldPlanningContext | {
  readonly kind: 'evidence'
  readonly pin: SimulationWorldDomainPin
  readonly intentId: WorldIntentId
  readonly requestId: WorldRequestId
  readonly challengeId: import('./world-evidence-types.ts').WorldEvidenceChallengeId
  readonly inputRevision: number
  readonly notificationOperationId: import('./identities.ts').SimulationOperationId
  readonly baseRevision: number
} | {
  readonly kind: 'director-event'
  readonly pin: SimulationWorldDomainPin
  readonly trigger: SimulationWorldDirectorTrigger
  readonly businessKey: string
  readonly scopeEntityId: SimulationEntityId
  readonly targetEntityId: SimulationEntityId
  readonly baseRevision: number
} | {
  readonly kind: 'scenario-resolve'
  readonly pin: SimulationWorldDomainPin
  readonly trigger: SimulationWorldDirectorTrigger
  readonly intentId: WorldIntentId
  readonly requestId: WorldRequestId
  readonly reads: SimulationWorldReadSet
  readonly baseRevision: number
} | {
  readonly kind: 'scenario-result'
  /** Original consumed finite environment consequence, when this is a delayed follow-up. */
  readonly externalEventId?: import('./identities.ts').SimulationEventId
  readonly intentId: WorldIntentId
  readonly resultId: WorldResultId
  readonly trigger: SimulationWorldDirectorTrigger
  readonly baseRevision: number
} | {
  readonly kind: 'goal'
  readonly operations: readonly {
    readonly pin: SimulationWorldDomainPin
    readonly grants: readonly SimulationWorldEvidenceRef[]
  }[]
  readonly baseRevision: number
  readonly assignments: readonly { readonly id: import('./identities.ts').SimulationRelationId
    readonly revision: number }[]
} | {
  readonly kind: 'result'
  readonly resultId: WorldResultId
  /** Original consumed finite adjudication leaf; omission selects the initial terminal case result. */
  readonly externalEventId?: import('./identities.ts').SimulationEventId
  readonly intentId: WorldIntentId
  readonly baseRevision: number
  readonly notification: {
    readonly kind: 'communication/post'
    readonly recipient: SimulationEntityId
    readonly channelId: ChannelId
    readonly text: string
    readonly deliverAt: SimTime
  }
} | {
  readonly kind: 'first-action'
  readonly resultId: WorldResultId
  readonly intentId: WorldIntentId
  readonly baseRevision: number
}) & {
  /** Exact proposal versions whose original bodies Native selected into the consumed context-view. */
  readonly governance?: readonly import('./world-governance-types.ts').SimulationGovernanceProposalRef[]
  /** Original vote grants for each attached proposal body, including non-goal contexts; disclosure rechecks these exact relations. */
  readonly governanceAccess?: readonly {
    readonly proposal: import('./world-governance-types.ts').SimulationGovernanceProposalRef
    readonly pin: SimulationWorldDomainPin
    readonly grants: readonly SimulationWorldEvidenceRef[]
  }[]
}
/** Accepted request and original private notification; duplicate business applications reuse this record. */
interface SimulationWorldRequestFields {
  readonly id: WorldRequestId
  readonly intentId: WorldIntentId
  /** A scenario case has a Native trigger rather than a fabricated communication operation. */
  readonly notificationOperationId: import('./identities.ts').SimulationOperationId | null
  readonly proposal: SimulationWorldDomainRequest
  readonly pin: SimulationWorldDomainPin
  /** Source derives from the accepted writer and its canonical binding, never a model field. */
  readonly description: string
  readonly payloadHash: string
  readonly sequence: number
  readonly plans: readonly WorldPlanId[]
  readonly status: 'open' | 'awaiting-evidence' | 'rejected' | 'cancel-requested' | 'cancelled' | 'committed'
}
/** Actual consumed Decision, writer epoch and canonical binding that authorized a role request. */
export interface SimulationWorldDecisionSource {
  readonly kind: 'decision'
  readonly decisionId: import('./identities.ts').SimulationDecisionId
  readonly epoch: import('./identities.ts').SimulationWriterEpoch
  readonly binding: import('./binding-types.ts').SimulationEntityBinding
  /** Original Native source, present exactly when the request has no Channel notification. */
  readonly trigger?: SimulationWorldDirectorTrigger | undefined
}
/** Original request source selects disjoint immutable actor and user provenance. */
export type SimulationWorldRequest = SimulationWorldRequestFields & (
  | { readonly operationId: import('./identities.ts').SimulationOperationId
    readonly requesterEntityId: SimulationEntityId
    readonly source: SimulationWorldDecisionSource }
  | { readonly operationId: null
    readonly requesterEntityId: null
    readonly notificationOperationId: null
    readonly source: import('./world-management-types.ts').SimulationWorldAuthenticatedUserSource
    readonly admission: import('./world-management-types.ts').SimulationWorldManagementAdmission }
)
/** Accepted complete director output; no entity preparation or hiring is implied by acceptance. */
interface SimulationWorldPlanFields {
  readonly id: WorldPlanId
  readonly requestId: WorldRequestId
  readonly pin: SimulationWorldDomainPin
  readonly reads: SimulationWorldReadSet
  readonly baseRevision: number
  readonly sequence: number
  readonly hash: string
  readonly status: 'accepted' | 'stale'
  /** Persistent invalidation evidence; the proposal, consumed reads and original acceptance remain unchanged. */
  readonly stale?: {
    readonly phase: 'acceptance' | 'execution'
    readonly reason: 'read-set-changed' | 'authority-unavailable'
    readonly sequence: number
  }
}
/** Direct immutable user application, distinct from a proposed model operation. */
export interface SimulationWorldManagementApply {
  readonly kind: 'world/management-apply'
  readonly requestId: WorldRequestId
  readonly supersedes: null
  readonly resolution: Extract<SimulationWorldBusinessResolution, { kind: 'apply' }>
}
/** Both sources retain the same exact pinned execution envelope, without fabricating an operation. */
export type SimulationWorldPlan = SimulationWorldPlanFields & (
  | { readonly operationId: import('./identities.ts').SimulationOperationId
    readonly proposal: SimulationWorldResolveOperation
    readonly source?: never }
  | { readonly operationId: null
    readonly proposal: SimulationWorldManagementApply
    readonly source: import('./world-management-types.ts').SimulationWorldAuthenticatedUserSource }
)
/** One authoritative journal-owned world definition and its business identities. */
export interface SimulationWorldState {
  /** Latest original callback observation per accepted plan; armed responsibility survives cold recovery. */
  readonly executions: Readonly<Record<WorldPlanId, import('./world-execution.ts').WorldExecutionObservation>>
  /** Retained questions and immutable answer revisions for original cases. */
  readonly evidence: import('./world-evidence-types.ts').SimulationWorldEvidenceState
  /** Stable external subjects and actual recorded simulated rule evaluations. */
  readonly external: import('./world-external-types.ts').SimulationExternalState
  /** Original personnel reservations, role fences and scenario-derived authority declarations. */
  readonly personnel: import('./personnel-state.ts').PersonnelState
  /** Append-only institution versions, interval closures and frozen disclosure responsibilities. */
  readonly norms: import('./world-norms-types.ts').SimulationNormState
  /** Frozen proposals, independent votes and sole deterministic resolutions in the Native journal. */
  readonly governance: import('./world-governance-types.ts').SimulationGovernanceState
  /** Append-only authoritative fact versions; attributed beliefs and reports remain in Native knowledge. */
  readonly facts: Readonly<Record<import('./world-facts-types.ts').WorldFactId,
    readonly import('./world-facts-types.ts').SimulationWorldFact[]>>
  /** Original accepted domain mutations; their effects and results share the Native commit. */
  readonly mutations: Readonly<Record<import('./world-domain-types.ts').WorldMutationId,
    import('./world-domain-types.ts').SimulationWorldDomainMutation>>
  readonly definition: SimulationWorldDefinition
  readonly sequence: number
  readonly channels: Readonly<Record<import('./identities.ts').SimulationEntityId, import('@clocky/clocky-team/types').ChannelId>>
  readonly intents: Readonly<Record<WorldIntentId, SimulationWorldIntent>>
  readonly requests: Readonly<Record<WorldRequestId, SimulationWorldRequest>>
  readonly plans: Readonly<Record<WorldPlanId, SimulationWorldPlan>>
  readonly results: Readonly<Record<WorldResultId, SimulationWorldResult>>
  readonly cancellations: Readonly<Record<WorldCancelId, SimulationWorldCancellation>>
  readonly reservations: Readonly<Record<WorldIntentId, SimulationWorldHireReservation>>
}
