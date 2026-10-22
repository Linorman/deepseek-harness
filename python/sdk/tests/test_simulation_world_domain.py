"""World domain wire owns exact selectors, typed windows, separate disclosure and carrier correlation."""
from copy import deepcopy
import json
import pytest
from pydantic import ValidationError
from clocky import (SimulationWorldDomainInput, SimulationWorldDomainResult,
                    HarnessClient, HarnessConfig, Clocky, ClockyConfig, SdkProtocolError)

TEXT = {"text": "Original", "truncated": False}
BODY = {"state": "withheld"}
BASE = {"apiVersion": "clocky.world-read/v1", "runId": "run", "snapshotRevision": 9,
        "readVersion": "policy", "observedAt": 1, "status": "found"}
NORM_ID = json.dumps(["norm", "9007199254740993"], separators=(",", ":"))
NORM = {"id": NORM_ID, "normId": "norm", "title": TEXT, "version": "9007199254740993", "enforcement": {"mode": "advisory"},
        "scope": TEXT, "body": BODY, "sources": [{"kind": "record", "sequence": 3}]}
TALLY = {"for": 0, "against": 0, "abstain": 0, "pending": 1, "electorate": 1, "threshold": 1,
         "quorum": 1, "rule": "unanimous", "closure": "open"}
PROPOSAL = {"id": "proposal", "title": TEXT, "committee": TEXT, "status": "voting", "deadline": "9999999999999999999", "tally": TALLY}
ROW = {"key": "vendor", "name": TEXT, "kind": "rule", "generation": 1}
SELECTORS = [
    {"kind": "overview"}, {"kind": "organization", "lens": "structure"},
    {"kind": "person", "personId": "person", "section": "identity"},
    {"kind": "governance", "lens": "norms"}, {"kind": "proposal", "proposalId": "proposal", "section": "record"},
    {"kind": "norm", "versionId": NORM_ID}, {"kind": "external"},
    {"kind": "identity", "key": "vendor", "section": "record"}, {"kind": "case-extensions", "requestIds": ["case"]},
]


def payload(selector):
    kind = selector["kind"]
    scope = {"organization": "organization/structure", "person": "person/identity", "governance": "governance/norms",
             "proposal": "proposal/record", "norm": "norm/record", "external": "external/identities",
             "identity": "identity/record", "overview": "overview/upcoming", "case-extensions": "case-extensions"}[kind]
    coverage = {"loaded": 1, "total": 1, "revision": 9, "scope": scope, "complete": True, "at": "0"}
    values = {
        "overview": {"runId": "run", "revision": 9, "now": "0", "tickUnit": "minute", "attention": {
            "handoffRequired": 0, "outcomeUnknown": 0, "retirementUnconfirmed": 0, "implementationMissing": 0, "evidenceRequired": 0},
            "upcoming": [{"at": "2", "label": TEXT}], "proposals": [], "norms": {"active": 1, "knownNotEffective": 0},
            "external": {"identities": 1, "byKind": {"rule": 1}}, "caseFlow": []},
        "organization": {"runId": "run", "coverage": coverage, "now": "0", "tickUnit": "minute", "nodes": [{"id": "unit", "kind": "unit", "name": TEXT}],
                         "edges": [], "people": [], "range": {"from": "0", "until": "0"}, "unloadedNodes": 0},
        "person": {"runId": "run", "personId": "person", "revision": 1, "name": TEXT, "employment": "employed", "residency": "unknown",
                   "entity": {"kind": "entity", "id": "person"}, "persona": BODY, "tenures": [], "obligations": [], "actions": [], "sources": []},
        "governance": {"runId": "run", "coverage": coverage, "now": "0", "tickUnit": "minute", "proposals": [], "norms": [NORM]},
        "proposal": {**PROPOSAL, "runId": "run", "version": "1", "bodyHash": "hash", "body": BODY, "frozenAt": "0",
                     "electorateMembers": [], "sources": [], "enactment": {"state": "not-applicable"}},
        "norm": NORM, "external": {"runId": "run", "coverage": coverage, "identities": [ROW]},
        "identity": {**ROW, "runId": "run", "entity": {"kind": "entity", "id": "vendor"}, "revision": 1, "expansion": TEXT,
                     "facts": [], "interactions": [], "sources": []},
        "case-extensions": [{"businessSummary": {"status": "unsupported"}, "requestId": "case", "domain": "organization", "operation": "depart", "businessKey": BODY, "tracks": [],
                             "sources": [{"kind": "envelope", "id": "envelope", "teamId": "team", "channelId": "channel", "envelopeId": "envelope", "envelopeSequence": 3}]}],
    }
    return deepcopy({**BASE, "kind": kind, "selection": {"runId": "run", **selector}, "coverage": coverage, "value": values[kind]})


