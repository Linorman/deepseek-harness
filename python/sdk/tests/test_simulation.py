"""Simulation clients preserve exact public selections and durable command identities."""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from clocky import Clocky, ClockyConfig, HarnessClient, HarnessConfig, SdkProtocolError
from clocky.simulation import (
    SimulationWatchInput, SimulationWatchResult,
    SimulationControlInput, SimulationControl, SimulationManageInput, SimulationManageResult, SimulationManagementInput,
    SimulationManagementResult, SimulationCheckpointInput, SimulationRestoreInput, SimulationIngressInput,
    SimulationIngressQuery, SimulationIngressResult, SimulationControlAction, SimulationManagementReceipt,
    SimulationBrowseInput, SimulationCatalog, SimulationCollectionPage, SimulationCreateInput,
    SimulationInspectInput, SimulationInspection, SimulationListInput, SimulationObjectInput,
    SimulationObjectInspection, SimulationPrepareInput, SimulationRequestInput, SimulationRequestReceipt,
    SimulationRequestResult, SimulationScenarioObserved,
)

SUMMARY = {"id": "run", "name": {"text": "Company", "truncated": False}, "registeredAt": 1, "observation": "not-observed"}
RECEIPT = {"commandId": "original", "runId": "run", "kind": "create", "acceptedAt": 1, "status": "accepted"}
SELECTION = {"collection": "entities", "id": "entity", "section": "identity"}


def test_watch_dto_is_metadata_only_and_separates_provider_state_from_policy() -> None:
    request = SimulationWatchInput(runId="run", waitMs=0)
    assert request.waitMs == 0
    value = SimulationWatchResult(runId="run", readVersion="version", cursor="opaque", status="reset",
                                 observedAt=1, world={"status": "unavailable"})
    assert value.world.status == "unavailable"
    with pytest.raises(ValidationError):
        SimulationWatchInput(runId="run", waitMs=-1)
    with pytest.raises(ValidationError):
        SimulationWatchResult.model_validate({**value.model_dump(), "world": {"status": "observed", "body": "private"}})


def test_knowledge_selection_is_exact_and_cannot_substitute_a_premise() -> None:
    request = SimulationObjectInput(runId="run", collection="decisions", id="decision", section="knowledge",
                                    reference={"id": "selected", "revision": 1}, limit=2)
    assert request.reference.revision == 1
    selection = {"collection": "decisions", "id": "decision", "section": "knowledge", "reference": {"id": "selected", "revision": 1}}
    value = {"collection": "decisions", "id": "decision", "section": "knowledge", "selected": selection["reference"],
             "readVersion": "v1", "bodyAccess": "withheld", "entityId": "actor", "time": "9007199254740993",
             "cutoffRevision": 3, "knowledge": {"total": 0, "items": []}}
    result = SimulationObjectInspection.model_validate({"runId": "run", "snapshotRevision": 4, "observedAt": 1,
        "selection": selection, "status": "found", "value": value})
    assert result.value.time == "9007199254740993"
    with pytest.raises(ValidationError):
        SimulationObjectInspection.model_validate({"runId": "run", "snapshotRevision": 4, "observedAt": 1,
            "selection": selection, "status": "found", "value": {**value, "selected": {"id": "another", "revision": 1}}})
    with pytest.raises(ValidationError):
        SimulationObjectInput(runId="run", collection="entities", id="entity", section="knowledge", reference=selection["reference"])


def test_relationship_and_context_sections_preserve_exact_paged_dtos() -> None:
    for collection, section in [("entities", "relationships"), ("decisions", "context")]:
        assert SimulationObjectInput(runId="run", collection=collection, section=section, id="object", limit=2).limit == 2
    selection = {"collection": "entities", "section": "relationships", "id": "entity"}
    result = SimulationObjectInspection.model_validate({"runId": "run", "snapshotRevision": 10, "observedAt": 1,
        "status": "found", "selection": selection, "value": {**selection, "time": "9007199254740993", "relationships": {
            "total": 2, "nextCursor": "opaque", "items": [{"id": "relation", "subject": "entity", "object": "org",
                "relation": {"text": "member-of", "truncated": False}, "revision": 1, "validFrom": "9007199254740992",
                "validUntil": "9007199254740993", "active": False}]}}})
    assert result.value.relationships.items[0].validUntil == "9007199254740993"
    selection = {"collection": "decisions", "section": "context", "id": "decision"}
    value = {**selection, "readVersion": "v1", "accounting": {"status": "prepared", "retainedBytes": 10, "maxBytes": 100,
        "knowledgeCount": 0, "sourceCount": 0, "sectionCount": 1, "content": "withheld"}, "bodyAccess": "allowed",
        "frozen": {"time": "9007199254740993", "slot": "10", "epoch": "1", "entityId": "entity",
            "projections": {"run": 3, "entity": 2, "team": 1},
            "versions": {key: {"text": "1", "truncated": False} for key in ["rules", "policy", "persona", "model"]}},
        "items": {"total": 1, "items": [{"kind": "section", "index": 0, "block": 0,
            "section": {"text": "input", "truncated": False}, "required": True,
            "body": {"status": "text", "text": "原始🙂", "part": 0, "parts": 1}}]}}
    result = SimulationObjectInspection.model_validate({"runId": "run", "snapshotRevision": 10, "observedAt": 1,
        "status": "found", "selection": selection, "value": value})
    assert result.value.items.items[0].body.text == "原始🙂"
    with pytest.raises(ValidationError):
        SimulationObjectInspection.model_validate({"runId": "run", "snapshotRevision": 10, "observedAt": 1,
            "status": "found", "selection": selection, "value": {**value, "bodyAccess": "withheld"}})
    with pytest.raises(ValidationError):
        SimulationObjectInput(runId="run", collection="operations", section="context", id="decision")
CREATE = SimulationCreateInput(commandId="original", templateId="company", templateVersion="1", name="Company",
                              expectedModel={"provider": "company", "name": "scripted"},
                              parameters={"buyerName": "Buyer", "supplierName": "Supplier", "initialStock": "2"})


@pytest.mark.parametrize("execution", ["cognition-only", "automatic-tasks"])
def test_catalog_preserves_the_installed_task_execution_mode(execution: str) -> None:
    catalog = SimulationCatalog.model_validate({"items": [{
        "id": "company", "version": "1", "name": {"text": "Company", "truncated": False},
        "kind": "company-procurement", "readiness": {"status": "ready", "model": {"provider": "company", "name": "scripted"}},
        "tickUnit": {"text": "minute", "truncated": False}, "execution": execution, "review": "none", "maxStock": "2",
    }]})
    assert catalog.items[0].execution == execution


CONTROL = {"administration": {"actions": {name: {"allowed": True, "reason": "ready"}
                            for name in ["checkpoint", "restore", "prepare", "ingress"]},
                "ingress": {"maxTime": "1000", "maxBytes": 65536, "targets": []}}, "budget": {"model": {"provider": "company", "name": "scripted"}, "tokensPerRequest": 10000,
                       "tokensPerInterval": 1000000, "interval": "100", "residentActors": 2, "sharedModelLimit": 1}, "runId": "run", "owner": "held", "phase": "paused", "revision": 1, "driver": "idle", "inFlight": False,
           "observedAt": 1, "actions": {"start": {"allowed": True, "reason": "ready"}, "pause": {"allowed": True, "reason": "ready"}}}
