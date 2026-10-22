"""Strict bounded World domain windows; metadata never grants prose, Persona or Session access."""
from __future__ import annotations

import json
from typing import Annotated, Literal
from pydantic import AfterValidator, ConfigDict, Field, model_validator, model_serializer
from .simulation_world_cases import CaseBusinessSummary
from .simulation_norm_impact import SimulationNormImpactInput, SimulationNormImpact
from .simulation_calendar import CalendarPerson, CalendarPosition
from .simulation_calendar_base import WorldCalendarRecurrence, WorldCivilCalendar
from .simulation_personnel import PersonnelOriginal
from .simulation_base import SimulationModel, SimulationText, Identity, Decimal, PositiveDecimal, ObservationCount, utf16_code_units

Kind = Literal["overview", "organization", "person", "governance", "proposal", "norm", "external", "identity", "case-extensions", "hiring-market"]
Employment = Literal["employed", "departing", "departed", "terminated", "candidate"]
Residency = Literal["resident", "released", "retiring", "retirement-unconfirmed", "not-applicable", "unknown"]
SourceKind = Literal["rule", "director-ruling", "simulated-actor"]


class WorldReadModel(SimulationModel):
    """Optional wire members are absent; explicit null is allowed only by required nullable fields."""
    model_config = ConfigDict(extra="forbid", strict=True, serialize_by_alias=True)

    @model_validator(mode="before")
    @classmethod
    def _optional_absence(cls, value):
        if isinstance(value, dict):
            for key, item in value.items():
                field = next((field for name, field in cls.model_fields.items() if key in {name, field.alias}), None)
                if item is None and field is not None and not field.is_required():
                    raise ValueError(f"Optional {key} must be absent rather than null")
        return value


class SimulationWorldDomainInput(WorldReadModel):
    """One exact family/section selector; no body policy, execution or Native options are accepted."""
    kind: Kind
    runId: Identity
    limit: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)] | None = None
    cursor: Identity | None = None
    expectedRevision: ObservationCount | None = None
    readVersion: Identity | None = None
    at: Decimal | None = None
    lens: Literal["structure", "timeline", "people", "proposals", "norms", "history"] | None = None
    family: Literal["persona-draft", "vacancy", "application", "offer-revision"] | None = None
    personId: Identity | None = None
    section: Literal["identity", "tenures", "obligations", "record", "electorate", "votes", "impact", "facts", "interactions", "representatives"] | None = None
    normImpact: SimulationNormImpactInput | None = None
    proposalId: Identity | None = None
    versionId: Identity | None = None
    key: Identity | None = None
    requestIds: Annotated[list[Identity], Field(min_length=1, max_length=128)] | None = None

    @model_validator(mode="after")
    def _selection(self) -> SimulationWorldDomainInput:
        required = {"overview": set(), "organization": {"lens"}, "person": {"personId", "section"},
                    "governance": {"lens"}, "proposal": {"proposalId", "section"}, "norm": {"versionId"},
                    "external": set(), "identity": {"key", "section"}, "case-extensions": {"requestIds"}, "hiring-market": {"family"}}[self.kind]
        supplied = self.model_fields_set - {"kind", "runId", "limit", "cursor", "expectedRevision", "readVersion", "at"}
        if 'normImpact' in supplied and self.kind == 'proposal' and self.section == 'impact':
            supplied.remove('normImpact')
        if supplied != required:
            raise ValueError("World family requires exactly its own selector fields")
        choices = {"organization": {"structure", "timeline", "people"}, "governance": {"proposals", "norms", "history"},
                   "person": {"identity", "tenures", "obligations"}, "proposal": {"record", "electorate", "votes", "impact"},
                   "identity": {"record", "facts", "interactions", "representatives"}}
        if self.kind in choices and (self.lens if self.kind in {"organization", "governance"} else self.section) not in choices[self.kind]:
            raise ValueError("Selector section does not belong to its World family")
        if self.requestIds is not None and len(set(self.requestIds)) != len(self.requestIds):
            raise ValueError("Case selections must be distinct")
        return self


