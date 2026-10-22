"""Strict World case projections; case prose, Persona and Session text have separate disclosure policies."""
from __future__ import annotations

import json
from typing import Annotated, Literal
from pydantic import Field, JsonValue, field_validator, model_validator, model_serializer
from .simulation_base import SimulationModel, SimulationText, Identity, ManagementCommandId, Decimal, ObservationCount, utf16_code_units

CaseStatus = Literal["open", "awaiting-evidence", "cancel-requested", "cancelled", "rejected", "committed"]
CaseSection = Literal["request", "plans", "execution", "notification"]


class CaseModel(SimulationModel):
    """World-case optionals are absent; only required nullable fields retain an explicit null."""

    @model_validator(mode="before")
    @classmethod
    def _optional_absence(cls, value):
        if isinstance(value, dict):
            for name, field in cls.model_fields.items():
                key = field.alias or name
                if key in value and value[key] is None and not field.is_required():
                    raise ValueError(f"Optional {key} must be absent rather than null")
        return value


class CaseCancelImpact(CaseModel):
    """Finite actual original IDs, never private case prose or cleanup authority."""
    requestStatus: CaseStatus
    planIds: list[Identity]
    hiringReservationIds: list[Identity]
    personnelReservationIds: list[Identity]
    representativeReservationIds: list[Identity]
    unconfirmedExecutionPlanIds: list[Identity]

    @model_validator(mode="after")
    def _originals(self):
        for name in ["planIds", "hiringReservationIds", "personnelReservationIds", "representativeReservationIds", "unconfirmedExecutionPlanIds"]:
            values = getattr(self, name)
            if len(set(values)) != len(values):
                raise ValueError("Cancellation dependencies must be distinct originals")
        if not set(self.unconfirmedExecutionPlanIds).issubset(self.planIds):
            raise ValueError("Unconfirmed execution must belong to the selected original case plans")
        return self


class SimulationWorldCaseCancelPreview(CaseModel):
    """Fixed inert confirmation quote from one actual Native prefix."""
    snapshotRevision: ObservationCount
    previewHash: Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
    impact: CaseCancelImpact


class SimulationWorldCaseCancelCapability(CaseModel):
    """Advisory eligibility; Native independently checks every original command."""
    allowed: bool
    reason: Literal["ready", "terminal", "recovery-required", "retiring", "capacity", "in-progress", "stale"]
    preview: SimulationWorldCaseCancelPreview | None = None

    @model_validator(mode="before")
    @classmethod
    def _optional_preview(cls, value):
        if isinstance(value, dict) and "preview" in value and value["preview"] is None:
            raise ValueError("An unavailable cancellation quote is absent rather than null")
        return value

    @model_validator(mode="after")
    def _validate(self) -> SimulationWorldCaseCancelCapability:
        if (self.allowed != (self.reason == "ready") or self.allowed != (self.preview is not None)
            or self.preview is not None and self.preview.impact.requestStatus not in {"open", "awaiting-evidence"}):
            raise ValueError("Only a ready hint with its exact Native preview allows cancellation")
        return self


class CaseDecisionOrigin(CaseModel):
    kind: Literal["decision"]


class CaseUserOrigin(CaseModel):
    kind: Literal["authenticated-user"]
    commandId: ManagementCommandId


CaseOrigin = Annotated[CaseDecisionOrigin | CaseUserOrigin, Field(discriminator="kind")]


class BusinessCountKnown(CaseModel):
    status: Literal["known"]
    value: ObservationCount


class BusinessCountUnavailable(CaseModel):
    status: Literal["unknown", "withheld", "not-applicable"]
    reason: Literal["missing-evidence", "stale-evidence", "unconfirmed-effects", "invalid-evidence"] | None = None


BusinessCount = Annotated[BusinessCountKnown | BusinessCountUnavailable, Field(discriminator="status")]


class BusinessCounts(CaseModel):
    businessEntities: BusinessCount
    firms: BusinessCount
    alliances: BusinessCount
    organizations: BusinessCount
    memberships: BusinessCount
    employmentRelationships: BusinessCount
    founderRepresentedEntities: BusinessCount
    employedPeople: BusinessCount
    technicalRoles: BusinessCount
    independentSessions: BusinessCount
    openOrders: BusinessCount
    openLoans: BusinessCount


