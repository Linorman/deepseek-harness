"""Original hiring charges stay inert authoring data and exact financial stops stay closed public observations."""
import copy
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky import HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError
from clocky.simulation import SimulationControl, SimulationControlInput, SimulationOperationalObserved
from clocky.simulation_scenario import WorldScenarioV1, SimulationWorldPreflightInput

FIXTURES = Path(__file__).resolve().parents[3] / "packages/sdk/protocol/tests/fixtures"
DEFINITION = json.loads((FIXTURES / "world-hiring-fee-definition.json").read_text())
FEE = DEFINITION["organization"]["hiringFees"][0]
STOPS = json.loads((FIXTURES / "world-hiring-fee-control.json").read_text())


def test_original_fees_and_absence_round_trip_without_a_default_payment_rule():
    assert WorldScenarioV1.model_validate(DEFINITION).model_dump(exclude_none=True) == DEFINITION
    omitted = copy.deepcopy(DEFINITION)
    del omitted["organization"]["hiringFees"]
    assert WorldScenarioV1.model_validate(omitted).model_dump(exclude_none=True) == omitted
    changed = copy.deepcopy(DEFINITION)
    changed["organization"]["hiringFees"][0]["operation"] = "hire-existing"
    assert WorldScenarioV1.model_validate(changed).model_dump(exclude_none=True) == changed


@pytest.mark.parametrize("hiring_fees", [None, False, {}])
def test_malformed_declaration_is_not_treated_as_omitted(hiring_fees):
    changed = copy.deepcopy(DEFINITION)
    changed["organization"]["hiringFees"] = hiring_fees
    with pytest.raises(ValidationError):
        WorldScenarioV1.model_validate(changed)


@pytest.mark.parametrize("patch", [{"quantity": "0"}, {"quantity": "01"}, {"quantity": 1}, {"quantity": True},
    {"reservationPeriod": "0"}, {"reservationPeriod": "-1"}, {"reservationPeriod": 1}, {"policyRef": "other/1"},
    {"operation": "transfer"}, {"from": FEE["to"]}, {"grants": ["duplicate", "duplicate"]}, {"from_": "injected"},
    {"price": "1"}, {"id": "x" * 257}])
def test_malformed_or_expanded_fee_terms_reject(patch):
    changed = copy.deepcopy(DEFINITION)
    changed["organization"]["hiringFees"][0].update(patch)
    with pytest.raises(ValidationError):
        SimulationWorldPreflightInput(definition=changed)


@pytest.mark.parametrize("field", list(FEE))
def test_each_original_fee_field_is_required(field):
    changed = copy.deepcopy(DEFINITION)
    del changed["organization"]["hiringFees"][0][field]
    with pytest.raises(ValidationError):
        WorldScenarioV1.model_validate(changed)


@pytest.mark.parametrize("row", STOPS, ids=lambda row: row["reason"])
def test_financial_stops_match_control_and_operational_views_but_do_not_expand_authority(row):
    assert SimulationControl.model_validate(row["control"]).stop == row["reason"]
    assert SimulationOperationalObserved.model_validate(row["operational"]).stop == row["reason"]
    for parser, data in [(SimulationControl, row["control"]), (SimulationOperationalObserved, row["operational"])]:
        for patch in [{"stop": "resource-minted"}, {"feeQuote": {}}]:
            with pytest.raises(ValidationError):
                parser.model_validate({**data, **patch})


@pytest.mark.parametrize("row", STOPS, ids=lambda row: row["reason"])
def test_both_clients_keep_exact_control_stops_and_original_fee_source(monkeypatch, row):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    response = row["control"]
    calls = []

    def request(method, payload, *, response_model):
        calls.append((method, payload))
        return response_model.model_validate(response)

    monkeypatch.setattr(low, "request", request)
    selector = SimulationControlInput(runId="run")
    for client in [low, high]:
        assert client.get_simulation_control(selector).model_dump(exclude_none=True) == row["control"]
    response = {**row["control"], "runId": "foreign"}
    for client in [low, high]:
        with pytest.raises(SdkProtocolError):
            client.get_simulation_control(selector)
    response = {"status": "invalid", "diagnostics": [{"source": "scenario", "path": ["organization", "hiringFees", 0],
        "code": "unknown-reference", "message": "Host must resolve original accounts"}]}
    original = SimulationWorldPreflightInput(definition=DEFINITION)
    for client in [low, high]:
        assert client.preflight_simulation_world(original).model_dump(exclude_none=True) == response
    assert calls[-1] == ("simulation/world-preflight", {"definition": DEFINITION})
