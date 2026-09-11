from __future__ import annotations

import hashlib
import json
import os
import queue
import subprocess
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, TypeAlias, TypeVar

from pydantic import BaseModel, ValidationError

from .errors import (
    JsonRpcError,
    SdkProtocolError,
    TransportClosedError,
    redact_credentials,
    redact_credentials_error,
)
from .models import (
    IncomingRequest,
    InitializeResponse,
    JsonObject,
    JsonValue,
    Notification,
    TeamCancelResponse,
    TeamArchiveResponse,
    TeamCreateResponse,
    TeamResumeRequest,
    TeamResumeResponse,
    TeamWaitFinalResponse,
    TeamListResponse,
    TeamGetResponse,
    TeamGoalUpdateRequest,
    TeamGoalUpdateResponse,
    TeamGoalTransitionRequest,
    TeamGoalTransitionResponse,
    TeamQuiescenceResponse,
    TeamMetricsResponse,
    TeamHumanInboxPage,
    TeamHumanActionResponseRequest,
    TeamHumanActionResponseResult,
    TeamHumanInboxAcknowledgement,
    TeamAuditReadResponse,
    TeamArtifactReadResponse,
    TeamMemberListResponse,
    TeamMemberResponse,
    TeamInterruptResponse,
    TeamChannelResponse,
    TeamChannelAttachmentResponse,
    TeamChannelCatalogResponse,
    TeamChannelListResponse,
    TeamTaskListResponse,
    TeamWorkflowPlanListResponse,
    TeamArtifactListResponse,
    TeamTaskResponse,
    TeamChannelReadResponse,
)

ModelT = TypeVar("ModelT", bound=BaseModel)
NotificationFilter: TypeAlias = Callable[[Notification], bool]


class _RuntimeCredentialConflict(SdkProtocolError):
    pass


@dataclass(slots=True)
class HarnessConfig:
    """Configuration for launching the local Clocky SDK runtime."""

    runtime_bin: str | None = None
    bridge_bin: str | None = None
    launch_args_override: tuple[str, ...] | None = None
    cwd: str | None = None
    env: dict[str, str] | None = field(default=None, repr=False)
    request_timeout_seconds: float | None = None
    shutdown_timeout_seconds: float | None = 1.0


