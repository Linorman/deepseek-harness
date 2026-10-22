"""Strict derived-index maintenance DTOs; no journal bodies or paths are transported."""
from typing import Annotated, Literal
from pydantic import Field, field_validator
from .simulation_base import SimulationModel, Identity, Nonnegative


class SimulationRebuildIndexInput(SimulationModel):
    """Rebuild only the original observed prefix; retry keeps the same revision."""

    runId: Identity
    expectedRevision: Nonnegative


class SimulationRebuildIndexResult(SimulationModel):
    """Published source identity; this does not authorize writes to the world."""

    runId: Identity
    snapshotRevision: Nonnegative
    schema_: Literal["clocky/simulation-inspection-index"] = Field(alias="schema")
    version: Literal[1]
    journalVersion: Annotated[int, Field(strict=True, gt=0)]
    sourceHash: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]

    @field_validator("version", mode="before")
    @classmethod
    def strict_version(cls, value: object) -> object:
        """Reject booleans and float coercion at the wire boundary."""
        if type(value) is not int:
            raise ValueError("Index version must be an integer")
        return value
