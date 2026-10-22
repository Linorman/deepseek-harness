"""Finite hiring history keeps complete granted bodies, exact selectors and required nulls."""
from copy import deepcopy
import json
import pytest
from pydantic import ValidationError
from clocky import SimulationWorldDomainResult, SimulationWorldDomainInput, SimulationWorldManagementDraft


def sample():
    coverage = {"loaded": 1, "total": 1, "revision": 7, "scope": "hiring-market/persona-draft", "complete": True}
    draft = {"kind": "persona-draft", "id": "draft", "organizationEntityId": "org", "positionEntityId": "position",
             "revision": 2, "validUntil": "90", "bodyHash": "sha256:" + "a" * 64,
             "body": {"templateId": "template", "templateVersion": "1", "persona": {"name": "Original", "skills": [], "traits": [], "goals": []}},
             "source": {"kind": "finite-template", "actorId": "author", "user": None, "generatorVersion": "finite-template/1",
                        "modelVersion": None, "templateId": "template", "templateVersion": "1", "policyVersion": "1"},
             "prior": {"revision": 1, "bodyHash": "sha256:" + "b" * 64}, "editedBy": {"actorId": "author", "user": None},
             "status": "draft", "reviewerId": None, "reviewerSource": None, "reviewReason": None}
    return {"apiVersion": "clocky.world-read/v1", "runId": "run", "snapshotRevision": 7, "readVersion": "policy", "observedAt": 1,
            "kind": "hiring-market", "selection": {"kind": "hiring-market", "runId": "run", "family": "persona-draft"}, "status": "found",
            "coverage": coverage, "value": {"runId": "run", "coverage": coverage, "rows": [{"id": "draft", "revision": 2, "current": True,
             "requestId": "request", "sequence": 6, "status": "draft", "body": {"state": "withheld"},
             "detail": {"state": "allowed", "value": draft}, "sources": [{"kind": "record", "sequence": 6}]}]}}


def test_complete_market_detail_preserves_original_nullable_fields_and_rejects_substitution():
    value = sample()
    parsed = SimulationWorldDomainResult.model_validate(value)
    assert parsed.model_dump(exclude_none=True) == value
    for change in ["id", "revision", "status", "family"]:
        bad = deepcopy(value)
        if change == "family":
            bad["selection"]["family"] = "offer-revision"
            bad["coverage"]["scope"] = "hiring-market/offer-revision"
        else:
            bad["value"]["rows"][0]["detail"]["value"][change] = 3 if change == "revision" else "substitution"
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate(bad)
    with pytest.raises(ValidationError):
        SimulationWorldDomainInput.model_validate({"kind": "hiring-market", "runId": "run", "family": "persona-draft", "persona": True})


def test_management_command_keeps_original_json_and_utf16_bounds():
    command = json.dumps({"kind": "review", "id": "draft", "revision": 2, "bodyHash": "sha256:" + "a" * 64,
                          "organizationEntityId": "org", "positionEntityId": "position", "decision": "rejected", "reason": "Revise selection."})
    value = {"runId": "run", "targetId": "position", "expectedRevision": 7, "action": "hiring-market", "values": {"command": command}}
    assert SimulationWorldManagementDraft.model_validate(value).model_dump(exclude_none=True) == value
    for text in ["", "😀" * 32769]:
        with pytest.raises(ValidationError):
            SimulationWorldManagementDraft.model_validate({**value, "values": {"command": text}})


def test_generated_persona_source_preserves_original_session_and_rejects_missing_provenance():
    value = sample()
    source = value["value"]["rows"][0]["detail"]["value"]["source"]
    source.update(kind="generation", generatorVersion="isolated-generation/1", modelVersion="model-v1",
                  generationJobId="original-job", sessionId="original-session", sessionSequence=0)
    assert SimulationWorldDomainResult.model_validate(value).model_dump(exclude_none=True) == value
    for key in ("generationJobId", "sessionId", "sessionSequence", "modelVersion"):
        bad = deepcopy(value)
        del bad["value"]["rows"][0]["detail"]["value"]["source"][key]
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate(bad)
    bad = deepcopy(value)
    bad["value"]["rows"][0]["detail"]["value"]["source"]["kind"] = "finite-template"
    with pytest.raises(ValidationError):
        SimulationWorldDomainResult.model_validate(bad)