class WorldCoverage(WorldReadModel):
    loaded: ObservationCount
    total: ObservationCount | None = None
    revision: ObservationCount
    scope: Identity
    complete: bool
    reason: Literal["native-only", "unavailable", "source-moved"] | None = None
    at: Decimal | None = None
    nextCursor: Identity | None = None
    pendingUpdates: ObservationCount | None = None

    @model_validator(mode="after")
    def _bounds(self) -> WorldCoverage:
        if self.total is not None and self.loaded > self.total:
            raise ValueError("Loaded count exceeds original total")
        if self.complete and (self.reason is not None or self.nextCursor is not None):
            raise ValueError("Complete coverage cannot hide omitted pages or sources")
        return self


class WorldIdRef(WorldReadModel):
    kind: Literal["entity", "decision", "operation", "checkpoint"]
    id: Identity
    label: Identity | None = None


class WorldRecordRef(WorldReadModel):
    kind: Literal["record"]
    sequence: ObservationCount
    label: Identity | None = None


class WorldEnvelopeRef(WorldReadModel):
    kind: Literal["envelope"]
    id: Identity
    teamId: Identity
    channelId: Identity
    envelopeId: Identity
    envelopeSequence: ObservationCount | None = None
    decisionId: Identity | None = None
    sourceIndex: ObservationCount | None = None
    label: Identity | None = None


    @model_validator(mode="after")
    def _canonical(self) -> WorldEnvelopeRef:
        if self.id != self.envelopeId:
            raise ValueError("Envelope identity must retain its canonical original")
        if self.sourceIndex is not None and self.decisionId is None:
            raise ValueError("Frozen source ordinal requires its original decision")
        if self.envelopeSequence is None and (self.decisionId is None or self.sourceIndex is None):
            raise ValueError("Envelope requires a canonical receipt sequence or frozen decision/source ordinal")
        return self


class WorldTeamTaskRef(WorldReadModel):
    kind: Literal["team-task"]
    id: Identity
    teamId: Identity
    label: Identity | None = None


WorldEngineRef = Annotated[WorldIdRef | WorldRecordRef | WorldEnvelopeRef | WorldTeamTaskRef, Field(discriminator="kind")]


class WorldBodyWithheld(WorldReadModel):
    state: Literal["withheld", "redacted", "not-applicable"]


class WorldBodyAllowed(WorldReadModel):
    state: Literal["allowed"]
    value: SimulationText


WorldBody = Annotated[WorldBodyWithheld | WorldBodyAllowed, Field(discriminator="state")]


class WorldTenure(WorldReadModel):
    id: Identity
    personId: Identity
    positionId: Identity
    positionName: SimulationText
    from_: Decimal = Field(alias="from")
    until: Decimal | None = None
    requestedAt: Decimal | None = None
    end: Literal["departed", "terminated", "transferred"] | None = None
    revision: ObservationCount


class WorldPersonRow(WorldReadModel):
    id: Identity
    name: SimulationText
    unitId: Identity | None = None
    position: SimulationText | None = None
    employment: Employment
    cognition: Literal["agent", "none"]
    residency: Residency
    pendingObligations: ObservationCount | None
    tenures: list[WorldTenure]

    @model_serializer(mode="wrap")
    def _retain_unknown_obligations(self, handler):
        value = handler(self)
        if self.pendingObligations is None:
            value["pendingObligations"] = None
        return value


class WorldObligation(WorldReadModel):
    id: Identity
    kind: Literal["decision", "operation", "task-attempt", "commitment", "resource", "wake", "message", "subordinate", "owner-duty"]
    label: SimulationText
    owner: SimulationText
    state: Literal["waiting", "actionable", "handoff-required", "settled"]
    revision: ObservationCount
    ref: WorldEngineRef | None = None
    original: PersonnelOriginal | None = None
    certainty: Literal["recorded", "outcome-unknown", "external-observation-required"] | None = None
    ownerState: Identity | None = None
    dispositions: list[Literal["wait", "cancel-and-recreate"]]

    @model_validator(mode="after")
    def _owner_evidence(self) -> WorldObligation:
        if self.kind == "owner-duty" and (self.original is None or self.certainty is None or self.ownerState is None
            or self.original.cursor != self.revision or self.dispositions != ["wait"]):
            raise ValueError("Owner duties require actual source evidence and confer only observation")
        return self



