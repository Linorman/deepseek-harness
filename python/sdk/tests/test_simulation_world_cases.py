"""World DTOs reject cross-selection responses and private-body fields hidden by disclosure policy."""
import pytest
from pydantic import ValidationError
from clocky import (HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError,
                    SimulationWorldCasesInput, SimulationWorldCasesPage, SimulationWorldCaseInput, SimulationWorldCaseInspection)

def lifecycle(status="open", result_id="result"):
    return {"request": {"status": status}, "plan": {"status": "none"},
            "execution": {"callback": {"status": "none"}, "business": (
                {"status": status, "resultId": result_id} if status in {"committed", "rejected", "cancelled"} else {"status": "none"})},
            "notification": {"request": None}}


def with_tracks(detail):
    """Build one consistent fixture prefix; explicit wire-disagreement tests bypass this factory."""
    from copy import deepcopy
    value = deepcopy(detail)
    tracks = value["summary"]["lifecycle"]
    if value["section"] == "plans":
        latest = value["items"][-1] if value["items"] else None
        tracks["plan"] = ({key: latest[key] for key in ("id", "status", "resolution")}
                          if latest is not None else {"status": "none"})
    elif value["section"] == "execution":
        result = value.get("result")
        tracks["execution"] = {"callback": value.get("observation", {"status": "none"}),
                               "business": ({"status": result["outcome"]["kind"], "resultId": result["id"]}
                                            if result is not None else {"status": "none"})}
    elif value["section"] == "notification":
        tracks["notification"] = {key: value[key] for key in ("request", "result", "firstAction") if key in value}
    return value


SUMMARY = {"apiVersion": "clocky.world-case/v4", "businessSummary": {"status": "unsupported"}, "origin": {"kind": "decision"}, "domain": "organization", "operation": "generate-and-hire", "version": "1", "requestId": "case", "intentId": "intent", "status": "open", "lifecycle": lifecycle(), "requesterEntityId": "member",
           "organizationEntityId": "organization", "targetEntityId": "position", "cancel": {"allowed": False, "reason": "recovery-required"}}
BASE = {"runId": "run", "snapshotRevision": 3, "readVersion": "policy", "observedAt": 1}
PLAN = {"id": "plan", "operationId": "resolve", "sequence": 2, "hash": "hash", "predecessor": None,
        "status": "accepted", "resolution": "apply", "rationale": {"status": "withheld"}, "persona": {"status": "withheld"}}
POST = {"operationId": "notify", "status": "pending", "publication": "unpublished", "delivery": "not-received", "channelId": "private"}
COMMITTED = {**SUMMARY, "status": "committed", "lifecycle": lifecycle("committed"), "cancel": {"allowed": False, "reason": "terminal"}}
RESULT = {"id": "result", "sequence": 4, "time": "5", "source": {"kind": "plan", "planId": "plan"},
          "outcome": {"kind": "committed"}, "payload": {"entityId": "newborn", "relationId": "assignment"}}
RESERVATION = {"id": "intent", "planId": "plan", "status": "committed", "sequence": 3, "updatedSequence": 4,
               "newborn": {"entityId": "newborn", "readiness": "ready", "phase": "active"},
               "assignment": {"relationId": "assignment", "status": "retained"}}
DETAILS = [
    {"section": "request", "summary": SUMMARY, "source": {"kind": "decision", "operationId": "request", "sequence": 1, "payloadHash": "hash"},
     "description": {"status": "withheld"}},
    {"section": "plans", "summary": SUMMARY, "total": 1, "items": [PLAN]},
    {"section": "execution", "summary": SUMMARY},
    {"section": "notification", "summary": SUMMARY, "request": POST},
]

DETAILS = [with_tracks(detail) for detail in DETAILS]