MANAGEMENT = {"managementId": "management", "phase": "running", "status": "completed", "startedSequence": 1, "finishedSequence": 2}
INGRESS = {"runId": "run", "ingressId": "input", "entityId": "entity", "eventId": "event", "availableAt": "9007199254740993",
           "assignedAt": "9007199254740993", "sequence": 1, "status": "pending"}
MAINTENANCE_CASES = [
    ("get_simulation_control", "runs-control", SimulationControlInput(runId="run"), CONTROL),
    ("manage_simulation", "runs-manage", SimulationManageInput(runId="run", managementId="management", phase="running"),
     {"runId": "run", "operation": MANAGEMENT, "control": CONTROL}),
    ("get_simulation_management", "management-get", SimulationManagementInput(runId="run", managementId="management"),
     {"runId": "run", "managementId": "management", "status": "found", "operation": MANAGEMENT}),
    ("checkpoint_simulation", "runs-checkpoint", SimulationCheckpointInput(runId="run", commandId="original"),
     {**RECEIPT, "kind": "checkpoint", "checkpointId": "cut"}),
    ("restore_simulation", "runs-restore", SimulationRestoreInput(runId="run", commandId="original", checkpointId="cut"),
     {**RECEIPT, "kind": "restore", "checkpointId": "cut"}),
    ("ingress_simulation", "runs-ingress", SimulationIngressInput(runId="run", ingressId="input", entityId="entity", text="Input", availableAt=INGRESS["availableAt"]), INGRESS),
    ("get_simulation_ingress", "ingress-get", SimulationIngressQuery(runId="run", ingressId="input"),
     {"runId": "run", "ingressId": "input", "status": "found", "receipt": INGRESS}),
]
CASES = MAINTENANCE_CASES + [
    ("simulation_catalog", "catalog", None, {"items": []}),
    ("list_simulations", "runs-list", SimulationListInput(), {"items": [SUMMARY]}),
    ("inspect_simulation", "runs-inspect", SimulationInspectInput(runId="run"), {"run": SUMMARY, "status": "missing"}),
    ("browse_simulation", "collections-list", SimulationBrowseInput(runId="run", collection="entities"),
     {"runId": "run", "collection": "entities", "snapshotRevision": 1, "observedAt": 1, "total": 0, "items": []}),
    ("inspect_simulation_object", "objects-inspect", SimulationObjectInput(runId="run", **SELECTION),
     {"runId": "run", "selection": SELECTION, "snapshotRevision": 1, "observedAt": 1, "status": "missing"}),
    ("create_simulation", "runs-create", CREATE, RECEIPT),
    ("prepare_simulation", "runs-prepare", SimulationPrepareInput(runId="run", commandId="original"), {**RECEIPT, "kind": "prepare"}),
    ("get_simulation_request", "requests-get", SimulationRequestInput(commandId="original"), {"status": "found", "request": RECEIPT}),
]

@pytest.mark.parametrize("method,wire,input,output", CASES)
def test_clients_use_strict_actor_free_wire(method, wire, input, output, monkeypatch):
    client = HarnessClient(HarnessConfig())
    calls = []
    def request(name, payload, **_options):
        calls.append((name, payload))
        return output
    monkeypatch.setattr(client, "_request_raw", request)
    result = getattr(client, method)(input) if input else getattr(client, method)()
    assert result.model_dump(exclude_none=True) == output
    assert calls == [(f"simulation/{wire}", input.model_dump(exclude_none=True) if input else {})]
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
    high._client = client
    monkeypatch.setattr(high, "start", lambda: None)
    high_result = getattr(high, method)(input) if input else getattr(high, method)()
    assert high_result.model_dump(exclude_none=True) == output

@pytest.mark.parametrize("method,wire,input,output", [case for case in CASES if case[0] not in {"simulation_catalog", "list_simulations"}])
def test_clients_refuse_foreign_results(method, wire, input, output, monkeypatch):
    client = HarnessClient(HarnessConfig())
    foreign = dict(output)
    if method == "inspect_simulation":
        foreign["run"] = {**SUMMARY, "id": "foreign"}
    elif method == "get_simulation_request":
        foreign["request"] = {**RECEIPT, "commandId": "foreign"}
    elif method in {"create_simulation", "prepare_simulation"}:
        foreign["commandId"] = "foreign"
    else:
        foreign["runId"] = "foreign"
    if "control" in foreign:
        foreign["control"] = {**foreign["control"], "runId": "foreign"}
    if "receipt" in foreign:
        foreign["receipt"] = {**foreign["receipt"], "runId": "foreign"}
    monkeypatch.setattr(client, "_request_raw", lambda *_args, **_kwargs: foreign)
    with pytest.raises(SdkProtocolError, match="different selection"):
        getattr(client, method)(input)


def test_canonical_decimal_time_and_redacted_bodies():
    inspection = SimulationInspection.model_validate({"run": SUMMARY, "status": "observed", "world": {
        "revision": 1, "phase": "paused", "time": "9007199254740993", "tickUnit": {"text": "tick", "truncated": False},
        "owner": "unowned", "entityCount": 0, "decisionCount": 0, "operationCount": 0, "observedAt": 1}})
    assert inspection.world.time == "9007199254740993"
    for time in [9007199254740993, "01", "1.5", "-1"]:
        payload = inspection.model_dump(exclude_none=True)
        payload["world"]["time"] = time
        with pytest.raises(ValidationError):
            SimulationInspection.model_validate(payload)
    with pytest.raises(ValidationError):
        SimulationCatalog.model_validate({"items": [], "providerSecret": "hidden"})
    with pytest.raises(ValidationError):
        SimulationCreateInput.model_validate({**CREATE.model_dump(), "provider": "arbitrary"})


def test_collection_filters_and_section_pagination():
    for payload in [dict(runId="run", collection="entities", status="accepted"),
                    dict(runId="run", collection="checkpoints", entityId="entity"),
                    dict(runId="run", collection="decisions", status="completed")]:
        with pytest.raises(ValidationError):
            SimulationBrowseInput.model_validate(payload)
    for payload in [dict(runId="run", collection="entities", id="entity", section="identity", limit=1),
                    dict(runId="run", collection="entities", id="entity", section="execution")]:
        with pytest.raises(ValidationError):
            SimulationObjectInput.model_validate(payload)
    with pytest.raises(ValidationError):
        SimulationCollectionPage.model_validate({"runId": "run", "collection": "entities", "snapshotRevision": 1,
                                                "observedAt": 1, "total": 0, "items": [{"id": "checkpoint", "status": "completed",
                                                "startedSequence": 1, "latestSuccessful": True, "sourceValidation": "not-performed"}]})


def test_exact_receipt_and_presence_invariants():
    assert SimulationRequestResult.model_validate({"status": "not-found", "commandId": "original"}).request is None
    for payload in [{"status": "found", "commandId": "original"}, {"status": "not-found", "request": RECEIPT}]:
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate(payload)
    for payload in [{**RECEIPT, "status": "failed"}, {**RECEIPT, "failure": "unavailable"}]:
        with pytest.raises(ValidationError):
            SimulationRequestReceipt.model_validate(payload)
    with pytest.raises(ValidationError):
        SimulationObjectInspection.model_validate({"runId": "run", "selection": SELECTION,
                                                   "snapshotRevision": 1, "observedAt": 1, "status": "found"})


