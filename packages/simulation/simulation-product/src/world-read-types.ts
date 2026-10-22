/** Browser-safe bounded World read models. Native, canonical owners and explicit content grants remain authoritative. */
import type { z } from 'zod'
import type { SimulationEntityId, SimulationRelationId, SimulationDecisionId, SimulationOperationId,
  SimulationCheckpointId } from '@clocky/clocky-simulation/identities'
import type { WorldProposalId, WorldExternalIdentityId, WorldNormId, WorldIntentId,
  WorldFactId } from '@clocky/clocky-simulation/world-domain-types'
import type { WorldRequestId } from '@clocky/clocky-simulation/world-types'
import type { TeamId, ParticipantId, ChannelId, EnvelopeId, TeamTaskId } from '@clocky/clocky-team/types'
import type { SessionId } from '@clocky/clocky-session/types'
import type { PersonnelObligation } from '@clocky/clocky-simulation/personnel-obligations'
import type { SimulationProductRunId, SimulationProductCursor } from './types.ts'
import type { simulationProductWorldDomainInputSchema, simulationProductWorldDomainResultSchema } from './world-read-schema.ts'
/** Canonical simulated time and versions remain strings beyond machine precision. */
export type SimTime = string

/** Loaded-versus-total coverage every list, graph and timeline states about itself. */
export interface Coverage {
  readonly loaded: number
  /** Absent when the Host cannot count the full set cheaply. */
  readonly total?: number | undefined
  readonly revision: number
  /** Exact collection covered by this page; false completeness never means an empty owner. */
  readonly scope: string
  readonly complete: boolean
  readonly reason?: 'native-only' | 'unavailable' | 'source-moved' | undefined
  /** Viewing instant for historical reads; absent means latest. */
  readonly at?: SimTime | undefined
  readonly nextCursor?: SimulationProductCursor | undefined
  /** Newer Host revisions observed since this page was read; the page is not replaced until an explicit refresh. */
  readonly pendingUpdates?: number | undefined
}

/** Independent disclosure of one private body (prose, Persona, reasons). */
export type Disclosure<T> =
  | { readonly state: 'allowed'; readonly value: T }
  | { readonly state: 'withheld' }
  | { readonly state: 'redacted' }
  | { readonly state: 'not-applicable' }

/** Bounded text with truncation flag, matching existing product text fields. */
export interface BoundedText { readonly text: string; readonly truncated: boolean }

/** Typed link to an exact engine-layer object; navigation preserves history. */
export type EngineRef =
  | { readonly kind: 'entity'; readonly id: SimulationEntityId; readonly label?: string | undefined }
  | { readonly kind: 'decision'; readonly id: SimulationDecisionId; readonly label?: string | undefined }
  | { readonly kind: 'operation'; readonly id: SimulationOperationId; readonly label?: string | undefined }
  | { readonly kind: 'checkpoint'; readonly id: SimulationCheckpointId; readonly label?: string | undefined }
  | { readonly kind: 'team-task'; readonly id: TeamTaskId; readonly teamId: TeamId; readonly label?: string | undefined }
  | { readonly kind: 'record'; readonly sequence: number; readonly label?: string | undefined }
  | { readonly kind: 'envelope'
    readonly id: EnvelopeId
    readonly teamId: TeamId
    readonly channelId: ChannelId
    readonly envelopeId: EnvelopeId
    readonly envelopeSequence?: number | undefined
    readonly decisionId?: SimulationDecisionId | undefined
    readonly sourceIndex?: number | undefined
    readonly label?: string | undefined }

/** Host-declared availability of one management action; the UI renders exactly these hints. */
export interface ActionHint {
  readonly action: WorldActionKind
  readonly allowed: boolean
  /** Localizable reason code when not allowed; unknown codes render verbatim. */
  readonly reason?: string | undefined
}

/** Management commands an authenticated user may preview and submit (proposed typed action catalog). */
export type WorldActionKind = 'transfer' | 'depart' | 'rehire' | 'hire-existing' | 'hiring-market' | 'cancel-case' | 'dispose-obligation'

