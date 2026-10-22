from __future__ import annotations
from .simulation_retention import (SimulationRetentionPreviewInput, SimulationRetentionExecuteInput, SimulationRetentionReadInput, SimulationRetentionRecordsInput, SimulationRetentionPlan, SimulationRetentionResult, SimulationRetentionRecordsResult)
from .simulation_generation import (SimulationGenerationRequest, SimulationGenerationRead, SimulationGenerationTransition,
    SimulationGenerationPersonaDraft, SimulationGenerationResult)
from .simulation_index import SimulationRebuildIndexInput, SimulationRebuildIndexResult
from .simulation_world_management import (SimulationWorldManagementFieldsInput, SimulationWorldManagementFields,
    SimulationWorldManagementDraft, SimulationWorldManagementPreview, SimulationWorldManagementSubmitInput)
from .simulation_world_domain import SimulationWorldDomainInput, SimulationWorldDomainResult
from .simulation_world_cases import SimulationWorldCasesInput, SimulationWorldCasesPage, SimulationWorldCaseInput, SimulationWorldCaseInspection
from .simulation_scenario import (SimulationWorldPreflightInput, SimulationWorldPreflightResult, SimulationWorldCreateInput,
    SimulationWorldPrepareInput, SimulationWorldExportInput, SimulationWorldExportResult)
from .session_events import KNOWN_SESSION_EVENT_TYPES
from .compaction_events import validate_compaction_evidence_event
from .simulation_raw_archive import SimulationRawArchiveInput, SimulationRawArchivePage
from .simulation import SimulationRunControlInput, SimulationRunControlResult
from .simulation import SimulationWorldCaseCancelInput
from .simulation import SimulationTasksInput, SimulationTasksPage, SimulationTaskCancelInput
from .simulation import SimulationRequestsInput, SimulationRequestsPage, SimulationRetryRequestInput
from .simulation import SimulationPreflightInput, SimulationPreflightResult
from .simulation import SimulationOperationRetryInput
from .simulation import SimulationRunStatusesInput, SimulationRunStatusesPage
from .simulation import SimulationTaskReviewListInput, SimulationTaskReviewPage, SimulationTaskReviewResolveInput

from .simulation import SimulationSourceInput, SimulationSourceInspection, SimulationWatchInput, SimulationWatchResult, SimulationRecordsInput, SimulationRecordsPage

from .simulation import (SimulationControlInput, SimulationControl, SimulationManageInput, SimulationManageResult, SimulationManagementInput, SimulationManagementResult, SimulationCheckpointInput, SimulationRequestReceipt, SimulationRestoreInput, SimulationIngressInput, SimulationIngressReceipt, SimulationIngressQuery, SimulationIngressResult)

