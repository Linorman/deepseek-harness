"""Reservation history is a strict quota; operations remain authenticated public reads and opaque journal text."""
import copy
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky import HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError
from clocky.simulation import SimulationObjectInput, SimulationObjectInspection, SimulationRecordsInput, SimulationRecordsPage
from clocky.simulation_scenario import WorldLimitsInput, WorldPreflightResponse

FIXTURES = Path(__file__).resolve().parents[3] / "packages/sdk/protocol/tests/fixtures"
CASES = json.loads((FIXTURES / "simulation-resource-reservation-cases.json").read_text())


def test_resolved_history_is_required_and_source_override_is_positive_safe_integer():
    preview = json.loads((FIXTURES / "world-v1-preview.json").read_text())
    result = WorldPreflightResponse.model_validate(preview)
    assert result.root.limits.native["maxResourceReservationHistory"] == 128
    for limit in [None, True, False, 0, -1, 1.5, 9_007_199_254_740_992, "128"]:
        with pytest.raises(ValidationError):
            WorldLimitsInput(native={"maxResourceReservationHistory": limit})
        changed = copy.deepcopy(preview)
        changed["limits"]["native"]["maxResourceReservationHistory"] = limit
        with pytest.raises(ValidationError):
            WorldPreflightResponse.model_validate(changed)
    del preview["limits"]["native"]["maxResourceReservationHistory"]
    with pytest.raises(ValidationError):
        WorldPreflightResponse.model_validate(preview)
    assert WorldLimitsInput(native={"maxResourceReservationHistory": 1}).native == {"maxResourceReservationHistory": 1}


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["kind"])
def test_public_operation_and_original_body_preserve_reservation_vocabulary_with_strict_wrappers(case):
    operation = SimulationObjectInspection.model_validate(case["operation"])
    assert operation.value.summary.kind.text == case["kind"]
    records = SimulationRecordsPage.model_validate(case["records"])
    assert json.loads(records.items[0].body.text) == case["action"]
    for patch in [{"bodyAccess": "withheld"}, {"mode": "metadata"}]:
        with pytest.raises(ValidationError):
            SimulationRecordsPage.model_validate({**case["records"], **patch})
    changed = copy.deepcopy(case["records"])
    changed["items"][0]["body"]["transaction"] = {}
    with pytest.raises(ValidationError):
        SimulationRecordsPage.model_validate(changed)
    missing = copy.deepcopy(case["operation"])
    del missing["status"]
    with pytest.raises(ValidationError):
        SimulationObjectInspection.model_validate(missing)
    with pytest.raises(ValidationError):
        SimulationObjectInspection.model_validate({**case["operation"], "nativeReservation": {}})


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["kind"])
def test_both_clients_bind_reservation_reads_to_original_selectors_without_native_mutation(monkeypatch, case):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    responses = {"simulation/objects-inspect": case["operation"], "simulation/records-list": case["records"]}
    calls = []

    def request(method, payload, *, response_model):
        calls.append((method, payload))
        return response_model.model_validate(responses[method])

    monkeypatch.setattr(low, "request", request)
    selector = SimulationObjectInput(runId="run", expectedRevision=3, **case["operation"]["selection"])
    record_selector = SimulationRecordsInput(runId="run", expectedRevision=3, mode="original", limit=1,
        sequence=case["records"]["selection"]["sequence"])
    for client in [low, high]:
        assert client.inspect_simulation_object(selector).model_dump(exclude_none=True) == case["operation"]
        assert client.read_simulation_records(record_selector).model_dump(exclude_none=True) == case["records"]
    assert len(calls) == 4
    responses["simulation/objects-inspect"] = {**case["operation"], "runId": "foreign"}
    for client in [low, high]:
        with pytest.raises(SdkProtocolError):
            client.inspect_simulation_object(selector)
    responses["simulation/records-list"] = {**case["records"], "selection": {"sequence": 100}}
    for client in [low, high]:
        with pytest.raises(SdkProtocolError):
            client.read_simulation_records(record_selector)
