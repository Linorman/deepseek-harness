"""Inert policy impact contracts contain original obligations and complete lazy calendar ranges."""
from typing import Annotated, Literal
from pydantic import Field, model_validator, model_serializer
from .simulation_base import SimulationModel, Identity, Decimal, ObservationCount
Positive = Annotated[int, Field(gt=0, le=9007199254740991)]

class ImpactModel(SimulationModel):
    """Required nullable fields remain present on the wire."""
    @model_serializer(mode='wrap')
    def _required_nulls(self, handler):
        value = handler(self)
        for name, field in type(self).model_fields.items():
            if field.is_required() and getattr(self, name) is None:
                value[field.alias or name] = None
        return value

class NormAdvisory(ImpactModel):
    kind: Literal['advisory']

class NormHiringParams(ImpactModel):
    committeeId: Identity
    positionIds: Annotated[list[Identity], Field(min_length=1)]
    maxHires: Positive
    @model_validator(mode='after')
    def _distinct(self):
        if len(set(self.positionIds)) != len(self.positionIds):
            raise ValueError('Hiring positions must be distinct')
        return self

class NormValidated(ImpactModel):
    kind: Literal['validated']
    policyRef: Literal['clocky.organization.hiring-approval/1']
    params: NormHiringParams

NormEnforcement = Annotated[NormAdvisory | NormValidated, Field(discriminator='kind')]

class SimulationNormImpactInput(ImpactModel):
    """Policy semantics only; this does not fabricate governance approval or publication."""
    normId: Identity
    scope: Identity
    effectiveFrom: Decimal
    effectiveUntil: Decimal | None
    enforcement: NormEnforcement
    impact: Literal['future-admissions', 'migrate-existing']

class CalendarSource(ImpactModel):
    kind: Literal['calendar']
    id: Identity
    revision: Annotated[int, Field(ge=2, le=9007199254740991)] | None = None

class FutureCalendar(ImpactModel):
    calendarId: Identity
    ruleRevision: Positive
    source: CalendarSource
    firstAt: Decimal
    lastAt: Decimal
    occurrences: Positive
    pendingEventIds: list[Identity]

class WorldCaseObligation(ImpactModel):
    kind: Literal['world-case']
    id: Identity
    sequence: Positive

class CommitmentObligation(ImpactModel):
    kind: Literal['commitment']
    id: Identity
    revision: Positive

class TaskObligation(ImpactModel):
    kind: Literal['task']
    id: Identity
    teamId: Identity
    revision: Positive

class NormPolicy(ImpactModel):
    id: Identity
    version: Identity
    enforcement: NormEnforcement

class NormPolicyCombination(ImpactModel):
    rule: Literal['all-applicable-hiring-approvals']
    policies: list[NormPolicy]

class ResourceHoldObligation(ImpactModel):
    kind: Literal['resource-hold']
    id: Identity
    revision: Positive

class OperationObligation(ImpactModel):
    kind: Literal['operation']
    id: Identity
    decisionId: Identity
    fingerprint: Identity

class WakeObligation(ImpactModel):
    kind: Literal['wake']
    id: Identity
    sequence: Positive

class SimulationNormImpact(ImpactModel):
    """Exact Native-prefix report, including future occurrences not yet queued."""
    revision: ObservationCount
    time: Decimal
    scope: Identity
    newOperations: list[Identity]
    futureCalendar: list[FutureCalendar]
    existingObligations: list[Annotated[WorldCaseObligation | CommitmentObligation | TaskObligation | ResourceHoldObligation | OperationObligation | WakeObligation, Field(discriminator='kind')]]
    existingObligationsPolicy: Literal['preserve-original']
    policyCombination: NormPolicyCombination
    blocked: Literal['existing-obligations-require-explicit-migration', 'unresolved-policy-conflict'] | None
