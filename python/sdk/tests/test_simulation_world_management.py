"""Human management strict wires bind original selections; callback uncertainty never fabricates business failure."""
import copy
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from clocky import (HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError, JsonRpcError,
    SimulationWorldManagementDraft, SimulationWorldManagementFieldsInput, SimulationWorldManagementFields,
    SimulationWorldManagementPreview, SimulationWorldManagementSubmitInput, SimulationWorldManagementOutcome)
from clocky.simulation import SimulationRequestReceipt, SimulationRequestResult
from clocky.simulation_native_management import NativeResourceReservation, NativeAuthenticatedUserSource

HASH = "sha256:" + "a" * 64
PIN = {"domain": "organization", "operation": "transfer", "version": "1", "schemaRef": "schema",
       "implementationRef": "implementation", "generation": 1}


def draft(action="transfer"):
    return {"runId": "run", "targetId": "person", "expectedRevision": 2, "action": action,
            "values": ({"assignmentId": "assignment", "effective": "boundary", "reason": "Actual user reason",
                        **({"position": "position"} if action == "transfer" else {"retire": "no"})}
                       if action != "hire-existing" else {"position": "position", "reason": "Actual user hire"})}


def fields(action="transfer"):
    names = (["assignmentId", "position", "effective", "at", "reason"] if action == "transfer"
             else ["assignmentId", "effective", "at", "retire", "reason"] if action == "depart"
             else ["position", "reason"])
    options = {"assignmentId": "assignment", "position": "position", "effective": "boundary", "retire": "no"}
    metadata = []
    for name in names:
        if name == "at":
            metadata.append({"id": name, "kind": "time", "required": False})
        elif name == "reason":
            metadata.append({"id": name, "kind": "text", "required": True, "maxBytes": 2048})
        else:
            metadata.append({"id": name, "kind": "choice", "required": True,
                             "options": [{"id": options[name], "label": name}]})
    return {"apiVersion": "clocky.world-management/v1", "runId": "run", "targetId": "person", "action": action,
            "snapshotRevision": 10, "targetRevision": 2, "status": "available", "fields": metadata}


def preview(action="transfer"):
    source = draft(action)
    impact = {"kind": action, "personId": "person", "organizationEntityId": "org", "authorityRelationIds": []}
    if action == "hire-existing":
        impact["targetPositionId"] = "position"
    else:
        impact.update({"assignmentId": "assignment", "assignmentRevision": 1, "previousPositionId": "old-position", "requestedEffectiveAt": None})
        impact.update({"targetPositionId": "position"} if action == "transfer" else {"retire": False})
    return {"apiVersion": "clocky.world-management/v1", "input": source, "runId": "run", "revision": 2,
            "snapshotRevision": 10, "previewHash": HASH, "sourceFingerprint": HASH, "admission": "allowed", "blockers": [],
            "settlementRequirements": [], "impact": impact, "hiringFee": None, "impacts": [{"text": "Original impact", "truncated": False}],
            "obligations": [], "coverage": {"loaded": 0, "total": 0, "revision": 10, "scope": "person:obligations", "complete": True}}


def submit(action="transfer"):
    return {"runId": "run", "commandId": "original", "draft": draft(action), "previewRevision": 10, "previewHash": HASH}


def receipt():
    return {"runId": "run", "commandId": "original", "kind": "world-management", "acceptedAt": 1, "status": "accepted"}


def outcome():
    return {"runId": "run", "commandId": "original", "acceptedSequence": 11, "requestId": "case", "intentId": "intent", "planId": "plan",
            "execution": {"planId": "plan", "requestId": "case", "intentId": "intent", "pin": PIN, "mode": "execute",
                          "expectedSequence": None, "sequence": 12, "updates": 1, "time": "0", "phase": "armed", "reason": None}}


@pytest.mark.parametrize("action", ["transfer", "depart", "hire-existing"])
def test_exact_typed_choices_roundtrip_and_refuse_actor_persona_and_lifecycle_injection(action):
    wire = draft(action)
    assert SimulationWorldManagementDraft.model_validate(wire).model_dump(exclude_none=True) == wire
    for patch in [{"actorId": "director"}, {"principalId": "forged"}, {"source": {"kind": "authenticated-user"}},
                  {"operationId": "fake"}, {"expectedRevision": True}, {"expectedRevision": -1}, {"expectedRevision": 2**53}]:
        with pytest.raises(ValidationError):
            SimulationWorldManagementDraft.model_validate({**wire, **patch})
    for patch in [{"reason": " \n\t "}, {"reason": "x" * 65537}, {"Persona": {}}, {"terminate": True}, {"retire": True}]:
        with pytest.raises(ValidationError):
            SimulationWorldManagementDraft.model_validate({**wire, "values": {**wire["values"], **patch}})
    if action != "hire-existing":
        with pytest.raises(ValidationError):
            SimulationWorldManagementDraft.model_validate({**wire, "values": {**wire["values"], "effective": "at"}})
        for at in [None, "01", 2, True, "-1"]:
            with pytest.raises(ValidationError):
                SimulationWorldManagementDraft.model_validate({**wire, "values": {**wire["values"], "effective": "at", "at": at}})
        retained = {**wire, "values": {**wire["values"], "at": "99"}}
        assert SimulationWorldManagementDraft.model_validate(retained).model_dump(exclude_none=True) == retained
    for name in wire["values"]:
        changed = copy.deepcopy(wire)
        del changed["values"][name]
        with pytest.raises(ValidationError):
            SimulationWorldManagementDraft.model_validate(changed)


