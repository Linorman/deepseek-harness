"""Strict portable World definitions and product previews; installed execution configuration stays Host-owned."""
from __future__ import annotations

from typing import Annotated, Literal, get_args
from pydantic import ConfigDict, Field, RootModel, model_validator, model_serializer, Discriminator, Tag
from .simulation_calendar_base import WorldCalendarRecurrence, WorldCivilCalendar
from .simulation import SimulationModel, Identity, ObservationCount, Decimal, PositiveDecimal, SimulationPrepareInput, SimulationControlInput

Key = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9._-]{0,127}$")]
Positive = Annotated[int, Field(gt=0, le=9_007_199_254_740_991)]
Hash = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
NativeKey = Literal["maxQueuedDecisions", "maxDispatchWaitRounds", "maxTokensPerInterval", "tokensPerModelRequest",
    "maxDecisionsPerInterval", "maxMessagesPerInterval", "maxPendingEvents", "maxPendingInteractions", "maxKnowledgeBytes",
    "maxKnowledgePerQuery", "maxEntities", "maxResidentActors", "maxIngressBytes", "maxConflictRetries", "decisionTimeoutMs",
    "maxDecisionsPerWindow", "outboxMaxAttempts", "outboxRetryDelayMs", "maxDriveSteps", "maxMicrostepsPerTime", "maxOperationsPerDecision",
    "maxResourceReservationHistory"]
TeamKey = Literal["maxParticipants", "maxActivations", "maxTasks", "maxChannels", "maxEnvelopeBytes", "maxChannelViewBytes",
    "maxPendingDeliveriesPerChannel", "maxPendingDeliveriesPerParticipant", "maxPendingDeliveryPageSize", "maxPostIdempotencyEntriesPerChannel",
    "maxTaskAttemptsPerTask", "maxTaskLeaseDurationMs", "maxTurnsPerTeam", "maxModelTokensPerTeam", "maxWallTimeMsPerTeam",
    "maxCostUnitsPerTeam", "maxRetriesPerTeam", "maxInboxItemsPerParticipant", "maxRatePerParticipantPerMinute"]
WorldKey = Literal["maxRequests", "maxRequestsPerActorPerInterval", "maxBirthsPerInterval", "maxExternalExpansionsPerInterval", "maxPendingMutations", "maxEvidenceAttemptsPerRequest", "maxPlansPerRequest", "maxBytesPerRequest", "maxBytesPerPlan"]
_ZERO_NATIVE = {"maxTokensPerInterval", "maxDecisionsPerInterval", "maxMessagesPerInterval", "maxPendingEvents",
                "maxPendingInteractions", "maxConflictRetries", "outboxRetryDelayMs"}

class WorldModel(SimulationModel):
    """Closed optional fields may be omitted; explicit null is never portable scenario input."""

    @model_validator(mode="before")
    @classmethod
    def _no_null(cls, value):
        if isinstance(value, dict) and any(item is None for item in value.values()):
            raise ValueError("World optional fields must be omitted rather than null")
        return value

class WorldReference(WorldModel):
    """Symbolic installed version reference, never a provider path."""
    id: Key
    version: Identity

class WorldNamedIdentity(WorldModel):
    """Portable named organization or metadata identity."""
    id: Key
    name: Identity
    description: Identity

class WorldPosition(WorldModel):
    """Portable position and positive capacity."""
    id: Key
    name: Identity
    capacity: Positive

class WorldPersona(WorldModel):
    """Partial initial persona; installed templates resolve omitted fields."""
    name: Identity | None = None
    skills: list[Identity] | None = None
    traits: list[Identity] | None = None
    goals: list[Identity] | None = None

    @model_validator(mode="after")
    def _distinct(self):
        if any(values is not None and len(values) != len(set(values)) for values in [self.skills, self.traits, self.goals]):
            raise ValueError("Persona choices must be distinct")
        return self

class WorldActor(WorldModel):
    """Initial actor with a symbolic installed template and runtime."""
    id: Key
    role: Literal["director", "member"]
    template: WorldReference
    runtimeProfile: WorldReference | None = None
    persona: WorldPersona | None = None