class BusinessSource(CaseModel):
    kind: Literal["request", "result", "environment", "bindings"]
    sequence: ObservationCount
    profileRevision: ObservationCount | None = None
    domainRevision: ObservationCount | None = None
    domainTime: Decimal | None = None


class BusinessSummary(CaseModel):
    version: Literal[1]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    submission: Literal["accepted", "rejected", "cancelled"]
    execution: Literal["pending", "accepted", "rejected", "unknown", "not-applicable"]
    businessOutcome: Literal["achieved", "not-achieved", "unknown", "not-applicable"]
    counts: BusinessCounts
    sources: Annotated[list[BusinessSource], Field(min_length=1, max_length=8)]
    nativeRevision: ObservationCount

    @field_validator("label")
    @classmethod
    def _label_units(cls, value: str) -> str:
        if utf16_code_units(value) > 80:
            raise ValueError("Business summary label exceeds 80 UTF-16 units")
        return value

    @model_validator(mode="after")
    def _source_prefix(self) -> BusinessSummary:
        if any(source.sequence > self.nativeRevision for source in self.sources):
            raise ValueError("Business summary sources must belong to the observed Native prefix")
        return self


class BusinessSummaryAllowed(CaseModel):
    status: Literal["allowed"]
    value: BusinessSummary


class BusinessSummaryUnavailable(CaseModel):
    status: Literal["unsupported", "withheld", "unknown"]


CaseBusinessSummary = Annotated[BusinessSummaryAllowed | BusinessSummaryUnavailable, Field(discriminator="status")]


class SimulationWorldCaseSummary(CaseModel):
    """Safe original business identities without private text."""
    apiVersion: Literal["clocky.world-case/v4"]
    businessSummary: CaseBusinessSummary
    domain: Identity
    operation: Identity
    version: Identity
    requestId: Identity
    intentId: Identity
    status: CaseStatus
    requesterEntityId: Identity | None
    origin: CaseOrigin
    organizationEntityId: Identity
    targetEntityId: Identity
    cancel: SimulationWorldCaseCancelCapability
    lifecycle: CaseLifecycle

    @model_validator(mode="after")
    def _tracks(self) -> SimulationWorldCaseSummary:
        if (self.origin.kind == "authenticated-user") != (self.requesterEntityId is None):
            raise ValueError("Authenticated user cases cannot claim a simulated requester")
        if self.origin.kind == "authenticated-user" and (self.lifecycle.notification.request is not None or self.lifecycle.notification.result is not None):
            raise ValueError("User commands have no simulated request publication or requester-result wake")
        if self.cancel.preview is not None and self.cancel.preview.impact.requestStatus != self.status:
            raise ValueError("Cancellation quote belongs to its actual original request status")
        if self.status != self.lifecycle.request.status:
            raise ValueError("Request track must match its original case filter status")
        business = self.lifecycle.execution.business.status
        if (business == "none" and self.status in {"committed", "rejected", "cancelled"}) or (business != "none" and business != self.status):
            raise ValueError("Business track requires the original terminal result")
        return self

    def is_hiring(self) -> bool:
        """Recognize only the exact built-in hiring selector for domain-specific payloads."""
        return (self.domain, self.operation, self.version) == ("organization", "generate-and-hire", "1")


    @model_serializer(mode="wrap")
    def _original_requester(self, handler):
        value = handler(self)
        if self.requesterEntityId is None:
            value["requesterEntityId"] = None
        return value


class SimulationWorldCasesInput(CaseModel):
    """Owned run, revision fence, finite filter and authenticated continuation."""
    runId: Identity
    status: CaseStatus | None = None
    expectedRevision: ObservationCount | None = None
    cursor: Identity | None = None
    limit: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)] | None = None


class SimulationWorldCasesPage(CaseModel):
    """Bounded metadata at one Native revision and read-policy lifetime."""
    runId: Identity
    snapshotRevision: ObservationCount
    readVersion: Identity
    observedAt: ObservationCount
    total: ObservationCount
    items: list[SimulationWorldCaseSummary]
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationWorldCasesPage:
        if any(row.businessSummary.status == "allowed" and row.businessSummary.value.nativeRevision != self.snapshotRevision for row in self.items):
            raise ValueError("Business summaries must retain their page Native revision")
        if any(row.cancel.preview is not None and row.cancel.preview.snapshotRevision != self.snapshotRevision for row in self.items):
            raise ValueError("Cancellation quotes must retain the displayed Native prefix")
        if self.total < len(self.items) or len({row.requestId for row in self.items}) != len(self.items):
            raise ValueError("Case pages require distinct original requests and an inclusive total")
        return self