// ── Status tracks (requests, plan authorization, execution, notification are independent machines) ──

/** Node state in one independent status track. */
export type TrackNodeState = 'done' | 'active' | 'waiting' | 'blocked' | 'rejected' | 'unknown' | 'pending'
/** Which independent machine a track describes. */
export type TrackKind = 'request' | 'plan' | 'execution' | 'notification'
/** One observed stage of a track; `label` is already localized or a raw Host code shown verbatim. */
export interface TrackStep { readonly id: string; readonly label: string; readonly state: TrackNodeState }
/** One track: observed steps and a current summary sentence. */
export interface Track { readonly kind: TrackKind; readonly steps: readonly TrackStep[]; readonly summary: string }

// ── Overview ──

/** Needs-you counters published by the Host; zero counts are hidden by the strip. */
export interface WorldAttention {
  readonly handoffRequired: number
  readonly outcomeUnknown: number
  readonly retirementUnconfirmed: number
  readonly implementationMissing: number
  readonly evidenceRequired: number
}
/** One finite scheduled event; the overview never draws an unbounded future. */
export interface ScheduledEvent { readonly at: SimTime; readonly label: BoundedText; readonly scope?: BoundedText | undefined }
/** Request counts by status for the flow strip. */
export interface CaseFlowCount { readonly status: string; readonly count: number }
/** Compact World overview projection. */
export interface WorldOverviewView {
  /** Current rules for calendar events in this same bounded upcoming page; hidden/truncated bodies are not editable. */
  readonly calendars?: readonly (Omit<import('@clocky/clocky-simulation').SimulationWorldCalendar, 'body' | 'id' | 'startsAt' | 'endsAt' | 'period'> & {
    readonly startsAt: string
    readonly endsAt: string | null
    readonly period: string
    readonly id: string
    readonly ruleRevision: number
    readonly body: Disclosure<BoundedText> })[] | undefined

  readonly runId: SimulationProductRunId
  readonly revision: number
  readonly now: SimTime
  readonly tickUnit: string
  readonly attention: WorldAttention
  readonly upcoming: readonly ScheduledEvent[]
  readonly proposals: readonly ProposalSummary[]
  readonly norms: { readonly active: number; readonly knownNotEffective: number }
  readonly external: { readonly identities: number
    readonly byKind: Readonly<Partial<Record<SourceKind, number | undefined>>>
    readonly latest?: { readonly at: SimTime; readonly summary: BoundedText } | undefined }
  readonly caseFlow: readonly CaseFlowCount[]
}

// ── Organization ──