class WorldAssignment(WorldModel):
    """Initial assignment between portable identities."""
    id: Key
    personId: Key
    positionId: Key

class WorldAuthorization(WorldModel):
    """Initial requester authorization resolved by the trusted product owner."""
    id: Key
    requesterId: Key
    positionId: Key

class WorldInitialEvent(WorldModel):
    """Bounded initial hire request with exact simulated delivery time."""
    kind: Literal["hire-request"]
    applicationId: Key
    requesterId: Key
    positionId: Key
    at: Decimal
    description: Identity

class WorldLimitsInput(WorldModel):
    """Optional quota requests with only declared keys and valid numeric bounds."""
    native: dict[NativeKey, ObservationCount] | None = None
    team: dict[TeamKey, Positive] | None = None
    world: dict[WorldKey, ObservationCount] | None = None

    @model_validator(mode="after")
    def _positive_native(self):
        if any(value == 0 and key not in _ZERO_NATIVE for key, value in (self.native or {}).items()):
            raise ValueError("Native quota must be positive")
        for key, value in (self.world or {}).items():
            if key == "maxPendingMutations" and value != 1:
                raise ValueError("Structural mutation concurrency is frozen at one")
            if key not in {"maxBirthsPerInterval", "maxExternalExpansionsPerInterval", "maxEvidenceAttemptsPerRequest"} and value == 0:
                raise ValueError("World quota must be positive")
        return self

class WorldLimits(WorldLimitsInput):
    """Complete resolved quota groups; missing or unknown owner bounds reject."""
    native: dict[NativeKey, ObservationCount]
    team: dict[TeamKey, Positive]
    world: dict[WorldKey, ObservationCount]

    @model_validator(mode="after")
    def _complete(self):
        if any(set(values) != set(get_args(keys)) for values, keys in
               [(self.native, NativeKey), (self.team, TeamKey), (self.world, WorldKey)]):
            raise ValueError("Resolved World quotas must be complete")
        return self

class WorldScenario(WorldModel):
    """Portable creation definition without credentials, host paths or private execution state."""
    apiVersion: Literal["clocky.world/v0"]
    metadata: WorldNamedIdentity
    organization: WorldNamedIdentity
    positions: Annotated[list[WorldPosition], Field(min_length=1)]
    runtimeProfile: WorldReference
    templates: Annotated[list[WorldReference], Field(min_length=1)]
    actors: Annotated[list[WorldActor], Field(min_length=2)]
    assignments: list[WorldAssignment]
    authorizations: list[WorldAuthorization]
    initialEvents: list[WorldInitialEvent]
    limits: WorldLimitsInput | None = None

class WorldV1Model(SimulationModel):
    """Closed v1 fields preserve required null interval ends even in optional-field wire dumps."""

    @model_validator(mode="before")
    @classmethod
    def _optional_null(cls, value):
        if isinstance(value, dict) and any(name in value and value[name] is None and not field.is_required()
                                         for name, field in cls.model_fields.items()):
            raise ValueError("Optional v1 fields must be omitted rather than null")
        return value

    @model_serializer(mode="wrap")
    def _required_nulls(self, handler):
        value = handler(self)
        for name, field in type(self).model_fields.items():
            if field.is_required() and getattr(self, name) is None:
                value[name] = None
        return value

class WorldV1Persona(WorldPersona):
    """Complete finite initial Persona choices; no field is an implicit template default."""
    name: Identity
    skills: list[Identity]
    traits: list[Identity]
    goals: list[Identity]

class WorldV1Person(WorldNamedIdentity):
    """Cognitive symbolic person with its declared runtime and finite template."""
    kind: Literal["person"]
    cognition: Literal["agent"]
    role: Literal["director", "member"]
    runtimeProfile: WorldReference
    template: WorldReference
    persona: WorldV1Persona

class WorldV1OrganizationEntity(WorldNamedIdentity):
    """Noncognitive original organization or external subject."""
    kind: Literal["organization"]
    cognition: Literal["none"]

class WorldV1Object(WorldNamedIdentity):
    """Non-cognitive display object; its name confers no authority or Persona."""

    kind: Literal["object"]
    cognition: Literal["none"]


