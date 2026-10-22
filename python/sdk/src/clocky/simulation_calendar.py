"""Exact finite calendar quotes and retryable Native commands; no implicit timezone or inference."""
from typing import Annotated, Literal
from pydantic import Field, model_validator
from .simulation_base import SimulationModel, Identity, Decimal, PositiveDecimal, ObservationCount
from .simulation_calendar_base import WorldCalendarRecurrence, WorldCivilCalendar

Positive = Annotated[int, Field(gt=0, le=9007199254740991)]
Hash = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]

class CalendarPerson(SimulationModel):
    """Original canonical actor target."""
    kind: Literal["person"]
    personId: Identity

class CalendarPosition(SimulationModel):
    """Position resolves its actual recipient only when the event fires."""
    kind: Literal["position"]
    positionId: Identity

class CalendarRule(SimulationModel):
    """A finite Native calendar rule with immutable historical predecessors."""
    id: Annotated[str, Field(min_length=1, max_length=256)]
    target: Annotated[CalendarPerson | CalendarPosition, Field(discriminator="kind")]
    body: Identity
    startsAt: Decimal
    endsAt: Decimal | None
    period: PositiveDecimal
    maxOccurrences: Positive
    recurrence: WorldCalendarRecurrence | None = None
    civil: WorldCivilCalendar | None = None
    priority: Annotated[int, Field(ge=-1000, le=1000)] | None = None

    @model_validator(mode="after")
    def _interval(self):
        if self.recurrence is not None and self.civil is not None:
            raise ValueError("Calendar must select exactly one recurrence clock")
        if self.endsAt is not None and int(self.endsAt) < int(self.startsAt):
            raise ValueError("Calendar end cannot precede start")
        return self

class CalendarRevisionRequest(SimulationModel):
    """The exact original command ID and expected current rule version."""
    commandId: Annotated[str, Field(min_length=1, max_length=256)]
    expectedRuleRevision: Positive
    calendar: CalendarRule

class SimulationCalendarInput(SimulationModel):
    """Owned run plus complete replacement command."""
    runId: Identity
    request: CalendarRevisionRequest

class CalendarQueuedEvent(SimulationModel):
    """One newly queued original event; the remainder stays bounded and lazy."""
    id: str
    time: Decimal

class SimulationCalendarPreview(SimulationModel):
    """Inert quote committed to the complete command and Native revision."""
    input: SimulationCalendarInput
    revision: ObservationCount
    previewHash: Hash
    cancelled: list[str]
    queued: list[CalendarQueuedEvent]

class SimulationCalendarSubmit(SimulationModel):
    """Submit the exact unchanged quote; timeout retries retain this same input."""
    input: SimulationCalendarInput
    revision: ObservationCount
    previewHash: Hash

class SimulationCalendarReceipt(SimulationModel):
    """Original durable accepted rule revision and append cursor."""
    runId: Identity
    commandId: Identity
    revision: ObservationCount
    ruleRevision: Positive
    sequence: Positive

class SimulationCalendarCommandInput(SimulationModel):
    """Recover one exact original command or the author's latest unresolved intent."""
    runId: Identity
    commandId: Annotated[str, Field(min_length=1, max_length=256)] | None = None

class SimulationCalendarCancel(SimulationModel):
    """Cancel only an original retained command, never an already applied schedule."""
    runId: Identity
    commandId: Annotated[str, Field(min_length=1, max_length=256)]

class SimulationCalendarCommandView(SimulationModel):
    """Original exact quote and independent Native outcome."""
    preview: SimulationCalendarPreview
    status: Literal['retained', 'applied', 'cancelled']
    retainedSequence: Positive
    receipt: SimulationCalendarReceipt | None

    @model_validator(mode='after')
    def _original_outcome(self):
        if (self.status == 'applied') != (self.receipt is not None):
            raise ValueError('Calendar outcome requires its actual application receipt')
        if self.receipt is not None and (self.receipt.runId != self.preview.input.runId
                or self.receipt.commandId != self.preview.input.request.commandId
                or self.receipt.ruleRevision != self.preview.input.request.expectedRuleRevision + 1):
            raise ValueError('Calendar receipt belongs to another original quote')
        return self

class SimulationCalendarCommandResult(SimulationModel):
    """Unavailable and unauthorized original identities both return null."""
    command: SimulationCalendarCommandView | None
