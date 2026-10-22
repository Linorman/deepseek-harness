"""Conservative full-history retention metadata and separately authorized raw owner pages."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import Field, model_validator
from .models import JsonValue
from .simulation_base import SimulationModel, Identity, ManagementCommandId

Count = Annotated[int, Field(strict=True, ge=0, le=9_007_199_254_740_991)]
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class SimulationRetentionPreviewInput(SimulationModel):
    """Source must already be paused and quiescent; preview never stops actors."""
    runId: Identity


class SimulationRetentionPlan(SimulationModel):
    """Exact source-bound closure with no automatic physical deletion."""
    runId: Identity
    version: Annotated[int, Field(strict=True, ge=1, le=1)]
    planHash: Hash
    snapshotRevision: Count
    bytes: Count
    nativeEntries: Count
    ownerStreams: Count
    materializedSessions: Count
    unmaterializedSessions: Count
    attachments: Count
    destructive: Literal[False]
    reclaimableBytes: Annotated[int, Field(strict=True, ge=0, le=0)]
    pinPolicy: Literal["complete-owner-history"]

    @model_validator(mode="before")
    @classmethod
    def exact_no_delete(cls, value: object) -> object:
        if isinstance(value, dict) and value.get("destructive") is not False:
            raise ValueError("Retention cannot claim destructive execution")
        return value


class SimulationRetentionReadInput(SimulationModel):
    """Original command lookup; absence is not proof that no work was accepted."""
    runId: Identity
    commandId: Identity


class SimulationRetentionExecuteInput(SimulationRetentionReadInput):
    """Retry preserves the original command, revision and hash."""
    expectedRevision: Count
    planHash: Hash


class SimulationRetentionResult(SimulationRetentionReadInput):
    """Exact closed command outcomes with status-dependent fields."""
    status: Literal["not-found", "accepted", "completed", "failed"]
    plan: SimulationRetentionPlan | None = None
    archiveHash: Hash | None = None
    code: Literal["source-moved", "source-unavailable", "archive-unavailable", "integrity", "cancelled"] | None = None

    @model_validator(mode="after")
    def status_fields(self) -> SimulationRetentionResult:
        expected = {"runId", "commandId", "status"}
        if self.status != "not-found":
            expected.add("plan")
            if self.plan is None or self.plan.runId != self.runId:
                raise ValueError("Retention result requires its original run plan")
        if self.status == "completed":
            expected.add("archiveHash")
            if self.archiveHash is None:
                raise ValueError("Completed retention needs its actual archive hash")
        if self.status == "failed":
            expected.add("code")
            if self.code is None:
                raise ValueError("Failed retention needs its original failure code")
        if self.model_fields_set != expected:
            raise ValueError("Retention result fields differ from its status")
        return self


class SimulationRetentionRecordsInput(SimulationRetentionReadInput):
    """Original source page; metadata ownership grants no record body access."""
    owner: Literal["native", "team", "channel", "session"]
    ownerId: ManagementCommandId
    afterSequence: Annotated[int, Field(strict=True, ge=-1, le=9_007_199_254_740_991)]
    limit: Annotated[int, Field(strict=True, ge=1, le=128)]


class RetentionEntry(SimulationModel):
    """An opaque original durable record; this is not a typed Session transcript."""
    sequence: Count
    value: JsonValue


class SimulationRetentionRecordsResult(SimulationRetentionReadInput):
    """Bounded actual owner page at an immutable archive hash."""
    archiveHash: Hash
    owner: Literal["native", "team", "channel", "session"]
    ownerId: ManagementCommandId
    entries: Annotated[list[RetentionEntry], Field(max_length=128)]
    hasMore: bool


class SimulationBackupExportInput(SimulationRetentionReadInput):
    """Select a completed private archive by its original command."""


class SimulationBackupExportResult(SimulationRetentionReadInput):
    """Exact bounded bundle bytes; source history may contain private content."""
    archiveHash: Hash
    bundleHash: Hash
    kind: Literal["full-private-backup"]
    bundle: Annotated[str, Field(min_length=1)]

    @model_validator(mode="after")
    def verify_bytes(self) -> SimulationBackupExportResult:
        import hashlib
        if hashlib.sha256(self.bundle.encode("utf-8")).hexdigest() != self.bundleHash:
            raise ValueError("Backup bundle bytes differ from their hash")
        return self
