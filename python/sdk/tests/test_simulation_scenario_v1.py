"""Shared real v1 authoring/preflight fixtures preserve null intervals across SDK serialization."""
import copy
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky import WorldScenarioV1, SimulationWorldPreflightInput, SimulationWorldCreateInput
from clocky.simulation_scenario import WorldPreflightResponse, SimulationWorldExportResult

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "packages/sdk/protocol/tests/fixtures"


def load(name):
    return json.loads((FIXTURES / name).read_text())


def objects(value, path=()):
    if isinstance(value, dict):
        yield path
        for key, item in value.items():
            yield from objects(item, (*path, key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from objects(item, (*path, index))


def at(value, path):
    for key in path:
        value = value[key]
    return value


def test_complete_original_v1_authoring_survives_optional_field_wire_dump():
    value = load("world-v1-definition.json")
    definition = WorldScenarioV1.model_validate(value)
    assert definition.model_dump(exclude_none=True) == value
    request = SimulationWorldPreflightInput(definition=definition)
    assert request.model_dump(exclude_none=True) == {"definition": value}
    assert request.model_dump(exclude_unset=True) == {"definition": value}
    command = SimulationWorldCreateInput(definition=definition, commandId="v1-original", name="Full World",
        preflight={"hash": "sha256:" + "a" * 64, "catalogGeneration": "original"})
    assert command.model_dump(exclude_none=True)["definition"] == value
    export = SimulationWorldExportResult.model_validate({"runId": "world", "definition": value})
    assert export.model_dump(exclude_none=True) == {"runId": "world", "definition": value}


def test_actual_v1_public_preview_is_correlated_and_preserves_all_required_nulls():
    value = load("world-v1-preview.json")
    preview = WorldPreflightResponse.model_validate(value).root
    assert preview.model_dump(exclude_none=True) == value
    assert preview.preview.creationMode == "paused"
    assert preview.scope.source == "simulated-only"
    for change in [{"apiVersion": "clocky.world/v2"}, {"status": "other"}, {"scope": {**value["scope"], "payroll": 0}},
                   {"preview": {**value["preview"], "initialRequestCount": 1}},
                   {"preview": {**value["preview"], "entityCount": 1}}]:
        with pytest.raises(ValidationError):
            WorldPreflightResponse.model_validate({**value, **change})


@pytest.mark.parametrize("name,model", [("world-v1-definition.json", WorldScenarioV1),
                                         ("world-v1-preview.json", WorldPreflightResponse)])
def test_every_original_object_rejects_unknown_fields_without_silent_stripping(name, model):
    value = load(name)
    for path in objects(value):
        changed = copy.deepcopy(value)
        at(changed, path)["credential"] = "Unaccepted extra field"
        with pytest.raises(ValidationError):
            model.model_validate(changed)


def test_unknown_required_diagnostic_kind_and_null_optional_adjudication_policy_reject():
    value = load("world-v1-definition.json")
    changed = copy.deepcopy(value)
    changed["externalWorld"]["adjudicationPolicy"] = None
    with pytest.raises(ValidationError):
        WorldScenarioV1.model_validate(changed)
    with pytest.raises(ValidationError):
        WorldPreflightResponse.model_validate({"status": "invalid", "diagnostics": [
            {"source": "scenario", "path": [], "code": "arbitrary-new-kind", "message": "Unknown"}]})
    for code in ["domain-unavailable", "assignment-overlap", "time-horizon", "unsupported-feature"]:
        assert WorldPreflightResponse.model_validate({"status": "invalid", "diagnostics": [
            {"source": "scenario", "path": ["entities", 0], "code": code, "message": "Safe field diagnosis"}]}).root.status == "invalid"


def test_both_python_client_layers_preserve_v1_nulls_and_original_selection(monkeypatch):
    from clocky import HarnessClient, HarnessConfig, Clocky, ClockyConfig
    value = load("world-v1-definition.json")
    preview = load("world-v1-preview.json")
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    calls = []

    def request(name, payload, *, response_model):
        calls.append((name, payload))
        if name == "simulation/world-preflight":
            return response_model.model_validate(preview)
        if name == "simulation/world-export":
            return response_model.model_validate({"runId": "world", "definition": value})
        return response_model.model_validate({"commandId": "original", "runId": "world", "kind": "world-create",
                                              "status": "accepted", "acceptedAt": 1})

    monkeypatch.setattr(low, "request", request)
    for client in [low, high]:
        result = client.preflight_simulation_world(SimulationWorldPreflightInput(definition=value))
        assert result.model_dump(exclude_none=True) == preview
        assert calls[-1] == ("simulation/world-preflight", {"definition": value})
        command = SimulationWorldCreateInput(commandId="original", name="World", definition=value,
            preflight={"hash": preview["preview"]["hash"], "catalogGeneration": preview["preview"]["catalogGeneration"]})
        assert client.create_simulation_world(command).commandId == "original"
        assert calls[-1][1]["definition"] == value
        from clocky import SimulationWorldExportInput
        exported = client.export_simulation_world_definition(SimulationWorldExportInput(runId="world"))
        assert exported.model_dump(exclude_none=True) == {"runId": "world", "definition": value}


def test_explicit_public_world_template_catalog_preserves_full_definition_and_rejects_unknown_fields():
    from clocky.simulation import SimulationCatalog
    definition = load("world-v1-definition.json")
    value = {"items": [], "worldTemplates": [{"id": "world", "version": "1", "name": "Published", "definition": definition}]}
    assert SimulationCatalog.model_validate(value).model_dump(exclude_none=True) == value
    assert SimulationCatalog.model_validate({"items": []}).model_dump(exclude_none=True) == {"items": []}
    for path in objects(definition):
        changed = copy.deepcopy(value)
        at(changed["worldTemplates"][0]["definition"], path)["unrecognized"] = True
        with pytest.raises(ValidationError):
            SimulationCatalog.model_validate(changed)
