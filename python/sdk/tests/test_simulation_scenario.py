"""Portable World inputs and required Session-event handling share the Host/Core contracts."""
import json
import re
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky import WorldScenario, SimulationWorldPreflightInput, SimulationWorldCreateInput, SdkProtocolError
from clocky.api import validated_coordinator_event
from clocky.models import Notification
from clocky.session_events import KNOWN_SESSION_EVENT_TYPES
from clocky.simulation_scenario import WorldDiagnostic, WorldScope

ROOT = Path(__file__).resolve().parents[3]

def test_preview_source_is_explicitly_simulated_without_inventing_a_missing_marker():
    value = {"source": "simulated-only", "operation": "organization.generate-and-hire/v1", "payroll": False, "committeeApproval": False}
    assert WorldScope.model_validate(value).model_dump() == value
    for marker in (None, "real-network", "payment", False):
        changed = dict(value)
        if marker is None:
            del changed["source"]
        else:
            changed["source"] = marker
        with pytest.raises(ValidationError):
            WorldScope.model_validate(changed)

def test_file_diagnostics_preserve_syntax_locations_and_reject_incomplete_or_invalid_locations():
    value = {"source": "scenario", "path": ["organization", "name"], "code": "invalid-shape",
             "message": "Expected a string", "format": "yaml", "line": 4, "column": 9}
    assert WorldDiagnostic.model_validate(value).model_dump(exclude_none=True) == value
    for changes in [{"format": "javascript"}, {"line": 0}, {"column": -1}, {"line": 1.5},
                    {"line": True}, {"line": 9_007_199_254_740_992}, {"column": None}, {"input": "private contents"}]:
        with pytest.raises(ValidationError):
            WorldDiagnostic.model_validate({**value, **changes})
    for key in ["line", "column"]:
        with pytest.raises(ValidationError):
            WorldDiagnostic.model_validate({name: item for name, item in value.items() if name != key})

@pytest.mark.parametrize("scenario", ["company", "laboratory"])
def test_portable_scenario_strict_input_and_preview_identity(scenario):
    value = json.loads((ROOT / f"examples/simulation-company/scenarios/world-{scenario}.json").read_text())
    definition = WorldScenario.model_validate(value)
    assert SimulationWorldPreflightInput(definition=definition).model_dump(exclude_none=True) == {"definition": value}
    assert SimulationWorldCreateInput(commandId="original", name="World", definition=definition,
        preflight={"hash": "sha256:" + "1" * 64, "catalogGeneration": "1"}).commandId == "original"
    for changed in [{**value, "nativeSnapshot": {}}, {**value, "runtimeProfile": {**value["runtimeProfile"], "path": "/tmp/provider"}},
                    {**value, "limits": {"native": {"unknownQuota": 1}}},
                    {**value, "limits": {"native": {"maxResidentActors": 0}}},
                    {**value, "limits": {"team": {"maxParticipants": 0}}}, {**value, "limits": None},
                    {**value, "actors": [{**value["actors"][0], "persona": {"skills": ["same", "same"]}}, *value["actors"][1:]]}]:
        with pytest.raises(ValidationError):
            WorldScenario.model_validate(changed)

def test_known_event_set_matches_core_generated_vocabulary():
    source = (ROOT / "packages/core/session/src/known-event-types.ts").read_text()
    assert KNOWN_SESSION_EVENT_TYPES == set(re.findall(r"^  '([^']+)',", source, re.M))

@pytest.mark.parametrize("marker", [None, False, "true"])
def test_unknown_required_events_refuse_instead_of_becoming_known_typed_events(marker):
    value = {"type": "future/world-effect", "seq": 0, "time": 0, "data": {}}
    if marker is not None:
        value["ignorable"] = marker
    with pytest.raises(SdkProtocolError):
        validated_coordinator_event(Notification("session.event", {"event": value}))

def test_unknown_ignorable_event_is_omitted_from_typed_transcript():
    assert validated_coordinator_event(Notification("session.event", {"event": {
        "type": "future/world-effect", "seq": 0, "time": 0, "data": {}, "ignorable": True}})) is None