class SimulationWorldCaseInput(CaseModel):
    """Independent case section; old read-policy selectors cannot disclose current private bodies."""
    runId: Identity
    requestId: Identity
    section: CaseSection
    expectedRevision: ObservationCount | None = None
    readVersion: Identity | None = None
    cursor: Identity | None = None
    limit: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)] | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationWorldCaseInput:
        if self.section != "plans" and self.cursor is not None:
            raise ValueError("Only plans admit a detail continuation")
        return self


class CaseBodyWithheld(CaseModel):
    status: Literal["withheld"]


class CaseBodyAllowed(CaseModel):
    status: Literal["allowed"]
    text: SimulationText


CaseBody = Annotated[CaseBodyWithheld | CaseBodyAllowed, Field(discriminator="status")]


class CasePersonaWithheld(CaseModel):
    status: Literal["withheld", "not-applicable"]


class CasePersonaAllowed(CaseModel):
    status: Literal["allowed"]
    templateId: SimulationText
    templateVersion: SimulationText
    name: SimulationText
    skills: list[SimulationText]
    traits: list[SimulationText]
    goals: list[SimulationText]


CasePersona = Annotated[CasePersonaWithheld | CasePersonaAllowed, Field(discriminator="status")]


class CasePlanStale(CaseModel):
    phase: Literal["acceptance", "execution"]
    reason: Literal["read-set-changed", "authority-unavailable"]
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]


class CasePlan(CaseModel):
    id: Identity
    operationId: Identity | None
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    hash: Identity
    predecessor: Identity | None
    status: Literal["accepted", "stale"]
    resolution: Literal["apply", "reject", "awaiting-evidence"]
    stale: CasePlanStale | None = None
    rationale: CaseBody
    persona: CasePersona

    @model_serializer(mode="wrap")
    def _required_predecessor(self, handler):
        value = handler(self)
        if self.predecessor is None:
            value["predecessor"] = None
        if self.operationId is None:
            value["operationId"] = None
        return value


    @model_validator(mode="after")
    def _validate(self) -> CasePlan:
        if (self.status == "stale") != (self.stale is not None):
            raise ValueError("Only stale plans carry their original invalidation evidence")
        if self.stale is not None and self.stale.sequence < self.sequence:
            raise ValueError("Invalidation cannot precede its original plan")
        if self.resolution != "apply" and self.persona.status != "not-applicable":
            raise ValueError("Only apply plans may describe a generated Persona")
        return self


class CasePlanSource(CaseModel):
    kind: Literal["plan"]
    planId: Identity


class CaseCancelSource(CaseModel):
    kind: Literal["cancel"]
    commandId: Identity


class CaseEvidenceDeadlineSource(CaseModel):
    kind: Literal["evidence-deadline"]
    challengeId: Identity
    eventId: Identity


class CaseEvidenceExhaustedSource(CaseModel):
    kind: Literal["evidence-exhausted"]
    challengeId: Identity
    decisionId: Identity


class CaseCommitted(CaseModel):
    kind: Literal["committed"]


class CaseHireCommittedPayload(CaseModel):
    """Hiring identities are business payload, independently verified against the original reservation."""
    entityId: Identity
    relationId: Identity


class CaseRejected(CaseModel):
    kind: Literal["rejected"]
    reason: Literal["insufficient-information", "unauthorized", "capacity-full", "unsupported", "policy"]


class CaseCancelled(CaseModel):
    kind: Literal["cancelled"]