def test_revision_absence_and_command_kind_correlations(monkeypatch):
    client = HarnessClient(HarnessConfig())
    monkeypatch.setattr(client, "_request_raw", lambda *_args, **_kwargs: {"status": "not-found", "commandId": "foreign"})
    with pytest.raises(SdkProtocolError):
        client.get_simulation_request(SimulationRequestInput(commandId="original"))
    monkeypatch.setattr(client, "_request_raw", lambda *_args, **_kwargs: {**RECEIPT, "kind": "prepare"})
    with pytest.raises(SdkProtocolError):
        client.create_simulation(CREATE)
    monkeypatch.setattr(client, "_request_raw", lambda *_args, **_kwargs: {"runId": "run", "selection": SELECTION,
                                                                        "snapshotRevision": 2, "observedAt": 1, "status": "missing"})
    with pytest.raises(SdkProtocolError):
        client.inspect_simulation_object(SimulationObjectInput(runId="run", **SELECTION, expectedRevision=1))
    monkeypatch.setattr(client, "_request_raw", lambda *_args, **_kwargs: {"items": []})
    assert client.list_simulations().items == []


def test_original_maintenance_request_receipts_are_closed_and_linked_to_a_checkpoint():
    for kind in ["checkpoint", "restore"]:
        receipt = SimulationRequestReceipt.model_validate({**RECEIPT, "kind": kind, "checkpointId": "full-cut"})
        assert receipt.checkpointId == "full-cut"
        result = SimulationRequestResult.model_validate({"status": "found", "request": receipt.model_dump(exclude_none=True)})
        assert result.request.kind == kind
        with pytest.raises(ValidationError):
            SimulationRequestReceipt.model_validate({**RECEIPT, "kind": kind})
    with pytest.raises(ValidationError):
        SimulationRequestReceipt.model_validate({**RECEIPT, "checkpointId": "unexpected"})

@pytest.mark.parametrize("method,wire,input,output", MAINTENANCE_CASES)
def test_maintenance_refuses_foreign_run_results(method, wire, input, output, monkeypatch):
    client = HarnessClient(HarnessConfig())
    foreign = {**output, "runId": "foreign"}
    if "control" in foreign:
        foreign["control"] = {**foreign["control"], "runId": "foreign"}
    if "receipt" in foreign:
        foreign["receipt"] = {**foreign["receipt"], "runId": "foreign"}
    monkeypatch.setattr(client, "_request_raw", lambda *_args, **_kwargs: foreign)
    with pytest.raises(SdkProtocolError):
        getattr(client, method)(input)


def test_management_presence_terminal_and_action_invariants():
    assert SimulationManagementResult(runId="run", managementId="management", status="not-found").operation is None
    assert SimulationIngressResult(runId="run", ingressId="input", status="not-found").receipt is None
    for model, payload in [
        (SimulationControlAction, {"allowed": True, "reason": "recovery-required"}),
        (SimulationControlAction, {"allowed": False, "reason": "ready"}),
        (SimulationManagementReceipt, {**MANAGEMENT, "finishedSequence": None}),
        (SimulationManagementReceipt, {**MANAGEMENT, "status": "in-progress"}),
        (SimulationManagementReceipt, {**MANAGEMENT, "status": "failed"}),
        (SimulationManagementReceipt, {**MANAGEMENT, "failure": "details-withheld"}),
        (SimulationManageResult, {"runId": "foreign", "operation": MANAGEMENT, "control": CONTROL}),
        (SimulationManagementResult, {"runId": "run", "managementId": "management", "status": "found"}),
        (SimulationManagementResult, {"runId": "run", "managementId": "foreign", "status": "found", "operation": MANAGEMENT}),
        (SimulationManagementResult, {"runId": "run", "managementId": "management", "status": "not-found", "operation": MANAGEMENT}),
        (SimulationIngressResult, {"runId": "run", "ingressId": "input", "status": "found"}),
        (SimulationIngressResult, {"runId": "run", "ingressId": "foreign", "status": "found", "receipt": INGRESS}),
        (SimulationIngressResult, {"runId": "foreign", "ingressId": "input", "status": "found", "receipt": INGRESS}),
        (SimulationIngressResult, {"runId": "run", "ingressId": "input", "status": "not-found", "receipt": INGRESS}),
    ]:
        with pytest.raises(ValidationError):
            model.model_validate(payload)


@pytest.mark.parametrize("model,payload", [
    (SimulationManageInput, {"runId": "run", "managementId": "management", "phase": "running", "expectedRevision": 1}),
    (SimulationRestoreInput, {"runId": "run", "commandId": "original", "checkpointId": "cut", "rollback": True}),
    (SimulationCheckpointInput, {"runId": "run", "commandId": "original", "maxAttempts": 99}),
    (SimulationIngressInput, {"runId": "run", "ingressId": "input", "entityId": "entity", "text": "Input", "availableAt": "01"}),
    (SimulationIngressInput, {"runId": "run", "ingressId": "input", "entityId": "entity", "text": "Input", "availableAt": "1", "source": "admin"}),
])
def test_maintenance_refuses_untrusted_configuration(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)


def test_maintenance_exact_target_and_original_intent_correlations(monkeypatch):
    client = HarnessClient(HarnessConfig())
    def reject(method, request, payload):
        monkeypatch.setattr(client, "_request_raw", lambda *_args, **_kwargs: payload)
        with pytest.raises(SdkProtocolError):
            getattr(client, method)(request)
    for operation in [{**MANAGEMENT, "managementId": "foreign"}, {**MANAGEMENT, "phase": "paused"}]:
        reject("manage_simulation", SimulationManageInput(runId="run", managementId="management", phase="running"),
               {"runId": "run", "operation": operation, "control": CONTROL})
    for payload in [{**RECEIPT, "kind": "prepare"}, {**RECEIPT, "kind": "checkpoint", "checkpointId": "cut", "commandId": "foreign"}]:
        reject("checkpoint_simulation", SimulationCheckpointInput(runId="run", commandId="original"), payload)
    for payload in [{**RECEIPT, "kind": "checkpoint", "checkpointId": "cut"},
                    {**RECEIPT, "kind": "restore", "checkpointId": "foreign"},
                    {**RECEIPT, "kind": "restore", "checkpointId": "cut", "commandId": "foreign"}]:
        reject("restore_simulation", SimulationRestoreInput(runId="run", commandId="original", checkpointId="cut"), payload)
    for payload in [{**INGRESS, "ingressId": "foreign"}, {**INGRESS, "entityId": "foreign"}, {**INGRESS, "availableAt": "2"}]:
        reject("ingress_simulation", SimulationIngressInput(runId="run", ingressId="input", entityId="entity", text="Input", availableAt=INGRESS["availableAt"]), payload)
    reject("get_simulation_management", SimulationManagementInput(runId="run", managementId="management"),
           {"runId": "run", "managementId": "foreign", "status": "not-found"})
    reject("get_simulation_ingress", SimulationIngressQuery(runId="run", ingressId="input"),
           {"runId": "run", "ingressId": "foreign", "status": "not-found"})