class WorldAction(WorldReadModel):
    action: Literal["transfer", "depart", "rehire", "hire-existing", "hiring-market", "cancel-case", "dispose-obligation"]
    allowed: bool
    reason: Identity | None = None


class WorldTally(WorldReadModel):
    for_: ObservationCount = Field(alias="for")
    against: ObservationCount
    abstain: ObservationCount
    pending: ObservationCount
    electorate: ObservationCount
    threshold: ObservationCount
    quorum: ObservationCount
    rule: Literal["unanimous", "absolute"]
    closure: Literal["open", "can-still-change", "decided", "closed"]


class WorldProposalSummary(WorldReadModel):
    id: Identity
    title: SimulationText
    committee: SimulationText
    status: Literal["voting", "passed", "failed", "enacted", "withdrawn"]
    deadline: Decimal
    tally: WorldTally


class WorldAdvisory(WorldReadModel):
    mode: Literal["advisory"]


class WorldValidated(WorldReadModel):
    mode: Literal["validated"]
    policyRef: Identity | None = None


class NormAuditStep(WorldReadModel):
    """Actual receipt/effect/notification responsibility, including uncompleted work."""
    id: Identity
    kind: Literal['resolution', 'vote', 'decision', 'effective', 'notification']
    state: Literal['pending', 'completed', 'cancelled', 'missing']
    at: Decimal | None = None
    source: WorldEngineRef | None = None

class WorldNorm(WorldReadModel):
    audit: list[NormAuditStep] | None = None
    id: Identity
    normId: Identity
    title: SimulationText
    version: PositiveDecimal
    enforcement: Annotated[WorldAdvisory | WorldValidated, Field(discriminator="mode")]
    scope: SimulationText
    recordedAt: Decimal | None = None
    effectiveFrom: Decimal | None = None
    knowableAt: Decimal | None = None
    until: Decimal | None = None
    body: WorldBody
    sourceProposalId: Identity | None = None
    sources: list[WorldEngineRef]


class WorldExternalRow(WorldReadModel):
    key: Identity
    name: SimulationText
    kind: SourceKind
    generation: ObservationCount
    latest: WorldLatest | None = None


class WorldLatest(WorldReadModel):
    at: Decimal
    summary: SimulationText


class WorldTrackStep(WorldReadModel):
    id: Identity
    label: str
    state: Literal["done", "active", "waiting", "blocked", "rejected", "unknown", "pending"]


class WorldTrack(WorldReadModel):
    kind: Literal["request", "plan", "execution", "notification"]
    steps: list[WorldTrackStep]
    summary: str


class WorldEvidenceRevision(WorldReadModel):
    at: Decimal
    summary: SimulationText


class WorldEvidence(WorldReadModel):
    fields: list[Identity]
    responders: list[SimulationText]
    deadline: Decimal
    remainingAttempts: ObservationCount
    revisions: list[WorldEvidenceRevision]


class WorldMutation(WorldReadModel):
    phase: Literal["retained", "reserved", "quiescing", "transferring", "committed", "notifying", "done"]
    blocked: Identity | None = None
    cancelRequested: bool


class WorldCaseExtension(WorldReadModel):
    businessSummary: CaseBusinessSummary
    requestId: Identity
    domain: Identity
    operation: Identity
    businessKey: WorldBody
    target: SimulationText | None = None
    updatedAt: Decimal | None = None
    tracks: list[WorldTrack]
    evidence: WorldEvidence | None = None
    sources: list[WorldEngineRef]
    mutation: WorldMutation | None = None


class WorldAttention(WorldReadModel):
    handoffRequired: ObservationCount
    outcomeUnknown: ObservationCount
    retirementUnconfirmed: ObservationCount
    implementationMissing: ObservationCount
    evidenceRequired: ObservationCount


class WorldUpcoming(WorldReadModel):
    at: Decimal
    label: SimulationText
    scope: SimulationText | None = None


class WorldNormCounts(WorldReadModel):
    active: ObservationCount
    knownNotEffective: ObservationCount