@pytest.mark.parametrize("action", ["transfer", "depart", "hire-existing"])
def test_fields_reject_contradictory_availability_revisions_duplicate_choices_and_incomplete_forms(action):
    wire = fields(action)
    assert SimulationWorldManagementFields.model_validate(wire).model_dump(exclude_none=True) == wire
    unavailable = {**wire, "status": "unavailable", "reason": "explicit-capability-unavailable",
                   "fields": [{**field, "options": []} if field["kind"] == "choice" else field for field in wire["fields"]]}
    assert SimulationWorldManagementFields.model_validate(unavailable).model_dump(exclude_none=True) == unavailable
    invalid = [{**wire, "status": "unavailable"}, {**wire, "reason": "cannot-be-available"}, {**wire, "targetRevision": 11},
               {**wire, "fields": [*wire["fields"], wire["fields"][0]]}, {**wire, "native": {}}, {**wire, "reason": None},
               {**unavailable, "fields": []}]
    for index, field in enumerate(wire["fields"]):
        changed = copy.deepcopy(wire)
        del changed["fields"][index]
        invalid.append(changed)
        invalid.append({**wire, "fields": [{**item, "required": not item["required"]} if i == index else item
                                         for i, item in enumerate(wire["fields"])]})
        if field["kind"] == "choice":
            for options in [[], field["options"] * 2]:
                invalid.append({**wire, "fields": [{**item, "options": options} if i == index else item
                                                 for i, item in enumerate(wire["fields"])]})
            invalid.append({**wire, "fields": [{"id": item["id"], "kind": "time", "required": item["required"]}
                                              if i == index else item for i, item in enumerate(wire["fields"])]})
    for changed in invalid:
        with pytest.raises(ValidationError):
            SimulationWorldManagementFields.model_validate(changed)


@pytest.mark.parametrize("action", ["transfer", "depart", "hire-existing"])
def test_preview_binds_actual_impacts_and_complete_coverage_and_preserves_required_nulls(action):
    wire = preview(action)
    parsed = SimulationWorldManagementPreview.model_validate(wire)
    assert parsed.model_dump(exclude_none=True) == wire
    assert parsed.model_dump(exclude_unset=True) == wire
    for changed in [{**wire, "runId": "other"}, {**wire, "revision": 3}, {**wire, "snapshotRevision": 11},
                    {**wire, "previewHash": "opaque"}, {**wire, "admission": "blocked"}, {**wire, "blockers": ["invented"]},
                    {**wire, "coverage": {**wire["coverage"], "complete": False}}, {**wire, "impact": None},
                    {**wire, "impact": {**wire["impact"], "personId": "other"}},
                    {**wire, "impact": {**wire["impact"], "kind": "other"}}, {**wire, "nativeVersion": 96},
                    {**wire, "coverage": {**wire["coverage"], "loaded": 1, "total": 1}}]:
        with pytest.raises(ValidationError):
            SimulationWorldManagementPreview.model_validate(changed)
    if action == "hire-existing":
        field, changed = "targetPositionId", "other-position"
    else:
        field, changed = "assignmentId", "other-assignment"
    with pytest.raises(ValidationError):
        SimulationWorldManagementPreview.model_validate({**wire, "impact": {**wire["impact"], field: changed}})
    if action != "hire-existing":
        with pytest.raises(ValidationError):
            SimulationWorldManagementPreview.model_validate({**wire, "impact": {**wire["impact"], "requestedEffectiveAt": "1"}})
    blocked = {**wire, "admission": "blocked", "blockers": ["waiting-effective-time"], "impact": None}
    assert SimulationWorldManagementPreview.model_validate(blocked).admission == "blocked"


