"""Bounded immutable experiment cuts and explicit paused branch commands."""
from __future__ import annotations
from typing import Annotated, Literal
import uuid
from pydantic import Field, AfterValidator, model_validator
from .models import JsonValue
from .simulation_base import SimulationModel, Identity, utf16_code_units, canonical_javascript_string
from .simulation_retention import Count, Hash


def _uuid(value: str) -> str:
    parsed = uuid.UUID(value)
    if str(parsed) != value.lower() or not (parsed.int in (0, (1 << 128) - 1)
            or parsed.variant == uuid.RFC_4122 and parsed.version is not None and 1 <= parsed.version <= 8):
        raise ValueError("Branch command requires an RFC UUID")
    return value


BranchCommand = Annotated[str, Field(strict=True), AfterValidator(_uuid)]
_JS_TRIM = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def _text256(value: str) -> str:
    if not value or utf16_code_units(value) > 256:
        raise ValueError("Experiment text requires 1 to 256 UTF-16 units")
    return canonical_javascript_string(value)


ExperimentText = Annotated[str, Field(strict=True), AfterValidator(_text256)]


class SimulationExperimentSource(SimulationModel):
    """One separately authorized completed private retention original."""
    runId: Identity
    archiveCommandId: Identity


class SimulationWorldBranchInput(SimulationModel):
    """Explicit new branch; retries retain the command, source and memory policy."""
    source: SimulationExperimentSource
    commandId: BranchCommand
    name: ExperimentText
    memoryPolicy: Literal["public-facts", "authorized-memory"]

    @model_validator(mode="before")
    @classmethod
    def trim_name(cls, value: object) -> object:
        if isinstance(value, dict) and isinstance(value.get("name"), str):
            return {**value, "name": value["name"].strip(_JS_TRIM)}
        return value


class SimulationWorldBranchReadInput(SimulationModel):
    """Lookup never creates another branch or starts scheduling."""
    commandId: BranchCommand


class SimulationWorldBranchResult(SimulationWorldBranchReadInput):
    """Exact original command state; private inherited text is never returned."""
    status: Literal["not-found", "accepted", "completed"]
    runId: Identity | None = None
    source: SimulationExperimentSource | None = None
    sourceHash: Hash | None = None
    memoryPolicy: Literal["public-facts", "authorized-memory"] | None = None
    phase: Literal["paused"] | None = None
    realEffects: Literal[False] | None = None

    @model_validator(mode="before")
    @classmethod
    def no_real_effects(cls, value: object) -> object:
        if isinstance(value, dict) and "realEffects" in value and value["realEffects"] is not False:
            raise ValueError("Branches cannot enable real effects")
        return value

    @model_validator(mode="after")
    def exact_status(self) -> SimulationWorldBranchResult:
        expected = {"status", "commandId"}
        if self.status != "not-found":
            expected |= {"runId", "source", "sourceHash", "memoryPolicy", "phase", "realEffects"}
            if any(getattr(self, name) is None for name in expected):
                raise ValueError("Retained branches require exact original metadata")
        if self.model_fields_set != expected:
            raise ValueError("Branch fields differ from original status")
        return self


class SimulationWorldCausalInput(SimulationModel):
    """Finite traversal through real Native references."""
    source: SimulationExperimentSource
    root: ExperimentText
    maxDepth: Annotated[int, Field(strict=True, ge=0, le=32)]
    maxNodes: Annotated[int, Field(strict=True, ge=1, le=1000)]
    maxBytes: Annotated[int, Field(strict=True, ge=1, le=1048576)]


class ExperimentCausalNode(SimulationModel):
    """Source sequence and digest; no private prose."""
    key: str
    kind: Literal["event", "decision", "operation", "effect", "request", "plan"]
    sequence: Count
    recordHash: Hash


class ExperimentCausalEdge(SimulationModel):
    """A relationship supported by a retained Native record."""
    from_: Annotated[str, Field(alias="from")]
    to: str
    relation: Literal["accepted-operation", "actual-result", "opened-request", "resolved-request",
        "accepted-plan", "scheduled-event", "consumed-event", "operation-dependency"]


class SimulationWorldCausalResult(SimulationModel):
    """Unknown and denied roots share coverage; each read rechecks authority."""
    source: SimulationExperimentSource
    sourceHash: Hash | Literal["unavailable"]
    nodes: list[ExperimentCausalNode]
    edges: list[ExperimentCausalEdge]
    coverage: Literal["bounded", "unknown"]


class SimulationWorldCompareInput(SimulationModel):
    """Two original observations must share the same recorded parent cut."""
    left: SimulationExperimentSource
    right: SimulationExperimentSource


class ExperimentParentCut(SimulationModel):
    """The actual common immutable parent."""
    runId: str
    hash: Hash
    revision: Count


class ExperimentVariables(SimulationModel):
    """Declared interventions, distinct from conclusions."""
    left: dict[str, JsonValue]
    right: dict[str, JsonValue]


class ExperimentMemoryPolicy(SimulationModel):
    """Actual per-branch inheritance choices."""
    left: str
    right: str


class ExperimentDifference(SimulationModel):
    """Lineage-aligned observation hashes."""
    category: str
    equal: bool
    leftHash: Hash
    rightHash: Hash


class ExperimentUnknown(SimulationModel):
    """No quality or cost measurement is invented."""
    status: Literal["unknown"]


class ExperimentStop(SimulationModel):
    """Observed termination conditions."""
    phase: str
    time: str
    stall: str | None


class ExperimentStops(SimulationModel):
    """Stop differences remain distinct from outcome differences."""
    left: ExperimentStop
    right: ExperimentStop


class ExperimentBudget(SimulationModel):
    """Actual frozen branch allowance."""
    maxTokens: Count
    maxTime: Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)$")]


class ExperimentBudgets(SimulationModel):
    """Budget differences are explicit potential confounders."""
    left: ExperimentBudget
    right: ExperimentBudget


class SimulationWorldCompareResult(SimulationModel):
    """Bounded observations without an unsupported causal claim."""
    observations: SimulationWorldCompareInput
    version: Annotated[int, Field(strict=True, ge=1, le=1)]
    parentCut: ExperimentParentCut
    variables: ExperimentVariables
    memoryPolicy: ExperimentMemoryPolicy
    budget: ExperimentBudgets
    differences: list[ExperimentDifference]
    quality: ExperimentUnknown
    cost: ExperimentUnknown
    stop: ExperimentStops
    nondeterminism: str
    causalConclusion: Literal["not-established"]
