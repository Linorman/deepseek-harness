from __future__ import annotations

import inspect
import hashlib
import json
import queue
import sys
import threading
import time
from pathlib import Path

import pytest
from pydantic import ValidationError

from clocky import (
    Clocky,
    ClockyConfig,
    HarnessError,
    HarnessClient,
    HarnessConfig,
    InitializeResponse,
    JsonObject,
    JsonRpcError,
    Notification,
    NotificationSubscription,
    SdkProtocolError,
    Team,
    TeamChannelResponse,
    TeamChannelAttachmentResponse,
    TeamGetResponse,
    TeamGoalBlocker,
    TeamGoalTransitionInput,
    TeamGoalTransitionRequest,
    TeamGoalUpdateInput,
    TeamGoalUpdateRequest,
    TeamResumeRequest,
    TeamResumeResponse,
    TransportClosedError,
)


SDK_CREDENTIAL = "sdk-test-product-credential"


def test_resume_requests_are_strict_actor_free_and_preserve_cursor_conflicts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = HarnessClient()
    calls: list[tuple[str, JsonObject]] = []
    rejected = False

    def request(method: str, params: JsonObject | None, **_kwargs: object) -> TeamResumeResponse:
        nonlocal rejected
        if params is None:
            raise AssertionError("team/resume requires parameters")
        calls.append((method, params))
        if rejected:
            raise JsonRpcError(-32002, "resume cursor is stale", {"code": "TEAM_CURSOR_CONFLICT"})
        return TeamResumeResponse(teamId="team-resume", coordinatorSessionId="coordinator-resume")

    monkeypatch.setattr(client, "request", request)
    request_model = TeamResumeRequest(teamId="team-resume", expectedCursor=31)
    assert client.resume_team(request_model).teamId == "team-resume"
    assert calls == [("team/resume", {"teamId": "team-resume", "expectedCursor": 31})]

    rejected = True
    with pytest.raises(JsonRpcError) as error:
        client.resume_team(request_model)
    assert error.value.data == {"code": "TEAM_CURSOR_CONFLICT"}
    with pytest.raises(ValidationError):
        TeamResumeRequest.model_validate({"teamId": "team-resume", "expectedCursor": 31, "actor": "forged"})
    with pytest.raises(ValidationError):
        TeamResumeRequest.model_validate({"teamId": "team-resume"})
    with pytest.raises(ValidationError):
        TeamResumeRequest.model_validate({"teamId": "team-resume", "expectedCursor": -1})


def test_high_level_resume_reads_the_fresh_cursor_or_uses_an_explicit_fence() -> None:
    calls: list[tuple[str, object]] = []

    class Client:
        def initialize(self, **_kwargs: object) -> None:
            calls.append(("initialize", None))

        def get_team(self, team_id: str) -> TeamGetResponse:
            calls.append(("get", team_id))
            cursor = 41 if team_id == "team-harness" else 57
            return TeamGetResponse(state={"team": {"id": team_id, "cursor": cursor}})

        def resume_team(self, request: TeamResumeRequest) -> TeamResumeResponse:
            calls.append(("resume", request))
            return TeamResumeResponse(teamId=request.teamId, coordinatorSessionId=f"{request.teamId}-coordinator")

    harness = Clocky(credential=SDK_CREDENTIAL, provider="test-provider", model="test-model")
    harness._client = Client()  # type: ignore[assignment]

    resumed = harness.resume_team("team-harness")
    team = Team(harness, "team-handle", "team-handle-coordinator")
    team.resume()
    team.resume(expected_cursor=73)

    assert resumed.id == "team-harness"
    assert calls == [
        ("initialize", None),
        ("get", "team-harness"),
        ("resume", TeamResumeRequest(teamId="team-harness", expectedCursor=41)),
        ("get", "team-handle"),
        ("resume", TeamResumeRequest(teamId="team-handle", expectedCursor=57)),
        ("resume", TeamResumeRequest(teamId="team-handle", expectedCursor=73)),
    ]


def test_team_task_helpers_keep_the_handle_team_id() -> None:
    calls: list[tuple[str, JsonObject]] = []

    class Client:
        def create_team_task(self, payload: JsonObject) -> None:
            calls.append(("create", payload))

        def update_team_task(self, payload: JsonObject) -> None:
            calls.append(("update", payload))

        def cancel_team_task(self, payload: JsonObject) -> None:
            calls.append(("cancel", payload))

        def delete_team_task(self, payload: JsonObject) -> None:
            calls.append(("delete", payload))

        def review_team_task(self, payload: JsonObject) -> None:
            calls.append(("review", payload))

        def invite_team_member(self, payload: JsonObject) -> None:
            calls.append(("invite", payload))

        def activate_team_member(self, payload: JsonObject) -> None:
            calls.append(("activate", payload))

        def remove_team_member(self, payload: JsonObject) -> None:
            calls.append(("remove", payload))

        def interrupt_team_member(self, payload: JsonObject) -> None:
            calls.append(("interrupt", payload))

        def open_team_channel(self, payload: JsonObject) -> None:
            calls.append(("open-channel", payload))

    class Harness:
        client = Client()

        def start(self) -> None:
            return None

    team = Team(Harness(), "team-bound", "coordinator-bound")
    team.create_task({"teamId": "team-untrusted", "expectedCursor": 1})
    team.update_task({"teamId": "team-untrusted", "taskId": "task", "expectedRevision": 1})
    team.cancel_task({"teamId": "team-untrusted", "taskId": "task", "expectedRevision": 1, "reason": "Only this task."})
    team.delete_task({"teamId": "team-untrusted", "taskId": "task", "expectedRevision": 1})
    team.review_task({"teamId": "team-untrusted", "taskId": "task", "expectedRevision": 1, "decision": "accepted", "reason": "Reviewed."})
    team.invite_member({"teamId": "team-untrusted", "expectedCursor": 1})
    team.activate_member({"teamId": "team-untrusted", "participantId": "participant", "expectedCursor": 1})
    team.remove_member({"teamId": "team-untrusted", "participantId": "participant", "expectedCursor": 1})
    team.interrupt_member({"teamId": "team-untrusted", "participantId": "participant", "expectedCursor": 1})
    team.open_channel({"teamId": "team-untrusted", "expectedCursor": 1})

    assert [name for name, _payload in calls] == [
        "create", "update", "cancel", "delete", "review", "invite", "activate", "remove", "interrupt", "open-channel",
    ]
    assert all(payload["teamId"] == "team-bound" for _name, payload in calls)
    assert calls[2][1]["reason"] == "Only this task."