def test_original_request_and_independent_business_and_callback_receipts_reject_cross_case_facts():
    original = submit()
    assert SimulationWorldManagementSubmitInput.model_validate(original).model_dump(exclude_none=True) == original
    wire = {"status": "found", "request": receipt(), "worldManagement": original, "worldManagementOutcome": outcome()}
    assert SimulationRequestResult.model_validate(wire).model_dump(exclude_none=True) == wire
    uncertain = outcome()
    uncertain["execution"].update({"phase": "outcome-unknown", "reason": "callback-unconfirmed", "expectedSequence": 12, "sequence": 13, "updates": 2})
    uncertain["result"] = {"id": "result", "status": "committed", "time": "0", "sequence": 13}
    assert SimulationWorldManagementOutcome.model_validate(uncertain).model_dump(exclude_none=True) == uncertain
    assert SimulationRequestReceipt.model_validate({**receipt(), "status": "failed", "failure": "world-management-failed"}).status == "failed"
    for changed in [{**wire, "worldManagement": {**original, "commandId": "other"}}, {**wire, "worldManagement": None},
                    {**wire, "worldManagementOutcome": {**outcome(), "commandId": "other"}},
                    {**wire, "request": {**receipt(), "kind": "create"}},
                    {**wire, "status": "not-found", "commandId": "original"}]:
        with pytest.raises(ValidationError):
            SimulationRequestResult.model_validate(changed)
    for patch in [{"planId": "other"}, {"requestId": "other"}, {"intentId": "other"}, {"sequence": 10},
                  {"phase": "settled", "reason": "callback-unconfirmed"}, {"reason": "invented"}, {"expectedSequence": 0}, {"reason": None, "phase": "blocked"}]:
        with pytest.raises(ValidationError):
            SimulationWorldManagementOutcome.model_validate({**outcome(), "execution": {**outcome()["execution"], **patch}})
    with pytest.raises(ValidationError):
        SimulationRequestReceipt.model_validate({**receipt(), "status": "failed", "failure": "cancel-world-case-failed"})


def test_both_public_clients_keep_exact_inputs_bind_responses_and_do_not_retry_uncertain_commands(monkeypatch):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    responses = {"simulation/world-management-fields": fields(), "simulation/world-management-preview": preview(),
                 "simulation/world-management-submit": receipt()}
    calls = []
    def raw(method, params, **_kwargs):
        calls.append((method, copy.deepcopy(params)))
        return responses[method]
    monkeypatch.setattr(low, "_request_raw", raw)
    selected = SimulationWorldManagementFieldsInput(runId="run", targetId="person", action="transfer")
    original = SimulationWorldManagementSubmitInput.model_validate(submit())
    choices = SimulationWorldManagementDraft.model_validate(draft())
    for client in [low, high]:
        assert client.read_simulation_world_management_fields(selected).targetId == "person"
        assert client.preview_simulation_world_management(choices).input == choices
        assert client.submit_simulation_world_management(original).commandId == "original"
    assert calls[:3] == [("simulation/world-management-fields", selected.model_dump(exclude_none=True)),
                         ("simulation/world-management-preview", draft()), ("simulation/world-management-submit", submit())]
    for method, patch, read in [
        ("simulation/world-management-fields", {"targetId": "other"}, lambda: low.read_simulation_world_management_fields(selected)),
        ("simulation/world-management-submit", {"commandId": "other"}, lambda: low.submit_simulation_world_management(original)),
    ]:
        responses[method] = {**responses[method], **patch}
        with pytest.raises(SdkProtocolError):
            read()
    replacement = preview()
    replacement["input"]["values"]["reason"] = "Schema-valid replacement of the confirmed original choices"
    responses["simulation/world-management-preview"] = replacement
    with pytest.raises(SdkProtocolError):
        low.preview_simulation_world_management(choices)
    responses["simulation/world-management-preview"] = {**preview(), "principalId": "forged"}
    with pytest.raises(SdkProtocolError, match="violates the SDK protocol"):
        low.preview_simulation_world_management(choices)
    for code in ["SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED", "SIMULATION_PRODUCT_INVALID", "not-found"]:
        def fail(*_args, **_kwargs):
            raise JsonRpcError(-32000, "Original server refusal", {"code": code})
        monkeypatch.setattr(low, "_request_raw", fail)
        count = len(calls)
        with pytest.raises(JsonRpcError) as error:
            low.submit_simulation_world_management(original)
        assert error.value.data == {"code": code}
        assert len(calls) == count


