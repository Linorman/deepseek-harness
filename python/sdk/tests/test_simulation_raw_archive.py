"""Raw pages preserve unsupported source versions while refusing Native-validation claims and caller source overrides."""
import pytest
from pydantic import ValidationError
from clocky import HarnessClient, HarnessConfig, SdkProtocolError
from clocky.simulation_raw_archive import SimulationRawArchiveInput, SimulationRawArchivePage


def page():
    return dict(runId="run", readVersion="policy", observedAt=1,
                source=dict(journalVersion=101, firstSequence=0, tailSequence=0, entryCount=1,
                            representation="sqlite-logical-frames", sourceHash="a" * 64,
                            nativeValidation="not-performed", physicalDatabaseCopy=False),
                totalParts=2, items=[dict(part=0, text="uninterpreted bytes")], nextCursor="cursor")


def test_raw_archive_protocol_has_no_native_state_or_caller_path():
    assert SimulationRawArchivePage.model_validate(page()).source.journalVersion == 101
    for key in ("path", "provider", "spec", "journalVersion", "role", "principalId"):
        with pytest.raises(ValidationError):
            SimulationRawArchiveInput.model_validate(dict(runId="run", **{key: "injected"}))
    with pytest.raises(ValidationError):
        SimulationRawArchiveInput.model_validate(dict(runId="run", limit=9_007_199_254_740_992))
    for key in ("cursor", "limit"):
        with pytest.raises(ValidationError):
            SimulationRawArchiveInput.model_validate(dict(runId="run", **{key: None}))
    with pytest.raises(ValidationError):
        SimulationRawArchivePage.model_validate({**page(), "source": {**page()["source"], "nativeValidation": "validated"}})
    with pytest.raises(ValidationError):
        SimulationRawArchivePage.model_validate({**page(), "source": {**page()["source"], "physicalDatabaseCopy": True}})
    with pytest.raises(ValidationError):
        SimulationRawArchivePage.model_validate({**page(), "items": [dict(part=2, text="outside coverage")]})


def test_raw_client_sends_only_registered_selection_and_correlates_result(monkeypatch):
    client = HarnessClient(HarnessConfig())
    output = page()
    sent = []
    def respond(method, params, **_kwargs):
        sent.append((method, params))
        return output
    monkeypatch.setattr(client, "_request_raw", respond)
    result = client.archive_raw_simulation(SimulationRawArchiveInput(runId="run", limit=1))
    assert result.source.nativeValidation == "not-performed"
    assert sent == [("simulation/raw-archive", dict(runId="run", limit=1))]
    output["runId"] = "foreign"
    with pytest.raises(SdkProtocolError):
        client.archive_raw_simulation(SimulationRawArchiveInput(runId="run"))