class HarnessClient:
    """Synchronous JSON-RPC client for Clocky SDK runtime over stdio."""

    def __init__(self, config: HarnessConfig | None = None) -> None:
        self.config = config or HarnessConfig()
        self._proc: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._initialization_lock = threading.Lock()
        self._launch_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._responses: dict[str, queue.Queue[JsonValue | BaseException]] = {}
        self._notifications: queue.Queue[Notification | BaseException] = queue.Queue()
        self._notification_subscribers: dict[
            str, tuple[queue.Queue[Notification | BaseException], NotificationFilter | None]
        ] = {}
        self._requests: queue.Queue[IncomingRequest | BaseException] = queue.Queue()
        self._stderr_lines: deque[str] = deque(maxlen=400)
        self._credential_lock = threading.Lock()
        self._credential_redactions: set[str] = set()
        self._launch_credential: str | None = None
        self._reader_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None

    def __enter__(self) -> "HarnessClient":
        self.start()
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    def start(self) -> None:
        """Prepare this client; credential-aware initialization launches the runtime."""

    def close(self) -> None:
        proc = self._proc
        if proc is None:
            return
        try:
            self.request("shutdown", None, response_model=_ShutdownResponse, timeout_seconds=self.config.shutdown_timeout_seconds)
        except Exception as exc:
            self._stderr_lines.append(self._redact_text(f"shutdown request failed: {exc}"))
        if proc.stdin:
            try:
                proc.stdin.close()
            except Exception as exc:
                self._stderr_lines.append(self._redact_text(f"stdin close failed: {exc}"))
        if proc.poll() is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        try:
            proc.wait(timeout=self.config.shutdown_timeout_seconds)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        self._proc = None
        self._launch_credential = None
        self._fail_waiters(self._runtime_closed_error("Clocky runtime closed"))
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=0.5)
        if self._stderr_thread and self._stderr_thread.is_alive():
            self._stderr_thread.join(timeout=0.5)

    def initialize(
        self,
        *,
        credential: str,
        cwd: str,
        provider: str,
        model: str,
        max_tokens: int | None = None,
    ) -> InitializeResponse:
        with self._initialization_lock:
            return self._initialize(credential, cwd, provider, model, max_tokens)

    def _initialize(
        self,
        credential: str,
        cwd: str,
        provider: str,
        model: str,
        max_tokens: int | None,
    ) -> InitializeResponse:
        if not isinstance(credential, str) or not credential:
            raise SdkProtocolError("initialize credential must be a non-empty string")
        self._remember_credential(credential)
        self._redact_stderr_lines()
        payload: JsonObject = {
            "credential": credential,
            "cwd": str(Path(cwd).resolve()),
            "provider": provider,
            "model": model,
        }
        if max_tokens is not None:
            payload["maxTokens"] = max_tokens
        failure: BaseException | None = None
        launched = False
        try:
            launched = self._launch_runtime(credential)
            return self._request("initialize", payload, response_model=InitializeResponse)
        except _RuntimeCredentialConflict as exc:
            failure = self._redact_error(exc)
        except BaseException as exc:
            if launched:
                self.close()
            self._redact_stderr_lines()
            failure = self._redact_error(exc)
        if failure is not None:
            raise failure
        raise AssertionError("initialize must return or fail")

    def create_team(
        self,
        objective: str,
        content_blocks: list[JsonObject],
        *,
        on_notification: Callable[[Notification], None] | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> TeamCreateResponse:
        payload: JsonObject = {"objective": objective, "contentBlocks": content_blocks}
        return self.request(
            "team/create",
            payload,
            response_model=TeamCreateResponse,
            on_notification=on_notification,
            notification_subscription=notification_subscription,
        )

    def wait_for_team_final(
        self,
        team_id: str,
        *,
        on_notification: Callable[[Notification], None] | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> TeamWaitFinalResponse:
        """Await an SDK-tracked runtime-owned TeamRun final; untracked Team ids reject."""
        return self.request(
            "team/wait-final",
            {"teamId": team_id},
            response_model=TeamWaitFinalResponse,
            on_notification=on_notification,
            notification_subscription=notification_subscription,
        )

    def resume_team(self, request: TeamResumeRequest) -> TeamResumeResponse:
        """Resume one Team through the initialized connection's authenticated human route."""
        return self.request(
            "team/resume",
            request.model_dump(),
            response_model=TeamResumeResponse,
        )

    def list_teams(self, after_cursor: int | None = None, limit: int | None = None) -> TeamListResponse:
        """Read one bounded page of durable Teams visible to the runtime."""
        payload: JsonObject = {}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        if limit is not None:
            payload["limit"] = limit
        return self.request("team/list", payload, response_model=TeamListResponse)

    def get_team(self, team_id: str) -> TeamGetResponse:
        """Read one complete durable Team projection."""
        return self.request("team/get", {"teamId": team_id}, response_model=TeamGetResponse)

    def update_team_goal(self, request: TeamGoalUpdateRequest) -> TeamGoalUpdateResponse:
        """Update one Team objective through the initialized connection's authenticated human route."""
        return self.request(
            "team/goal-update",
            request.model_dump(exclude_none=True),
            response_model=TeamGoalUpdateResponse,
        )

    def transition_team_goal(self, request: TeamGoalTransitionRequest) -> TeamGoalTransitionResponse:
        """Transition one Team objective through the initialized connection's authenticated human route."""
        return self.request(
            "team/goal-transition",
            request.model_dump(exclude_none=True),
            response_model=TeamGoalTransitionResponse,
        )

    def team_quiescence(self, team_id: str) -> TeamQuiescenceResponse:
        """Read durable quiescence diagnostics for one Team."""
        return self.request("team/quiescence", {"teamId": team_id}, response_model=TeamQuiescenceResponse)

    def inbox_respond(self, request: TeamHumanActionResponseRequest) -> TeamHumanActionResponseResult:
        """Accept one exact human answer without claiming its source tool has completed."""
        return self.request("team/inbox-respond", request.model_dump(exclude_none=True), response_model=TeamHumanActionResponseResult)

    def inbox_read(self, after_cursor: int | None = None, limit: int | None = None) -> TeamHumanInboxPage:
        """Read one bounded principal inbox page after the supplied or shared display cursor."""
        params: JsonObject = {}
        if after_cursor is not None:
            params["afterCursor"] = after_cursor
        if limit is not None:
            params["limit"] = limit
        return self.request("team/inbox-read", params, response_model=TeamHumanInboxPage)

    def inbox_watch(self, after_cursor: int | None = None, limit: int | None = None) -> TeamHumanInboxPage:
        """Watch one bounded principal inbox page after the supplied or shared display cursor."""
        params: JsonObject = {}
        if after_cursor is not None:
            params["afterCursor"] = after_cursor
        if limit is not None:
            params["limit"] = limit
        return self.request("team/inbox-watch", params, response_model=TeamHumanInboxPage)

    def inbox_acknowledge(self, through_cursor: int) -> TeamHumanInboxAcknowledgement:
        """Acknowledge a displayed inbox delivery without creating a channel receipt."""
        return self.request("team/inbox-acknowledge", {"throughCursor": through_cursor}, response_model=TeamHumanInboxAcknowledgement)

    def team_metrics(self) -> TeamMetricsResponse:
        """Read process-local Team operational counters."""
        return self.request("team/metrics", {}, response_model=TeamMetricsResponse)

    def team_audit_read(
        self,
        team_id: str,
        *,
        channel_id: str | None = None,
        after_cursor: int | None = None,
        limit: int | None = None,
    ) -> TeamAuditReadResponse:
        """Read a bounded Team-journal or channel-WAL audit page."""
        payload: JsonObject = {"teamId": team_id}
        if channel_id is not None:
            payload["channelId"] = channel_id
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        if limit is not None:
            payload["limit"] = limit
        return self.request("team/audit-read", payload, response_model=TeamAuditReadResponse)

    def read_team_artifact(self, team_id: str, artifact_id: str) -> TeamArtifactReadResponse:
        """Read one visible Team artifact by its durable reference id."""
        return self.request(
            "team/artifact-read",
            {"teamId": team_id, "artifactId": artifact_id},
            response_model=TeamArtifactReadResponse,
        )

    def list_team_members(
        self,
        team_id: str,
        after_cursor: int | None = None,
        limit: int | None = None,
    ) -> TeamMemberListResponse:
        """Read one bounded page of durable participant descriptors for a Team."""
        payload: JsonObject = {"teamId": team_id}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        if limit is not None:
            payload["limit"] = limit
        return self.request("team/member-list", payload, response_model=TeamMemberListResponse)

    def invite_team_member(self, payload: JsonObject) -> TeamMemberResponse:
        """Invite one non-human Team participant through the authenticated human route."""
        return self.request("team/member-invite", payload, response_model=TeamMemberResponse)

    def activate_team_member(self, payload: JsonObject) -> TeamMemberResponse:
        """Activate one invited Team participant through the authenticated human route."""
        return self.request("team/member-activate", payload, response_model=TeamMemberResponse)

    def remove_team_member(self, payload: JsonObject) -> TeamMemberResponse:
        """Remove one active Team participant through the authenticated human route."""
        return self.request("team/member-remove", payload, response_model=TeamMemberResponse)

    def interrupt_team_member(self, payload: JsonObject) -> TeamInterruptResponse:
        """Request a soft participant interrupt through the authenticated human route."""
        return self.request("team/member-interrupt", payload, response_model=TeamInterruptResponse)

    def get_team_channel_catalog(self) -> TeamChannelCatalogResponse:
        """Discover installed channel protocols, view policies and summary bounds."""
        return self.request("team/channel-catalog", {}, response_model=TeamChannelCatalogResponse)

    def summarize_team_channel(self, payload: JsonObject) -> TeamChannelResponse:
        """Commit a bounded explicit range summary with a stable retry identity."""
        return self.request("team/channel-summarize", payload, response_model=TeamChannelResponse)

    def list_team_channels(self, team_id: str, after_cursor: int | None = None, limit: int | None = None) -> TeamChannelListResponse:
        """List attached channel projections through authenticated Team membership."""
        params: JsonObject = {"teamId": team_id}
        if after_cursor is not None:
            params["afterCursor"] = after_cursor
        if limit is not None:
            params["limit"] = limit
        return self.request("team/channel-list", params, response_model=TeamChannelListResponse)

    def get_team_channel_admission(self, team_id: str, channel_id: str) -> TeamChannelResponse:
        """Read channel admission metadata through authenticated Team membership."""
        return self.request("team/channel-admission", {"teamId": team_id, "channelId": channel_id}, response_model=TeamChannelResponse)

    def get_team_channel_invitation(self, channel_id: str) -> TeamChannelResponse:
        """Read only the authenticated human's invitation without accepting it."""
        return self.request("team/channel-invitation", {"channelId": channel_id}, response_model=TeamChannelResponse)

    def acknowledge_team_channel_invitation(self, payload: JsonObject) -> TeamChannelResponse:
        """Accept an exact invitation manifest, revision and idempotency key."""
        return self.request("team/channel-invitation-acknowledge", payload, response_model=TeamChannelResponse)

    def open_team_channel(self, payload: JsonObject) -> TeamChannelResponse:
        """Open one generic Team channel through the authenticated human route."""
        return self.request("team/channel-open", payload, response_model=TeamChannelResponse)

    def input_team_channel(self, payload: JsonObject) -> TeamChannelResponse:
        """Admit ordered direct-channel media or one consult/discussion text block."""
        return self.request("team/channel-input", payload, response_model=TeamChannelResponse)

    def read_team_channel_attachment(self, team_id: str, channel_id: str, envelope_id: str, envelope_sequence: int, attachment_id: str) -> TeamChannelAttachmentResponse:
        """Read an image referenced by the exact authorized Team channel Envelope."""
        return self.request("team/channel-attachment", {"teamId": team_id, "channelId": channel_id,
            "envelopeId": envelope_id, "envelopeSequence": envelope_sequence, "attachmentId": attachment_id}, response_model=TeamChannelAttachmentResponse)

    def post_team_channel(self, payload: JsonObject) -> TeamChannelResponse:
        """Post one actor-free payload through the authenticated human route."""
        return self.request("team/channel-post", payload, response_model=TeamChannelResponse)

    def list_team_tasks(
        self,
        team_id: str,
        after_cursor: int | None = None,
        limit: int | None = None,
    ) -> TeamTaskListResponse:
        """Read one bounded page of durable task projections for a Team."""
        payload: JsonObject = {"teamId": team_id}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        if limit is not None:
            payload["limit"] = limit
        return self.request("team/task-list", payload, response_model=TeamTaskListResponse)

    def list_workflow_plans(
        self,
        team_id: str,
        after_cursor: int | None = None,
        limit: int | None = None,
    ) -> TeamWorkflowPlanListResponse:
        """Read one bounded page of durable workflow-plan projections."""
        payload: JsonObject = {"teamId": team_id}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        if limit is not None:
            payload["limit"] = limit
        return self.request("team/workflow-plan-list", payload, response_model=TeamWorkflowPlanListResponse)

    def list_team_artifacts(
        self,
        team_id: str,
        after_cursor: int | None = None,
        limit: int | None = None,
    ) -> TeamArtifactListResponse:
        """Read one bounded page of visible Team artifact references."""
        payload: JsonObject = {"teamId": team_id}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        if limit is not None:
            payload["limit"] = limit
        return self.request("team/artifact-list", payload, response_model=TeamArtifactListResponse)

    def create_team_task(self, payload: JsonObject) -> TeamTaskResponse:
        """Create one Team task through the initialized connection's authenticated human route."""
        return self.request("team/task-create", payload, response_model=TeamTaskResponse)

    def get_team_task(self, team_id: str, task_id: str) -> TeamTaskResponse:
        """Read one durable Team task."""
        return self.request("team/task-get", {"teamId": team_id, "taskId": task_id}, response_model=TeamTaskResponse)

    def update_team_task(self, payload: JsonObject) -> TeamTaskResponse:
        """Update one Team task through the initialized connection's authenticated human route."""
        return self.request("team/task-update", payload, response_model=TeamTaskResponse)

    def cancel_team_task(self, payload: JsonObject) -> TeamTaskResponse:
        """Request one task stop with teamId, taskId, expectedRevision, and optional reason.

        An assigned or running response retains its lease until its owner acknowledges
        termination and releases resources. Observe task state for cancellation; the Team stays active.
        """
        return self.request("team/task-cancel", payload, response_model=TeamTaskResponse)

    def delete_team_task(self, payload: JsonObject) -> TeamTaskResponse:
        """Delete one Team task through the initialized connection's authenticated human route."""
        return self.request("team/task-delete", payload, response_model=TeamTaskResponse)

    def review_team_task(self, payload: JsonObject) -> TeamTaskResponse:
        """Resolve one Team task review through the initialized connection's authenticated human route."""
        return self.request("team/task-review", payload, response_model=TeamTaskResponse)

    def watch_team_tasks(self, team_id: str, after_cursor: int | None = None) -> TeamTaskResponse:
        """Wait for one Team task graph cursor to advance or close."""
        payload: JsonObject = {"teamId": team_id}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        return self.request("team/task-watch", payload, response_model=TeamTaskResponse)

    def read_team_channel(
        self,
        channel_id: str,
        after_cursor: int | None = None,
        limit: int | None = None,
    ) -> TeamChannelReadResponse:
        """Read one bounded page of a channel WAL suffix."""
        payload: JsonObject = {"channelId": channel_id}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        if limit is not None:
            payload["limit"] = limit
        return self.request("team/channel-read", payload, response_model=TeamChannelReadResponse)

    def close_team_channel(self, payload: JsonObject) -> TeamChannelResponse:
        """Close one generic Team channel through the authenticated human route."""
        return self.request("team/channel-close", payload, response_model=TeamChannelResponse)

    def watch_team_channel(self, channel_id: str, after_cursor: int | None = None) -> TeamChannelResponse:
        """Wait for one channel cursor to advance or close."""
        payload: JsonObject = {"channelId": channel_id}
        if after_cursor is not None:
            payload["afterCursor"] = after_cursor
        return self.request("team/channel-watch", payload, response_model=TeamChannelResponse)

    def cancel_team(self, team_id: str) -> TeamCancelResponse:
        """Cancel an SDK-tracked runtime-owned TeamRun; untracked Team ids reject."""
        return self.request(
            "team/cancel",
            {"teamId": team_id},
            response_model=TeamCancelResponse,
        )

    def archive_team(self, team_id: str, expected_cursor: int | None = None) -> TeamArchiveResponse:
        """Archive one terminal Team through the authenticated human route."""
        if expected_cursor is None:
            current = self.get_team(team_id)
            team = current.state.get("team")
            if not isinstance(team, dict) or not isinstance(team.get("cursor"), int):
                raise SdkProtocolError("team/get response has no durable team cursor")
            expected_cursor = team["cursor"]
        return self.request(
            "team/archive",
            {"teamId": team_id, "expectedCursor": expected_cursor},
            response_model=TeamArchiveResponse,
        )

    def request(
        self,
        method: str,
        params: JsonObject | None,
        *,
        response_model: type[ModelT],
        timeout_seconds: float | None = None,
        on_notification: Callable[[Notification], None] | None = None,
        notification_filter: NotificationFilter | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> ModelT:
        if method == "initialize":
            raise SdkProtocolError("use HarnessClient.initialize for the initialization handshake")
        return self._request(
            method,
            params,
            response_model=response_model,
            timeout_seconds=timeout_seconds,
            on_notification=on_notification,
            notification_filter=notification_filter,
            notification_subscription=notification_subscription,
        )

    def _request(
        self,
        method: str,
        params: JsonObject | None,
        *,
        response_model: type[ModelT],
        timeout_seconds: float | None = None,
        on_notification: Callable[[Notification], None] | None = None,
        notification_filter: NotificationFilter | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> ModelT:
        result = self._request_raw(
            method,
            params,
            timeout_seconds=timeout_seconds,
            on_notification=on_notification,
            notification_filter=notification_filter,
            notification_subscription=notification_subscription,
        )
        if not isinstance(result, dict):
            raise SdkProtocolError(self._redact_text(f"{method} response must be a JSON object"))
        failure: SdkProtocolError | None = None
        try:
            return response_model.model_validate(result)
        except ValidationError as exc:
            failure = SdkProtocolError(self._redact_text(f"{method} response violates the SDK protocol: {exc}"))
        if failure is not None:
            raise failure
        raise AssertionError("response validation must return or fail")

    def notify(self, method: str, params: JsonObject | None = None) -> None:
        if method == "initialize":
            raise SdkProtocolError("use HarnessClient.initialize for the initialization handshake")
        message: JsonObject = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._write_message(message)

    def next_notification(self) -> Notification:
        item = self._notifications.get()
        if isinstance(item, BaseException):
            raise item
        return item

    def subscribe_notifications(
        self,
        notification_filter: NotificationFilter | None = None,
    ) -> "NotificationSubscription":
        subscription_id = str(uuid.uuid4())
        notifications: queue.Queue[Notification | BaseException] = queue.Queue()
        with self._lock:
            self._notification_subscribers[subscription_id] = (notifications, notification_filter)
        return NotificationSubscription(self, subscription_id, notifications)

    def next_request(self) -> IncomingRequest:
        item = self._requests.get()
        if isinstance(item, BaseException):
            raise item
        return item

    def respond(self, request_id: str | int, result: JsonValue) -> None:
        self._write_message({"jsonrpc": "2.0", "id": request_id, "result": result})

    def respond_error(
        self,
        request_id: str | int,
        *,
        code: int,
        message: str,
        data: JsonValue | None = None,
    ) -> None:
        error: JsonObject = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        self._write_message({"jsonrpc": "2.0", "id": request_id, "error": error})

    def _request_raw(
        self,
        method: str,
        params: JsonObject | None = None,
        *,
        timeout_seconds: float | None = None,
        on_notification: Callable[[Notification], None] | None = None,
        notification_filter: NotificationFilter | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> JsonValue:
        request_id = str(uuid.uuid4())
        waiter: queue.Queue[JsonValue | BaseException] = queue.Queue(maxsize=1)
        temp_subscription: NotificationSubscription | None = None
        subscription = notification_subscription
        with self._lock:
            self._responses[request_id] = waiter
        if on_notification is not None and subscription is None:
            temp_subscription = self.subscribe_notifications(notification_filter)
            subscription = temp_subscription
        try:
            message: JsonObject = {"jsonrpc": "2.0", "id": request_id, "method": method}
            if params is not None:
                message["params"] = params
            self._write_message(message)
        except BaseException:
            with self._lock:
                self._responses.pop(request_id, None)
            if temp_subscription is not None:
                temp_subscription.close()
            raise
        timeout = self.config.request_timeout_seconds if timeout_seconds is None else timeout_seconds
        deadline = None if timeout is None else time.monotonic() + timeout
        try:
            while True:
                if on_notification is not None and subscription is not None:
                    subscription.drain(on_notification)
                wait_timeout = None
                if on_notification is not None:
                    wait_timeout = 0.05
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        with self._lock:
                            self._responses.pop(request_id, None)
                        diagnostics = self._runtime_diagnostics()
                        suffix = f"\n{diagnostics}" if diagnostics else ""
                        raise TimeoutError(
                            f"{method} timed out waiting for Clocky runtime{suffix}"
                        )
                    wait_timeout = remaining if wait_timeout is None else min(wait_timeout, remaining)
                try:
                    item = waiter.get(timeout=wait_timeout)
                    if on_notification is not None and subscription is not None:
                        subscription.drain(on_notification)
                    break
                except queue.Empty:
                    continue
        except BaseException:
            with self._lock:
                self._responses.pop(request_id, None)
            if temp_subscription is not None:
                temp_subscription.close()
            raise
        finally:
            if temp_subscription is not None:
                temp_subscription.close()
        if isinstance(item, BaseException):
            raise item
        return item

    def _write_message(self, message: JsonObject) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise TransportClosedError("Clocky runtime is not running")
        try:
            payload = json.dumps(message, separators=(",", ":")) + "\n"
            with self._write_lock:
                proc.stdin.write(payload)
                proc.stdin.flush()
        except Exception as exc:
            raise self._runtime_closed_error("Failed to write to Clocky runtime") from exc

    def _start_reader_thread(self) -> None:
        self._reader_thread = threading.Thread(target=self._reader_loop, name="clocky-runtime-reader", daemon=True)
        self._reader_thread.start()

    def _start_stderr_thread(self) -> None:
        self._stderr_thread = threading.Thread(target=self._stderr_loop, name="clocky-runtime-stderr", daemon=True)
        self._stderr_thread.start()

    def _reader_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stdout is None:
            return
        try:
            for line in proc.stdout:
                if not line.strip():
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self._handle_message(message)
        except BaseException as exc:
            self._fail_waiters(exc)
        finally:
            self._fail_waiters(self._runtime_closed_error("Clocky runtime stdout closed"))

    def _stderr_loop(self) -> None:
        proc = self._proc
        if proc is None or proc.stderr is None:
            return
        for line in proc.stderr:
            self._stderr_lines.append(self._redact_text(line.rstrip()))

    def _handle_message(self, message: object) -> None:
        if not isinstance(message, dict):
            return
        msg_id = message.get("id")
        method = message.get("method")
        if isinstance(msg_id, (str, int)) and isinstance(method, str):
            params = message.get("params")
            self._requests.put(IncomingRequest(id=msg_id, method=method, payload=params if isinstance(params, dict) else {}))
            return
        if isinstance(msg_id, (str, int)):
            with self._lock:
                waiter = self._responses.pop(str(msg_id), None)
            if waiter is None:
                return
            if isinstance(message.get("error"), dict):
                err = message["error"]
                waiter.put(
                    JsonRpcError(
                        _int_or_none(err.get("code")),
                        self._redact_text(str(err.get("message", "JSON-RPC error"))),
                        self._redact_value(err.get("data")),
                    )
                )
            else:
                waiter.put(message.get("result"))
            return
        if isinstance(method, str):
            params = message.get("params")
            notification = Notification(method=method, payload=params if isinstance(params, dict) else {})
            with self._lock:
                subscribers = list(self._notification_subscribers.items())
            delivered = False
            for subscription_id, (subscriber, predicate) in subscribers:
                try:
                    matches = predicate is None or predicate(notification)
                except BaseException as exc:
                    with self._lock:
                        current = self._notification_subscribers.get(subscription_id)
                        if current is not None and current[0] is subscriber:
                            self._notification_subscribers.pop(subscription_id, None)
                    subscriber.put(exc)
                    continue
                if matches:
                    subscriber.put(notification)
                    delivered = True
            if not delivered:
                self._notifications.put(notification)

    def _fail_waiters(self, exc: BaseException) -> None:
        with self._lock:
            waiters = list(self._responses.values())
            self._responses.clear()
            subscribers = list(self._notification_subscribers.values())
            self._notification_subscribers.clear()
        for waiter in waiters:
            waiter.put(exc)
        for subscriber, _predicate in subscribers:
            subscriber.put(exc)
        self._notifications.put(exc)
        self._requests.put(exc)

    def _runtime_closed_error(self, reason: str) -> TransportClosedError:
        diagnostics = self._runtime_diagnostics()
        return TransportClosedError(f"{reason}\n{diagnostics}" if diagnostics else reason)

    def _runtime_diagnostics(self) -> str:
        """Return available subprocess state for transport failures and timeouts."""
        proc = self._proc
        if (
            proc is not None
            and proc.poll() is not None
            and self._stderr_thread is not None
            and self._stderr_thread.is_alive()
            and threading.current_thread() is not self._stderr_thread
        ):
            self._stderr_thread.join(timeout=0.1)

        parts: list[str] = []
        if proc is not None:
            exit_code = proc.poll()
            if exit_code is not None:
                parts.append(f"exit code: {exit_code}")
        if self._stderr_lines:
            parts.append("stderr tail:\n" + "\n".join(self._stderr_lines))
        return "\n".join(parts)

    def _launch_runtime(self, credential: str) -> bool:
        with self._launch_lock:
            if self._proc is not None:
                if self._launch_credential != credential:
                    raise _RuntimeCredentialConflict("runtime is already bound to another initialization credential")
                return False
            args = list(self.config.launch_args_override or self._default_launch_args())
            credentials = self._known_credentials()
            if any(secret in str(arg) for arg in args for secret in credentials):
                raise SdkProtocolError("initialization credential must not appear in runtime launch arguments")
            env = os.environ.copy()
            if self.config.env:
                env.update(self.config.env)
            bundled_default_config = self._inject_bundled_default_config(env)
            configured_digest = env.get("CLOCKY_PRODUCT_CREDENTIAL_SHA256")
            credential_digest = hashlib.sha256(credential.encode("utf-8")).hexdigest()
            self._scrub_credentials_from_environment(env, credentials)
            if configured_digest == credential_digest:
                env["CLOCKY_PRODUCT_CREDENTIAL_SHA256"] = configured_digest
            if bundled_default_config:
                self._inject_bundled_product_credential_digest(env, credential)
            self._proc = subprocess.Popen(
                args,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                cwd=None if self.config.cwd is None else str(Path(self.config.cwd).resolve()),
                env=env,
                bufsize=1,
            )
            self._launch_credential = credential
            self._start_reader_thread()
            self._start_stderr_thread()
            return True

    @staticmethod
    def _scrub_credentials_from_environment(env: dict[str, str], credentials: tuple[str, ...]) -> None:
        for key, value in tuple(env.items()):
            if any(credential in key for credential in credentials):
                del env[key]
                continue
            for credential in credentials:
                value = value.replace(credential, "[REDACTED]")
            env[key] = value

    def _remember_credential(self, credential: str) -> None:
        if not credential:
            return
        with self._credential_lock:
            self._credential_redactions.add(credential)

    def _redact_text(self, value: str) -> str:
        redacted = self._redact_value(value)
        return redacted if isinstance(redacted, str) else value

    def _redact_value(self, value: object) -> object:
        return redact_credentials(value, self._known_credentials())

    def _redact_error(self, error: BaseException) -> BaseException:
        return redact_credentials_error(error, self._known_credentials())

    def _known_credentials(self) -> tuple[str, ...]:
        with self._credential_lock:
            return tuple(sorted(self._credential_redactions, key=len, reverse=True))

    def _redact_stderr_lines(self) -> None:
        self._stderr_lines = deque(
            (self._redact_text(line) for line in self._stderr_lines),
            maxlen=self._stderr_lines.maxlen,
        )

    def _default_launch_args(self) -> tuple[str, ...]:
        if self.config.runtime_bin is not None:
            return (self.config.runtime_bin,)
        if self.config.bridge_bin is not None:
            return (self.config.bridge_bin,)
        try:
            from clocky_runtime import resolve_bundled_launch_args
        except ImportError as exc:
            raise FileNotFoundError(
                "Unable to locate the bundled Clocky SDK runtime. "
                "Install clocky-runtime-bin or set HarnessConfig.runtime_bin."
            ) from exc
        return resolve_bundled_launch_args()

    def _inject_bundled_default_config(self, env: dict[str, str]) -> bool:
        """Inject the default config for a bundled launch with no non-empty config.

        Both bundled carriers require an explicit config. Explicit runtime,
        launch-argument, and config channels remain untouched.
        """
        uses_bundled_runtime = (
            self.config.launch_args_override is None
            and self.config.runtime_bin is None
            and self.config.bridge_bin is None
        )
        if not uses_bundled_runtime or env.get("CLOCKY_CORDIS_CONFIG"):
            return False
        # _default_launch_args already imported the package or raised its install error.
        from clocky_runtime import bundled_default_config_path

        env["CLOCKY_CORDIS_CONFIG"] = str(bundled_default_config_path())
        return True

    @staticmethod
    def _inject_bundled_product_credential_digest(env: dict[str, str], credential: str) -> None:
        """Provide the bundled runtime only the non-secret digest matching its stdin handshake credential."""
        digest = hashlib.sha256(credential.encode("utf-8")).hexdigest()
        configured = env.get("CLOCKY_PRODUCT_CREDENTIAL_SHA256")
        if configured is not None and configured != digest:
            raise SdkProtocolError(
                "CLOCKY_PRODUCT_CREDENTIAL_SHA256 does not match the initialization credential"
            )
        env["CLOCKY_PRODUCT_CREDENTIAL_SHA256"] = digest

    def _unsubscribe_notifications(self, subscription_id: str) -> None:
        with self._lock:
            self._notification_subscribers.pop(subscription_id, None)


class NotificationSubscription:
    def __init__(
        self,
        client: HarnessClient,
        subscription_id: str,
        notifications: queue.Queue[Notification | BaseException],
    ) -> None:
        self._client = client
        self._subscription_id = subscription_id
        self._notifications = notifications
        self._closed = False
        self._state_lock = threading.Lock()
        self._waiters = 0
        self._close_error: TransportClosedError | None = None

    def __enter__(self) -> "NotificationSubscription":
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    def close(self) -> None:
        with self._state_lock:
            if self._closed:
                return
            self._closed = True
            self._close_error = TransportClosedError("notification subscription closed")
            while True:
                try:
                    self._notifications.get_nowait()
                except queue.Empty:
                    break
            for _ in range(max(1, self._waiters)):
                self._notifications.put(self._close_error)
        self._client._unsubscribe_notifications(self._subscription_id)

    def next(self) -> Notification:
        with self._state_lock:
            if self._closed:
                if self._close_error is None:
                    raise TransportClosedError("notification subscription closed")
                raise self._close_error
            self._waiters += 1
        try:
            item = self._notifications.get()
        finally:
            with self._state_lock:
                self._waiters -= 1
        if isinstance(item, BaseException):
            raise item
        return item

    def try_next(self) -> Notification | None:
        with self._state_lock:
            if self._closed:
                return None
        try:
            item = self._notifications.get_nowait()
        except queue.Empty:
            return None
        if isinstance(item, BaseException):
            raise item
        return item

    def drain(self, on_notification: Callable[[Notification], None]) -> None:
        with self._state_lock:
            if self._closed:
                return
        while True:
            try:
                item = self._notifications.get_nowait()
            except queue.Empty:
                return
            if isinstance(item, BaseException):
                if self._closed and item is self._close_error:
                    return
                raise item
            on_notification(item)


class _ShutdownResponse(BaseModel):
    pass


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None
