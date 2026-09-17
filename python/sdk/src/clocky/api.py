from __future__ import annotations

from .models import TeamHumanActionResponseRequest

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, cast

from .client import HarnessClient, HarnessConfig
from .errors import SdkProtocolError
from .models import (
    JsonObject,
    Notification,
    TeamFinalReceipt,
    TeamGetResponse,
    TeamSelectionResponse,
    TeamMemberInspectResponse,
    TeamTaskInspectResponse,
    TeamBrowseResponse,
    TeamMemberSessionResponse,
    TeamGoalTransitionInput,
    TeamGoalTransitionRequest,
    TeamGoalTransitionResponse,
    TeamGoalUpdateInput,
    TeamGoalUpdateRequest,
    TeamGoalUpdateResponse,
    TeamResumeRequest,
    TeamWaitFinalResponse,
)

MAX_SAFE_INTEGER = 9_007_199_254_740_991


@dataclass(slots=True)
class ClockyConfig:
    """Configuration for launching the local Clocky SDK runtime.

    The runtime inherits the caller's environment by default. Use ``env`` to
    override or inject the variables named by the selected Cordis composition.
    ``credential`` is sent only in the initialization handshake.
    """

    credential: str = field(repr=False)
    provider: str
    model: str
    max_tokens: int | None = None
    cwd: str | None = None
    runtime_cwd: str | None = None
    session_root: str | None = None
    cordis: str | None = None
    env: dict[str, str] = field(default_factory=dict, repr=False)
    runtime_bin: str | None = None
    launch_args_override: tuple[str, ...] | None = None
    request_timeout_seconds: float | None = None
    shutdown_timeout_seconds: float | None = 1.0


@dataclass(slots=True)
class RunResult:
    """One completed product Team and its coordinator transcript projection."""

    team_id: str
    final_response: str
    final: TeamFinalReceipt
    events: list[JsonObject]
    notifications: list[Notification]


