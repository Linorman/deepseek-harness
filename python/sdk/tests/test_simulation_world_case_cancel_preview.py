"""Fixed Native cancellation quotes are inert, strict and tied to their displayed original prefix."""
import copy
import pytest
from pydantic import ValidationError
from clocky import (HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError,
                    SimulationWorldCaseCancelInput, SimulationWorldCaseCancelPreview,
                    SimulationWorldCasesInput, SimulationWorldCasesPage, SimulationWorldCaseInspection)

HASH = "sha256:" + "c" * 64


def quote(status="open"):
    return {"snapshotRevision": 9, "previewHash": HASH, "impact": {"requestStatus": status, "planIds": ["plan"],
            "hiringReservationIds": ["original-hiring"], "personnelReservationIds": [], "representativeReservationIds": [],
            "unconfirmedExecutionPlanIds": ["plan"]}}


def page(status="open"):
    return {"runId": "run", "snapshotRevision": 9, "readVersion": "policy", "observedAt": 1, "total": 1,
            "items": [{"apiVersion": "clocky.world-case/v4", "businessSummary": {"status": "unsupported"}, "origin": {"kind": "decision"}, "domain": "organization",
                       "operation": "generate-and-hire", "version": "1", "requestId": "case", "intentId": "intent", "status": status,
                       "requesterEntityId": "requester", "organizationEntityId": "org", "targetEntityId": "position",
                       "cancel": {"allowed": True, "reason": "ready", "preview": quote(status)},
                       "lifecycle": {"request": {"status": status}, "plan": {"status": "none"},
                                     "execution": {"callback": {"status": "none"}, "business": {"status": "none"}},
                                     "notification": {"request": None}}}]}


@pytest.mark.parametrize("status", ["open", "awaiting-evidence"])
def test_exact_original_dependencies_and_required_fixed_quote_roundtrip_and_refuse_omissions(status):
    wire = page(status)
    parsed = SimulationWorldCasesPage.model_validate(wire)
    assert parsed.model_dump(exclude_none=True) == wire
    assert SimulationWorldCaseCancelPreview.model_validate(quote(status)).model_dump(exclude_none=True) == quote(status)
    input_wire = {"runId": "run", "commandId": "retained-cancel", "requestId": "case", "previewRevision": 9, "previewHash": HASH}
    assert SimulationWorldCaseCancelInput.model_validate(input_wire).model_dump() == input_wire
    for name in input_wire:
        changed = dict(input_wire)
        del changed[name]
        with pytest.raises(ValidationError):
            SimulationWorldCaseCancelInput.model_validate(changed)
    for patch in [{"previewHash": "opaque"}, {"previewRevision": True}, {"previewRevision": -1}, {"previewRevision": 2**53},
                  {"previewHash": None}, {"actorId": "director"}, {"principalId": "forged"}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseCancelInput.model_validate({**input_wire, **patch})
    for name in quote()["impact"]:
        changed = quote()
        del changed["impact"][name]
        with pytest.raises(ValidationError):
            SimulationWorldCaseCancelPreview.model_validate(changed)
    for patch in [{"planIds": ["plan", "plan"]}, {"unconfirmedExecutionPlanIds": ["foreign"]}, {"requestStatus": "invented"},
                  {"personnelReservationIds": None}, {"privateBody": "canary"}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseCancelPreview.model_validate({**quote(), "impact": {**quote()["impact"], **patch}})
    invalid = []
    for patch in [{"snapshotRevision": 10}, {"previewHash": "opaque"}, {"impact": {**quote()["impact"], "requestStatus": "cancelled"}}]:
        changed = copy.deepcopy(wire)
        changed["items"][0]["cancel"]["preview"].update(patch)
        invalid.append(changed)
    for cancel in [{"allowed": True, "reason": "ready"}, {"allowed": False, "reason": "stale", "preview": quote()},
                   {"allowed": True, "reason": "ready", "preview": None}]:
        changed = copy.deepcopy(wire)
        changed["items"][0]["cancel"] = cancel
        invalid.append(changed)
    for changed in invalid:
        with pytest.raises(ValidationError):
            SimulationWorldCasesPage.model_validate(changed)
    summary = wire["items"][0]
    detail = {key: value for key, value in wire.items() if key not in {"total", "items"}}
    detail.update({"requestId": "case", "section": "request", "status": "found", "value": {"section": "request", "summary": summary,
                   "source": {"kind": "decision", "operationId": "original", "sequence": 1, "payloadHash": HASH}, "description": {"status": "withheld"}}})
    assert SimulationWorldCaseInspection.model_validate(detail).model_dump(exclude_none=True) == detail
    with pytest.raises(ValidationError):
        SimulationWorldCaseInspection.model_validate({**detail, "snapshotRevision": 10})


def test_low_and_high_clients_keep_fixed_original_quote_and_refuse_substituted_wire_result(monkeypatch):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    original = SimulationWorldCaseCancelInput(runId="run", commandId="retained-cancel", requestId="case", previewRevision=9, previewHash=HASH)
    receipt = {"runId": "run", "commandId": "retained-cancel", "kind": "cancel-world-case", "acceptedAt": 1, "status": "accepted"}
    responses = {"simulation/world-cases-list": page(), "simulation/world-case-cancel": receipt}
    calls = []
    def read(method, params, **_kwargs):
        calls.append((method, copy.deepcopy(params)))
        return responses[method]
    monkeypatch.setattr(low, "_request_raw", read)
    for client in [low, high]:
        cases = client.list_simulation_world_cases(SimulationWorldCasesInput(runId="run"))
        assert cases.items[0].cancel.preview.previewHash == original.previewHash
        assert client.cancel_simulation_world_case(original).commandId == original.commandId
    assert calls[1] == ("simulation/world-case-cancel", original.model_dump())
    responses["simulation/world-cases-list"] = {**page(), "snapshotRevision": 10}
    with pytest.raises(SdkProtocolError):
        low.list_simulation_world_cases(SimulationWorldCasesInput(runId="run"))
    responses["simulation/world-case-cancel"] = {**receipt, "commandId": "foreign"}
    with pytest.raises(SdkProtocolError):
        low.cancel_simulation_world_case(original)