@pytest.mark.parametrize("selector", SELECTORS)
def test_nine_exact_families_reject_extra_selector_and_native_fields(selector):
    query = {"runId": "run", **selector}
    assert SimulationWorldDomainInput.model_validate(query).model_dump(exclude_none=True) == query
    wire = payload(selector)
    assert SimulationWorldDomainResult.model_validate(wire).model_dump(exclude_none=True) == wire
    for key in (set(selector) - {"kind"}):
        with pytest.raises(ValidationError):
            SimulationWorldDomainInput.model_validate({key_: value for key_, value in query.items() if key_ != key})
    for changed in [{**query, "rawNative": {}}, {**query, "cursor": None}, {**query, "at": 0}, {**query, "limit": True},
                    {**query, "limit": 0}, {**query, "scopeId": "injected"}]:
        with pytest.raises(ValidationError):
            SimulationWorldDomainInput.model_validate(changed)
    for changed in [{**wire, "rawNative": {}}, {**wire, "runId": "other"}, {**wire, "kind": "other"},
                    {**wire, "apiVersion": "clocky.world-read/v0"}, {**wire, "status": "missing"},
                    {**wire, "selection": {**query, "expectedRevision": 8}},
                    {**wire, "selection": {**query, "readVersion": "other"}},
                    {**wire, "selection": {**query, "at": "1"}}]:
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate(changed)
    value = wire["value"]
    if isinstance(value, dict):
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate({**wire, "value": {**value, "privateBody": "canary"}})
    absent = {key: value for key, value in wire.items() if key != "value"}
    assert SimulationWorldDomainResult.model_validate({**absent, "status": "missing"}).value is None
    with pytest.raises(ValidationError):
        SimulationWorldDomainResult.model_validate({**absent, "status": "missing", "value": None})


@pytest.mark.parametrize("query", [
    {"kind": "overview", "lens": "structure"}, {"kind": "organization", "lens": "norms"},
    {"kind": "person", "personId": "p", "section": "votes"}, {"kind": "governance", "lens": "structure"},
    {"kind": "proposal", "proposalId": "p", "section": "facts"}, {"kind": "external", "key": "e"},
    {"kind": "identity", "key": "e", "section": "tenures"}, {"kind": "case-extensions", "requestIds": ["same", "same"]},
])
def test_selector_fields_and_sections_cannot_cross_families(query):
    with pytest.raises(ValidationError):
        SimulationWorldDomainInput.model_validate({"runId": "run", **query})


@pytest.mark.parametrize("kind,key,replacement", [
    ("person", "personId", "substituted"), ("person", "runId", "substituted"),
    ("proposal", "id", "substituted"), ("norm", "id", "substituted"),
    ("norm", "version", 9007199254740993), ("identity", "key", "substituted"),
    ("identity", "facts", [{"key": "fact", "value": {"state": "unknown"}, "report": False}]),
    ("external", "identities", []), ("overview", "revision", 8),
])
def test_echoed_selector_does_not_allow_substituting_original_value(kind, key, replacement):
    wire = payload(next(query for query in SELECTORS if query["kind"] == kind))
    wire["value"][key] = replacement
    with pytest.raises(ValidationError):
        SimulationWorldDomainResult.model_validate(wire)