class CaseResult(CaseModel):
    """Common terminal disposition with JSON business data; the core outcome carries no hiring identities."""
    id: Identity
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    time: Decimal
    source: Annotated[CasePlanSource | CaseCancelSource | CaseEvidenceDeadlineSource | CaseEvidenceExhaustedSource, Field(discriminator="kind")]
    outcome: Annotated[CaseCommitted | CaseRejected | CaseCancelled, Field(discriminator="kind")]
    payload: JsonValue

    @model_serializer(mode="wrap")
    def _required_payload(self, handler):
        value = handler(self)
        if self.payload is None:
            value["payload"] = None
        return value

    @field_validator("payload")
    @classmethod
    def _json_payload(cls, value: JsonValue) -> JsonValue:
        """Reject non-finite numbers, including nested values, which cannot be represented in JSON."""
        try:
            json.dumps(value, allow_nan=False)
        except (TypeError, ValueError) as cause:
            raise ValueError("World result payload must contain only JSON values") from cause
        return value

    @model_validator(mode="after")
    def _validate(self) -> CaseResult:
        if (self.source.kind == "cancel") != (self.outcome.kind == "cancelled"):
            raise ValueError("Cancelled results require their original cancellation source")
        if self.source.kind in {"evidence-deadline", "evidence-exhausted"} and (self.outcome.kind != "rejected" or self.outcome.reason != "insufficient-information"):
            raise ValueError("Evidence terminal results require an insufficient-information rejection")
        return self


class CasePost(CaseModel):
    operationId: Identity
    status: Literal["pending", "applied", "rejected", "blocked-authority", "blocked-dependency", "outcome-unknown"]
    publication: Literal["unpublished", "in-flight", "unknown", "published"]
    delivery: Literal["not-received", "received"]
    channelId: Identity
    envelopeId: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> CasePost:
        if (self.publication == "published") != (self.envelopeId is not None) or self.delivery == "received" and self.publication != "published":
            raise ValueError("Delivery requires the original publication receipt")
        return self


class CaseWake(CaseModel):
    id: Identity
    status: Literal["scheduled", "pending", "claimed", "completed", "cancelled", "absent"]
    decisionId: Identity | None = None


class CaseRequestSource(CaseModel):
    kind: Literal["decision"]
    operationId: Identity
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    payloadHash: Identity


class CaseUserRequestSource(CaseModel):
    kind: Literal["authenticated-user"]
    commandId: ManagementCommandId
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    payloadHash: Identity


CaseOriginalSource = Annotated[CaseRequestSource | CaseUserRequestSource, Field(discriminator="kind")]


class CaseEvidenceField(CaseModel):
    code: Identity
    description: SimulationText


class CaseEvidenceChallenge(CaseModel):
    id: Identity
    status: Literal["awaiting", "answered", "expired", "exhausted", "cancelled"]
    round: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    fields: Annotated[list[CaseEvidenceField], Field(min_length=1)]
    responders: Annotated[list[Identity], Field(min_length=1)]
    deadline: Decimal
    maxAttempts: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    attemptsUsed: ObservationCount

    @model_validator(mode="after")
    def _original_bounds(self):
        if len({item.code for item in self.fields}) != len(self.fields) or len(set(self.responders)) != len(self.responders):
            raise ValueError("Evidence fields and responders must be distinct")
        if self.attemptsUsed > self.maxAttempts:
            raise ValueError("Evidence attempts exceed the original challenge bound")
        return self


class CaseEvidenceAnswer(CaseModel):
    field: Identity
    text: SimulationText


class CaseEvidenceAnswersAllowed(CaseModel):
    status: Literal["allowed"]
    items: Annotated[list[CaseEvidenceAnswer], Field(min_length=1)]

    @model_validator(mode="after")
    def _distinct(self):
        if len({item.field for item in self.items}) != len(self.items):
            raise ValueError("Answer fields must be distinct")
        return self


class CaseEvidenceAnswersWithheld(CaseModel):
    status: Literal["withheld"]


class CaseEvidenceRevision(CaseModel):
    id: Identity
    revision: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    actorId: Identity
    answers: Annotated[CaseEvidenceAnswersAllowed | CaseEvidenceAnswersWithheld, Field(discriminator="status")]


class CaseEvidence(CaseModel):
    """Only the latest challenge and revision; answer prose has an independent disclosure decision."""
    inputRevision: ObservationCount
    latestChallenge: CaseEvidenceChallenge | None = None
    latestRevision: CaseEvidenceRevision | None = None

    @model_validator(mode="before")
    @classmethod
    def _optional_records(cls, value):
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ["latestChallenge", "latestRevision"]):
            raise ValueError("Optional evidence records must be omitted rather than null")
        return value

    @model_validator(mode="after")
    def _revision(self):
        if self.inputRevision != (self.latestRevision.revision if self.latestRevision is not None else 0):
            raise ValueError("Input revision must name the latest retained answer")
        return self