class WorldV1EnvironmentState(WorldV1Model):
    """Initial simulated supply state; prior samples cannot be authored as history."""

    model: Literal["supply-fixed/1", "supply-seasonal/1"]
    generation: Literal[1]
    inventory: Annotated[int, Field(ge=0, le=1_000_000)]
    committed: Annotated[int, Field(ge=0, le=1_000_000)]
    capacity: Annotated[int, Field(ge=0, le=1_000_000)]
    sourceLimit: Annotated[int, Field(ge=0, le=1_000_000)]
    sinkLimit: Annotated[int, Field(ge=0, le=1_000_000)]
    step: Annotated[int, Field(ge=1, le=1000)]
    lastTime: None

    @model_validator(mode="after")
    def _stock(self):
        if not self.committed <= self.inventory <= self.capacity:
            raise ValueError("Stock must cover commitments within capacity")
        return self

class WorldV1Environment(WorldNamedIdentity):
    """Non-cognitive initial environment selected for this explicit experiment."""

    kind: Literal["environment"]
    cognition: Literal["none"]
    environment: WorldV1EnvironmentState

class WorldV1EvolutionState(WorldV1Model):
    """Empty subjective history with explicit subject and allowed readers."""

    personId: Identity
    audience: Annotated[list[Identity], Field(min_length=1, max_length=16)]
    period: Annotated[int, Field(ge=1, le=1000)]
    versions: Annotated[list[dict], Field(max_length=0)]

class WorldV1PersonState(WorldNamedIdentity):
    """Separate subjective state; it grants no person or tool authority."""

    kind: Literal["person-state"]
    cognition: Literal["none"]
    evolution: WorldV1EvolutionState


class WorldV1InactivePerson(WorldNamedIdentity):
    """A noncognitive person is never silently converted into an Agent."""
    kind: Literal["person"]
    cognition: Literal["none"]

class WorldV1Selector(WorldV1Model):
    """Declared installed operation version without execution code or route overrides."""
    domain: Identity
    operation: Identity
    version: Identity

class WorldV1Permission(WorldV1Selector):
    """Symbolic scoped operation permission; structural relations cannot grant authority."""
    scopeId: Key
    targetId: Key
    relation: Key

class WorldV1Interval(WorldV1Model):
    """Canonical half-open interval; null explicitly means no end."""
    validFrom: Decimal
    validUntil: Decimal | None

    @model_validator(mode="after")
    def _interval(self):
        if self.validUntil is not None and int(self.validUntil) <= int(self.validFrom):
            raise ValueError("Intervals must be nonempty and half-open")
        return self

class WorldV1Assignment(WorldV1Interval):
    """Original authored assignment; Native freezes actual later calendar recipients."""
    id: Key
    personId: Key
    positionId: Key

class WorldV1Grant(WorldV1Permission, WorldV1Interval):
    """Explicit person permission with its retained temporal interval."""
    id: Key
    personId: Key

class WorldV1Unit(WorldModel):
    """Managed organization parent reference; the compiler detects hierarchy cycles."""
    id: Key
    parentId: Key

class WorldV1Position(WorldPosition):
    """Declared position capacity, organization unit and installed role permissions."""
    description: Identity
    unitId: Key
    permissions: list[WorldV1Permission]

class WorldV1HiringFee(WorldModel):
    """Explicit immutable one-time fee terms; the Host resolves real accounts and authorization."""
    model_config = ConfigDict(serialize_by_alias=True)
    id: Annotated[str, Field(min_length=1, max_length=256)]
    version: Identity
    policyRef: Literal["clocky.organization.hiring-fee/1"]
    operation: Literal["generate-and-hire", "hire-existing"]
    positionEntityId: Identity
    from_: Identity = Field(alias="from")
    to: Identity
    unit: Identity
    quantity: PositiveDecimal
    grants: list[Identity]
    reservationPeriod: PositiveDecimal

    @model_validator(mode="after")
    def _distinct(self):
        if self.from_ == self.to:
            raise ValueError("Hiring payment requires distinct existing debit and credit accounts")
        if len(self.grants) != len(set(self.grants)):
            raise ValueError("Fee grants must be distinct")
        return self

