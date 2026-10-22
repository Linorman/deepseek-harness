"""Dependency-free calendar recurrence contract shared by scenario and inspection DTOs."""
from typing import Annotated, Literal
from pydantic import ConfigDict, Field, model_validator
from .simulation_base import SimulationModel, Decimal

class WorldCalendarRecurrence(SimulationModel):
    """Versioned simulated shifts; wall-clock timezone expressions are unsupported."""
    version: Literal[1]
    clock: Literal["simulation"]
    shifts: Annotated[list[Decimal], Field(min_length=1, max_length=64)]
    exceptions: Annotated[list[Decimal], Field(max_length=4096)]
    additions: Annotated[list[Decimal], Field(max_length=4096)]

    @model_validator(mode="after")
    def _distinct(self):
        if any(len(set(values)) != len(values) for values in [self.shifts, self.exceptions, self.additions]):
            raise ValueError("Calendar times must be distinct")
        return self


class WorldCivilCalendar(SimulationModel):
    """Explicit IANA data version and DST interpretation; conversion is performed by the installed Native artifact."""
    model_config = ConfigDict(extra='forbid', strict=True, serialize_by_alias=True)
    version: Literal[1]
    timeZone: Annotated[str, Field(min_length=1, max_length=128)]
    tzdbVersion: Annotated[str, Field(min_length=1, max_length=32)]
    disambiguation: Literal['reject', 'earlier', 'later']
    origin: Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')]
    tickMilliseconds: Annotated[int, Field(gt=0, le=86400000)]
    from_: Annotated[str, Field(alias='from', pattern=r'^\d{4}-\d{2}-\d{2}$')]
    until: Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}$')]
    weekdays: Annotated[list[Annotated[int, Field(ge=1, le=7)]], Field(min_length=1, max_length=7)]
    shifts: Annotated[list[Annotated[str, Field(pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$')]], Field(min_length=1, max_length=64)]
    exceptDates: Annotated[list[Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}$')]], Field(max_length=4096)]
    additions: Annotated[list[Annotated[str, Field(pattern=r'^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$')]], Field(max_length=4096)]

    @model_validator(mode='after')
    def _distinct(self):
        if any(len(set(values)) != len(values) for values in [self.weekdays, self.shifts, self.exceptDates, self.additions]):
            raise ValueError('Civil calendar selections must be distinct')
        return self
