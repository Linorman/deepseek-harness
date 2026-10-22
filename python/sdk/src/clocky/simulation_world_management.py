"""Strict human management forms and original receipts; user identity and execution authority stay Host-owned."""
from __future__ import annotations

import json
from typing import Annotated, Literal
from pydantic import AfterValidator, ConfigDict, Field, RootModel, model_validator, model_serializer
from .simulation_base import (SimulationModel, SimulationText, Identity, ManagementCommandId, Decimal,
    PositiveDecimal, ObservationCount, utf16_code_units, canonical_javascript_string)
from .simulation_world_domain import WorldCoverage, WorldObligation
from .simulation_world_cases import WorldExecutionReason

Hash = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]
Positive = Annotated[int, Field(ge=1, le=9_007_199_254_740_991)]
ManagementAction = Literal["transfer", "depart", "hire-existing", "hiring-market"]
# ECMAScript String.trim() WhiteSpace and LineTerminator; Python str.strip() has a different set.
_JS_TRIM_CHARACTERS = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def _management_reason(value: str) -> str:
    """Validate this family's original description with the public TypeScript owner's exact rules."""
    if utf16_code_units(value) > 65_536:
        raise ValueError("Management description exceeds 65536 UTF-16 code units")
    if not value.strip(_JS_TRIM_CHARACTERS):
        raise ValueError("Management description cannot be blank")
    return canonical_javascript_string(value)


# The validator owns non-emptiness too: Pydantic string-length constraints reject lone UTF-16 surrogates accepted by JS.
Reason = Annotated[str, AfterValidator(_management_reason)]


class ManagementModel(SimulationModel):
    """Optional wire fields are absent; required nullable facts retain null in wire dumps."""
    model_config = ConfigDict(extra="forbid", strict=True, serialize_by_alias=True)

    @model_validator(mode="before")
    @classmethod
    def _optional_absence(cls, value):
        if isinstance(value, dict):
            for name, field in cls.model_fields.items():
                key = field.alias or name
                if key in value and value[key] is None and not field.is_required():
                    raise ValueError(f"Optional {key} must be absent rather than null")
        return value

    @model_serializer(mode="wrap")
    def _required_nulls(self, handler):
        value = handler(self)
        for name, field in type(self).model_fields.items():
            if field.is_required() and getattr(self, name) is None:
                value[field.alias or name] = None
        return value


class ManagementAssignmentValues(ManagementModel):
    assignmentId: Identity
    effective: Literal["boundary", "at"]
    at: Decimal | None = None
    reason: Reason

    @model_validator(mode="after")
    def _choices(self):
        if self.effective == "at" and self.at is None:
            raise ValueError("A precise effective time is required for the selected at-time choice")
        return self


class ManagementTransferValues(ManagementAssignmentValues):
    position: Identity


class ManagementDepartValues(ManagementAssignmentValues):
    retire: Literal["yes", "no"]


class ManagementHireExistingValues(ManagementModel):
    position: Identity
    reason: Reason


class ManagementTransferDraft(ManagementModel):
    runId: Identity
    targetId: Identity
    expectedRevision: ObservationCount
    action: Literal["transfer"]
    values: ManagementTransferValues


class ManagementDepartDraft(ManagementModel):
    runId: Identity
    targetId: Identity
    expectedRevision: ObservationCount
    action: Literal["depart"]
    values: ManagementDepartValues


class ManagementHireExistingDraft(ManagementModel):
    runId: Identity
    targetId: Identity
    expectedRevision: ObservationCount
    action: Literal["hire-existing"]
    values: ManagementHireExistingValues


class ManagementPersonaValues(ManagementModel):
    command: str

    @model_validator(mode="after")
    def _command_bytes(self):
        if not self.command or utf16_code_units(self.command) > 65536:
            raise ValueError("Persona command must contain 1–65536 UTF-16 code units")
        return self


class ManagementPersonaDraft(ManagementModel):
    runId: Identity
    targetId: Identity
    expectedRevision: ObservationCount
    action: Literal["hiring-market"]
    values: ManagementPersonaValues


class SimulationWorldManagementDraft(RootModel[Annotated[
    ManagementTransferDraft | ManagementDepartDraft | ManagementHireExistingDraft | ManagementPersonaDraft, Field(discriminator="action")
]]):
    """Exact original choices; inactive retained values are still part of command identity."""
    model_config = ConfigDict(strict=True)

    @property
    def runId(self) -> str:
        return self.root.runId

    @property
    def targetId(self) -> str:
        return self.root.targetId

    @property
    def expectedRevision(self) -> int:
        return self.root.expectedRevision

    @property
    def action(self) -> ManagementAction:
        return self.root.action


class SimulationWorldManagementFieldsInput(ManagementModel):
    """Read form metadata for one exact run, action and actual person."""
    runId: Identity
    action: ManagementAction
    targetId: Identity


class ManagementChoiceOption(ManagementModel):
    id: Identity
    label: str


