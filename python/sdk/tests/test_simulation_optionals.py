"""Request and World-case owners distinguish absent optionals from required nullable wire facts."""
import copy
import json
from pathlib import Path
import shutil

import pytest
from pydantic import ValidationError
from clocky import (HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError,
    SimulationWorldCaseInput, SimulationWorldCaseInspection, SimulationWorldCasesPage, SimulationWorldCasesInput)
from clocky.simulation import SimulationRequestResult, SimulationRequestInput

CORPUS = json.loads((Path(__file__).parent / "fixtures/world-case-optional-boundaries.json").read_text())
MODELS = {"inspection": SimulationWorldCaseInspection, "page": SimulationWorldCasesPage,
          "input": SimulationWorldCaseInput, "list-input": SimulationWorldCasesInput}


def change(value, path, delete=False):
    current = copy.deepcopy(value)
    target = current
    for key in path[:-1]:
        target = target[key]
    if delete:
        del target[path[-1]]
    else:
        target[path[-1]] = None
    return current


@pytest.mark.parametrize("row", CORPUS, ids=lambda row: row["label"])
def test_all_reached_case_owner_optionals_reject_null_and_required_nullable_facts_remain_required(row):
    model = MODELS[row["kind"]]
    assert model.model_validate(row["value"]).model_dump(exclude_none=True) == row["value"]
    for path in row["forbiddenNullPaths"]:
        with pytest.raises(ValidationError):
            model.model_validate(change(row["value"], path))
    for path in row["requiredNullPaths"]:
        # The valid original above retains null, even with exclude_none; omission still rejects.
        with pytest.raises(ValidationError):
            model.model_validate(change(row["value"], path, delete=True))


DRAFT = {"runId": "run", "targetId": "person", "expectedRevision": 2, "action": "transfer",
         "values": {"assignmentId": "assignment", "position": "position", "effective": "boundary", "reason": "Original reason"}}
SUBMIT = {"runId": "run", "commandId": "original", "draft": DRAFT, "previewRevision": 3, "previewHash": "sha256:" + "a" * 64}
FOUND = {"status": "found", "request": {"commandId": "original", "runId": "run", "kind": "world-management", "status": "accepted", "acceptedAt": 1},
         "worldManagement": SUBMIT}
MISSING = {"status": "not-found", "commandId": "original"}


def test_request_result_has_exact_discriminant_keys_before_nullable_validation():
    assert SimulationRequestResult.model_validate(FOUND).model_dump(exclude_none=True) == FOUND
    assert SimulationRequestResult.model_validate(MISSING).model_dump(exclude_none=True) == MISSING
    for key in ["request", "review", "retryOperation", "cancellation", "worldCancellation", "worldManagement", "worldManagementOutcome"]:
        for value in [None, {}]:
            with pytest.raises(ValidationError):
                SimulationRequestResult.model_validate({**MISSING, key: value})
    for command in [None, "original"]:
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate({**FOUND, "commandId": command})
    for key in ["review", "retryOperation", "cancellation", "worldCancellation", "worldManagementOutcome"]:
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate({**FOUND, key: None})
    for value in [{"status": "found"}, {"status": "found", "request": None}, {"status": "not-found"},
                  {"status": "not-found", "commandId": None}, {"status": "not-found", "commandId": ""}]:
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate(value)


@pytest.mark.parametrize("level", ["low", "high"])
@pytest.mark.parametrize("mode", ["found-selector-null", "missing-request-null", "case-value-null"])
def test_real_sdk_wire_refuses_null_from_a_forbidden_or_optional_branch(level, mode, tmp_path):
    """Independent Node emits malformed DTO fixtures; no Native business execution is claimed."""
    node = shutil.which("node")
    assert node is not None, "The contract wire test requires the repository Node runtime"
    reply = ({**FOUND, "commandId": None} if mode == "found-selector-null" else {**MISSING, "request": None}
             if mode == "missing-request-null" else {"runId": "run", "requestId": "case", "section": "request", "snapshotRevision": 1,
                                                     "readVersion": "read", "observedAt": 1, "status": "missing", "value": None})
    payload = tmp_path / "reply.json"
    payload.write_text(json.dumps(reply))
    capture = tmp_path / "capture.json"
    script = tmp_path / "null-reply.mjs"
    script.write_text(r"""
import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync } from 'node:fs'
const reply = JSON.parse(readFileSync(process.env.REPLY, 'utf8')), requests = []
const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  const request = JSON.parse(line)
  requests.push(request.method)
  const result = request.method === 'initialize' ? { serverInfo: { name: 'null-reply-contract-peer' } }
    : request.method === 'shutdown' ? {} : reply
  if (request.method === 'shutdown') writeFileSync(process.env.CAPTURE, JSON.stringify({ pid: process.pid, requests }))
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
  if (request.method === 'shutdown') lines.close()
})
""")
    env = {"REPLY": str(payload), "CAPTURE": str(capture)}
    low_config = HarnessConfig(launch_args_override=(node, str(script)), cwd=str(Path.cwd()), env=env, request_timeout_seconds=5)
    client = HarnessClient(low_config) if level == "low" else Clocky(ClockyConfig(credential="codec-fixture", provider="fixture", model="fixture",
        launch_args_override=low_config.launch_args_override, cwd=low_config.cwd, env=env, request_timeout_seconds=5))
    try:
        if level == "low":
            client.initialize(credential="codec-fixture", cwd=str(Path.cwd()), provider="fixture", model="fixture")
        with pytest.raises(SdkProtocolError, match="violates the SDK protocol"):
            if mode == "case-value-null":
                client.inspect_simulation_world_case(SimulationWorldCaseInput(runId="run", requestId="case", section="request"))
            else:
                client.get_simulation_request(SimulationRequestInput(commandId="original"))
    finally:
        client.close()
    observed = json.loads(capture.read_text())
    assert observed["pid"] > 0 and len(observed["requests"]) == 3
