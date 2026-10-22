/** Synchronous pure domain capabilities; Native owns authorization, journal appends and core invariants. */
import type { SimulationEntityId } from './identities.ts'
import type { SimulationChange } from './entity-types.ts'
import type { SimulationSnapshot } from './types.ts'
import type { SimulationWorldIntent, SimulationWorldPlan, SimulationWorldBusinessResolution } from './world-types.ts'
import type { SimulationWorldResult } from './world-types.ts'
import type { ChannelId } from '@clocky/clocky-team/types'
import type {
  SimulationWorldDomainDefinition, SimulationWorldDomainImplementation, SimulationWorldDomainRequest,
  SimulationWorldDomainReadSet, SimulationWorldJsonValue,
} from './world-domain-types.ts'

/** Pure domain admission projection; Native independently verifies targets, scope and current grants. */
export interface DomainIntentAdmission {
  /** Scope belonging to the actor and exact installed operation. */
  readonly scopeEntityId: SimulationEntityId
  /** Existing operation target whose live identity and authority Native checks before accepting. */
  readonly targetEntityId: SimulationEntityId
  /** Bounded private request description; this cannot grant any authority. */
  readonly description: string
  /** Normalized input validated by the installed domain's strict request parser. */
  readonly payload: SimulationWorldJsonValue
}

/** Pure mutation proposal, which cannot publish a partial effect or bypass Native's closed transitions. */
export interface DomainMutationProjection {
  /** Closed original director adjudication; Native retains its basis and publishes only verified owner effects. */
  readonly externalAdjudicationEffects?: readonly import('./world-external-mediated-types.ts').SimulationExternalMediatedEffect[]
  /** Closed simulated evaluation; Native independently records actual input and derives the safe output. */
  readonly externalEffects?: readonly import('./world-external-types.ts').SimulationExternalEffect[]
  /** Closed institution transitions retain their approved governance source. */
  readonly normEffects?: readonly import('./world-norms-types.ts').SimulationNormEffect[]
  /** Closed core commands; Native verifies domain permission, identities, read-set and invariants before append. */
  readonly changes: readonly SimulationChange[]
  /** Safe domain result parsed by its registered result schema; private rationale is excluded. */
  readonly resultPayload: SimulationWorldJsonValue
}

/**
 * Installed Native domain logic. All methods are synchronous and perform no IO, inference or appends.
 * Native pins this definition and implementation, derives the caller, checks authoritative grants,
 * compares retained reads and validates core changes before an atomic journal commit.
 */
export interface NativeWorldDomain extends SimulationWorldDomainImplementation {
  /** Exact retained model-context presenters, usable only for an explicitly verified migrated historical prefix. */
  readonly contextProfiles?: Readonly<Record<string, Pick<NativeWorldDomain, 'goalContext' | 'planningContext'>>>

  /** Stop-checkpoint coverage; absence cannot prove a complete backup of this domain's state. */
  readonly checkpointCoverage?: 'native' | 'external-state-required'

  /** Pure exact-version clock interpretation; absence refuses domain stop-target installation. */
  readonly stopClock?: {
    /** Stable name selected explicitly in the persisted stop target. */
    readonly name: string
    /** Proven conservative Native bound for this domain boundary; absence refuses target installation. Mapping stays fixed for this pin. */
    nativeBoundary?(state: SimulationSnapshot, boundary: import('./time-types.ts').SimTime): import('./time-types.ts').SimTime | undefined
    /** Current confirmed integer time and its original Native evidence revision, or unavailable. */
    observe(state: SimulationSnapshot): { readonly value: import('./time-types.ts').SimTime; readonly revision: number } | undefined
    /** Maximum clock value touched by this original request; undefined means protection cannot be proved. */
    effect(state: SimulationSnapshot, request: SimulationWorldDomainRequest): import('./time-types.ts').SimTime | undefined
  }

  /**
   * Identify additional people explicitly owned by this original request; the requester is always tracked by Native.
   * @param intent - Immutable original request validated by this exact installed parser and implementation.
   * @returns exact additional person identities, or an explicitly justified empty list; this neither grants rights nor creates duties.
   */
  personnelSubjects(intent: SimulationWorldIntent): readonly SimulationEntityId[]