def test_actual_native96_user_hold_preserves_required_nulls_and_refuses_fabricated_role_provenance():
    """Captured by the real Native/Team owner suite; no raw Native data is added to a public Product DTO."""
    wire = json.loads((Path(__file__).parent / "fixtures/world-management-native-hold.json").read_text())
    assert wire["createdOperationId"] is None
    assert wire["transaction"]["commitmentId"] is None
    parsed = NativeResourceReservation.model_validate(wire)
    assert parsed.model_dump(exclude_none=True) == wire
    assert parsed.model_dump(exclude_unset=True) == wire
    for changed in [{**wire, "createdOperationId": "fake-decision-operation"}, {**wire, "management": None},
                    {**wire, "management": {**wire["management"], "kind": "decision"}},
                    {**wire, "management": {**wire["management"], "credential": "secret"}},
                    {**wire, "management": {**wire["management"], "credentialGeneration": True}},
                    {**wire, "world": None}, {**wire, "settlement": None}, {**wire, "unexpected": {}},
                    {**wire, "createdOperationId": "literal-role-operation", "management": wire["management"]}]:
        with pytest.raises(ValidationError):
            NativeResourceReservation.model_validate(changed)
    for field in wire["management"]:
        changed = copy.deepcopy(wire)
        del changed["management"][field]
        with pytest.raises(ValidationError):
            NativeResourceReservation.model_validate(changed)


ACTUAL_CASES = json.loads((Path(__file__).parent / "fixtures/world-management-cases-v3.json").read_text())


@pytest.mark.parametrize("family", ACTUAL_CASES, ids=lambda item: item["kind"])
def test_actual_native_user_case_v3_preserves_original_command_null_requester_and_direct_plan(family):
    """Real owner output, checked by TS Product's parser before capture; no authenticated HTTP execution is simulated here."""
    from clocky import SimulationWorldCaseInspection
    first_actions = []
    for wire in family["sections"]:
        parsed = SimulationWorldCaseInspection.model_validate(wire)
        assert parsed.model_dump(exclude_none=True) == wire
        assert parsed.model_dump(exclude_unset=True) == wire
        summary = wire["value"]["summary"]
        assert summary["apiVersion"] == "clocky.world-case/v4"
        assert summary["requesterEntityId"] is None
        assert summary["origin"] == {"kind": "authenticated-user", "commandId": "human:" + family["kind"]}
        assert summary["lifecycle"]["execution"]["business"]["status"] == "committed"
        assert summary["lifecycle"]["notification"]["request"] is None
        assert "result" not in summary["lifecycle"]["notification"]
        if wire["section"] == "request":
            assert wire["value"]["source"]["kind"] == "authenticated-user"
            assert wire["value"]["source"]["commandId"] == summary["origin"]["commandId"]
            assert "operationId" not in wire["value"]["source"]
            assert wire["value"]["description"] == {"status": "withheld"}
        elif wire["section"] == "plans":
            assert len(wire["value"]["items"]) == 1
            plan = wire["value"]["items"][0]
            assert plan["operationId"] is None and plan["predecessor"] is None
            assert plan["rationale"] == {"status": "withheld"}
            assert plan["persona"] == {"status": "not-applicable"}
        elif wire["section"] == "notification":
            assert wire["value"]["request"] is None and "result" not in wire["value"]
            first_actions.append(wire["value"].get("firstAction"))
        invalid = []
        for version in ["clocky.world-case/v1", "clocky.world-case/v2"]:
            changed = copy.deepcopy(wire)
            changed["value"]["summary"]["apiVersion"] = version
            invalid.append(changed)
        for key, value in [("requesterEntityId", "fake-simulated-requester"), ("origin", {"kind": "decision"}),
                           ("origin", {**summary["origin"], "principalId": "private-principal"})]:
            changed = copy.deepcopy(wire)
            changed["value"]["summary"][key] = value
            invalid.append(changed)
        missing = copy.deepcopy(wire)
        del missing["value"]["summary"]["requesterEntityId"]
        invalid.append(missing)
        fake_notification = {"operationId": "fake-role-post", "status": "pending", "channelId": "fake",
                             "publication": "unpublished", "delivery": "not-received"}
        changed = copy.deepcopy(wire)
        changed["value"]["summary"]["lifecycle"]["notification"]["request"] = fake_notification
        if wire["section"] == "notification":
            changed["value"]["request"] = fake_notification
        invalid.append(changed)
        if wire["section"] == "request":
            for patch in [{"commandId": "another-original-command"}, {"operationId": "fake-operation"}, {"principalId": "private"}]:
                changed = copy.deepcopy(wire)
                changed["value"]["source"].update(patch)
                invalid.append(changed)
            changed = copy.deepcopy(wire)
            changed["value"]["source"] = {"kind": "decision", "operationId": "fake-operation", "sequence": 1, "payloadHash": HASH}
            invalid.append(changed)
        if wire["section"] == "plans":
            changed = copy.deepcopy(wire)
            changed["value"]["items"][0]["operationId"] = "fake-operation"
            invalid.append(changed)
            missing = copy.deepcopy(wire)
            del missing["value"]["items"][0]["operationId"]
            invalid.append(missing)
        for changed in invalid:
            with pytest.raises(ValidationError):
                SimulationWorldCaseInspection.model_validate(changed)
    # These actual transfer and existing-hire providers retained an onboarding event; user origin must not erase it.
    if family["kind"] in {"transfer", "hire-existing"}:
        assert first_actions[0]["wake"]["status"] == "scheduled"