/** Organization lens inside the module. */
export type OrganizationLens = 'structure' | 'timeline' | 'people'
/** Unit or position node in the structure tree. */
export interface OrgNode {
  readonly id: SimulationEntityId
  readonly kind: 'unit' | 'position'
  readonly name: BoundedText
  readonly parentId?: SimulationEntityId | undefined
  /** Positions carry occupancy; units do not. */
  readonly occupancy?: { readonly occupied: number; readonly reserved: number; readonly capacity: number } | undefined
}
/** Directed relation drawn in the local graph. */
export interface OrgEdge { readonly id: SimulationRelationId; readonly from: SimulationEntityId; readonly to: SimulationEntityId; readonly kind: 'parent' | 'reports-to' }
/** One assignment interval `[from, until)`. */
export interface Tenure {
  readonly id: SimulationRelationId
  readonly personId: SimulationEntityId
  readonly positionId: SimulationEntityId
  readonly positionName: BoundedText
  readonly from: SimTime
  readonly until?: SimTime | undefined
  /** Requested effective time when it differs from the actual one. */
  readonly requestedAt?: SimTime | undefined
  readonly end?: 'departed' | 'terminated' | 'transferred' | undefined
  readonly revision: number
}
/** Employment state of one person. */
export type EmploymentState = 'employed' | 'departing' | 'departed' | 'terminated' | 'candidate'
/** Residency of one cognitive person. */
export type Residency = 'resident' | 'released' | 'retiring' | 'retirement-unconfirmed' | 'not-applicable' | 'unknown'
/** Person row in the people lens. */
export interface PersonRow {
  readonly id: SimulationEntityId
  readonly name: BoundedText
  readonly unitId?: SimulationEntityId | undefined
  readonly position?: BoundedText | undefined
  readonly employment: EmploymentState
  readonly cognition: 'agent' | 'none'
  readonly residency: Residency
  readonly pendingObligations: number | null
  readonly tenures: readonly Tenure[]
}
/** Organization window for one lens and viewing instant. */
export interface OrganizationView {
  readonly runId: SimulationProductRunId
  readonly coverage: Coverage
  readonly now: SimTime
  readonly tickUnit: string
  readonly nodes: readonly OrgNode[]
  readonly edges: readonly OrgEdge[]
  readonly people: readonly PersonRow[]
  /** Loaded simulated-time range for the timeline; outside renders as an unloaded grid. */
  readonly range: { readonly from: SimTime; readonly until: SimTime }
  readonly unloadedNodes: number
}
/** Obligation group types a departing person may still hold. */
export type ObligationKind = 'decision' | 'operation' | 'task-attempt' | 'commitment' | 'resource' | 'wake' | 'message' | 'subordinate' | 'owner-duty'
/** Disposition the Host declares for one obligation. */
export type ObligationDisposition = 'wait' | 'cancel-and-recreate'
/** One obligation held by a person. */
export interface Obligation {
  readonly id: string
  readonly kind: ObligationKind
  readonly label: BoundedText
  readonly owner: BoundedText
  readonly state: 'waiting' | 'actionable' | 'handoff-required' | 'settled'
  readonly revision: number
  readonly ref?: EngineRef | undefined
  /** Exact metadata-only owner evidence; this carries no cancellation or departure authority. */
  readonly original?: { readonly owner: PersonnelObligation['owner']; readonly ref: PersonnelObligation['ref']; readonly cursor: number } | undefined
  readonly certainty?: PersonnelObligation['certainty'] | undefined
  readonly ownerState?: string | undefined
  readonly dispositions: readonly ObligationDisposition[]
}
/** Person inspector projection. */
export interface PersonDetailView {
  readonly runId: SimulationProductRunId
  readonly personId: SimulationEntityId
  readonly revision: number
  readonly name: BoundedText
  readonly employment: EmploymentState
  readonly residency: Residency
  readonly participantId?: ParticipantId | undefined
  readonly sessionId?: SessionId | undefined
  readonly entity: EngineRef
  readonly persona: Disclosure<{ readonly summary: BoundedText }>
  readonly tenures: readonly Tenure[]
  readonly obligations: readonly Obligation[]
  readonly actions: readonly ActionHint[]
  readonly sources: readonly EngineRef[]
}

// ── Governance ──

/** Proposal lifecycle; passing is not enactment. */
export type ProposalStatus = 'voting' | 'passed' | 'failed' | 'enacted' | 'withdrawn'
/** Vote cast by a frozen electorate member. */
export type Ballot = 'for' | 'against' | 'abstain' | 'none'
/** Tally counts and thresholds; early-closure wording comes from the Host. */
export interface TallyView {
  readonly for: number
  readonly against: number
  readonly abstain: number
  readonly pending: number
  readonly electorate: number
  readonly threshold: number
  readonly quorum: number
  readonly rule: 'unanimous' | 'absolute'
  /** Host-computed early closure statement, e.g. "can-still-change" or "decided". */
  readonly closure: 'open' | 'can-still-change' | 'decided' | 'closed'
}
/** Proposal list row. */
export interface ProposalSummary {
  readonly id: WorldProposalId
  readonly title: BoundedText
  readonly committee: BoundedText
  readonly status: ProposalStatus
  readonly deadline: SimTime
  readonly tally: TallyView
}
/** One frozen electorate seat. */
export interface ElectorateMember {
  readonly proxy?: { readonly delegateId: SimulationEntityId; readonly delegationId: string } | undefined
  readonly personId: SimulationEntityId
  readonly name: BoundedText
  readonly ballot: Ballot
  readonly decision?: EngineRef | undefined
  /** Member left the committee after the electorate froze; the ballot still counts. */
  readonly leftCommittee: boolean
  readonly sources?: readonly EngineRef[] | undefined
}
/** Proposal inspector projection. */
export interface ProposalDetailView extends ProposalSummary {
  /** Current-prefix policy preview, never a publication or authority grant. */
  readonly normImpact?: Disclosure<import('@clocky/clocky-simulation').SimulationNormImpact> | undefined
  readonly normImpactInput?: Disclosure<import('@clocky/clocky-simulation').SimulationNormImpactInput> | undefined
  readonly normImpactChoices?: Disclosure<{ readonly committeeId: SimulationEntityId
    readonly positionIds: readonly SimulationEntityId[] }> | undefined

