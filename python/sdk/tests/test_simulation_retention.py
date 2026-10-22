"""Retention preserves immutable cuts and checks status-dependent public fields."""
import pytest
from pydantic import ValidationError
from clocky import (HarnessClient, HarnessConfig, SdkProtocolError, SimulationRetentionPlan,
    SimulationRetentionResult, SimulationRetentionExecuteInput, SimulationRetentionRecordsInput,
    SimulationRetentionRecordsResult)

PLAN = dict(runId="run", version=1, planHash="a"*64, snapshotRevision=3, bytes=100, nativeEntries=4,
    ownerStreams=2, materializedSessions=1, unmaterializedSessions=1, attachments=0,
    destructive=False, reclaimableBytes=0, pinPolicy="complete-owner-history")
RESULT = dict(runId="run", commandId="original", status="completed", plan=PLAN, archiveHash="b"*64)


def test_retention_closed_fields_and_nested_original_selection():
    assert SimulationRetentionResult.model_validate(RESULT).plan.snapshotRevision == 3
    for patch in (dict(version=True), dict(destructive=0), dict(destructive=True), dict(reclaimableBytes=1)):
        with pytest.raises(ValidationError):
            SimulationRetentionPlan.model_validate({**PLAN, **patch})
    for patch in (dict(status="accepted"), dict(plan={**PLAN, "runId":"other"}), dict(code="integrity")):
        with pytest.raises(ValidationError):
            SimulationRetentionResult.model_validate({**RESULT, **patch})


def test_retention_client_checks_command_and_source_page(monkeypatch):
    client = HarnessClient(HarnessConfig())
    original = SimulationRetentionResult.model_validate(RESULT)
    calls = []
    def send(method, params, **kwargs):
        calls.append((method, params))
        return original
    monkeypatch.setattr(client, "request", send)
    command = SimulationRetentionExecuteInput(runId="run", commandId="original", expectedRevision=3, planHash="a"*64)
    assert client.retention_execute(command) == original
    assert calls[0][0] == "simulation/retention-execute"
    original.plan.snapshotRevision = 4
    with pytest.raises(SdkProtocolError):
        client.retention_execute(command)
    page = SimulationRetentionRecordsResult(runId="run", commandId="original", archiveHash="b"*64,
        owner="native", ownerId="native", entries=[dict(sequence=0, value={})], hasMore=False)
    monkeypatch.setattr(client, "request", lambda *args, **kwargs: page)
    selected = SimulationRetentionRecordsInput(runId="run", commandId="original", owner="native", ownerId="native", afterSequence=-1, limit=2)
    assert client.retention_records(selected) == page
    page.entries = page.entries * 2
    with pytest.raises(SdkProtocolError):
        client.retention_records(selected)


def test_backup_export_private_bytes_and_identity(monkeypatch):
    import hashlib
    from clocky import SimulationBackupExportInput, SimulationBackupExportResult
    bundle = '{"manifest":{"format":"world-backup/1"}}'
    value = dict(runId="run", commandId="original", archiveHash="a"*64,
        bundleHash=hashlib.sha256(bundle.encode()).hexdigest(), bundle=bundle, kind="full-private-backup")
    result = SimulationBackupExportResult.model_validate(value)
    for patch in (dict(bundle=bundle+" "), dict(kind="redacted-dataset"), dict(start=True)):
        with pytest.raises(ValidationError):
            SimulationBackupExportResult.model_validate({**value, **patch})
    client = HarnessClient(HarnessConfig())
    calls = []
    def send(method, params, **kwargs):
        calls.append((method, params))
        return result
    monkeypatch.setattr(client, "request", send)
    request = SimulationBackupExportInput(runId="run", commandId="original")
    assert client.backup_export(request) == result
    assert calls == [("simulation/backup-export", dict(runId="run", commandId="original"))]
    result.commandId = "changed"
    with pytest.raises(SdkProtocolError):
        client.backup_export(request)
