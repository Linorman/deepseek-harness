"""Real v1 user hire over SDK stdio; an installed wheel must resolve inside its explicit project-local target."""
from __future__ import annotations
import json
import os
import time
from pathlib import Path
import clocky
from clocky import (HarnessClient, HarnessConfig, WorldScenarioV1, SimulationWorldPreflightInput, SimulationWorldCreateInput,
    SimulationWorldPrepareInput, SimulationWorldCasesInput, SimulationWorldCaseInput, SimulationControlInput,
    SimulationCheckpointInput, SimulationRestoreInput, SimulationRequestInput, SimulationRetryRequestInput,
    SimulationWorldDomainInput, SimulationWorldManagementFieldsInput, SimulationWorldManagementDraft,
    SimulationWorldManagementSubmitInput)

root = Path(os.environ["SIMULATION_COMPANY_ROOT"])
launch = json.loads(os.environ["SDK_WORLD_LAUNCH"])
mode = os.environ["SDK_WORLD_MODE"]
wire = []
pids = []
sdk = None


def read(name):
    return json.loads((root / name).read_text())


def dump(model):
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


def open_sdk():
    client = HarnessClient(HarnessConfig(runtime_bin=launch["command"],
        launch_args_override=(launch["command"], *launch["args"]), cwd=os.getcwd(),
        env={**os.environ, **launch["env"]}, request_timeout_seconds=30))
    request = client._request_raw

    def observed(method, params, **kwargs):
        result = request(method, params, **kwargs)
        if method.startswith("simulation/"):
            wire.append({"pid": pids[-1], "method": method, "params": params, "result": result})
        return result

    client._request_raw = observed
    client.initialize(credential="sdk-company-test-credential", cwd=os.getcwd(), provider="world-driver-scripted", model="scripted")
    fresh = [read(path.name)["pid"] for path in root.glob("runtime-*.started.json") if read(path.name)["pid"] not in pids]
    assert len(fresh) == 1, fresh
    pids.append(fresh[0])
    return client


def settled(command_id):
    for _ in range(2000):
        result = sdk.get_simulation_request(SimulationRequestInput(commandId=command_id))
        if result.status == "found" and result.request.status != "accepted":
            assert result.request.status == "completed", dump(result)
            return result
        time.sleep(0.005)
    raise AssertionError("Original v1 Python SDK command did not settle")


def sections(run_id, request_id):
    return {section: sdk.inspect_simulation_world_case(SimulationWorldCaseInput(runId=run_id, requestId=request_id, section=section))
        for section in ["request", "plans", "execution", "notification"]}


