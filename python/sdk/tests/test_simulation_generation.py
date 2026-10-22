"""Generation wire DTOs and original identity checks match the Native transport."""
import copy
import pytest
from pydantic import ValidationError
from clocky import (HarnessClient, HarnessConfig, SdkProtocolError, SimulationGenerationRequest,
    SimulationGenerationRead, SimulationGenerationResult, SimulationGenerationTransition)

JOB = dict(id="original", purpose="explanation", assistantEntityId="helper", scope="org", audience=["org"],
    inputs=[dict(source="user-authored", content="Public input", audience=["org"])], outputSchema="text/1",
    model=dict(provider="fixture", name="fixture", version="1"), promptVersion="clocky.product-generation/1", policyVersion="1",
    budget=dict(maxTokens=100, maxOutputBytes=1000, maxAttempts=1), deadline="100")
RESULT = dict(apiVersion="clocky.generation/v1", runId="run", job=dict(job=JOB,
    binding=dict(teamId="team", participantId="participant", sessionId="session"), acceptedSequence=1, interval="0", status="accepted"))


def test_generation_request_and_retained_result_reject_forged_fields():
    assert SimulationGenerationRequest(runId="run", job=JOB).job.id == "original"
    assert SimulationGenerationResult.model_validate(RESULT).job.usage is None
    for patch in (dict(audience=["private"]), dict(outputSchema="persona/1"), dict(purpose="domain-plan"),
                  dict(inputs=[dict(source="private-source", content="secret", audience=["org"])]),
                  dict(budget=dict(maxTokens=100, maxOutputBytes=1000, maxAttempts=True))):
        with pytest.raises(ValidationError):
            SimulationGenerationRequest(runId="run", job={**JOB, **patch})
    for patch in (dict(apiVersion="future"), dict(nativeProof={})):
        with pytest.raises(ValidationError):
            SimulationGenerationResult.model_validate({**RESULT, **patch})
    with pytest.raises(ValidationError):
        SimulationGenerationTransition(runId="run", change=dict(kind="output", id="original", content="forged"))


def test_generation_clients_correlate_original_job_and_keep_reads_inert(monkeypatch):
    client = HarnessClient(HarnessConfig())
    value = SimulationGenerationResult.model_validate(copy.deepcopy(RESULT))
    calls = []
    def dispatch(method, params, **kwargs):
        calls.append((method, params))
        return value
    monkeypatch.setattr(client, "request", dispatch)
    request = SimulationGenerationRequest(runId="run", job=JOB)
    selected = SimulationGenerationRead(runId="run", jobId="original")
    assert client.generation_request(request) == value
    assert client.generation_read(selected) == value
    assert client.generation_execute(selected) == value
    assert [call[0] for call in calls] == ["simulation/generation-request", "simulation/generation-read", "simulation/generation-execute"]
    value.job.job.id = "another"
    with pytest.raises(SdkProtocolError):
        client.generation_execute(selected)
    value.job = None
    assert client.generation_read(selected).job is None
    with pytest.raises(SdkProtocolError):
        client.generation_execute(selected)