class WorldV1Organization(WorldModel):
    """Complete primary organization topology, assignments and permission declarations."""
    rootId: Key
    units: list[WorldV1Unit]
    positions: list[WorldV1Position]
    assignments: list[WorldV1Assignment]
    grants: list[WorldV1Grant]
    hiringFees: list[WorldV1HiringFee] | None = None

class WorldV1Unanimity(WorldModel):
    """All frozen committee members must vote yes."""
    kind: Literal["unanimity"]

class WorldV1Threshold(WorldModel):
    """Fixed positive yes threshold, independent from participation quorum."""
    kind: Literal["absolute-threshold"]
    yes: Positive

WorldV1Rule = Annotated[WorldV1Unanimity | WorldV1Threshold, Field(discriminator="kind")]

class WorldV1Membership(WorldV1Interval):
    """Original committee membership; actual proposals freeze their own electorate."""
    id: Key
    personId: Key

class WorldV1Committee(WorldNamedIdentity):
    """Named scoped committee with declared memberships, rule and positive quorum."""
    scopeId: Key
    members: list[WorldV1Membership]
    rule: WorldV1Rule
    quorum: Positive

class WorldV1PublicAudience(WorldModel):
    """Public authored background."""
    kind: Literal["public"]

class WorldV1ScopeAudience(WorldModel):
    """Authorized members of the original scope."""
    kind: Literal["scope-members"]

class WorldV1ActorAudience(WorldModel):
    """Explicit unique symbolic readers; the compiler checks references."""
    kind: Literal["actors"]
    entityIds: Annotated[list[Identity], Field(min_length=1)]

    @model_validator(mode="after")
    def _distinct(self):
        if len(self.entityIds) != len(set(self.entityIds)):
            raise ValueError("Audience readers must be distinct")
        return self

WorldV1Audience = Annotated[WorldV1PublicAudience | WorldV1ScopeAudience | WorldV1ActorAudience, Field(discriminator="kind")]

class WorldV1Advisory(WorldModel):
    """Authored advisory text grants no execution permission."""
    kind: Literal["advisory"]

class WorldV1HiringParameters(WorldModel):
    """Complete installed committee approval primitive parameters."""
    committeeId: Identity
    positionIds: Annotated[list[Identity], Field(min_length=1)]
    maxHires: Positive

    @model_validator(mode="after")
    def _distinct(self):
        if len(self.positionIds) != len(set(self.positionIds)):
            raise ValueError("Hiring positions must be distinct")
        return self

class WorldV1Validated(WorldModel):
    """Closed installed policy mapping; arbitrary code or natural language policies reject."""
    kind: Literal["validated"]
    policyRef: Literal["clocky.organization.hiring-approval/1"]
    params: WorldV1HiringParameters

WorldV1Enforcement = Annotated[WorldV1Advisory | WorldV1Validated, Field(discriminator="kind")]

class WorldV1InstitutionMetadata(WorldV1Model):
    """Known/effective authored institution metadata, independent of recording wall clock."""
    id: Key
    scopeId: Key
    effectiveFrom: Decimal
    effectiveUntil: Decimal | None
    availableAt: Decimal
    audience: WorldV1Audience
    enforcement: WorldV1Enforcement

    @model_validator(mode="after")
    def _interval(self):
        if self.effectiveUntil is not None and int(self.effectiveUntil) <= int(self.effectiveFrom):
            raise ValueError("Institution intervals must be nonempty and half-open")
        return self

class WorldV1Norm(WorldV1InstitutionMetadata):
    """Original scenario-authored document; Native derives provenance without fabricating votes."""
    body: Identity

class WorldV1Fact(WorldV1Model):
    """Separate authoritative authored background with explicit audience and dates."""
    id: Key
    subjectId: Key
    scopeId: Key
    body: Identity
    effectiveFrom: Decimal
    effectiveUntil: Decimal | None
    availableAt: Decimal
    audience: WorldV1Audience

    @model_validator(mode="after")
    def _interval(self):
        if self.effectiveUntil is not None and int(self.effectiveUntil) <= int(self.effectiveFrom):
            raise ValueError("Fact intervals must be nonempty and half-open")
        return self

