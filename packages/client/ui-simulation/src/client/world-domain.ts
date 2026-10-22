/**
 * World domain read composition and the management-preview models rendered by the modules.
 *
 * Product owns the shared read DTOs and Client runtime owns their read lifetimes.
 * Management previews and templates retain explicit unavailable states until their owners publish them.
 * The UI never derives business state from names or chat text.
 */
import type { SimulationProductRunId } from '@clocky/clocky-client-runtime/client'

/** Exact decimal simulated time; never converted through Number. */
export type SimTime = string

/** One bounded, revision-pinned read window. `unpublished` means the Host offers no such read yet. */
export type WorldWindow<T> = (
  | { readonly status: 'unpublished' }
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly previous?: T | undefined }
  | { readonly status: 'ready'; readonly value: T; readonly stale: boolean }
  | { readonly status: 'error'; readonly message: string; readonly previous?: T | undefined }
) & { readonly coverage?: Coverage | undefined }

/** World read DTOs are owned by Product and shared with both SDKs. */
export type {
  Coverage, Disclosure, BoundedText, EngineRef, ActionHint, WorldActionKind, TrackNodeState, TrackKind, TrackStep, Track,
  WorldAttention, ScheduledEvent, CaseFlowCount, WorldOverviewView, OrganizationLens, OrgNode, OrgEdge, Tenure, EmploymentState,
  Residency, PersonRow, OrganizationView, ObligationKind, ObligationDisposition, Obligation, PersonDetailView, ProposalStatus,
  Ballot, TallyView, ProposalSummary, ElectorateMember, ProposalDetailView, Enforcement, NormVersionView, GovernanceView,
  SourceKind, AnySourceKind, ExternalIdentityRow, KnownFact, ExternalInteraction, ExternalIdentityDetail, ExternalView,
  EvidenceRequirement, MutationPhase, WorldCaseExtension,
} from '@clocky/clocky-simulation-product/world-read-types'
import type {
  Coverage, BoundedText, WorldActionKind, WorldOverviewView, OrganizationLens, OrganizationView,
  Obligation, PersonDetailView, ProposalDetailView, NormVersionView, GovernanceView, ExternalIdentityDetail,
  ExternalView, WorldCaseExtension,
} from '@clocky/clocky-simulation-product/world-read-types'

// ── Management action preview ──

/** Authorized finite template options for the original Persona editor. */
export type PersonaField = Extract<import('@clocky/clocky-simulation-product/world-management-types')
.SimulationProductWorldManagementFields['fields'][number], { kind: 'persona' }>

/** One Host-declared input field of a management action. */
export type ActionField =
  | PersonaField
  | { readonly id: string; readonly kind: 'choice'; readonly options: readonly { readonly id: string; readonly label: string }[]; readonly required: boolean }
  | { readonly id: string; readonly kind: 'time'; readonly required: boolean }
  | { readonly id: string; readonly kind: 'text'; readonly required: boolean; readonly maxBytes: number }
/** A management action request awaiting preview. */
export interface WorldActionRequest {
  readonly runId: SimulationProductRunId
  readonly action: WorldActionKind
  readonly targetId: string
  readonly expectedRevision: number
  readonly values: Readonly<Record<string, string>>
}
/** Inert impact preview; blocking reasons disable submission. */
export interface ActionPreview {
  /** Complete validated original quote from the runtime owner; submit retains this exact input and Native prefix. */
  readonly original?: import('@clocky/clocky-simulation-product/world-management-types').SimulationProductWorldManagementPreview | undefined
  readonly previewHash: string
  readonly revision: number
  readonly impacts: readonly BoundedText[]
  readonly obligations: readonly Obligation[]
  readonly blockers: readonly { readonly reason: string
    readonly next?: { readonly label: string; readonly obligations: true } | undefined }[]
  readonly allowance?: readonly { readonly key: string; readonly before: string; readonly after: string }[] | undefined
}

// ── Authoring templates ──

/** Installed World template published by the Host catalog. */
export interface WorldTemplateView {
  readonly id: string
  readonly name: string
  readonly domains: readonly string[]
  readonly people: number
  readonly committees: number
  /** Portable definition the workbench opens as a new draft. */
  readonly definition: unknown
}

// ── Reserved seam ──

/** Snapshot of every World domain window the modules read. */
/** Authorized immutable market transition window from the existing product reader. */
export type HiringMarketView = NonNullable<Extract<import('@clocky/clocky-simulation-product/world-read-types').SimulationProductWorldDomainResult,
  { kind: 'hiring-market' }>['value']>