class ManagementChoiceField(ManagementModel):
    id: Identity
    kind: Literal["choice"]
    required: bool
    options: list[ManagementChoiceOption]


class ManagementTimeField(ManagementModel):
    id: Identity
    kind: Literal["time"]
    required: bool


class ManagementTextField(ManagementModel):
    id: Identity
    kind: Literal["text"]
    required: bool
    maxBytes: Positive


class ManagementPersonaTemplate(ManagementModel):
    id: Identity
    version: Identity
    names: Annotated[list[Identity], Field(min_length=1)]
    skills: list[Identity]
    traits: list[Identity]
    goals: list[Identity]
    description: Identity


class ManagementPersonaField(ManagementModel):
    id: Literal["command"]
    kind: Literal["persona"]
    required: Literal[True]
    maxBytes: Positive
    organizationEntityId: Identity
    positionEntityId: Identity
    now: Decimal
    maxTime: Decimal
    maxRevisions: Literal[16]
    templates: Annotated[list[ManagementPersonaTemplate], Field(min_length=1)]


class SimulationWorldManagementFields(SimulationWorldManagementFieldsInput):
    """Actual finite form choices; unavailability does not resemble an empty allowed operation."""
    apiVersion: Literal["clocky.world-management/v1"]
    snapshotRevision: ObservationCount
    targetRevision: ObservationCount
    status: Literal["available", "unavailable"]
    reason: Identity | None = None
    fields: list[Annotated[ManagementChoiceField | ManagementTimeField | ManagementTextField | ManagementPersonaField, Field(discriminator="kind")]]

    @model_validator(mode="after")
    def _fields(self):
        if (self.status == "unavailable") != (self.reason is not None) or self.targetRevision > self.snapshotRevision:
            raise ValueError("Management fields require their actual revision and explicit availability")
        if len({field.id for field in self.fields}) != len(self.fields):
            raise ValueError("Management fields must be distinct")
        expected = ({"assignmentId", "position", "effective", "at", "reason"} if self.action == "transfer"
                    else {"assignmentId", "effective", "at", "retire", "reason"} if self.action == "depart"
                    else {"command"} if self.action == "hiring-market" else {"position", "reason"})
        if {field.id for field in self.fields} != expected:
            raise ValueError("Management field metadata must describe the complete installed form")
        for field in self.fields:
            kind = "persona" if self.action == "hiring-market" else "time" if field.id == "at" else "text" if field.id == "reason" else "choice"
            if field.kind != kind or field.required != (field.id != "at"):
                raise ValueError("Management field metadata must retain its exact kind and requirement")
            if isinstance(field, ManagementChoiceField):
                if len({option.id for option in field.options}) != len(field.options):
                    raise ValueError("Management choices must be distinct")
                if self.status == "available" and field.required and not field.options:
                    raise ValueError("A required available choice must have actual options")
        return self


class ManagementTransferImpact(ManagementModel):
    kind: Literal["transfer"]
    personId: Identity
    organizationEntityId: Identity
    authorityRelationIds: list[Identity]
    assignmentId: Identity
    assignmentRevision: Positive
    previousPositionId: Identity
    targetPositionId: Identity
    requestedEffectiveAt: Decimal | None


class ManagementDepartImpact(ManagementModel):
    kind: Literal["depart"]
    personId: Identity
    organizationEntityId: Identity
    authorityRelationIds: list[Identity]
    assignmentId: Identity
    assignmentRevision: Positive
    previousPositionId: Identity
    requestedEffectiveAt: Decimal | None
    retire: bool


class ManagementHireExistingImpact(ManagementModel):
    kind: Literal["hire-existing"]
    personId: Identity
    organizationEntityId: Identity
    authorityRelationIds: list[Identity]
    targetPositionId: Identity


class ManagementPersonaImpact(ManagementModel):
    kind: Literal["hiring-market"]
    organizationEntityId: Identity
    targetPositionId: Identity
    draftId: Identity
    draftRevision: ObservationCount


ManagementImpact = Annotated[ManagementTransferImpact | ManagementDepartImpact | ManagementHireExistingImpact | ManagementPersonaImpact, Field(discriminator="kind")]


def _hiring_fee_policy_id(value: str) -> str:
    """Retain the hiring policy owner's 256 UTF-16-unit limit after the common identity parser."""
    if utf16_code_units(value) > 256:
        raise ValueError("Hiring fee policy identity exceeds 256 UTF-16 code units")
    return value


class ManagementHiringFee(ManagementModel):
    """Exact frozen Native fee terms; there is no browser-selected payer or price."""
    id: Annotated[Identity, AfterValidator(_hiring_fee_policy_id)]
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
    def _fee(self):
        if self.from_ == self.to or len(set(self.grants)) != len(self.grants):
            raise ValueError("Hiring fee requires distinct accounts and grants")
        return self