class WorldSourceCounts(WorldReadModel):
    rule: ObservationCount | None = None
    director_ruling: ObservationCount | None = Field(default=None, alias="director-ruling")
    simulated_actor: ObservationCount | None = Field(default=None, alias="simulated-actor")


class WorldExternalCounts(WorldReadModel):
    identities: ObservationCount
    byKind: WorldSourceCounts
    latest: WorldLatest | None = None


class WorldCaseCount(WorldReadModel):
    status: Identity
    count: ObservationCount


class WorldCalendarRule(WorldReadModel):
    """Original rule for one event in the same bounded upcoming page."""
    id: Identity
    ruleRevision: Annotated[int, Field(gt=0)]
    target: Annotated[CalendarPerson | CalendarPosition, Field(discriminator="kind")]
    body: WorldBody
    startsAt: Decimal
    endsAt: Decimal | None
    period: Decimal
    maxOccurrences: Annotated[int, Field(gt=0)]
    recurrence: WorldCalendarRecurrence | None = None
    civil: WorldCivilCalendar | None = None
    priority: Annotated[int, Field(ge=-1000, le=1000)] | None = None


class WorldOverview(WorldReadModel):
    calendars: list[WorldCalendarRule] | None = None
    runId: Identity
    revision: ObservationCount
    now: Decimal
    tickUnit: Identity
    attention: WorldAttention
    upcoming: list[WorldUpcoming]
    proposals: list[WorldProposalSummary]
    norms: WorldNormCounts
    external: WorldExternalCounts
    caseFlow: list[WorldCaseCount]


class WorldOccupancy(WorldReadModel):
    occupied: ObservationCount
    reserved: ObservationCount
    capacity: ObservationCount


class WorldOrgNode(WorldReadModel):
    id: Identity
    kind: Literal["unit", "position"]
    name: SimulationText
    parentId: Identity | None = None
    occupancy: WorldOccupancy | None = None


class WorldOrgEdge(WorldReadModel):
    id: Identity
    from_: Identity = Field(alias="from")
    to: Identity
    kind: Literal["parent", "reports-to"]


class WorldTimeRange(WorldReadModel):
    from_: Decimal = Field(alias="from")
    until: Decimal


class WorldOrganization(WorldReadModel):
    runId: Identity
    coverage: WorldCoverage
    now: Decimal
    tickUnit: Identity
    nodes: list[WorldOrgNode]
    edges: list[WorldOrgEdge]
    people: list[WorldPersonRow]
    range: WorldTimeRange
    unloadedNodes: ObservationCount


class WorldPersona(WorldReadModel):
    summary: SimulationText


class WorldPersonaAllowed(WorldReadModel):
    state: Literal["allowed"]
    value: WorldPersona


class WorldPerson(WorldReadModel):
    runId: Identity
    personId: Identity
    revision: ObservationCount
    name: SimulationText
    employment: Employment
    residency: Residency
    participantId: Identity | None = None
    sessionId: Identity | None = None
    entity: WorldEngineRef
    persona: Annotated[WorldBodyWithheld | WorldPersonaAllowed, Field(discriminator="state")]
    tenures: list[WorldTenure]
    obligations: list[WorldObligation]
    actions: list[WorldAction]
    sources: list[WorldEngineRef]


class WorldGovernance(WorldReadModel):
    runId: Identity
    coverage: WorldCoverage
    now: Decimal
    tickUnit: Identity
    proposals: list[WorldProposalSummary]
    norms: list[WorldNorm]


class WorldNormRef(WorldReadModel):
    id: Identity
    version: PositiveDecimal


class WorldProxy(WorldReadModel):
    """Actual delegate plus original persisted authority reference."""
    delegateId: Identity
    delegationId: Identity


class WorldElector(WorldReadModel):
    proxy: WorldProxy | None = None
    personId: Identity
    name: SimulationText
    ballot: Literal["for", "against", "abstain", "none"]
    decision: WorldEngineRef | None = None
    leftCommittee: bool
    sources: list[WorldEngineRef] | None = None


class WorldResolution(WorldReadModel):
    at: Decimal
    outcome: Literal["passed", "failed"]


class WorldEnactment(WorldReadModel):
    state: Literal["not-applicable", "awaiting-request", "enacted"]
    normVersion: WorldNormRef | None = None
    announcement: Literal["pending", "published", "unknown"] | None = None


