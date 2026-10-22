"""Experiment clients preserve original cuts, bounded references and exact branch commands."""
import pytest
from pydantic import ValidationError
from clocky import (HarnessClient, HarnessConfig, SdkProtocolError, SimulationExperimentSource,
    SimulationWorldBranchInput, SimulationWorldBranchReadInput, SimulationWorldBranchResult,
    SimulationWorldCausalInput, SimulationWorldCausalResult, SimulationWorldCompareInput,
    SimulationWorldCompareResult)

COMMAND = "cf0a4f06-a9fe-4b91-9722-b128f803a508"
SOURCE = dict(runId="parent", archiveCommandId="original")
BRANCH = dict(status="completed", commandId=COMMAND, runId="branch", source=SOURCE,
    sourceHash="a"*64, memoryPolicy="public-facts", phase="paused", realEffects=False)


def test_experiment_strict_original_and_utf16_bounds():
    value = dict(source=SOURCE, commandId=COMMAND, name="  Branch  ", memoryPolicy="public-facts")
    assert SimulationWorldBranchInput.model_validate(value).name == "Branch"
    assert SimulationWorldBranchInput.model_validate({**value, "name": "😀"*128}).name == "😀"*128
    assert SimulationWorldBranchInput.model_validate({**value, "name": "\u0085Name\u0085"}).name == "\u0085Name\u0085"
    for patch in (dict(commandId="bad"), dict(name="😀"*129), dict(name=" \ufeff "), dict(start=True)):
        with pytest.raises(ValidationError):
            SimulationWorldBranchInput.model_validate({**value, **patch})
    assert SimulationExperimentSource.model_validate({**SOURCE, "archiveCommandId":"x"*1000}).archiveCommandId == "x"*1000
    assert SimulationWorldBranchResult.model_validate(BRANCH).status == "completed"
    for patch in (dict(realEffects=0), dict(realEffects=True), dict(phase="running"), dict(status="not-found"), dict(source=None)):
        with pytest.raises(ValidationError):
            SimulationWorldBranchResult.model_validate({**BRANCH, **patch})


def test_branch_client_does_not_accept_another_original(monkeypatch):
    client = HarnessClient(HarnessConfig())
    calls = []
    result = SimulationWorldBranchResult.model_validate(BRANCH)
    def send(method, params, **kwargs):
        calls.append((method, params))
        return result
    monkeypatch.setattr(client, "request", send)
    request = SimulationWorldBranchInput(source=SOURCE, commandId=COMMAND, name="Branch", memoryPolicy="public-facts")
    assert client.branch_world(request) == result
    assert calls[-1] == ("simulation/world-branch", request.model_dump())
    assert client.read_world_branch(SimulationWorldBranchReadInput(commandId=COMMAND)) == result
    result.memoryPolicy = "authorized-memory"
    with pytest.raises(SdkProtocolError):
        client.branch_world(request)
    result.commandId = "00000000-0000-0000-0000-000000000000"
    with pytest.raises(SdkProtocolError):
        client.read_world_branch(SimulationWorldBranchReadInput(commandId=COMMAND))


def test_causal_client_checks_original_and_complete_response_bounds(monkeypatch):
    client = HarnessClient(HarnessConfig())
    result = SimulationWorldCausalResult.model_validate(dict(source=SOURCE, sourceHash="a"*64,
        nodes=[dict(key="decision:one", kind="decision", sequence=1, recordHash="b"*64)], edges=[], coverage="bounded"))
    monkeypatch.setattr(client, "request", lambda *args, **kwargs: result)
    request = SimulationWorldCausalInput(source=SOURCE, root="decision:one", maxDepth=2, maxNodes=1, maxBytes=4096)
    assert client.query_world_causal(request) == result
    with pytest.raises(SdkProtocolError):
        client.query_world_causal(request.model_copy(update={"maxBytes":1}))
    result.nodes += result.nodes
    with pytest.raises(SdkProtocolError):
        client.query_world_causal(request)
    result.nodes = []
    result.source = SimulationExperimentSource(runId="other", archiveCommandId="original")
    with pytest.raises(SdkProtocolError):
        client.query_world_causal(request)


def test_comparison_client_requires_the_selected_observations(monkeypatch):
    request = SimulationWorldCompareInput(left=SOURCE, right=dict(runId="sibling", archiveCommandId="other"))
    result = SimulationWorldCompareResult.model_validate(dict(observations=request.model_dump(), version=1,
        parentCut=dict(runId="parent", hash="a"*64, revision=1), variables=dict(left={},right={}),
        memoryPolicy=dict(left="public-facts",right="authorized-memory"),
        budget=dict(left=dict(maxTokens=100,maxTime="10"),right=dict(maxTokens=200,maxTime="10")),
        differences=[], quality=dict(status="unknown"), cost=dict(status="unknown"),
        stop=dict(left=dict(phase="paused",time="0",stall=None),right=dict(phase="paused",time="0",stall=None)),
        nondeterminism="Model outputs may differ", causalConclusion="not-established"))
    client = HarnessClient(HarnessConfig())
    monkeypatch.setattr(client, "request", lambda *args, **kwargs: result)
    assert client.compare_worlds(request) == result
    result.observations = SimulationWorldCompareInput(left=request.right, right=request.left)
    with pytest.raises(SdkProtocolError):
        client.compare_worlds(request)


def test_original_selection_is_frozen_before_transport_callbacks(monkeypatch):
    client = HarnessClient(HarnessConfig())
    request = SimulationWorldBranchInput(source=SOURCE, commandId=COMMAND, name="Branch", memoryPolicy="public-facts")
    original = SimulationWorldBranchResult.model_validate(BRANCH)
    def send(method, params, **kwargs):
        assert params["source"] == SOURCE
        request.source.runId = "concurrently-changed"
        return original
    monkeypatch.setattr(client, "request", send)
    assert client.branch_world(request) == original
    assert request.source.runId == "concurrently-changed"