COMMAND_BOUNDARIES = [
    pytest.param("a" * 256, True, id="ascii256"),
    pytest.param("a" * 257, False, id="ascii257"),
    pytest.param("😀" * 128, True, id="astral128"),
    pytest.param("😀" * 129, False, id="astral129"),
    pytest.param("a" * 254 + "😀", True, id="mixed256"),
    pytest.param("a" * 255 + "😀", False, id="mixed257"),
    pytest.param("", False, id="empty"),
    pytest.param("\ud800", True, id="lone-high1"),
    pytest.param("\ud800" * 256, True, id="lone-high256"),
    pytest.param("\ud800" * 257, False, id="lone-high257"),
    pytest.param("\udfff", True, id="lone-low1"),
    pytest.param("\udfff" * 256, True, id="lone-low256"),
    pytest.param("\udfff" * 257, False, id="lone-low257"),
    pytest.param("a" + "\ud800" * 255, True, id="lone-mixed256"),
    pytest.param("a" + "\ud800" * 256, False, id="lone-mixed257"),
]


@pytest.mark.parametrize("command_id,allowed", COMMAND_BOUNDARIES)
def test_management_identity_matches_native_utf16_units_in_submit_outcome_case_and_original_source(command_id, allowed):
    from clocky import SimulationWorldCaseInspection
    original_source = json.loads((Path(__file__).parent / "fixtures/world-management-native-hold.json").read_text())["management"]
    wires = [(SimulationWorldManagementSubmitInput, {**submit(), "commandId": command_id}),
             (SimulationWorldManagementOutcome, {**outcome(), "commandId": command_id}),
             (SimulationRequestReceipt, {**receipt(), "commandId": command_id}),
             (NativeAuthenticatedUserSource, {**original_source, "commandId": command_id})]
    for section in ACTUAL_CASES[0]["sections"]:
        wire = copy.deepcopy(section)
        wire["value"]["summary"]["origin"]["commandId"] = command_id
        if wire["section"] == "request":
            wire["value"]["source"]["commandId"] = command_id
        wires.append((SimulationWorldCaseInspection, wire))
    for model, wire in wires:
        if allowed:
            assert model.model_validate(wire).model_dump(exclude_none=True) == wire
        else:
            with pytest.raises(ValidationError):
                model.model_validate(wire)
    if command_id:
        # Other command families retain their original Pydantic Identity parser, including its Unicode restrictions.
        from pydantic import TypeAdapter
        from clocky.simulation_base import Identity
        try:
            generic = TypeAdapter(Identity).validate_python(command_id)
        except ValidationError:
            with pytest.raises(ValidationError):
                SimulationRequestReceipt.model_validate({**receipt(), "kind": "create", "commandId": command_id})
        else:
            assert SimulationRequestReceipt.model_validate({**receipt(), "kind": "create", "commandId": command_id}).commandId == generic


@pytest.mark.parametrize("command_id,allowed", COMMAND_BOUNDARIES)
def test_both_python_clients_keep_valid_boundary_ids_and_reject_invalid_ones_before_io(monkeypatch, command_id, allowed):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    calls = []
    def raw(method, params, **_kwargs):
        calls.append((method, copy.deepcopy(params)))
        return {**receipt(), "commandId": command_id}
    monkeypatch.setattr(low, "_request_raw", raw)
    for client in [low, high]:
        before = len(calls)
        if allowed:
            original = SimulationWorldManagementSubmitInput.model_validate({**submit(), "commandId": command_id})
            assert client.submit_simulation_world_management(original).commandId == command_id
            assert calls[-1] == ("simulation/world-management-submit", original.model_dump(exclude_none=True))
            assert len(calls) == before + 1
        else:
            with pytest.raises(ValidationError):
                client.submit_simulation_world_management(SimulationWorldManagementSubmitInput.model_validate({**submit(), "commandId": command_id}))
            assert len(calls) == before


REASON_CORPUS = json.loads((Path(__file__).parent / "fixtures/world-management-reasons.json").read_text())
REASON_BOUNDARIES = [(row["label"], row["text"] * row.get("repeat", 1) + row.get("suffix", ""), row["allowed"]) for row in REASON_CORPUS]