def test_team_goal_helpers_use_strict_actor_free_inputs_and_pin_the_handle_team_id() -> None:
    calls: list[TeamGoalUpdateRequest | TeamGoalTransitionRequest] = []

    class Client:
        def update_team_goal(self, request: TeamGoalUpdateRequest) -> None:
            calls.append(request)

        def transition_team_goal(self, request: TeamGoalTransitionRequest) -> None:
            calls.append(request)

    class Harness:
        client = Client()

        def start(self) -> None:
            return None

    team = Team(Harness(), "team-bound", "coordinator-bound")
    team.update_goal(TeamGoalUpdateInput(expectedRevision=1, objective="Updated objective."))
    team.transition_goal(
        TeamGoalTransitionInput(
            expectedRevision=2,
            phase="blocked",
            blocker=TeamGoalBlocker(code="waiting", message="Waiting for approval."),
        )
    )

    assert calls == [
        TeamGoalUpdateRequest(teamId="team-bound", expectedRevision=1, objective="Updated objective."),
        TeamGoalTransitionRequest(
            teamId="team-bound",
            expectedRevision=2,
            phase="blocked",
            blocker=TeamGoalBlocker(code="waiting", message="Waiting for approval."),
        ),
    ]
    with pytest.raises(ValidationError):
        TeamGoalUpdateInput.model_validate({"expectedRevision": 1, "objective": "No actor.", "actor": "forged"})
    with pytest.raises(ValidationError):
        TeamGoalUpdateInput.model_validate({"teamId": "team-untrusted", "expectedRevision": 1, "objective": "No override."})
    with pytest.raises(ValidationError):
        TeamGoalTransitionInput.model_validate({"expectedRevision": 2, "phase": "blocked"})
    with pytest.raises(ValidationError):
        TeamGoalTransitionInput.model_validate({"expectedRevision": 2, "phase": "paused", "blocker": {"code": "x", "message": "x"}})


def test_low_level_goal_methods_serialize_strict_actor_free_requests_and_propagate_errors(tmp_path: Path) -> None:
    script = tmp_path / "goal_runtime.py"
    requests = tmp_path / "goal-requests.json"
    script.write_text(
        """
import json
import os
import sys

requests = []
for line in sys.stdin:
    message = json.loads(line)
    requests.append(message)
    method = message.get("method")
    if method == "initialize":
        response = {"result": {"serverInfo": {"name": "goal-runtime"}}}
    elif method == "team/goal-update" and os.environ.get("GOAL_ERROR") == "1":
        response = {"error": {"code": -32002, "message": "goal rejected", "data": {"code": "TEAM_POLICY_DENIED"}}}
    elif method == "team/goal-update":
        response = {"result": {"state": {"team": {"id": message["params"]["teamId"]}, "goal": {"revision": 2}}}}
    elif method == "team/goal-transition":
        response = {"result": {"state": {"team": {"id": message["params"]["teamId"]}, "goal": {"revision": 3}}}}
    elif method == "shutdown":
        json.dump(requests, open(os.environ.get("GOAL_REQUESTS", "goal-requests.json"), "w"))
        response = {"result": {}}
    else:
        response = {"result": {}}
    response.update({"jsonrpc": "2.0", "id": message["id"]})
    print(json.dumps(response), flush=True)
    if method == "shutdown":
        break
""".strip()
    )

    with HarnessClient(
        HarnessConfig(launch_args_override=(sys.executable, str(script)), env={"GOAL_REQUESTS": str(requests)})
    ) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        updated = client.update_team_goal(
            TeamGoalUpdateRequest(teamId="team-goal", expectedRevision=1, objective="Updated objective.")
        )
        transitioned = client.transition_team_goal(
            TeamGoalTransitionRequest(
                teamId="team-goal",
                expectedRevision=2,
                phase="blocked",
                blocker=TeamGoalBlocker(code="waiting", message="Waiting for approval."),
            )
        )

    assert updated.state["team"]["id"] == "team-goal"
    assert transitioned.state["goal"]["revision"] == 3
    wire = json.loads(requests.read_text())
    assert wire[1]["params"] == {"teamId": "team-goal", "expectedRevision": 1, "objective": "Updated objective."}
    assert wire[2]["params"] == {
        "teamId": "team-goal",
        "expectedRevision": 2,
        "phase": "blocked",
        "blocker": {"code": "waiting", "message": "Waiting for approval."},
    }
    assert all("actor" not in request["params"] for request in wire[1:3])

    with HarnessClient(
        HarnessConfig(
            launch_args_override=(sys.executable, str(script)),
            env={"GOAL_ERROR": "1", "GOAL_REQUESTS": str(tmp_path / "goal-error-requests.json")},
        )
    ) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        with pytest.raises(JsonRpcError) as error:
            client.update_team_goal(
                TeamGoalUpdateRequest(teamId="team-goal", expectedRevision=1, objective="Rejected objective.")
            )

    assert error.value.code == -32002
    assert error.value.data == {"code": "TEAM_POLICY_DENIED"}