def test_original_personnel_and_shared_representative_duties_are_strict_and_independent():
    duty = {"kind": "personnel", "id": "intent", "planId": "plan", "status": "blocked", "sequence": 3, "updatedSequence": 4}
    detail = {"section": "execution", "summary": {**SUMMARY, "operation": "depart"}, "responsibilities": [duty]}
    payload = {**BASE, "requestId": "case", "section": "execution", "status": "found", "value": detail}
    assert SimulationWorldCaseInspection.model_validate(payload).value.responsibilities[0].status == "blocked"
    external = {**detail, "summary": {**SUMMARY, "domain": "external", "operation": "interact", "version": "3"},
                "responsibilities": [{**duty, "kind": "representative", "id": "shared-original", "status": "preparing"},
                                     {**duty, "kind": "contact", "status": "reserved"}]}
    assert len(SimulationWorldCaseInspection.model_validate({**payload, "value": external}).value.responsibilities) == 2
    for changed in [{**detail, "summary": SUMMARY}, {**detail, "responsibilities": []},
                    {**detail, "responsibilities": [duty, duty]},
                    *[{**detail, "responsibilities": [{**duty, **patch}]} for patch in (
                        {"status": "outcome-unknown"}, {"status": "committed"}, {"status": "cancelled"},
                        {"id": "another"}, {"updatedSequence": 2}, {"privatePersona": "secret"})],
                    {**external, "responsibilities": [{**duty, "kind": "contact", "status": "preparing"}]}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**payload, "value": changed})


def test_callback_uncertainty_does_not_override_the_original_committed_business_result():
    observation = {"planId": "plan", "mode": "execute", "sequence": 5, "updates": 2, "time": "5",
                   "status": "outcome-unknown", "reason": "callback-unconfirmed"}
    payload = {**BASE, "requestId": "case", "section": "execution", "status": "found", "value": {
        "section": "execution", "summary": COMMITTED, "reservation": RESERVATION, "result": RESULT, "observation": observation}}
    payload["value"] = with_tracks(payload["value"])
    parsed = SimulationWorldCaseInspection.model_validate(payload)
    assert parsed.value.result.outcome.kind == "committed"
    assert parsed.value.observation.status == "outcome-unknown"
    settled = SimulationWorldCaseInspection.model_validate({**payload, "value": {
        **with_tracks({**payload["value"], "observation": {**observation, "status": "settled", "reason": None}})}})
    assert settled.model_dump(exclude_none=True)["value"]["observation"]["reason"] is None
    for patch in [{"status": "settled"}, {"reason": None}, {"reason": "invented"}, {"updates": 0}, {"privateDiagnostic": "secret"}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**payload, "value": {
                **payload["value"], "observation": {**observation, **patch}}})


@pytest.mark.parametrize("detail", DETAILS)
def test_four_sections_bind_original_case_and_section_and_refuse_unknown_native_fields(detail):
    payload = {**BASE, "requestId": "case", "section": detail["section"], "status": "found", "value": detail}
    assert SimulationWorldCaseInspection.model_validate(payload).value.section == detail["section"]
    for changed in [{**payload, "requestId": "another"}, {**payload, "section": "unknown"},
                    {**payload, "value": {**detail, "nativeSnapshot": {}}}, {**payload, "status": "missing"}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate(changed)


def test_private_domains_refuse_text_or_persona_when_withheld_and_pages_refuse_duplicate_originals():
    payload = {**BASE, "requestId": "case", "section": "plans", "status": "found", "value": DETAILS[1]}
    for changed in [{**PLAN, "rationale": {"status": "withheld", "text": {"text": "secret", "truncated": False}}},
                    {**PLAN, "persona": {"status": "withheld", "name": {"text": "secret", "truncated": False}}}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**payload, "value": {**DETAILS[1], "items": [changed]}})
    for changed in [{**PLAN, "status": "stale"}, {**PLAN, "status": "stale", "stale": {"phase": "execution", "reason": "read-set-changed", "sequence": 1}},
                    {**PLAN, "resolution": "reject"}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**payload, "value": {**DETAILS[1], "items": [changed]}})
    with pytest.raises(ValidationError):
        SimulationWorldCasesPage.model_validate({**BASE, "total": 2, "items": [SUMMARY, SUMMARY]})
    with pytest.raises(ValidationError):
        SimulationWorldCaseInput(runId="run", requestId="case", section="request", cursor="offset")
    with pytest.raises(ValidationError):
        SimulationWorldCasesInput(runId="run", actor="injected")