class CaseRequestDetail(CaseModel):
    section: Literal["request"]
    summary: SimulationWorldCaseSummary
    source: CaseOriginalSource
    description: CaseBody
    evidence: CaseEvidence | None = None

    @model_validator(mode="before")
    @classmethod
    def _optional_evidence(cls, value):
        if isinstance(value, dict) and "evidence" in value and value["evidence"] is None:
            raise ValueError("Optional evidence must be omitted rather than null")
        return value


    @model_validator(mode="after")
    def _provenance(self) -> CaseRequestDetail:
        if self.source.kind != self.summary.origin.kind or (self.source.kind == "authenticated-user" and self.source.commandId != self.summary.origin.commandId):
            raise ValueError("Request provenance must match its original summary")
        return self


class CasePlansDetail(CaseModel):
    section: Literal["plans"]
    summary: SimulationWorldCaseSummary
    total: ObservationCount
    items: list[CasePlan]
    nextCursor: Identity | None = None

    @model_validator(mode="after")
    def _validate(self) -> CasePlansDetail:
        if any((item.operationId is None) != (self.summary.origin.kind == "authenticated-user") for item in self.items):
            raise ValueError("User plans have no fabricated model operation")
        if (self.total == 0) != (self.summary.lifecycle.plan.status == "none"):
            raise ValueError("Only an empty original plan history has no current plan")
        if self.nextCursor is None and self.total:
            latest = self.items[-1] if self.items else None
            current = self.summary.lifecycle.plan
            if (latest is None or current.status == "none" or
                    (latest.id, latest.status, latest.resolution) != (current.id, current.status, current.resolution)):
                raise ValueError("The final plan page must end at its original current plan")
        if self.total < len(self.items) or len({row.id for row in self.items}) != len(self.items):
            raise ValueError("Plan pages require distinct original plans and an inclusive total")
        if any((self.summary.is_hiring() and plan.resolution == "apply") != (plan.persona.status != "not-applicable")
               for plan in self.items):
            raise ValueError("Only an exact hiring apply plan owns a Persona")
        return self


class CaseNewborn(CaseModel):
    entityId: Identity
    readiness: Literal["absent", "preparing", "ready", "abandoned"]
    phase: Literal["absent", "active", "inactive", "terminated"]


class CaseAssignment(CaseModel):
    relationId: Identity
    status: Literal["absent", "retained"]


class CaseCleanup(CaseModel):
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    participant: Literal["absent", "left", "failed"]


class CaseReservation(CaseModel):
    id: Identity
    planId: Identity
    status: Literal["reserved", "preparing", "candidate", "cancel-requested", "committed", "abandoned"]
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    updatedSequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    newborn: CaseNewborn
    assignment: CaseAssignment
    cleanup: CaseCleanup | None = None


class CasePersonnelResponsibility(CaseModel):
    """Original personnel duty; blocked does not mean rejected or safely retryable."""
    kind: Literal["personnel"]
    id: Identity
    planId: Identity
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    updatedSequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    status: Literal["reserved", "fenced", "ready", "blocked", "cancel-requested", "cancelled", "committed"]


class CaseRepresentativeResponsibility(CaseModel):
    """Original representative preparation, which later contacts may share."""
    kind: Literal["representative"]
    id: Identity
    planId: Identity
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    updatedSequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    status: Literal["reserved", "preparing", "committed", "cancel-requested", "abandoned"]


class CaseContactResponsibility(CaseModel):
    """This case's contact duty is independent of shared representative preparation."""
    kind: Literal["contact"]
    id: Identity
    planId: Identity
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    updatedSequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    status: Literal["reserved", "committed", "cancel-requested", "cancelled"]


CaseResponsibility = Annotated[CasePersonnelResponsibility | CaseRepresentativeResponsibility | CaseContactResponsibility,
                               Field(discriminator="kind")]