def test_high_level_sdk_runs_team_and_collects_coordinator_transcript(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    env_dump = tmp_path / "env.json"
    requests_dump = tmp_path / "requests.json"
    script.write_text(
        """
import json
import os
import sys

requests = []
json.dump({
    "TEST_API_KEY": os.environ.get("TEST_API_KEY"),
    "TEST_BASE_URL": os.environ.get("TEST_BASE_URL"),
    "CLOCKY_CWD": os.environ.get("CLOCKY_CWD"),
    "CLOCKY_SESSION_ROOT": os.environ.get("CLOCKY_SESSION_ROOT"),
    "CLOCKY_CORDIS_CONFIG": os.environ.get("CLOCKY_CORDIS_CONFIG"),
}, open(os.environ["ENV_DUMP"], "w"))

def notify(method, params):
    print(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}), flush=True)

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        requests.append(msg)
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif method == "team/create":
        requests.append(msg)
        coordinator = "team-1-coordinator"
        notify("session.event", {
            "sessionId": coordinator,
            "event": {
                "type": "agent/inbox/spliced",
                "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "team-envelope-1"}]},
            },
        })
        notify("session.status", {"sessionId": coordinator, "status": "running"})
        print(json.dumps({
            "jsonrpc": "2.0",
            "id": msg["id"],
            "result": {
                "teamId": "team-1",
                "coordinatorSessionId": coordinator,
                "envelopeId": "team-envelope-1",
            },
        }), flush=True)
    elif method == "team/wait-final":
        requests.append(msg)
        coordinator = "team-1-coordinator"
        notify("session.event", {
            "sessionId": "other",
            "event": {"type": "assistant/message", "data": {"message": {"content": [{"type": "text", "text": "wrong"}]}}},
        })
        notify("session.event", {
            "sessionId": coordinator,
            "event": {
                "type": "assistant/message",
                "data": {"message": {"role": "assistant", "content": [{"type": "text", "text": "hello from runtime"}]}},
            },
        })
        notify("session.status", {"sessionId": coordinator, "status": "idle"})
        print(json.dumps({
            "jsonrpc": "2.0",
            "id": msg["id"],
            "result": {
                "teamId": "team-1",
                "channelId": "direct",
                "envelopeId": "team-final-1",
                "text": "hello from runtime",
            },
        }), flush=True)
    elif method == "shutdown":
        requests.append(msg)
        json.dump(requests, open(os.environ["REQUESTS_DUMP"], "w"))
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"phase": "cancelled"}}), flush=True)
        break
""".strip()
    )

    seen: list[str] = []
    with Clocky(
        credential=SDK_CREDENTIAL,
        provider="test-provider",
        model="test-model",
        max_tokens=4096,
        cwd=str(tmp_path),
        cordis=str(tmp_path / "cordis.yml"),
        session_root=str(tmp_path / "sessions"),
        launch_args_override=(sys.executable, str(script)),
        env={
            "ENV_DUMP": str(env_dump),
            "REQUESTS_DUMP": str(requests_dump),
            "TEST_API_KEY": "env-key",
            "TEST_BASE_URL": "http://127.0.0.1:4321",
        },
    ) as harness:
        result = harness.run("say hello", on_notification=lambda notification: seen.append(notification.method))
        assert harness.client._notifications.qsize() == 0

    assert result.team_id == "team-1"
    assert result.final_response == "hello from runtime"
    assert result.final.team_id == "team-1"
    assert result.final.channel_id == "direct"
    assert result.final.envelope_id == "team-final-1"
    assert [event["type"] for event in result.events] == [
        "agent/inbox/spliced",
        "assistant/message",
    ]
    assert [notification.method for notification in result.notifications] == [
        "session.event",
        "session.status",
        "session.event",
        "session.status",
    ]
    assert seen == [notification.method for notification in result.notifications]
    assert json.loads(env_dump.read_text()) == {
        "TEST_API_KEY": "env-key",
        "TEST_BASE_URL": "http://127.0.0.1:4321",
        "CLOCKY_CWD": str(tmp_path),
        "CLOCKY_SESSION_ROOT": str(tmp_path / "sessions"),
        "CLOCKY_CORDIS_CONFIG": str(tmp_path / "cordis.yml"),
    }
    requests = json.loads(requests_dump.read_text())
    assert requests[0]["params"] == {
        "credential": SDK_CREDENTIAL,
        "cwd": str(tmp_path),
        "provider": "test-provider",
        "model": "test-model",
        "maxTokens": 4096,
    }
    assert requests[1]["method"] == "team/create"
    assert requests[1]["params"] == {
        "objective": "say hello",
        "contentBlocks": [{"type": "text", "text": "say hello"}],
    }
    assert requests[2]["params"] == {"teamId": "team-1"}
    assert {request["method"] for request in requests} == {
        "initialize",
        "team/create",
        "team/wait-final",
        "shutdown",
    }


def test_credential_is_sent_only_in_initialize_not_child_environment_or_arguments(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = tmp_path / "fake_runtime.py"
    capture = tmp_path / "capture.json"
    credential = "python-sdk-handshake-only-credential"
    script.write_text(
        """
import json
import os
import sys

requests = []
for line in sys.stdin:
    message = json.loads(line)
    requests.append(message)
    method = message.get("method")
    if method == "initialize":
        credential = message["params"]["credential"]
        json.dump({
            "argumentContainsCredential": any(credential in argument for argument in sys.argv),
            "environmentNameContainsCredential": any(credential in name for name in os.environ),
            "environmentContainsCredential": any(credential in value for value in os.environ.values()),
        }, open(os.environ["CAPTURE"], "w"))
        result = {"serverInfo": {"name": "fake-runtime"}}
    elif method == "team/list":
        result = {"items": []}
    elif method == "shutdown":
        json.dump(requests, open(os.environ["REQUESTS"], "w"))
        result = {}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
    if method == "shutdown":
        break
""".strip()
    )
    requests = tmp_path / "requests.json"
    monkeypatch.setenv("CLOCKY_TEST_PRODUCT_CREDENTIAL", credential)

    with Clocky(
        credential=credential,
        provider="test-provider",
        model="test-model",
        launch_args_override=(sys.executable, str(script)),
        env={
            "CAPTURE": str(capture),
            "REQUESTS": str(requests),
            "CONFIG_PRODUCT_CREDENTIAL": credential,
            "MIXED_PRODUCT_CREDENTIAL": f"Bearer {credential}",
        },
    ) as harness:
        harness.list_teams()

    assert json.loads(capture.read_text()) == {
        "argumentContainsCredential": False,
        "environmentNameContainsCredential": False,
        "environmentContainsCredential": False,
    }
    sent = json.loads(requests.read_text())
    assert sent[0]["params"]["credential"] == credential
    assert credential not in json.dumps(sent[1:])


def test_relaunch_scrubs_prior_initialization_credentials_from_the_child_environment(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    capture = tmp_path / "capture.jsonl"
    prior_credential = "python-sdk-prior-credential"
    next_credential = "python-sdk-next-credential"
    script.write_text(
        f"""
import json
import os
import sys

PRIOR_CREDENTIAL = {prior_credential!r}
NEXT_CREDENTIAL = {next_credential!r}
for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        with open(os.environ["CAPTURE"], "a") as output:
            output.write(json.dumps({{
                "priorInEnvironment": any(PRIOR_CREDENTIAL in value for value in os.environ.values()),
                "nextInEnvironment": any(NEXT_CREDENTIAL in value for value in os.environ.values()),
            }}) + "\\n")
        result = {{"serverInfo": {{"name": "fake-runtime"}}}}
    elif message.get("method") == "shutdown":
        result = {{}}
    else:
        result = {{}}
    print(json.dumps({{"jsonrpc": "2.0", "id": message["id"], "result": result}}), flush=True)
    if message.get("method") == "shutdown":
        break
""".strip()
    )
    client = HarnessClient(
        HarnessConfig(
            launch_args_override=(sys.executable, str(script)),
            env={"CAPTURE": str(capture), "PRIOR_PRODUCT_CREDENTIAL": prior_credential},
        )
    )

    client.initialize(
        credential=prior_credential,
        provider="test-provider",
        cwd="/workspace",
        model="test-model",
    )
    client.close()
    client.initialize(
        credential=next_credential,
        provider="test-provider",
        cwd="/workspace",
        model="test-model",
    )
    client.close()

    assert [json.loads(line) for line in capture.read_text().splitlines()] == [
        {"priorInEnvironment": False, "nextInEnvironment": False},
        {"priorInEnvironment": False, "nextInEnvironment": False},
    ]


def test_rejected_second_credential_keeps_the_live_runtime_available(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    credential = "python-sdk-live-credential"
    rejected_credential = "python-sdk-rejected-credential"
    script.write_text(
        """
import json
import sys

REJECTED_CREDENTIAL = __REJECTED_CREDENTIAL__
for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        print(REJECTED_CREDENTIAL, file=sys.stderr, flush=True)
        result = {"serverInfo": {"name": "fake-runtime"}}
    elif message.get("method") == "team/list":
        result = {"items": []}
    elif message.get("method") == "shutdown":
        result = {}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
    if message.get("method") == "shutdown":
        break
""".strip().replace("__REJECTED_CREDENTIAL__", repr(rejected_credential))
    )
    client = HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script))))
    client.initialize(credential=credential, provider="test-provider", cwd="/workspace", model="test-model")
    proc = client._proc
    assert proc is not None

    with pytest.raises(SdkProtocolError, match="already bound to another initialization credential") as excinfo:
        client.initialize(
            credential=rejected_credential,
            provider="test-provider",
            cwd="/workspace",
            model="test-model",
        )

    assert excinfo.value.__context__ is None
    assert rejected_credential not in client._runtime_diagnostics()
    assert client._proc is proc
    assert proc.poll() is None
    assert client.list_teams().items == []
    client.close()