def test_scenario_notification_requires_explicit_null_and_preserves_it_in_optional_wire_dumps():
    detail = {"section": "notification", "summary": SUMMARY, "request": None,
        "result": {"resultId": "result", "wake": {"id": "result-wake", "status": "completed", "decisionId": "decision"}}}
    detail = with_tracks(detail)
    source = {**BASE, "requestId": "case", "section": "notification", "status": "found", "value": detail}
    parsed = SimulationWorldCaseInspection.model_validate(source)
    assert parsed.model_dump(exclude_none=True) == source
    assert parsed.model_dump(exclude_unset=True) == source
    missing = {key: value for key, value in detail.items() if key != "request"}
    with pytest.raises(ValidationError):
        SimulationWorldCaseInspection.model_validate({**source, "value": missing})
    with pytest.raises(ValidationError):
        SimulationWorldCaseInspection.model_validate({**source, "value": {**detail,
            "request": {"kind": "director-event", "channelId": "self", "envelopeId": "invented"}}})


def test_public_clients_preserve_exact_world_case_selection_and_refuse_mismatched_responses(monkeypatch):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    monkeypatch.setattr(high, "start", lambda: None)
    sent = []
    page = SimulationWorldCasesPage.model_validate({**BASE, "total": 1, "items": [SUMMARY]})
    detail = SimulationWorldCaseInspection.model_validate({**BASE, "requestId": "case", "section": "request",
                                                          "status": "found", "value": DETAILS[0]})
    def send(method, params, **kwargs):
        sent.append((method, params))
        return page if method == "simulation/world-cases-list" else detail
    monkeypatch.setattr(low, "request", send)
    monkeypatch.setattr(high._client, "request", send)
    for client in [low, high]:
        selected = SimulationWorldCasesInput(runId="run", limit=1, expectedRevision=3, status="open")
        assert client.list_simulation_world_cases(selected) == page
        original = SimulationWorldCaseInput(runId="run", requestId="case", section="request")
        assert client.inspect_simulation_world_case(original) == detail
    assert sent[0] == ("simulation/world-cases-list", selected.model_dump(exclude_none=True))
    assert sent[1] == ("simulation/world-case-inspect", original.model_dump(exclude_none=True))
    for changed in [page.model_copy(update={"runId": "another"}), page.model_copy(update={"snapshotRevision": 4})]:
        monkeypatch.setattr(low, "request", lambda *_args, **_kwargs: changed)
        with pytest.raises(SdkProtocolError):
            low.list_simulation_world_cases(selected)
    monkeypatch.setattr(low, "request", lambda *_args, **_kwargs: detail.model_copy(update={"requestId": "another"}))
    with pytest.raises(SdkProtocolError):
        low.inspect_simulation_world_case(original)


def execution(result=RESULT, reservation=RESERVATION):
    detail = {"section": "execution", "summary": COMMITTED, "result": result}
    if reservation is not None:
        detail["reservation"] = reservation
    return {**BASE, "snapshotRevision": 4, "requestId": "case", "section": "execution", "status": "found", "value": detail}


def test_common_committed_result_payload_retains_original_hiring_identities():
    parsed = SimulationWorldCaseInspection.model_validate(execution())
    assert parsed.value.result.outcome.kind == "committed"
    assert parsed.value.result.outcome.model_dump() == {"kind": "committed"}
    assert parsed.value.result.payload == RESULT["payload"]


def test_generic_committed_result_does_not_require_a_hiring_reservation():
    payload = {"bookingId": "booking", "roomEntityId": "room", "interval": {"from": "5", "until": "10"}}
    source = execution({**RESULT, "payload": payload}, None)
    source["value"]["summary"] = {**source["value"]["summary"], "domain": "facility", "operation": "reserve-room", "targetEntityId": "room"}
    parsed = SimulationWorldCaseInspection.model_validate(source)
    assert parsed.value.result.payload == payload
    assert parsed.value.reservation is None


def test_generic_case_selector_rejects_old_summary_hiring_persona_and_foreign_reservation():
    old = {key: value for key, value in SUMMARY.items() if key not in ["apiVersion", "domain", "operation", "version", "targetEntityId"]}
    old["positionEntityId"] = "position"
    with pytest.raises(ValidationError):
        SimulationWorldCasesPage.model_validate({**BASE, "total": 1, "items": [old]})
    with pytest.raises(ValidationError):
        SimulationWorldCasesPage.model_validate({**BASE, "total": 1, "items": [{**SUMMARY, "positionEntityId": "alias"}]})
    generic = {**SUMMARY, "domain": "external", "operation": "interact", "version": "3", "targetEntityId": "vendor"}
    plans = {"section": "plans", "summary": generic, "total": 1, "items": [{**PLAN, "persona": {"status": "not-applicable"}}]}
    plans = with_tracks(plans)
    source = {**BASE, "requestId": "case", "section": "plans", "status": "found", "value": plans}
    assert SimulationWorldCaseInspection.model_validate(source).model_dump(exclude_none=True) == source
    with pytest.raises(ValidationError):
        SimulationWorldCaseInspection.model_validate({**source, "value": {**plans, "items": [PLAN]}})
    for patch in [{"domain": "other"}, {"operation": "other"}, {"version": "2"}]:
        source = execution()
        source["value"]["summary"] = {**COMMITTED, **patch}
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate(source)