WorldExecutionReason = Literal[
    'until',
    'work-limit',
    'decision-required',
    'paused',
    'stalled',
    'retry',
    'outcome-unknown',
    'recipient-required',
    'recipient-busy',
    'coordination-limit',
    'resident-capacity',
    'residency-recovery-required',
    'idle',
    'recovery-required',
    'maintenance-blocked',
    'position-capacity',
    'authority-missing',
    'approval-required',
    'existing-obligations',
    'plan-stale',
    'plan-budget',
    'entity-capacity',
    'identity-capacity',
    'channel-capacity',
    'world-byte-limit',
    'world-request-limit',
    'world-command-limit',
    'world-birth-limit',
    'world-expansion-limit',
    'world-mutation-limit',
    'budget-limit',
    'context-limit',
    'microstep-limit',
    'model-pool-capacity',
    'activation-history-limit',
    'message-byte-limit',
    'stale-time',
    'waiting-effective-time',
    'handoff-required',
    'retirement-unknown',
    'resource-capacity',
    'resource-history-limit',
    'resource-reservation-expired',
    'callback-unconfirmed',
    'implementation-unavailable',
]


class CaseExecutionObservation(CaseModel):
    """Original callback observation; uncertain work requires reconciliation, not a new execution."""
    planId: Identity
    mode: Literal["execute", "reconcile"]
    sequence: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    updates: Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
    time: Decimal
    status: Literal["settled", "blocked", "outcome-unknown"]
    reason: WorldExecutionReason | None

    @model_serializer(mode="wrap")
    def _required_reason(self, handler):
        value = handler(self)
        value["reason"] = self.reason
        return value

    @model_validator(mode="after")
    def _validate(self) -> CaseExecutionObservation:
        if (self.status == "settled") != (self.reason is None):
            raise ValueError("Only confirmed callback settlement omits a reason")
        return self


class CaseExecutionDetail(CaseModel):
    section: Literal["execution"]
    summary: SimulationWorldCaseSummary
    observation: CaseExecutionObservation | None = None
    reservation: CaseReservation | None = None
    result: CaseResult | None = None
    responsibilities: Annotated[list[CaseResponsibility], Field(min_length=1, max_length=2)] | None = None

    @model_validator(mode="after")
    def _validate(self) -> CaseExecutionDetail:
        reservation, result = self.reservation, self.result
        callback = self.observation.model_dump(exclude_none=True) if self.observation is not None else {"status": "none"}
        if callback != self.summary.lifecycle.execution.callback.model_dump(exclude_none=True):
            raise ValueError("Callback detail differs from its same-prefix lifecycle track")
        business = {"status": "none"} if result is None else {"status": result.outcome.kind, "resultId": result.id}
        if business != self.summary.lifecycle.execution.business.model_dump(exclude_none=True):
            raise ValueError("Business detail differs from its same-prefix lifecycle track")
        duties = self.responsibilities or []
        if len({duty.kind for duty in duties}) != len(duties):
            raise ValueError("Responsibilities require distinct original kinds")
        for duty in duties:
            selector = (self.summary.domain, self.summary.operation, self.summary.version)
            allowed = (("organization", "transfer", "1"), ("organization", "depart", "1")) if duty.kind == "personnel" else (
                ("external", "interact", "2"), ("external", "interact", "3"))
            if selector not in allowed or duty.updatedSequence < duty.sequence or (
                    duty.kind != "representative" and duty.id != self.summary.intentId):
                raise ValueError("Responsibility changed original owner, selector or sequence order")
            if duty.kind != "representative" and (
                    (duty.status == "committed") != (result is not None and result.outcome.kind == "committed") or
                    (duty.status == "cancelled") != (result is not None and result.outcome.kind == "cancelled")):
                raise ValueError("Original case duty and business settlement must agree")
        if result is not None and self.summary.status != result.outcome.kind:
            raise ValueError("Terminal result differs from its original case status")
        if reservation is None:
            if self.summary.is_hiring() and result is not None and result.outcome.kind == "committed":
                raise ValueError("A committed hiring case retains its actual hiring reservation")
            return self
        if not self.summary.is_hiring():
            raise ValueError("Only an exact hiring case owns a hiring reservation")
        if reservation.id != self.summary.intentId or reservation.updatedSequence < reservation.sequence:
            raise ValueError("Reservation belongs to another intent or reverses its transition order")
        cleanup = reservation.cleanup
        if cleanup is not None and (reservation.status != "abandoned" or cleanup.sequence != reservation.updatedSequence
                or cleanup.sequence <= reservation.sequence or reservation.newborn.phase != "terminated"
                or reservation.newborn.readiness != "abandoned" or reservation.assignment.status != "absent"):
            raise ValueError("Cleanup belongs to its original abandonment transition")
        committed = result is not None and result.outcome.kind == "committed"
        if (reservation.status == "committed") != committed:
            raise ValueError("Committed reservation and business outcome must settle together")
        if committed:
            payload = CaseHireCommittedPayload.model_validate(result.payload)
            if (result.source.kind != "plan" or result.source.planId != reservation.planId
                    or payload.entityId != reservation.newborn.entityId or payload.relationId != reservation.assignment.relationId
                    or result.sequence != reservation.updatedSequence or reservation.newborn.readiness != "ready"
                    or reservation.newborn.phase == "absent" or reservation.assignment.status != "retained"):
                raise ValueError("Committed result lost its original plan, newborn or assignment")
        return self


