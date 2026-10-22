"""Real Python SDK stdio World lifecycle, exact commands and independent-process restore."""
from __future__ import annotations
import json
import os
import time
from pathlib import Path
import clocky
from pydantic import ValidationError
from clocky.api import validated_coordinator_event
from clocky.models import Notification
from clocky.simulation import SimulationControl
from clocky.errors import SdkProtocolError
from clocky import (HarnessClient, HarnessConfig, WorldScenario, SimulationWorldPreflightInput, SimulationWorldCreateInput,
    SimulationWorldPrepareInput, SimulationWorldExportInput, SimulationWorldCasesInput, SimulationWorldCaseInput,
    SimulationManageInput, SimulationControlInput, SimulationCheckpointInput,
    SimulationRestoreInput, SimulationRequestInput)

root = Path(os.environ["SIMULATION_COMPANY_ROOT"])
scenario = os.environ["WORLD_SCENARIO"]
args = (os.environ["SDK_WORLD_COMMAND"], *json.loads(os.environ["SDK_WORLD_ARGS"]))

wire = []
pids = []

def open_sdk():
    client = HarnessClient(HarnessConfig(runtime_bin=args[0], launch_args_override=args, cwd=os.getcwd(),
        env=dict(os.environ), request_timeout_seconds=30))
    request = client._request_raw
    def observed(method, params, **kwargs):
        result = request(method, params, **kwargs)
        if method.startswith("simulation/"):
            wire.append({"pid": pids[-1], "method": method, "params": params, "result": result})
        return result
    client._request_raw = observed
    client.initialize(credential="sdk-company-test-credential", cwd=os.getcwd(), provider="world-driver-scripted", model="scripted")
    fresh = [json.loads(path.read_text())["pid"] for path in root.glob("runtime-*.started.json")
        if json.loads(path.read_text())["pid"] not in pids]
    assert len(fresh) == 1, fresh
    pids.append(fresh[0])
    return client

def wait(read, ready):
    for _ in range(2000):
        value = read()
        if ready(value):
            return value
        time.sleep(0.005)
    raise AssertionError("Python World SDK operation did not settle")

def settled(command_id):
    result = wait(lambda: sdk.get_simulation_request(SimulationRequestInput(commandId=command_id)),
        lambda value: value.status == "found" and value.request.status != "accepted")
    assert result.request.status == "completed"
    return result

def calls():
    value = json.loads((root / "sdk-world-model-count.json").read_text())
    assert set(value) == {"calls"} and type(value["calls"]) is int and value["calls"] >= 0
    return value["calls"]

expected_install = os.environ.get("SDK_WORLD_INSTALLED")
if expected_install:
    assert Path(clocky.__file__).resolve().is_relative_to(Path(expected_install).resolve())