def test_nullable_unknown_obligations_and_canonical_decimal_versions_survive_wire_roundtrip():
    wire = payload(SELECTORS[1]); wire["selection"]["lens"] = "people"
    wire["coverage"]["scope"] = "organization/people"; wire["value"]["coverage"] = deepcopy(wire["coverage"])
    wire["value"]["nodes"] = []
    person = {"id": "person", "name": TEXT, "employment": "employed", "cognition": "agent", "residency": "unknown",
              "pendingObligations": None, "tenures": [{"id": "tenure", "personId": "person", "positionId": "position", "positionName": TEXT,
                                                       "from": "9007199254740993", "revision": 1}]}
    wire["value"]["people"] = [person]
    parsed = SimulationWorldDomainResult.model_validate(wire)
    assert parsed.model_dump(exclude_none=True) == wire
    for patch in [{"pendingObligations": False}, {"residency": "pretended"}]:
        bad = deepcopy(wire); bad["value"]["people"][0].update(patch)
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate(bad)
    for patch in [{"complete": True, "nextCursor": "more"}, {"total": 0}, {"revision": 8}]:
        bad = deepcopy(wire); bad["coverage"].update(patch)
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate(bad)


def test_both_public_carriers_parse_real_wire_and_bind_all_selector_fields(monkeypatch):
    low = HarnessClient(HarnessConfig())
    high = Clocky(ClockyConfig(credential="fixture", provider="fixture", model="fixture"))
    monkeypatch.setattr(high, "start", lambda: None)
    for public, transport in [(low, low), (high, high._client)]:
        for selector in SELECTORS:
            query = SimulationWorldDomainInput.model_validate({"runId": "run", **selector})
            sent = []
            def send(method, params, **_kwargs):
                sent.append((method, params)); return payload(selector)
            monkeypatch.setattr(transport, "_request_raw", send)
            assert public.read_simulation_world_domain(query).kind == selector["kind"]
            assert sent == [("simulation/world-domain-read", query.model_dump(exclude_none=True))]
        selector = SELECTORS[1]; query = SimulationWorldDomainInput.model_validate({"runId": "run", **selector})
        bad = payload(selector); bad["selection"]["limit"] = 1
        monkeypatch.setattr(transport, "_request_raw", lambda *_args, **_kwargs: bad)
        with pytest.raises(SdkProtocolError, match="another original selection"):
            public.read_simulation_world_domain(query)


REFS = [
    {"kind": "decision", "id": "decision", "epoch": "1", "slot": "0"},
    {"kind": "operation", "id": "operation", "decisionId": "decision", "index": 0, "fingerprint": "hash"},
    {"kind": "outbox", "operationId": "operation", "fingerprint": "hash", "attempt": None},
    {"kind": "task-assignment", "teamId": "team", "taskId": "task", "attemptId": "attempt", "operationId": "operation", "selectedRevision": 1, "reservedSequence": 2},
    {"kind": "task-execution", "teamId": "team", "taskId": "task", "attemptId": "attempt", "selectedRevision": 1, "observedRevision": None},
    {"kind": "task-target", "teamId": "team", "taskId": "task", "operationId": "operation", "fingerprint": "hash"},
    {"kind": "interaction", "id": "interaction", "revision": 1}, {"kind": "commitment", "id": "commitment", "revision": 1},
    {"kind": "resource", "id": "resource", "revision": 1, "relation": "owner"},
    {"kind": "resource-grant", "id": "grant", "revision": 1, "relation": "grantee"},
    {"kind": "scheduled-event", "id": "event", "key": {"time": "0", "microstep": "0", "phase": "delivery", "slot": "1"}},
    {"kind": "wake", "eventId": "event", "decisionId": None},
    {"kind": "message", "operationId": "operation", "channelId": "channel", "recipientEntityId": "person", "direction": "incoming", "envelopeId": None},
    {"kind": "relation", "id": "relation", "revision": 1, "relation": "reports-to", "subject": "subordinate", "object": "person", "scope": None, "validFrom": "0", "validUntil": None},
    {"kind": "writer", "entityId": "person", "epoch": "1", "reservationId": "reservation", "activationId": None},
    {"kind": "world-reservation", "intentId": "intent", "requestId": "request", "planId": "plan", "updatedSequence": 3},
    {"kind": "world-case", "requestId": "request", "intentId": "intent", "sequence": 1},
    {"kind": "team-task", "teamId": "team", "taskId": "task", "revision": 1, "relation": "creator"},
    {"kind": "team-attempt", "teamId": "team", "taskId": "task", "attemptId": "attempt", "revision": 1},
    {"kind": "channel-delivery", "channelId": "channel", "envelopeId": "envelope", "recipientId": "recipient", "sequence": 1, "direction": "outgoing"},
    {"kind": "team-activation", "teamId": "team", "activationId": "activation", "reservationId": None},
    {"kind": "team-startup", "teamId": "team", "participantId": "participant", "reservationId": "reservation"},
    {"kind": "team-workspace", "teamId": "team", "allocationId": "allocation", "taskId": "task", "attemptId": "attempt", "revision": 1},
]