class Clocky:
    """Reusable synchronous SDK for running Clocky Teams.

    The runtime subprocess starts lazily and remains owned by this instance
    across calls to :meth:`run`. Use the instance as a context manager, or call
    :meth:`close` explicitly when finished, so the subprocess is always reaped.
    """

    def __init__(self, config: ClockyConfig | None = None, **kwargs: object) -> None:
        if config is not None and kwargs:
            raise TypeError("pass either ClockyConfig or keyword options, not both")
        self.config = config or ClockyConfig(**kwargs)
        cwd = str(Path(self.config.cwd or Path.cwd()).resolve())
        runtime_cwd = str(Path(self.config.runtime_cwd).resolve()) if self.config.runtime_cwd is not None else cwd
        self._cwd = cwd
        env = dict(self.config.env)
        if self.config.session_root is not None:
            env["CLOCKY_SESSION_ROOT"] = self.config.session_root
        if self.config.cordis is not None:
            env["CLOCKY_CORDIS_CONFIG"] = self.config.cordis
        env["CLOCKY_CWD"] = cwd

        self._client = HarnessClient(
            HarnessConfig(
                runtime_bin=self.config.runtime_bin,
                launch_args_override=self.config.launch_args_override,
                cwd=runtime_cwd,
                env=env,
                request_timeout_seconds=self.config.request_timeout_seconds,
                shutdown_timeout_seconds=self.config.shutdown_timeout_seconds,
            )
        )
        self._initialized = False

    def __enter__(self) -> "Clocky":
        self.start()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.close()

    @property
    def client(self) -> HarnessClient:
        """Underlying JSON-RPC client; calling it does not confer Team authority."""
        return self._client

    def start(self) -> None:
        """Start and initialize the Team-capable runtime once."""
        if self._initialized:
            return
        self._client.initialize(
            credential=self.config.credential,
            cwd=self._cwd,
            provider=self.config.provider,
            model=self.config.model,
            max_tokens=self.config.max_tokens,
        )
        self._initialized = True

    def close(self) -> None:
        """Shut down and reap the owned runtime subprocess."""
        self._client.close()
        self._initialized = False

    def create_team(
        self,
        input: str | list[JsonObject],
        *,
        objective: str | None = None,
    ) -> "Team":
        """Create one Team and admit its initial input through this runtime's creation path."""
        self.start()
        content_blocks = normalize_input(input)
        created = self._client.create_team(
            resolve_objective(input, content_blocks, objective),
            content_blocks,
        )
        return Team(self, created.teamId, created.coordinatorSessionId)

    def resume_team(self, team_id: str, *, expected_cursor: int | None = None) -> "Team":
        """Resume one Team through the initialized connection's authenticated human route."""
        self.start()
        cursor = expected_cursor if expected_cursor is not None else team_cursor(self._client.get_team(team_id))
        resumed = self._client.resume_team(TeamResumeRequest(teamId=team_id, expectedCursor=cursor))
        return Team(self, resumed.teamId, resumed.coordinatorSessionId)

    def list_teams(self, *, after_cursor: str | Literal[-1] | None = None, limit: int | None = None):
        """Read one bounded page of durable Teams visible to the runtime."""
        self.start()
        return self._client.list_teams(after_cursor, limit)

    def get_team_member_session(self, team_id: str, participant_id: str) -> TeamMemberSessionResponse:
        """Resolve a member's published Session without activating it."""
        self.start()
        return self._client.get_team_member_session(team_id, participant_id)

    def inspect_team_task(self, team_id: str, task_id: str, section: Literal["record", "attempts", "reviews"], *,
                          expected_revision: int | None = None, after_cursor: int | None = None,
                          limit: int | None = None) -> TeamTaskInspectResponse:
        """Read one task section without loading the rest of its execution history."""
        self.start()
        return self._client.inspect_team_task(team_id, task_id, section, expected_revision=expected_revision,
                                              after_cursor=after_cursor, limit=limit)

    def browse_team(self, team_id: str, kind: Literal["tasks", "members", "workflowPlans"], *,
                    after_cursor: int | None = None, limit: int | None = None) -> TeamBrowseResponse:
        """Read one bounded summary window for the selected Team collection."""
        self.start()
        return self._client.browse_team(team_id, kind, after_cursor=after_cursor, limit=limit)

    def inspect_workflow_plan(self, team_id: str, plan_id: str, *, expected_revision: int | None = None,
                              after_cursor: int = -1, limit: int | None = None):
        """Read a bounded workflow task/dependency window."""
        self.start()
        return self._client.inspect_workflow_plan(team_id, plan_id, expected_revision=expected_revision,
                                                  after_cursor=after_cursor, limit=limit)

    def read_team_action(self, team_id: str, action_id: str):
        """Read the current durable action without the complete Team history."""
        self.start()
        return self._client.read_team_action(team_id, action_id)

    def inspect_team_member(self, team_id: str, participant_id: str, *, after_cursor: int | None = None,
                            limit: int | None = None, expected_team_cursor: int | None = None) -> TeamMemberInspectResponse:
        """Read one bounded member detail page without activation."""
        self.start()
        return self._client.inspect_team_member(team_id, participant_id, after_cursor=after_cursor,
                                               limit=limit, expected_team_cursor=expected_team_cursor)

    def get_team_selection(self, team_id: str, *, include_metadata: bool = False) -> TeamSelectionResponse:
        """Read bounded selection data without activating an Agent."""
        self.start()
        return self._client.get_team_selection(team_id, include_metadata=include_metadata)

    def get_team(self, team_id: str):
        """Read one complete durable Team projection."""
        self.start()
        return self._client.get_team(team_id)

    def list_team_members(self, team_id: str, *, after_cursor: int | None = None, limit: int | None = None):
        """Read one bounded page of durable participant projections for a Team."""
        self.start()
        return self._client.list_team_members(team_id, after_cursor, limit)

    def list_team_tasks(self, team_id: str, *, after_cursor: int | None = None, limit: int | None = None):
        """Read one bounded page of durable task projections for a Team."""
        self.start()
        return self._client.list_team_tasks(team_id, after_cursor, limit)

    def team_quiescence(self, team_id: str):
        """Read durable quiescence diagnostics for one Team."""
        self.start()
        return self._client.team_quiescence(team_id)

    def inbox_respond(self, request: TeamHumanActionResponseRequest):
        """Answer an exact inbox action through its live continuation or explicit failure recovery."""
        self.start()
        return self._client.inbox_respond(request)

    def inbox_read(self, *, after_cursor: int | None = None, limit: int | None = None):
        """Read the authenticated principal's bounded durable inbox."""
        self.start()
        return self._client.inbox_read(after_cursor, limit)

    def inbox_watch(self, *, after_cursor: int | None = None, limit: int | None = None):
        """Watch the authenticated principal's bounded durable inbox."""
        self.start()
        return self._client.inbox_watch(after_cursor, limit)

    def inbox_acknowledge(self, through_cursor: int):
        """Persist the principal-wide display cursor independently of delivery receipts."""
        self.start()
        return self._client.inbox_acknowledge(through_cursor)

    def team_metrics(self):
        """Read process-local Team operational counters."""
        self.start()
        return self._client.team_metrics()

    def team_audit(
        self,
        team_id: str,
        *,
        channel_id: str | None = None,
        after_cursor: int | None = None,
        limit: int | None = None,
    ):
        """Read a bounded Team-journal or channel-WAL audit page."""
        self.start()
        return self._client.team_audit_read(
            team_id,
            channel_id=channel_id,
            after_cursor=after_cursor,
            limit=limit,
        )

    def run(
        self,
        input: str | list[JsonObject],
        *,
        objective: str | None = None,
        on_notification: Callable[[Notification], None] | None = None,
    ) -> RunResult:
        """Create one Team, stream its coordinator transcript, and await its final."""
        self.start()
        content_blocks = normalize_input(input)
        notifications: list[Notification] = []
        events: list[JsonObject] = []
        with self._client.subscribe_notifications() as subscription:
            created = self._client.create_team(
                resolve_objective(input, content_blocks, objective),
                content_blocks,
            )
            team = Team(self, created.teamId, created.coordinatorSessionId)
            def collect(notification: Notification) -> None:
                if not belongs_to_coordinator(notification, team.coordinator_session_id):
                    return
                notifications.append(notification)
                if on_notification is not None:
                    on_notification(notification)
                if (
                    notification.method == "session.event"
                    and notification.payload.get("sessionId") == team.coordinator_session_id
                ):
                    events.append(validated_coordinator_event(notification))

            subscription.drain(collect)
            final = team_final_receipt(
                self._client.wait_for_team_final(
                    team.id,
                    on_notification=collect,
                    notification_subscription=subscription,
                )
            )
            subscription.drain(collect)
        return RunResult(
            team_id=team.id,
            final_response=final.text,
            final=final,
            events=events,
            notifications=notifications,
        )