class WorldV1Knowledge(WorldV1Interval):
    """Private attributed authored belief, never automatically promoted to a WorldFact."""
    id: Key
    ownerId: Key
    body: Identity
    observedAt: Decimal
    availableAt: Decimal
    readers: list[Key]

class WorldV1Resource(WorldModel):
    """Initial owned resource balance; external identity expansion never creates stock."""
    id: Identity
    owner: Identity
    kind: Literal["money", "inventory"]
    unit: Identity
    quantity: Decimal
    controllers: list[Identity]

class WorldV1ChannelMember(WorldModel):
    """Original declared cognitive channel endpoint."""
    personId: Key
    role: Literal["director", "member"]

class WorldV1Channel(WorldModel):
    """Authored channel membership, separate from later canonical Channel identity."""
    key: Key
    members: Annotated[list[WorldV1ChannelMember], Field(min_length=2)]

class WorldV1ExternalIdentity(WorldModel):
    """Scoped simulated external key and declared noncognitive subject."""
    scopeId: Key
    externalKey: Key
    subjectId: Key
    representation: Literal["simulated-rule", "simulated-actor", "director-mediated"]

class WorldV1AdjudicationPolicy(WorldModel):
    """Complete fixed simulated adjudication policy; no network or arbitrary executor fields exist."""
    ref: Literal["clocky.external.adjudication/1"]
    version: Literal["1"]
    generation: Positive
    conditionInstalls: list[Literal["weather", "lead-time", "meeting-status"]]
    futureConditionInstalls: list[Literal["weather", "lead-time", "meeting-status"]]
    allowedOutcomeKinds: Annotated[list[Literal["environmental-fact", "delayed-event", "failure",
        "representative-preparation-plan", "unverified-report"]], Field(min_length=1)]
    maxDelay: Decimal
    allowPublicDisclosure: bool
    allowScopeDisclosure: bool
    actorDisclosure: list[Identity]

    @model_validator(mode="after")
    def _policy(self):
        if any(len(values) != len(set(values)) for values in [self.conditionInstalls, self.futureConditionInstalls,
                                                             self.allowedOutcomeKinds, self.actorDisclosure]):
            raise ValueError("Policy choices and readers must be distinct")
        if not set(self.futureConditionInstalls) <= set(self.conditionInstalls):
            raise ValueError("Future conditions must be installed")
        return self

class WorldV1PersonTarget(WorldModel):
    """A symbolic cognitive person goal target."""
    kind: Literal["person"]
    personId: Key

class WorldV1PositionTarget(WorldModel):
    """A position goal resolves its actual recipients only at trigger time."""
    kind: Literal["position"]
    positionId: Key

WorldV1Target = Annotated[WorldV1PersonTarget | WorldV1PositionTarget, Field(discriminator="kind")]

class WorldV1Goal(WorldModel):
    """Ordinary finite authored objective, never a prebuilt world request."""
    id: Key
    kind: Literal["goal"]
    at: Decimal
    target: WorldV1Target
    body: Identity

class WorldV1Calendar(WorldV1Model):
    """Finite periodic declaration; future occurrences are not eagerly expanded."""
    id: Key
    target: WorldV1Target
    body: Identity
    startsAt: Decimal
    endsAt: Decimal | None
    period: PositiveDecimal
    maxOccurrences: Positive
    recurrence: WorldCalendarRecurrence | None = None
    civil: WorldCivilCalendar | None = None
    priority: Annotated[int, Field(ge=-1000, le=1000)] | None = None

    @model_validator(mode="after")
    def _calendar(self):
        if self.recurrence is not None and self.civil is not None:
            raise ValueError("Calendar must select exactly one recurrence clock")
        if self.endsAt is not None and int(self.endsAt) < int(self.startsAt):
            raise ValueError("Calendar end cannot precede its first occurrence")
        return self

class WorldV1DirectorEvent(WorldV1Selector):
    """Explicit finite event request allowance; Host compilation checks the calendar and installed capability."""
    id: Key
    calendarId: Key
    maxRequests: Positive
    scopeId: Key
    targetId: Key

class WorldV1Behavior(WorldModel):
    """Complete finite initial goals, calendars and director declarations."""
    initialGoals: list[WorldV1Goal]
    calendars: list[WorldV1Calendar]
    directorEvents: list[WorldV1DirectorEvent]