@pytest.mark.parametrize("result", [
    {key: value for key, value in RESULT.items() if key != "payload"},
    {**RESULT, "outcome": {"kind": "committed", **RESULT["payload"]}},
    {**RESULT, "privateRationale": "secret"},
    {**RESULT, "source": {"kind": "plan", "planId": "replacement"}},
    {**RESULT, "sequence": 5},
    {**RESULT, "payload": {"entityId": "replacement", "relationId": "assignment"}},
    {**RESULT, "payload": {"entityId": "newborn", "relationId": "replacement"}},
    {**RESULT, "payload": {"entityId": "newborn"}},
    {**RESULT, "payload": {"relationId": "assignment"}},
    {**RESULT, "payload": {**RESULT["payload"], "privateRationale": "secret"}},
    {**RESULT, "payload": None},
])
def test_malformed_hiring_result_payloads_and_the_old_identity_layout_are_rejected(result):
    with pytest.raises(ValidationError):
        SimulationWorldCaseInspection.model_validate(execution(result))


@pytest.mark.parametrize("payload", [float("nan"), float("inf"), {"nested": [float("-inf")]},
                                      {"not-json": {"value"}}, {"not-json": object()}, {1: "not-a-string-key"}])
def test_generic_results_refuse_non_json_values_including_nested_non_finite_numbers(payload):
    with pytest.raises(ValidationError):
        SimulationWorldCaseInspection.model_validate(execution({**RESULT, "payload": payload}, None))


def test_both_public_client_levels_decode_new_result_payloads_and_reject_old_format(monkeypatch):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    monkeypatch.setattr(high, "start", lambda: None)
    selected = SimulationWorldCaseInput(runId="run", requestId="case", section="execution")
    for public, transport in [(low, low), (high, high._client)]:
        sent = []
        def send(method, params, **kwargs):
            sent.append((method, params))
            return execution()
        monkeypatch.setattr(transport, "_request_raw", send)
        assert public.inspect_simulation_world_case(selected).value.result.payload == RESULT["payload"]
        assert sent == [("simulation/world-case-inspect", selected.model_dump(exclude_none=True))]
        old = {**RESULT, "outcome": {"kind": "committed", **RESULT["payload"]}}
        del old["payload"]
        monkeypatch.setattr(transport, "_request_raw", lambda *_args, **_kwargs: execution(old))
        with pytest.raises(SdkProtocolError):
            public.inspect_simulation_world_case(selected)


def test_awaiting_evidence_cases_and_plans_preserve_closed_variants_without_persona():
    summary = {**SUMMARY, "status": "awaiting-evidence", "lifecycle": lifecycle("awaiting-evidence")}
    plan = {**PLAN, "resolution": "awaiting-evidence", "persona": {"status": "not-applicable"}}
    page = {**BASE, "total": 1, "items": [summary]}
    assert SimulationWorldCasesPage.model_validate(page).model_dump(exclude_none=True) == page
    assert SimulationWorldCasesInput(runId="run", status="awaiting-evidence").status == "awaiting-evidence"
    value = with_tracks({"section": "plans", "summary": summary, "total": 1, "items": [plan]})
    payload = {**BASE, "requestId": "case", "section": "plans", "status": "found", "value": value}
    assert SimulationWorldCaseInspection.model_validate(payload).model_dump(exclude_none=True) == payload
    for changed in [{**plan, "resolution": "awaiting-evidence/v2"}, {**plan, "persona": {"status": "withheld"}},
                    {**plan, "actorId": "injected"}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**payload, "value": {**value, "items": [changed]}})
    with pytest.raises(ValidationError):
        SimulationWorldCasesPage.model_validate({**page, "items": [{**summary, "status": "unknown-wait"}]})