  /** Pre-ballot authority and frozen committee contracts, even before any resolution exists. */
  readonly routeDefinition?: { readonly id: string
    readonly hash: string
    readonly bodyHash: string
    readonly mode: 'and' | 'or' | 'ordered'
    readonly deadline: string
    readonly steps: readonly { readonly id: string
      readonly proposalId: string
      readonly committeeId: string
      readonly dependsOn: readonly string[]
      readonly deadline: string
      readonly quorum: number
      readonly rule: { readonly kind: 'unanimity' } | { readonly kind: 'absolute-threshold'; readonly yes: number }
      readonly electorate: readonly string[]
      readonly status: 'pending' | 'passed' | 'failed'
      readonly resolutionId: string | null
      readonly resolutionHash: string | null }[] } | undefined

  readonly reviewRoute?: { readonly id: string
    readonly revision: number
    readonly hash: string
    readonly mode: 'and' | 'or' | 'ordered'
    readonly steps: readonly { readonly id: string
      readonly proposalId: WorldProposalId
      readonly resolutionId: string | null
      readonly resolutionHash: string | null
      readonly dependsOn: readonly string[] }[] } | undefined

  readonly runId: SimulationProductRunId
  readonly version: string
  readonly bodyHash: string
  readonly body: Disclosure<BoundedText>
  readonly targetNorm?: { readonly id: WorldNormId; readonly version: string } | undefined
  readonly frozenAt: SimTime
  readonly electorateMembers: readonly ElectorateMember[]
  readonly sources: readonly EngineRef[]
  readonly resolution?: { readonly at: SimTime; readonly outcome: 'passed' | 'failed' } | undefined
  readonly enactment: { readonly state: 'not-applicable' | 'awaiting-request' | 'enacted'
    readonly normVersion?: { readonly id: WorldNormId; readonly version: string } | undefined
    readonly announcement?: 'pending' | 'published' | 'unknown' | undefined }
}
/** Enforcement mode of a norm version. */
export type Enforcement = { readonly mode: 'advisory' } | { readonly mode: 'validated'; readonly policyRef?: string | undefined }
/** Norm version row or detail. */
export interface NormVersionView {
  /** Actual or still-pending effect and notification responsibilities from their Native owners. */
  readonly audit?: readonly { readonly id: string
    readonly kind: 'resolution' | 'vote' | 'decision' | 'effective' | 'notification'
    readonly state: 'pending' | 'completed' | 'cancelled' | 'missing'
    readonly at?: string | undefined
    readonly source?: EngineRef | undefined }[] | undefined

  readonly id: string
  readonly normId: WorldNormId
  readonly title: BoundedText
  readonly version: string
  readonly enforcement: Enforcement
  readonly scope: BoundedText
  readonly recordedAt?: SimTime | undefined
  readonly effectiveFrom?: SimTime | undefined
  readonly knowableAt?: SimTime | undefined
  readonly until?: SimTime | undefined
  readonly body: Disclosure<BoundedText>
  readonly sourceProposalId?: WorldProposalId | undefined
  readonly sources: readonly EngineRef[]
}
/** Governance window. */
export interface GovernanceView {
  readonly runId: SimulationProductRunId
  readonly coverage: Coverage
  readonly now: SimTime
  readonly tickUnit: string
  readonly proposals: readonly ProposalSummary[]
  readonly norms: readonly NormVersionView[]
}

