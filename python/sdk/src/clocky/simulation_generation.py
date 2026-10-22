"""Strict original generation requests and private retained results; reads never authorize inference."""
from __future__ import annotations

import json
import re
from typing import Annotated, Literal
from pydantic import AfterValidator, Field, model_validator
from .models import JsonObject
from .simulation_base import SimulationModel, Identity, Decimal, ManagementCommandId, utf16_code_units, canonical_javascript_string

Key = ManagementCommandId
Count = Annotated[int, Field(strict=True, ge=0, le=9_007_199_254_740_991)]
Positive = Annotated[int, Field(strict=True, gt=0, le=9_007_199_254_740_991)]
Once = Annotated[int, Field(strict=True, ge=1, le=1)]
Hash = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$")]


def _content(value: str) -> str:
    if utf16_code_units(value) > 65536:
        raise ValueError("Generation input exceeds its text bound")
    return canonical_javascript_string(value)


def _output(value: str) -> str:
    if utf16_code_units(value) > 1048576:
        raise ValueError("Generation output exceeds its text bound")
    return canonical_javascript_string(value)


class GenerationBudget(SimulationModel):
    """A single accepted attempt retains its token and output allowance."""
    maxTokens: Positive
    maxOutputBytes: Annotated[int, Field(strict=True, gt=0, le=1048576)]
    maxAttempts: Once


class PlannerAssignment(SimulationModel):
    """Finite original domain, effect, parent and delegation authority."""
    id: Key
    jobId: Key
    requestId: Identity
    domain: Key
    scope: Key
    effects: Annotated[list[Key], Field(min_length=1, max_length=32)]
    deadline: Decimal
    maxAttempts: Once
    maxDepth: Annotated[int, Field(strict=True, ge=0, le=4)]
    maxChildren: Annotated[int, Field(strict=True, ge=0, le=16)]
    maxTokens: Positive
    parentId: Key | None = None


class GenerationInput(SimulationModel):
    """Actual retained bytes; a source label alone grants no read access."""
    source: Key
    content: Annotated[str, AfterValidator(_content)]
    audience: Annotated[list[Key], Field(min_length=1, max_length=64)]


class GenerationModel(SimulationModel):
    """Frozen installed model identity."""
    provider: Key
    name: Key
    version: Key