expected_install = os.environ.get("SDK_WORLD_INSTALLED")
module_path = Path(clocky.__file__).resolve()
assert module_path.is_relative_to(Path(expected_install).resolve() if expected_install else Path("python/sdk/src").resolve())
try:
    sdk = open_sdk()
    definition = WorldScenarioV1.model_validate(read("definition.json"))
    assert read("definition.json")["apiVersion"] == "clocky.world/v1"
    preview = sdk.preflight_simulation_world(SimulationWorldPreflightInput(definition=definition))
    assert preview.status == "ready"
    creation = SimulationWorldCreateInput(commandId="sdk-v1-create", name="SDK v1 existing-person hire", definition=definition,
        preflight={"hash": preview.preview.hash, "catalogGeneration": preview.preview.catalogGeneration})
    run_id = sdk.create_simulation_world(creation).runId
    settled(creation.commandId)
    preparation = SimulationWorldPrepareInput(runId=run_id, commandId="sdk-v1-prepare")
    sdk.prepare_simulation_world(preparation)
    settled(preparation.commandId)
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).phase == "paused"
    people = sdk.read_simulation_world_domain(SimulationWorldDomainInput(kind="organization", runId=run_id, lens="people", limit=16))
    assert people.kind == "organization" and people.coverage.complete
    candidate = next(person for person in people.value.people if person.name.text == "Observer")
    assert candidate.employment == "candidate"
    fields = sdk.read_simulation_world_management_fields(SimulationWorldManagementFieldsInput(runId=run_id,
        targetId=candidate.id, action="hire-existing"))
    assert fields.apiVersion == "clocky.world-management/v1" and fields.status == "available"
    position = next(option for field in fields.fields if field.id == "position" for option in field.options if option.label == "Engineer")
    draft = SimulationWorldManagementDraft.model_validate({"runId": run_id, "targetId": candidate.id, "action": "hire-existing",
        "expectedRevision": fields.targetRevision, "values": {"position": position.id, "reason": "SDK original existing-person hire"}})
    quote = sdk.preview_simulation_world_management(draft)
    assert quote.admission == "allowed" and quote.blockers == [] and quote.coverage.complete
    original = SimulationWorldManagementSubmitInput(runId=run_id, commandId="sdk-v1-hire-existing", draft=draft,
        previewRevision=quote.snapshotRevision, previewHash=quote.previewHash)
    sdk.submit_simulation_world_management(original)
    completed = settled(original.commandId)
    outcome = completed.worldManagementOutcome
    assert completed.worldManagement == original and outcome.result.status == "committed" and outcome.execution.phase == "settled"
    page = sdk.list_simulation_world_cases(SimulationWorldCasesInput(runId=run_id))
    assert page.total == 1 and page.items[0].apiVersion == "clocky.world-case/v4" and page.items[0].requestId == outcome.requestId
    assert dump(page.items[0].origin) == {"kind": "authenticated-user", "commandId": original.commandId}
    assert page.items[0].requesterEntityId is None
    before = sections(run_id, outcome.requestId)
    assert all(value.status == "found" for value in before.values())
    assert len(before["plans"].value.items) == 1 and before["plans"].value.items[0].id == outcome.planId
    assert before["plans"].value.items[0].operationId is None and before["notification"].value.request is None
    after_people = sdk.read_simulation_world_domain(SimulationWorldDomainInput(kind="organization", runId=run_id, lens="people", limit=16))
    employed = next(person for person in after_people.value.people if person.id == candidate.id)
    assert employed.employment == "employed" and employed.tenures[-1].positionId == position.id
    checkpoint = SimulationCheckpointInput(runId=run_id, commandId="sdk-v1-checkpoint")
    sdk.checkpoint_simulation(checkpoint)
    checkpoint_id = settled(checkpoint.commandId).request.checkpointId
    assert checkpoint_id and read("sdk-world-model-count.json")["calls"] == 0
    sdk.close()
    sdk = None
    sdk = open_sdk()
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).owner == "not-held"
    assert sdk.get_simulation_request(SimulationRequestInput(commandId=original.commandId)) == completed
    assert sdk.submit_simulation_world_management(original).status == "completed"
    assert sdk.retry_simulation_request(SimulationRetryRequestInput(runId=run_id, commandId=original.commandId)).status == "completed"
    assert sdk.create_simulation_world(creation).runId == run_id
    assert sdk.prepare_simulation_world(preparation).status == "completed"
    assert sdk.list_simulation_world_cases(SimulationWorldCasesInput(runId=run_id)).items == page.items
    for section, value in sections(run_id, outcome.requestId).items():
        assert value.value == before[section].value
    assert read("sdk-world-model-count.json")["calls"] == 0
    sdk.close()
    sdk = None
    cold = read(f"runtime-{pids[1]}.json")
    assert cold["opens"] == 0 and cold["attaches"] == 0 and cold["modelCalls"] == 0
    sdk = open_sdk()
    sdk.restore_simulation(SimulationRestoreInput(runId=run_id, commandId="sdk-v1-restore", checkpointId=checkpoint_id))
    settled("sdk-v1-restore")
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).phase == "paused"
    assert sdk.list_simulation_world_cases(SimulationWorldCasesInput(runId=run_id)).items == page.items
    assert sdk.get_simulation_request(SimulationRequestInput(commandId=original.commandId)) == completed
    assert sdk.submit_simulation_world_management(original).status == "completed"
    assert read("sdk-world-model-count.json")["calls"] == 0
    sdk.close()
    sdk = None
    assert len(set(pids)) == 3
    runtimes = [read(f"runtime-{pid}.json") for pid in pids]
    assert all(value["modelCalls"] == 0 for value in runtimes)
    assert all(all(("/src/" if mode == "src" else "/lib/") in path for path in value["modules"].values()) for value in runtimes)
    assert all("--import" in value["execArgv"] if mode == "src" else value["execArgv"] == [] for value in runtimes)
    proof = {"apiVersion": "clocky.world/v1", "language": "python", "mode": mode, "backend": os.environ["SIMULATION_COMPANY_BACKEND"],
        "sdkEntry": str(module_path), "installedWheel": bool(expected_install), "driverPid": os.getpid(), "pids": pids,
        "runtimes": runtimes, "runId": run_id, "original": dump(original), "outcome": dump(outcome), "checkpointId": checkpoint_id,
        "business": outcome.result.status, "modelCalls": 0, "coldModelCalls": 0, "exactOriginal": True, "caseSections": 4,
        "coldReadonlyOpens": cold["opens"]}
    (root / "proof.json").write_text(json.dumps(proof, indent=2, ensure_ascii=True) + "\n")
    print(json.dumps(proof))
finally:
    if sdk is not None:
        sdk.close()
    (root / "wire.json").write_text(json.dumps(wire, indent=2, ensure_ascii=True) + "\n")