class WorldReviewStep(WorldReadModel):
    """Actual immutable committee resolution reference."""
    id: Identity
    proposalId: Identity
    resolutionId: Identity | None
    resolutionHash: Identity | None
    dependsOn: list[Identity]


class WorldReviewUnanimity(WorldReadModel):
    kind: Literal['unanimity']


class WorldReviewThreshold(WorldReadModel):
    kind: Literal['absolute-threshold']
    yes: Annotated[int, Field(gt=0)]


class WorldReviewDefinitionStep(WorldReviewStep):
    committeeId: Identity
    deadline: Decimal
    quorum: Annotated[int, Field(gt=0)]
    rule: Annotated[WorldReviewUnanimity | WorldReviewThreshold, Field(discriminator="kind")]
    electorate: list[Identity]
    status: Literal['pending', 'passed', 'failed']


class WorldReviewDefinition(WorldReadModel):
    id: Identity
    hash: Identity
    bodyHash: Identity
    mode: Literal['and', 'or', 'ordered']
    deadline: Decimal
    steps: list[WorldReviewDefinitionStep]


class WorldReviewRoute(WorldReadModel):
    """Frozen ordered or AND/OR combination, disclosed with its approved document."""
    id: Identity
    revision: Annotated[int, Field(gt=0)]
    hash: Identity
    mode: Literal["and", "or", "ordered"]
    steps: list[WorldReviewStep]


class NormImpactAllowed(WorldReadModel):
    state: Literal['allowed']
    value: SimulationNormImpact

class NormImpactInputAllowed(WorldReadModel):
    state: Literal['allowed']
    value: SimulationNormImpactInput

class NormImpactChoices(WorldReadModel):
    committeeId: Identity
    positionIds: list[Identity]

class NormImpactChoicesAllowed(WorldReadModel):
    state: Literal['allowed']
    value: NormImpactChoices

class WorldProposal(WorldProposalSummary):
    normImpact: Annotated[WorldBodyWithheld | NormImpactAllowed, Field(discriminator='state')] | None = None
    normImpactInput: Annotated[WorldBodyWithheld | NormImpactInputAllowed, Field(discriminator='state')] | None = None
    normImpactChoices: Annotated[WorldBodyWithheld | NormImpactChoicesAllowed, Field(discriminator='state')] | None = None
    reviewRoute: WorldReviewRoute | None = None
    routeDefinition: WorldReviewDefinition | None = None
    runId: Identity
    version: PositiveDecimal
    bodyHash: Identity
    body: WorldBody
    targetNorm: WorldNormRef | None = None
    frozenAt: Decimal
    electorateMembers: list[WorldElector]
    sources: list[WorldEngineRef]
    resolution: WorldResolution | None = None
    enactment: WorldEnactment


class WorldExternal(WorldReadModel):
    runId: Identity
    coverage: WorldCoverage
    identities: list[WorldExternalRow]


class WorldFactUnknown(WorldReadModel):
    state: Literal["unknown"]


class WorldFactKnown(WorldReadModel):
    state: Literal["known"]
    text: SimulationText


class WorldFact(WorldReadModel):
    key: Identity
    value: Annotated[WorldFactUnknown | WorldFactKnown, Field(discriminator="state")]
    report: bool


class WorldRepresentative(WorldReadModel):
    person: SimulationText
    participantId: Identity | None = None
    sessionId: Identity | None = None
    ready: Literal["ready", "preparing", "blocked"]
    steps: list[WorldTrackStep]


class WorldRepresentativeRecord(WorldReadModel):
    entity: WorldEngineRef
    person: SimulationText
    participantId: Identity
    sessionId: Identity
    ready: Literal["ready", "preparing", "blocked"]
    steps: list[WorldTrackStep]


class WorldInteraction(WorldReadModel):
    id: Identity
    at: Decimal
    requester: SimulationText
    kind: Literal["rule", "director-ruling", "simulated-actor", "authenticated-user", "world-decision"]
    basis: SimulationText
    outcome: SimulationText
    sampled: bool
    disclosure: WorldBody


