"""Real stdio Loader snapshot for source-backed report acknowledgement through the Python SDK."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Callable, TypeVar

from clocky import HarnessClient, HarnessConfig
from clocky.api import validated_coordinator_event
from clocky.models import Notification
from clocky.simulation import (
    SimulationCreateInput, SimulationManageInput, SimulationControlInput, SimulationRequestInput,
    SimulationCheckpointInput, SimulationRestoreInput, SimulationTaskReviewListInput,
    SimulationTaskReviewResolveInput, SimulationBrowseInput, SimulationObjectInput,
)

T = TypeVar("T")
root = Path(os.environ["SIMULATION_COMPANY_ROOT"])
args = (os.environ["SDK_EXECUTION_COMMAND"], *json.loads(os.environ["SDK_EXECUTION_ARGS"]))


def open_sdk(fault: bool) -> HarnessClient:
    sdk = HarnessClient(HarnessConfig(runtime_bin=os.environ["SDK_EXECUTION_COMMAND"], launch_args_override=args,
                                    cwd=os.getcwd(), env={**os.environ, "SDK_EXECUTION_FAULT": str(fault).lower()},
                                    request_timeout_seconds=30))
    sdk.initialize(credential="sdk-company-test-credential", cwd=os.getcwd(), provider="company", model="scripted")
    return sdk


def wait(read: Callable[[], T], ready: Callable[[T], bool]) -> T:
    for _ in range(1000):
        value = read()
        if ready(value):
            return value
        time.sleep(0.005)
    raise AssertionError("Python SDK execution did not settle")


sdk = open_sdk(True)


def finished(command_id: str) -> None:
    result = wait(lambda: sdk.get_simulation_request(SimulationRequestInput(commandId=command_id)),
                  lambda value: value.status == "found" and value.request.status != "accepted")
    assert result.status == "found" and result.request.status == "completed"


try:
    created = sdk.create_simulation(SimulationCreateInput(commandId="python-execution-create", templateId="company",
        templateVersion="1", name="Python report continuation", parameters={"buyerName": "Buyer", "supplierName": "Supplier", "initialStock": "2"}))
    run_id = created.runId
    finished(created.commandId)
    sdk.manage_simulation(SimulationManageInput(runId=run_id, managementId="first-start", phase="running"))
    wait(lambda: sdk.get_simulation_control(SimulationControlInput(runId=run_id)), lambda value: value.driver == "failed")
    rows = sdk.browse_simulation(SimulationBrowseInput(runId=run_id, collection="operations", limit=32))
    original = next(item for item in rows.items if item.kind.text == "communication/post")
    sdk.checkpoint_simulation(SimulationCheckpointInput(runId=run_id, commandId="python-execution-cut"))
    finished("python-execution-cut")
    sdk.close()
    sdk = open_sdk(False)
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).owner == "not-held"
    sdk.restore_simulation(SimulationRestoreInput(runId=run_id, commandId="python-execution-restore", checkpointId="product-checkpoint/python-execution-cut"))
    finished("python-execution-restore")
    assert sdk.get_simulation_control(SimulationControlInput(runId=run_id)).phase == "paused"
    sdk.manage_simulation(SimulationManageInput(runId=run_id, managementId="second-start", phase="running"))
    reviews = wait(lambda: sdk.list_simulation_task_reviews(SimulationTaskReviewListInput(runId=run_id)),
                   lambda value: any(item.action.allowed for item in value.items))
    target = next(item for item in reviews.items if item.action.allowed)
    assert target.attemptCount == 2 and target.evidence.report.operationId == original.id
    selector = json.loads((root / "sdk-execution-continuation.json").read_text())
    context = sdk.inspect_simulation_object(SimulationObjectInput(runId=run_id, collection="decisions", id=selector["decisionId"], section="context", limit=32))
    assert context.value.section == "context"
    texts = "\n".join(item.body.text for item in context.value.items.items if item.kind == "section" and item.body.status == "text")
    assert "reportContinuation" in texts and selector["report"]["operationId"] in texts
    assert selector["report"]["contextFingerprint"] in texts
    recorded = [validated_coordinator_event(Notification("session.event", {"event": event}))
                for event in selector["history"]["events"] if event["type"] == "simulation/context-view"]
    assert len(recorded) >= 2
    original_context = selector["originalContext"]
    assert next(event["data"] for event in recorded if event["data"]["inputId"] == original_context["inputId"]) == original_context
    header, scope = selector["history"]["meta"], selector["scope"]
    assert header["id"] == scope["sessionId"] and header["teamId"] == target.teamId == scope["teamId"]
    assert header["participantId"] == scope["participantId"]
    recovered_input = next(event for event in recorded if "reportContinuation" in json.dumps(event["data"]["content"]))
    assert selector["report"]["operationId"] in json.dumps(recovered_input)
    assert selector["report"]["contextFingerprint"] in json.dumps(recovered_input)
    assert all(event["data"]["runId"] == run_id and event["data"]["entityId"] == "buyer" for event in recorded)
    sdk.resolve_simulation_task_review(SimulationTaskReviewResolveInput(runId=run_id, commandId="python-execution-approve",
        operationId=target.operationId, attemptId=target.attemptId, expectedRevision=target.taskRevision, nextPhase="completed",
        reason="Verified original report and recorded source context"))
    finished("python-execution-approve")
    wait(lambda: sdk.get_simulation_control(SimulationControlInput(runId=run_id)), lambda value: value.stop == "completed")
    final = sdk.browse_simulation(SimulationBrowseInput(runId=run_id, collection="operations", limit=32))
    assert sum(item.kind.text == "communication/post" for item in final.items) == 1
    print(json.dumps({"sdk": "python", "originalReport": "preserved", "continuationInput": "recorded-and-authorized",
                      "attempts": 2, "reports": 1, "inference": False, "restored": "paused", "review": "completed"}))
finally:
    sdk.close()
