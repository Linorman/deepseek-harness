"""Strict SDK director declarations and explicit no-Channel notifications share the Node fixtures."""
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky import WorldScenarioV1, SimulationWorldPreflightInput, SimulationWorldCreateInput
from clocky.simulation_scenario import WorldPreflightResponse

FIXTURES = Path(__file__).resolve().parents[3] / "packages/sdk/protocol/tests/fixtures"


def definition():
    return json.loads((FIXTURES / "world-director-event-definition.json").read_text())


def test_director_declaration_retains_its_independent_budget_and_all_required_nulls():
    source = definition()
    parsed = WorldScenarioV1.model_validate(source)
    assert parsed.model_dump(exclude_none=True) == source
    assert parsed.behavior.directorEvents[0].maxRequests == 1
    assert "maxRequests" not in parsed.limits.world
    request = SimulationWorldCreateInput(definition=parsed, commandId="original", name="Finite event",
        preflight={"hash": "sha256:" + "a" * 64, "catalogGeneration": "installed"})
    assert request.model_dump(exclude_none=True)["definition"] == source


@pytest.mark.parametrize("limit", [None, True, False, 0, -1, 1.5, 9_007_199_254_740_992, "1"])
def test_director_request_limit_rejects_non_positive_or_non_integer_source(limit):
    source = definition()
    source["behavior"]["directorEvents"][0]["maxRequests"] = limit
    with pytest.raises(ValidationError):
        WorldScenarioV1.model_validate(source)


def test_director_declaration_requires_a_limit_and_refuses_injected_trigger_or_capability():
    source = definition()
    del source["behavior"]["directorEvents"][0]["maxRequests"]
    with pytest.raises(ValidationError):
        SimulationWorldPreflightInput(definition=source)
    for fields in [{"trigger": {"eventId": "forged"}}, {"directorEvents": True}, {"requesterEntityId": "forged"}]:
        changed = definition()
        changed["behavior"]["directorEvents"][0].update(fields)
        with pytest.raises(ValidationError):
            WorldScenarioV1.model_validate(changed)


def test_both_python_client_layers_preserve_director_source_without_supplying_host_authority(monkeypatch):
    from clocky import HarnessClient, HarnessConfig, Clocky, ClockyConfig
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    calls = []
    invalid = {"status": "invalid", "diagnostics": [{"source": "scenario", "path": ["behavior", "directorEvents", 0],
        "code": "unsupported-feature", "message": "The installed capability must admit this declaration"}]}

    def send(name, payload, *, response_model):
        calls.append((name, payload))
        return response_model.model_validate(invalid)

    monkeypatch.setattr(low, "request", send)
    source = definition()
    for client in [low, high]:
        result = client.preflight_simulation_world(SimulationWorldPreflightInput(definition=source))
        assert result.model_dump(exclude_none=True) == invalid
        assert calls[-1] == ("simulation/world-preflight", {"definition": source})
    preview = json.loads((FIXTURES / "world-v1-preview.json").read_text())
    preview["scope"]["domains"][0]["directorEvents"] = True
    with pytest.raises(ValidationError):
        WorldPreflightResponse.model_validate(preview)