class WorldIdentity(WorldExternalRow):
    runId: Identity
    entity: WorldEngineRef
    revision: ObservationCount
    expansion: SimulationText
    facts: list[WorldFact]
    representative: WorldRepresentative | None = None
    representatives: list[WorldRepresentativeRecord] | None = None
    interactions: list[WorldInteraction]
    sources: list[WorldEngineRef]


def _market_bound(limit: int):
    def validate(value: str) -> str:
        if utf16_code_units(value) > limit:
            raise ValueError(f"Market text exceeds {limit} UTF-16 code units")
        return value
    return validate


MarketKey = Annotated[Identity, AfterValidator(_market_bound(256))]
MarketSourceText = Annotated[Identity, AfterValidator(_market_bound(1024))]
MarketTerms = Annotated[Identity, AfterValidator(_market_bound(8192))]
MarketReviewReason = Annotated[str, AfterValidator(_market_bound(2048))]


class MarketModel(WorldReadModel):
    @model_serializer(mode="wrap")
    def _required_nulls(self, handler):
        value = handler(self)
        for name, field in type(self).model_fields.items():
            if field.is_required() and getattr(self, name) is None:
                value[field.alias or name] = None
        return value


class MarketUserSource(MarketModel):
    kind: Literal["authenticated-user"]
    commandId: MarketKey
    principalId: MarketSourceText
    credentialGeneration: ObservationCount
    policyRef: MarketSourceText
    policyGeneration: MarketSourceText
    time: Decimal


class MarketPersona(MarketModel):
    name: Identity
    skills: list[Identity]
    traits: list[Identity]
    goals: list[Identity]

    @model_validator(mode="after")
    def _unique(self):
        if any(len(values) != len(set(values)) for values in [self.skills, self.traits, self.goals]):
            raise ValueError("Finite Persona choices must be distinct")
        return self


class MarketDraftBody(MarketModel):
    templateId: MarketKey
    templateVersion: MarketKey
    persona: MarketPersona


class MarketDraftSource(MarketModel):
    kind: Literal["finite-template"]
    actorId: Identity | None
    user: MarketUserSource | None
    generatorVersion: Literal["finite-template/1"]
    modelVersion: None
    templateId: MarketKey
    templateVersion: MarketKey
    policyVersion: MarketKey


class MarketGeneratedDraftSource(MarketModel):
    """Exact original isolated generation and canonical Session input behind an A2 draft."""
    kind: Literal["generation"]
    actorId: Identity | None
    user: MarketUserSource | None
    generatorVersion: Literal["isolated-generation/1"]
    modelVersion: MarketKey
    templateId: MarketKey
    templateVersion: MarketKey
    policyVersion: MarketKey
    generationJobId: MarketKey
    sessionId: MarketKey
    sessionSequence: ObservationCount


class MarketDraftPrior(MarketModel):
    revision: Annotated[int, Field(ge=1, le=16)]
    bodyHash: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]


class MarketDraftEditor(MarketModel):
    actorId: Identity | None
    user: MarketUserSource | None


class MarketPersonaDraft(MarketModel):
    kind: Literal["persona-draft"]
    organizationEntityId: Identity
    positionEntityId: Identity
    id: MarketKey
    revision: Annotated[int, Field(ge=1, le=16)]
    validUntil: Decimal
    body: MarketDraftBody
    bodyHash: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    prior: MarketDraftPrior | None
    editedBy: MarketDraftEditor
    reviewReason: MarketReviewReason | None
    source: Annotated[MarketDraftSource | MarketGeneratedDraftSource, Field(discriminator="kind")]
    status: Literal["draft", "reviewed", "rejected", "accepted", "expired"]
    reviewerId: Identity | None
    reviewerSource: MarketUserSource | None


class MarketVacancy(MarketModel):
    kind: Literal["vacancy"]
    organizationEntityId: Identity
    positionEntityId: Identity
    id: MarketKey
    employerId: Identity
    validUntil: Decimal
    capacity: Annotated[int, Field(ge=1, le=10000)]
    requirements: Annotated[list[MarketKey], Field(max_length=32)]
    reservationPolicy: Literal["on-proposal", "on-acceptance"]