@pytest.mark.parametrize("terminal_kind", ["evidence-deadline", "evidence-exhausted"])
def test_latest_evidence_projection_enforces_disclosure_and_deadline_source(terminal_kind):
    import copy
    text = lambda value: {"text": value, "truncated": False}
    challenge = {"id": "challenge", "status": "answered", "round": 1,
                 "fields": [{"code": "invoice", "description": text("Original invoice")}], "responders": ["member"],
                 "deadline": "100", "maxAttempts": 2, "attemptsUsed": 1}
    revision = {"id": "revision", "revision": 1, "sequence": 3, "actorId": "member", "answers": {"status": "withheld"}}
    evidence = {"inputRevision": 1, "latestChallenge": challenge, "latestRevision": revision}
    value = {**DETAILS[0], "evidence": evidence}
    payload = {**BASE, "requestId": "case", "section": "request", "status": "found", "value": value}
    assert SimulationWorldCaseInspection.model_validate(payload).model_dump(exclude_none=True) == payload
    allowed = copy.deepcopy(payload)
    allowed["value"]["evidence"]["latestRevision"]["answers"] = {"status": "allowed", "items": [{"field": "invoice", "text": text("Answer")}]}
    assert SimulationWorldCaseInspection.model_validate(allowed).model_dump(exclude_none=True) == allowed
    for change in [None, {**evidence, "latestRevision": None}, {**evidence, "latestChallenge": None},
                   {**evidence, "inputRevision": 2}, {**evidence, "revisions": [revision]},
                   {**evidence, "latestChallenge": {**challenge, "attemptsUsed": 3}},
                   {**evidence, "latestChallenge": {**challenge, "responders": ["member", "member"]}},
                   {**evidence, "latestChallenge": {**challenge, "deadline": "01"}},
                   {**evidence, "latestRevision": {**revision, "binding": {"sessionId": "private"}}},
                   {**evidence, "latestRevision": {**revision, "answers": {"status": "withheld", "items": []}}}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**payload, "value": {**value, "evidence": change}})
    expired = {**SUMMARY, "status": "rejected", "lifecycle": lifecycle("rejected")}
    result = {**RESULT, "source": {"kind": terminal_kind, "challengeId": "challenge",
                         **({"eventId": "deadline"} if terminal_kind == "evidence-deadline" else {"decisionId": "decision"})},
              "outcome": {"kind": "rejected", "reason": "insufficient-information"}, "payload": {}}
    execution = {**BASE, "requestId": "case", "section": "execution", "status": "found",
                 "value": {"section": "execution", "summary": expired, "result": result}}
    assert SimulationWorldCaseInspection.model_validate(execution).model_dump(exclude_none=True) == execution
    for change in [{**result, "source": {**result["source"], "commandId": "fake"}},
                   {**result, "source": {"kind": terminal_kind, "challengeId": "challenge"}},
                   {**result, "source": {"kind": terminal_kind, "challengeId": "challenge",
                     **({"decisionId": "wrong"} if terminal_kind == "evidence-deadline" else {"eventId": "wrong"})}},
                   {**result, "outcome": {"kind": "rejected", "reason": "policy"}}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**execution, "value": {**execution["value"], "result": change}})


def test_v2_tracks_are_required_and_keep_committed_business_independent_from_unknown_callback_and_post():
    from copy import deepcopy
    tracks = lifecycle("committed")
    tracks["plan"] = {"id": "plan", "status": "accepted", "resolution": "apply"}
    tracks["execution"]["callback"] = {"planId": "plan", "mode": "execute", "sequence": 5, "updates": 2,
                                         "time": "5", "status": "outcome-unknown", "reason": "callback-unconfirmed"}
    tracks["notification"]["result"] = {"resultId": "result", "wake": {"id": "wake", "status": "completed"},
                                          "post": {**POST, "status": "outcome-unknown", "publication": "unknown"}}
    summary = {**COMMITTED, "lifecycle": tracks}
    page = {**BASE, "total": 1, "items": [summary]}
    parsed = SimulationWorldCasesPage.model_validate(page)
    assert parsed.model_dump(exclude_none=True) == page  # Explicit no-Channel request remains required even in optional dumps.
    assert parsed.items[0].lifecycle.execution.business.status == "committed"
    assert parsed.items[0].lifecycle.execution.callback.status == "outcome-unknown"
    rejected = [{**summary, "apiVersion": "clocky.world-case/v1"},
                {key: value for key, value in summary.items() if key != "lifecycle"}]
    for path, value in [(('request', 'status'), 'open'), (('execution', 'business'), {'status': 'none'}),
                        (('execution', 'callback', 'reason'), None), (('notification',), {}),
                        (('plan',), {'status': 'none', 'id': 'invented'}), (('privatePayload',), 'secret')]:
        changed = deepcopy(summary)
        target = changed['lifecycle']
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        rejected.append(changed)
    for changed in rejected:
        with pytest.raises(ValidationError):
            SimulationWorldCasesPage.model_validate({**page, "items": [changed]})