@pytest.mark.parametrize("label,reason,allowed", REASON_BOUNDARIES, ids=[row[0] for row in REASON_BOUNDARIES])
def test_all_management_reason_variants_and_complete_parsers_share_the_ts_rules(label, reason, allowed):
    from clocky.simulation_world_management import ManagementTransferValues, ManagementDepartValues, ManagementHireExistingValues
    value_models = {"transfer": ManagementTransferValues, "depart": ManagementDepartValues, "hire-existing": ManagementHireExistingValues}
    for action, value_model in value_models.items():
        choices = draft(action)
        choices["values"]["reason"] = reason
        original = {**submit(action), "draft": choices}
        wires = [(value_model, choices["values"]), (SimulationWorldManagementDraft, choices),
                 (SimulationWorldManagementSubmitInput, original), (SimulationWorldManagementPreview, {**preview(action), "input": choices}),
                 (SimulationRequestResult, {"status": "found", "request": receipt(), "worldManagement": original})]
        for model, wire in wires:
            if allowed:
                assert model.model_validate(wire).model_dump(exclude_none=True) == wire
            else:
                with pytest.raises(ValidationError):
                    model.model_validate(wire)


def test_management_reason_blank_set_matches_the_ts_corpus_for_every_bmp_character():
    from pydantic import TypeAdapter
    from clocky.simulation_world_management import Reason
    validator = TypeAdapter(Reason)
    rejected = []
    for value in range(65_536):
        try:
            validator.validate_python(chr(value))
        except ValidationError:
            rejected.append(chr(value))
    assert rejected == [row["text"] for row in REASON_CORPUS if row["label"].startswith("blank-U+")]


@pytest.mark.parametrize("label,reason,allowed", REASON_BOUNDARIES, ids=[row[0] for row in REASON_BOUNDARIES])
def test_both_python_clients_validate_reason_before_io_without_normalizing_original_text(monkeypatch, label, reason, allowed):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    high._client = low
    monkeypatch.setattr(high, "start", lambda: None)
    calls = []
    def raw(method, params, **_kwargs):
        calls.append((method, copy.deepcopy(params)))
        return {**preview(params["action"]), "input": params} if method == "simulation/world-management-preview" else receipt()
    monkeypatch.setattr(low, "_request_raw", raw)
    for action in ["transfer", "depart", "hire-existing"]:
        choices = draft(action)
        choices["values"]["reason"] = reason
        for client in [low, high]:
            before = len(calls)
            if allowed:
                parsed = SimulationWorldManagementDraft.model_validate(choices)
                assert client.preview_simulation_world_management(parsed).input.root.values.reason == reason
                original = SimulationWorldManagementSubmitInput.model_validate({**submit(action), "draft": choices})
                assert client.submit_simulation_world_management(original).commandId == "original"
                assert calls[-1][1]["draft"]["values"]["reason"] == reason
                assert len(calls) == before + 2
            else:
                with pytest.raises(ValidationError):
                    client.preview_simulation_world_management(SimulationWorldManagementDraft.model_validate(choices))
                with pytest.raises(ValidationError):
                    client.submit_simulation_world_management(SimulationWorldManagementSubmitInput.model_validate({**submit(action), "draft": choices}))
                assert len(calls) == before


def test_management_scalars_are_strict_and_only_combine_valid_utf16_pairs():
    from pydantic import TypeAdapter
    from clocky.simulation_base import ManagementCommandId
    from clocky.simulation_world_management import Reason
    command = TypeAdapter(ManagementCommandId)
    reason = TypeAdapter(Reason)
    for invalid in [None, 1, True, b"command", [], {}]:
        with pytest.raises(ValidationError):
            command.validate_python(invalid)
    # JS sees the same code-unit sequence for a manually paired Python string and a single astral character.
    paired = "\ud83d\ude00e\u0301\ufeff"
    expected = "😀e\u0301\ufeff"
    assert command.validate_python(paired) == expected
    assert reason.validate_python(paired) == expected
    assert expected != "😀é\ufeff"  # No NFC or whitespace normalization.
    for original in ["\ud800", "\udfff", "a\ud800b", "\ud800\ud83d\ude00\udfff"]:
        for validator in [command, reason]:
            parsed = validator.validate_python(original)
            assert parsed.encode("utf-16-le", "surrogatepass") == original.encode("utf-16-le", "surrogatepass")
            assert json.loads(json.dumps(parsed)) == parsed