class WorldV1Governance(WorldModel):
    """Declared committees and authored initial institutions."""
    committees: list[WorldV1Committee]
    norms: list[WorldV1Norm]

class WorldV1RuntimeProfiles(WorldModel):
    """Installed symbolic runtime and finite template choices; credentials stay Host-owned."""
    allowed: Annotated[list[WorldReference], Field(min_length=1)]
    generated: WorldReference
    templates: Annotated[list[WorldReference], Field(min_length=1)]

class WorldV1Communication(WorldModel):
    """Declared original channel topology."""
    channels: list[WorldV1Channel]

class WorldV1ExternalWorld(WorldModel):
    """Simulated-only external declarations and optional complete installed adjudication policy."""
    mode: Literal["simulated-only"]
    identities: list[WorldV1ExternalIdentity]
    adjudicationPolicy: WorldV1AdjudicationPolicy | None = None

class WorldV1Limits(WorldLimitsInput):
    """All quota groups are explicit; individual supported owner bounds may be omitted."""
    native: dict[NativeKey, ObservationCount]
    team: dict[TeamKey, Positive]
    world: dict[WorldKey, ObservationCount]

class WorldScenarioV1(WorldV1Model):
    """Complete portable v1 authoring input; Host compilation validates cross-owner references and budgets."""
    apiVersion: Literal["clocky.world/v1"]
    metadata: WorldNamedIdentity
    runtimeProfiles: WorldV1RuntimeProfiles
    domains: Annotated[list[WorldV1Selector], Field(min_length=1)]
    entities: Annotated[list[WorldV1Person | WorldV1OrganizationEntity | WorldV1InactivePerson | WorldV1Object | WorldV1Environment | WorldV1PersonState], Field(min_length=3)]
    organization: WorldV1Organization
    governance: WorldV1Governance
    facts: list[WorldV1Fact]
    knowledge: list[WorldV1Knowledge]
    resources: list[WorldV1Resource]
    communication: WorldV1Communication
    externalWorld: WorldV1ExternalWorld
    behavior: WorldV1Behavior
    limits: WorldV1Limits

WorldDefinition = Annotated[WorldScenario | WorldScenarioV1, Field(discriminator="apiVersion")]

class WorldV1DomainPin(WorldV1Selector):
    """Exact admitted parser and execution generation metadata, without provider code."""
    schemaRef: Identity
    implementationRef: Identity
    generation: Positive

class TemplateReference(WorldV1Model):
    """Exact symbolic dependency reference."""
    id: Annotated[str, Field(min_length=1, max_length=256)]
    version: Annotated[str, Field(min_length=1, max_length=256)]

class TemplateLicense(WorldV1Model):
    """Explicit license metadata supplied by the author."""
    identifier: Annotated[str, Field(min_length=1, max_length=256)]
    notice: Annotated[str, Field(max_length=8192)]

class TemplateDependencies(WorldV1Model):
    """Original domain implementation and policy inventory; no executable installation data."""
    domains: Annotated[list[WorldV1DomainPin], Field(min_length=1)]
    runtimeProfiles: Annotated[list[TemplateReference], Field(min_length=1)]
    templates: Annotated[list[TemplateReference], Field(min_length=1)]
    policyVersion: Annotated[str, Field(min_length=1, max_length=256)]
    normPolicies: list[Annotated[str, Field(min_length=1, max_length=256)]]

class ScenarioTemplateManifest(TemplateReference):
    """Inert distribution metadata kept separately from world facts."""
    license: TemplateLicense
    attribution: Annotated[list[Annotated[str, Field(min_length=1, max_length=1024)]], Field(max_length=32)]
    dependencies: TemplateDependencies

class SimulationWorldPreflightInput(WorldModel):
    """Inert World preflight; no command, run or execution identity is allocated."""
    definition: WorldDefinition
    templateManifest: ScenarioTemplateManifest | None = None

class WorldPreflightIdentity(WorldModel):
    """Commitment to the exact accepted preview and installed catalog generation."""
    hash: Hash
    catalogGeneration: Identity