class MarketApplication(MarketModel):
    kind: Literal["application"]
    organizationEntityId: Identity
    positionEntityId: Identity
    id: MarketKey
    vacancyId: MarketKey
    candidateId: Identity


class MarketFee(MarketModel):
    id: MarketKey
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
        if self.from_ == self.to or len(self.grants) != len(set(self.grants)):
            raise ValueError("Market fee requires distinct accounts and grants")
        return self


class MarketApprovalNorm(MarketModel):
    id: Identity
    version: PositiveDecimal


class MarketApproval(MarketModel):
    proposalId: Identity
    proposalHash: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    resolutionId: Identity
    resolutionHash: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    norm: MarketApprovalNorm


class MarketOffer(MarketModel):
    kind: Literal["offer-revision"]
    organizationEntityId: Identity
    positionEntityId: Identity
    id: MarketKey
    revision: Annotated[int, Field(ge=1, le=16)]
    planId: Identity
    vacancyId: MarketKey
    applicationId: MarketKey
    candidateId: Identity
    employerId: Identity
    validUntil: Decimal
    terms: MarketTerms
    bodyHash: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    fee: MarketFee | None
    approvals: list[MarketApproval]
    reservationPolicy: Literal["on-proposal", "on-acceptance"]
    compensation: Literal["one-time-only"]
    status: Literal["proposed", "delivered", "accepted", "declined", "withdrawn", "expired"]


class MarketEmpty(MarketModel):
    pass


class MarketDetailAllowed(MarketModel):
    state: Literal["allowed"]
    value: MarketPersonaDraft | MarketOffer | MarketVacancy | MarketApplication | MarketEmpty


class WorldHiringMarketRow(WorldReadModel):
    """One original transition; body authority is independent of history metadata."""
    current: bool
    id: Identity
    requestId: Identity
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    revision: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    status: Identity
    body: WorldBody
    detail: Annotated[MarketDetailAllowed | WorldBodyWithheld, Field(discriminator="state")]
    sources: list[WorldEngineRef]

    @model_validator(mode="after")
    def _original_detail(self):
        if self.detail.state == "allowed":
            value = self.detail.value
            if not hasattr(value, "kind") or value.id != self.id or getattr(value, "revision", self.revision) != self.revision or getattr(value, "status", self.status) != self.status:
                raise ValueError("Hiring detail must retain its original row identity, revision and status")
        return self


class WorldHiringMarket(WorldReadModel):
    """Bounded immutable Persona/offer history from the original Native prefix."""
    runId: Identity
    coverage: WorldCoverage
    rows: list[WorldHiringMarketRow]


