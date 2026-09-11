"""Strict principal inbox wire parsing and actor-free SDK request forwarding."""
import pytest
from pydantic import ValidationError
from clocky.client import HarnessClient
from clocky.models import TeamHumanInboxPage, TeamHumanInboxAcknowledgement


def test_inbox_wrappers_preserve_cursor_and_never_accept_principal_identity(monkeypatch):
    client = HarnessClient()
    calls = []

    def request(method, params, *, response_model):
        calls.append((method, params))
        value = {"displayCursor": 4} if method.endswith("acknowledge") else {"items": [], "displayCursor": 4, "cursor": 6}
        return response_model.model_validate(value)

    monkeypatch.setattr(client, "request", request)
    assert client.inbox_read(after_cursor=4, limit=2).cursor == 6
    assert client.inbox_watch(after_cursor=6).displayCursor == 4
    assert client.inbox_acknowledge(4).displayCursor == 4
    assert calls == [("team/inbox-read", {"afterCursor": 4, "limit": 2}), ("team/inbox-watch", {"afterCursor": 6}), ("team/inbox-acknowledge", {"throughCursor": 4})]
    with pytest.raises(TypeError):
        client.inbox_read(principal_id="someone-else")


@pytest.mark.parametrize("value", [{}, {"items": [], "displayCursor": -2, "cursor": 1}, {"items": [], "displayCursor": 0, "cursor": 1, "actor": "forged"}, {"items": [{"kind": "final"}], "displayCursor": -1, "cursor": 0}])
def test_inbox_rejects_incomplete_or_invalid_wire_results(value):
    with pytest.raises(ValidationError):
        TeamHumanInboxPage.model_validate(value)


def test_display_ack_requires_a_durable_cursor():
    with pytest.raises(ValidationError):
        TeamHumanInboxAcknowledgement.model_validate({"displayCursor": "4"})


def test_typed_action_response_preserves_admission_and_rejects_actor_fields(monkeypatch):
    from clocky import TeamHumanActionResponseRequest
    client = HarnessClient()
    observed = []
    action = {"id": "action", "teamId": "team", "kind": "question", "phase": "cancelled", "sessionId": "session",
              "participantId": "worker", "sourceId": "question", "details": {}, "outcome": {"kind": "unavailable"}, "createdAt": 1, "updatedAt": 2}

    def request(method, params, *, response_model):
        observed.append((method, params))
        return response_model.model_validate({"kind": "unavailable", "action": action})

    monkeypatch.setattr(client, "request", request)
    value = {"teamId": "team", "actionId": "action", "expectedUpdatedAt": 1, "idempotencyKey": "response",
             "answer": {"kind": "question", "answers": [{"id": "format", "selected": ["Text"]}]}}
    result = client.inbox_respond(TeamHumanActionResponseRequest.model_validate(value))
    assert result.kind == "unavailable"
    assert result.action.id == "action"
    assert observed == [("team/inbox-respond", value)]
    with pytest.raises(ValidationError):
        TeamHumanActionResponseRequest.model_validate({**value, "actor": "forged"})


def test_inbox_action_cannot_omit_its_request_provenance():
    with pytest.raises(ValidationError):
        TeamHumanInboxPage.model_validate({"items": [{"kind": "action", "principalId": "principal", "recipientId": "human",
            "teamId": "team", "sequence": 0, "text": "Question", "action": {"kind": "question", "teamId": "team"}}],
            "displayCursor": -1, "cursor": 0})