class SimulationWorldCreateInput(SimulationWorldPreflightInput):
    """Immutable original command and preview; accepted World creation remains paused."""
    commandId: Identity
    name: Identity
    preflight: WorldPreflightIdentity

    @model_validator(mode="after")
    def _trimmed(self):
        if self.commandId != self.commandId.strip() or self.name != self.name.strip():
            raise ValueError("World creation command and name must be trimmed")
        return self

class WorldPreview(WorldPreflightIdentity):
    """Bounded initial summary tied to the original portable definition."""
    organizationName: Identity
    actorCount: Positive
    positionCount: Positive
    initialRequestCount: ObservationCount
    directorEntityId: Key

class WorldModelVersion(WorldModel):
    """Installed model identity and version, without credentials."""
    provider: Identity
    name: Identity
    version: Identity

class WorldPreviewActor(WorldModel):
    """Resolved initial actor and selected template/model versions."""
    entityId: Key
    role: Literal["director", "member"]
    name: Identity
    template: WorldReference
    model: WorldModelVersion

class WorldPreviewPosition(WorldModel):
    """Resolved initial capacity and occupied count."""
    entityId: Key
    name: Identity
    capacity: Positive
    occupied: ObservationCount

    @model_validator(mode="after")
    def _capacity(self):
        if self.occupied > self.capacity:
            raise ValueError("World position occupancy exceeds capacity")
        return self

class WorldPreviewAuthorization(WorldModel):
    """Initial member and position selected by trusted authorization resolution."""
    requesterEntityId: Key
    positionEntityId: Key

class WorldScope(WorldModel):
    """Supported hiring operation with explicitly absent payroll/committee approval."""
    source: Literal["simulated-only"]
    operation: Literal["organization.generate-and-hire/v1"]
    payroll: Literal[False]
    committeeApproval: Literal[False]

    @model_validator(mode="before")
    @classmethod
    def _false_flags(cls, value):
        if isinstance(value, dict) and any(value.get(key) is not False for key in ["payroll", "committeeApproval"]):
            raise ValueError("World scope flags must be false")
        return value

class WorldDiagnostic(WorldModel):
    """Safe field diagnostic with optional syntax and paired one-based file locations."""
    source: Literal["scenario", "catalog", "preflight"]
    path: list[str | ObservationCount]
    code: Literal["invalid-json", "invalid-shape", "duplicate-id", "unknown-reference", "capacity", "unauthorized-role",
                  "model-unavailable", "template-choice", "stale-preflight", "invalid-catalog", "invalid-reference",
                  "domain-unavailable", "organization-cycle", "assignment-overlap", "membership-overlap", "committee-threshold",
                  "policy-unavailable", "time-horizon", "unsupported-scope", "unsupported-feature"]
    message: Identity
    format: Literal["json", "yaml"] | None = None
    line: Annotated[int, Field(strict=True, ge=1, le=9_007_199_254_740_991)] | None = None
    column: Annotated[int, Field(strict=True, ge=1, le=9_007_199_254_740_991)] | None = None

    @model_validator(mode="after")
    def validate_location(self) -> "WorldDiagnostic":
        if (self.line is None) != (self.column is None):
            raise ValueError("Source locations require both line and column")
        return self

class SimulationWorldPreflightReady(WorldModel):
    """Strict current initial-scene preview; private compiled runtime data is excluded."""
    status: Literal["ready"]
    preview: WorldPreview
    policyVersion: Identity
    organization: WorldNamedIdentity
    actors: Annotated[list[WorldPreviewActor], Field(min_length=2)]
    positions: Annotated[list[WorldPreviewPosition], Field(min_length=1)]
    authorizations: list[WorldPreviewAuthorization]
    limits: WorldLimits
    maxTime: Decimal
    budgetInterval: PositiveDecimal
    tickUnit: Identity
    scope: WorldScope

    @model_validator(mode="after")
    def _identities(self):
        directors = [actor for actor in self.actors if actor.role == "director"]
        names = [self.organization.id, *(value.entityId for value in self.positions), *(value.entityId for value in self.actors)]
        if (self.preview.organizationName != self.organization.name or self.preview.actorCount != len(self.actors)
            or self.preview.positionCount != len(self.positions) or len(directors) != 1
            or directors[0].entityId != self.preview.directorEntityId or len(names) != len(set(names))
            or any(not any(actor.entityId == grant.requesterEntityId and actor.role == "member" for actor in self.actors)
                   or not any(position.entityId == grant.positionEntityId for position in self.positions) for grant in self.authorizations)):
            raise ValueError("World preview initial identities are inconsistent")
        return self