class CaseResultNotification(CaseModel):
    resultId: Identity
    wake: CaseWake
    post: CasePost | None = None


class CaseFirstAction(CaseModel):
    wake: CaseWake
    post: CasePost | None = None


class CaseNotificationLifecycle(CaseModel):
    """Receipt, delivery and wake consumption are original independent facts."""
    request: CasePost | None
    result: CaseResultNotification | None = None
    firstAction: CaseFirstAction | None = None

    @model_serializer(mode="wrap")
    def _required_request(self, handler):
        value = handler(self)
        if self.request is None:
            value["request"] = None
        return value


class CaseTrackNone(CaseModel):
    """No original observation or result; this is not a failure."""
    status: Literal["none"]


class CaseRequestTrack(CaseModel):
    status: CaseStatus


class CasePlanTrack(CaseModel):
    id: Identity
    status: Literal["accepted", "stale"]
    resolution: Literal["apply", "reject", "awaiting-evidence"]


class CaseBusinessTrack(CaseModel):
    status: Literal["committed", "rejected", "cancelled"]
    resultId: Identity


class CaseExecutionTrack(CaseModel):
    callback: Annotated[CaseTrackNone | CaseExecutionObservation, Field(discriminator="status")]
    business: Annotated[CaseTrackNone | CaseBusinessTrack, Field(discriminator="status")]


class CaseLifecycle(CaseModel):
    """Required four-layer metadata projected from a single authoritative Native prefix."""
    request: CaseRequestTrack
    plan: Annotated[CaseTrackNone | CasePlanTrack, Field(discriminator="status")]
    execution: CaseExecutionTrack
    notification: CaseNotificationLifecycle


class CaseNotificationDetail(CaseNotificationLifecycle):
    """The same original notification facts are shared by summary and detail."""
    section: Literal["notification"]
    summary: SimulationWorldCaseSummary

    @model_validator(mode="after")
    def _same_notification(self) -> CaseNotificationDetail:
        current = self.model_dump(exclude_none=True)
        current.pop("section")
        current.pop("summary")
        if current != self.summary.lifecycle.notification.model_dump(exclude_none=True):
            raise ValueError("Notification detail differs from its same-prefix lifecycle track")
        return self


class SimulationWorldCaseInspection(CaseModel):
    """Four strict sections retain the original case identity and independent disclosure state."""
    runId: Identity
    requestId: Identity
    section: CaseSection
    snapshotRevision: ObservationCount
    readVersion: Identity
    observedAt: ObservationCount
    status: Literal["found", "missing"]
    value: Annotated[CaseRequestDetail | CasePlansDetail | CaseExecutionDetail | CaseNotificationDetail,
                     Field(discriminator="section")] | None = None

    @model_validator(mode="after")
    def _validate(self) -> SimulationWorldCaseInspection:
        if (self.status == "found") != (self.value is not None):
            raise ValueError("Only found cases carry their selected detail")
        if self.value is not None and (self.value.section != self.section or self.value.summary.requestId != self.requestId):
            raise ValueError("Detail belongs to another original case or section")
        if self.value is not None and self.value.summary.businessSummary.status == "allowed" and self.value.summary.businessSummary.value.nativeRevision != self.snapshotRevision:
            raise ValueError("Business summary must retain its detail Native revision")
        if self.value is not None and self.value.summary.cancel.preview is not None and self.value.summary.cancel.preview.snapshotRevision != self.snapshotRevision:
            raise ValueError("Cancellation quote must retain the displayed Native prefix")
        return self


# Summary appears before its notification dependencies; resolve only after the complete DTO graph exists.
SimulationWorldCaseSummary.model_rebuild()