def test_initialize_serializes_credential_registration_before_runtime_launch(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        result = {"serverInfo": {"name": "fake-runtime"}}
    elif message.get("method") == "shutdown":
        result = {}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
    if message.get("method") == "shutdown":
        break
""".strip()
    )
    first_credential = "python-sdk-first-concurrent-credential"
    second_credential = "python-sdk-second-concurrent-credential"
    client = HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script))))
    launch_entered = threading.Event()
    release_launch = threading.Event()
    second_called = threading.Event()
    second_remembered = threading.Event()
    failures: queue.Queue[BaseException] = queue.Queue()
    launch = client._launch_runtime
    remember = client._remember_credential

    def delayed_launch(credential: str) -> bool:
        if credential == first_credential:
            launch_entered.set()
            assert release_launch.wait(timeout=1)
        return launch(credential)

    def observed_remember(credential: str) -> None:
        if credential == second_credential:
            second_remembered.set()
        remember(credential)

    client._launch_runtime = delayed_launch
    client._remember_credential = observed_remember

    def initialize(credential: str) -> None:
        try:
            client.initialize(credential=credential, provider="test-provider", cwd="/workspace", model="test-model")
        except BaseException as exc:
            failures.put(exc)

    first = threading.Thread(target=initialize, args=(first_credential,))
    second = threading.Thread(
        target=lambda: (second_called.set(), initialize(second_credential)),
    )
    first.start()
    assert launch_entered.wait(timeout=1)
    second.start()
    assert second_called.wait(timeout=1)
    assert not second_remembered.wait(timeout=0.1)
    assert client._known_credentials() == (first_credential,)
    release_launch.set()
    first.join(timeout=1)
    second.join(timeout=1)
    assert not first.is_alive()
    assert not second.is_alive()
    assert isinstance(failures.get_nowait(), SdkProtocolError)
    assert failures.empty()
    client.close()


def test_initialize_redacts_credential_from_errors_and_stderr_diagnostics(tmp_path: Path) -> None:
    script = tmp_path / "rejecting_runtime.py"
    credential = "python-sdk-redaction-credential"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    if method == "initialize":
        credential = message["params"]["credential"]
        print(f"runtime reflected {credential}", file=sys.stderr, flush=True)
        print(json.dumps({
            "jsonrpc": "2.0",
            "id": message["id"],
            "error": {
                "code": -32001,
                "message": f"rejected {credential}",
                "data": {credential: {"nested": [credential]}},
            },
        }), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    client = HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script))))
    client.start()
    with pytest.raises(JsonRpcError) as excinfo:
        client.initialize(
            credential=credential,
            provider="test-provider",
            cwd="/workspace",
            model="test-model",
        )

    assert "[REDACTED]" in str(excinfo.value)
    assert credential not in str(excinfo.value)
    assert credential not in repr(excinfo.value.data)
    assert excinfo.value.__context__ is None
    assert credential not in client._runtime_diagnostics()


def test_initialize_redacts_a_credential_reflected_by_a_malformed_result(tmp_path: Path) -> None:
    script = tmp_path / "malformed_runtime.py"
    credential = "python-sdk-protocol-redaction-credential"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        credential = message["params"]["credential"]
        print(json.dumps({
            "jsonrpc": "2.0",
            "id": message["id"],
            "result": {"serverInfo": credential},
        }), flush=True)
    elif message.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    client = HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script))))
    client.start()
    with pytest.raises(SdkProtocolError) as excinfo:
        client.initialize(
            credential=credential,
            provider="test-provider",
            cwd="/workspace",
            model="test-model",
        )

    assert credential not in str(excinfo.value)
    assert excinfo.value.__context__ is None


def test_initialize_rejects_missing_or_empty_credential_before_a_transport_write() -> None:
    client = HarnessClient()

    with pytest.raises(SdkProtocolError, match="credential must be a non-empty string"):
        client.initialize(credential="", provider="test-provider", cwd="/workspace", model="test-model")


def test_initialize_cannot_bypass_credential_aware_launch_through_generic_request() -> None:
    client = HarnessClient()

    with pytest.raises(SdkProtocolError, match="use HarnessClient.initialize"):
        client.request(
            "initialize",
            {"credential": SDK_CREDENTIAL},
            response_model=InitializeResponse,
        )


def test_initialize_rejects_a_credential_in_runtime_launch_arguments() -> None:
    credential = "python-sdk-launch-argument-credential"
    client = HarnessClient(HarnessConfig(launch_args_override=(sys.executable, credential)))

    with pytest.raises(SdkProtocolError, match="must not appear in runtime launch arguments"):
        client.initialize(
            credential=credential,
            provider="test-provider",
            cwd="/workspace",
            model="test-model",
        )

    assert client._proc is None


def test_clocky_config_repr_redacts_the_credential() -> None:
    credential = "python-sdk-config-redaction-credential"

    assert credential not in repr(ClockyConfig(credential=credential, provider="test-provider", model="test-model"))
    assert credential not in repr(HarnessConfig(env={"PRODUCT_CREDENTIAL": credential}))


def test_team_channel_media_preserves_order_and_exact_envelope_selection(monkeypatch: pytest.MonkeyPatch) -> None:
    harness = Clocky(credential=SDK_CREDENTIAL, provider="test-provider", model="test-model")
    monkeypatch.setattr(harness, "start", lambda: None)
    calls: list[tuple[str, JsonObject]] = []
    content = [{"type": "text", "text": "Before"}, {"type": "image", "mediaType": "image/png", "data": "cGl4"},
               {"type": "text", "text": "After"}]

    def request(method: str, params: JsonObject | None, **_kwargs: object):
        if params is None:
            raise AssertionError("channel media requires parameters")
        calls.append((method, params))
        if method == "team/channel-input":
            return TeamChannelResponse(value={"id": "media-envelope", "payload": {"content": content}})
        return TeamChannelAttachmentResponse(attachment={"attachmentId": "image-1", "mediaType": "image/png",
            "bytes": 3, "width": 1, "height": 1}, data="cGl4")

    monkeypatch.setattr(harness.client, "request", request)
    params = {"channelId": "channel-1", "expectedCursor": 2, "audience": ["peer"], "delivery": "turn", "content": content}
    assert harness.client.input_team_channel(params).value["payload"]["content"] == content
    assert harness.client.read_team_channel_attachment("own-team", "channel-1", "media-envelope", 8, "image-1").data == "cGl4"
    team = Team(harness, "own-team", "coordinator")
    assert team.input_channel(params).value["id"] == "media-envelope"
    assert team.channel_attachment("channel-1", "media-envelope", 8, "image-1").attachment.attachmentId == "image-1"
    assert calls[0] == ("team/channel-input", params)
    assert calls[1] == ("team/channel-attachment", {"teamId": "own-team", "channelId": "channel-1", "envelopeId": "media-envelope", "envelopeSequence": 8, "attachmentId": "image-1"})
    assert calls[2] == calls[0]
    assert calls[3] == calls[1]


def test_team_read_methods_forward_bounded_page_fields(tmp_path: Path) -> None:
    script = tmp_path / "paged_runtime.py"
    requests_dump = tmp_path / "requests.json"
    script.write_text(
        """
import json
import os
import sys

requests = []
for line in sys.stdin:
    msg = json.loads(line)
    requests.append(msg)
    method = msg.get("method")
    if method == "initialize":
        result = {"serverInfo": {"name": "paged-runtime"}}
    elif method == "team/list":
        result = {"items": [], "nextCursor": 10}
    elif method == "team/member-list":
        result = {"items": [], "nextCursor": 11}
    elif method == "team/task-list":
        result = {"items": [], "nextCursor": 12}
    elif method == "team/workflow-plan-list":
        result = {"items": [], "nextCursor": 13}
    elif method == "team/artifact-list":
        result = {"items": [], "nextCursor": 14}
    elif method == "team/channel-list":
        result = {"items": [], "nextCursor": 14}
    elif method == "team/channel-admission":
        result = {"value": {"channel": {"phase": "pending"}, "invitations": [{"status": "pending"}]}}
    elif method == "team/channel-read":
        result = {"value": {"records": [], "nextCursor": 13}}
    elif method == "team/artifact-read":
        result = {
            "artifact": {"id": "artifact-1", "provider": "local", "kind": "report", "uri": "artifact://report", "visibility": "team"},
            "bytes": 4,
            "data": "dGVzdA==",
        }
    elif method == "shutdown":
        json.dump(requests, open(os.environ["REQUESTS_DUMP"], "w"))
        result = {}
    else:
        result = {}
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
    if method == "shutdown":
        break
""".strip()
    )

    with Clocky(
        credential=SDK_CREDENTIAL,
        provider="test-provider",
        model="test-model",
        launch_args_override=(sys.executable, str(script)),
        env={"REQUESTS_DUMP": str(requests_dump)},
    ) as harness:
        assert harness.list_teams(after_cursor=2, limit=3).nextCursor == 10
        assert harness.list_team_members("team-1", after_cursor=3, limit=4).nextCursor == 11
        assert harness.list_team_tasks("team-1", after_cursor=4, limit=5).nextCursor == 12
        assert harness.client.list_workflow_plans("team-1", after_cursor=5, limit=6).nextCursor == 13
        assert harness.client.list_team_artifacts("team-1", after_cursor=6, limit=7).nextCursor == 14
        assert harness.client.read_team_channel("channel-1", 5, 6).value["nextCursor"] == 13
        artifact = harness.client.read_team_artifact("team-1", "artifact-1")
        assert artifact.bytes == 4
        assert artifact.data == "dGVzdA=="
        assert harness.client.get_team_channel_admission("team-1", "channel-1").value["channel"] == {"phase": "pending"}
        team = Team(harness, "team-1", "coordinator-1")
        assert team.admission("channel-1").value["invitations"] == [{"status": "pending"}]
        assert harness.client.list_team_channels("team-1", 3, 2).nextCursor == 14
        assert team.channels(4, 1).nextCursor == 14

    requests = json.loads(requests_dump.read_text())
    assert requests[1]["params"] == {"afterCursor": 2, "limit": 3}
    assert requests[2]["params"] == {"teamId": "team-1", "afterCursor": 3, "limit": 4}
    assert requests[3]["params"] == {"teamId": "team-1", "afterCursor": 4, "limit": 5}
    assert requests[4]["params"] == {"teamId": "team-1", "afterCursor": 5, "limit": 6}
    assert requests[5]["method"] == "team/artifact-list"
    assert requests[5]["params"] == {"teamId": "team-1", "afterCursor": 6, "limit": 7}
    assert requests[6]["params"] == {"channelId": "channel-1", "afterCursor": 5, "limit": 6}
    assert requests[7]["method"] == "team/artifact-read"
    assert requests[7]["params"] == {"teamId": "team-1", "artifactId": "artifact-1"}
    assert requests[8]["method"] == "team/channel-admission"
    assert requests[8]["params"] == {"teamId": "team-1", "channelId": "channel-1"}
    assert requests[9]["params"] == requests[8]["params"]
    assert requests[10]["method"] == "team/channel-list"
    assert requests[10]["params"] == {"teamId": "team-1", "afterCursor": 3, "limit": 2}
    assert requests[11]["params"] == {"teamId": "team-1", "afterCursor": 4, "limit": 1}


def test_create_team_exposes_handle_and_cancel_uses_team_wire(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    requests_dump = tmp_path / "requests.json"
    script.write_text(
        """
import json
import os
import sys

requests = []
for line in sys.stdin:
    msg = json.loads(line)
    requests.append(msg)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "team/create":
        print(json.dumps({
            "jsonrpc": "2.0",
            "id": msg["id"],
            "result": {
                "teamId": "team-image",
                "coordinatorSessionId": "coordinator-image",
                "envelopeId": "input-image",
            },
        }), flush=True)
    elif msg.get("method") == "team/cancel":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"phase": "cancelled"}}), flush=True)
    elif msg.get("method") == "shutdown":
        json.dump(requests, open(os.environ["REQUESTS_DUMP"], "w"))
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with Clocky(
        credential=SDK_CREDENTIAL,
        provider="test-provider",
        model="test-model",
        cwd=str(tmp_path),
        launch_args_override=(sys.executable, str(script)),
        env={"REQUESTS_DUMP": str(requests_dump)},
    ) as harness:
        team = harness.create_team(
            [{"type": "image", "attachment": {"id": "attachment-1"}}],
            objective="Inspect the image",
        )
        assert isinstance(team, Team)
        assert team.id == "team-image"
        assert team.coordinator_session_id == "coordinator-image"
        team.cancel()

    requests = json.loads(requests_dump.read_text())
    assert requests[1]["params"] == {
        "objective": "Inspect the image",
        "contentBlocks": [{"type": "image", "attachment": {"id": "attachment-1"}}],
    }
    assert requests[2] == {
        "jsonrpc": "2.0",
        "id": requests[2]["id"],
        "method": "team/cancel",
        "params": {"teamId": "team-image"},
    }