class Team:
    """Handle for an SDK-tracked TeamRun and authenticated Team management operations."""

    def __init__(self, harness: Clocky, team_id: str, coordinator_session_id: str) -> None:
        self.harness = harness
        self.id = team_id
        self.coordinator_session_id = coordinator_session_id

    def wait_for_final(self) -> TeamFinalReceipt:
        """Await this SDK-tracked runtime-owned TeamRun's final; untracked Team ids reject."""
        self.harness.start()
        return team_final_receipt(self.harness.client.wait_for_team_final(self.id))

    def resume(self, *, expected_cursor: int | None = None) -> None:
        """Resume this Team through the initialized connection's authenticated human route."""
        self.harness.start()
        cursor = expected_cursor if expected_cursor is not None else team_cursor(self.harness.client.get_team(self.id))
        response = self.harness.client.resume_team(TeamResumeRequest(teamId=self.id, expectedCursor=cursor))
        if response.teamId != self.id:
            raise SdkProtocolError(f"team/resume returned another Team {response.teamId!r}")

    def state(self):
        """Read the latest durable Team state."""
        self.harness.start()
        return self.harness.client.get_team(self.id)

    def update_goal(self, input: TeamGoalUpdateInput) -> TeamGoalUpdateResponse:
        """Update this Team objective through the initialized connection's authenticated human route."""
        self.harness.start()
        return self.harness.client.update_team_goal(
            TeamGoalUpdateRequest(teamId=self.id, **input.model_dump(exclude_none=True))
        )

    def transition_goal(self, input: TeamGoalTransitionInput) -> TeamGoalTransitionResponse:
        """Transition this Team objective through the initialized connection's authenticated human route."""
        self.harness.start()
        return self.harness.client.transition_team_goal(
            TeamGoalTransitionRequest(teamId=self.id, **input.model_dump(exclude_none=True))
        )

    def members(self, *, after_cursor: int | None = None, limit: int | None = None):
        """Read one bounded page of this Team's durable participant roster."""
        self.harness.start()
        return self.harness.client.list_team_members(self.id, after_cursor, limit)

    def quiescence(self):
        """Read durable quiescence diagnostics for this Team."""
        self.harness.start()
        return self.harness.client.team_quiescence(self.id)

    def metrics(self):
        """Read process-local Team operational counters for this runtime."""
        self.harness.start()
        return self.harness.client.team_metrics()

    def audit(self, *, channel_id: str | None = None, after_cursor: int | None = None, limit: int | None = None):
        """Read a bounded Team-journal or channel-WAL audit page."""
        self.harness.start()
        return self.harness.client.team_audit_read(
            self.id,
            channel_id=channel_id,
            after_cursor=after_cursor,
            limit=limit,
        )

    def read_artifact(self, artifact_id: str):
        """Read one visible Team artifact by its durable reference id."""
        self.harness.start()
        return self.harness.client.read_team_artifact(self.id, artifact_id)

    def invite_member(self, payload: JsonObject):
        """Invite one non-human Team participant through the authenticated human route."""
        self.harness.start()
        return self.harness.client.invite_team_member({**payload, "teamId": self.id})

    def activate_member(self, payload: JsonObject):
        """Activate one invited Team participant through the authenticated human route."""
        self.harness.start()
        return self.harness.client.activate_team_member({**payload, "teamId": self.id})

    def remove_member(self, payload: JsonObject):
        """Remove one active Team participant through the authenticated human route."""
        self.harness.start()
        return self.harness.client.remove_team_member({**payload, "teamId": self.id})

    def interrupt_member(self, payload: JsonObject):
        """Request a soft participant interrupt through the authenticated human route."""
        self.harness.start()
        return self.harness.client.interrupt_team_member({**payload, "teamId": self.id})

    def tasks(self, *, after_cursor: int | None = None, limit: int | None = None):
        """Read one bounded page of this Team's durable task projections."""
        self.harness.start()
        return self.harness.client.list_team_tasks(self.id, after_cursor, limit)

    def workflow_plans(self, *, after_cursor: int | None = None, limit: int | None = None):
        """Read one bounded page of this Team's durable workflow plans."""
        self.harness.start()
        return self.harness.client.list_workflow_plans(self.id, after_cursor, limit)

    def artifacts(self, *, after_cursor: int | None = None, limit: int | None = None):
        """Read one bounded page of visible artifact references for this Team."""
        self.harness.start()
        return self.harness.client.list_team_artifacts(self.id, after_cursor, limit)

    def create_task(self, payload: JsonObject):
        """Create one Team task through the initialized connection's authenticated human route."""
        self.harness.start()
        return self.harness.client.create_team_task({**payload, "teamId": self.id})

    def task(self, task_id: str):
        """Read one durable Team task."""
        self.harness.start()
        return self.harness.client.get_team_task(self.id, task_id)

    def update_task(self, payload: JsonObject):
        """Update one Team task through the initialized connection's authenticated human route."""
        self.harness.start()
        return self.harness.client.update_team_task({**payload, "teamId": self.id})

    def cancel_task(self, payload: JsonObject):
        """Cancel one Team task through the initialized connection's authenticated human route."""
        self.harness.start()
        return self.harness.client.cancel_team_task({**payload, "teamId": self.id})

    def delete_task(self, payload: JsonObject):
        """Delete one Team task through the initialized connection's authenticated human route."""
        self.harness.start()
        return self.harness.client.delete_team_task({**payload, "teamId": self.id})

    def review_task(self, payload: JsonObject):
        """Resolve one Team task review through the initialized connection's authenticated human route."""
        self.harness.start()
        return self.harness.client.review_team_task({**payload, "teamId": self.id})

    def watch_tasks(self, after_cursor: int | None = None):
        """Wait for one Team task graph cursor to advance or close."""
        self.harness.start()
        return self.harness.client.watch_team_tasks(self.id, after_cursor)

    def channel(self, channel_id: str, after_cursor: int | None = None, limit: int | None = None):
        """Read one bounded WAL page for a Team channel."""
        self.harness.start()
        return self.harness.client.read_team_channel(channel_id, after_cursor, limit)

    def channel_catalog(self):
        """Discover installed channel and summary capabilities."""
        self.harness.start()
        return self.harness.client.get_team_channel_catalog()

    def summarize_channel(self, payload: JsonObject):
        """Summarize an explicitly selected channel range under this connection's human authority."""
        self.harness.start()
        return self.harness.client.summarize_team_channel(payload)

    def channels(self, after_cursor: int | None = None, limit: int | None = None):
        """List this Team's attached channel projections without message history."""
        self.harness.start()
        return self.harness.client.list_team_channels(self.id, after_cursor, limit)

    def admission(self, channel_id: str):
        """Read a channel manifest and endpoint admission states without recording consent."""
        self.harness.start()
        return self.harness.client.get_team_channel_admission(self.id, channel_id)

    def invitation(self, channel_id: str):
        """Read the authenticated human's invitation without recording consent."""
        self.harness.start()
        return self.harness.client.get_team_channel_invitation(channel_id)

    def acknowledge_invitation(self, payload: JsonObject):
        """Explicitly accept the discovered manifest and invitation revision."""
        self.harness.start()
        return self.harness.client.acknowledge_team_channel_invitation(payload)

    def open_channel(self, payload: JsonObject):
        """Open one generic Team channel through the authenticated human route."""
        self.harness.start()
        return self.harness.client.open_team_channel({**payload, "teamId": self.id})

    def input_channel(self, payload: JsonObject):
        """Admit ordered direct-channel media or one consult/discussion text block."""
        self.harness.start()
        return self.harness.client.input_team_channel(payload)

    def channel_attachment(self, channel_id: str, envelope_id: str, envelope_sequence: int, attachment_id: str):
        """Read an image from an exact channel Envelope belonging to this Team."""
        self.harness.start()
        return self.harness.client.read_team_channel_attachment(self.id, channel_id, envelope_id, envelope_sequence, attachment_id)

    def post_channel(self, payload: JsonObject):
        """Post one actor-free payload through the authenticated human route."""
        self.harness.start()
        return self.harness.client.post_team_channel(payload)

    def close_channel(self, payload: JsonObject):
        """Close one generic Team channel through the authenticated human route."""
        self.harness.start()
        return self.harness.client.close_team_channel(payload)

    def watch_channel(self, channel_id: str, after_cursor: int | None = None):
        """Wait for one channel cursor to advance or close."""
        self.harness.start()
        return self.harness.client.watch_team_channel(channel_id, after_cursor)

    def cancel(self):
        """Cancel this SDK-tracked runtime-owned TeamRun; untracked Team ids reject."""
        self.harness.start()
        return self.harness.client.cancel_team(self.id)

    def archive(self) -> None:
        """Archive this terminal Team through the authenticated human route."""
        self.harness.start()
        self.harness.client.archive_team(self.id)


