"""Evidence attempts have an optional nonnegative input and a required frozen resolved allowance."""
import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from clocky.simulation_scenario import WorldLimitsInput, WorldPreflightResponse

KEY = "maxEvidenceAttemptsPerRequest"
FIXTURES = Path(__file__).resolve().parents[3] / "packages/sdk/protocol/tests/fixtures"


@pytest.mark.parametrize("value", [0, 1, 9_007_199_254_740_991])
def test_evidence_allowance_preserves_zero_and_safe_integer_boundaries(value):
    assert WorldLimitsInput(world={KEY: value}).world[KEY] == value
    preview = json.loads((FIXTURES / "world-v1-preview.json").read_text())
    preview["limits"]["world"][KEY] = value
    assert WorldPreflightResponse.model_validate(preview).root.limits.world[KEY] == value


@pytest.mark.parametrize("value", [None, -1, 1.5, True, False, "1", 9_007_199_254_740_992])
def test_evidence_allowance_refuses_invalid_input_and_resolved_values(value):
    with pytest.raises(ValidationError):
        WorldLimitsInput(world={KEY: value})
    preview = json.loads((FIXTURES / "world-v1-preview.json").read_text())
    preview["limits"]["world"][KEY] = value
    with pytest.raises(ValidationError):
        WorldPreflightResponse.model_validate(preview)


def test_authoring_can_omit_evidence_override_but_resolved_preview_cannot():
    assert KEY not in WorldLimitsInput(world={}).world
    preview = json.loads((FIXTURES / "world-v1-preview.json").read_text())
    assert preview["limits"]["world"][KEY] == preview["limits"]["world"]["maxPlansPerRequest"]
    del preview["limits"]["world"][KEY]
    with pytest.raises(ValidationError):
        WorldPreflightResponse.model_validate(preview)
    with pytest.raises(ValidationError):
        WorldLimitsInput(world={"maxEvidenceAttempts": 1})
