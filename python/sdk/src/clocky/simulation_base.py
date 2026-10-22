"""Shared strict Simulation scalars and bounded display text, without product-family imports."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictStr

def utf16_code_units(value: str) -> int:
    """Count Native/Zod JavaScript string units without normalizing astral or surrogate characters."""
    return sum(2 if ord(character) > 0xFFFF else 1 for character in value)


def canonical_javascript_string(value: str) -> str:
    """Combine valid surrogate pairs only; preserve the exact UTF-16 sequence, lone units and non-NFC text."""
    return value.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def _nonempty_javascript_string(value: str) -> str:
    """Match the shared TS owner: a strict nonempty JS string, with no extra limit, trim or NFC."""
    if not value:
        raise ValueError("Identity must be a nonempty string")
    return canonical_javascript_string(value)


Identity = Annotated[StrictStr, AfterValidator(_nonempty_javascript_string)]
# Existing shared original-query export; an unknown family does not imply a management-specific upper limit.
CommandSelectorId = Identity


def _management_command_id(value: str) -> str:
    """Match Native/Zod UTF-16 code units, including astral and lone-surrogate strings."""
    if not value or utf16_code_units(value) > 256:
        raise ValueError("Management command identity requires 1 to 256 UTF-16 code units")
    return canonical_javascript_string(value)


ManagementCommandId = Annotated[StrictStr, AfterValidator(_management_command_id)]


Decimal = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)$")]
PositiveDecimal = Annotated[str, Field(pattern=r"^[1-9][0-9]*$")]
Nonnegative = Annotated[int, Field(ge=0)]
ObservationCount = Annotated[int, Field(ge=0, le=9_007_199_254_740_991)]
EntityPhase = Literal["active", "inactive", "terminated"]
DecisionStatus = Literal["open", "submitted", "accepted", "cancelled"]
OperationStatus = Literal["pending", "applied", "rejected", "blocked-authority", "blocked-dependency", "outcome-unknown"]
CheckpointStatus = Literal["in-progress", "failed", "completed"]
Collection = Literal["entities", "decisions", "operations", "checkpoints"]

class SimulationModel(BaseModel):
    """Closed JSON fields prevent native configuration or private bodies from entering public DTOs."""
    model_config = ConfigDict(extra="forbid", strict=True)

class SimulationText(SimulationModel):
    """Bounded display text with explicit truncation."""

    text: str
    truncated: bool