  /** Fixed closed Native responsibility derived atomically from the original accepted request, never from model fields. */
  readonly acceptedResponsibility?: 'governance-route' | 'governance-delegation' | 'governance-proposal' | 'governance-vote' | 'personnel-departure' | 'external-identity' | 'external-actor-identity' | 'external-mediated-identity'
  /** Canonical result speaker chosen by this pinned domain; omission keeps the original requester, never a model-selected sender. */
  readonly resultNotificationRole?: 'requester' | 'director'
  /**
   * Select safe domain material for an actual role's ordinary goal, without inventing an accepted request.
   * @param state - Authoritative Native prefix recorded by the prepared view's source references.
   * @param actorId - Actual decision actor whose live operation grants Native has independently verified.
   * @returns strict JSON material; Native records it in the consumed view rather than exposing a hidden callback.
   */
  goalContext?(state: SimulationSnapshot, actorId: SimulationEntityId): SimulationWorldJsonValue
  /**
   * Project an original domain-specific result or first action through its retained canonical Channel.
   * @param state - Current authoritative Native projection.
   * @param intent - Original pinned business identity.
   * @param result - Exact recorded domain result.
   * @param purpose - Native-selected communication purpose.
   * @returns exact authorized actor/recipient/Channel and private facts, or undefined for common requester notification.
   */
  resultContext?(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult,
    purpose: 'result' | 'first-action'): {
      readonly expectedActorId: SimulationEntityId
      readonly recipient: SimulationEntityId
      readonly channelId: ChannelId
      readonly facts: SimulationWorldJsonValue
    } | undefined
  /**
   * Select a domain-owned first-action consequence without arbitrary scheduler effects.
   * @param state - Authoritative state after the atomic business result.
   * @param intent - Original pinned intent.
   * @param result - Exact committed or denied result.
   * @returns the canonical first-action actor, or undefined when no such consequence exists.
   */
  firstActionActor?(state: SimulationSnapshot, intent: SimulationWorldIntent, result: SimulationWorldResult): SimulationEntityId | undefined
  /** Exact registered strict request, apply, result and mutation payload parsers. */
  readonly definition: SimulationWorldDomainDefinition
  /**
   * Validate and normalize a proposed domain input against live business constraints.
   * @param state - Authoritative Native projection at admission.
   * @param actorId - Actual authenticated decision actor derived by Native.
   * @param request - Strict proposed envelope; it cannot select its actor or run.
   * @param original - Exact Native-retained intent only when revalidating original execution; fresh admission omits it.
   * @returns targets, scope and immutable business payload for independent Native verification.
   */
  admitRequest(state: SimulationSnapshot, actorId: SimulationEntityId, request: SimulationWorldDomainRequest,
    original?: SimulationWorldIntent): DomainIntentAdmission
  /**
   * Project the domain's planning facts without adding authority or hidden sources.
   * @param state - Authoritative Native projection for the selected planning view.
   * @param intent - Original pinned domain business identity.
   * @param actorId - Actual authenticated reader of this context; projection must obey this reader's existing disclosure authority.
   * @returns JSON planning material; Native records the consumed context and verifies access.
   */
  /**
   * Explicit pure user-management admission; absent domains cannot be initiated by authenticated management.
   * @param state - Actual Native prefix at preview, acceptance or original execution.
   * @param request - Strict installed-domain envelope derived from the user action and Native business key.
   * @param source - Actual authenticated-user provenance, independent of simulated role grants.
   * @param original - Retained exact intent during execution revalidation; omitted at fresh admission.
   * @returns normalized business scope/target/payload after structural checks; this neither grants rights nor performs effects.
   */
  admitManagementRequest?(state: SimulationSnapshot, request: SimulationWorldDomainRequest,
    source: import('./world-management-types.ts').SimulationWorldAuthenticatedUserSource,
    original?: SimulationWorldIntent): DomainIntentAdmission
  planningContext(state: SimulationSnapshot, intent: SimulationWorldIntent, actorId: SimulationEntityId): SimulationWorldJsonValue
  /**
   * Validate business constraints of the common apply/reject disposition.
   * @param state - Authoritative Native projection before accepting or executing a plan.
   * @param intent - Original pinned business intent, never a new model-selected requester.
   * @param resolution - Common disposition; the installed schema verifies an apply payload.
   * @returns nothing when business constraints hold; invalid plans throw before effects.
   */
  validatePlan(state: SimulationSnapshot, intent: SimulationWorldIntent, resolution: SimulationWorldBusinessResolution): void
  /**
   * Derive exact owner-comparable dependencies for planning and execution.
   * @param state - Authoritative Native projection at the comparison point.
   * @param intent - Original pinned business intent whose target and scope constrain reads.
   * @returns typed reads; Native checks equality with accepted reads before committing effects.
   */
  executionReads(state: SimulationSnapshot, intent: SimulationWorldIntent): SimulationWorldDomainReadSet
  /**
   * Reduce a strictly parsed mutation into closed core changes and a safe result proposal.
   * @param state - Authoritative Native projection before the mutation commit.
   * @param intent - Original pinned business identity.
   * @param plan - Exact immutable accepted plan; this method cannot replace its generation or payload.
   * @param payload - Original mutation input validated by the installed mutation schema.
   * @returns pure core change and result proposals; Native independently validates and appends atomically.
   */
  reduceMutation(state: SimulationSnapshot, intent: SimulationWorldIntent, plan: SimulationWorldPlan,
    payload: SimulationWorldJsonValue): DomainMutationProjection
}