from .simulation import (SimulationBrowseInput, SimulationCatalog, SimulationCollectionPage, SimulationCreateInput, SimulationInspectInput, SimulationInspection, SimulationListInput, SimulationObjectInput, SimulationObjectInspection, SimulationPrepareInput, SimulationRequestInput, SimulationRequestReceipt, SimulationRequestResult, SimulationRunPage)

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

    def get_simulation_control(self, request: SimulationControlInput) -> SimulationControl:
        """Read current scheduling ownership and preconditions without opening or advancing a run."""
        self.start()
        return self._client.get_simulation_control(request)

    def update_simulation_run_control(self, request: SimulationRunControlInput) -> SimulationRunControlResult:
        """Persist a target or explicit null clear; resuming scheduling remains separate."""
        self.start()
        return self._client.update_simulation_run_control(request)

    def manage_simulation(self, request: SimulationManageInput) -> SimulationManageResult:
        """Submit an original scheduling intent; exact retries retain its result without undoing later intent."""
        self.start()
        return self._client.manage_simulation(request)

    def get_simulation_management(self, request: SimulationManagementInput) -> SimulationManagementResult:
        """Query an original scheduling outcome; absence does not establish failure."""
        self.start()
        return self._client.get_simulation_management(request)

    def list_simulation_tasks(self, request: SimulationTasksInput) -> SimulationTasksPage:
        """Read bounded canonical run-owned task controls without private task bodies or inference."""
        self.start()
        return self._client.list_simulation_tasks(request)

    def read_simulation_world_management_fields(self, request: SimulationWorldManagementFieldsInput) -> SimulationWorldManagementFields:
        """Read exact personnel form metadata without beginning execution or granting content access."""
        self.start()
        return self._client.read_simulation_world_management_fields(request)

    def preview_simulation_world_management(self, request: SimulationWorldManagementDraft) -> SimulationWorldManagementPreview:
        """Read inert actual effects, source coverage and the precise Native preview commitment."""
        self.start()
        return self._client.preview_simulation_world_management(request)

    def submit_simulation_world_management(self, request: SimulationWorldManagementSubmitInput) -> SimulationRequestReceipt:
        """Submit one caller-retained command; uncertain outcomes still require querying that original."""
        self.start()
        return self._client.submit_simulation_world_management(request)

    def read_simulation_world_domain(self, request: SimulationWorldDomainInput) -> SimulationWorldDomainResult:
        """Read an exact bounded World domain window without executing or granting private bodies."""
        self.start()
        return self._client.read_simulation_world_domain(request)

    def list_simulation_world_cases(self, request: SimulationWorldCasesInput) -> SimulationWorldCasesPage:
        """Read an exact World case selection without implicit scheduling or content authorization."""
        self.start()
        return self._client.list_simulation_world_cases(request)

    def inspect_simulation_world_case(self, request: SimulationWorldCaseInput) -> SimulationWorldCaseInspection:
        """Read an exact World case selection without implicit scheduling or content authorization."""
        self.start()
        return self._client.inspect_simulation_world_case(request)

    def cancel_simulation_world_case(self, request: SimulationWorldCaseCancelInput) -> SimulationRequestReceipt:
        """Submit or retry the exact original World case cancellation."""
        self.start()
        return self._client.cancel_simulation_world_case(request)

    def cancel_simulation_task(self, request: SimulationTaskCancelInput) -> SimulationRequestReceipt:
        """Cancel the exact original task with a current revision and attempt or explicit no-lease fence."""
        self.start()
        return self._client.cancel_simulation_task(request)

    def list_simulation_task_reviews(self, request: SimulationTaskReviewListInput) -> SimulationTaskReviewPage:
        """Observe exact run-owned review metadata without task bodies or execution."""
        self.start()
        return self._client.list_simulation_task_reviews(request)

    def resolve_simulation_task_review(self, request: SimulationTaskReviewResolveInput) -> SimulationRequestReceipt:
        """Submit a retained original review intent under installed scene authority."""
        self.start()
        return self._client.resolve_simulation_task_review(request)

    def checkpoint_simulation(self, request: SimulationCheckpointInput) -> SimulationRequestReceipt:
        """Request a full checkpoint; accepted work outlives its waiter and remains paused after completion."""
        self.start()
        return self._client.checkpoint_simulation(request)

    def restore_simulation(self, request: SimulationRestoreInput) -> SimulationRequestReceipt:
        """Verify checkpoint history and current suffix, then acquire a paused owner without rollback or inference."""
        self.start()
        return self._client.restore_simulation(request)

    def ingress_simulation(self, request: SimulationIngressInput) -> SimulationIngressReceipt:
        """Submit one attributed entity input with its original identity and exact simulated time."""
        self.start()
        return self._client.ingress_simulation(request)

    def get_simulation_ingress(self, request: SimulationIngressQuery) -> SimulationIngressResult:
        """Query original input assignment and consumption independently of scheduling."""
        self.start()
        return self._client.get_simulation_ingress(request)

    def simulation_catalog(self) -> SimulationCatalog:
        """Read bounded authorized metadata without starting inference."""
        self.start()
        return self._client.simulation_catalog()

    def retry_simulation_operation(self, request: SimulationOperationRetryInput) -> SimulationRequestReceipt:
        """Grant one existing bounded outbox retry budget; publication and scheduling remain separate explicit actions."""
        self.start()
        return self._client.retry_simulation_operation(request)

    def get_simulation_run_statuses(self, request: SimulationRunStatusesInput) -> SimulationRunStatusesPage:
        """Read one exact bounded authorized batch without acquiring execution or inferring unavailable usage."""
        self.start()
        return self._client.get_simulation_run_statuses(request)

    def list_simulations(self, request: SimulationListInput | None = None) -> SimulationRunPage:
        """Read bounded authorized metadata without starting inference."""
        self.start()
        return self._client.list_simulations(request)

    def inspect_simulation(self, request: SimulationInspectInput) -> SimulationInspection:
        """Read bounded authorized metadata without starting inference."""
        self.start()
        return self._client.inspect_simulation(request)

    def retention_preview(self, request: SimulationRetentionPreviewInput) -> SimulationRetentionPlan:
        """Explicit original retention preview; preview and reads never infer or pause."""
        self.start()
        return self._client.retention_preview(request)

    def retention_execute(self, request: SimulationRetentionExecuteInput) -> SimulationRetentionResult:
        """Explicit original retention execute; preview and reads never infer or pause."""
        self.start()
        return self._client.retention_execute(request)

    def retention_read(self, request: SimulationRetentionReadInput) -> SimulationRetentionResult:
        """Explicit original retention read; preview and reads never infer or pause."""
        self.start()
        return self._client.retention_read(request)

    def retention_records(self, request: SimulationRetentionRecordsInput) -> SimulationRetentionRecordsResult:
        """Explicit original retention records; preview and reads never infer or pause."""
        self.start()
        return self._client.retention_records(request)

    def generation_request(self, request: SimulationGenerationRequest) -> SimulationGenerationResult:
        """Explicit original generation request; only execute invokes a model."""
        self.start()
        return self._client.generation_request(request)

    def generation_read(self, request: SimulationGenerationRead) -> SimulationGenerationResult:
        """Explicit original generation read; only execute invokes a model."""
        self.start()
        return self._client.generation_read(request)

    def generation_execute(self, request: SimulationGenerationRead) -> SimulationGenerationResult:
        """Explicit original generation execute; only execute invokes a model."""
        self.start()
        return self._client.generation_execute(request)

    def generation_transition(self, request: SimulationGenerationTransition) -> SimulationGenerationResult:
        """Explicit original generation transition; only execute invokes a model."""
        self.start()
        return self._client.generation_transition(request)

    def generation_persona_draft(self, request: SimulationGenerationPersonaDraft) -> SimulationGenerationResult:
        """Explicit original generation persona-draft; only execute invokes a model."""
        self.start()
        return self._client.generation_persona_draft(request)

    def rebuild_simulation_index(self, request: SimulationRebuildIndexInput) -> SimulationRebuildIndexResult:
        """Rebuild one original derived prefix through the authenticated Native owner."""
        self.start()
        return self._client.rebuild_simulation_index(request)

    def browse_simulation(self, request: SimulationBrowseInput) -> SimulationCollectionPage:
        """Read bounded authorized metadata without starting inference."""
        self.start()
        return self._client.browse_simulation(request)

    def inspect_simulation_source(self, request: SimulationSourceInput) -> SimulationSourceInspection:
        """Read an exact frozen Envelope source under separate Simulation and Team authority."""
        self.start()
        return self._client.inspect_simulation_source(request)

    def archive_raw_simulation(self, request: SimulationRawArchiveInput) -> SimulationRawArchivePage:
        """Preserve original source bytes with an explicit whole-record grant; never restore or interpret Native state."""
        self.start()
        return self._client.archive_raw_simulation(request)

    def read_simulation_records(self, request: SimulationRecordsInput) -> SimulationRecordsPage:
        """Read bounded original journal metadata or separately authorized historical JSON text."""
        self.start()
        return self._client.read_simulation_records(request)

    def watch_simulation(self, request: SimulationWatchInput) -> SimulationWatchResult:
        """Observe invalidation only; the caller chooses whether to wait again or refresh."""
        self.start()
        return self._client.watch_simulation(request)

    def inspect_simulation_object(self, request: SimulationObjectInput) -> SimulationObjectInspection:
        """Read bounded authorized metadata without starting inference."""
        self.start()
        return self._client.inspect_simulation_object(request)

    def preflight_simulation(self, request: SimulationPreflightInput) -> SimulationPreflightResult:
        """Resolve an allowlisted creation draft without allocating or preparing a run."""
        self.start()
        return self._client.preflight_simulation(request)

    def preflight_simulation_world(self, request: SimulationWorldPreflightInput) -> SimulationWorldPreflightResult:
        """Resolve a portable World definition without creating a run or starting its models."""
        self.start()
        return self._client.preflight_simulation_world(request)

    def create_simulation_world(self, request: SimulationWorldCreateInput) -> SimulationRequestReceipt:
        """Create a paused World with the exact original command and accepted preview."""
        self.start()
        return self._client.create_simulation_world(request)

    def prepare_simulation_world(self, request: SimulationWorldPrepareInput) -> SimulationRequestReceipt:
        """Prepare the original accepted World without starting inference."""
        self.start()
        return self._client.prepare_simulation_world(request)

    def export_simulation_world_definition(self, request: SimulationWorldExportInput) -> SimulationWorldExportResult:
        """Export the authorized portable definition without private execution history."""
        self.start()
        return self._client.export_simulation_world_definition(request)

    def create_simulation(self, request: SimulationCreateInput) -> SimulationRequestReceipt:
        """Use the original durable command identity; absence does not establish failure."""
        self.start()
        return self._client.create_simulation(request)

    def prepare_simulation(self, request: SimulationPrepareInput) -> SimulationRequestReceipt:
        """Use the original durable command identity; absence does not establish failure."""
        self.start()
        return self._client.prepare_simulation(request)

    def list_simulation_requests(self, request: SimulationRequestsInput) -> SimulationRequestsPage:
        """Read one exact original receipt metadata page; private inputs and scheduling authority are withheld."""
        self.start()
        return self._client.list_simulation_requests(request)

    def retry_simulation_request(self, request: SimulationRetryRequestInput) -> SimulationRequestReceipt:
        """Retry only backend-retained original input; never allocate a fresh identity or retry automatically."""
        self.start()
        return self._client.retry_simulation_request(request)

    def get_simulation_request(self, request: SimulationRequestInput) -> SimulationRequestResult:
        """Use the original durable command identity; absence does not establish failure."""
        self.start()
        return self._client.get_simulation_request(request)

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
                    after_cursor: int | None = None, limit: int | None = None,
                    query: JsonObject | None = None, query_cursor: JsonObject | None = None) -> TeamBrowseResponse:
        """Read one bounded summary window for the selected Team collection."""
        self.start()
        return self._client.browse_team(team_id, kind, after_cursor=after_cursor, limit=limit, query=query, query_cursor=query_cursor)

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
                    event = validated_coordinator_event(notification)
                    if event is not None:
                        events.append(event)

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

    def update_result(self, task_id: str, command_id: str):
        """Read this Team's original update admission without executing a command."""
        self.harness.start()
        return self.harness.client.get_team_task_update_result(self.id, task_id, command_id)

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


