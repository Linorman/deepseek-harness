"""Personnel metadata preserves separate counts, exact provenance and unavailable history."""
import pytest
from pydantic import ValidationError
from clocky import SimulationPeopleCounts, SimulationWorld


def counts():
    return {"scope": "run", "snapshotRevision": 5, "time": "9007199254740993", "employed": 1,
            "nonTerminalPersons": 3, "resident": 0, "residentLimit": 2, "unreleasedWriters": 1,
            "history": {"status": "unavailable", "reason": "unsupported"}}


def test_separates_unreleased_capacity_and_incomplete_history_without_inventing_zero():
    value = SimulationPeopleCounts.model_validate(counts())
    assert value.resident == 0
    assert value.unreleasedWriters == 1
    assert value.history.status == "unavailable"
    assert not hasattr(value.history, "participants")
    observed = SimulationPeopleCounts.model_validate({**counts(), "history": {
        "status": "observed", "teamCursor": 19, "participants": 7, "activations": 17}})
    assert observed.history.activations == 17
    assert observed.time == "9007199254740993"


@pytest.mark.parametrize("change", [
    {"employed": 4}, {"resident": 2}, {"unreleasedWriters": 3}, {"residentLimit": 0},
    {"nonTerminalPersons": 9_007_199_254_740_992}, {"resident": False}, {"time": "01"},
    {"history": {"status": "observed", "participants": 0}},
    {"history": {"status": "unavailable", "reason": "unavailable", "participants": 0}},
    {"principal": "forged"},
])
def test_rejects_bad_relationships_history_coverage_and_extra_authority_fields(change):
    with pytest.raises(ValidationError):
        SimulationPeopleCounts.model_validate({**counts(), **change})


def test_binds_people_counts_to_the_observed_native_revision_and_time():
    world = {"revision": 5, "phase": "paused", "time": "9007199254740993",
             "tickUnit": {"text": "minute", "truncated": False}, "owner": "unowned",
             "entityCount": 7, "decisionCount": 0, "operationCount": 0, "observedAt": 1,
             "people": counts()}
    assert SimulationWorld.model_validate(world).people.employed == 1
    for changed in [{"revision": 6}, {"time": "9007199254740994"}]:
        with pytest.raises(ValidationError):
            SimulationWorld.model_validate({**world, **changed})