@pytest.mark.parametrize("level", ["low", "high"])
def test_real_python_sdk_stdio_preserves_js_utf16_management_identity_and_complete_preview(level, tmp_path):
    """Real SDK codec + independent Node JSON peer; response fixtures do not claim Native business admission."""
    import shutil
    from clocky.simulation import SimulationRequestInput, SimulationRetryRequestInput
    node = shutil.which("node")
    assert node is not None, "The cross-language management codec owner test requires the repository Node runtime"
    script = tmp_path / "management-codec-peer.mjs"
    capture = tmp_path / "capture.json"
    fixtures = tmp_path / "previews.json"
    fixtures.write_text(json.dumps({action: preview(action) for action in ["transfer", "depart", "hire-existing"]}))
    script.write_text(r"""
import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync } from 'node:fs'
const previews = JSON.parse(readFileSync(process.env.CODEC_FIXTURES, 'utf8')), requests = [], originals = new Map()
const receipt = params => ({ kind: 'world-management', runId: params.runId, commandId: params.commandId, acceptedAt: 1, status: 'accepted' })
const units = value => Array.from({ length: value.length }, (_, index) => value.charCodeAt(index))
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const request = JSON.parse(line), params = request.params
  requests.push({ method: request.method, raw: line,
    reason: params?.values?.reason === undefined ? undefined : units(params.values.reason),
    command: params?.commandId === undefined ? undefined : units(params.commandId) })
  let result
  if (request.method === 'initialize') result = { serverInfo: { name: 'management-codec-peer' } }
  else if (request.method === 'simulation/world-management-preview') result = { ...previews[params.action], input: params }
  else if (request.method === 'simulation/world-management-submit') {
    originals.set(params.commandId, params)
    result = receipt(params)
  } else if (request.method === 'simulation/requests-get') {
    const original = originals.get(params.commandId)
    result = original === undefined ? { status: 'not-found', commandId: params.commandId }
      : { status: 'found', request: receipt(original), worldManagement: original }
  } else if (request.method === 'simulation/requests-retry') result = receipt(originals.get(params.commandId))
  else if (request.method === 'shutdown') {
    writeFileSync(process.env.CODEC_CAPTURE, JSON.stringify({ pid: process.pid, requests }))
    result = {}
  } else throw new Error(`Unexpected codec method: ${request.method}`)
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
  if (request.method === 'shutdown') lines.close()
})
""")
    env = {"CODEC_CAPTURE": str(capture), "CODEC_FIXTURES": str(fixtures)}
    config = HarnessConfig(launch_args_override=(node, str(script)), cwd=str(Path.cwd()), env=env, request_timeout_seconds=5)
    client = HarnessClient(config) if level == "low" else Clocky(ClockyConfig(credential="codec-fixture", provider="fixture",
        model="fixture", launch_args_override=config.launch_args_override, cwd=config.cwd, env=env, request_timeout_seconds=5))
    samples = ["\ud800", "\udfff" * 256, "a" + "\ud800" * 255, "\ud83d\ude00", "😀"]
    expected = []
    def utf16_units(value):
        encoded = value.encode("utf-16-le", "surrogatepass")
        return [encoded[index] + 256 * encoded[index + 1] for index in range(0, len(encoded), 2)]
    try:
        if level == "low":
            client.initialize(credential="codec-fixture", provider="fixture", cwd=str(Path.cwd()), model="fixture")
        for action in ["transfer"]:
            for command_id in samples:
                raw_reason = command_id + "e\u0301\ufeff"
                choices = draft(action)
                choices["values"]["reason"] = raw_reason
                selected = SimulationWorldManagementDraft.model_validate(choices)
                result = client.preview_simulation_world_management(selected)
                assert result.input.model_dump(exclude_none=True) == selected.model_dump(exclude_none=True)
                assert result.input.root.values.reason.encode("utf-16-le", "surrogatepass") == raw_reason.encode("utf-16-le", "surrogatepass")
                original = SimulationWorldManagementSubmitInput.model_validate({**submit(action), "commandId": command_id, "draft": choices})
                assert client.submit_simulation_world_management(original).commandId == original.commandId
                found = client.get_simulation_request(SimulationRequestInput(commandId=command_id))
                assert found.status == "found" and found.worldManagement == original
                assert client.retry_simulation_request(SimulationRetryRequestInput(runId=original.runId, commandId=command_id)).commandId == original.commandId
                expected.extend([("simulation/world-management-preview", "reason", utf16_units(raw_reason)),
                                 ("simulation/world-management-submit", "command", utf16_units(command_id)),
                                 ("simulation/requests-get", "command", utf16_units(command_id)),
                                 ("simulation/requests-retry", "command", utf16_units(command_id))])
        unknown = "\ud800" * 257
        missing = client.get_simulation_request(SimulationRequestInput(commandId=unknown))
        assert missing.status == "not-found" and missing.commandId == unknown
        expected.append(("simulation/requests-get", "command", utf16_units(unknown)))
    finally:
        client.close()
    observed = json.loads(capture.read_text())
    assert observed["pid"] > 0
    rows = [row for row in observed["requests"] if row["method"].startswith("simulation/")]
    assert len(rows) == len(expected)
    for row, (method, key, units) in zip(rows, expected):
        assert row["method"] == method and row[key] == units
    assert any("\\ud800" in row["raw"] for row in rows)
    assert any("\\udfff" in row["raw"] for row in rows)


