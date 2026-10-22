"""Controlled raw preservation never implies Native validation or a physical SQLite database copy."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import Field, model_validator
from .simulation_base import SimulationModel, Identity, ObservationCount

class SimulationRawArchiveInput(SimulationModel):
    runId: Identity
    limit: Annotated[int, Field(gt=0, le=9_007_199_254_740_991)] | None = None
    cursor: Identity | None = None

    @model_validator(mode="before")
    @classmethod
    def _absence(cls, value):
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ("limit", "cursor")):
            raise ValueError("Optional raw archive selections must be absent rather than null")
        return value

class SimulationRawArchiveSource(SimulationModel):
    journalVersion: ObservationCount
    firstSequence: ObservationCount
    tailSequence: Annotated[int, Field(ge=-1, le=9_007_199_254_740_991)]
    entryCount: ObservationCount
    representation: Literal["json-document-bytes", "sqlite-logical-frames"]
    sourceHash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    nativeValidation: Literal["not-performed"]
    physicalDatabaseCopy: Literal[False]

class SimulationRawArchivePart(SimulationModel):
    part: ObservationCount
    text: str

class SimulationRawArchivePage(SimulationModel):
    runId: Identity
    readVersion: Identity
    observedAt: ObservationCount
    source: SimulationRawArchiveSource
    totalParts: ObservationCount
    items: list[SimulationRawArchivePart]
    nextCursor: Identity | None = None

    @model_validator(mode="before")
    @classmethod
    def _absence(cls, value):
        if isinstance(value, dict) and "nextCursor" in value and value["nextCursor"] is None:
            raise ValueError("Optional continuation must be absent rather than null")
        return value

    @model_validator(mode="after")
    def _coverage(self):
        for index, item in enumerate(self.items):
            if item.part >= self.totalParts or index > 0 and item.part != self.items[index - 1].part + 1:
                raise ValueError("Raw archive parts must be contiguous within declared coverage")
        return self