def test_team_handle_waits_for_explicit_final(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "team/create":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "teamId": "team-2", "coordinatorSessionId": "coordinator-2", "envelopeId": "input-2",
        }}), flush=True)
    elif msg.get("method") == "team/wait-final":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "teamId": "team-2", "channelId": "direct", "envelopeId": "final-2", "text": "settled",
        }}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with Clocky(
        credential=SDK_CREDENTIAL,
        provider="test-provider",
        model="test-model",
        cwd=str(tmp_path),
        launch_args_override=(sys.executable, str(script)),
    ) as harness:
        final = harness.create_team("work").wait_for_final()

    assert final.team_id == "team-2"
    assert final.text == "settled"


def test_run_rejects_malformed_coordinator_event(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "team/create":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "teamId": "team-3", "coordinatorSessionId": "coordinator-3", "envelopeId": "input-3",
        }}), flush=True)
    elif msg.get("method") == "team/wait-final":
        print(json.dumps({
            "jsonrpc": "2.0",
            "method": "session.event",
            "params": {
                "sessionId": "coordinator-3",
                "event": {"type": "assistant/message", "data": {"message": {"content": "not blocks"}}},
            },
        }), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with Clocky(
        credential=SDK_CREDENTIAL,
        provider="test-provider",
        model="test-model",
        cwd=str(tmp_path),
        launch_args_override=(sys.executable, str(script)),
    ) as harness:
        with pytest.raises(SdkProtocolError, match="assistant/message event carried malformed content"):
            harness.run("reject malformed transcript")


def test_create_team_requires_an_objective_for_image_only_input() -> None:
    from clocky.api import resolve_objective

    with pytest.raises(TypeError, match="objective is required"):
        resolve_objective(
            [{"type": "image", "attachment": {"id": "image-1"}}],
            [{"type": "image", "attachment": {"id": "image-1"}}],
            None,
        )
    assert resolve_objective(
        [{"type": "text", "text": "unused"}],
        [{"type": "text", "text": "first"}, {"type": "text", "text": "second"}],
        None,
    ) == "first\nsecond"


def test_low_level_team_methods_validate_wire_receipts(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "team/create":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "teamId": "team-4", "coordinatorSessionId": "coordinator-4", "envelopeId": "input-4",
        }}), flush=True)
    elif msg.get("method") == "team/wait-final":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "teamId": "team-4", "channelId": "direct", "envelopeId": "final-4", "text": "done",
        }}), flush=True)
    elif msg.get("method") == "team/cancel":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"phase": "cancelled"}}), flush=True)
    elif msg.get("method") == "team/get":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "state": {"team": {"cursor": 3}},
        }}), flush=True)
    elif msg.get("method") == "team/archive":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "teamId": "team-4", "archivedAt": 7,
        }}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script)))) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        created = client.create_team("Finish the task", [{"type": "text", "text": "Finish the task"}])
        final = client.wait_for_team_final(created.teamId)
        client.cancel_team(created.teamId)
        archived = client.archive_team(created.teamId)

    assert created.teamId == "team-4"
    assert created.coordinatorSessionId == "coordinator-4"
    assert final.text == "done"
    assert archived.teamId == "team-4"
    assert archived.archivedAt == 7


