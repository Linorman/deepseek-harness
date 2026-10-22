"""Structural admission bounds distinguish disabled dynamic creation from serialized mutation."""
import json
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError

from clocky.simulation_scenario import NativeKey, TeamKey, WorldKey, WorldLimits, WorldLimitsInput, WorldPreflightResponse

FIELDS = ["maxBirthsPerInterval", "maxExternalExpansionsPerInterval", "maxPendingMutations"]
FIXTURES = Path(__file__).resolve().parents[3] / "packages/sdk/protocol/tests/fixtures"


def limits():
    return {group: dict.fromkeys(get_args(keys), 1) for group, keys in
            [("native", NativeKey), ("team", TeamKey), ("world", WorldKey)]}


@pytest.mark.parametrize("field", FIELDS)
def test_structural_bounds_are_optional_inputs_but_required_in_resolved_previews(field):
    assert field not in WorldLimitsInput(world={}).world
    value = limits()
    del value["world"][field]
    with pytest.raises(ValidationError):
        WorldLimits.model_validate(value)
    preview = json.loads((FIXTURES / "world-v1-preview.json").read_text())
    assert WorldPreflightResponse.model_validate(preview).model_dump(exclude_none=True) == preview
    del preview["limits"]["world"][field]
    with pytest.raises(ValidationError):
        WorldPreflightResponse.model_validate(preview)


@pytest.mark.parametrize("field", FIELDS)
@pytest.mark.parametrize("value", [None, True, False, -1, 1.5, "1", 9_007_199_254_740_992])
def test_structural_bounds_reject_invalid_wire_values(field, value):
    with pytest.raises(ValidationError):
        WorldLimitsInput(world={field: value})
    resolved = limits()
    resolved["world"][field] = value
    with pytest.raises(ValidationError):
        WorldLimits.model_validate(resolved)


@pytest.mark.parametrize("field", FIELDS[:2])
@pytest.mark.parametrize("value", [0, 1, 9_007_199_254_740_991])
def test_zero_disables_dynamic_creation_without_weakening_positive_only_quotas(field, value):
    assert WorldLimitsInput(world={field: value}).world[field] == value
    resolved = limits()
    resolved["world"][field] = value
    assert WorldLimits.model_validate(resolved).world[field] == value
    for positive_field in set(get_args(WorldKey)) - set(FIELDS[:2]) - {"maxEvidenceAttemptsPerRequest"}:
        with pytest.raises(ValidationError):
            WorldLimitsInput(world={positive_field: 0})


@pytest.mark.parametrize("value", [0, 2, 9_007_199_254_740_991])
def test_pending_mutation_concurrency_accepts_only_one(value):
    assert WorldLimitsInput(world={"maxPendingMutations": 1}).world["maxPendingMutations"] == 1
    with pytest.raises(ValidationError):
        WorldLimitsInput(world={"maxPendingMutations": value})
    resolved = limits()
    resolved["world"]["maxPendingMutations"] = value
    with pytest.raises(ValidationError):
        WorldLimits.model_validate(resolved)