// ── External world ──

/** How an external party's responses are produced; all are simulated. */
export type SourceKind = 'rule' | 'director-ruling' | 'simulated-actor'
/** Any source kind including world-internal ones used by interaction records. */
export type AnySourceKind = SourceKind | 'authenticated-user' | 'world-decision'
/** External identity row. */
export interface ExternalIdentityRow {
  readonly key: WorldExternalIdentityId
  readonly name: BoundedText
  readonly kind: SourceKind
  readonly generation: number
  readonly latest?: { readonly at: SimTime; readonly summary: BoundedText } | undefined
}
/** One known fact; unknown is explicit, never zero. */
export interface KnownFact {
  readonly key: WorldFactId
  readonly value: { readonly state: 'known'; readonly text: BoundedText } | { readonly state: 'unknown' }
  readonly report: boolean
}
/** One recorded external interaction. */
export interface ExternalInteraction {
  readonly id: WorldIntentId
  readonly at: SimTime
  readonly requester: BoundedText
  readonly kind: AnySourceKind
  readonly basis: BoundedText
  readonly outcome: BoundedText
  readonly sampled: boolean
  readonly disclosure: Disclosure<BoundedText>
}
/** External identity inspector projection. */
export interface ExternalIdentityDetail extends ExternalIdentityRow {
  readonly runId: SimulationProductRunId
  readonly entity: EngineRef
  readonly revision: number
  readonly expansion: BoundedText
  readonly facts: readonly KnownFact[]
  readonly representative?: { readonly person: BoundedText
    readonly participantId?: ParticipantId | undefined
    readonly sessionId?: SessionId | undefined
    readonly ready: 'ready' | 'preparing' | 'blocked'
    readonly steps: readonly TrackStep[] } | undefined
  /** Selected bounded representation history; absent outside that section. */
  readonly representatives?: readonly { readonly entity: EngineRef
    readonly person: BoundedText
    readonly participantId: ParticipantId
    readonly sessionId: SessionId
    readonly ready: 'ready' | 'preparing' | 'blocked'
    readonly steps: readonly TrackStep[] }[] | undefined
  readonly interactions: readonly ExternalInteraction[]
  readonly sources: readonly EngineRef[]
}
/** External window. */
export interface ExternalView {
  readonly runId: SimulationProductRunId
  readonly coverage: Coverage
  readonly identities: readonly ExternalIdentityRow[]
}

// ── Extended cases ──

/** Missing-evidence requirement on a request. */
export interface EvidenceRequirement {
  readonly fields: readonly string[]
  readonly responders: readonly BoundedText[]
  readonly deadline: SimTime
  readonly remainingAttempts: number
  readonly revisions: readonly { readonly at: SimTime; readonly summary: BoundedText }[]
}
/** Structural mutation phase machine. */
export type MutationPhase = 'retained' | 'reserved' | 'quiescing' | 'transferring' | 'committed' | 'notifying' | 'done'
/** Extended case projection layered over existing case summaries. */
export interface WorldCaseExtension {
  readonly businessSummary: import('./case-types.ts').SimulationProductWorldBusinessSummary
  readonly requestId: WorldRequestId
  readonly domain: string
  readonly operation: string
  readonly businessKey: Disclosure<BoundedText>
  readonly target?: BoundedText | undefined
  readonly updatedAt?: SimTime | undefined
  readonly tracks: readonly Track[]
  readonly evidence?: EvidenceRequirement | undefined
  readonly sources: readonly EngineRef[]
  readonly mutation?: { readonly phase: MutationPhase
    readonly blocked?: string | undefined
    readonly cancelRequested: boolean } | undefined
}


/** Validated exact query; kind selects a read family and section selects its bounded child collection. */
export type SimulationProductWorldDomainInput = z.infer<typeof simulationProductWorldDomainInputSchema>
/** Strict same-prefix read response; selector echo is not an authority token. */
export type SimulationProductWorldDomainResult = z.infer<typeof simulationProductWorldDomainResultSchema>