@pytest.mark.parametrize("ref", REFS, ids=[ref["kind"] for ref in REFS])
def test_all_original_owner_reference_variants_are_strict_and_preserve_required_wire_nulls(ref):
    from clocky.simulation_personnel import PersonnelOriginal
    source = {"owner": {"kind": "native", "runId": "run", "subsystem": "operation"}, "ref": ref, "cursor": 9}
    assert PersonnelOriginal.model_validate(source).model_dump(exclude_none=True) == source
    for key in ref:
        with pytest.raises(ValidationError):
            PersonnelOriginal.model_validate({**source, "ref": {key_: value for key_, value in ref.items() if key_ != key}})
    with pytest.raises(ValidationError):
        PersonnelOriginal.model_validate({**source, "ref": {**ref, "privateBody": "canary"}})
    wire = payload(SELECTORS[2]); wire["selection"]["section"] = "obligations"; wire["coverage"]["scope"] = "person/obligations"
    obligation = {"id": "source", "kind": "owner-duty", "label": TEXT, "owner": TEXT, "state": "waiting", "revision": 9,
                  "original": source, "certainty": "recorded", "ownerState": "pending", "dispositions": ["wait"]}
    wire["value"]["obligations"] = [obligation]
    assert SimulationWorldDomainResult.model_validate(wire).model_dump(exclude_none=True) == wire
    for key in ["original", "certainty", "ownerState"]:
        bad = deepcopy(wire); del bad["value"]["obligations"][0][key]
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate(bad)


def test_envelope_references_require_exact_identity_and_a_locatable_canonical_or_frozen_original():
    from clocky.simulation_world_domain import WorldEnvelopeRef
    envelope = {"kind": "envelope", "id": "original", "envelopeId": "original", "teamId": "team", "channelId": "channel"}
    for original in [{**envelope, "envelopeSequence": 1}, {**envelope, "decisionId": "decision", "sourceIndex": 0}]:
        assert WorldEnvelopeRef.model_validate(original).model_dump(exclude_none=True) == original
    for malformed in [envelope, {**envelope, "decisionId": "decision"},
                      {**envelope, "envelopeSequence": 1, "sourceIndex": 0},
                      {**envelope, "envelopeSequence": 1, "id": "substitution"}]:
        with pytest.raises(ValidationError):
            WorldEnvelopeRef.model_validate(malformed)


@pytest.mark.parametrize("section", ["record", "facts", "interactions", "representatives"])
def test_selected_identity_arrays_require_exact_coverage_and_explicit_representation_pages(section):
    source = payload(SELECTORS[7]); source["selection"]["section"] = section
    source["coverage"].update(scope=f"identity/{section}", loaded=1 if section == "record" else 0, total=1 if section == "record" else 0)
    if section == "representatives":
        source["value"]["representatives"] = []
    assert SimulationWorldDomainResult.model_validate(source).model_dump(exclude_none=True) == source
    bad = deepcopy(source); bad["coverage"].update(loaded=0 if section == "record" else 1, total=1)
    with pytest.raises(ValidationError):
        SimulationWorldDomainResult.model_validate(bad)
    if section == "representatives":
        del source["value"]["representatives"]
        with pytest.raises(ValidationError):
            SimulationWorldDomainResult.model_validate(source)