def validated_coordinator_event(notification: Notification) -> JsonObject | None:
    """Validate known coordinator events; omit unknown ignorable events and refuse unknown required events."""
    event = notification.payload.get("event")
    if not isinstance(event, dict) or not isinstance(event.get("type"), str):
        raise SdkProtocolError(f"session.event carried no event envelope: {event!r}")
    if "ignorable" in event and event["ignorable"] is not True:
        raise SdkProtocolError("session.event carried an invalid ignorable marker")
    if event["type"] not in KNOWN_SESSION_EVENT_TYPES:
        if event.get("ignorable") is True:
            return None
        raise SdkProtocolError("session.event carried an unknown required event")
    if event["type"] == "compaction/assessment" or (event["type"] == "compaction/end"
            and isinstance(event.get("data"), dict) and "noGain" in event["data"]):
        validate_compaction_evidence_event(event)
    if event["type"] == "simulation/context-view":
        validate_simulation_context_event(event)
    if event["type"] in ("simulation/generation-input", "simulation/generation-output"):
        validate_simulation_generation_event(event)
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


def validate_simulation_generation_event(event: JsonObject) -> None:
    """Reject altered helper request bytes, identities, required markers or token counters."""
    import json

    def counter(value: object) -> bool:
        return type(value) in (int, float) and 0 <= value <= MAX_SAFE_INTEGER and value % 1 == 0

    def text(value: object) -> bool:
        return isinstance(value, str) and len(value) > 0

    def refuse() -> None:
        raise SdkProtocolError("Simulation generation event is malformed")

    if set(event) != {"type", "seq", "time", "data"} or not counter(event.get("seq")) or not counter(event.get("time")):
        refuse()
    data = event.get("data")
    if not isinstance(data, dict):
        refuse()
        return
    if event["type"] == "simulation/generation-input":
        fields = {"jobId", "scope", "audience", "message", "provider", "model", "modelVersion", "promptVersion", "policyVersion"}
        if set(data) != fields or not all(text(data.get(key)) for key in fields - {"audience"}):
            refuse()
        audience = data.get("audience")
        if not isinstance(audience, list) or not audience or not all(text(item) for item in audience):
            refuse()
            return
        if len(set(audience)) != len(audience):
            refuse()
        try:
            message = json.loads(cast(str, data["message"]))
        except (ValueError, TypeError):
            refuse()
            return
        if not isinstance(message, dict) or set(message) != {"id", "role", "source", "content"}:
            refuse()
            return
        content = message.get("content")
        if message.get("id") != f"generation:{data['jobId']}" or message.get("role") != "user" or message.get("source") != {"kind": "plugin", "plugin": "simulation-team"}:
            refuse()
        if not isinstance(content, list) or len(content) != 1 or not isinstance(content[0], dict) or set(content[0]) != {"type", "text"} or content[0].get("type") != "text" or not isinstance(content[0].get("text"), str):
            refuse()
    else:
        if set(data) != ({"jobId", "content", "usage"} if "usage" in data else {"jobId", "content"}) or not text(data.get("jobId")) or not isinstance(data.get("content"), str):
            refuse()
        if "usage" in data:
            usage = data["usage"]
            if not isinstance(usage, dict) or not {"inputTokens", "outputTokens"} <= set(usage) or not set(usage) <= {"inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"} or not all(counter(value) for value in usage.values()):
                refuse()