class SimulationWorldPreflightInvalid(WorldModel):
    """Strict nonempty safe field diagnostics for an invalid inert definition."""
    status: Literal["invalid"]
    diagnostics: Annotated[list[WorldDiagnostic], Field(min_length=1)]

class WorldV1Preview(WorldPreview):
    """Full initialization summary; the commitment covers actual installed selections."""
    creationMode: Literal["paused"]
    source: Literal["simulated-only"]
    entityCount: Positive

class WorldV1Scope(WorldModel):
    """Actual simulated domain capabilities, independent from role labels or user text."""
    source: Literal["simulated-only"]
    payroll: Literal[False]
    committeeApproval: bool
    domains: Annotated[list[WorldV1DomainPin], Field(min_length=1)]

    @model_validator(mode="before")
    @classmethod
    def _false_payroll(cls, value):
        if isinstance(value, dict) and value.get("payroll") is not False:
            raise ValueError("World payroll capability must be false")
        return value

class WorldV1UnitPreview(WorldV1Unit):
    """Named managed unit with its declared parent."""
    name: Identity

class WorldV1PositionPermissions(WorldModel):
    """Installed permissions derived from a real active assignment at request admission."""
    positionEntityId: Key
    permissions: list[WorldV1Permission]

class WorldV1Sources(WorldModel):
    """Authored source counts; no private runtime or Session body enters a preview."""
    facts: ObservationCount
    privateBeliefs: ObservationCount
    resources: ObservationCount
    externalIdentities: ObservationCount
    initialGoals: ObservationCount
    calendars: ObservationCount
    directorEvents: ObservationCount

class SimulationWorldPreflightV1Ready(SimulationWorldPreflightReady):
    """Strict complete v1 metadata preview; real execution remains explicitly paused."""
    apiVersion: Literal["clocky.world/v1"]
    preview: WorldV1Preview
    actors: Annotated[list[WorldPreviewActor], Field(min_length=1)]
    scope: WorldV1Scope
    units: list[WorldV1UnitPreview]
    committees: list[WorldV1Committee]
    institutions: list[WorldV1InstitutionMetadata]
    permissions: list[WorldV1Grant]
    assignments: list[WorldV1Assignment]
    positionPermissions: list[WorldV1PositionPermissions]
    sources: WorldV1Sources

    @model_validator(mode="after")
    def _complete_topology(self):
        names = [self.organization.id, *(item.id for item in self.units), *(item.id for item in self.committees),
                 *(item.entityId for item in self.positions), *(item.entityId for item in self.actors)]
        if len(names) != len(set(names)) or self.preview.initialRequestCount != 0 or self.preview.entityCount < len(names):
            raise ValueError("World v1 preview topology is inconsistent")
        return self


def _world_preview_variant(value):
    if isinstance(value, dict):
        return "invalid" if value.get("status") == "invalid" else value.get("apiVersion", "clocky.world/v0")
    return "invalid" if getattr(value, "status", None) == "invalid" else getattr(value, "apiVersion", "clocky.world/v0")

SimulationWorldPreflightResult = Annotated[
    Annotated[SimulationWorldPreflightReady, Tag("clocky.world/v0")]
    | Annotated[SimulationWorldPreflightV1Ready, Tag("clocky.world/v1")]
    | Annotated[SimulationWorldPreflightInvalid, Tag("invalid")], Discriminator(_world_preview_variant)]

class WorldPreflightResponse(RootModel[SimulationWorldPreflightResult]):
    """Strict discriminated response carrier used by the SDK transport validator."""

SimulationWorldPrepareInput = SimulationPrepareInput
SimulationWorldExportInput = SimulationControlInput

class SimulationWorldExportResult(WorldModel):
    """Original portable definition correlated to its authorized run; this is not a run backup."""
    runId: Identity
    definition: WorldDefinition