class GenerationJob(SimulationModel):
    """Original immutable helper scope and request, independently of director history."""
    id: Key
    purpose: Literal["persona", "dialogue", "explanation", "domain-plan"]
    assistantEntityId: Identity
    scope: Key
    audience: Annotated[list[Key], Field(min_length=1, max_length=64)]
    inputs: Annotated[list[GenerationInput], Field(max_length=64)]
    outputSchema: Literal["persona/1", "text/1", "domain-plan/1"]
    model: GenerationModel
    promptVersion: Key
    policyVersion: Key
    budget: GenerationBudget
    deadline: Decimal
    supersedes: Key | None = None
    planner: PlannerAssignment | None = None

    @model_validator(mode="after")
    def original_scope(self) -> GenerationJob:
        """Match Native purpose, parent budget and output-audience restrictions."""
        if (self.purpose == "domain-plan") != (self.planner is not None):
            raise ValueError("Only domain-plan jobs require a planner assignment")
        if self.planner is not None and (self.planner.jobId != self.id or self.planner.scope != self.scope
                or int(self.deadline) > int(self.planner.deadline) or self.budget.maxTokens > self.planner.maxTokens):
            raise ValueError("Generation exceeds original planner assignment")
        expected = "persona/1" if self.purpose == "persona" else "domain-plan/1" if self.purpose == "domain-plan" else "text/1"
        if self.outputSchema != expected or len(set(self.audience)) != len(self.audience):
            raise ValueError("Generation output schema or audience is invalid")
        if any(not set(self.audience) <= set(value.audience) for value in self.inputs):
            raise ValueError("Generation output audience exceeds input disclosure")
        encoded = json.dumps(self.model_dump(exclude_none=True), ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8", errors="backslashreplace")) > 1048576:
            raise ValueError("Complete generation request exceeds one MiB")
        return self


class GenerationBinding(SimulationModel):
    """Canonical original identities, not an execution capability."""
    teamId: Key
    participantId: Key
    sessionId: Key


class GenerationUsage(SimulationModel):
    """Actual provider usage; an absent object remains unknown."""
    inputTokens: Count
    outputTokens: Count
    cacheReadTokens: Count | None = None
    cacheWriteTokens: Count | None = None


_REFERENCE_FIELDS = {
    "entity": "id revision", "entity-profile": "id revision hash", "entity-binding": "id hash",
    "relation-subject-set": "relation subject hash", "relation": "id revision effectiveFrom effectiveUntil",
    "relation-set": "relation object scope hash", "resource-owner-set": "owner unit hash",
    "resource": "id revision", "resource-account": "id hash", "resource-reservation-set": "resourceId hash",
    "resource-grant-set": "ids hash", "hiring-fee-policy": "id version hash", "world-input": "id revision hash",
    "world-definition": "id revision", "authority": "id generation", "norm": "id version",
    "proposal": "id hash", "resolution": "id hash", "external-representation": "id hash",
    "external": "id revision", "external-adjudication-policy": "policyRef generation hash",
    "world-fact": "reference hash", "world-fact-set": "subject scope hash",
    "commitment": "id revision hash", "commitment-party-set": "subject hash",
}


def _planning_read(value: JsonObject) -> JsonObject:
    """Validate the closed Native read-set variants without trusting arbitrary nested dictionaries."""
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in _REFERENCE_FIELDS or set(value) != {"kind", *_REFERENCE_FIELDS[kind].split()}:
        raise ValueError("Unknown or malformed generation planning read")
    for field, item in value.items():
        if field in ("revision", "generation"):
            minimum = 0 if kind == "world-input" else 1
            if type(item) is not int or not minimum <= item <= 9_007_199_254_740_991:
                raise ValueError("Planning read has an invalid counter")
        elif field == "hash":
            if not isinstance(item, str) or re.fullmatch(r"sha256:[a-f0-9]{64}", item) is None:
                raise ValueError("Planning read has an invalid hash")
        elif field in ("effectiveFrom", "effectiveUntil"):
            if field == "effectiveUntil" and item is None:
                continue
            if not isinstance(item, str) or re.fullmatch(r"0|[1-9][0-9]*", item) is None:
                raise ValueError("Planning read has an invalid time")
        elif field == "ids":
            if not isinstance(item, list) or not all(isinstance(entry, str) and entry for entry in item):
                raise ValueError("Planning read has invalid IDs")
        elif field == "reference":
            if not isinstance(item, dict) or set(item) != {"factId", "version"} or not all(isinstance(entry, str) and entry for entry in item.values()):
                raise ValueError("Planning read has an invalid fact reference")
            if re.fullmatch(r"[1-9][0-9]*", item["version"]) is None:
                raise ValueError("Planning fact version is invalid")
        elif not isinstance(item, str) or not item:
            raise ValueError("Planning read has invalid text")
    if kind == "relation" and value["effectiveUntil"] is not None and int(value["effectiveUntil"]) <= int(value["effectiveFrom"]):
        raise ValueError("Planning relation interval is empty")
    if kind == "external-adjudication-policy" and value["policyRef"] != "clocky.external.adjudication/1":
        raise ValueError("Unknown adjudication policy")
    return value


class GenerationRecord(SimulationModel):
    """Retained result and responsibility; validation and incorporation are explicit actions."""
    job: GenerationJob
    binding: GenerationBinding
    acceptedSequence: Positive
    interval: Decimal
    planningReads: list[Annotated[JsonObject, AfterValidator(_planning_read)]] | None = None
    status: Literal["accepted", "generating", "output-retained", "validated", "incorporated", "rejected", "cancelled", "unknown"]
    sessionSequence: Count | None = None
    content: Annotated[str, AfterValidator(_output)] | None = None
    usage: GenerationUsage | None = None
    observedUsage: GenerationUsage | None = None
    cancellation: Key | None = None
    reason: Key | None = None
    incorporatedReference: Key | None = None
    incorporatedRevision: Positive | None = None
    incorporatedBodyHash: Hash | None = None


class SimulationGenerationRead(SimulationModel):
    """An exact owned job selection; also used for explicit execution."""
    runId: Identity
    jobId: Key


class SimulationGenerationRequest(SimulationModel):
    """Only user-authored input is accepted; the Host supplies actual principal provenance."""
    runId: Identity
    job: GenerationJob

    @model_validator(mode="after")
    def user_authored(self) -> SimulationGenerationRequest:
        if any(value.source != "user-authored" for value in self.job.inputs):
            raise ValueError("Product inputs must be explicitly user-authored")
        return self


class GenerationValidate(SimulationModel):
    """Validate a retained original output without inference."""
    kind: Literal["validate"]
    id: Key


class GenerationCancel(SimulationModel):
    """Cancel future admission while preserving accepted responsibility."""
    kind: Literal["cancel"]
    id: Key
    reason: Key


class GenerationIncorporate(SimulationModel):
    """Select the exact reviewed result for an owned target."""
    kind: Literal["incorporate"]
    id: Key
    reference: Key


class SimulationGenerationTransition(SimulationModel):
    """Finite human actions cannot forge provider input, output or usage."""
    runId: Identity
    change: Annotated[GenerationValidate | GenerationCancel | GenerationIncorporate, Field(discriminator="kind")]


class SimulationGenerationPersonaDraft(SimulationGenerationRead):
    """Incorporate original Persona output through the existing A2 review workflow."""
    positionEntityId: Identity
    templateId: Key
    templateVersion: Key
    draftId: Key
    validUntil: Decimal


class SimulationGenerationResult(SimulationModel):
    """Original private generation record; null only denotes absent history."""
    apiVersion: Literal["clocky.generation/v1"]
    runId: Identity
    job: GenerationRecord | None