def validate_simulation_context_event(event: JsonObject) -> None:
    """Reject context views that cannot reproduce the exact ordered model input."""
    def counter(value: object) -> bool:
        return type(value) in (int, float) and 0 <= value <= MAX_SAFE_INTEGER and value % 1 == 0

    def exact(value: object, keys: set[str]) -> bool:
        return isinstance(value, dict) and set(value) == keys

    def decimal(value: object) -> bool:
        return isinstance(value, str) and bool(value) and value.isascii() and value.isdecimal() and (value == "0" or value[0] != "0")

    if (not counter(event.get("seq")) or not counter(event.get("time")) or set(event) - {"type", "seq", "time", "data", "surfaceOp", "sourceEventSeqs"}):
        raise SdkProtocolError("simulation/context-view has an invalid envelope")
    sources = event.get("sourceEventSeqs")
    if "sourceEventSeqs" in event and (not isinstance(sources, list)
        or not all(counter(seq) and seq < event["seq"] for seq in sources)
        or len(set(sources)) != len(sources)):
        raise SdkProtocolError("simulation/context-view has invalid provenance")
    op = event.get("surfaceOp")
    if op != "append" and (not exact(op, {"op", "start", "end"}) or op["op"] != "replace"
        or not counter(op["start"]) or op["start"] != op["end"] or op["start"] >= event["seq"]
        or not isinstance(sources, list) or op["start"] not in sources):
        raise SdkProtocolError("simulation/context-view has an invalid surface operation")
    data = event.get("data")
    keys = {"version", "runId", "entityId", "windowId", "slot", "epoch", "time", "inputId", "projections", "versions", "sources", "content"}
    if (not exact(data, keys) or type(data["version"]) not in (int, float) or data["version"] != 1
        or not all(non_empty_string(data[key]) for key in ("runId", "entityId", "windowId", "inputId"))
        or not all(decimal(data[key]) for key in ("slot", "epoch", "time")) or data["epoch"] == "0"
        or not exact(data["projections"], {"run", "entity", "team"}) or not all(counter(v) for v in data["projections"].values())
        or not exact(data["versions"], {"rules", "policy", "persona", "model"}) or not all(non_empty_string(v) for v in data["versions"].values())
        or not isinstance(data["sources"], list)):
        raise SdkProtocolError("simulation/context-view has malformed data")
    identities = set()
    for source in data["sources"]:
        if exact(source, {"kind", "runId", "sequence"}) and source["kind"] == "run-event":
            if source["runId"] != data["runId"] or not counter(source["sequence"]) or not 0 < source["sequence"] <= data["projections"]["run"]:
                raise SdkProtocolError("simulation/context-view has an invalid run reference")
            identity = (source["kind"], source["runId"], source["sequence"])
        elif exact(source, {"kind", "teamId", "channelId", "envelopeId"}) and source["kind"] == "team-envelope" and all(non_empty_string(source[k]) for k in ("teamId", "channelId", "envelopeId")):
            identity = (source["kind"], source["teamId"], source["channelId"], source["envelopeId"])
        else:
            raise SdkProtocolError("simulation/context-view has malformed source evidence")
        if identity in identities:
            raise SdkProtocolError("simulation/context-view has duplicate evidence")
        identities.add(identity)
    order = ["identity", "authority", "input", "goals", "commitments", "evidence", "observations", "knowledge", "history"]
    previous = -1
    if not isinstance(data["content"], list) or not data["content"]:
        raise SdkProtocolError("simulation/context-view has no content")
    for section in data["content"]:
        if not exact(section, {"kind", "blocks"}) or section["kind"] not in order or not valid_content(section["blocks"]):
            raise SdkProtocolError("simulation/context-view has malformed content")
        rank = order.index(section["kind"])
        if rank <= previous:
            raise SdkProtocolError("simulation/context-view content is out of order")
        previous = rank


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
