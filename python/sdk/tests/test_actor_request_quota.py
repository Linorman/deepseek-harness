"""Actor request quotas are optional authoring overrides and mandatory resolved bounds."""
import copy
import json
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError

from clocky.simulation_scenario import (
    NativeKey, TeamKey, WorldKey, WorldLimits, WorldLimitsInput,
    WorldPreflightResponse, WorldScenarioV1,
)

FIXTURES = Path(__file__).resolve().parents[3] / "packages/sdk/protocol/tests/fixtures"
QUOTA = "maxRequestsPerActorPerInterval"


def resolved_limits():
    return {group: {key: 1 for key in get_args(keys)} for group, keys in
            [("native", NativeKey), ("team", TeamKey), ("world", WorldKey)]}


def test_actor_quota_may_be_omitted_from_authoring_but_resolved_limits_require_it():
    assert WorldLimitsInput(world={}).model_dump(exclude_none=True) == {"world": {}}
    definition = json.loads((FIXTURES / "world-v1-definition.json").read_text())
    definition["limits"]["world"].pop(QUOTA, None)
    assert QUOTA not in WorldScenarioV1.model_validate(definition).limits.world
    definition["limits"]["world"][QUOTA] = 3
    assert WorldScenarioV1.model_validate(definition).limits.world[QUOTA] == 3
    limits = resolved_limits()
    assert WorldLimits.model_validate(limits).world[QUOTA] == 1
    del limits["world"][QUOTA]
    with pytest.raises(ValidationError, match="Resolved World quotas must be complete"):
        WorldLimits.model_validate(limits)


@pytest.mark.parametrize("value", [None, True, False, 0, -1, 1.5, "1", 9_007_199_254_740_992])
def test_actor_quota_rejects_nonpositive_coerced_and_unsafe_values(value):
    with pytest.raises(ValidationError):
        WorldLimitsInput(world={QUOTA: value})
    limits = resolved_limits()
    limits["world"][QUOTA] = value
    with pytest.raises(ValidationError):
        WorldLimits.model_validate(limits)


@pytest.mark.parametrize("value", [1, 9_007_199_254_740_991])
def test_actor_quota_preserves_positive_safe_integer_endpoints(value):
    assert WorldLimitsInput(world={QUOTA: value}).model_dump(exclude_none=True) == {"world": {QUOTA: value}}


def test_actor_quota_is_world_owned_and_unknown_quota_names_reject():
    for group in ["native", "team"]:
        with pytest.raises(ValidationError):
            WorldLimitsInput.model_validate({group: {QUOTA: 1}})
    for model, source in [(WorldLimitsInput, {"world": {}}), (WorldLimits, resolved_limits())]:
        source["world"]["maxRequestsPerActor"] = 1
        with pytest.raises(ValidationError):
            model.model_validate(source)


def test_public_preview_requires_actor_quota_and_rejects_private_compiler_versions():
    value = json.loads((FIXTURES / "world-v1-preview.json").read_text())
    assert WorldPreflightResponse.model_validate(value).model_dump(exclude_none=True) == value
    assert value["limits"]["world"][QUOTA] > 0
    missing = copy.deepcopy(value)
    del missing["limits"]["world"][QUOTA]
    with pytest.raises(ValidationError, match="Resolved World quotas must be complete"):
        WorldPreflightResponse.model_validate(missing)
    for version in [6, 7]:
        with pytest.raises(ValidationError):
            WorldPreflightResponse.model_validate({**value, "compilerVersion": version})
