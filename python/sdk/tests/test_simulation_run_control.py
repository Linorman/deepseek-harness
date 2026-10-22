"""Stop target wire parsers preserve explicit null and reject caller-selected authority."""
import pytest
from pydantic import ValidationError
from clocky.simulation_run_control import SimulationRunControlInput, SimulationStopTarget


def target():
    return dict(targetId="stop", clock={"kind": "native"}, boundary="12", mode="at-boundary", checkpointPolicy="none",
                drainBudget={"maxSteps": 1, "maxTokens": 1000, "maxWallTimeMs": 1000})


def test_stop_target_and_explicit_clear_are_distinct_from_omission():
    value = SimulationRunControlInput.model_validate(dict(runId="run", commandId="command", target=target()))
    assert value.target.boundary == "12"
    clear = SimulationRunControlInput.model_validate(dict(runId="run", commandId="clear", target=None))
    assert clear.model_dump()["target"] is None
    with pytest.raises(ValidationError):
        SimulationRunControlInput.model_validate(dict(runId="run", commandId="missing-target"))
    for key in ("principalId", "role", "expectedRevision", "provider"):
        with pytest.raises(ValidationError):
            SimulationRunControlInput.model_validate(dict(runId="run", commandId="command", target=None, **{key: "injected"}))


@pytest.mark.parametrize("boundary", ["-1", 12, "01", None])
def test_target_preserves_native_time_precision(boundary):
    with pytest.raises(ValidationError):
        SimulationStopTarget.model_validate({**target(), "boundary": boundary})


def test_client_sends_null_and_correlates_original_receipt(monkeypatch):
    from clocky import HarnessClient, HarnessConfig, SdkProtocolError
    control = dict(runId="run", owner="not-held", driver="idle", inFlight=False, observedAt=1,
                   administration={"actions": {name: {"allowed": False, "reason": "recovery-required"}
                       for name in ("checkpoint", "restore", "prepare", "ingress")},
                       "ingress": {"maxTime": "100", "maxBytes": 1000, "targets": []}},
                   budget={"model": {"provider": "fixture", "name": "scripted"}, "tokensPerRequest": 1000,
                           "tokensPerInterval": 10000, "interval": "100", "residentActors": 1, "sharedModelLimit": 1},
                   actions={name: {"allowed": False, "reason": "recovery-required"} for name in ("start", "pause")})
    result = dict(runId="run", receipt={"commandId": "clear", "revision": 1, "activation": "effective", "targetId": None},
                  control=control)
    client = HarnessClient(HarnessConfig())
    sent = []
    def respond(method, params, **_kwargs):
        sent.append((method, params))
        return result
    monkeypatch.setattr(client, "_request_raw", respond)
    request = SimulationRunControlInput(runId="run", commandId="clear", target=None)
    assert client.update_simulation_run_control(request).receipt.targetId is None
    assert sent == [("simulation/runs-run-control", {"runId": "run", "commandId": "clear", "target": None})]
    result["receipt"]["commandId"] = "foreign"
    with pytest.raises(SdkProtocolError):
        client.update_simulation_run_control(request)


def test_stop_observation_uses_scalar_coverage_instead_of_responsibility_arrays():
    from clocky.simulation_run_control import SimulationStopState
    value = dict(revision=1, commandId="stop", target=target(), nativeBoundary="12", activation="effective", state="paused",
                 reason="target-reached", steps=0, tokens=0, checkpoint="pending", checkpointId=None, checkpointAttemptCount=10000,
                 cut=dict(nativeRevision=1, nativeTime="12", clockRevision=1, clockValue="12", recordedAt=1, tokenBaseline=0,
                          operationCount=10000, requestCount=10000, decisionCount=10000, tokenReservationCount=10000))
    assert SimulationStopState.model_validate(value).cut.operationCount == 10000
    with pytest.raises(ValidationError):
        SimulationStopState.model_validate({**value, "checkpointAttempts": ["private-original-id"]})
    with pytest.raises(ValidationError):
        SimulationStopState.model_validate({**value, "cut": {**value["cut"], "operationIds": ["private-original-id"]}})


def test_stop_metadata_bounds_preserve_utf16_units_without_truncating_identifiers():
    from clocky.simulation_run_control import StopDomainPin
    pin = dict(domain="domain", operation="advance", version="1", schemaRef="😀" * 128, implementationRef="implementation", generation=1)
    assert StopDomainPin.model_validate(pin).schemaRef == pin["schemaRef"]
    with pytest.raises(ValidationError):
        StopDomainPin.model_validate({**pin, "schemaRef": "😀" * 129})
    with pytest.raises(ValidationError):
        SimulationStopTarget.model_validate({**target(), "boundary": "9" * 257})