def test_client_rejects_malformed_team_receipt(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "team/create":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script)))) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        with pytest.raises(SdkProtocolError, match="team/create response violates the SDK protocol"):
            client.create_team("Fix it", [{"type": "text", "text": "Fix it"}])


def test_generic_subscription_keeps_unmatched_notifications_available_globally() -> None:
    client = HarnessClient()
    with client.subscribe_notifications(lambda notification: notification.method == "tick") as subscription:
        client._handle_message({
            "jsonrpc": "2.0",
            "method": "other",
            "params": {"source": "other"},
        })
        client._handle_message({
            "jsonrpc": "2.0",
            "method": "tick",
            "params": {"source": "tick"},
        })
        assert subscription.try_next().payload == {"source": "tick"}
        assert subscription.try_next() is None

    notification = client.next_notification()
    assert notification.method == "other"
    assert notification.payload == {"source": "other"}


def test_notification_subscription_close_wakes_waiters_and_drops_queued_items() -> None:
    class SignallingQueue(queue.Queue[Notification | BaseException]):
        def __init__(self) -> None:
            super().__init__()
            self.entered = threading.Event()

        def get(self, *args: object, **kwargs: object) -> Notification | BaseException:
            self.entered.set()
            return super().get(*args, **kwargs)

    client = HarnessClient()
    waiting_queue = SignallingQueue()
    waiting = NotificationSubscription(client, "waiting", waiting_queue)
    failures: queue.Queue[BaseException] = queue.Queue()

    def consume() -> None:
        try:
            waiting.next()
        except BaseException as exc:
            failures.put(exc)

    thread = threading.Thread(target=consume)
    thread.start()
    assert waiting_queue.entered.wait(timeout=1)
    waiting.close()
    thread.join(timeout=1)
    assert not thread.is_alive()
    failure = failures.get_nowait()
    assert isinstance(failure, TransportClosedError)
    assert str(failure) == "notification subscription closed"

    queued: queue.Queue[Notification | BaseException] = queue.Queue()
    queued.put(Notification(method="queued", payload={}))
    closed = NotificationSubscription(client, "queued", queued)
    closed.close()
    assert closed.try_next() is None
    with pytest.raises(TransportClosedError, match="notification subscription closed"):
        closed.next()


def test_client_contains_notification_filter_failure_to_its_subscription(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") in {"emit-first", "emit-second"}:
        print(json.dumps({"jsonrpc": "2.0", "method": "tick", "params": {"source": msg["method"]}}), flush=True)
    elif msg.get("method") == "team/create":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {
            "teamId": "team-5", "coordinatorSessionId": "coordinator-5", "envelopeId": "input-5",
        }}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    def broken_filter(_notification: Notification) -> bool:
        raise RuntimeError("bad notification filter")

    with HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script)))) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        with (
            client.subscribe_notifications(broken_filter) as broken,
            client.subscribe_notifications(lambda notification: notification.method == "tick") as healthy,
        ):
            client.notify("emit-first")
            with pytest.raises(RuntimeError, match="bad notification filter"):
                broken.next()
            assert healthy.next().payload == {"source": "emit-first"}
            assert client._notifications.qsize() == 0

            client.create_team("Keep reading", [{"type": "text", "text": "Keep reading"}])
            client.notify("emit-second")
            assert healthy.next().payload == {"source": "emit-second"}


def test_client_routes_runtime_requests_and_sends_responses(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
        print(json.dumps({
            "jsonrpc": "2.0",
            "id": "runtime-request-1",
            "method": "llm.request",
            "params": {"requestId": "request-1", "sessionId": "coordinator", "model": "test-model", "messages": []},
        }), flush=True)
    elif "id" in msg and "method" not in msg:
        print(json.dumps({"jsonrpc": "2.0", "method": "response/seen", "params": {"result": msg.get("result")}}), flush=True)
    elif method == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script)))) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        request = client.next_request()
        assert request.id == "runtime-request-1"
        assert request.method == "llm.request"
        client.respond(request.id, {"content_blocks": [{"type": "text", "text": "done"}]})
        notification = client.next_notification()

    assert notification.method == "response/seen"
    assert notification.payload["result"]["content_blocks"][0]["text"] == "done"