class SimulationWorldDomainResult(WorldReadModel):
    """One strict original window; echoed selectors cannot disguise a substituted value."""
    apiVersion: Literal["clocky.world-read/v1"]
    kind: Kind
    runId: Identity
    snapshotRevision: ObservationCount
    readVersion: Identity
    observedAt: ObservationCount
    selection: SimulationWorldDomainInput
    status: Literal["found", "missing"]
    coverage: WorldCoverage
    value: WorldHiringMarket | WorldOverview | WorldOrganization | WorldPerson | WorldGovernance | WorldProposal | WorldNorm | WorldExternal | WorldIdentity | list[WorldCaseExtension] | None = None

    @model_validator(mode="after")
    def _original(self) -> SimulationWorldDomainResult:
        query, value, coverage = self.selection, self.value, self.coverage
        if self.kind != query.kind or self.runId != query.runId or coverage.revision != self.snapshotRevision:
            raise ValueError("Window must retain original kind, run and Native revision")
        if (query.expectedRevision is not None and query.expectedRevision != self.snapshotRevision
            or query.readVersion is not None and query.readVersion != self.readVersion
            or query.at is not None and query.at != coverage.at):
            raise ValueError("Window must retain original revision, policy and time selectors")
        if (self.status == "found") != (value is not None):
            raise ValueError("Only a found original carries its selected projection")
        if value is None:
            return self
        expected = {"overview": WorldOverview, "organization": WorldOrganization, "person": WorldPerson,
                    "governance": WorldGovernance, "proposal": WorldProposal, "norm": WorldNorm,
                    "external": WorldExternal, "identity": WorldIdentity, "case-extensions": list, "hiring-market": WorldHiringMarket}[self.kind]
        if not isinstance(value, expected):
            raise ValueError("Window value belongs to another World family")
        if hasattr(value, "runId") and value.runId != self.runId:
            raise ValueError("Projected run differs from its wrapper")
        if hasattr(value, "coverage") and value.coverage != coverage:
            raise ValueError("Projected collection differs from original coverage")
        if hasattr(value, "now") and value.now != coverage.at:
            raise ValueError("Projected time differs from original coverage")
        if isinstance(value, WorldHiringMarket) and (len(value.rows) != coverage.loaded or coverage.scope != f"hiring-market/{query.family}" or any(row.detail.state == "allowed" and row.detail.value.kind != query.family for row in value.rows)):
            raise ValueError("Hiring market history must retain its family and page coverage")
        if isinstance(value, WorldOverview) and value.revision != self.snapshotRevision:
            raise ValueError("Overview revision differs from its original Native prefix")
        if isinstance(value, WorldOrganization):
            if coverage.scope != f"organization/{query.lens}":
                raise ValueError("Organization lens differs from original coverage")
            count = len(value.nodes) if query.lens == "structure" else (len(value.people) if query.lens == "people" else sum(len(row.tenures) for row in value.people))
            if count != coverage.loaded or (query.lens == "structure" and value.people) or (query.lens != "structure" and (value.nodes or value.edges)):
                raise ValueError("Organization window contains another lens")
        if isinstance(value, WorldPerson):
            if value.personId != query.personId or value.entity.kind != "entity" or value.entity.id != query.personId or coverage.scope != f"person/{query.section}":
                raise ValueError("Person original differs from its exact selector")
            if (query.section != "tenures" and value.tenures or query.section != "obligations" and value.obligations
                or any(row.personId != query.personId for row in value.tenures)
                or query.section == "tenures" and len(value.tenures) != coverage.loaded
                or query.section == "obligations" and (len(value.obligations) != coverage.loaded
                    or any(row.original is not None and row.original.cursor != self.snapshotRevision for row in value.obligations))):
                raise ValueError("Person window contains another section")
        if isinstance(value, WorldGovernance):
            count = len(value.proposals) if query.lens == "proposals" else len(value.norms)
            if coverage.scope != f"governance/{query.lens}" or count != coverage.loaded or (query.lens == "proposals" and value.norms) or (query.lens != "proposals" and value.proposals):
                raise ValueError("Governance window contains another lens")
        if isinstance(value, WorldProposal) and (value.id != query.proposalId or coverage.scope != f"proposal/{query.section}"
                                                or query.section in {"record", "impact"} and value.electorateMembers):
            raise ValueError("Proposal original differs from its exact selector")
        if isinstance(value, WorldNorm) and (value.id != query.versionId or value.id != json.dumps([value.normId, value.version], separators=(",", ":"), ensure_ascii=False)):
            raise ValueError("Norm original differs from its canonical version selector")
        if isinstance(value, WorldExternal) and len(value.identities) != coverage.loaded:
            raise ValueError("External window differs from original coverage")
        if isinstance(value, WorldIdentity) and (value.key != query.key or coverage.scope != f"identity/{query.section}"
            or query.section != "facts" and value.facts or query.section != "interactions" and value.interactions
            or query.section != "representatives" and value.representatives is not None
            or query.section == "facts" and len(value.facts) != coverage.loaded
            or query.section == "interactions" and len(value.interactions) != coverage.loaded
            or query.section == "representatives" and (value.representatives is None or len(value.representatives) != coverage.loaded)
            or query.section == "record" and coverage.loaded != 1):
            raise ValueError("Identity original differs from its exact selector and section")
        if isinstance(value, list) and (len(value) != coverage.loaded or len({row.requestId for row in value}) != len(value)
                                       or any(row.requestId not in query.requestIds for row in value)
                                       or any(row.businessSummary.status == "allowed" and row.businessSummary.value.nativeRevision != self.snapshotRevision for row in value)):
            raise ValueError("Case extensions contain duplicate or unselected originals")
        return self


# Forward declarations resolve after the complete strict graph exists.
SimulationWorldDomainResult.model_rebuild()