class SimulationWorldManagementPreview(ManagementModel):
    """Inert actual impacts and obligations under one confirmed Native prefix."""
    apiVersion: Literal["clocky.world-management/v1"]
    input: SimulationWorldManagementDraft
    runId: Identity
    revision: ObservationCount
    snapshotRevision: ObservationCount
    previewHash: Hash
    sourceFingerprint: Hash
    admission: Literal["allowed", "blocked"]
    blockers: list[WorldExecutionReason]
    settlementRequirements: list[WorldExecutionReason]
    impact: ManagementImpact | None
    hiringFee: ManagementHiringFee | None
    impacts: list[SimulationText]
    obligations: list[WorldObligation]
    coverage: WorldCoverage

    @model_validator(mode="after")
    def _original(self):
        if self.runId != self.input.runId or self.revision != self.input.expectedRevision or self.snapshotRevision != self.coverage.revision or self.coverage.loaded != len(self.obligations):
            raise ValueError("Management preview differs from its original run, target revision or source coverage")
        if (self.admission == "allowed") != (len(self.blockers) == 0):
            raise ValueError("Management admission must match the actual blocker set")
        impact, draft = self.impact, self.input.root
        if self.admission == "allowed" and (not self.coverage.complete or impact is None):
            raise ValueError("Admitted management requires complete sources and actual impacts")
        if impact is None:
            return self
        if draft.action == "hiring-market":
            command = json.loads(draft.values.command)
            if impact.kind != "hiring-market" or impact.targetPositionId != draft.targetId or impact.draftId != command.get("id") or self.hiringFee is not None:
                raise ValueError("Persona review impact must retain its exact draft and position")
            return self
        if impact.kind == "hiring-market":
            raise ValueError("Persona review impact cannot authorize a personnel action")
        if impact.personId != draft.targetId or impact.kind != draft.action:
            raise ValueError("Management impact belongs to a different person or action")
        if draft.action == "hire-existing":
            if impact.targetPositionId != draft.values.position or self.hiringFee is not None and (
                    self.hiringFee.operation != "hire-existing" or self.hiringFee.positionEntityId != draft.values.position):
                raise ValueError("Hiring impact and fee must retain the original target position")
        else:
            if impact.assignmentId != draft.values.assignmentId or self.hiringFee is not None:
                raise ValueError("Personnel impact must retain its original assignment without a hiring fee")
            if impact.requestedEffectiveAt != (draft.values.at if draft.values.effective == "at" else None):
                raise ValueError("Personnel impact differs from the original effective-time choice")
            if draft.action == "transfer" and impact.targetPositionId != draft.values.position:
                raise ValueError("Transfer impact differs from the original target position")
            if draft.action == "depart" and impact.retire != (draft.values.retire == "yes"):
                raise ValueError("Departure impact differs from the original retirement choice")
        return self


class SimulationWorldManagementSubmitInput(ManagementModel):
    """Immutable original public input, including the exact confirmed Native prefix and hash."""
    runId: Identity
    commandId: ManagementCommandId
    draft: SimulationWorldManagementDraft
    previewRevision: ObservationCount
    previewHash: Hash

    @model_validator(mode="after")
    def _original(self):
        if self.runId != self.draft.runId:
            raise ValueError("Original management selector must retain the same run")
        return self


class ManagementDomainPin(ManagementModel):
    domain: Identity
    operation: Identity
    version: Identity
    schemaRef: Identity
    implementationRef: Identity
    generation: Positive


class ManagementExecutionObservation(ManagementModel):
    """Exact Native callback observation; armed uncertainty is independent from a business result."""
    planId: Identity
    requestId: Identity
    intentId: Identity
    pin: ManagementDomainPin
    mode: Literal["execute", "reconcile"]
    expectedSequence: Positive | None
    sequence: Positive
    updates: Positive
    time: Decimal
    phase: Literal["armed", "settled", "blocked", "outcome-unknown"]
    reason: WorldExecutionReason | None

    @model_validator(mode="after")
    def _phase(self):
        if (self.phase in {"armed", "settled"}) != (self.reason is None):
            raise ValueError("Only armed or settled callback facts have a null reason")
        return self


class ManagementBusinessResult(ManagementModel):
    id: Identity
    status: Literal["committed", "rejected", "cancelled"]
    time: Decimal
    sequence: Positive


class SimulationWorldManagementOutcome(ManagementModel):
    """Original business IDs and independent callback/result metadata, without a principal or private payload."""
    commandId: ManagementCommandId
    runId: Identity
    acceptedSequence: Positive
    intentId: Identity
    requestId: Identity
    planId: Identity
    execution: ManagementExecutionObservation | None = None
    result: ManagementBusinessResult | None = None

    @model_validator(mode="after")
    def _original(self):
        if self.execution is not None and (self.execution.planId != self.planId or self.execution.requestId != self.requestId
                or self.execution.intentId != self.intentId or self.execution.sequence < self.acceptedSequence):
            raise ValueError("Callback must retain the exact original Native case and acceptance order")
        if self.result is not None and self.result.sequence < self.acceptedSequence:
            raise ValueError("Business result cannot precede its original acceptance")
        return self
