"""Index DTOs preserve exact prefixes and refuse coercion or public source-body injection."""
import pytest
from pydantic import ValidationError
from clocky import HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError
from clocky.simulation_index import SimulationRebuildIndexInput, SimulationRebuildIndexResult


def test_index_schemas_are_strict():
    value = dict(runId="run", snapshotRevision=3, schema="clocky/simulation-inspection-index",
                 version=1, journalVersion=98, sourceHash="a" * 64)
    assert SimulationRebuildIndexResult.model_validate(value).snapshotRevision == 3
    for patch in ({"version": True}, {"version": 2}, {"sourceHash": "bad"}, {"rows": []}):
        with pytest.raises(ValidationError):
            SimulationRebuildIndexResult.model_validate({**value, **patch})
    with pytest.raises(ValidationError):
        SimulationRebuildIndexInput(runId="run", expectedRevision=-1)


def test_both_clients_preserve_the_original_prefix(monkeypatch):
    request = SimulationRebuildIndexInput(runId="run", expectedRevision=3)
    value = SimulationRebuildIndexResult.model_validate(dict(runId="run", snapshotRevision=3,
        schema="clocky/simulation-inspection-index", version=1, journalVersion=98, sourceHash="a" * 64))
    client = HarnessClient(HarnessConfig())
    calls = []

    def dispatch(method, params, **kwargs):
        calls.append((method, params))
        return value

    monkeypatch.setattr(client, "request", dispatch)
    assert client.rebuild_simulation_index(request) == value
    assert calls == [("simulation/index-rebuild", {"runId": "run", "expectedRevision": 3})]
    value.snapshotRevision = 4
    with pytest.raises(SdkProtocolError):
        client.rebuild_simulation_index(request)