def normalize_input(input: str | list[JsonObject]) -> list[JsonObject]:
    """Normalize a string into one text block while preserving explicit block order."""
    if isinstance(input, str):
        return [{"type": "text", "text": input}]
    return input


def team_cursor(response: TeamGetResponse) -> int:
    """Extract the current durable Team cursor required by resume."""
    team = response.state.get("team")
    cursor = team.get("cursor") if isinstance(team, dict) else None
    if type(cursor) is not int or cursor < 0:
        raise SdkProtocolError("team/get response has no durable team cursor")
    return cursor


def resolve_objective(
    input: str | list[JsonObject],
    content_blocks: list[JsonObject],
    explicit: str | None,
) -> str:
    """Resolve the durable Team objective before it crosses the wire."""
    if explicit is not None:
        return required_objective(explicit)
    if isinstance(input, str):
        return required_objective(input)
    text = "\n".join(
        cast(str, block["text"])
        for block in content_blocks
        if block.get("type") == "text" and isinstance(block.get("text"), str)
    )
    return required_objective(text, "objective is required when Team input contains no text")


def required_objective(value: str, message: str = "objective must be non-empty") -> str:
    """Require a non-whitespace Team objective before a Team exists."""
    objective = value.strip()
    if not objective:
        raise TypeError(message)
    return objective