def test_relative_cwd_is_absolute_in_process_environment_and_wire(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script = tmp_path / "capture_cwd.py"
    capture = tmp_path / "cwd.json"
    script.write_text(
        """
import json
import os
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        json.dump({"process": os.getcwd(), "environment": os.environ.get("CLOCKY_CWD"), "wire": msg["params"]["cwd"]}, open(os.environ["CAPTURE"], "w"))
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )
    monkeypatch.chdir(tmp_path)

    with Clocky(
        credential=SDK_CREDENTIAL,
        provider="test-provider",
        model="test-model",
        cwd=".",
        runtime_cwd=".",
        launch_args_override=(sys.executable, str(script)),
        env={"CAPTURE": str(capture)},
    ):
        pass

    expected = str(tmp_path.resolve())
    assert json.loads(capture.read_text()) == {
        "process": expected,
        "environment": expected,
        "wire": expected,
    }


def test_client_ignores_non_json_stdout_lines(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

print("runtime startup notice", flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    with HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script)))) as client:
        initialized = client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")

    assert initialized.serverInfo.name == "fake-runtime"


def test_client_request_times_out_when_runtime_does_not_respond(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import sys
import time

print("runtime is still starting", file=sys.stderr, flush=True)
time.sleep(60)
""".strip()
    )

    with HarnessClient(
        HarnessConfig(
            launch_args_override=(sys.executable, str(script)),
            request_timeout_seconds=0.1,
        )
    ) as client:
        start = time.monotonic()
        with pytest.raises(TimeoutError, match="runtime is still starting"):
            client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        assert time.monotonic() - start < 2


def test_client_close_reaps_runtime_when_shutdown_does_not_respond(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import signal
import sys
import time

signal.signal(signal.SIGTERM, signal.SIG_IGN)
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        time.sleep(60)
""".strip()
    )

    client = HarnessClient(
        HarnessConfig(
            launch_args_override=(sys.executable, str(script)),
            shutdown_timeout_seconds=0.1,
        )
    )
    client.start()
    client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
    proc = client._proc
    assert proc is not None
    start = time.monotonic()
    client.close()
    assert time.monotonic() - start < 2
    assert proc.poll() is not None
    assert client._proc is None


def test_initialize_failure_reaps_started_runtime(tmp_path: Path) -> None:
    script = tmp_path / "rejecting_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32000, "message": "bad initialize"}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    client = HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script))))
    client.start()

    with pytest.raises(Exception, match="bad initialize"):
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd=".", model="test-model")

    assert client._proc is None


def test_public_api_has_no_direct_session_product_methods() -> None:
    assert not hasattr(Clocky, "start_session")
    assert not hasattr(HarnessClient, "session_prompt")
    assert not hasattr(HarnessClient, "subscribe_session_notifications")
    assert "session_id" not in inspect.signature(Clocky.run).parameters
    assert "objective" in inspect.signature(Clocky.create_team).parameters
    assert "objective" in inspect.signature(Clocky.run).parameters
    assert "credential" in ClockyConfig.__dataclass_fields__
    assert "credential" in inspect.signature(HarnessClient.initialize).parameters
    assert "max_tokens" in ClockyConfig.__dataclass_fields__
    assert "max_tokens" in inspect.signature(HarnessClient.initialize).parameters
    assert "credential" not in HarnessConfig.__dataclass_fields__
    assert "client_name" not in HarnessConfig.__dataclass_fields__
    assert "client_version" not in HarnessConfig.__dataclass_fields__
    assert issubclass(JsonRpcError, HarnessError)
    assert issubclass(TransportClosedError, HarnessError)
    assert NotificationSubscription.__name__ == "NotificationSubscription"


def test_client_close_is_idempotent_before_and_after_start(tmp_path: Path) -> None:
    HarnessClient().close()

    script = tmp_path / "fake_runtime.py"
    script.write_text(
        """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )

    client = HarnessClient(HarnessConfig(launch_args_override=(sys.executable, str(script))))
    client.start()
    client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
    client.close()
    client.close()


def test_runtime_closed_error_includes_stderr_tail(tmp_path: Path) -> None:
    script = tmp_path / "crashing_runtime.py"
    script.write_text(
        """
import sys

print("fatal runtime exploded", file=sys.stderr, flush=True)
sys.exit(42)
""".strip()
    )

    with HarnessClient(
        HarnessConfig(
            launch_args_override=(sys.executable, str(script)),
            request_timeout_seconds=2,
        )
    ) as client:
        with pytest.raises(Exception, match="fatal runtime exploded"):
            client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")


def test_client_serializes_concurrent_writes(tmp_path: Path) -> None:
    script = tmp_path / "fake_runtime.py"
    output = tmp_path / "seen.jsonl"
    script.write_text(
        """
import json
import os
import sys

with open(os.environ["SEEN"], "w") as seen:
    for line in sys.stdin:
        seen.write(line)
        seen.flush()
        msg = json.loads(line)
        if "id" in msg and msg.get("method") == "initialize":
            print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "fake-runtime"}}}), flush=True)
        elif "id" in msg and msg.get("method") == "shutdown":
            print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
            break
""".strip()
    )

    with HarnessClient(
        HarnessConfig(
            launch_args_override=(sys.executable, str(script)),
            env={"SEEN": str(output)},
        )
    ) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")
        threads = [
            threading.Thread(target=client.notify, args=(f"notice-{index}", {"index": index}))
            for index in range(50)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    for line in output.read_text().splitlines():
        json.loads(line)


def _install_fake_bundled_runtime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    runtime = tmp_path / "clocky-jsonrpc-agent"
    runtime.write_text(
        """#!/usr/bin/env python3
import json
import os
import sys

for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("method") == "initialize":
        credential = msg["params"]["credential"]
        json.dump({
            "CLOCKY_CORDIS_CONFIG": os.environ.get("CLOCKY_CORDIS_CONFIG"),
            "CLOCKY_PRODUCT_CREDENTIAL_SHA256": os.environ.get("CLOCKY_PRODUCT_CREDENTIAL_SHA256"),
            "PLAIN_CREDENTIAL_CARRIER": os.environ.get("PLAIN_CREDENTIAL_CARRIER"),
            "credential_in_environment": any(
                credential == value
                for key, value in os.environ.items()
                if key != "CLOCKY_PRODUCT_CREDENTIAL_SHA256"
            ),
        }, open(os.environ["ENV_DUMP"], "w"))
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {"serverInfo": {"name": "bundled-runtime"}}}), flush=True)
    elif msg.get("method") == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": {}}), flush=True)
        break
""".strip()
    )
    runtime.chmod(0o755)

    default_config = tmp_path / "default-cordis.yml"
    module_dir = tmp_path / "clocky_runtime"
    module_dir.mkdir()
    (module_dir / "__init__.py").write_text(
        f"""
def resolve_bundled_launch_args(mode=None):
    return ({str(runtime)!r},)


def bundled_default_config_path():
    return {str(default_config)!r}
""".strip()
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.delitem(sys.modules, "clocky_runtime", raising=False)
    return default_config


@pytest.mark.parametrize("ambient_config", [None, ""], ids=["unset", "empty-counts-as-absent"])
def test_client_default_launch_uses_bundled_runtime_and_injects_default_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, ambient_config: str | None
) -> None:
    env_dump = tmp_path / "env.json"
    default_config = _install_fake_bundled_runtime(tmp_path, monkeypatch)
    if ambient_config is None:
        monkeypatch.delenv("CLOCKY_CORDIS_CONFIG", raising=False)
    else:
        monkeypatch.setenv("CLOCKY_CORDIS_CONFIG", ambient_config)

    with HarnessClient(HarnessConfig(env={"ENV_DUMP": str(env_dump)})) as client:
        init = client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")

    assert init.serverInfo.name == "bundled-runtime"
    environment = json.loads(env_dump.read_text())
    assert environment["CLOCKY_CORDIS_CONFIG"] == str(default_config)
    assert environment["CLOCKY_PRODUCT_CREDENTIAL_SHA256"] == hashlib.sha256(SDK_CREDENTIAL.encode()).hexdigest()
    assert environment["credential_in_environment"] is False


def test_client_respects_explicit_config_over_bundled_default(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_dump = tmp_path / "env.json"
    _install_fake_bundled_runtime(tmp_path, monkeypatch)
    monkeypatch.delenv("CLOCKY_CORDIS_CONFIG", raising=False)

    with HarnessClient(
        HarnessConfig(env={"ENV_DUMP": str(env_dump), "CLOCKY_CORDIS_CONFIG": "./explicit.yml"})
    ) as client:
        client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")

    environment = json.loads(env_dump.read_text())
    assert environment["CLOCKY_CORDIS_CONFIG"] == "./explicit.yml"
    assert environment["CLOCKY_PRODUCT_CREDENTIAL_SHA256"] is None


def test_client_preserves_a_matching_external_config_digest_without_the_plaintext(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_dump = tmp_path / "env.json"
    _install_fake_bundled_runtime(tmp_path, monkeypatch)
    monkeypatch.delenv("CLOCKY_CORDIS_CONFIG", raising=False)
    runtime_path = str(tmp_path / "clocky-jsonrpc-agent")
    credential = next(
        candidate
        for candidate in (f"{left}{right}" for left in "0123456789abcdef" for right in "0123456789abcdef")
        if candidate not in runtime_path and candidate in hashlib.sha256(candidate.encode()).hexdigest()
    )
    digest = hashlib.sha256(credential.encode()).hexdigest()
    assert credential in digest

    with HarnessClient(
        HarnessConfig(
            env={
                "ENV_DUMP": str(env_dump),
                "CLOCKY_CORDIS_CONFIG": "./explicit.yml",
                "CLOCKY_PRODUCT_CREDENTIAL_SHA256": digest,
                "PLAIN_CREDENTIAL_CARRIER": f"prefix-{credential}-suffix",
            }
        )
    ) as client:
        client.initialize(credential=credential, provider="test-provider", cwd="/workspace", model="test-model")

    environment = json.loads(env_dump.read_text())
    assert environment["CLOCKY_CORDIS_CONFIG"] == "./explicit.yml"
    assert environment["CLOCKY_PRODUCT_CREDENTIAL_SHA256"] == digest
    assert environment["PLAIN_CREDENTIAL_CARRIER"] == "prefix-[REDACTED]-suffix"
    assert environment["credential_in_environment"] is False


def test_client_rejects_a_mismatching_bundled_runtime_credential_digest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_fake_bundled_runtime(tmp_path, monkeypatch)
    monkeypatch.delenv("CLOCKY_CORDIS_CONFIG", raising=False)

    with HarnessClient(
        HarnessConfig(
            env={
                "ENV_DUMP": str(tmp_path / "env.json"),
                "CLOCKY_PRODUCT_CREDENTIAL_SHA256": "0" * 64,
            }
        )
    ) as client:
        with pytest.raises(SdkProtocolError, match="CLOCKY_PRODUCT_CREDENTIAL_SHA256"):
            client.initialize(credential=SDK_CREDENTIAL, provider="test-provider", cwd="/workspace", model="test-model")


def test_client_reports_missing_bundled_runtime_dependency(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delitem(sys.modules, "clocky_runtime", raising=False)
    monkeypatch.setattr(sys, "path", [])

    with pytest.raises(FileNotFoundError, match="Install clocky-runtime-bin"):
        HarnessClient().initialize(
            credential=SDK_CREDENTIAL,
            provider="test-provider",
            cwd="/workspace",
            model="test-model",
        )


def test_task_cancellation_preserves_pending_owner_facts(tmp_path: Path) -> None:
    script = tmp_path / "task_cancel_runtime.py"
    requests_dump = tmp_path / "requests.json"
    script.write_text("""
import json, os, sys
requests = []
for line in sys.stdin:
    msg = json.loads(line)
    requests.append(msg)
    if msg["method"] == "initialize":
        result = {"serverInfo": {"name": "task-cancellation-runtime"}}
    elif msg["method"] == "team/task-cancel":
        result = {"value": {"id": "task-1", "phase": "running", "lease": {"attemptId": "attempt-1"},
            "cancellation": {"requestedRevision": 3, "requestedBy": "human-1", "requestedAt": 10,
                "reason": msg["params"]["reason"], "target": {"kind": "attempt", "attemptId": "attempt-1",
                    "participantId": "worker-1", "activationId": "epoch-1"}}}}
    else:
        result = {}
    if msg["method"] == "shutdown":
        with open(os.environ["REQUESTS_DUMP"], "w") as output:
            json.dump(requests, output)
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
    if msg["method"] == "shutdown":
        break
""".strip())
    with Clocky(credential=SDK_CREDENTIAL, provider="test-provider", model="test-model",
                launch_args_override=(sys.executable, str(script)), env={"REQUESTS_DUMP": str(requests_dump)}) as harness:
        response = harness.client.cancel_team_task({"teamId": "team-1", "taskId": "task-1", "expectedRevision": 3, "reason": "Only this task."})
        assert response.value["phase"] == "running"
        assert response.value["lease"] == {"attemptId": "attempt-1"}
        cancellation = response.value["cancellation"]
        assert isinstance(cancellation, dict)
        target = cancellation["target"]
        assert isinstance(target, dict)
        assert target["activationId"] == "epoch-1"
        assert cancellation["reason"] == "Only this task."
    requests = json.loads(requests_dump.read_text())
    assert requests[1]["method"] == "team/task-cancel"
    assert requests[1]["params"] == {"teamId": "team-1", "taskId": "task-1", "expectedRevision": 3, "reason": "Only this task."}


def test_channel_catalog_and_explicit_summary_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    from clocky import TeamChannelCatalogResponse

    harness = Clocky(credential=SDK_CREDENTIAL, provider="test-provider", model="test-model")
    monkeypatch.setattr(harness, "start", lambda: None)
    calls: list[tuple[str, JsonObject]] = []

    def request(method: str, params: JsonObject | None, **_kwargs: object):
        if params is None:
            raise AssertionError("Explicit channel commands require parameters")
        calls.append((method, params))
        if method == "team/channel-catalog":
            return TeamChannelCatalogResponse(adapters=[{"type": "consult", "version": 1}], viewPolicies=[])
        return TeamChannelResponse(value={"text": "Saved.", "coveredSequenceRange": params["coveredSequenceRange"]})

    monkeypatch.setattr(harness.client, "request", request)
    team = Team(harness, "team-1", "coordinator-1")
    assert team.channel_catalog().adapters == [{"type": "consult", "version": 1}]
    selection = {"channelId": "channel-1", "expectedCursor": 9, "coveredSequenceRange": {"from": 3, "to": 5}, "idempotencyKey": "range-1"}
    assert team.summarize_channel(selection).value["coveredSequenceRange"] == {"from": 3, "to": 5}
    assert calls == [("team/channel-catalog", {}), ("team/channel-summarize", selection)]