sdk = open_sdk()
try:
    definition = WorldScenario.model_validate(json.loads(Path(f"examples/simulation-company/scenarios/world-{scenario}.json").read_text()))
    preview = sdk.preflight_simulation_world(SimulationWorldPreflightInput(definition=definition))
    assert preview.status == "ready" and calls() == 0
    original = SimulationWorldCreateInput(commandId="python-world-create", name="Python World", definition=definition,
        preflight={"hash": preview.preview.hash, "catalogGeneration": preview.preview.catalogGeneration})
    created = sdk.create_simulation_world(original)
    run_id = created.runId
    settled(original.commandId)
    assert sdk.create_simulation_world(original).runId == run_id
    prepared = SimulationWorldPrepareInput(runId=run_id, commandId="python-world-prepare")
    sdk.prepare_simulation_world(prepared)
    settled(prepared.commandId)
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).phase == "paused" and calls() == 0
    exported = sdk.export_simulation_world_definition(SimulationWorldExportInput(runId=run_id))
    assert exported.definition == definition
    assert sdk.preflight_simulation_world(SimulationWorldPreflightInput(definition=exported.definition)).status == "ready"
    assert calls() == 0
    start = SimulationManageInput(runId=run_id, managementId="python-world-start", phase="running")
    sdk.manage_simulation(start)
    wait(lambda: sdk.get_simulation_control(SimulationControlInput(runId=run_id)), lambda value: value.stop == "idle" and not value.inFlight)
    assert calls() == 18
    page = sdk.list_simulation_world_cases(SimulationWorldCasesInput(runId=run_id, limit=1))
    assert page.total == 1 and page.items[0].status == "committed"
    request_id = page.items[0].requestId
    sections = {section: sdk.inspect_simulation_world_case(SimulationWorldCaseInput(runId=run_id, requestId=request_id, section=section))
        for section in ["request", "plans", "execution", "notification"]}
    assert all(value.status == "found" for value in sections.values())
    assert not page.items[0].cancel.allowed and page.items[0].cancel.reason == "terminal"
    assert page.items[0].cancel.preview is None
    assert sdk.get_simulation_request(SimulationRequestInput(commandId="python-world-cancel")).status == "not-found"
    assert sdk.list_simulation_world_cases(SimulationWorldCasesInput(runId=run_id)).items[0].status == "committed"
    assert calls() == 18
    sdk.manage_simulation(SimulationManageInput(runId=run_id, managementId="python-world-pause", phase="paused"))
    sdk.checkpoint_simulation(SimulationCheckpointInput(runId=run_id, commandId="python-world-checkpoint"))
    checkpoint = settled("python-world-checkpoint").request.checkpointId
    assert checkpoint
    sdk.close()
    sdk = open_sdk()
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).owner == "not-held" and calls() == 0
    sdk.restore_simulation(SimulationRestoreInput(runId=run_id, commandId="python-world-restore", checkpointId=checkpoint))
    settled("python-world-restore")
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).phase == "paused"
    assert sdk.manage_simulation(start).control.phase == "paused"
    assert sdk.create_simulation_world(original).runId == run_id
    assert sdk.prepare_simulation_world(prepared).status == "completed"
    assert sdk.export_simulation_world_definition(SimulationWorldExportInput(runId=run_id)).definition == exported.definition
    assert sdk.list_simulation_world_cases(SimulationWorldCasesInput(runId=run_id)).items == page.items
    for section, before in sections.items():
        assert sdk.inspect_simulation_world_case(SimulationWorldCaseInput(runId=run_id, requestId=request_id, section=section)).value == before.value
    assert calls() == 0
    control = sdk.get_simulation_control(SimulationControlInput(runId=run_id))
    try:
        SimulationControl.model_validate({**control.model_dump(exclude_none=True), "stop": "future-world-stop"})
        raise AssertionError("Unknown stop was accepted")
    except ValidationError:
        pass
    event = {"type": "future/world-effect", "seq": 0, "time": 0, "data": {}}
    try:
        validated_coordinator_event(Notification("session.event", {"event": event}))
        raise AssertionError("Unknown required event was accepted")
    except SdkProtocolError:
        pass
    assert validated_coordinator_event(Notification("session.event", {"event": {**event, "ignorable": True}})) is None
    assert len(set(pids)) == 2
    (root / "proof.json").write_text(json.dumps({"scenario": scenario, "language": "python",
        "mode": "lib" if expected_install else "src", "backend": os.environ["SIMULATION_COMPANY_BACKEND"],
        "sdkEntry": str(Path(clocky.__file__).resolve()), "driverPid": os.getpid(), "pids": pids,
        "installedWheel": bool(expected_install), "modelCalls": 18, "coldModelCalls": 0,
        "originalCommands": True, "caseSections": 4, "cancellation": "blocked-terminal"}, indent=2) + "\n")
    print(json.dumps({"scenario": scenario, "world": True, "modelCalls": 18, "coldModelCalls": 0, "originalCommands": True,
        "caseSections": 4, "cancellation": "blocked-terminal", "installedWheel": bool(expected_install),
        "unknownRequiredRejected": True, "unknownStopRejected": True}))
finally:
    sdk.close()
    (root / "wire.json").write_text(json.dumps(wire, indent=2, ensure_ascii=True) + "\n")