def test_detail_and_summary_tracks_reject_cross_prefix_facts_but_allow_intermediate_plan_pages():
    from copy import deepcopy
    value = with_tracks({"section": "execution", "summary": COMMITTED, "result": RESULT, "reservation": RESERVATION})
    source = {**BASE, "requestId": "case", "section": "execution", "status": "found", "value": value}
    SimulationWorldCaseInspection.model_validate(source)
    callback = {"planId": "plan", "mode": "execute", "sequence": 5, "updates": 2, "time": "5",
                "status": "outcome-unknown", "reason": "callback-unconfirmed"}
    changed_summary = deepcopy(value["summary"])
    changed_summary["lifecycle"]["execution"]["callback"] = callback
    for changed in [{**value, "observation": callback}, {**value, "summary": changed_summary},
                    {**value, "result": {**RESULT, "id": "another-result"}}, {**value, "result": None}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**source, "value": changed})
    notified = with_tracks({"section": "notification", "summary": SUMMARY, "request": POST})
    source = {**BASE, "requestId": "case", "section": "notification", "status": "found", "value": notified}
    SimulationWorldCaseInspection.model_validate(source)
    for changed in [{**notified, "request": None},
                    {**notified, "result": {"resultId": "extra-result", "wake": {"id": "wake", "status": "scheduled"}}},
                    {**notified, "firstAction": {"wake": {"id": "extra-wake", "status": "scheduled"}}}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**source, "value": changed})
    planned = with_tracks({"section": "plans", "summary": SUMMARY, "total": 1, "items": [PLAN]})
    intermediate = {**planned, "total": 2, "nextCursor": "next-page", "items": [{**PLAN, "id": "earlier-plan"}]}
    source = {**BASE, "requestId": "case", "section": "plans", "status": "found", "value": intermediate}
    SimulationWorldCaseInspection.model_validate(source)
    for changed in [{**intermediate, "nextCursor": None}, {**planned, "total": 0, "items": []}]:
        with pytest.raises(ValidationError):
            SimulationWorldCaseInspection.model_validate({**source, "value": changed})


def test_public_business_summary_checks_source_cut_and_preserves_explicit_unknown_reasons():
    from clocky.simulation_world_cases import BusinessSummary
    names = ("businessEntities", "firms", "alliances", "organizations", "memberships", "employmentRelationships",
             "founderRepresentedEntities", "employedPeople", "technicalRoles", "independentSessions", "openOrders", "openLoans")
    value = {"version": 1, "label": "Public operation", "submission": "accepted", "execution": "unknown",
             "businessOutcome": "unknown", "counts": {name: {"status": "unknown", "reason": "missing-evidence"} for name in names},
             "sources": [{"kind": "request", "sequence": 0}], "nativeRevision": BASE["snapshotRevision"]}
    assert BusinessSummary.model_validate(value).counts.openOrders.reason == "missing-evidence"
    assert BusinessSummary.model_validate({**value, "label": "😀" * 40}).label == "😀" * 40
    with pytest.raises(ValidationError):
        BusinessSummary.model_validate({**value, "label": "😀" * 41})
    with pytest.raises(ValidationError):
        BusinessSummary.model_validate({**value, "sources": [{"kind": "environment", "sequence": value["nativeRevision"] + 1}]})
    page = {**BASE, "total": 1, "items": [{**SUMMARY, "businessSummary": {"status": "allowed", "value": value}}]}
    assert SimulationWorldCasesPage.model_validate(page).items[0].businessSummary.status == "allowed"
    page["items"][0]["businessSummary"]["value"] = {**value, "nativeRevision": value["nativeRevision"] + 1}
    with pytest.raises(ValidationError):
        SimulationWorldCasesPage.model_validate(page)