/** Explicit retained market record family. */
export type HiringMarketFamily = 'persona-draft' | 'vacancy' | 'application' | 'offer-revision'
/** Independent private World read windows owned by Client runtime. */
export interface WorldDomainState {
  readonly hiringMarket: WorldWindow<HiringMarketView>
  readonly templates: WorldWindow<readonly WorldTemplateView[]>
  readonly overview: WorldWindow<WorldOverviewView>
  readonly organization: WorldWindow<OrganizationView>
  readonly person: WorldWindow<PersonDetailView>
  readonly governance: WorldWindow<GovernanceView>
  readonly proposal: WorldWindow<ProposalDetailView>
  readonly norm: WorldWindow<NormVersionView>
  readonly external: WorldWindow<ExternalView>
  readonly identity: WorldWindow<ExternalIdentityDetail>
  readonly caseExtensions: WorldWindow<readonly WorldCaseExtension[]>
  readonly actionFields: WorldWindow<readonly ActionField[]>
  readonly actionPreview: WorldWindow<ActionPreview>
}
/** Bounded read and inert preview operations; each replaces its own window. */
export interface WorldDomainReads {
  hiringMarket: (input: { runId: SimulationProductRunId; family: HiringMarketFamily; cursor?: string | undefined }) => Promise<void>
  closeDetails: () => void
  templates: () => Promise<void>
  overview: (input: { runId: SimulationProductRunId; cursor?: string | undefined }) => Promise<void>
  organization: (input: { runId: SimulationProductRunId
    lens: OrganizationLens
    at?: SimTime | undefined
    cursor?: string | undefined }) => Promise<void>
  person: (input: { runId: SimulationProductRunId
    personId: string
    at?: SimTime | undefined
    section?: 'identity' | 'tenures' | 'obligations' | undefined
    cursor?: string | undefined }) => Promise<void>
  governance: (input: { runId: SimulationProductRunId
    lens?: 'proposals' | 'norms' | 'history' | undefined
    at?: SimTime | undefined
    cursor?: string | undefined }) => Promise<void>
  proposal: (input: { runId: SimulationProductRunId
    proposalId: string
    at?: SimTime | undefined
    section?: 'record' | 'electorate' | 'votes' | 'impact' | undefined
    normImpact?: import('@clocky/clocky-simulation').SimulationNormImpactInput | undefined
    cursor?: string | undefined }) => Promise<void>
  norm: (input: { runId: SimulationProductRunId
    versionId: string
    at?: SimTime | undefined
    cursor?: string | undefined }) => Promise<void>
  external: (input: { runId: SimulationProductRunId; cursor?: string | undefined }) => Promise<void>
  identity: (input: { runId: SimulationProductRunId
    key: string
    at?: SimTime | undefined
    section?: 'record' | 'facts' | 'interactions' | 'representatives' | undefined
    cursor?: string | undefined }) => Promise<void>
  caseExtensions: (input: { runId: SimulationProductRunId; requestIds: readonly string[] }) => Promise<void>
  actionFields: (input: { runId: SimulationProductRunId; action: WorldActionKind; targetId: string }) => Promise<void>
  previewAction: (input: WorldActionRequest) => Promise<void>
  closeActionPreview: () => void
}
/** Observable face matching the renderer's bare-observable contract. */
export interface WorldDomainObservable {
  getSnapshot: () => WorldDomainState
  subscribe: (listener: () => void) => () => void
}
/** One complete source: observable state plus read operations. */
export interface WorldDomainSource { readonly state: WorldDomainObservable; readonly reads: WorldDomainReads }

const UNPUBLISHED = { status: 'unpublished' } as const
/** Every window unpublished: the default until the Client runtime projects World domain reads. */
export const UNPUBLISHED_WORLD_DOMAIN: WorldDomainState = {
  hiringMarket: UNPUBLISHED, templates: UNPUBLISHED, overview: UNPUBLISHED, organization: UNPUBLISHED,
  person: UNPUBLISHED, governance: UNPUBLISHED,
  proposal: UNPUBLISHED,
  norm: UNPUBLISHED, external: UNPUBLISHED, identity: UNPUBLISHED, caseExtensions: UNPUBLISHED, actionFields: UNPUBLISHED,
  actionPreview: UNPUBLISHED,
}

/**
 * Build the reserved source used while the Host publishes no World domain reads.
 * @returns a constant observable whose reads resolve without contacting the Host.
 */
export function createUnpublishedWorldDomain(): WorldDomainSource {
  const idle = async () => {}
  return {
    state: { getSnapshot: () => UNPUBLISHED_WORLD_DOMAIN, subscribe: () => () => {} },
    reads: { hiringMarket: idle, closeDetails: () => {}, templates: idle, overview: idle, organization: idle,
      person: idle, governance: idle,
      proposal: idle, norm: idle,
      external: idle, identity: idle, caseExtensions: idle, actionFields: idle, previewAction: idle, closeActionPreview: () => {} },
  }
}

/**
 * Last value a window can show, with whether it is current.
 * @param window - Any World window.
 * @returns the displayable value and stale flag, or undefined when nothing was ever observed.
 */
export function windowValue<T>(window: WorldWindow<T>): { value: T; stale: boolean } | undefined {
  switch (window.status) {
    case 'ready': return { value: window.value, stale: window.stale }
    case 'loading': return window.previous === undefined ? undefined : { value: window.previous, stale: false }
    case 'error': return window.previous === undefined ? undefined : { value: window.previous, stale: true }
    case 'idle':
    case 'unpublished': return undefined
    default: return assertNever(window)
  }
}

/**
 * Compare exact decimal simulated times without Number conversion.
 * @param a - Non-negative decimal string.
 * @param b - Non-negative decimal string.
 * @returns negative, zero or positive like a comparator.
 */
export function compareTime(a: SimTime, b: SimTime): number {
  const x = BigInt(a), y = BigInt(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** Accept only canonical non-negative decimal simulated time strings. */
export const SIM_TIME = /^(0|[1-9][0-9]*)$/

function assertNever(value: never): never { throw new Error(`Unknown World window: ${JSON.stringify(value)}`) }