def team_final_receipt(response: TeamWaitFinalResponse) -> TeamFinalReceipt:
    """Project a validated camel-case wire receipt into the Python API."""
    return TeamFinalReceipt(
        team_id=getattr(response, "teamId"),
        channel_id=getattr(response, "channelId"),
        envelope_id=getattr(response, "envelopeId"),
        text=getattr(response, "text"),
    )


def belongs_to_coordinator(notification: Notification, coordinator_session_id: str) -> bool:
    """Select one coordinator transcript notification."""
    return notification.payload.get("sessionId") == coordinator_session_id


def validated_coordinator_event(notification: Notification) -> JsonObject:
    """Validate the coordinator event projection exposed by ``RunResult``."""
    event = notification.payload.get("event")
    if not isinstance(event, dict) or not isinstance(event.get("type"), str):
        raise SdkProtocolError(f"session.event carried no event envelope: {event!r}")
    if event["type"] == "team/channel-view":
        validate_team_channel_view_event(event)
    if event["type"] == "assistant/message":
        data = event.get("data")
        message = data.get("message") if isinstance(data, dict) else None
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list) or not all(
            isinstance(block, dict) and isinstance(block.get("type"), str)
            for block in content
        ):
            raise SdkProtocolError(f"assistant/message event carried malformed content: {event!r}")
    return cast(JsonObject, event)


