"""Portable environment/experience inputs preserve strict initial state across both SDKs."""
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky import WorldScenarioV1


def test_initial_environment_and_subjective_state_roundtrip():
    root = Path(__file__).resolve().parents[3]
    source = json.loads((root / "examples/simulation-company/scenarios/world-company-v1.json").read_text())
    environment = dict(model="supply-fixed/1", generation=1, inventory=10, committed=4, capacity=20,
                       sourceLimit=3, sinkLimit=5, step=1, lastTime=None)
    source["entities"].extend([
        dict(id="supply", name="Supply", description="Simulated.", kind="environment", cognition="none", environment=environment),
        dict(id="experience", name="Experience", description="Subjective.", kind="person-state", cognition="none",
             evolution=dict(personId="ceo", audience=["ceo", "director"], period=10, versions=[])),
    ])
    parsed = WorldScenarioV1.model_validate(source)
    assert parsed.model_dump(mode="json", exclude_none=True) == source
    environment["lastTime"] = "1"
    with pytest.raises(ValidationError):
        WorldScenarioV1.model_validate(source)
    environment["lastTime"] = None
    environment["committed"] = 11
    with pytest.raises(ValidationError):
        WorldScenarioV1.model_validate(source)