def test_shared_command_selectors_retain_js_nonempty_semantics_without_inferring_management_bounds():
    from clocky.simulation import SimulationRequestInput, SimulationRetryRequestInput
    from clocky.simulation_base import Identity
    from pydantic import TypeAdapter
    for value in ["a" * 257, "\ud800" * 257, "\ud83d\ude00", "a\udfff"]:
        query = SimulationRequestInput(commandId=value)
        retry = SimulationRetryRequestInput(runId="run", commandId=value)
        missing = SimulationRequestResult.model_validate({"status": "not-found", "commandId": value})
        expected = value.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")
        assert query.commandId == retry.commandId == missing.commandId == expected
    for value in ["", None, 1, True, b"query"]:
        for constructor in [lambda: SimulationRequestInput(commandId=value),
                            lambda: SimulationRetryRequestInput(runId="run", commandId=value),
                            lambda: SimulationRequestResult.model_validate({"status": "not-found", "commandId": value})]:
            with pytest.raises(ValidationError):
                constructor()
    assert TypeAdapter(Identity).validate_python("\ud800") == "\ud800"  # Shared owner now follows the same JS string rule.


AUTHORITY_CORPUS = json.loads((Path(__file__).parent / "fixtures/world-management-authority-text.json").read_text())


@pytest.mark.parametrize("row", AUTHORITY_CORPUS, ids=lambda row: row["label"])
def test_native_management_authority_text_matches_native_bounds_in_source_and_full_resource_hold(row):
    original = json.loads((Path(__file__).parent / "fixtures/world-management-native-hold.json").read_text())
    assert NativeResourceReservation.model_validate(original).model_dump(exclude_none=True) == original
    value = row["text"] * row.get("repeat", 1) + row.get("suffix", "")
    for field in ["principalId", "policyRef", "policyGeneration"]:
        source = {**original["management"], field: value}
        wire = {**original, "management": source}
        for model, data in [(NativeAuthenticatedUserSource, source), (NativeResourceReservation, wire)]:
            if row["allowed"]:
                parsed = model.model_validate(data)
                assert parsed.model_dump(exclude_none=True) == data
            else:
                with pytest.raises(ValidationError):
                    model.model_validate(data)


def test_native_management_authority_text_is_strict_and_only_canonicalizes_valid_pairs():
    from pydantic import TypeAdapter
    from clocky.simulation_native_management import ManagementAuthorityText
    parser = TypeAdapter(ManagementAuthorityText)
    for bad in [None, 1, True, b"policy", [], {}]:
        with pytest.raises(ValidationError):
            parser.validate_python(bad)
    original = " \ud800\ud83d\ude00e\u0301\ufeff\t"
    expected = " \ud800😀e\u0301\ufeff\t"
    assert parser.validate_python(original) == expected
    assert expected.encode("utf-16-le", "surrogatepass") == original.encode("utf-16-le", "surrogatepass")


@pytest.mark.parametrize("command_id,allowed", COMMAND_BOUNDARIES)
def test_fee_policy_and_reservation_keep_their_own_native256_unit_identity_bounds(command_id, allowed):
    from clocky.simulation_world_management import ManagementHiringFee
    original = json.loads((Path(__file__).parent / "fixtures/world-management-native-hold.json").read_text())
    for model, wire in [(ManagementHiringFee, {**original["world"]["fee"], "id": command_id}),
                        (NativeResourceReservation, {**original, "id": command_id})]:
        if allowed:
            parsed = model.model_validate(wire)
            assert parsed.id == command_id
        else:
            with pytest.raises(ValidationError):
                model.model_validate(wire)


@pytest.mark.parametrize("sequence,allowed", [(0, True), (1, True), (9_007_199_254_740_991, True), (-1, False), (9_007_199_254_740_992, False), (True, False)])
def test_full_native_hold_expiry_consumption_uses_nonnegative_safe_cursor(sequence, allowed):
    original = json.loads((Path(__file__).parent / "fixtures/world-management-native-hold.json").read_text())
    wire = copy.deepcopy(original)
    wire["world"]["expiryConsumed"] = {"eventId": "expiry", "sequence": sequence, "time": "0"}
    if allowed:
        assert NativeResourceReservation.model_validate(wire).model_dump(exclude_none=True) == wire
    else:
        with pytest.raises(ValidationError):
            NativeResourceReservation.model_validate(wire)


HOLD_BOUNDARY_CORPUS = json.loads((Path(__file__).parent / "fixtures/world-native-hold-boundaries.json").read_text())


@pytest.mark.parametrize("row", HOLD_BOUNDARY_CORPUS, ids=lambda row: row["label"])
def test_complete_native_hold_matches_ts_numeric_optional_and_nullable_boundary_corpus(row):
    if row["allowed"]:
        assert NativeResourceReservation.model_validate(row["value"]).model_dump(exclude_none=True) == row["value"]
    else:
        with pytest.raises(ValidationError):
            NativeResourceReservation.model_validate(row["value"])