def validate_team_channel_view_event(event: JsonObject) -> None:
    """Validate the required durable model-view event at the SDK boundary."""
    if (
        type(event.get("seq")) is not int
        or event["seq"] < 0
        or event["seq"] > MAX_SAFE_INTEGER
        or type(event.get("time")) is not int
        or event["time"] < 0
        or event["time"] > MAX_SAFE_INTEGER
        or "ignorable" in event
        or event.get("surfaceOp") != "append"
    ):
        raise SdkProtocolError("team/channel-view event has an invalid envelope")
    data = event.get("data")
    if not isinstance(data, dict):
        raise SdkProtocolError("team/channel-view event has malformed data")
    allowed = {
        "teamId", "channelId", "adapter", "viewPolicy", "triggeringEnvelopeId",
        "sourceEnvelopeIds", "delivery", "content", "causationId", "taskId", "review",
    }
    if (
        set(data) - allowed
        or not non_empty_string(data.get("teamId"))
        or not non_empty_string(data.get("channelId"))
        or not non_empty_string(data.get("triggeringEnvelopeId"))
        or not valid_implementation(data.get("adapter"))
        or not valid_implementation(data.get("viewPolicy"))
        or data.get("delivery") not in {"context", "turn", "steer"}
        or not valid_source_envelope_ids(data.get("sourceEnvelopeIds"), data.get("triggeringEnvelopeId"))
        or not valid_content(data.get("content"))
    ):
        raise SdkProtocolError("team/channel-view event has malformed data")
    for field in ("causationId", "taskId"):
        if field in data and not non_empty_string(data[field]):
            raise SdkProtocolError("team/channel-view event has malformed optional provenance")
    if "review" in data and not valid_review_fence(data["review"]):
        raise SdkProtocolError("team/channel-view event has malformed review provenance")


def non_empty_string(value: object) -> bool:
    """Recognize a lossless non-empty SDK string."""
    return isinstance(value, str) and bool(value)


def valid_implementation(value: object) -> bool:
    """Validate one versioned adapter or policy identity."""
    return (
        isinstance(value, dict)
        and set(value) == {"type", "version"}
        and non_empty_string(value.get("type"))
        and type(value.get("version")) is int
        and 0 < value["version"] <= MAX_SAFE_INTEGER
    )


def valid_source_envelope_ids(value: object, triggering: object) -> bool:
    """Validate ordered duplicate-free view provenance."""
    return (
        isinstance(value, list)
        and bool(value)
        and all(non_empty_string(item) for item in value)
        and len(set(value)) == len(value)
        and value[-1] == triggering
    )


def valid_content(value: object) -> bool:
    """Validate merge-extensible model content blocks."""
    return isinstance(value, list) and bool(value) and all(
        isinstance(block, dict) and non_empty_string(block.get("type"))
        for block in value
    )


def valid_review_fence(value: object) -> bool:
    """Validate the optional review fence carried by one model view."""
    if not isinstance(value, dict):
        return False
    allowed = {"attemptId", "reviewRevision", "reviewerId", "initiatorId"}
    return (
        not set(value) - allowed
        and non_empty_string(value.get("attemptId"))
        and type(value.get("reviewRevision")) is int
        and 0 < value["reviewRevision"] <= MAX_SAFE_INTEGER
        and non_empty_string(value.get("reviewerId"))
        and ("initiatorId" not in value or non_empty_string(value["initiatorId"]))
    )