def test_records_correlates_original_identity_and_rejects_private_body_without_permission(monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky import SimulationRecordsInput, SimulationRecordsPage
    request = SimulationRecordsInput(runId="run", mode="original", sequence=2, expectedRevision=3, limit=1)
    data = {"runId": "run", "mode": "original", "selection": {"sequence": 2}, "snapshotRevision": 3,
            "readVersion": "policy", "observedAt": 1, "bodyAccess": "allowed", "totalRecords": 1,
            "items": [{"sequence": 2, "kind": {"text": "run/change", "truncated": False},
                       "body": {"status": "text", "text": "原始🙂", "part": 0, "parts": 1}}]}
    page = SimulationRecordsPage.model_validate(data)
    client = HarnessClient(HarnessConfig())
    monkeypatch.setattr(client, "request", lambda *args, **kwargs: page)
    assert client.read_simulation_records(request).items[0].body.text == "原始🙂"
    for patch in ({"runId": "other"}, {"selection": {"sequence": 1}}, {"snapshotRevision": 4}, {"items": data["items"] * 2}):
        foreign = SimulationRecordsPage.model_validate({**data, **patch})
        monkeypatch.setattr(client, "request", lambda *args, **kwargs: foreign)
        with pytest.raises(SdkProtocolError):
            client.read_simulation_records(request)
    for patch in ({"mode": "metadata"}, {"bodyAccess": "withheld"}, {"items": [{**data["items"][0], "body": {"status": "text", "text": "x", "part": 1, "parts": 1}}]}):
        with pytest.raises(ValidationError):
            SimulationRecordsPage.model_validate({**data, **patch})


def test_frozen_source_correlates_its_selection_and_rejects_redacted_body(monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky import SimulationSourceInput, SimulationSourceInspection
    request = SimulationSourceInput(runId="run", decisionId="decision", sourceIndex=2, expectedRevision=4, envelopeSequence=5, limit=1)
    data = {"runId": "run", "decisionId": "decision", "sourceIndex": 2, "snapshotRevision": 4, "readVersion": "policy", "observedAt": 1,
            "status": "found", "source": {"kind": "team-envelope", "teamId": "team", "channelId": "channel", "envelopeId": "original"},
            "envelope": {"sequence": 5, "kind": {"text": "message", "truncated": False}, "createdAt": 1},
            "items": [{"block": 0, "body": {"status": "text", "text": "original", "part": 0, "parts": 1}}]}
    page = SimulationSourceInspection.model_validate(data)
    client = HarnessClient(HarnessConfig())
    monkeypatch.setattr(client, "request", lambda *args, **kwargs: page)
    assert client.inspect_simulation_source(request).envelope.sequence == 5
    for patch in ({"decisionId": "other"}, {"sourceIndex": 1}, {"snapshotRevision": 3}, {"items": data["items"] * 2}):
        foreign = SimulationSourceInspection.model_validate({**data, **patch})
        monkeypatch.setattr(client, "request", lambda *args, **kwargs: foreign)
        with pytest.raises(SdkProtocolError):
            client.inspect_simulation_source(request)
    for patch in ({"status": "withheld"}, {"status": "searching"}, {"envelope": None}):
        with pytest.raises(ValidationError):
            SimulationSourceInspection.model_validate({**data, **patch})


def test_scene_review_dtos_retain_original_intent_and_refuse_body_grants() -> None:
    from clocky.simulation import SimulationTaskReviewListInput, SimulationTaskReviewResolveInput, SimulationTaskReviewPage
    intent = {"runId": "run", "commandId": "review-original", "operationId": "created-task", "attemptId": "attempt", "expectedRevision": 3,
              "nextPhase": "pending", "reason": "Revise the report"}
    assert SimulationTaskReviewResolveInput.model_validate(intent).model_dump() == intent
    with pytest.raises(ValidationError):
        SimulationTaskReviewListInput.model_validate({"runId": "run", "reviewerId": "forged"})
    with pytest.raises(ValidationError):
        SimulationTaskReviewPage.model_validate({"runId": "run", "snapshotRevision": 2, "observedAt": 1, "items": [], "total": 0, "body": "private"})
    found = {"status": "found", "request": {"runId": "run", "commandId": "review-original", "kind": "review", "acceptedAt": 1, "status": "completed"}, "review": intent}
    assert SimulationRequestResult.model_validate(found).review.nextPhase == "pending"
    with pytest.raises(ValidationError):
        SimulationRequestResult.model_validate({**found, "review": None})


@pytest.mark.parametrize("method,wire", [("list_simulation_task_reviews", "task-reviews-list"), ("resolve_simulation_task_review", "task-reviews-resolve")])
def test_scene_review_public_facades_validate_original_selection(method: str, wire: str, monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky.simulation import SimulationTaskReviewListInput, SimulationTaskReviewResolveInput, SimulationTaskReviewPage
    low = HarnessClient(HarnessConfig())
    request = SimulationTaskReviewListInput(runId="run", limit=1) if wire.endswith("list") else SimulationTaskReviewResolveInput(
        runId="run", commandId="original", operationId="created-task", attemptId="attempt", expectedRevision=3, nextPhase="completed", reason="Approved")
    output = {"runId": "run", "snapshotRevision": 2, "observedAt": 1, "items": [], "total": 0} if wire.endswith("list") else {
        "runId": "run", "commandId": "original", "kind": "review", "acceptedAt": 1, "status": "accepted"}
    calls = []
    def send(name, params, *, response_model):
        calls.append((name, params))
        return response_model.model_validate(output)
    monkeypatch.setattr(low, "request", send)
    assert getattr(low, method)(request).runId == "run"
    assert calls == [("simulation/" + wire, request.model_dump(exclude_none=True))]
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    assert getattr(high, method)(request).runId == "run"
    output["runId"] = "foreign"
    with pytest.raises(SdkProtocolError):
        getattr(low, method)(request)


def test_runtime_usage_and_shared_pool_are_separate_strict_observations() -> None:
    from clocky.simulation import SimulationModelPoolObserved, SimulationModelPoolUnavailable, SimulationRunMetrics
    pool = {"status": "observed", "clock": "real", "observedAt": 1, "active": 1, "queued": 2, "limit": 2, "queueLimit": 3}
    assert SimulationModelPoolObserved.model_validate(pool).active == 1
    with pytest.raises(ValidationError):
        SimulationModelPoolObserved.model_validate({**pool, "active": 3})
    with pytest.raises(ValidationError):
        SimulationModelPoolUnavailable.model_validate({"status": "unavailable", "clock": "real", "observedAt": 1, "active": 0})
    usage = {"inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0}
    bucket = {"attempts": 0, "statuses": {"reserved": 0, "unknown": 0, "settled": 0, "not-dispatched": 0},
              "outstandingReservedTokens": 0, "settled": usage, "unknownReported": usage}
    attribution = {"total": bucket, "categories": {key: bucket for key in
                   ("business-choice", "adjudication", "result-closeout", "communication", "compaction", "unknown")}}
    metrics = {"tokenAttribution": attribution, "budgets": {"interval": "9007199254740993", "width": "100", "tokens": {"charged": 101, "limit": 100, "unknownAttempts": 1},
                            "decisions": {"used": 3, "limit": 5}, "messages": {"used": 2, "limit": 5}},
               "residentSlots": {"used": 2, "limit": 2, "recoveryRequired": 1}, "pendingDecisionCount": 1,
               "pendingExternalOperationCount": 2, "unknownOperationCount": 1}
    assert SimulationRunMetrics.model_validate(metrics).budgets.tokens.charged == 101
    with pytest.raises(ValidationError):
        SimulationRunMetrics.model_validate({**metrics, "tokenAttribution": {**attribution, "categories": {}}})
    with pytest.raises(ValidationError):
        SimulationRunMetrics.model_validate({**metrics, "tokenAttribution": {**attribution,
            "total": {**bucket, "attempts": 1}}})
    with pytest.raises(ValidationError):
        SimulationRunMetrics.model_validate({**metrics, "residentSlots": {"used": 1, "limit": 2, "recoveryRequired": 2}})
    with pytest.raises(ValidationError):
        SimulationRunMetrics.model_validate({**metrics, "unknownOperationCount": 9_007_199_254_740_992})


def test_run_status_batch_public_clients_correlate_order_and_keep_unavailability_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky.simulation import SimulationRunStatusesInput, SimulationRunStatusesPage
    query = SimulationRunStatusesInput(runIds=["run"])
    output = {"items": [{"run": SUMMARY, "status": "unavailable", "errorSummary": {"text": "Unavailable", "truncated": False},
                          "operational": {"status": "unavailable", "observedAt": 1, "scenario": {"status": "unavailable"}}}],
              "modelPool": {"status": "unavailable", "clock": "real", "observedAt": 1}}
    client = HarnessClient(HarnessConfig())
    calls = []
    def send(method, payload, **options):
        calls.append((method, payload))
        return output
    monkeypatch.setattr(client, "_request_raw", send)
    assert client.get_simulation_run_statuses(query).model_dump(exclude_none=True) == output
    assert calls == [("simulation/runs-statuses", {"runIds": ["run"]})]
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test")); high._client = client
    monkeypatch.setattr(high, "start", lambda: None)
    assert high.get_simulation_run_statuses(query).items[0].status == "unavailable"
    output["items"][0]["run"] = {**SUMMARY, "id": "foreign"}
    with pytest.raises(SdkProtocolError):
        client.get_simulation_run_statuses(query)
    with pytest.raises(ValidationError):
        SimulationRunStatusesInput(runIds=["run", "run"])
    with pytest.raises(ValidationError):
        SimulationRunStatusesPage.model_validate({"items": [], "privateActor": "hidden"})


def test_status_clients_refuse_swapped_duplicated_or_missing_exact_batch_members(monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky.simulation import SimulationRunStatusesInput
    query = SimulationRunStatusesInput(runIds=["run", "other"])
    client = HarnessClient(HarnessConfig())
    run = {"run": SUMMARY, "status": "missing"}
    other = {"run": {**SUMMARY, "id": "other"}, "status": "missing"}
    for items in [[other, run], [run, run], [run]]:
        monkeypatch.setattr(client, "_request_raw", lambda *_args, **_options: {"items": items})
        with pytest.raises(SdkProtocolError):
            client.get_simulation_run_statuses(query)


def test_original_operation_retry_is_strict_normalized_and_queryable_without_implicit_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky.simulation import SimulationOperationRetryInput
    raw = {"runId": "run", "commandId": "retry-original", "operationId": "unknown-operation", "expectedAttemptCount": 3, "reason": "  Recover receipt  "}
    request = SimulationOperationRetryInput.model_validate(raw)
    assert request.reason == "Recover receipt"
    result = {**RECEIPT, "commandId": request.commandId, "kind": "retry-operation"}
    client = HarnessClient(HarnessConfig()); calls = []
    def send(method, payload, **options):
        calls.append((method, payload)); return result
    monkeypatch.setattr(client, "_request_raw", send)
    assert client.retry_simulation_operation(request).kind == "retry-operation"
    assert calls == [("simulation/operation-retry", request.model_dump())]
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test")); high._client = client
    monkeypatch.setattr(high, "start", lambda: None)
    assert high.retry_simulation_operation(request).kind == "retry-operation"
    for count in [0, -1, 1.5, 9_007_199_254_740_992]:
        with pytest.raises(ValidationError):
            SimulationOperationRetryInput.model_validate({**raw, "expectedAttemptCount": count})
    with pytest.raises(ValidationError):
        SimulationOperationRetryInput.model_validate({**raw, "commandId": " spaces "})
    found = {"status": "found", "request": result, "retryOperation": request.model_dump()}
    assert SimulationRequestResult.model_validate(found).retryOperation == request
    for original in [None, {**request.model_dump(), "runId": "other"}, {**request.model_dump(), "commandId": "other"}]:
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate({**found, "retryOperation": original})
    result["kind"] = "review"
    with pytest.raises(SdkProtocolError):
        client.retry_simulation_operation(request)


def test_checkpoint_diagnoses_are_typed_references_and_never_private_provider_messages() -> None:
    from clocky.simulation import SimulationCheckpointDiagnostic
    diagnostic = {"stage": "validate", "code": "binding-mismatch", "subject": {"kind": "session", "sessionId": "session",
                  "teamId": "team", "participantId": "participant"}, "cleanup": "unconfirmed"}
    assert SimulationCheckpointDiagnostic.model_validate(diagnostic).cleanup == "unconfirmed"
    receipt = {**RECEIPT, "kind": "restore", "status": "failed", "failure": "restore-failed", "checkpointId": "original-cut", "diagnostic": diagnostic}
    assert SimulationRequestReceipt.model_validate(receipt).diagnostic.subject.sessionId == "session"
    for private in [{**diagnostic, "message": "Private path /host/secret"}, {**diagnostic, "code": "private-custom-code"},
                    {**diagnostic, "subject": {**diagnostic["subject"], "path": "/host/secret"}}]:
        with pytest.raises(ValidationError):
            SimulationCheckpointDiagnostic.model_validate(private)
    with pytest.raises(ValidationError):
        SimulationRequestReceipt.model_validate({**RECEIPT, "kind": "retry-operation", "diagnostic": diagnostic})
    with pytest.raises(ValidationError):
        SimulationRequestReceipt.model_validate({**receipt, "status": "completed", "failure": None})


def test_retry_capability_not_unknown_is_distinct_from_a_confirmed_target_outcome() -> None:
    from clocky.simulation import SimulationOperationRetryCapability
    pending = {"allowed": False, "reason": "not-unknown", "expectedAttemptCount": 1, "maxAttempts": 3}
    assert SimulationOperationRetryCapability.model_validate(pending).reason == "not-unknown"
    known = {**pending, "reason": "outcome-known"}
    assert SimulationOperationRetryCapability.model_validate(known).reason == "outcome-known"
    with pytest.raises(ValidationError):
        SimulationOperationRetryCapability.model_validate({**pending, "allowed": True})
    with pytest.raises(ValidationError):
        SimulationOperationRetryCapability.model_validate({**pending, "reason": "ready"})


def test_checkpoint_channel_diagnosis_requires_exact_canonical_team_for_navigation() -> None:
    from clocky.simulation import SimulationCheckpointDiagnostic
    channel = {"stage": "validate", "code": "source-moved", "subject": {"kind": "channel", "channelId": "channel", "teamId": "team"}}
    diagnosis = SimulationCheckpointDiagnostic.model_validate(channel)
    assert diagnosis.subject.channelId == "channel"
    assert diagnosis.subject.teamId == "team"
    for subject in [{"kind": "channel", "channelId": "channel"},
                    {"kind": "channel", "channelId": "channel", "teamId": ""},
                    {"kind": "channel", "channelId": "channel", "teamId": "team", "path": "/private"}]:
        with pytest.raises(ValidationError):
            SimulationCheckpointDiagnostic.model_validate({**channel, "subject": subject})
    receipt = {**RECEIPT, "kind": "restore", "checkpointId": "cut", "status": "failed", "failure": "restore-failed", "diagnostic": channel}
    assert SimulationRequestReceipt.model_validate(receipt).diagnostic.subject.teamId == "team"


def test_preflight_preserves_limits_and_serializes_no_command_through_both_apis(monkeypatch):
    from clocky import SimulationPreflightInput, SimulationPreflightResult, SimulationLimitsInput
    draft = SimulationPreflightInput(templateId="company", templateVersion="1", name="Company",
        parameters=CREATE.parameters, limits=SimulationLimitsInput(maxTime="9007199254740993", maxTokensPerInterval=0))
    configuration = {"limits": {"maxEntities": 2, "maxResidentActors": 2, "tokensPerModelRequest": 1000,
        "maxTokensPerInterval": 2000, "maxTime": "9007199254740993"}, "budgetInterval": "100",
        **{key: {"text": "1", "truncated": False} for key in ["tickUnit", "rulesVersion", "policyVersion"]},
        "sharedModelLimit": 1}
    output = {"status": "ready", "configuration": configuration,
        "readiness": {"status": "ready", "model": {"provider": "company", "name": "scripted"}}}
    for high in [False, True]:
        client = HarnessClient(HarnessConfig())
        clocky = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
        monkeypatch.setattr(clocky, "start", lambda: None)
        transport = clocky._client if high else client
        calls = []
        def send(method, params, **_kwargs):
            calls.append((method, params))
            return output
        monkeypatch.setattr(transport, "_request_raw", send)
        result = (clocky if high else client).preflight_simulation(draft)
        assert result.configuration.limits.maxTime == "9007199254740993"
        assert calls == [("simulation/runs-preflight", draft.model_dump(exclude_none=True))]
        assert "commandId" not in calls[0][1]
    assert draft.limits.maxTokensPerInterval == 0
    for unsafe in [{**draft.model_dump(exclude_none=True), "commandId": "allocated"},
                   {**draft.model_dump(exclude_none=True), "limits": {"sharedModelLimit": 100}}]:
        with pytest.raises(ValidationError):
            SimulationPreflightInput.model_validate(unsafe)
    with pytest.raises(ValidationError):
        SimulationPreflightResult.model_validate({"status": "ready", "configuration": {**configuration, "cwd": "/private"}})
    invalid = SimulationPreflightResult.model_validate({"status": "invalid",
        "readiness": {"status": "needs-model", "reason": "default-model-missing"}, "issues": [{"field": "limits.maxEntities",
        "code": "not-allowed", "message": {"text": "Fixed by deployment", "truncated": False}}]})
    assert invalid.issues[0].field == "limits.maxEntities"
    with pytest.raises(ValidationError):
        SimulationPreflightResult.model_validate({**output, "issues": invalid.issues})
    with pytest.raises(ValidationError):
        SimulationPreflightResult.model_validate({**output, "issues": None})
    with pytest.raises(ValidationError):
        SimulationPreflightResult.model_validate({"status": "invalid", "issues": invalid.issues, "configuration": None})


def test_catalog_preserves_workflow_scenario_and_deployment_allowances() -> None:
    configuration = {"limits": {"maxEntities": 2, "maxResidentActors": 2, "tokensPerModelRequest": 1000,
        "maxTokensPerInterval": 2000, "maxTime": "9007199254740993"}, "budgetInterval": "100",
        **{key: {"text": "1", "truncated": False} for key in ["tickUnit", "rulesVersion", "policyVersion"]},
        "sharedModelLimit": 1, "editable": ["maxTime", "maxTokensPerInterval"]}
    item = {"id": "writing", "version": "1", "name": {"text": "Writing", "truncated": False},
        "kind": "task-workflow", "cognition": "deterministic", "readiness": {"status": "ready", "model": {"provider": "company", "name": "scripted"}},
        "tickUnit": {"text": "minute", "truncated": False}, "execution": "automatic-tasks", "review": "participant",
        "maxStock": "2", "configuration": configuration}
    catalog = SimulationCatalog.model_validate({"items": [item]})
    assert catalog.items[0].kind == "task-workflow"
    assert catalog.items[0].cognition == "deterministic"
    assert catalog.items[0].review == "participant"
    assert catalog.items[0].configuration.limits.maxTime == "9007199254740993"
    with pytest.raises(ValidationError):
        SimulationCatalog.model_validate({"items": [{**item, "configuration": {**configuration, "editable": ["provider"]}}]})


def test_workflow_review_requires_persisted_report_without_inventing_inventory_transfer() -> None:
    from clocky import SimulationTaskReviewPage
    row = {"operationId": "create-report", "teamId": "team", "taskId": "task", "attemptId": "attempt",
        "taskRevision": 3, "reviewerEntityId": "supplier", "phase": "review", "attemptCount": 1, "maxAttempts": 2,
        "evidence": {"report": {"operationId": "delivered-report", "delivery": "persisted"}},
        "action": {"allowed": True, "reason": "ready"}}
    output = {"runId": "run", "snapshotRevision": 4, "observedAt": 1, "total": 1, "items": [row]}
    result = SimulationTaskReviewPage.model_validate(output)
    assert result.items[0].reviewerEntityId == "supplier"
    assert result.items[0].evidence.inventoryTransfer is None
    assert result.model_dump(exclude_none=True) == output
    with pytest.raises(ValidationError):
        SimulationTaskReviewPage.model_validate({**output, "items": [{**row, "evidence": {}}]})


def test_original_requests_list_and_retry_use_exact_metadata_through_both_apis(monkeypatch) -> None:
    from clocky import SimulationRequestsInput, SimulationRequestsPage, SimulationRetryRequestInput
    page = {"runId": "run", "snapshotRevision": 2, "items": [RECEIPT], "total": 1}
    inputs = [("list_simulation_requests", "requests-list", SimulationRequestsInput(runId="run", limit=1, expectedRevision=2), page),
              ("retry_simulation_request", "requests-retry", SimulationRetryRequestInput(runId="run", commandId="original"), RECEIPT)]
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    for method, wire, request, output in inputs:
        calls = []
        def send(name, params, **_kwargs):
            calls.append((name, params))
            return output
        monkeypatch.setattr(low, "_request_raw", send)
        for api in [low, high]:
            assert getattr(api, method)(request).model_dump(exclude_none=True) == output
        assert calls == [("simulation/" + wire, request.model_dump(exclude_none=True))] * 2
    for patch in [{"runId": "foreign"}, {"snapshotRevision": 3},
                  {"items": [RECEIPT, {**RECEIPT, "commandId": "second"}], "total": 2}]:
        monkeypatch.setattr(low, "_request_raw", lambda *_args, **_kwargs: {**page, **patch})
        with pytest.raises(SdkProtocolError):
            low.list_simulation_requests(inputs[0][2])
    for patch in [{"runId": "foreign"}, {"commandId": "another-original"}]:
        monkeypatch.setattr(low, "_request_raw", lambda *_args, **_kwargs: {**RECEIPT, **patch})
        with pytest.raises(SdkProtocolError):
            low.retry_simulation_request(inputs[1][2])
    with pytest.raises(ValidationError):
        SimulationRetryRequestInput.model_validate({"runId": "run", "commandId": "original", "input": CREATE.model_dump()})
    for invalid in [{**page, "input": CREATE.model_dump()}, {**page, "items": [{**RECEIPT, "runId": "foreign"}]},
                    {**page, "items": [RECEIPT, RECEIPT], "total": 2}, {**page, "total": 0}]:
        with pytest.raises(ValidationError):
            SimulationRequestsPage.model_validate(invalid)


def test_control_preserves_installed_third_actor_ingress_and_rejects_oversized_target_metadata(monkeypatch) -> None:
    from clocky.simulation import SimulationIngressPolicy
    targets = [{"id": identity, "name": {"text": identity, "truncated": False}} for identity in ["buyer", "supplier", "reviewer"]]
    ingress = {"maxTime": "1000", "maxBytes": 65536, "targets": targets}
    output = {**CONTROL, "administration": {**CONTROL["administration"], "ingress": ingress}}
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    monkeypatch.setattr(low, "_request_raw", lambda *_args, **_kwargs: output)
    for api in [low, high]:
        result = api.get_simulation_control(SimulationControlInput(runId="run"))
        assert [target.id for target in result.administration.ingress.targets] == ["buyer", "supplier", "reviewer"]
    complete = [{"id": f"actor-{index}", "name": {"text": f"Actor {index}", "truncated": False}} for index in range(32)]
    assert len(SimulationIngressPolicy.model_validate({**ingress, "targets": complete}).targets) == 32
    with pytest.raises(ValidationError):
        SimulationIngressPolicy.model_validate({**ingress, "targets": [*complete, targets[-1]]})
    with pytest.raises(ValidationError):
        SimulationIngressPolicy.model_validate({**ingress, "targets": [{**targets[-1], "authorityGrant": {}}]})


def test_task_cancel_dtos_require_explicit_fence_and_reconstruct_only_the_exact_original() -> None:
    from clocky import SimulationTasksInput, SimulationTasksPage, SimulationTaskCancelInput
    input = {"runId": "run", "commandId": "original", "operationId": "operation", "expectedRevision": 3,
             "expectedAttemptId": None, "reason": " Cancel original "}
    parsed = SimulationTaskCancelInput.model_validate(input)
    assert parsed.model_dump()["expectedAttemptId"] is None
    assert parsed.reason == "Cancel original"
    for patch in ({"actor": {}}, {"commandId": " original"}, {"expectedRevision": 0}, {"reason": " "}):
        with pytest.raises(ValidationError):
            SimulationTaskCancelInput.model_validate({**input, **patch})
    with pytest.raises(ValidationError):
        SimulationTaskCancelInput.model_validate({key: value for key, value in input.items() if key != "expectedAttemptId"})
    assert SimulationTasksInput(runId="run", limit=1).limit == 1
    task = {"operationId": "operation", "teamId": "team", "taskId": "task", "taskRevision": 3, "phase": "pending",
            "attemptCount": 0, "maxAttempts": 2, "expectedAttemptId": None, "cancel": {"allowed": True, "reason": "ready"}}
    page = {"runId": "run", "snapshotRevision": 1, "observedAt": 1, "total": 1, "items": [task]}
    assert SimulationTasksPage.model_validate(page).items[0].expectedAttemptId is None
    for patch in ({"total": 0}, {"items": [{**task, "body": "private"}]},
                  {"items": [{**task, "cancel": {"allowed": True, "reason": "terminal"}}]}):
        with pytest.raises(ValidationError):
            SimulationTasksPage.model_validate({**page, **patch})
    receipt = {**RECEIPT, "kind": "cancel-task"}
    result = {"status": "found", "request": receipt, "cancellation": parsed.model_dump()}
    assert SimulationRequestResult.model_validate(result).cancellation.operationId == "operation"
    for foreign in ({"status": "found", "request": receipt},
                    {**result, "cancellation": {**parsed.model_dump(), "commandId": "foreign"}},
                    {**result, "request": RECEIPT}, {"status": "not-found", "commandId": "original", "cancellation": parsed.model_dump()}):
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate(foreign)
    assert SimulationRequestReceipt.model_validate({**receipt, "status": "failed", "failure": "cancel-task-failed"}).status == "failed"
    with pytest.raises(ValidationError):
        SimulationRequestReceipt.model_validate({**receipt, "status": "failed", "failure": "review-failed"})


def test_task_cancel_client_preserves_null_and_correlates_both_public_api_results(monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky import SimulationTasksInput, SimulationTasksPage, SimulationTaskCancelInput
    client = HarnessClient(HarnessConfig())
    request = SimulationTaskCancelInput(runId="run", commandId="original", operationId="operation", expectedRevision=3,
                                        expectedAttemptId=None, reason="Cancel original")
    calls = []
    def send(method, payload, *, response_model):
        calls.append((method, payload, response_model))
        return SimulationRequestReceipt.model_validate({**RECEIPT, "kind": "cancel-task"})
    monkeypatch.setattr(client, "request", send)
    assert client.cancel_simulation_task(request).kind == "cancel-task"
    assert calls[-1][0] == "simulation/tasks-cancel"
    assert "expectedAttemptId" in calls[-1][1] and calls[-1][1]["expectedAttemptId"] is None
    clocky = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
    monkeypatch.setattr(clocky, "start", lambda: None)
    monkeypatch.setattr(clocky._client, "request", send)
    assert clocky.cancel_simulation_task(request).kind == "cancel-task"
    for patch in ({"commandId": "another"}, {"runId": "another"}, {"kind": "review"}):
        value = SimulationRequestReceipt.model_validate({**RECEIPT, "kind": "cancel-task", **patch})
        monkeypatch.setattr(client, "request", lambda *args, **kwargs: value)
        with pytest.raises(SdkProtocolError):
            client.cancel_simulation_task(request)
    query = SimulationTasksInput(runId="run", limit=1, expectedRevision=1)
    data = {"runId": "run", "snapshotRevision": 1, "observedAt": 1, "total": 0, "items": []}
    monkeypatch.setattr(client, "request", lambda *args, **kwargs: SimulationTasksPage.model_validate(data))
    assert client.list_simulation_tasks(query).items == []
    for patch in ({"runId": "other"}, {"snapshotRevision": 2}):
        foreign = SimulationTasksPage.model_validate({**data, **patch})
        monkeypatch.setattr(client, "request", lambda *args, **kwargs: foreign)
        with pytest.raises(SdkProtocolError):
            client.list_simulation_tasks(query)


@pytest.mark.parametrize("execution", ["cognition-only", "automatic-tasks"])
def test_observed_scenario_preserves_the_host_task_execution_mode(execution: str) -> None:
    payload = {"status": "observed", "templateId": {"text": "company", "truncated": False},
               "version": "1", "driverVersion": "1", "execution": execution}
    scenario = SimulationScenarioObserved.model_validate(payload)
    assert scenario.model_dump() == payload
    with pytest.raises(ValidationError):
        SimulationScenarioObserved.model_validate({**payload, "execution": "unsupported"})

@pytest.mark.parametrize("readiness", [
    {"status": "needs-model", "reason": "default-model-missing"},
    {"status": "unavailable", "reason": "metadata-unavailable"},
])
def test_installed_templates_preserve_bounded_model_readiness_without_a_route(readiness) -> None:
    item = {"id": "company", "version": "1", "name": {"text": "Company", "truncated": False},
        "kind": "company-procurement", "readiness": readiness, "tickUnit": {"text": "minute", "truncated": False},
        "execution": "cognition-only", "review": "none", "maxStock": "2"}
    assert SimulationCatalog.model_validate({"items": [item]}).items[0].readiness.status == readiness["status"]
    with pytest.raises(ValidationError):
        SimulationCatalog.model_validate({"items": [{**item, "readiness": {**readiness, "model": CREATE.expectedModel}}]})
    with pytest.raises(ValidationError):
        SimulationCreateInput.model_validate({key: value for key, value in CREATE.model_dump().items() if key != "expectedModel"})


WORLD_STOPS = ["idle", "maintenance-blocked", "position-capacity", "authority-missing", "plan-stale", "plan-budget",
               "entity-capacity", "identity-capacity", "channel-capacity", "world-byte-limit", "world-request-limit",
               "world-command-limit", "world-birth-limit", "world-expansion-limit", "world-mutation-limit", "budget-limit", "context-limit", "microstep-limit", "model-pool-capacity", "activation-history-limit", "message-byte-limit"]


@pytest.mark.parametrize("stop", WORLD_STOPS)
def test_world_stops_survive_control_and_operational_parsing_through_both_public_clients(stop: str, monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky.simulation import SimulationOperationalObserved, SimulationRunStatusesInput
    scenario = {"status": "observed", "templateId": {"text": "world-company", "truncated": False},
                "version": "1", "driverVersion": "1", "execution": "cognition-only"}
    operational = {"status": "observed", "observedAt": 1, "scenario": scenario, "owner": "held",
                   "driver": "waiting", "inFlight": False, "stop": stop}
    output = {**CONTROL, "stop": stop, "versions": {"rulesVersion": {"text": "1", "truncated": False},
        "policyVersion": {"text": "1", "truncated": False}, "tickUnit": {"text": "minute", "truncated": False}, "scenario": scenario}}
    statuses = {"items": [{"run": SUMMARY, "status": "missing", "operational": operational}]}
    assert SimulationControl.model_validate(output).stop == stop
    assert SimulationOperationalObserved.model_validate(operational).model_dump(exclude_none=True) == operational
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    monkeypatch.setattr(low, "_request_raw", lambda method, *_args, **_kwargs:
                        output if method == "simulation/runs-control" else statuses)
    for api in [low, high]:
        assert api.get_simulation_control(SimulationControlInput(runId="run")).model_dump(exclude_none=True) == output
        assert api.get_simulation_run_statuses(SimulationRunStatusesInput(runIds=["run"])).model_dump(exclude_none=True) == statuses
    with pytest.raises(ValidationError) as error:
        SimulationControlAction.model_validate({"allowed": False, "reason": stop})
    assert error.value.errors()[0]["loc"] == ("reason",)


@pytest.mark.parametrize("stop", ["unknown-world-stop", "position-full", "hire-required", "", 0])
def test_unknown_world_stops_are_rejected_in_control_operational_and_public_clients(stop, monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky.simulation import SimulationOperationalObserved, SimulationRunStatusesInput
    operational = {"status": "observed", "observedAt": 1, "scenario": {"status": "unavailable"},
                   "owner": "held", "driver": "waiting", "inFlight": False, "stop": stop}
    for model, payload in [(SimulationControl, {**CONTROL, "stop": stop}), (SimulationOperationalObserved, operational)]:
        with pytest.raises(ValidationError) as error:
            model.model_validate(payload)
        assert error.value.errors()[0]["loc"] == ("stop",)
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="test", provider="test", model="test"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    monkeypatch.setattr(low, "_request_raw", lambda method, *_args, **_kwargs:
                        {**CONTROL, "stop": stop} if method == "simulation/runs-control"
                        else {"items": [{"run": SUMMARY, "status": "missing", "operational": operational}]})
    for api in [low, high]:
        with pytest.raises(SdkProtocolError):
            api.get_simulation_control(SimulationControlInput(runId="run"))
        with pytest.raises(SdkProtocolError):
            api.get_simulation_run_statuses(SimulationRunStatusesInput(runIds=["run"]))


def test_world_stops_keep_existing_start_reasons_and_scenario_execution_vocabulary() -> None:
    for reason in ["ready", "scenario-blocked", "recovery-required", "outcome-unknown"]:
        assert SimulationControlAction.model_validate({"allowed": reason == "ready", "reason": reason}).reason == reason
    scenario = {"status": "observed", "templateId": {"text": "world-company", "truncated": False},
                "version": "1", "driverVersion": "1", "execution": "cognition-only"}
    assert SimulationScenarioObserved.model_validate(scenario).model_dump() == scenario
    for execution in ["cognition-only", "automatic-tasks"]:
        assert SimulationScenarioObserved.model_validate({**scenario, "execution": execution}).execution == execution
    for execution in ["world-director", "world", "automatic-world"]:
        with pytest.raises(ValidationError) as error:
            SimulationScenarioObserved.model_validate({**scenario, "execution": execution})
        assert error.value.errors()[0]["loc"] == ("execution",)


def test_world_case_cancellation_keeps_exact_original_payload_and_refuses_cross_command(monkeypatch):
    from clocky import SimulationWorldCaseCancelInput
    original = SimulationWorldCaseCancelInput(runId="world", commandId="cancel", requestId="case", previewRevision=3, previewHash="sha256:" + "a" * 64)
    receipt = SimulationRequestReceipt(commandId="cancel", runId="world", kind="cancel-world-case", acceptedAt=1, status="completed")
    value = SimulationRequestResult(status="found", request=receipt, worldCancellation=original)
    assert value.worldCancellation == original
    for selected in [None, {**original.model_dump(), "commandId": "another"}, {**original.model_dump(), "runId": "another"}]:
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate({"status": "found", "request": receipt.model_dump(), "worldCancellation": selected})
    for key in ["actor", "principalId", "planId", "maintenance"]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseCancelInput.model_validate({**original.model_dump(), key: "injected"})
    low = HarnessClient(HarnessConfig())
    sent = []
    def send(method, params, **kwargs):
        sent.append((method, params))
        return receipt
    monkeypatch.setattr(low, "request", send)
    assert low.cancel_simulation_world_case(original) == receipt
    assert sent == [("simulation/world-case-cancel", original.model_dump())]
    monkeypatch.setattr(low, "request", lambda *_args, **_kwargs: receipt.model_copy(update={"commandId": "another"}))
    with pytest.raises(SdkProtocolError):
        low.cancel_simulation_world_case(original)


def test_decision_pause_cancellation_is_explicit_without_relabelling_unknown_usage() -> None:
    from clocky.simulation import SimulationDecisionDetail
    value = {"collection": "decisions", "section": "execution", "id": "decision",
             "summary": {"id": "decision", "entityId": "actor", "slot": "1", "time": "0",
                         "snapshotRevision": 1, "status": "cancelled", "operationCount": 0},
             "context": {"status": "absent"}, "cancellation": "paused", "closedAt": 2}
    assert SimulationDecisionDetail.model_validate(value).cancellation == "paused"
    with pytest.raises(ValidationError):
        SimulationDecisionDetail.model_validate({**value, "cancellation": "silently-stopped"})


def test_world_presence_is_optional_but_known_values_are_strict_boolean_metadata():
    base = {"run": SUMMARY, "status": "observed", "world": {"revision": 1, "phase": "paused", "time": "0",
            "tickUnit": {"text": "minute", "truncated": False}, "owner": "unowned", "entityCount": 0,
            "decisionCount": 0, "operationCount": 0, "observedAt": 1}}
    assert SimulationInspection.model_validate(base).world.worldInitialized is None
    assert "worldInitialized" not in SimulationInspection.model_validate(base).model_dump(exclude_none=True)["world"]
    for known in [True, False]:
        parsed = SimulationInspection.model_validate({**base, "world": {**base["world"], "worldInitialized": known}})
        assert parsed.world.worldInitialized is known
    for malformed in [None, 0, 1, "true", "false", {}, []]:
        with pytest.raises(ValidationError):
            SimulationInspection.model_validate({**base, "world": {**base["world"], "worldInitialized": malformed}})
